/* Pure audio operations shared by the player and regression tests. */
(function(root) {
  'use strict';
  function seamLoop(channels, sampleRate, fadeSeconds=8) {
    const available=channels[0].length;
    if(available<sampleRate) throw new Error('The recording is too short.');
    const fade=Math.min(Math.round(fadeSeconds*sampleRate),Math.floor(available/4));
    const length=available-fade;
    // Account for correlated material (e.g. a fan) so the join does not swell.
    let xy=0,xx=0,yy=0;
    for(const src of channels) for(let i=0;i<fade;i+=8){const a=src[i],b=src[length+i];xy+=a*b;xx+=a*a;yy+=b*b;}
    const correlation=Math.max(-.9,Math.min(1,xy/Math.sqrt(xx*yy||1)));
    return channels.map(src=>{
      const out=src.slice(0,length);
      for(let i=0;i<fade;i++){
        const t=i/(fade-1),a=Math.sin(t*Math.PI/2),b=Math.cos(t*Math.PI/2);
        out[i]=(src[i]*a+src[length+i]*b)/Math.sqrt(1+2*correlation*a*b);
      }
      return out;
    });
  }
  function wav(channels,rate,peakCeiling=.89){
    const n=channels[0].length,count=channels.length;
    let peak=0;for(const channel of channels)for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(channel[i]));
    const gain=peak>peakCeiling?peakCeiling/peak:1;
    const buffer=new ArrayBuffer(44+n*count*2),v=new DataView(buffer);
    const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    str(0,'RIFF');v.setUint32(4,36+n*count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,count,true);v.setUint32(24,rate,true);v.setUint32(28,rate*count*2,true);v.setUint16(32,count*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*count*2,true);
    let o=44;for(let i=0;i<n;i++)for(let c=0;c<count;c++,o+=2)v.setInt16(o,Math.round(Math.max(-1,Math.min(1,channels[c][i]*gain))*32767),true);
    return buffer;
  }
  const api={seamLoop,wav};root.NightAudio=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
