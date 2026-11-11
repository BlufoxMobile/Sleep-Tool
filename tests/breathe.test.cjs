const {test}=require('node:test');
const assert=require('node:assert/strict');
const B=require('../breathe.js');

const span=segs=>segs.at(-1).start+segs.at(-1).dur;
function contiguous(segs){let t=0;for(const s of segs){assert.ok(Math.abs(s.start-t)<1e-9,`gap before ${s.type} at ${s.start}`);t+=s.dur;}}

test('calm session: count-in, then sighs from 7 s, then slow 4/6 breathing, with no holds',()=>{
 const plan=B.calmPlan();contiguous(plan);
 assert.deepEqual(plan.slice(0,4).map(s=>[s.type,s.start,s.dur,s.count]),[['settle',0,4,undefined],['count',4,1,3],['count',5,1,2],['count',6,1,1]]);
 const first=plan.find(s=>s.type==='in');assert.equal(first.start,7);assert.equal(first.section,'sigh');
 assert.ok(!plan.some(s=>s.type==='hold'),'calm session must never hold the breath');
 assert.equal(plan.at(-1).type,'end');assert.equal(plan.at(-1).dur,0);
});

test('every physiological sigh exhales clearly longer than its two inhales combined',()=>{
 const plan=B.calmPlan(),breaths=new Map();
 for(const s of plan.filter(s=>s.section==='sigh')){const b=breaths.get(s.breath)||{};b[s.type]=s.dur;breaths.set(s.breath,b);}
 assert.equal(breaths.size,11);
 for(const [n,b] of breaths){assert.ok(b.in&&b.top&&b.out,`sigh ${n} has in, top-up and out`);assert.ok(b.top<b.in,'top-up is short');assert.ok(b.out>=1.5*(b.in+b.top),`sigh ${n} exhale ${b.out} vs inhale ${b.in+b.top}`);}
});

test('sighing lasts 1.5–3 minutes and slow breathing is ~6 breaths a minute',()=>{
 const plan=B.calmPlan(),sigh=plan.filter(s=>s.section==='sigh'),slow=plan.filter(s=>s.section==='slow');
 const sighTime=sigh.reduce((a,s)=>a+s.dur,0);assert.ok(sighTime>=90&&sighTime<=180,`sigh time ${sighTime}`);
 for(const s of slow)assert.equal(s.dur,s.type==='in'?4:6);
 assert.equal(slow.length,20);assert.equal(sighTime,122.5);assert.equal(span(plan),229.5);
});

test('track.at reports the segment, its timing and the end of the session',()=>{
 const track=B.makeTrack(B.calmPlan());
 assert.equal(track.at(-1).type,'settle');assert.equal(track.at(0).type,'settle');
 assert.equal(track.at(4.5).count,3);assert.equal(track.at(6.99).count,1);
 const s=track.at(7.1);assert.equal(s.type,'in');assert.equal(s.start,7);assert.equal(s.end,9.5);
 assert.equal(track.at(9.6).type,'top');assert.equal(track.at(10.6).type,'out');assert.equal(track.at(16.5).type,'in');
 assert.equal(track.at(129.4).section,'sigh');assert.equal(track.at(129.5).section,'slow');
 assert.ok(track.at(229.5).done);assert.ok(track.at(1e6).done);assert.equal(track.total,229.5);
});

test('track.between yields every cue exactly once across arbitrary scheduling windows',()=>{
 const plan=B.calmPlan(),track=B.makeTrack(plan),seen=[];
 for(let a=0;a<240;a+=0.37)seen.push(...track.between(a,a+0.37));
 assert.equal(seen.length,plan.length);
 assert.deepEqual(seen.map(s=>s.start),plan.map(s=>s.start));
 assert.ok(seen.some(s=>s.type==='end'&&s.start===229.5),'end chime is scheduled');
});

