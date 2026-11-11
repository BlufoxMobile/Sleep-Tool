/* Pure audio operations shared by the player and the regression tests.
 *
 * The rain loops ship pre-mastered (tools/master_audio.py): each sound is one
 * seamless 6.5-minute loop cut into equal chunks. Every chunk file carries a
 * little of its neighbours' audio on both sides, so AAC encoder priming and
 * padding never land inside the part we keep. The mixer below decodes one
 * chunk at a time, checks the alignment against the previous chunk by
 * cross-correlation, crossfades the two encodings of the shared audio, and
 * writes 16-bit PCM straight out, so the page never holds the whole loop as
 * Float32.
 */
(function(root) {
  'use strict';

  /* Normalised cross-correlation of the mid channel. Finds `lag` such that
     next[nextStart+lag+t] ~= prev[prevStart+t] for t in [0, size). */
  function findLag(prev, prevStart, next, nextStart, size=2048, maxLag=2304) {
    const mid=(ch,i)=>ch.length>1?(ch[0][i]+ch[1][i])*.5:ch[0][i];
    const a=new Float64Array(size);let ea=0;
    for(let t=0;t<size;t++){a[t]=mid(prev,prevStart+t);ea+=a[t]*a[t];}
    const lo=Math.max(-maxLag,-nextStart),hi=Math.min(maxLag,next[0].length-size-nextStart);
    if(hi<lo||ea===0)return {lag:0,corr:0};
    const span=hi-lo+size,b=new Float64Array(span);
    for(let i=0;i<span;i++)b[i]=mid(next,nextStart+lo+i);
    let eb=0;for(let t=0;t<size;t++)eb+=b[t]*b[t];
    let best=-Infinity,bestLag=0;
    for(let k=0;k<=hi-lo;k++){
      if(k>0){const o=b[k-1],n=b[k+size-1];eb+=n*n-o*o;}
      let dot=0;for(let t=0;t<size;t++)dot+=a[t]*b[k+t];
      const c=dot/Math.sqrt(ea*Math.max(eb,1e-30));
      if(c>best){best=c;bestLag=lo+k;}
    }
    return {lag:bestLag,corr:best};
  }

  /* Per-sound gains for a mix. The mastered peaks are known (manifest), so a
     single conservative scale keeps the summed peak under `ceiling` without
     a second pass over the audio. */
  function mixGains(sounds, master, ceiling=.89) {
    const gains=sounds.map(s=>Math.max(0,Math.min(1,s.vol))*Math.max(0,Math.min(1,master)));
    const bound=sounds.reduce((sum,s,i)=>sum+gains[i]*(s.peak||1),0);
    const scale=bound>ceiling?ceiling/bound:1;
    return {gains:gains.map(g=>g*scale),scale,bound};
  }

  /* Assembles a seamless loop chunk by chunk.
     layout: {loopFrames, chunkFrames, padFrames, chunks, joinFade}
     Use: begin(k); add(id,k,channels,gain) per sound; finish(k) -> Int16Array;
     after the last chunk, head() -> Int16Array for frames [0, joinFade).
     The file is then: header, head(), finish(0), finish(1), ... */
  function createLoopMixer(layout) {
    const C=layout.chunkFrames,P=layout.padFrames,N=layout.chunks,F=layout.joinFade||2048;
    if(C*N!==layout.loopFrames)throw new Error('Chunk layout does not add up.');
    const WIN=2048,MAX_LAG=2304,BACK=WIN/2,AFTER=Math.max(F,WIN-BACK);
    const acc=[new Float32Array(C),new Float32Array(C)],head=[new Float32Array(F),new Float32Array(F)];
    const sounds=new Map(),stats={lags:[],wrapLags:[],lowCorrelation:0};
    function keep(ch,from,to){return ch.map(c=>c.slice(from,to));}
    return {
      stats,
      begin(){acc[0].fill(0);acc[1].fill(0);},
      add(id,k,channels,gain){
        const ch=channels.length>1?channels:[channels[0],channels[0]];
        let st=sounds.get(id);
        if(!st){st={read:P,tail:null,first:null};sounds.set(id,st);}
        if(k>0&&st.tail){
          // st.tail holds the previous chunk from its (read+C-BACK).
          const r=findLag(st.tail,0,ch,st.read-BACK,WIN,MAX_LAG);
          if(r.corr>=.5)st.read+=r.lag;else stats.lowCorrelation++;
          stats.lags.push(r.corr>=.5?r.lag:0);
        }
        const read=st.read;
        if(read<BACK+MAX_LAG||read+C+AFTER>ch[0].length)throw new Error('This sound did not decode as expected.');
        for(let c=0;c<2;c++){
          const src=ch[c],dst=acc[c];
          let j=0;
          if(k===0){for(;j<F;j++)head[c][j]+=gain*src[read+j]*((j+.5)/F);}
          else if(st.tail){const prev=st.tail[c];for(;j<F;j++){const w=(j+.5)/F;dst[j]+=gain*(prev[BACK+j]*(1-w)+src[read+j]*w);}}
          for(;j<C;j++)dst[j]+=gain*src[read+j];
        }
        if(k===0)st.first=keep(ch,read-BACK-MAX_LAG,read+BACK+MAX_LAG+WIN);
        st.tail=keep(ch,read+C-BACK,read+C+AFTER);
        if(k===N-1){
          // Wrap-around: the last chunk's tail fades into the first chunk's head.
          const r=findLag(st.tail,0,st.first,MAX_LAG,WIN,MAX_LAG);
          stats.wrapLags.push(r.corr>=.5?r.lag:0);
          for(let c=0;c<2;c++)for(let j=0;j<F;j++)head[c][j]+=gain*st.tail[c][BACK+j]*(1-(j+.5)/F);
          sounds.delete(id);
        }
      },
      finish(k){return toInt16(acc,k===0?F:0,C);},
      head(){return toInt16(head,0,F);}
    };
  }

  /* Interleaved 16-bit PCM from two Float32 channels (clamped). */
  function toInt16(channels, from, to) {
    const n=to-from,out=new Int16Array(n*2),L=channels[0],R=channels[1]||channels[0];
    for(let i=0,o=0;i<n;i++,o+=2){
      const l=L[from+i],r=R[from+i];
      out[o]=Math.round(Math.max(-1,Math.min(1,l))*32767);
      out[o+1]=Math.round(Math.max(-1,Math.min(1,r))*32767);
    }
    return out;
  }

  function wavHeader(frames, channels, rate) {
    const bytes=frames*channels*2,buffer=new ArrayBuffer(44),v=new DataView(buffer);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+bytes,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,bytes,true);
    return buffer;
  }

  /* Whole WAV from Float32 channels (short files: unlock clip, timer fade). */
  function wav(channels, rate, peakCeiling=.89) {
    const n=channels[0].length,count=channels.length;
    let peak=0;for(const channel of channels)for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(channel[i]));
    const gain=peak>peakCeiling?peakCeiling/peak:1;
    const buffer=new ArrayBuffer(44+n*count*2),v=new DataView(buffer);
    new Uint8Array(buffer).set(new Uint8Array(wavHeader(n,count,rate)));
    let o=44;for(let i=0;i<n;i++)for(let c=0;c<count;c++,o+=2)v.setInt16(o,Math.round(Math.max(-1,Math.min(1,channels[c][i]*gain))*32767),true);
    return buffer;
  }

  /* Interleaved Int16 PCM -> Float32 channels with a quarter-cosine fade to
     silence (the sleep timer's final minute is baked into PCM, because iOS
     ignores element.volume). */
  function fadeOut(int16, channels=2) {
    const n=Math.floor(int16.length/channels),out=Array.from({length:channels},()=>new Float32Array(n));
    for(let i=0;i<n;i++){const g=Math.cos(i/n*Math.PI/2)/32767;for(let c=0;c<channels;c++)out[c][i]=int16[i*channels+c]*g;}
    return out;
  }

  /* Frame ranges to read for `count` frames from `offset` in a looping file
     of `frames` frames (wraps at most once per loop length). */
  function loopRanges(offset, count, frames) {
    const ranges=[];let at=((offset%frames)+frames)%frames,left=count;
    while(left>0){const take=Math.min(left,frames-at);ranges.push([at,at+take]);left-=take;at=0;}
    return ranges;
  }

  const api={findLag,mixGains,createLoopMixer,toInt16,wavHeader,wav,fadeOut,loopRanges};
  root.NightAudio=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
