/* Breathing guide (stub carried over from app.js; to be rebuilt). Injects its own markup. */
(function(){
'use strict';
const root=document.getElementById('breathe-root');
if(!root)return;
root.innerHTML=`<section class="breathe-card"><div class="breath-symbol" aria-hidden="true">◎</div><div><p class="eyebrow">ONE LAST EXHALE</p><h2>Let the day soften.</h2><p>A gentle breathing rhythm to settle into your sounds.</p></div><button id="breathe-open" class="outline-button">Take a breath <span>↗</span></button></section>
<dialog id="breathe-dialog" aria-labelledby="breath-heading"><button class="dialog-close" aria-label="Close breathing guide">×</button><p class="eyebrow">TAKE YOUR TIME</p><h2 id="breath-heading">Nothing to do but breathe.</h2><div class="breath-orb"><span id="breath-phase">Breathe in</span><strong id="breath-count">4</strong></div><label for="breath-pattern">Your rhythm</label><select id="breath-pattern"><option value="calm">Gentle · 4 in, 6 out</option><option value="box">Box · 4 in, 4 hold, 4 out, 4 hold</option><option value="478">4–7–8 · in, hold, out</option></select><p class="muted">Follow a comfortable rhythm. Your sounds keep playing.</p></dialog>`;
const $=id=>document.getElementById(id);
const patterns={calm:[['Breathe in',4],['Breathe out',6]],box:[['Breathe in',4],['Hold',4],['Breathe out',4],['Hold',4]],'478':[['Breathe in',4],['Hold',7],['Breathe out',8]]};
let breathTick;
function breathe(){clearInterval(breathTick);const start=Date.now(),steps=patterns[$('breath-pattern').value],total=steps.reduce((a,s)=>a+s[1],0);function tick(){let t=((Date.now()-start)/1000)%total;let phase=steps[0];for(const s of steps){if(t<s[1]){phase=s;break;}t-=s[1];}$('breath-phase').textContent=phase[0];$('breath-count').textContent=Math.ceil(phase[1]-t);const orb=document.querySelector('.breath-orb');if(phase[0]==='Breathe in')orb.style.transform=`scale(${.8+.2*t/phase[1]})`;if(phase[0]==='Breathe out')orb.style.transform=`scale(${1-.2*t/phase[1]})`;}tick();breathTick=setInterval(tick,100);}
$('breathe-open').onclick=()=>{$('breathe-dialog').showModal();breathe();};$('breath-pattern').onchange=breathe;
$('breathe-dialog').addEventListener('close',()=>clearInterval(breathTick));
$('breathe-dialog').querySelector('.dialog-close').onclick=()=>$('breathe-dialog').close();
})();
