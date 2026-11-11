# Night Sounds

A static, privacy-minded rain mixer with an amber-on-black night interface
(no blue light) over a slow starfield, three rain recordings, presets, saved
mixes, a sleep screen that fades the page to near-black 10 seconds after sound
starts, and an optional breathing guide. No account or build step is required.

## Audio

Three sounds: **Rain on Tent**, **Summer Rain** and **Distant Thunder**. Each is
one seamless **6 minute 30 second** loop built offline from the original
public-domain field recording by `tools/master_audio.py`, so nothing repeats
sooner than 6.5 minutes. That holds for every mix too, because all three loops
have exactly the same length.

How the loops are made (details and numbers in `audio/v3/processing-report.json`):

- Only clean stretches of each recording are used. Passing cars, an idling
  engine, handling noise and the loudest close thunder are left out, a steady
  120 Hz mains hum (tent) and faint insect chirps (thunder) are notched out, and
  low thumps are limited.
- A slow multiband leveller (running median band levels, about 15 to 60 second
  windows, smoothed, so it never pumps) keeps loudness, tone and left/right
  balance the same from minute to minute. Thunder rolls are tamed with
  look-ahead compression so they swell in gently, never crack. In Summer Rain,
  the loudest drips near the window are softened.
- Segments are joined, and the loop is closed, with 20 second (11.5 second for the tent's
  internal join) correlation-aware equal-power crossfades between stretches
  that already match in level and tone. The loop is then levelled once more in
  circular mode, so even the gain curve wraps around.
- Measured at the seam: 2 s RMS within 0.5 dB of the surrounding minute, band
  levels within 1.7 dB and spectral centroid within 11%, no larger than the
  ordinary drop-to-drop variation. 30 s loudness stays within 0.9 dB over the
  whole loop.

Each loop ships as ten 39 second AAC-LC chunks (160 kbps, 32 kHz stereo,
about 8 MB per sound, 24 MB in all) in a versioned folder (`audio/v3/`) so
phones never replay a stale cached file. Every chunk carries 0.25 s of its
neighbours on each side. When you press Play, the app decodes one chunk at a
time, checks its alignment against the previous chunk by cross-correlation
(so AAC encoder priming and padding can never misalign a join), crossfades
the 64 ms of shared audio, mixes the selected sounds at their volumes and writes
16-bit PCM straight into a 390-second WAV (about 50 MB). It then loops that one
WAV through a single HTML audio element, which iOS keeps playing with the
screen locked. Per-sound volume, overall volume and the sleep-timer fade are
baked into the PCM because iOS ignores programmatic element volume. The page
never holds the whole loop as Float32: peak audio memory is roughly the WAV plus
one decoded chunk per sound (about 10 MB each), and about 50 MB more while Apply
changes replaces a playing mix.

To rebuild the audio: `python3 tools/master_audio.py` (downloads the originals
from the Internet Archive, verifies their MD5, needs ffmpeg with soxr, numpy
and scipy; `--source id=path` uses local copies, `--plots DIR` draws level
plots).

Play, pause, and Stop control the same player. Stop also cancels any unfinished
render so audio cannot unexpectedly resume. Changes while playing are staged
until **Apply changes**. Favorite mixes and current settings stay in localStorage;
saved mixes from older versions that name removed sounds are ignored (an empty
mix falls back to tent rain). Audio is fetched from this site; fonts use Google
Fonts. There are no analytics.

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
`audio-core.js` (testable chunk mixer, WAV and fade operations), `assets/` (icons), `audio/v3/` (loop chunks, `manifest.json`, `processing-report.json`)
and `tools/master_audio.py` (the mastering pipeline).

## Breathing guide

**Calm me now**, at the top of the page, starts a guided calm session with one tap:
a short count-in, about two minutes of cyclic physiological sighs (in through the
nose, a short top-up, then a long slow breath out), then slow 4-in / 6-out breathing.
There are no breath holds. When it finishes (or anytime) you can choose a 5-4-3-2-1
grounding walkthrough or keep breathing. Soft rising and falling tones generated with
Web Audio mark each in- and out-breath so you can keep your eyes closed; they play on
their own audio context on top of your sounds and never pause or change them.
**Take a breath** offers practice rhythms: Gentle 4/6, the physiological sigh, and Box
and 4-7-8 (marked for practice when you're already calm). The screen stays awake during
a session where the browser supports Wake Lock. Cue on/off, cue volume and the last
pattern are remembered on this device. It is a calming aid, not medical care: if
something feels different from your usual panic, call 911. Code: `breathe.js`,
`breathe.css`; the timing model is covered by `tests/breathe.test.cjs`.

## Sleep screen

About 10 seconds after sound starts with no interaction, the page fades to near-black,
leaving only the sound name, the timer and a Stop button. Tap anywhere to wake it.
The starfield pauses while it's dark. Code: `sleep-screen.js`, `starfield.js`.

## Validation

- `node --test tests/*.test.cjs`: chunk reassembly (sample-exact, including the
  wrap-around, untrimmed decoder priming and a mis-offset chunk), mixing gains
  and peak headroom, WAV encoding, the timer fade, and the shipped loops' seam
  and loudness measurements. If ffmpeg is installed, the real chunk files are
  decoded and run through the app's own mixer and the seams are measured again.
- Headless Chrome: every scene renders a 390-second, 32 kHz stereo WAV (in about
  2 s on a desktop) that loops with no level step at the wrap point or at any
  sound's seam. Play, pause, resume, Apply changes, Stop, the timer fade, saved
  mixes (including old saves naming removed sounds) and Media Session were
  checked, with no console errors. Layout was checked at 390 px and 1280 px.
- Actual overnight playback, whether iOS restarts a looping media element
  without a gap, and physical iOS/Android screen-lock behavior remain device
  acceptance tests, not completed claims.
