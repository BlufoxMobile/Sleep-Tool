# Night Sounds (Sleep-Tool)

A tiny, single-page ambient sound mixer for falling asleep. Layer real field
recordings — rain, ocean, thunder, wind, campfire, creek, crickets — set a
sleep timer, then start screen-off playback and lock your phone.

Earlier versions synthesized the sounds with oscillators and noise, which sounded
thin and digital. This version uses **real CC0 / public-domain field recordings**,
processed into seamless loops and bundled with the app.

## How it works

- All seven sounds are genuine field recordings, normalized and trimmed to
  matched 43-second clips (AAC `.m4a`, ~600 KB each, ~4 MB total).
- The browser decodes each clip and builds a **seamless 40-second loop in
  JavaScript** using an equal-power self-crossfade. Because the loop boundary is
  constructed from adjacent samples of the original recording, there is no click
  or gap on repeat — regardless of the audio codec's padding.
- Live preview layers the loops through the Web Audio API.
- **Screen-off mode** renders your current mix into a single seamless WAV loop
  and plays it through an `<audio>` element, so playback survives screen lock and
  appears on the lock screen (with a sleep-timer fade-out option).

Nothing streams from a third party and nothing is tracked — the audio ships with
the page and is decoded locally.

## Running it

This is a static site, but it must be **served over http(s)** (the app `fetch`es
the audio files, which most browsers block from a `file://` page).

- **GitHub Pages:** push this repo, then enable Pages (Settings → Pages → deploy
  from `main` / root). Open the published URL on your phone.
- **Locally:** from the project folder run `python3 -m http.server 8000` and open
  `http://localhost:8000`.

## Files

```
index.html       the app (HTML + CSS + JS, no build step)
audio/           rain.m4a ocean.m4a thunder.m4a wind.m4a fire.m4a creek.m4a cricket.m4a
CREDITS.md       sources and licenses for every recording
```

## Audio sources & license

Every recording is **CC0 1.0** or **Public Domain Mark 1.0** — free to use and
redistribute, including commercially, with no attribution legally required.
Full details and source links are in [CREDITS.md](CREDITS.md).
