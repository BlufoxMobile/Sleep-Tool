const {test}=require('node:test');
const assert=require('node:assert/strict');
const {findLag,mixGains,createLoopMixer,toInt16,wavHeader,wav,fadeOut,loopRanges}=require('../audio-core.js');

// Deterministic noise so failures are reproducible.
function noise(n,seed=1){let s=seed>>>0;const out=new Float32Array(n);for(let i=0;i<n;i++){s=(s*1664525+1013904223)>>>0;out[i]=(s/4294967296-.5)*.4;}return out;}
const layout={loopFrames:80000,chunkFrames:20000,padFrames:4000,chunks:4,joinFade:512};

/* Cut a loop into padded chunks the way tools/master_audio.py does, optionally
   simulating a decoder that keeps `offset` frames of priming at the start. */
function chunksOf(loop,{offset=0,jitter=0,extraOffsetFor={}}={}){
  const {loopFrames:L,chunkFrames:C,padFrames:P,chunks:N}=layout;
  return Array.from({length:N},(_,k)=>{
    const off=offset+(extraOffsetFor[k]||0),len=C+2*P+off+700,chans=[];
    for(const src of loop){const d=new Float32Array(len);const n=noise(len,k+7);
      for(let i=0;i<len;i++){const j=i-off;d[i]=j<0?n[i]:src[(((k*C-P+j)%L)+L)%L]+(jitter?n[i]*jitter:0);}
      chans.push(d);}
    return chans;
  });
}
function render(sounds){
  const m=createLoopMixer(layout),parts=[];
  for(let k=0;k<layout.chunks;k++){m.begin(k);for(const s of sounds)m.add(s.id,k,s.chunks[k],s.gain);parts.push(m.finish(k));}
  const all=new Int16Array(layout.loopFrames*2);let at=0;for(const p of [m.head(),...parts]){all.set(p,at);at+=p.length;}
  return {pcm:all,stats:m.stats};
}
const sample=(pcm,i,c=0)=>pcm[(((i%layout.loopFrames)+layout.loopFrames)%layout.loopFrames)*2+c]/32767;

test('findLag recovers a known shift and reports low confidence on silence',()=>{
  const a=noise(20000),b=new Float32Array(20000);b.set(a.subarray(0,19000),337);
  const r=findLag([a],5000,[b],5000,2048,2304);assert.equal(r.lag,337);assert.ok(r.corr>.999);
  const z=findLag([new Float32Array(9000)],3000,[new Float32Array(9000)],3000);assert.equal(z.corr,0);
});

test('chunked loop reassembles sample-exactly, including the wrap-around',()=>{
  const loop=[noise(80000,3),noise(80000,4)];
  const {pcm,stats}=render([{id:'a',gain:1,chunks:chunksOf(loop)}]);
  assert.equal(pcm.length,80000*2);assert.deepEqual(stats.lags,[0,0,0]);assert.deepEqual(stats.wrapLags,[0]);assert.equal(stats.lowCorrelation,0);
  let worst=0;for(let i=0;i<80000;i++)for(let c=0;c<2;c++)worst=Math.max(worst,Math.abs(sample(pcm,i,c)-loop[c][i]));
  assert.ok(worst<1e-4,'max error '+worst);
});

test('decoder priming that is not trimmed only shifts the loop; it stays seamless',()=>{
  const loop=[noise(80000,5),noise(80000,6)];
  const {pcm}=render([{id:'a',gain:1,chunks:chunksOf(loop,{offset:1024})}]);
  let worst=0;for(let i=0;i<80000;i++)worst=Math.max(worst,Math.abs(sample(pcm,i)-loop[0][(i+80000-1024)%80000]));
  assert.ok(worst<1e-4,'max error '+worst);
});

test('a chunk that decodes with a different offset is realigned by correlation',()=>{
  const loop=[noise(80000,8),noise(80000,9)];
  const {pcm,stats}=render([{id:'a',gain:1,chunks:chunksOf(loop,{extraOffsetFor:{2:300}})}]);
  assert.deepEqual(stats.lags,[0,300,-300]);assert.equal(stats.lowCorrelation,0);
  let worst=0;for(let i=0;i<80000;i++)worst=Math.max(worst,Math.abs(sample(pcm,i)-loop[0][i]));
  assert.ok(worst<1e-4,'max error '+worst);
});

