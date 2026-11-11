/* Checks the shipped loops in audio/v3 against the goals they were mastered for:
   no audible seam, a long repeat period, even loudness, phone-friendly size.
   The last test decodes the real chunk files with ffmpeg (skipped if absent)
   and runs them through the same mixer the app uses. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createLoopMixer}=require('../audio-core.js');

const root=path.join(__dirname,'..'),dir=path.join(root,'audio','v3');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(dir,'processing-report.json'),'utf8'));
const IDS=['tentrain','rain','thunder'];

test('the app, the manifest and the files agree',()=>{
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(app,/AUDIO_DIR='audio\/v3\/'/);
  for(const id of IDS)assert.match(app,new RegExp(`id:'${id}'`));
  assert.deepEqual(Object.keys(manifest.sounds).sort(),[...IDS].sort());
  assert.equal(manifest.chunkFrames*manifest.chunks,manifest.loopFrames);
  assert.ok(manifest.padFrames>=1024+2304,'padding must cover priming plus the lag search');
  let bytes=0;
  for(const id of IDS){
    const s=manifest.sounds[id];assert.equal(s.files.length,manifest.chunks);
    for(const f of s.files){assert.match(f,new RegExp(`^${id}-\\d\\d\\.m4a$`));bytes+=fs.statSync(path.join(dir,f)).size;}
    assert.ok(s.peak>0&&s.peak<1);
  }
  assert.ok(bytes<30e6,'three sounds should stay under 30 MB, got '+bytes);
  // Only the three rain loops ship; old unversioned files must be gone.
  assert.deepEqual(fs.readdirSync(path.join(root,'audio')),['v3']);
});

test('every sound (and so every mix) repeats no sooner than six minutes',()=>{
  assert.ok(manifest.loopFrames/manifest.sampleRate>=360);
  for(const id of IDS)assert.equal(report.sounds[id].master.loop_seconds*manifest.sampleRate,manifest.loopFrames);
});

for(const id of IDS){
  test(`${id}: seam level and tone match the surrounding minute`,()=>{
    const r=report.sounds[id];
    for(const stage of ['master','encoded'])for(const point of ['seam','wrap_point']){
      const m=r[stage][point],typical=r.master.typical_2s_window_dev_db;
      assert.ok(m.rms_dev_db<=1,`${stage} ${point} 2 s RMS off by ${m.rms_dev_db} dB`);
      assert.ok(m.rms_dev_vs_median_db<=1,`${stage} ${point} median RMS off by ${m.rms_dev_vs_median_db} dB`);
      assert.ok(m.band_dev_db<=Math.max(1.5,typical.band_dev_db_p50_p95[1]),`${stage} ${point} band level off by ${m.band_dev_db} dB`);
      assert.ok(m.centroid_dev_pct<=Math.max(6,typical.centroid_dev_pct_p50_p95[1]),`${stage} ${point} centroid off by ${m.centroid_dev_pct}%`);
      assert.ok(m.sample_step_vs_p99_step<1.5,'no click at the seam');
    }
    for(const j of r.master.joins)assert.ok(j.rms_dev_db<=1&&j.band_dev_db<=1.5);
  });
  test(`${id}: loudness is even across the whole loop`,()=>{
    const l=report.sounds[id].encoded.loudness;
    assert.ok(l['30s_rms_p5_p95_spread_db']<=1,'30 s spread '+l['30s_rms_p5_p95_spread_db']);
    assert.ok(l['10s_rms_p5_p95_spread_db']<=1.5,'10 s spread '+l['10s_rms_p5_p95_spread_db']);
    assert.ok(Math.abs(l.rms_dbfs+24)<=.5);
    assert.ok(report.sounds[id].encoded.chunk_join_lags.every(x=>x===0));
  });
}

function hasFfmpeg(){try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}}
function decode(file){
  const raw=execFileSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-ac','2','-ar',String(manifest.sampleRate),'-'],{maxBuffer:64<<20});
  const all=new Float32Array(raw.buffer,raw.byteOffset,raw.length/4),n=all.length/2,l=new Float32Array(n),r=new Float32Array(n);
  for(let i=0;i<n;i++){l[i]=all[2*i];r[i]=all[2*i+1];}
  return [l,r];
}
function windowDb(pcm,start,frames){
  const L=manifest.loopFrames;let sum=0;
  for(let i=0;i<frames;i++){const j=(((start+i)%L)+L)%L;const a=pcm[2*j]/32767,b=pcm[2*j+1]/32767;sum+=a*a+b*b;}
  return 10*Math.log10(sum/(2*frames)+1e-20);
}

test('decoded chunks, mixed by the app\'s mixer, loop without a seam',{skip:!hasFfmpeg()&&'ffmpeg not installed',timeout:300000},()=>{
  const rate=manifest.sampleRate,L=manifest.loopFrames,W=2*rate;
  for(const id of IDS){
    const m=createLoopMixer(manifest),parts=[];
    for(let k=0;k<manifest.chunks;k++){m.begin(k);m.add(id,k,decode(path.join(dir,manifest.sounds[id].files[k])),1);parts.push(m.finish(k));}
    const pcm=new Int16Array(L*2);let at=0;for(const p of [m.head(),...parts]){pcm.set(p,at);at+=p.length;}
    assert.deepEqual(m.stats.lags,new Array(manifest.chunks-1).fill(0));assert.deepEqual(m.stats.wrapLags,[0]);assert.equal(m.stats.lowCorrelation,0);
    const seam=Math.round(report.sounds[id].joins_seconds_in_file.at(-1)*rate);
    for(const pos of [0,seam]){
      const around=[];for(let s=-30;s<30;s++)if(s<-1||s>0)around.push(windowDb(pcm,pos+s*W,W));
      const ref=10*Math.log10(around.reduce((a,v)=>a+10**(v/10),0)/around.length);
      for(const s of [-1,-.5,0]){const d=windowDb(pcm,pos+s*W,W)-ref;assert.ok(Math.abs(d)<=1,`${id} @${pos/rate}s: ${d.toFixed(2)} dB`);}
    }
    // Whole loop: 30 s windows stay within a 1.5 dB band.
    const w30=[];for(let s=0;s+30*rate<=L;s+=30*rate)w30.push(windowDb(pcm,s,30*rate));
    assert.ok(Math.max(...w30)-Math.min(...w30)<=1.5,`${id} 30 s range ${(Math.max(...w30)-Math.min(...w30)).toFixed(2)} dB`);
  }
});
