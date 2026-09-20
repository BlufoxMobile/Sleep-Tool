# Night Sounds · Your sanctuary

A static, privacy-minded ambient mixer with a midnight-green interface, original
lake illustration, scene presets, twelve natural recordings, saved mixes, a dim
view, and an optional breathing guide. No account or build step is required.

## Audio

Ten recordings now use roughly three-minute excerpts from their original
public-domain field recordings. Tent rain and campfire retain the original
43-second assets. All sounds play at their natural pitch and pace: no detuned
duplicate voices and no randomly chopped animal calls. Extended recordings are
stereo AAC at 192 kbps / 32 kHz, level-matched to −24 dBFS RMS with gentle transient
softening. The 32 kHz playback rate bounds mobile memory; this is not a lossless
or full-bandwidth archival library. Source details are in [CREDITS.md](CREDITS.md).

Up to four selected sounds load on demand. Each is crossfaded back into itself
with a correlation-aware equal-power blend (8 seconds, 2.5 seconds for tent rain).
This avoids both a hard seam and a correlated-signal volume swell. The mixer
renders a three-minute stereo WAV in memory, checks peak headroom, then loops it
through one HTML audio element. The recordings and the rendered mix still
repeat; crossfades reduce detectable joins but cannot guarantee imperceptible
repetition for every recording or gapless media-element looping on every browser.

Play, pause, and Stop control the same player. Stop also cancels any unfinished
render so audio cannot unexpectedly resume. Changes while playing are staged
until **Apply changes**. Favorite mixes and current settings stay in localStorage.
Audio is fetched from this site; fonts use Google Fonts. There are no analytics.

## Sleep timers and phones

All-night mode has no automatic stop. Keep the tab open. Media Session controls
are provided where supported. Test screen locking on your actual phone before
relying on an overnight session: calls, OS memory/battery policies, browser audio
policies, and tab closure can interrupt playback.

Timed sessions use a wall-clock deadline (time continues while paused). During
the last minute, the app replaces the looping mix with a finite PCM fade-out;
this avoids relying on programmatic volume, which iOS may ignore. If the browser
suspends JavaScript before that transition, the timer may run late and the fade
may be skipped. A native app or pre-rendered full-length session would be needed
for stronger background timing guarantees. Changing timer settings while playing
requires Apply changes and starts a new session deadline.

## Run and check

```sh
python3 -m http.server 8000
# Open http://localhost:8000
node --test tests/*.test.cjs
```

GitHub Pages can continue serving the repository root. No deployment framework
or external audio service is needed.

Files: `index.html` (markup), `styles.css` (design), `app.js` (controls and playback),
`audio-core.js` (testable sample operations), `assets/` (original SVG artwork), and
`audio/` (bundled recordings).

## Validation

- Automated checks: seam continuity, correlated-crossfade level, short/mono/stereo
  input, silence, WAV encoding and peak headroom.
- Desktop browser: selected scene renders to a 180-second looping media file;
  play, pause, resume, Stop, saved settings and breathing dialog verified.
- Responsive layout inspected at 390px; no horizontal page overflow.
- Actual overnight playback and physical iOS/Android screen-lock behavior remain
  device acceptance tests, not completed claims.
