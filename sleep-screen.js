/* Night Sounds sleep screen.
   About 10 seconds after sound starts playing with no interaction, the page
   fades to near-black. Only what is playing, the sleep-timer countdown and a
   Stop button stay, all very dim. Tap anywhere (or press a key) to wake.

   Self-contained: needs only <script src="sleep-screen.js" defer>. It reads the
   page (selected sounds, active scene, #timer-info), listens to #player events,
   and clicks #stop. Any element with id="sleep-now" or [data-sleep-screen]
   turns the sleep screen on by hand. It dispatches a "sleepscreen" event on
   document ({detail:{active}}) and sets .sleep-screen-on on <html> so other
   scripts (the starfield) can pause. Colours come from --sleep-* tokens. */
(function () {
  'use strict';
  if (window.SleepScreen) return;

  const IDLE_MS = 10000;
  const SHIFT_MS = 60000;   // nudge the dim text now and then (OLED burn-in)
  const root = document.documentElement;
  const player = document.getElementById('player');

  const style = document.createElement('style');
  style.id = 'sleep-screen-style';
  style.textContent = [
    '.sleep-screen{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;',
    'padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom));',
    'background:var(--sleep-bg,#000);color:var(--sleep-ink,#6b4519);opacity:0;',
    'transition:opacity .35s ease;touch-action:none;overscroll-behavior:contain;',
    '-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;cursor:default}',
    '.sleep-screen.is-on{opacity:1;transition:opacity var(--sleep-fade,3.2s) cubic-bezier(.4,0,.2,1)}',
    '.sleep-screen[hidden]{display:none}',
    '.sleep-screen__inner{display:flex;flex-direction:column;align-items:center;text-align:center;',
    'max-width:22rem;transform:translate(var(--sleep-x,0),var(--sleep-y,0));opacity:0;transition:opacity .2s}',
    // the page goes dark first; the dim readout comes up once it is nearly black
    '.sleep-screen.is-on .sleep-screen__inner{opacity:1;transition:opacity 1.4s ease calc(var(--sleep-fade,3.2s) * .8)}',
    '.sleep-screen__name{margin:0;font:700 clamp(1.75rem,7vw,2.75rem)/1.08 var(--display,system-ui,sans-serif);',
    'letter-spacing:-.025em;text-wrap:balance}',
    '.sleep-screen__timer{margin:.6rem 0 0;min-height:1.5em;font:500 1.0625rem/1.5 var(--sans,system-ui,sans-serif);',
    'font-variant-numeric:tabular-nums}',
    '.sleep-screen__stop{margin-top:2.75rem;min-width:8.5rem;min-height:3rem;padding:0 1.75rem;border-radius:999px;',
    'border:1px solid var(--sleep-dim,#3d2810);background:transparent;color:var(--sleep-ink,#6b4519);',
    'font:600 1rem/1 var(--sans,system-ui,sans-serif);cursor:pointer}',
    '.sleep-screen__stop:focus-visible{outline:2px solid var(--sleep-ink,#6b4519);outline-offset:4px}',
    '.sleep-screen__hint{margin:1.75rem 0 0;font:500 .8125rem/1.4 var(--sans,system-ui,sans-serif);',
    'color:var(--sleep-dim,#3d2810)}',
    '@media (prefers-reduced-motion:reduce){.sleep-screen{--sleep-fade:1s}}'
  ].join('');
  document.head.appendChild(style);

  const touch = !window.matchMedia || window.matchMedia('(hover: none)').matches;
  const screen = document.createElement('div');
  screen.id = 'sleep-screen';
  screen.className = 'sleep-screen';
  screen.hidden = true;
  screen.tabIndex = -1;
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-label', 'Sleep screen');
  screen.innerHTML =
    '<div class="sleep-screen__inner">' +
    '<p class="sleep-screen__name"></p>' +
    '<p class="sleep-screen__timer" aria-live="off"></p>' +
    '<button type="button" class="sleep-screen__stop">Stop</button>' +
    '<p class="sleep-screen__hint">' + (touch ? 'Tap anywhere to wake' : 'Click anywhere or press a key to wake') + '</p>' +
    '</div>';
  document.body.appendChild(screen);
  const nameEl = screen.querySelector('.sleep-screen__name');
  const timerEl = screen.querySelector('.sleep-screen__timer');
  const stopEl = screen.querySelector('.sleep-screen__stop');

  let active = false, idleTimer = 0, shiftTimer = 0, hideTimer = 0;
  let pointerDown = false, bodyPlayingSeen = document.body.classList.contains('playing');
  let inerted = [];

  // ----- reading the page -------------------------------------------------
  function isPlaying() {
    if (!player || player.paused || player.ended) return false;
    // app.js marks <body class="playing"> once the real mix (not the silent
    // unlock clip) is playing; trust it once we've seen it used.
    return bodyPlayingSeen ? document.body.classList.contains('playing') : true;
  }

  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

  function currentName() {
    const names = [];
    document.querySelectorAll('.sound-card.selected .sound-name, #sounds [aria-pressed="true"] .sound-name').forEach(function (el) {
      const name = text(el);
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    if (names.length && names.length <= 2) return names.join(' + ');   // "Rain on Tent"
    const scene = text(document.querySelector('.scene.active strong, .scene[aria-pressed="true"] strong'));
    if (scene) return scene;
    if (names.length) return names.join(' + ');
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    return (meta && meta.title) || 'Night Sounds';
  }

  function timerText() {
    const info = text(document.getElementById('timer-info'));
    return /\d|finish/i.test(info) ? info : '';   // e.g. "42 min left", "Finishing"
  }

  function dialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  // ----- rendering --------------------------------------------------------
  function render() {
    const playing = isPlaying();
    nameEl.textContent = playing ? currentName() : 'Sound off';
    timerEl.textContent = playing ? timerText() : '';
    stopEl.hidden = !playing;
  }

  function shift() {
    screen.style.setProperty('--sleep-x', Math.round((Math.random() - 0.5) * 24) + 'px');
    screen.style.setProperty('--sleep-y', Math.round((Math.random() - 0.5) * 48) + 'px');
  }

  function announce() {
    root.classList.toggle('sleep-screen-on', active);
    document.dispatchEvent(new CustomEvent('sleepscreen', { detail: { active: active } }));
  }

  function setInert(on) {
    if (on) {
      inerted = Array.prototype.filter.call(document.body.children, function (el) {
        return el !== screen && !el.inert && !/^(SCRIPT|STYLE|AUDIO|DIALOG)$/.test(el.tagName);
      });
      inerted.forEach(function (el) { el.inert = true; });
    } else {
      inerted.forEach(function (el) { el.inert = false; });
      inerted = [];
    }
  }

  // ----- state ------------------------------------------------------------
  function engage(byHand) {
    clearTimeout(idleTimer); idleTimer = 0;
    if (active || dialogOpen()) return;
    active = true;
    clearTimeout(hideTimer);
    render();
    shift();
    screen.hidden = false;
    void screen.offsetWidth;            // let the fade start from 0
    screen.classList.add('is-on');
    setInert(true);
    if (byHand) screen.focus({ preventScroll: true });
    shiftTimer = setInterval(shift, SHIFT_MS);
    announce();
  }

  function wake() {
    if (!active) return;
    active = false;
    clearInterval(shiftTimer); shiftTimer = 0;
    screen.classList.remove('is-on');
    setInert(false);
    hideTimer = setTimeout(function () { if (!active) screen.hidden = true; }, 400);
    announce();
    arm();
  }

  function arm() {
    clearTimeout(idleTimer); idleTimer = 0;
    if (active || !isPlaying()) return;
    idleTimer = setTimeout(tryEngage, IDLE_MS);
  }

  function tryEngage() {
    idleTimer = 0;
    if (!isPlaying() || active) return;
    if (document.hidden || pointerDown || dialogOpen()) { idleTimer = setTimeout(tryEngage, 2000); return; }
    engage(false);
  }

  function changed() {
    if (active) render(); else arm();
  }

  // ----- events -----------------------------------------------------------
  if (player) ['playing', 'play', 'pause', 'ended', 'emptied', 'abort'].forEach(function (type) {
    player.addEventListener(type, changed);
  });

  new MutationObserver(function () {
    if (document.body.classList.contains('playing')) bodyPlayingSeen = true;
    changed();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const timerInfo = document.getElementById('timer-info');
  if (timerInfo) new MutationObserver(function () { if (active) render(); })
    .observe(timerInfo, { childList: true, characterData: true, subtree: true });

  // Any interaction with the page restarts the 10-second countdown.
  ['pointerdown', 'keydown', 'wheel', 'input', 'change'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (type === 'pointerdown') pointerDown = true;
      if (!active) { arm(); return; }
      if (type === 'keydown' && event.key !== 'Tab' && !(event.target === stopEl && (event.key === 'Enter' || event.key === ' '))) {
        event.preventDefault();
        wake();
      }
    }, { capture: true, passive: type !== 'keydown' });
  });
  ['pointerup', 'pointercancel'].forEach(function (type) {
    document.addEventListener(type, function () { pointerDown = false; }, true);
  });

  screen.addEventListener('click', function (event) {
    if (!active) return;
    if (event.target.closest('.sleep-screen__stop')) {
      const stop = document.getElementById('stop');
      if (stop && !stop.disabled) stop.click();
      else if (player) player.pause();
      render();
      return;
    }
    wake();
  });

  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('#sleep-now, [data-sleep-screen]')) engage(true);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !active) arm();
  });

  window.SleepScreen = {
    engage: function () { engage(true); },
    wake: wake,
    get active() { return active; }
  };
  changed();
})();