test('practice patterns: gentle default, sigh has no hold, box and 4-7-8 are calm-only',()=>{
 assert.deepEqual(B.PATTERN_ORDER,['gentle','sigh','box','478']);assert.deepEqual(Object.keys(B.PATTERNS).sort(),[...B.PATTERN_ORDER].sort());
 assert.deepEqual(B.PATTERNS.gentle.steps,[['in',4],['out',6]]);
 assert.ok(!B.PATTERNS.gentle.calmOnly&&!B.PATTERNS.sigh.calmOnly);
 assert.ok(B.PATTERNS.box.calmOnly&&B.PATTERNS['478'].calmOnly);
 assert.ok(!B.PATTERNS.sigh.steps.some(s=>s[0]==='hold'));
 const p=B.practicePlan('478');assert.deepEqual(p.cycle.map(s=>[s.type,s.dur]),[['in',4],['hold',7],['out',8]]);
 assert.equal(B.practicePlan('nope').cycle.length,2,'unknown pattern falls back to gentle');
});

test('practice tracks loop forever after a 3-second count-in',()=>{
 const p=B.practicePlan('box'),track=B.makeTrack(p.intro,p.cycle);
 assert.equal(track.total,Infinity);assert.equal(track.at(2.5).type,'count');
 assert.equal(track.at(3).type,'in');assert.equal(track.at(7).type,'hold');assert.equal(track.at(11).type,'out');
 const later=track.at(3+16*100+5);assert.equal(later.type,'hold');assert.equal(later.loop,100);assert.equal(later.start,3+1600+4);
 const win=track.between(3+16*5-0.5,3+16*6+0.5);assert.deepEqual(win.map(s=>s.type),['in','hold','out','hold','in']);
});

test('orb grows on the in-breath (two steps for a sigh), holds still, and shrinks on the out-breath',()=>{
 const track=B.makeTrack(B.calmPlan());
 const at=t=>B.orbScale(track.at(t),t);
 assert.equal(at(1),B.REST);assert.ok(at(8)>at(7.2));assert.ok(Math.abs(at(9.5)-0.86)<1e-9);
 assert.ok(Math.abs(at(10.5)-1)<1e-9);assert.ok(at(13)<at(11));assert.ok(Math.abs(at(16.4999)-B.REST)<1e-3);
 for(let t=0;t<230;t+=0.05){const s=at(t);assert.ok(s>=B.REST-1e-9&&s<=1+1e-9);}
 const box=B.makeTrack(...Object.values(B.practicePlan('box')));
 assert.equal(B.orbScale(box.at(8),8),B.orbScale(box.at(10),10),'hold keeps the orb still');
 // continuous at every boundary
 for(const s of B.calmPlan().filter(s=>s.dur>0).slice(1)){const before=at(s.start-1e-6),after=at(s.start+1e-6);assert.ok(Math.abs(before-after)<1e-3,`jump at ${s.start}`);}
});

test('cue pitches glide continuously: each exhale starts where its inhale ended',()=>{
 const plan=B.calmPlan().filter(s=>s.cue&&s.cue.f0);
 for(let i=1;i<plan.length;i++)if(plan[i].type!=='in')assert.equal(plan[i].cue.f0,plan[i-1].cue.f1);
 for(const s of plan){if(s.type==='out')assert.ok(s.cue.f1<s.cue.f0);else assert.ok(s.cue.f1>s.cue.f0);}
 assert.ok(plan.every(s=>s.cue.f0<300&&s.cue.f1<300),'cues stay low and warm');
});

test('keep breathing: 2 minutes of 4/6, fading over the last breaths',()=>{
 const keep=B.keepPlan();contiguous(keep);assert.equal(span(keep),120);
 const levels=keep.filter(s=>s.type==='in').map(s=>s.cue.level);
 assert.deepEqual(levels.slice(-4),[0.85,0.7,0.55,0.4]);assert.ok(levels.slice(0,8).every(l=>l===1));
});

test('grounding walks 5-4-3-2-1 through the senses, and the rain counts',()=>{
 assert.deepEqual(B.GROUNDING.map(g=>[g.n,g.sense]),[[5,'see'],[4,'feel'],[3,'hear'],[2,'smell'],[1,'taste']]);
 assert.match(B.GROUNDING[0].hint,/dark/);assert.match(B.GROUNDING[2].hint,/rain/i);
});
