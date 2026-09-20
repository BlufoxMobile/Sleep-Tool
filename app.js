'use strict';
const $=id=>document.getElementById(id);
const PATHS={rain:'M4 15l-1 3m7-3-1 3m7-3-1 3M6 11a4 4 0 1 1 1-7 5 5 0 0 1 9 2 3 3 0 1 1 1 6H6',tent:'M2 20 12 3l10 17H2Zm6 0 4-8 4 8M5 4 4 6m14-3-1 2m4 3-1 2',thunder:'M13 10 8 16h5l-2 6 7-9h-5l2-3M5 13a4 4 0 1 1 1-8 5 5 0 0 1 9-1 4 4 0 0 1 4 7',wind:'M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 17h4a2 2 0 1 1-2 2',ocean:'M2 8q3-4 6 0t6 0 6 0M2 13q3-4 6 0t6 0 6 0M2 18q3-4 6 0t6 0 6 0',creek:'M3 4q14-1 8 5S6 14 15 16s7 5 1 6M14 3q9 4 2 7s-1 2 5 3',waterfall:'M3 5h7v13m4-13v10m4-10v13M2 21q3-3 6 0t6 0 6 0',fire:'M12 2c2 5 7 8 7 13a7 7 0 0 1-14 0c0-4 3-7 3-7s-1 6 2 6c3 0 3-5 2-12ZM10 20c-3-3 1-6 2-7 0 3 5 5 1 8',cricket:'M6 14q6-8 12 0M8 15l-5 5m13-5 5 5M9 11 6 6m9 5 3-5M8 15v5m8-5v5M3 11l3 1m12 0 3-1',frogs:'M6 10a3 3 0 1 1 5-2h2a3 3 0 1 1 5 2c6 7-1 11-6 11S0 17 6 10Zm2 4h.01M16 14h.01M8 17q4 3 8 0',train:'M5 16V6q0-4 7-4t7 4v10H5Zm0-6h14M8 16l-4 6m12-6 4 6M7 20h10M8 13h.01m8 0h.01',fan:'M12 12c-7-2-8-9-3-9 4 0 4 6 3 9Zm0 0c5-5 11-2 8 2-2 3-7 1-8-2Zm0 0c2 7-4 11-6 7-2-4 3-7 6-7Z',moon:'M19 16A9 9 0 0 1 8 3a9 9 0 1 0 11 13'};
const icon=id=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[id]||PATHS.moon}"/></svg>`;
const SOUNDS=[
 {id:'tentrain',name:'Rain on Tent',detail:'Soft patter on canvas',category:'water',icon:'tent',vol:.7},
 {id:'rain',name:'Summer Rain',detail:'A steady, open-air shower',category:'water',icon:'rain',vol:.6},
 {id:'ocean',name:'Ocean Waves',detail:'The shore, slowly breathing',category:'water',icon:'ocean',vol:.6},
 {id:'creek',name:'Forest Creek',detail:'Water over river stones',category:'water',icon:'creek',vol:.55},
 {id:'thunder',name:'Distant Thunder',detail:'Rain with rolling thunder',category:'nature',icon:'thunder',vol:.35},
 {id:'wind',name:'Forest Wind',detail:'Air moving through the trees',category:'nature',icon:'wind',vol:.5},
 {id:'fire',name:'Warm Campfire',detail:'Small flames & soft crackles',category:'comfort',icon:'fire',vol:.5},
 {id:'cricket',name:'Night Crickets',detail:'An unhurried evening chorus',category:'nature',icon:'cricket',vol:.4},
 {id:'frogs',name:'Evening Frogs',detail:'Calls across the night air',category:'nature',icon:'frogs',vol:.35},
 {id:'waterfall',name:'Waterfall',detail:'A soft curtain of water',category:'water',icon:'waterfall',vol:.45},
 {id:'train',name:'Night Train',detail:'The gentle rhythm of the rails',category:'comfort',icon:'train',vol:.5},
 {id:'fan',name:'Steady Fan',detail:'A familiar, even hum',category:'comfort',icon:'fan',vol:.55}
];
const SCENES=[
 {id:'tent',title:'Under Canvas',subtitle:'Rain on a quiet tent',icon:'tent',mix:{tentrain:.7},description:'A small shelter from the world.'},
 {id:'shore',title:'Tidal Quiet',subtitle:'Waves & a little wind',icon:'ocean',mix:{ocean:.65,wind:.16},description:'Let the shoreline come to you.'},
 {id:'camp',title:'After the Campfire',subtitle:'Embers & night crickets',icon:'fire',mix:{fire:.55,cricket:.22},description:'A warm glow. An open sky.'},
 {id:'rain',title:'Rainy Retreat',subtitle:'Rain & distant thunder',icon:'rain',mix:{rain:.65,thunder:.22},description:'A softer world outside your window.'},
 {id:'fan',title:'Familiar Comfort',subtitle:'A steady fan, nothing else',icon:'fan',mix:{fan:.65},description:'Simple, steady, and familiar.'}
];
const KEY='nightsounds-sanctuary-v2',FAVORITE=KEY+'-favorite';
const state=Object.fromEntries(SOUNDS.map(s=>[s.id,{on:s.id==='tentrain',vol:s.vol}]));
let master=.55,timer=0,scene='tent',revision=0,dirty=false,busy=false,token=0,context,blobURL,deadline=0,timerTick,breathTick,renderedLoop=null,ending=false;
const cache=new Map(),player=$('player');
function read(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function snapshot(){return{sounds:state,master,timer,scene};}
function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function restore(data){if(!data||!data.sounds)return;for(const s of SOUNDS){const d=data.sounds[s.id];if(d){state[s.id].on=d.on===true;state[s.id].vol=Number.isFinite(d.vol)?Math.max(0,Math.min(1,d.vol)):s.vol;}}master=Number.isFinite(data.master)?Math.max(0,Math.min(1,data.master)):.55;timer=[0,15,30,60,120].includes(data.timer)?data.timer:0;scene=SCENES.some(s=>s.id===data.scene)?data.scene:null;let count=0;for(const s of SOUNDS)if(state[s.id].on&&++count>4)state[s.id].on=false;}
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
 const card=document.createElement('article');card.id='sound-'+s.id;card.className='sound-card';card.dataset.category=s.category;
 card.innerHTML=`<button class="sound-toggle" aria-label="${s.name}" aria-pressed="false"><span class="sound-top">${icon(s.icon)}<span class="selection-mark" aria-hidden="true">+</span></span><span class="sound-name">${s.name}</span><span class="sound-detail">${s.detail}</span></button><div class="level-row"><input type="range" min="0" max="100" value="${s.vol*100}" aria-label="${s.name} volume"><output>${s.vol*100}%</output></div>`;
 card.querySelector('button').onclick=()=>{if(!state[s.id].on&&selected().length>=4){status('Keep your mix gentle: choose up to four sounds. Remove one to add another.');return;}state[s.id].on=!state[s.id].on;scene=null;changed();};
 card.querySelector('input').oninput=e=>{state[s.id].vol=Number(e.target.value)/100;scene=null;changed();};$('sounds').append(card);
}
for(const s of SCENES){const el=document.createElement('button');el.className='scene';el.dataset.scene=s.id;el.setAttribute('aria-pressed','false');el.innerHTML=`${icon(s.icon)}<strong>${s.title}</strong><small>${s.subtitle}</small>`;el.onclick=()=>chooseScene(s);$('scenes').append(el);}
function chooseScene(s){for(const sound of SOUNDS){state[sound.id].on=sound.id in s.mix;if(state[sound.id].on)state[sound.id].vol=s.mix[sound.id];}scene=s.id;changed();if(!blobURL)status('Scene ready. Press Play to settle in.');}
for(let i=0;i<45;i++){const bar=document.createElement('i');bar.style.cssText=`--h:${5+30*Math.abs(Math.sin(i*1.93))*Math.sin(Math.PI*(i+1)/46)}px;--delay:${-i*.17}s`;document.querySelector('.wave').append(bar);}
$('master').oninput=e=>{master=Number(e.target.value)/100;changed();};$('timer').onchange=e=>{timer=Number(e.target.value);changed();};
for(const el of document.querySelectorAll('[data-filter]'))el.onclick=()=>{document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});document.querySelectorAll('.sound-card').forEach(c=>c.hidden=el.dataset.filter!=='all'&&c.dataset.category!==el.dataset.filter);};
$('save').onclick=()=>{status(store(FAVORITE,snapshot())?'Your favorite mix is saved on this device.':'This browser couldn’t save your mix.');updateUI();};
$('restore').onclick=()=>{restore(read(FAVORITE));changed();if(!blobURL)status('Your saved mix is ready.');};
$('dim').onclick=()=>{const dim=document.body.classList.toggle('dimmed');$('dim').innerHTML=dim?'☀ <span>Bring back the light</span>':'☾ <span>Dim the lights</span>';$('dim').setAttribute('aria-pressed',String(dim));};
// No preview players, pitch changes, synthetic voices, or interval-based loop scheduling.
async function loadSound(sound,request){
 if(cache.has(sound.id))return cache.get(sound.id);
 status('Loading '+sound.name+'…');
 const response=await fetch('audio/'+sound.id+'.m4a');if(!response.ok)throw Error(sound.name+' couldn’t load. Check your connection and try again.');
 const decoded=await context.decodeAudioData(await response.arrayBuffer());
 if(request!==token)throw Error('cancelled');
 const channels=Array.from({length:decoded.numberOfChannels},(_,c)=>decoded.getChannelData(c));
 const loop=NightAudio.seamLoop(channels,decoded.sampleRate,sound.id==='tentrain'?2.5:8);
 const out=context.createBuffer(loop.length,loop[0].length,decoded.sampleRate);loop.forEach((c,i)=>out.copyToChannel(c,i));cache.set(sound.id,out);return out;
}
async function renderMix(mix,request){
 // Fixed sample rate bounds mobile memory; each source still preserves stereo.
 const rate=32000,seconds=180,fade=8,offline=new OfflineAudioContext(2,rate*(seconds+fade),rate);
 const active=SOUNDS.filter(s=>mix.sounds[s.id].on&&mix.sounds[s.id].vol>0);
 for(const key of cache.keys())if(!active.some(s=>s.id===key))cache.delete(key);
 for(const sound of active){
   const buffer=await loadSound(sound,request);if(request!==token)throw Error('cancelled');
   const source=offline.createBufferSource(),gain=offline.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=mix.sounds[sound.id].vol*mix.master;source.connect(gain).connect(offline.destination);source.start(0);
 }
 status('Blending your soundscape…');const rendered=await offline.startRendering();if(request!==token)throw Error('cancelled');
 const channels=NightAudio.seamLoop([rendered.getChannelData(0),rendered.getChannelData(1)],rate,fade);
 let peak=0;for(const c of channels)for(const x of c)peak=Math.max(peak,Math.abs(x));if(peak>.89)for(const c of channels)for(let i=0;i<c.length;i++)c[i]*=.89/peak;
 return{channels,rate,blob:new Blob([NightAudio.wav(channels,rate)],{type:'audio/wav'})};
}
// Start a media element in the original gesture for iOS audio-session unlocking.
const silentURL=URL.createObjectURL(new Blob([NightAudio.wav([new Float32Array(1600)],32000)],{type:'audio/wav'}));
async function play(){
 if(busy)return;
 if(blobURL&&!dirty){if(player.paused){try{await player.play();status('Playing. Settle in at your own pace.');}catch{status('Tap Play again to allow audio.');}}else{player.pause();status('Paused. Your mix is right here.');}updateUI();return;}
 if(!selected().length||master===0)return;
 const request=++token,version=revision,mix=JSON.parse(JSON.stringify(snapshot()));
 busy=true;updateUI();
 if(!context)context=new (window.AudioContext||window.webkitAudioContext)({sampleRate:32000});
 context.resume().catch(()=>{});
 if(!blobURL){player.src=silentURL;player.loop=true;player.play().catch(()=>{});}
 try{
   const result=await renderMix(mix,request);if(request!==token)return;
   const old=blobURL;blobURL=URL.createObjectURL(result.blob);player.src=blobURL;player.loop=true;player.volume=1;renderedLoop=result;ending=false;
   if(old)URL.revokeObjectURL(old);
   deadline=mix.timer?Date.now()+mix.timer*60000:0;dirty=version!==revision;
   await player.play();setupMedia();startTimer();status(dirty?'Playing. Your latest edits are waiting to be applied.':mix.timer?'Playing. Your timer is set for '+mix.timer+' minutes.':'Playing all night. You can now try locking your screen.');
 }catch(error){if(request===token){if(!blobURL)player.pause();status(error.message==='cancelled'?'Stopped.':error.message||'Audio couldn’t start. Please try again.');}}
 finally{if(request===token){busy=false;updateUI();}}
}
function stop(message='All sound stopped. Your mix is saved.'){token++;busy=false;player.pause();player.removeAttribute('src');player.load();if(blobURL)URL.revokeObjectURL(blobURL);blobURL=null;renderedLoop=null;dirty=false;ending=false;deadline=0;clearInterval(timerTick);if('mediaSession'in navigator)navigator.mediaSession.playbackState='none';status(message);updateUI();}
$('play').onclick=play;$('stop').onclick=()=>stop();$('hero-play').onclick=()=>{chooseScene(SCENES[0]);play();};
function checkTimer(){
 if(!deadline||!blobURL)return;const remaining=(deadline-Date.now())/1000;
 $('timer-info').textContent=remaining>0?Math.ceil(remaining/60)+' min left':'Finishing';
 if(remaining<=0){stop('Sleep timer finished. Rest well.');return;}
 // Bake the final fade into PCM: iOS ignores programmatic element volume.
 // This final, non-looping file stops itself even if JS is then suspended.
 if(remaining<=60&&!ending&&!busy&&!player.paused&&renderedLoop){
   ending=true;const {channels,rate}=renderedLoop,n=Math.floor(remaining*rate),offset=Math.floor(player.currentTime*rate),out=channels.map(src=>{const dst=new Float32Array(n);for(let i=0;i<n;i++)dst[i]=src[(offset+i)%src.length]*Math.cos(i/n*Math.PI/2);return dst;});
   const old=blobURL;blobURL=URL.createObjectURL(new Blob([NightAudio.wav(out,rate)],{type:'audio/wav'}));player.src=blobURL;player.loop=false;URL.revokeObjectURL(old);player.play().catch(()=>{status('Tap Resume to finish your timed session.');updateUI();});
 }
}
function startTimer(){clearInterval(timerTick);timerTick=setInterval(checkTimer,1000);}
player.addEventListener('timeupdate',checkTimer);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkTimer();});
player.addEventListener('ended',()=>{if(ending)stop('Sleep timer finished. Rest well.');});
player.addEventListener('pause',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';updateUI();});
player.addEventListener('play',()=>{if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';updateUI();});
player.addEventListener('error',()=>{if(blobURL){status('Playback was interrupted. Press Stop, then Play to rebuild your mix.');updateUI();}});
function setupMedia(){if(!('mediaSession'in navigator))return;navigator.mediaSession.metadata=new MediaMetadata({title:SCENES.find(s=>s.id===scene)?.title||'Your sanctuary',artist:'Night Sounds',album:'A little closer to quiet',artwork:[{src:new URL('assets/moon.svg',location.href).href,sizes:'48x48',type:'image/svg+xml'}]});for(const[action,handler]of Object.entries({play:()=>{player.play().catch(()=>status('Open the app and tap Resume.'));},pause:()=>player.pause(),stop:()=>stop()})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
const patterns={calm:[['Breathe in',4],['Breathe out',6]],box:[['Breathe in',4],['Hold',4],['Breathe out',4],['Hold',4]],'478':[['Breathe in',4],['Hold',7],['Breathe out',8]]};
function breathe(){clearInterval(breathTick);const start=Date.now(),steps=patterns[$('breath-pattern').value],total=steps.reduce((a,s)=>a+s[1],0);function tick(){let t=((Date.now()-start)/1000)%total;let phase=steps[0];for(const s of steps){if(t<s[1]){phase=s;break;}t-=s[1];}$('breath-phase').textContent=phase[0];$('breath-count').textContent=Math.ceil(phase[1]-t);const orb=document.querySelector('.breath-orb');if(phase[0]==='Breathe in')orb.style.transform=`scale(${.8+.2*t/phase[1]})`;if(phase[0]==='Breathe out')orb.style.transform=`scale(${1-.2*t/phase[1]})`;}tick();breathTick=setInterval(tick,100);}
$('breathe-open').onclick=()=>{$('breathe-dialog').showModal();breathe();};$('breath-pattern').onchange=breathe;$('breathe-dialog').addEventListener('close',()=>clearInterval(breathTick));$('about-open').onclick=()=>$('about-dialog').showModal();document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
updateUI();
