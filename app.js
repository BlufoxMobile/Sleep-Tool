'use strict';
const $=id=>document.getElementById(id);
const SOUNDS=[
 {id:'tentrain',name:'Rain on Tent',detail:'Soft patter on canvas',icon:'tent',vol:.7},
 {id:'rain',name:'Summer Rain',detail:'A steady, open-window shower',icon:'rain',vol:.6},
 {id:'thunder',name:'Distant Thunder',detail:'Rain with rolling thunder',icon:'thunder',vol:.35}
];
const SCENES=[
 {id:'tent',title:'Tent',subtitle:'Rain on Tent',mix:{tentrain:.7}},
 {id:'rain',title:'Rain',subtitle:'Summer rain and thunder',mix:{rain:.65,thunder:.22}},
 {id:'storm',title:'Storm',subtitle:'Tent rain and thunder',mix:{tentrain:.65,thunder:.2}}
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
 document.querySelectorAll('.scene').forEach(el=>{const active=el.dataset.scene===scene;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
 $('play').disabled=busy||!selected().length||!selected().some(s=>state[s.id].vol>0)||master===0;
 $('play').innerHTML=busy?'Loading…':dirty&&blobURL?'Apply changes <span aria-hidden="true">↻</span>':blobURL&&!player.paused?'Pause <span aria-hidden="true">Ⅱ</span>':blobURL?'Resume <span aria-hidden="true">&#9654;&#xFE0E;</span>':'Play <span aria-hidden="true">&#9654;&#xFE0E;</span>';
 $('stop').disabled=!blobURL&&!busy;$('restore').hidden=!read(FAVORITE);
 document.body.classList.toggle('playing',!!blobURL&&!player.paused);
 if(!deadline)$('timer-info').textContent=timer?'Fades out at the end':'Off';
}
function changed(){revision++;dirty=true;store(KEY,snapshot());updateUI();if(blobURL)status('Changed. Tap Apply changes to hear it.');}
for(const s of SOUNDS){
 const card=document.createElement('article');card.id='sound-'+s.id;card.className='sound-card';
 card.innerHTML=`<button class="sound-toggle" aria-label="${s.name}" aria-pressed="false"><span class="sound-top"><span class="selection-mark" aria-hidden="true">+</span></span><span class="sound-name">${s.name}</span><span class="sound-detail">${s.detail}</span></button><div class="level-row"><input type="range" min="0" max="100" value="${s.vol*100}" aria-label="${s.name} volume"><output>${s.vol*100}%</output></div>`;
 card.querySelector('button').onclick=()=>{state[s.id].on=!state[s.id].on;scene=null;changed();};
 card.querySelector('input').oninput=e=>{state[s.id].vol=Number(e.target.value)/100;scene=null;changed();};$('sounds').append(card);
}
for(const s of SCENES){const el=document.createElement('button');el.className='scene';el.dataset.scene=s.id;el.setAttribute('aria-pressed','false');el.innerHTML=`<strong>${s.title}</strong><small>${s.subtitle}</small>`;el.onclick=()=>chooseScene(s);$('scenes').append(el);}
function chooseScene(s){for(const sound of SOUNDS){state[sound.id].on=sound.id in s.mix;if(state[sound.id].on)state[sound.id].vol=s.mix[sound.id];}scene=s.id;changed();if(!blobURL)status('Ready. Press Play.');}
$('master').oninput=e=>{master=Number(e.target.value)/100;changed();};$('timer').onchange=e=>{timer=Number(e.target.value);changed();};
$('save').onclick=()=>{status(store(FAVORITE,snapshot())?'Mix saved on this device.':'This browser couldn’t save your mix.');updateUI();};
$('restore').onclick=()=>{restore(read(FAVORITE));changed();if(!blobURL)status('Saved mix loaded.');};
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
   status(`Loading… ${Math.round((k+1)/m.chunks*100)}%`);
 }
 if(mixer.stats.lowCorrelation||mixer.stats.wrapLags.some(Boolean))console.warn('Night Sounds: unexpected chunk alignment',mixer.stats);
 const blob=new Blob([NightAudio.wavHeader(m.loopFrames,2,rate),mixer.head(),...parts],{type:'audio/wav'});
 return{blob,rate,frames:m.loopFrames,channels:2,dataOffset:44};
}
// Start a media element in the original gesture for iOS audio-session unlocking.
const silentURL=URL.createObjectURL(new Blob([NightAudio.wav([new Float32Array(1600)],32000)],{type:'audio/wav'}));
async function play(){
 if(busy)return;
 if(blobURL&&!dirty){if(player.paused){try{await player.play();status('Playing.');}catch{status('Tap Play again to allow audio.');}}else{player.pause();status('Paused.');}updateUI();return;}
 if(!selected().length||master===0)return;
 const request=++token,version=revision,mix=JSON.parse(JSON.stringify(snapshot()));
 busy=true;updateUI();status('Loading…');
 if(renderAbort)renderAbort.abort();renderAbort=new AbortController();const signal=renderAbort.signal;
 if(!blobURL){player.src=silentURL;player.loop=true;player.play().catch(()=>{});}
 try{
   const result=await renderMix(mix,request,signal);if(request!==token)return;
   const old=blobURL;blobURL=URL.createObjectURL(result.blob);player.src=blobURL;player.loop=true;player.volume=1;renderedLoop=result;ending=false;
   if(old)URL.revokeObjectURL(old);
   deadline=mix.timer?Date.now()+mix.timer*60000:0;dirty=version!==revision;
   await player.play();setupMedia();startTimer();status(dirty?'Playing. Tap Apply changes to hear your edits.':mix.timer?'Playing. Timer set for '+mix.timer+' minutes.':'Playing all night. You can lock your phone.');
 }catch(error){if(request===token){if(!blobURL)player.pause();status(error.message==='cancelled'?'Stopped.':error.message||'Audio couldn’t start. Please try again.');}}
 finally{if(request===token){busy=false;updateUI();}}
}
function stop(message='Stopped.'){token++;busy=false;if(renderAbort){renderAbort.abort();renderAbort=null;}player.pause();player.removeAttribute('src');player.load();if(blobURL)URL.revokeObjectURL(blobURL);blobURL=null;renderedLoop=null;dirty=false;ending=false;deadline=0;clearInterval(timerTick);if('mediaSession'in navigator)navigator.mediaSession.playbackState='none';status(message);updateUI();}
$('play').onclick=play;$('stop').onclick=()=>stop();
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
 if(remaining<=0){stop('Timer finished.');return;}
 if(remaining<=60&&!ending&&!busy&&!player.paused&&renderedLoop){ending=true;finishWithFade(remaining).catch(()=>{ending=false;});}
}
function startTimer(){clearInterval(timerTick);timerTick=setInterval(checkTimer,1000);}
player.addEventListener('timeupdate',checkTimer);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkTimer();});
player.addEventListener('ended',()=>{if(ending)stop('Timer finished.');});
player.addEventListener('pause',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';updateUI();});
player.addEventListener('play',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';updateUI();});
player.addEventListener('error',()=>{if(blobURL){status('Playback was interrupted. Press Stop, then Play to rebuild your mix.');updateUI();}});
function setupMedia(){if(!('mediaSession'in navigator))return;navigator.mediaSession.metadata=new MediaMetadata({title:selected().map(s=>s.name).join(' + ')||'Night Sounds',artist:'Night Sounds',album:'Night Sounds',artwork:[{src:new URL('assets/night-sounds-icon-512.png',location.href).href,sizes:'512x512',type:'image/png'}]});for(const[action,handler]of Object.entries({play:()=>{player.play().catch(()=>status('Open the app and tap Resume.'));},pause:()=>player.pause(),stop:()=>stop()})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
// Breathing guide lives in breathe.js.
$('about-open').onclick=()=>$('about-dialog').showModal();document.querySelectorAll('#about-dialog .dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
updateUI();
