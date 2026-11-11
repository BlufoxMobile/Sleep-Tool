'use strict';
const $=id=>document.getElementById(id);
const PATHS={rain:'M4 15l-1 3m7-3-1 3m7-3-1 3M6 11a4 4 0 1 1 1-7 5 5 0 0 1 9 2 3 3 0 1 1 1 6H6',tent:'M2 20 12 3l10 17H2Zm6 0 4-8 4 8M5 4 4 6m14-3-1 2m4 3-1 2',thunder:'M13 10 8 16h5l-2 6 7-9h-5l2-3M5 13a4 4 0 1 1 1-8 5 5 0 0 1 9-1 4 4 0 0 1 4 7',moon:'M19 16A9 9 0 0 1 8 3a9 9 0 1 0 11 13'};
const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[id]||PATHS.moon}"/></svg>`;
const SOUNDS=[
 {id:'tentrain',name:'Rain on Tent',detail:'Soft patter on canvas',icon:'tent',vol:.7},
 {id:'rain',name:'Summer Rain',detail:'A steady, open-window shower',icon:'rain',vol:.6},
 {id:'thunder',name:'Distant Thunder',detail:'Rain with rolling thunder',icon:'thunder',vol:.35}
];
const SCENES=[
 {id:'tent',title:'Under Canvas',subtitle:'Rain on a quiet tent',icon:'tent',mix:{tentrain:.7},description:'A small shelter from the world.'},
 {id:'rain',title:'Rainy Retreat',subtitle:'Rain & distant thunder',icon:'rain',mix:{rain:.65,thunder:.22},description:'A softer world outside your window.'},
 {id:'storm',title:'Storm Shelter',subtitle:'Tent rain & far-off thunder',icon:'thunder',mix:{tentrain:.65,thunder:.2},description:'Safe and dry while the sky rumbles far away.'}
];
// Pre-mastered seamless loops (tools/master_audio.py). New folder per version, so phones never replay a stale cached file.
const AUDIO_DIR='audio/v3/';
const KEY='nightsounds-sanctuary-v2',FAVORITE=KEY+'-favorite';
const state=Object.fromEntries(SOUNDS.map(s=>[s.id,{on:s.id==='tentrain',vol:s.vol}]));
let master=.55,timer=0,scene='tent',revision=0,dirty=false,busy=false,token=0,blobURL,deadline=0,timerTick,renderedLoop=null,ending=false,manifest=null,renderAbort=null;
const player=$('player');
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function snapshot(){return{sounds:state,master,timer,scene};}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
// Older saves may name sounds that no longer exist: they are ignored, and an empty mix falls back to tent rain.
function restore(data){if(!data||typeof data.sounds!=='object'||!data.sounds)return;for(const s of SOUNDS){const d=data.sounds[s.id];state[s.id].on=!!d&&d.on===true;if(d)state[s.id].vol=Number.isFinite(d.vol)?Math.max(0,Math.min(1,d.vol)):s.vol;}if(!SOUNDS.some(s=>state[s.id].on))state.tentrain.on=true;master=Number.isFinite(data.master)?Math.max(0,Math.min(1,data.master)):.55;timer=[0,15,30,60,120].includes(data.timer)?data.timer:0;scene=SCENES.some(s=>s.id===data.scene)?data.scene:null;}
restore(read(KEY));
function status(message){$('status').textContent=message;}
function selected(){return SOUNDS.filter(s=>state[s.id].on);}
function updateUI(){
 for(const s of SOUNDS){const st=state[s.id],el=$('sound-'+s.id);el.classList.toggle('selected',st.on);el.querySelector('button').setAttribute('aria-pressed',String(st.on));el.querySelector('.selection-mark').textContent=st.on?'✓':'+';el.querySelector('input').value=Math.round(st.vol*100);el.querySelector('output').textContent=Math.round(st.vol*100)+'%';}
 $('master').value=Math.round(master*100);$('master-value').textContent=Math.round(master*100)+'%';$('timer').value=timer;
 $('selected-count').textContent=selected().length+' selected';
 $('mix-list').replaceChildren();for(const s of selected()){const row=document.createElement('div');row.className='mix-item';row.innerHTML=`<span>${s.name}</span><span>${Math.round(state[s.id].vol*100)}%</span>`;$('mix-list').append(row);}if(!selected().length)$('mix-list').textContent='Choose a sound to make yourself at home.';
 document.querySelectorAll('.scene').forEach(el=>{const active=el.dataset.scene===scene;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
 $('mix-description').textContent=SCENES.find(s=>s.id===scene)?.description||'A little world of your own.';
 $('play').disabled=busy||!selected().length||!selected().some(s=>state[s.id].vol>0)||master===0;
 $('play').innerHTML=busy?'Preparing your quiet…':dirty&&blobURL?'Apply changes <span>↻</span>':blobURL&&!player.paused?'Pause soundscape <span>Ⅱ</span>':blobURL?'Resume soundscape <span>▷</span>':'Play my soundscape <span>▷</span>';
 $('stop').disabled=!blobURL&&!busy;$('restore').hidden=!read(FAVORITE);
 document.body.classList.toggle('playing',!!blobURL&&!player.paused);
 if(!deadline)$('timer-info').textContent=timer?'Gentle finish':'No time limit';
}
function changed(){revision++;dirty=true;store(KEY,snapshot());updateUI();if(blobURL)status('Mix adjusted. Tap Apply changes when you’re ready.');}
for(const s of SOUNDS){
 const card=document.createElement('article');card.id='sound-'+s.id;card.className='sound-card';
 card.innerHTML=`<button class="sound-toggle" aria-label="${s.name}" aria-pressed="false"><span class="sound-top">${icon(s.icon)}<span class="selection-mark" aria-hidden="true">+</span></span><span class="sound-name">${s.name}</span><span class="sound-detail">${s.detail}</span></button><div class="level-row"><input type="range" min="0" max="100" value="${s.vol*100}" aria-label="${s.name} volume"><output>${s.vol*100}%</output></div>`;
 card.querySelector('button').onclick=()=>{state[s.id].on=!state[s.id].on;scene=null;changed();};
 card.querySelector('input').oninput=e=>{state[s.id].vol=Number(e.target.value)/100;scene=null;changed();};$('sounds').append(card);
}
for(const s of SCENES){const el=document.createElement('button');el.className='scene';el.dataset.scene=s.id;el.setAttribute('aria-pressed','false');el.innerHTML=`${icon(s.icon)}<strong>${s.title}</strong><small>${s.subtitle}</small>`;el.onclick=()=>chooseScene(s);$('scenes').append(el);}
function chooseScene(s){for(const sound of SOUNDS){state[sound.id].on=sound.id in s.mix;if(state[sound.id].on)state[sound.id].vol=s.mix[sound.id];}scene=s.id;changed();if(!blobURL)status('Scene ready. Press Play to settle in.');}
for(let i=0;i<45;i++){const bar=document.createElement('i');bar.style.cssText=`--h:${5+30*Math.abs(Math.sin(i*1.93))*Math.sin(Math.PI*(i+1)/46)}px;--delay:${-i*.17}s`;document.querySelector('.wave').append(bar);}
$('master').oninput=e=>{master=Number(e.target.value)/100;changed();};$('timer').onchange=e=>{timer=Number(e.target.value);changed();};
$('save').onclick=()=>{status(store(FAVORITE,snapshot())?'Your favorite mix is saved on this device.':'This browser couldn’t save your mix.');updateUI();};
$('restore').onclick=()=>{restore(read(FAVORITE));changed();if(!blobURL)status('Your saved mix is ready.');};
$('dim').onclick=()=>{const dim=document.body.classList.toggle('dimmed');$('dim').innerHTML=dim?'☀ <span>Bring back the light</span>':'☾ <span>Dim the lights</span>';$('dim').setAttribute('aria-pressed',String(dim));};
// No preview players, pitch changes, synthetic voices, or interval-based loop scheduling.
async function loadManifest(){
 if(manifest)return manifest;
 const response=await fetch(AUDIO_DIR+'manifest.json');if(!response.ok)throw Error('The sound library couldn’t load. Check your connection and try again.');
 manifest=await response.json();return manifest;
}
async function fetchChunk(sound,k,request,signal){
 const response=await fetch(AUDIO_DIR+manifest.sounds[sound.id].files[k],{signal});
 if(request!==token)throw Error('cancelled');
 if(!response.ok)throw Error(sound.name+' couldn’t load. Check your connection and try again.');
 return response.arrayBuffer();
}
function decode(decoder,data){return new Promise((resolve,reject)=>{const p=decoder.decodeAudioData(data,resolve,reject);if(p&&p.then)p.then(resolve,reject);});}
// Builds the whole loop as 16-bit PCM, one chunk at a time, straight into Blob parts:
// the page holds at most one decoded chunk per sound (~10 MB) plus the finished WAV.
async function renderMix(mix,request,signal){
 const m=await loadManifest();if(request!==token)throw Error('cancelled');
 const rate=m.sampleRate,active=SOUNDS.filter(s=>mix.sounds[s.id].on&&mix.sounds[s.id].vol>0&&m.sounds[s.id]);
 const {gains}=NightAudio.mixGains(active.map(s=>({vol:mix.sounds[s.id].vol,peak:m.sounds[s.id].peak})),mix.master);
 // Decode at the files' own rate, whatever the hardware rate is.
 const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext,decoder=new Offline(2,rate,rate);
 const mixer=NightAudio.createLoopMixer({loopFrames:m.loopFrames,chunkFrames:m.chunkFrames,padFrames:m.padFrames,chunks:m.chunks,joinFade:m.joinFade});
 // Fetch chunk k+1 while chunk k decodes. Handlers are attached at once so an
 // abandoned prefetch never surfaces as an unhandled rejection.
 const prefetch=k=>k<m.chunks?active.map(s=>{const p=fetchChunk(s,k,request,signal);p.catch(()=>{});return p;}):[];
 const parts=[];let next=prefetch(0);
 for(let k=0;k<m.chunks;k++){
   const pending=next;next=prefetch(k+1);
   mixer.begin(k);
   for(let i=0;i<active.length;i++){
     const buffer=await decode(decoder,await pending[i]);if(request!==token)throw Error('cancelled');
     if(buffer.sampleRate!==rate)throw Error('This browser can’t prepare the sound. Please try another browser.');
     const channels=Array.from({length:Math.min(2,buffer.numberOfChannels)},(_,c)=>buffer.getChannelData(c));
     mixer.add(active[i].id,k,channels,gains[i]);
   }
   parts.push(new Blob([mixer.finish(k)]));
   status(`Preparing your soundscape… ${Math.round((k+1)/m.chunks*100)}%`);
 }
 if(mixer.stats.lowCorrelation||mixer.stats.wrapLags.some(Boolean))console.warn('Night Sounds: unexpected chunk alignment',mixer.stats);
 const blob=new Blob([NightAudio.wavHeader(m.loopFrames,2,rate),mixer.head(),...parts],{type:'audio/wav'});
 return{blob,rate,frames:m.loopFrames,channels:2,dataOffset:44};
}
// Start a media element in the original gesture for iOS audio-session unlocking.
const silentURL=URL.createObjectURL(new Blob([NightAudio.wav([new Float32Array(1600)],32000)],{type:'audio/wav'}));
async function play(){
 if(busy)return;
 if(blobURL&&!dirty){if(player.paused){try{await player.play();status('Playing. Settle in at your own pace.');}catch{status('Tap Play again to allow audio.');}}else{player.pause();status('Paused. Your mix is right here.');}updateUI();return;}
 if(!selected().length||master===0)return;
 const request=++token,version=revision,mix=JSON.parse(JSON.stringify(snapshot()));
 busy=true;updateUI();status('Gathering the rain…');
 if(renderAbort)renderAbort.abort();renderAbort=new AbortController();const signal=renderAbort.signal;
 if(!blobURL){player.src=silentURL;player.loop=true;player.play().catch(()=>{});}
 try{
   const result=await renderMix(mix,request,signal);if(request!==token)return;
   const old=blobURL;blobURL=URL.createObjectURL(result.blob);player.src=blobURL;player.loop=true;player.volume=1;renderedLoop=result;ending=false;
   if(old)URL.revokeObjectURL(old);
   deadline=mix.timer?Date.now()+mix.timer*60000:0;dirty=version!==revision;
   await player.play();setupMedia();startTimer();status(dirty?'Playing. Your latest edits are waiting to be applied.':mix.timer?'Playing. Your timer is set for '+mix.timer+' minutes.':'Playing all night. You can now try locking your screen.');
 }catch(error){if(request===token){if(!blobURL)player.pause();status(error.message==='cancelled'?'Stopped.':error.message||'Audio couldn’t start. Please try again.');}}
 finally{if(request===token){busy=false;updateUI();}}
}
function stop(message='All sound stopped. Your mix is saved.'){token++;busy=false;if(renderAbort){renderAbort.abort();renderAbort=null;}player.pause();player.removeAttribute('src');player.load();if(blobURL)URL.revokeObjectURL(blobURL);blobURL=null;renderedLoop=null;dirty=false;ending=false;deadline=0;clearInterval(timerTick);if('mediaSession'in navigator)navigator.mediaSession.playbackState='none';status(message);updateUI();}
$('play').onclick=play;$('stop').onclick=()=>stop();$('hero-play').onclick=()=>{chooseScene(SCENES[0]);play();};
// Bake the final fade into PCM: iOS ignores programmatic element volume.
// This final, non-looping file stops itself even if JS is then suspended.
async function finishWithFade(remaining){
 const loop=renderedLoop,request=token,{blob,rate,frames,channels,dataOffset}=loop;
 const n=Math.max(1,Math.floor(remaining*rate)),offset=Math.floor(player.currentTime*rate);
 const pieces=await Promise.all(NightAudio.loopRanges(offset,n,frames).map(([a,b])=>blob.slice(dataOffset+a*channels*2,dataOffset+b*channels*2).arrayBuffer()));
 if(request!==token||renderedLoop!==loop||!blobURL)return;
 const pcm=new Int16Array(n*channels);let at=0;for(const p of pieces){const v=new Int16Array(p);pcm.set(v,at);at+=v.length;}
 const old=blobURL;blobURL=URL.createObjectURL(new Blob([NightAudio.wav(NightAudio.fadeOut(pcm,channels),rate)],{type:'audio/wav'}));player.src=blobURL;player.loop=false;URL.revokeObjectURL(old);
 player.play().catch(()=>{status('Tap Resume to finish your timed session.');updateUI();});
}
function checkTimer(){
 if(!deadline||!blobURL)return;const remaining=(deadline-Date.now())/1000;
 $('timer-info').textContent=remaining>0?Math.ceil(remaining/60)+' min left':'Finishing';
 if(remaining<=0){stop('Sleep timer finished. Rest well.');return;}
 if(remaining<=60&&!ending&&!busy&&!player.paused&&renderedLoop){ending=true;finishWithFade(remaining).catch(()=>{ending=false;});}
}
function startTimer(){clearInterval(timerTick);timerTick=setInterval(checkTimer,1000);}
player.addEventListener('timeupdate',checkTimer);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkTimer();});
player.addEventListener('ended',()=>{if(ending)stop('Sleep timer finished. Rest well.');});
player.addEventListener('pause',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';updateUI();});
player.addEventListener('play',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';updateUI();});
player.addEventListener('error',()=>{if(blobURL){status('Playback was interrupted. Press Stop, then Play to rebuild your mix.');updateUI();}});
function setupMedia(){if(!('mediaSession'in navigator))return;navigator.mediaSession.metadata=new MediaMetadata({title:SCENES.find(s=>s.id===scene)?.title||'Your sanctuary',artist:'Night Sounds',album:'A little closer to quiet',artwork:[{src:new URL('assets/moon.svg',location.href).href,sizes:'48x48',type:'image/svg+xml'}]});for(const[action,handler]of Object.entries({play:()=>{player.play().catch(()=>status('Open the app and tap Resume.'));},pause:()=>player.pause(),stop:()=>stop()})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
// Breathing guide lives in breathe.js.
$('about-open').onclick=()=>$('about-dialog').showModal();document.querySelectorAll('#about-dialog .dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
updateUI();
