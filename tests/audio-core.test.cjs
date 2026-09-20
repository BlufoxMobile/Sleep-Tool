const {test}=require('node:test');
const assert=require('node:assert/strict');
const {seamLoop,wav}=require('../audio-core.js');
test('join meets adjacent original samples without a discontinuity',()=>{
 const sr=1000,source=Float32Array.from({length:10000},(_,i)=>Math.sin(i*.01)*.2);
 const [loop]=seamLoop([source],sr,2);
 assert.equal(loop.length,8000);assert.equal(loop[0],source[8000]);
 assert.equal(loop.at(-1),source[7999]);assert.ok(Math.abs(loop[0]-loop.at(-1))<.003);
 assert.equal(loop[1999],source[1999]);
});
test('correlated joins do not create an equal-power volume swell',()=>{
 const src=new Float32Array(10000).fill(.2);const [loop]=seamLoop([src],1000,2);
 for(const value of loop)assert.ok(Math.abs(value-.2)<1e-6);
});
test('handles mono, stereo and clips shorter than requested fade',()=>{
 const left=new Float32Array(1500).fill(.1),right=new Float32Array(1500).fill(-.2);
 const loop=seamLoop([left,right],1000,8);assert.equal(loop.length,2);assert.equal(loop[0].length,1125);
 for(const c of loop)for(const x of c)assert.ok(Number.isFinite(x));
 assert.throws(()=>seamLoop([new Float32Array(10)],1000),/too short/);
});
test('silent recordings remain finite and silent',()=>{
 const [loop]=seamLoop([new Float32Array(10000)],1000,2);assert.ok(loop.every(x=>x===0));
});
test('WAV duration, channel interleaving, and peak headroom are correct',()=>{
 const buffer=wav([new Float32Array([0,2,-2]),new Float32Array([.5,1,-1])],32000),view=new DataView(buffer);
 assert.equal(buffer.byteLength,56);assert.equal(view.getUint32(24,true),32000);assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(40,true),12);
 assert.equal(view.getInt16(44,true),0);assert.ok(view.getInt16(46,true)>0);assert.ok(view.getInt16(48,true)<=Math.ceil(.89*32767));assert.ok(view.getInt16(52,true)<0);
});