test('codec-like differences at chunk joins are crossfaded, not stepped',()=>{
  const loop=[noise(80000,10),noise(80000,11)];
  const {pcm}=render([{id:'a',gain:1,chunks:chunksOf(loop,{jitter:.02})}]);
  // Every sample (joins included) stays within the simulated codec error.
  let worst=0;for(let i=0;i<80000;i++)worst=Math.max(worst,Math.abs(sample(pcm,i)-loop[0][i]));
  assert.ok(worst<.02,'max error '+worst);
  for(const j of [0,20000,40000,60000]){const step=Math.abs(sample(pcm,j)-sample(pcm,j-1)),natural=Math.abs(loop[0][j%80000]-loop[0][(j+79999)%80000]);assert.ok(step<natural+.03);}
});

test('two sounds mix with their own gains',()=>{
  const a=[noise(80000,12),noise(80000,13)],b=[noise(80000,14),noise(80000,15)];
  const {pcm}=render([{id:'a',gain:.5,chunks:chunksOf(a)},{id:'b',gain:.25,chunks:chunksOf(b,{offset:2112})}]);
  let worst=0;for(let i=0;i<80000;i++)worst=Math.max(worst,Math.abs(sample(pcm,i)-(a[0][i]*.5+b[0][(i+80000-2112)%80000]*.25)));
  assert.ok(worst<1e-4,'max error '+worst);
});

test('mono chunks feed both channels; a bad layout or short decode is refused',()=>{
  const loop=[noise(80000,16)],chunks=chunksOf(loop).map(c=>[c[0]]);
  const {pcm}=render([{id:'m',gain:1,chunks}]);assert.equal(pcm[1000],pcm[1001]);
  assert.throws(()=>createLoopMixer({...layout,loopFrames:80001}),/add up/);
  const m=createLoopMixer(layout);m.begin(0);assert.throws(()=>m.add('x',0,[new Float32Array(1000)],1),/decode/);
});

test('mix gains keep the summed mastered peaks under the ceiling',()=>{
  const quiet=mixGains([{vol:.7,peak:.8},{vol:.3,peak:.8}],.55);
  assert.equal(quiet.scale,1);assert.ok(Math.abs(quiet.gains[0]-.385)<1e-12);
  const loud=mixGains([{vol:1,peak:.8},{vol:1,peak:.8},{vol:1,peak:.8}],1);
  assert.ok(Math.abs(loud.gains.reduce((s,g)=>s+g*.8,0)-.89)<1e-9);
});

test('Int16 conversion clamps and interleaves',()=>{
  const out=toInt16([Float32Array.from([0,2,-2,.5]),Float32Array.from([1,-1,0,.25])],1,4);
  assert.deepEqual(Array.from(out),[32767,-32767,-32767,0,16384,8192]);
});

test('WAV header and whole-file WAV: duration, interleaving, and peak headroom',()=>{
  const h=new DataView(wavHeader(12480000,2,32000));
  assert.equal(h.getUint32(40,true),12480000*4);assert.equal(h.getUint32(4,true),36+12480000*4);assert.equal(h.getUint16(22,true),2);
  const buffer=wav([new Float32Array([0,2,-2]),new Float32Array([.5,1,-1])],32000),view=new DataView(buffer);
  assert.equal(buffer.byteLength,56);assert.equal(view.getUint32(24,true),32000);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(40,true),12);
  assert.equal(view.getInt16(44,true),0);assert.ok(view.getInt16(46,true)>0);assert.ok(view.getInt16(48,true)<=Math.ceil(.89*32767));assert.ok(view.getInt16(52,true)<0);
});

test('sleep-timer fade starts at full level and ends in silence',()=>{
  const pcm=new Int16Array(64000).fill(16384),[l,r]=fadeOut(pcm,2);
  assert.equal(l.length,32000);assert.ok(Math.abs(l[0]-.5)<1e-4);assert.ok(Math.abs(r[0]-.5)<1e-4);
  assert.ok(l[31999]<.001);for(let i=1;i<l.length;i++)assert.ok(l[i]<=l[i-1]);
});

test('timer fade reads across the loop point',()=>{
  assert.deepEqual(loopRanges(95,10,100),[[95,100],[0,5]]);
  assert.deepEqual(loopRanges(205,10,100),[[5,15]]);
});
