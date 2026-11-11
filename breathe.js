/* Night Sounds · breathing guide (owns breathe.js + breathe.css; injects its own markup).
   - "Calm me now" (#calm-now-root): one tap starts a guided calm session — a short count-in,
     cyclic physiological sighs, then slow 4-in / 6-out breathing (no holds) — and then offers
     5-4-3-2-1 grounding or more breathing.
   - "Take a breath" (#breathe-root): everyday practice patterns.
   Sound cues are synthesized with Web Audio on this file's own AudioContext and play on top of
   the rain. Nothing here touches the #player element or app.js state.
   The pure timing model at the top is exported for node tests (tests/breathe.test.cjs). */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------------------------------
     Timing model (pure: no DOM, no audio)
     ------------------------------------------------------------------------------------------ */

  const REST = 0.52; // orb scale with empty lungs; 1 = full
  const HZ = {Eb3: 155.56, F3: 174.61, A3: 220, Bb3: 233.08, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392};

  const CALM = {
    settle: 4,      // "Close your eyes when you're ready." (silent)
    countFrom: 3,   // then 3, 2, 1 — one second each, with a soft tick
    sighs: [        // cyclic physiological sighing: nose in, short top-up, long slow out
      {count: 2, inhale: 2.5, top: 1, exhale: 6},   // meet a fast breath partway first
      {count: 9, inhale: 3, top: 1.5, exhale: 7},
    ],
    slow: {count: 10, inhale: 4, exhale: 6, fade: [0.65, 0.8]},              // ~6 breaths a minute
    keep: {count: 12, inhale: 4, exhale: 6, fade: [0.4, 0.55, 0.7, 0.85]},   // "Keep breathing"
  };

  // One short, calm line at a time. [last breath number it applies to, text]
  const NOTES = {
    sigh: [
      [2, 'Two breaths in through your nose, then one long breath out.'],
      [4, 'You’re safe right now.'],
      [6, 'This feeling will pass.'],
      [8, 'You don’t have to do it perfectly.'],
      [Infinity, 'Let the breath out be long and slow.'],
    ],
    slow: [
      [2, 'Slower now. One easy breath in, a long breath out.'],
      [4, 'Nothing else to do right now.'],
      [6, 'Let your shoulders soften.'],
      [8, 'If your mind wanders, just come back.'],
      [Infinity, 'You’re doing it.'],
    ],
    keep: [
      [3, 'Nothing else to do right now.'],
      [6, 'You’re safe right now.'],
      [9, 'Let the breath out be long and slow.'],
      [Infinity, 'Let everything soften. You can rest here.'],
    ],
  };
  const noteFor = (list, n) => list.find(entry => n <= entry[0])[1];

  const PATTERNS = {
    gentle: {name: 'Gentle', detail: '4 in · 6 out', steps: [['in', 4], ['out', 6]],
      note: 'Slow and easy, about six breaths a minute. A good place to start.'},
    sigh: {name: 'Physiological sigh', detail: 'In · top-up · long out', steps: [['in', 3], ['top', 1.5], ['out', 7]],
      note: 'Two breaths in, one long breath out. Calm me now starts with this one.'},
    box: {name: 'Box', detail: '4 · hold 4 · 4 · hold 4', calmOnly: true, steps: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]],
      note: 'Has holds. Practice it when you’re already calm, not in a panic moment.'},
    '478': {name: '4-7-8', detail: 'In 4 · hold 7 · out 8', calmOnly: true, steps: [['in', 4], ['hold', 7], ['out', 8]],
      note: 'Has a long hold. Practice it when you’re already calm, not in a panic moment. If you feel lightheaded, stop and breathe normally.'},
  };

  const PATTERN_ORDER = ['gentle', 'sigh', 'box', '478']; // object keys like '478' would sort first

  const GROUNDING = [
    {n: 5, sense: 'see', title: '5 things you can see', hint: 'Even shapes in the dark: a light, an edge, a shadow.', hz: HZ.G4},
    {n: 4, sense: 'feel', title: '4 things you can feel', hint: 'The pillow, the blanket, your feet, the air.', hz: HZ.E4},
    {n: 3, sense: 'hear', title: '3 things you can hear', hint: 'The rain counts. So does your own breath.', hz: HZ.D4},
    {n: 2, sense: 'smell', title: '2 things you can smell', hint: 'Or two smells you like, remembered.', hz: HZ.C4},
    {n: 1, sense: 'taste', title: '1 thing you can taste', hint: 'Even just your own mouth.', hz: HZ.A3},
  ];

  function sequence() {
    const segs = [];
    let t = 0;
    return {
      segs,
      add(seg) { segs.push(Object.assign({start: t}, seg)); t += seg.dur; },
    };
  }

  function slowBreaths(s, section, cfg, notes) {
    for (let n = 1; n <= cfg.count; n++) {
      const level = (cfg.fade || [])[cfg.count - n] || 1;   // fade[0] = last breath
      const note = noteFor(notes, n), first = n === 1 && section === 'slow';
      s.add({type: 'in', section, breath: n, dur: cfg.inhale, label: 'Breathe in', hint: first ? 'one easy breath, no top-up' : '',
        note, from: REST, to: 0.95, cue: {kind: 'in', f0: HZ.F3, f1: HZ.Bb3, level}});
      s.add({type: 'out', section, breath: n, dur: cfg.exhale, label: 'Breathe out', hint: first ? 'slow and easy' : '',
        note, from: 0.95, to: REST, cue: {kind: 'out', f0: HZ.Bb3, f1: HZ.Eb3, level}});
    }
  }

  /** The full "Calm me now" session as contiguous segments (seconds from session start). */
  function calmPlan() {
    const s = sequence(), say = 'Close your eyes when you’re ready.';
    s.add({type: 'settle', section: 'countin', dur: CALM.settle, label: say, from: REST, to: REST});
    for (let n = CALM.countFrom; n >= 1; n--) {
      s.add({type: 'count', section: 'countin', count: n, dur: 1, label: say, from: REST, to: REST, cue: {kind: 'tick'}});
    }
    let n = 0;
    for (const block of CALM.sighs) {
      for (let i = 0; i < block.count; i++) {
        n++;
        const first = n <= 2, note = noteFor(NOTES.sigh, n);
        s.add({type: 'in', section: 'sigh', breath: n, dur: block.inhale, label: 'Breathe in', hint: first ? 'through your nose' : '',
          note, from: REST, to: 0.86, cue: {kind: 'in', f0: HZ.F3, f1: HZ.A3}});
        s.add({type: 'top', section: 'sigh', breath: n, dur: block.top, label: 'A little more', hint: first ? 'top it up' : '',
          note, from: 0.86, to: 1, cue: {kind: 'top', f0: HZ.A3, f1: HZ.C4}});
        s.add({type: 'out', section: 'sigh', breath: n, dur: block.exhale, label: 'Long, slow out', hint: first ? 'like a sigh' : '',
          note, from: 1, to: REST, cue: {kind: 'out', f0: HZ.C4, f1: HZ.Eb3}});
      }
    }
    slowBreaths(s, 'slow', CALM.slow, NOTES.slow);
    s.add({type: 'end', section: 'end', dur: 0, from: REST, to: REST, cue: {kind: 'end', level: 1}});
    return s.segs;
  }

  /** "Keep breathing": two more minutes of 4-in / 6-out with cues fading over the last breaths. */
  function keepPlan() {
    const s = sequence();
    slowBreaths(s, 'keep', CALM.keep, NOTES.keep);
    s.add({type: 'end', section: 'end', dur: 0, from: REST, to: REST, cue: {kind: 'end', level: 0.6}});
    return s.segs;
  }

  /** Practice pattern: a 3-2-1 count-in followed by a repeating cycle. */
  function practicePlan(id) {
    const p = PATTERNS[id] || PATTERNS.gentle, intro = sequence(), cycle = sequence();
    const sigh = p.steps.some(step => step[0] === 'top');
    for (let n = 3; n >= 1; n--) intro.add({type: 'count', count: n, dur: 1, label: 'Get comfortable', from: REST, to: REST, cue: {kind: 'tick'}});
    let scale = REST, pitch = HZ.F3;
    for (const [kind, dur] of p.steps) {
      if (kind === 'in') {
        const to = sigh ? 0.86 : 0.95, f1 = sigh ? HZ.A3 : HZ.Bb3;
        cycle.add({type: 'in', dur, label: 'Breathe in', from: scale, to, cue: {kind: 'in', f0: HZ.F3, f1}});
        scale = to; pitch = f1;
      } else if (kind === 'top') {
        cycle.add({type: 'top', dur, label: 'A little more', from: scale, to: 1, cue: {kind: 'top', f0: pitch, f1: HZ.C4}});
        scale = 1; pitch = HZ.C4;
      } else if (kind === 'out') {
        cycle.add({type: 'out', dur, label: 'Breathe out', from: scale, to: REST, cue: {kind: 'out', f0: pitch, f1: HZ.Eb3}});
        scale = REST; pitch = HZ.F3;
      } else {
        cycle.add({type: 'hold', dur, label: 'Hold', from: scale, to: scale, cue: {kind: 'tick', level: 0.6}});
      }
    }
    return {intro: intro.segs, cycle: cycle.segs};
  }

  /** A playable track: finite intro segments, optionally followed by a cycle that repeats forever. */
  function makeTrack(intro, cycle) {
    cycle = cycle || [];
    const span = list => list.length ? list[list.length - 1].start + list[list.length - 1].dur : 0;
    const introLen = span(intro), cycleLen = span(cycle);
    const place = (seg, i, loop, offset) => Object.assign({}, seg, {
      index: i, loop, key: (loop < 0 ? 'i' : loop + ':') + i, start: seg.start + offset, end: seg.start + offset + seg.dur,
    });
    const pick = (list, local) => {
      for (let i = 0; i < list.length; i++) if (list[i].dur > 0 && local < list[i].start + list[i].dur) return i;
      return -1;
    };
    return {
      introLen, cycleLen, total: cycleLen ? Infinity : introLen,
      /** The segment playing at time t (seconds since the track started). */
      at(t) {
        const tt = Math.max(0, t);
        if (tt < introLen) {
          const i = pick(intro, tt);
          if (i >= 0) return place(intro[i], i, -1, 0);
        }
        if (!cycleLen) return {done: true, type: 'done', key: 'done', start: introLen, end: introLen, dur: 0, from: REST, to: REST};
        const local = tt - introLen, k = Math.floor(local / cycleLen);
        let i = pick(cycle, local - k * cycleLen);
        if (i < 0) i = cycle.length - 1;
        return place(cycle[i], i, k, introLen + k * cycleLen);
      },
      /** Segments that start in [a, b) — used to schedule sound cues ahead of time. */
      between(a, b) {
        const out = [];
        intro.forEach((seg, i) => { if (seg.start >= a && seg.start < b) out.push(place(seg, i, -1, 0)); });
        if (cycleLen && b > introLen) {
          const k0 = Math.max(0, Math.floor((a - introLen) / cycleLen)), k1 = Math.floor((b - introLen) / cycleLen);
          for (let k = k0; k <= k1; k++) {
            cycle.forEach((seg, i) => {
              const st = introLen + k * cycleLen + seg.start;
              if (st >= a && st < b) out.push(place(seg, i, k, introLen + k * cycleLen));
            });
          }
        }
        return out;
      },
    };
  }

  const ease = x => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  /** Orb scale for a segment at time t: eases from seg.from to seg.to over the segment. */
  function orbScale(seg, t) {
    if (!seg || seg.done || !(seg.dur > 0)) return REST;
    return seg.from + (seg.to - seg.from) * ease((t - seg.start) / seg.dur);
  }

  const api = {REST, HZ, CALM, NOTES, PATTERNS, PATTERN_ORDER, GROUNDING, calmPlan, keepPlan, practicePlan, makeTrack, orbScale, ease};
  root.NightBreathe = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------------------------------
     Browser UI
     ------------------------------------------------------------------------------------------ */

  const calmRoot = document.getElementById('calm-now-root');
  const breatheRoot = document.getElementById('breathe-root');
  if (!calmRoot && !breatheRoot) return;

  const LOOKAHEAD = 2.5; // seconds of cues scheduled ahead on the AudioContext clock

  // Per-viewer preferences (localStorage can be missing or throw; defaults always work).
  const PREFIX = 'nightsounds-breathe-';
  function load(key, fallback) {
    try { const v = localStorage.getItem(PREFIX + key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(PREFIX + key, String(value)); } catch (e) { /* not saved */ } }
  const storedVolume = Number(load('volume', 35)), storedPattern = load('pattern', 'gentle');
  const settings = {
    sound: load('sound', 'on') !== 'off',
    volume: Number.isFinite(storedVolume) ? Math.min(100, Math.max(0, Math.round(storedVolume))) : 35,
    pattern: Object.prototype.hasOwnProperty.call(PATTERNS, storedPattern) ? storedPattern : 'gentle',
  };

  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(motionQuery && motionQuery.matches);

  /* ---------- Screen wake lock: keep the phone awake during a session ---------- */
  const wake = {
    want: false, sentinel: null, pending: false, attempts: 0, error: '',
    acquire() {
      this.want = true;
      if (this.sentinel || this.pending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
      this.attempts++;
      this.pending = true;
      let request;
      try { request = navigator.wakeLock.request('screen'); } catch (e) { this.pending = false; this.error = e.name || String(e); return; }
      request.then(sentinel => {
        this.pending = false; this.error = '';
        if (!this.want) { sentinel.release().catch(() => {}); return; }
        this.sentinel = sentinel;
        sentinel.addEventListener('release', () => { if (this.sentinel === sentinel) this.sentinel = null; });
      }, err => { this.pending = false; this.error = (err && err.name) || String(err); });
    },
    release() {
      this.want = false;
      const s = this.sentinel;
      this.sentinel = null;
      if (s) s.release().catch(() => {});
    },
  };

  /* ---------- Sound cues (Web Audio, own context, layered over the rain) ---------- */
  const Cues = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, bus = null, noiseBuffer = null, sleepTimer = 0;
    const voices = new Set(), log = [], listeners = [];
    const gainFor = v => (v <= 0 ? 0 : 0.55 * Math.pow(v / 100, 2));

    // iOS 17+: in 'auto', Web Audio alone follows the ringer switch. 'playback' keeps cues audible
    // in silent mode. The rain <audio> element already runs as playback media, so this matches the
    // category it is using rather than switching away from it. Never changed back mid-night.
    function preferPlayback() {
      try {
        const session = navigator.audioSession;
        if (session && session.type === 'auto') session.type = 'playback';
      } catch (e) { /* unsupported */ }
    }

    /** Create or resume the context. Call from inside a user tap (iOS requirement). */
    function ensure() {
      if (!AC) return false;
      clearTimeout(sleepTimer);
      preferPlayback();
      if (!ctx) {
        try { ctx = new AC({latencyHint: 'playback'}); } catch (e) { try { ctx = new AC(); } catch (e2) { return false; } }
        bus = ctx.createGain();
        bus.gain.value = gainFor(settings.volume);
        bus.connect(ctx.destination);
        ctx.onstatechange = () => listeners.forEach(fn => fn(ctx.state));
        try { // a silent one-sample buffer inside the gesture unlocks output on older iOS
          const src = ctx.createBufferSource();
          src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          src.connect(ctx.destination);
          src.start(0);
        } catch (e) { /* ignore */ }
      } else {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setValueAtTime(gainFor(settings.volume), ctx.currentTime);
      }
      if (ctx.state !== 'running') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    }

    function noise() {
      if (!noiseBuffer) {
        const length = Math.floor(ctx.sampleRate * 2);
        noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      return noiseBuffer;
    }

    function keep(voice) {
      voices.add(voice);
      voice.sources[0].onended = () => {
        voices.delete(voice);
        try { voice.out.disconnect(); } catch (e) { /* already gone */ }
      };
      return voice;
    }

    // Envelope shapes as [fraction of duration, fraction of peak]; linear ramps between points.
    const SHAPES = {
      in: [[0, 0], [0.18, 0.36], [0.55, 0.72], [0.84, 1], [0.94, 0.5], [1, 0]],   // swell, peaking late
      top: [[0, 0], [0.35, 0.72], [0.72, 0.92], [1, 0]],                          // short, a little higher
      out: [[0, 0], [0.07, 0.92], [0.16, 1], [0.45, 0.66], [0.75, 0.3], [1, 0]],  // long fall
    };
    const BRIGHT = {in: [800, 1900], top: [1700, 2400], out: [2200, 650]};          // low-pass sweep (Hz)

    // A soft "breath": sine + quiet octave triangle + band-passed noise, gliding in pitch and
    // brightness, under a slow envelope. Warm and low; no sharp attack anywhere.
    function breath(cue, when, dur) {
      const level = cue.level == null ? 1 : cue.level, bright = BRIGHT[cue.kind];
      const env = ctx.createGain(), lowpass = ctx.createBiquadFilter();
      env.gain.value = 0;
      lowpass.type = 'lowpass';
      lowpass.Q.value = 0.4;
      lowpass.connect(env);
      env.connect(bus);
      const sine = ctx.createOscillator(), tri = ctx.createOscillator(), triGain = ctx.createGain();
      sine.type = 'sine';
      tri.type = 'triangle';
      triGain.gain.value = 0.3;
      sine.connect(lowpass);
      tri.connect(triGain);
      triGain.connect(lowpass);
      const air = ctx.createBufferSource(), band = ctx.createBiquadFilter(), airGain = ctx.createGain();
      air.buffer = noise();
      air.loop = true;
      band.type = 'bandpass';
      band.Q.value = 0.8;
      airGain.gain.value = 1.1;
      air.connect(band);
      band.connect(airGain);
      airGain.connect(lowpass);
      const glide = (param, a, b) => { param.setValueAtTime(a, when); param.exponentialRampToValueAtTime(b, when + dur); };
      glide(sine.frequency, cue.f0, cue.f1);
      glide(tri.frequency, cue.f0 * 2, cue.f1 * 2);
      glide(band.frequency, bright[0] * 0.7, bright[1] * 0.7);
      glide(lowpass.frequency, bright[0], bright[1]);
      const shape = SHAPES[cue.kind], peak = 0.62 * level;
      env.gain.setValueAtTime(0, when);
      for (let i = 1; i < shape.length; i++) env.gain.linearRampToValueAtTime(shape[i][1] * peak, when + shape[i][0] * dur);
      const end = when + dur + 0.05;
      sine.start(when); tri.start(when); air.start(when, Math.random() * 1.5);
      sine.stop(end); tri.stop(end); air.stop(end);
      return keep({start: when, end, out: env, gain: env.gain, sources: [sine, tri, air]});
    }

    // A soft wooden "tock" for the count-in and practice holds.
    function tick(when, level) {
      const env = ctx.createGain(), a = ctx.createOscillator(), b = ctx.createOscillator(), bGain = ctx.createGain();
      a.type = 'sine'; b.type = 'sine';
      a.frequency.setValueAtTime(HZ.E4 * 1.2, when);
      a.frequency.exponentialRampToValueAtTime(HZ.E4, when + 0.06);
      b.frequency.setValueAtTime(HZ.E4 * 2, when);
      bGain.gain.value = 0.35;
      a.connect(env); b.connect(bGain); bGain.connect(env); env.connect(bus);
      const peak = 0.42 * (level == null ? 1 : level);
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(peak, when + 0.012);
      env.gain.exponentialRampToValueAtTime(peak * 0.004, when + 0.3);
      env.gain.linearRampToValueAtTime(0, when + 0.34);
      a.start(when); b.start(when); a.stop(when + 0.38); b.stop(when + 0.38);
      return keep({start: when, end: when + 0.38, out: env, gain: env.gain, sources: [a, b]});
    }

    // A small, warm bell (grounding steps, session end).
    function bell(when, hz, level) {
      const env = ctx.createGain(), lowpass = ctx.createBiquadFilter(), sources = [];
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 2400;
      env.connect(lowpass);
      lowpass.connect(bus);
      env.gain.value = 0.34 * (level == null ? 1 : level);
      [[1, 1, 2.6], [2, 0.3, 1.3], [2.76, 0.09, 0.7]].forEach(([ratio, amp, decay]) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz * ratio;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp, when + 0.015);
        g.gain.exponentialRampToValueAtTime(amp * 0.001, when + decay);
        osc.connect(g);
        g.connect(env);
        osc.start(when);
        osc.stop(when + decay + 0.05);
        sources.push(osc);
      });
      return keep({start: when, end: when + 2.7, out: env, gain: env.gain, sources});
    }

    function play(seg, when) {
      if (!ctx || !seg.cue) return;
      const cue = seg.cue;
      if (cue.kind === 'tick') tick(when, cue.level);
      else if (cue.kind === 'end') { bell(when, HZ.C4, 0.8 * cue.level); bell(when + 0.5, HZ.F3, 0.7 * cue.level); }
      else breath(cue, when, seg.dur);
      log.push({kind: cue.kind, type: seg.type, when: +when.toFixed(4), session: seg.start, dur: seg.dur, scheduledAt: +ctx.currentTime.toFixed(4)});
      if (log.length > 80) log.shift();
    }

    /** Stop every cue that has not finished: future ones never start, sounding ones fade fast. */
    function cancel() {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const voice of Array.from(voices)) {
        if (voice.start > now + 0.02) {
          voice.sources.forEach(src => { try { src.stop(0); } catch (e) { /* ignore */ } });
          try { voice.out.disconnect(); } catch (e) { /* ignore */ }
          voices.delete(voice);
          continue;
        }
        let current = 0;
        try { current = voice.gain.value; } catch (e) { /* ignore */ }
        voice.gain.cancelScheduledValues(now);
        voice.gain.setValueAtTime(current, now);
        voice.gain.linearRampToValueAtTime(0, now + 0.08);
        voice.sources.forEach(src => { try { src.stop(now + 0.1); } catch (e) { /* ignore */ } });
      }
    }

    return {
      ensure, play, cancel,
      ctx: () => ctx,
      state: () => (ctx ? ctx.state : 'none'),
      running: () => !!ctx && ctx.state === 'running',
      latency: () => (ctx ? Math.min(0.4, Math.max(0, (ctx.baseLatency || 0) + (ctx.outputLatency || 0))) : 0),
      onState: fn => listeners.push(fn),
      log,
      pending: () => voices.size,
      tick(level) { if (this.running()) tick(ctx.currentTime + 0.01, level); },
      bell(hz, level) { if (this.running()) bell(ctx.currentTime + 0.02, hz, level); },
      setVolume(v) { if (ctx && bus) bus.gain.setTargetAtTime(gainFor(v), ctx.currentTime, 0.04); },
      /** Fade out, cancel, and suspend shortly after (saves battery between sessions). */
      sleep() {
        if (!ctx) return;
        cancel();
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        clearTimeout(sleepTimer);
        sleepTimer = setTimeout(() => { if (ctx.state === 'running') ctx.suspend().catch(() => {}); }, 450);
      },
    };
  })();

  /* ---------- One clock for sound and sight ----------
     While the AudioContext runs, session time is AudioContext.currentTime (cues are scheduled on
     it and the orb is drawn from it). Without sound, or while the context is suspended, it falls
     back to performance.now(). Switching re-anchors so session time never jumps. */
  const clock = {
    src: 'perf', anchorSession: 0, anchorRaw: 0,
    raw() { return this.src === 'audio' ? Cues.ctx().currentTime : performance.now() / 1000; },
    now() { return this.anchorSession + (this.raw() - this.anchorRaw); },
    use(src) {
      if (src === this.src) return false;
      const t = this.now();
      this.src = src;
      this.anchorRaw = this.raw();
      this.anchorSession = t;
      return true;
    },
    toCtx(sessionTime) { return this.anchorRaw + (sessionTime - this.anchorSession); },
    lag() { return this.src === 'audio' ? Cues.latency() : 0; },
  };
  clock.anchorRaw = clock.anchorSession = performance.now() / 1000;

  let active = null; // the runner currently playing (only one dialog is open at a time)
  Cues.onState(state => {
    if (clock.use(state === 'running' ? 'audio' : 'perf') && active) active.resync();
  });

  /** Plays a track: schedules cues ahead on the audio clock and reports segment changes. */
  function createRunner(track, hooks, lead) {
    const runner = {
      track, t0: clock.now() + lead, cursor: -Infinity, key: null, cur: null, t: 0, stopped: false, done: false,
      rawT() { return clock.now() - this.t0; },
      visT() { return this.rawT() - clock.lag(); },
      pump() {
        if (this.stopped) return;
        // Follow the audio clock whenever the context runs (statechange is not always fired).
        if (clock.use(Cues.running() ? 'audio' : 'perf')) this.resync();
        const raw = this.rawT();
        if (settings.sound && clock.src === 'audio' && Cues.running()) {
          const from = Math.max(this.cursor, raw - 0.15), horizon = raw + LOOKAHEAD;
          if (horizon > from) {
            for (const seg of this.track.between(from, horizon)) if (seg.cue) Cues.play(seg, clock.toCtx(this.t0 + seg.start));
            this.cursor = horizon;
          }
        } else {
          this.cursor = raw - 0.15;
        }
        const t = this.visT(), cur = this.track.at(t);
        this.t = t;
        this.cur = cur;
        if (cur.key !== this.key) {
          this.key = cur.key;
          if (hooks.segment) hooks.segment(cur);
        }
        if (cur.done && !this.done) {
          this.done = true;
          if (hooks.done) hooks.done();
        }
      },
      /** After a clock switch or seek: drop queued cues and schedule again from now. */
      resync() { Cues.cancel(); this.cursor = this.rawT(); },
      seek(seconds) { this.t0 -= seconds; this.resync(); this.pump(); },
      stop() { this.stopped = true; clearInterval(this.timer); },
    };
    runner.timer = setInterval(() => runner.pump(), 100); // keeps scheduling when frames are throttled
    runner.pump();
    return runner;
  }

  function animate(ctl) {
    cancelAnimationFrame(ctl.raf);
    const frame = () => {
      const r = ctl.runner;
      if (!r || r.stopped) return;
      r.pump();
      if (!r.stopped) ctl.draw();
      ctl.raf = requestAnimationFrame(frame);
    };
    ctl.raf = requestAnimationFrame(frame);
  }

  function drawOrb(core, seg, t) {
    const s = orbScale(seg, t), fill = (s - REST) / (1 - REST);
    if (reducedMotion()) { // no movement: the glow brightens and dims instead
      core.style.transform = 'scale(0.8)';
      core.style.opacity = (0.3 + 0.7 * fill).toFixed(3);
    } else {
      core.style.transform = 'scale(' + s.toFixed(4) + ')';
      core.style.opacity = (0.6 + 0.4 * fill).toFixed(3);
    }
  }

  function setText(el, text) { if (el.textContent !== String(text)) el.textContent = text; }

  function announcer(el) {
    let last = '';
    return text => {
      if (!text || text === last) return;
      last = text;
      el.textContent = text;
    };
  }

  /* ---------- Markup ---------- */
  const ICON_ON = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4"/>';
  const ICON_OFF = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>';
  const soundControls = () => `<div class="bx-sound">
      <button type="button" class="bx-pill bx-sound-toggle" data-bx-sound aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_ON}</svg><span>Sound cues</span></button>
      <input type="range" class="bx-volume" data-bx-volume min="0" max="100" step="5" value="35" aria-label="Cue volume">
    </div>`;
  const orb = extra => `<div class="bx-orb" aria-hidden="true"><span class="bx-orb-ring"></span><span class="bx-orb-core"></span>${extra}</div>`;

  /* ---------- Shared sound controls ---------- */
  function syncSound() {
    document.querySelectorAll('[data-bx-sound]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(settings.sound));
      btn.querySelector('svg').innerHTML = settings.sound ? ICON_ON : ICON_OFF;
    });
    document.querySelectorAll('[data-bx-volume]').forEach(range => {
      range.value = settings.volume;
      range.disabled = !settings.sound;
      range.setAttribute('aria-valuetext', settings.volume + '%');
    });
  }
  function bindSound(scope, onToggle) {
    scope.querySelector('[data-bx-sound]').addEventListener('click', () => {
      settings.sound = !settings.sound;
      save('sound', settings.sound ? 'on' : 'off');
      if (settings.sound) Cues.ensure(); else Cues.cancel();
      syncSound();
      if (onToggle) onToggle();
    });
    const range = scope.querySelector('[data-bx-volume]');
    range.addEventListener('input', () => {
      settings.volume = Number(range.value);
      Cues.setVolume(settings.volume);
      range.setAttribute('aria-valuetext', settings.volume + '%');
    });
    range.addEventListener('change', () => {
      save('volume', settings.volume);
      syncSound();
      if (settings.sound) { Cues.ensure(); Cues.tick(0.8); } // a quiet sample of the new level
    });
  }

  /* ---------- "Calm me now" ---------- */
  const calm = {dlg: null, els: {}, view: 'breathe', runner: null, raf: 0, opener: null, total: 1, mode: 'main', noteTimer: 0};

  function buildCalm() {
    calmRoot.innerHTML = `<button type="button" class="bx-now" id="bx-calm-open" aria-haspopup="dialog">
      <span class="bx-now-orb" aria-hidden="true"><i></i></span>
      <span class="bx-now-text"><strong>Calm me now</strong><span>Guided breathing with soft sound cues. Starts right away.</span></span>
      <span class="bx-now-go" aria-hidden="true">→</span>
    </button>
    <dialog id="bx-calm" class="bx-dialog" aria-labelledby="bx-calm-title" tabindex="-1">
      <div class="bx-calm-wrap">
        <div class="bx-bar">${soundControls()}<button type="button" class="bx-pill bx-end" data-bx-close>End <span aria-hidden="true">×</span></button></div>
        <div class="bx-progress" aria-hidden="true"><i></i></div>
        <h2 id="bx-calm-title" class="bx-sr">Calm breathing</h2>
        <section class="bx-view" data-view="breathe">
          ${orb('<span class="bx-orb-num"></span>')}
          <div class="bx-words"><p class="bx-say"></p><p class="bx-hint"></p></div>
          <p class="bx-note"></p>
          <button type="button" class="bx-pill bx-quiet" data-bx-ground>Ground me instead</button>
        </section>
        <section class="bx-view" data-view="choice" hidden>
          <p class="bx-title bx-choice-title" tabindex="-1"></p>
          <p class="bx-sub bx-choice-sub"></p>
          <div class="bx-choices">
            <button type="button" class="bx-big" data-bx-ground><strong>Ground me</strong><span>Five senses, one at a time</span></button>
            <button type="button" class="bx-big" data-bx-keep><strong>Keep breathing</strong><span>Two more minutes, then a soft fade</span></button>
            <button type="button" class="bx-big" data-bx-close data-bx-closebig hidden><strong>Close</strong><span>Back to your sounds</span></button>
          </div>
          <button type="button" class="bx-pill bx-quiet" data-bx-close data-bx-closequiet>I’m okay, close</button>
        </section>
        <section class="bx-view" data-view="ground" hidden>
          <ol class="bx-steps" aria-hidden="true">${GROUNDING.map(g => `<li>${g.n}</li>`).join('')}</ol>
          <p class="bx-title bx-ground-title" tabindex="-1"></p>
          <p class="bx-sub bx-ground-hint"></p>
          <button type="button" class="bx-pad"><span class="bx-dots"></span><span class="bx-pad-label">Tap for each one</span></button>
          <button type="button" class="bx-pill bx-quiet" data-bx-next>Next sense</button>
        </section>
        <p class="bx-safety">If this feels different from your usual panic — chest pain, or breathing trouble that isn’t easing — <a href="tel:911">call 911</a>.</p>
        <p class="bx-sr" aria-live="polite" data-bx-live></p>
      </div>
    </dialog>`;
    const dlg = calm.dlg = calmRoot.querySelector('#bx-calm'), q = sel => dlg.querySelector(sel);
    calm.els = {
      core: q('.bx-orb-core'), num: q('.bx-orb-num'), say: q('.bx-say'), hint: q('.bx-hint'), note: q('.bx-note'),
      bar: q('.bx-progress i'), progress: q('.bx-progress'),
      choiceTitle: q('.bx-choice-title'), choiceSub: q('.bx-choice-sub'),
      groundBig: q('.bx-choices [data-bx-ground]'), closeBig: q('[data-bx-closebig]'), closeQuiet: q('[data-bx-closequiet]'),
      groundTitle: q('.bx-ground-title'), groundHint: q('.bx-ground-hint'), steps: dlg.querySelectorAll('.bx-steps li'),
      pad: q('.bx-pad'), dots: q('.bx-dots'),
    };
    calm.announce = announcer(q('[data-bx-live]'));
    calmRoot.querySelector('#bx-calm-open').addEventListener('click', e => openCalm(e.currentTarget));
    dlg.querySelectorAll('[data-bx-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
    dlg.querySelectorAll('[data-bx-ground]').forEach(b => b.addEventListener('click', startGrounding));
    q('[data-bx-keep]').addEventListener('click', keepBreathing);
    q('[data-bx-next]').addEventListener('click', () => grounding.next());
    calm.els.pad.addEventListener('click', () => grounding.tap());
    bindSound(dlg, () => { if (calm.view === 'breathe') calmSegment(calm.runner && calm.runner.cur, true); });
    dlg.addEventListener('close', teardownCalm);
    dlg.addEventListener('pointerdown', resumeIfNeeded);
  }

  // Any tap inside a session re-arms audio and the wake lock if iOS dropped them.
  function resumeIfNeeded() {
    if (settings.sound && !Cues.running()) Cues.ensure();
    if (wake.want && !wake.sentinel) wake.acquire();
  }

  function openCalm(opener) {
    if (calm.dlg.open) return;
    calm.opener = opener;
    if (settings.sound) Cues.ensure(); // inside the tap, before anything async (iOS)
    wake.acquire();
    syncSound();
    calm.dlg.showModal();
    try { calm.dlg.focus({preventScroll: true}); } catch (e) { /* ignore */ }
    calmBreathe(calmPlan(), 'main');
  }

  function haltCalm() {
    if (calm.runner) {
      calm.runner.stop();
      if (active === calm.runner) active = null;
      calm.runner = null;
    }
    cancelAnimationFrame(calm.raf);
  }

  function showCalmView(view) {
    calm.view = view;
    calm.dlg.querySelectorAll('[data-view]').forEach(sec => { sec.hidden = sec.dataset.view !== view; });
    calm.els.progress.style.visibility = view === 'breathe' ? 'visible' : 'hidden';
  }

  function calmBreathe(segs, mode) {
    haltCalm();
    calm.mode = mode;
    const track = makeTrack(segs);
    calm.total = track.total;
    calm.els.note.textContent = '';
    showCalmView('breathe');
    calm.runner = active = createRunner(track, {segment: seg => calmSegment(seg), done: calmFinished}, 0.1);
    calm.draw();
    animate(calm);
  }

  calm.draw = function () {
    const r = calm.runner;
    if (!r || !r.cur) return;
    drawOrb(calm.els.core, r.cur, r.t);
    calm.els.bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, r.t / calm.total)).toFixed(4) + ')';
  };

  function calmSegment(seg, refreshOnly) {
    if (!seg || seg.done) return;
    const e = calm.els, intro = seg.type === 'settle' || seg.type === 'count';
    setText(e.say, seg.label);
    setText(e.hint, intro
      ? (settings.sound ? 'Rising sound: breathe in. Falling sound: breathe out.' : 'Circle grows: breathe in. Circle shrinks: breathe out.')
      : seg.hint || '');
    setText(e.num, seg.type === 'count' ? seg.count : '');
    if (!refreshOnly) {
      setNote(seg.note || '');
      if (seg.type !== 'count') calm.announce(seg.label);
    }
  }

  function setNote(text) {
    const el = calm.els.note;
    if (el.dataset.text === text) return;
    el.dataset.text = text;
    clearTimeout(calm.noteTimer);
    if (reducedMotion() || !el.textContent) { el.textContent = text; el.style.opacity = ''; return; }
    el.style.opacity = '0';
    calm.noteTimer = setTimeout(() => { el.textContent = text; el.style.opacity = ''; }, 600);
  }

  function calmFinished() {
    haltCalm();
    wake.release(); // nothing is timed now; let the phone sleep normally if he drifts off
    showChoice('breathed');
  }

  function showChoice(kind) {
    const e = calm.els, grounded = kind === 'grounded';
    e.choiceTitle.textContent = grounded ? 'You’re right here.' : 'You stayed with it.';
    e.choiceSub.textContent = grounded ? 'In this room, right now. Take all the time you need.' : 'Take your time. What would help now?';
    e.groundBig.hidden = grounded;
    e.closeBig.hidden = !grounded;
    e.closeQuiet.hidden = grounded;
    showCalmView('choice');
    calm.announce(e.choiceTitle.textContent);
    try { e.choiceTitle.focus({preventScroll: true}); } catch (err) { /* ignore */ }
  }

  function keepBreathing() {
    if (settings.sound) Cues.ensure();
    wake.acquire();
    calmBreathe(keepPlan(), 'keep');
  }

  function startGrounding() {
    haltCalm();
    Cues.cancel();
    if (settings.sound) Cues.ensure();
    wake.acquire();
    showCalmView('ground');
    grounding.start();
  }

  const grounding = {
    step: 0, found: 0, timer: 0,
    start() {
      clearTimeout(this.timer);
      this.step = 0;
      this.found = 0;
      this.render(true);
      try { calm.els.groundTitle.focus({preventScroll: true}); } catch (e) { /* ignore */ }
    },
    tap() {
      const g = GROUNDING[this.step];
      if (!g || this.found >= g.n) return;
      if (settings.sound) Cues.tick(0.5);
      this.found++;
      this.render(false);
      if (this.found >= g.n) this.timer = setTimeout(() => this.next(), 700);
    },
    next() {
      clearTimeout(this.timer);
      const g = GROUNDING[this.step];
      if (!g) return;
      if (settings.sound) Cues.bell(g.hz, 0.8); // one soft chime per step
      this.step++;
      this.found = 0;
      if (this.step >= GROUNDING.length) {
        wake.release();
        showChoice('grounded');
        return;
      }
      this.render(true);
    },
    render(newStep) {
      const g = GROUNDING[this.step], e = calm.els;
      if (!g) return;
      if (newStep) {
        e.groundTitle.textContent = g.title;
        e.groundHint.textContent = g.hint;
        e.dots.innerHTML = '<i></i>'.repeat(g.n);
        e.steps.forEach((li, i) => { li.className = i < this.step ? 'is-done' : i === this.step ? 'is-now' : ''; });
        calm.announce(g.title);
      }
      e.dots.querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('on', i < this.found));
      e.pad.setAttribute('aria-label', `I noticed one. ${this.found} of ${g.n} so far.`);
      e.pad.disabled = this.found >= g.n;
    },
  };

  function teardownCalm() {
    haltCalm();
    clearTimeout(grounding.timer);
    clearTimeout(calm.noteTimer);
    Cues.sleep();
    wake.release();
    calm.view = 'closed';
    if (calm.opener && document.contains(calm.opener)) {
      try { calm.opener.focus({preventScroll: true}); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- "Take a breath" practice ---------- */
  const practice = {dlg: null, els: {}, runner: null, raf: 0, opener: null, shown: ''};

  function buildPractice() {
    const chip = id => {
      const p = PATTERNS[id];
      return `<label class="bx-chip"><input type="radio" name="bx-pattern" value="${id}"><span class="bx-chip-body">
        <strong>${p.name}</strong><small>${p.detail}</small>${p.calmOnly ? '<em>When calm</em>' : ''}</span></label>`;
    };
    breatheRoot.innerHTML = `<section class="bx-card" aria-labelledby="bx-card-title">
      <div class="bx-card-orb" aria-hidden="true"><i></i></div>
      <div class="bx-card-copy"><p class="eyebrow">EVERYDAY PRACTICE</p><h2 id="bx-card-title">Take a breath.</h2>
        <p>Gentle rhythms with soft sound cues, so your eyes can stay closed.</p></div>
      <button type="button" class="bx-outline" id="bx-practice-open" aria-haspopup="dialog">Take a breath <span aria-hidden="true">↗</span></button>
    </section>
    <dialog id="bx-practice" class="bx-dialog" aria-labelledby="bx-practice-title" tabindex="-1">
      <button type="button" class="bx-x" data-bx-close aria-label="Close breathing practice">×</button>
      <p class="eyebrow">TAKE YOUR TIME</p>
      <h2 id="bx-practice-title">Nothing to do but breathe.</h2>
      ${orb('<span class="bx-orb-text"><span class="bx-orb-label"></span><strong class="bx-orb-count"></strong></span>')}
      <fieldset class="bx-patterns"><legend>Your rhythm</legend>
        <div class="bx-chips">${PATTERN_ORDER.map(chip).join('')}</div>
      </fieldset>
      <p class="bx-pattern-note"></p>
      <div class="bx-bar bx-bar-practice">${soundControls()}</div>
      <p class="bx-foot">Your sounds keep playing. In a hard moment, use <strong>Calm me now</strong> at the top of the page. It has no holds.</p>
      <p class="bx-sr" aria-live="polite" data-bx-live></p>
    </dialog>`;
    const dlg = practice.dlg = breatheRoot.querySelector('#bx-practice'), q = sel => dlg.querySelector(sel);
    practice.els = {core: q('.bx-orb-core'), label: q('.bx-orb-label'), count: q('.bx-orb-count'), note: q('.bx-pattern-note')};
    practice.announce = announcer(q('[data-bx-live]'));
    breatheRoot.querySelector('#bx-practice-open').addEventListener('click', e => openPractice(e.currentTarget));
    q('[data-bx-close]').addEventListener('click', () => dlg.close());
    dlg.querySelectorAll('input[name="bx-pattern"]').forEach(input => input.addEventListener('change', () => {
      settings.pattern = input.value;
      save('pattern', input.value);
      syncPattern();
      if (settings.sound) Cues.ensure();
      Cues.cancel();
      startPractice();
    }));
    bindSound(dlg);
    dlg.addEventListener('close', teardownPractice);
    dlg.addEventListener('pointerdown', resumeIfNeeded);
  }

  function syncPattern() {
    practice.dlg.querySelectorAll('input[name="bx-pattern"]').forEach(input => { input.checked = input.value === settings.pattern; });
    const p = PATTERNS[settings.pattern];
    practice.els.note.textContent = p.note;
    practice.els.note.classList.toggle('is-caution', !!p.calmOnly);
  }

  function openPractice(opener) {
    if (practice.dlg.open) return;
    practice.opener = opener;
    if (settings.sound) Cues.ensure();
    wake.acquire();
    syncSound();
    syncPattern();
    practice.dlg.showModal();
    try { practice.dlg.focus({preventScroll: true}); } catch (e) { /* ignore */ }
    startPractice();
  }

  function haltPractice() {
    if (practice.runner) {
      practice.runner.stop();
      if (active === practice.runner) active = null;
      practice.runner = null;
    }
    cancelAnimationFrame(practice.raf);
  }

  function startPractice() {
    haltPractice();
    const plan = practicePlan(settings.pattern);
    practice.runner = active = createRunner(makeTrack(plan.intro, plan.cycle), {
      segment: seg => { setText(practice.els.label, seg.label); practice.announce(seg.label); },
    }, 0.25);
    practice.draw();
    animate(practice);
  }

  practice.draw = function () {
    const r = practice.runner;
    if (!r || !r.cur) return;
    const seg = r.cur;
    drawOrb(practice.els.core, seg, r.t);
    setText(practice.els.count, seg.type === 'count' ? seg.count : Math.max(1, Math.ceil(seg.end - r.t - 1e-6)));
  };

  function teardownPractice() {
    haltPractice();
    Cues.sleep();
    wake.release();
    if (practice.opener && document.contains(practice.opener)) {
      try { practice.opener.focus({preventScroll: true}); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- Page lifecycle ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (wake.want) wake.acquire();                  // the lock is dropped whenever the page is hidden
    if (active && settings.sound && !Cues.running()) Cues.ensure();
  });

  if (calmRoot) buildCalm();
  if (breatheRoot) buildPractice();
  syncSound();

  // Inspection hooks for tests and debugging (no effect unless called).
  api.debug = {
    seek(seconds) { if (active) active.seek(seconds); },
    dropWakeLock() { if (wake.sentinel) wake.sentinel.release(); }, // as the OS does when the page hides
    info() {
      const r = active, ctx = Cues.ctx();
      return {
        calmView: calm.dlg && calm.dlg.open ? calm.view : 'closed', mode: calm.mode,
        practiceOpen: !!(practice.dlg && practice.dlg.open),
        t: r ? r.t : null, segment: r && r.cur ? {type: r.cur.type, label: r.cur.label, start: r.cur.start, end: r.cur.end, key: r.cur.key} : null,
        runnerT0Ctx: r && clock.src === 'audio' ? clock.toCtx(r.t0) : null,
        clock: clock.src, ctxState: Cues.state(), ctxTime: ctx ? ctx.currentTime : null, sampleRate: ctx ? ctx.sampleRate : null,
        audioSession: navigator.audioSession ? navigator.audioSession.type : 'unsupported',
        wake: {want: wake.want, held: !!wake.sentinel, attempts: wake.attempts, error: wake.error},
        settings: Object.assign({}, settings), grounding: {step: grounding.step, found: grounding.found},
        cues: Cues.log.slice(), voices: Cues.pending(),
      };
    },
  };
})(typeof window === 'undefined' ? globalThis : window);
