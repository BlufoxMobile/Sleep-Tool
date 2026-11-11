/* Night Sounds starfield.
   A dim, warm sky turning slowly around a pole just off the top-right corner.
   One canvas behind the page, redrawn about 8 times a second. It stops when the
   tab is hidden or the sleep screen is on, and draws a single still frame under
   prefers-reduced-motion. Needs only <script src="starfield.js" defer>.
   Star colours come from --star-1/--star-2/--star-3 on :root when present. */
(function () {
  'use strict';
  if (window.NightSky) return;

  const FPS = 8;
  const TURN_SECONDS = 9000;      // one full turn of the sky every 2.5 hours
  const AREA_PER_STAR = 2400;     // CSS px² per star (≈140 stars on a phone)
  const MAX_DPR = 2;

  const canvas = document.createElement('canvas');
  canvas.className = 'starfield';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100vh;height:100lvh;' +
    'z-index:-1;pointer-events:none;display:block';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let width = 0, height = 0, dpr = 1, poleX = 0, poleY = 0;
  let stars = null, sprites = [], loop = 0, running = false, sleeping = false;

  // Deterministic sky: same stars on every visit.
  function random(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Accepts #rrggbb tokens only (the sprite gradient appends alpha digits).
  function token(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  // One soft dot per colour, drawn once and stamped for every star.
  function makeSprites() {
    const colours = [token('--star-1', '#f2a93b'), token('--star-2', '#ffbf73'), token('--star-3', '#e0713a')];
    sprites = colours.map(function (colour) {
      const size = 32, sprite = document.createElement('canvas');
      sprite.width = sprite.height = size;
      const g = sprite.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, colour);
      grad.addColorStop(0.22, colour);
      grad.addColorStop(0.42, colour + '55');
      grad.addColorStop(1, colour + '00');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return sprite;
    });
  }

  // Stars live in polar coordinates around the pole, uniformly spread over a
  // disc that always covers the viewport as it turns.
  function makeStars() {
    const reach = Math.hypot(Math.max(poleX, width - poleX), height - poleY) + 40;
    const count = Math.min(9000, Math.round(Math.PI * reach * reach / AREA_PER_STAR));
    if (stars && stars.reach >= reach) return;
    const rand = random(1017);
    const data = new Float32Array(count * 7);
    for (let i = 0; i < count; i++) {
      const o = i * 7, pick = rand();
      data[o] = reach * Math.sqrt(rand());               // radius
      data[o + 1] = rand() * Math.PI * 2;                // angle
      data[o + 2] = 0.9 + 3.4 * Math.pow(rand(), 5);     // drawn size, CSS px
      data[o + 3] = 0.16 + 0.5 * Math.pow(rand(), 2.2);  // base alpha
      data[o + 4] = pick < 0.55 ? 0 : pick < 0.85 ? 1 : 2; // colour
      data[o + 5] = rand() < 0.35 ? 0.25 + rand() * 0.45 : 0; // twinkle depth
      data[o + 6] = rand() * 1000;                       // twinkle phase
    }
    stars = { data: data, count: count, reach: reach };
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (w === width && h === height && canvas.width === Math.round(w * dpr)) return;
    width = w; height = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    poleX = width * 0.88;
    poleY = -Math.min(height, width) * 0.08;
    makeStars();
    draw();
  }

  function draw() {
    if (!stars || !sprites.length) return;
    const now = Date.now() / 1000;
    const turn = -((now % TURN_SECONDS) / TURN_SECONDS) * Math.PI * 2; // counter-clockwise
    const still = motion.matches;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const d = stars.data;
    for (let i = 0; i < stars.count; i++) {
      const o = i * 7, r = d[o], a = d[o + 1] + turn;
      const x = poleX + r * Math.cos(a), y = poleY + r * Math.sin(a);
      const s = d[o + 2];
      if (x < -s || y < -s || x > width + s || y > height + s) continue;
      let alpha = d[o + 3];
      if (d[o + 5] && !still) alpha *= 1 - d[o + 5] * (0.5 + 0.5 * Math.sin(now * (0.35 + (d[o + 6] % 1)) + d[o + 6]));
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[d[o + 4]], x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    loop = 0;
    if (!running) return;
    draw();
    loop = setTimeout(function () { window.requestAnimationFrame(tick); }, 1000 / FPS);
  }

  function update() {
    const shouldRun = !document.hidden && !sleeping && !motion.matches;
    if (shouldRun && !running) { running = true; tick(); }
    else if (!shouldRun && running) { running = false; clearTimeout(loop); loop = 0; }
    if (!shouldRun && !document.hidden && !sleeping) draw(); // reduced motion: one still frame
  }

  let resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  document.addEventListener('visibilitychange', update);
  document.addEventListener('sleepscreen', function (event) {
    sleeping = !!(event.detail && event.detail.active);
    update();
  });
  if (motion.addEventListener) motion.addEventListener('change', update);

  sleeping = document.documentElement.classList.contains('sleep-screen-on');
  makeSprites();
  resize();
  update();

  window.NightSky = { redraw: draw, get running() { return running; } };
})();
