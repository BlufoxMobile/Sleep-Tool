# Audio Credits

All three loops in `audio/v3/` are derived from real field recordings released
into the public domain (**Public Domain Mark 1.0**), so no attribution is
legally required, but credit is given here as a courtesy to the recordists, who
share their work through the radio aporee ::: maps project on the Internet
Archive.

| Sound | Files | Source recording | License | Link |
|-------|-------|------------------|---------|------|
| Rain on Tent | `audio/v3/tentrain-00…09.m4a` | "Ackerman Campground, California, USA: rain on the tent" (Virgile Loiseau, Zoom H1, 2017), lossless FLAC | Public Domain Mark 1.0 | https://archive.org/details/aporee_70996_82798 |
| Summer Rain | `audio/v3/rain-00…09.m4a` | "Mesaanitie 2, Oulu, Finland: Summer rain", recorded from an open window (dthundr, Zoom H5, 2020), 320 kbps MP3 | Public Domain Mark 1.0 | https://archive.org/details/aporee_50040_57088 |
| Distant Thunder | `audio/v3/thunder-00…09.m4a` | "Ban Na Tin (Krabi Province): Rain and thunder in Thailand" (Félix Blume, ORTF Schoeps CCM4, 2018), 320 kbps MP3 | Public Domain Mark 1.0 | https://archive.org/details/aporee_41798_47650 |

## What was used, and what was done to it

Every sound is one seamless 390-second loop made by `tools/master_audio.py`.
Pitch and timing are never changed. The full numbers are in
`audio/v3/processing-report.json`.

**Rain on Tent** uses source seconds 0.5–192.0 and 216.0–446.0. Left out:
192–216 s (a vehicle engine idling and revving, plus a loud thump at 199.6 s)
and 446 s to the end (handling noise as the recorder stops). Processing: 30 Hz
high-pass; notches for a steady 120 Hz mains hum and its harmonics; brief
low-frequency thumps limited to 8 dB above the running level; slow multiband
levelling (the rain grows from light to steady across the original, so the
quiet opening is lifted up to about 10 dB) and left/right balance (the right
channel was about 3.5 dB louder); an 11.5 s internal crossfade and a 20 s loop crossfade.

**Summer Rain** uses source seconds 1013.0–1423.0. The first 1000 seconds have
a car on the wet street every minute or so (a dozen passes of +10 to +20 dB) and
cars return near the end, so those parts are left out. Processing: 30 Hz
high-pass, low thump limiting, softening of the loudest drips near the window
(150–4500 Hz only), slow multiband levelling, a 20 s loop crossfade.

**Distant Thunder** uses source seconds 737.5–1147.5: a steady rain bed with
five spaced thunder rolls. Left out: 0–735 s (thunder every 20–40 s, peaking
near full scale) and 1160 s to the end (closer strikes, then frogs and insects).
Processing: 25 Hz high-pass; a narrow notch at 3.47 kHz for intermittent insect
chirps; three-band, look-ahead thunder taming (rumble compressed 4:1 and
allowed to rise at most 15 dB per second, crack brightness 3:1, the rain band
left nearly untouched), so the rolls peak about 4 dB above the rain instead of up to 20;
slow multiband levelling; a 20 s loop crossfade.

All three are peak-softened to −3 dBFS, matched to −24 dBFS RMS, cut into ten
39-second chunks that overlap their neighbours by 0.25 s, and encoded as AAC-LC
at 160 kbps, 32 kHz stereo.

## Why not Splice / Pixabay / Freesound paid samples?

Splice and most stock-audio libraries license samples for use *inside* your own
productions but **prohibit redistributing the raw audio files**, which is exactly
what bundling them in a public repo would do. CC0 / public-domain recordings carry
no such restriction, so they're the safe and correct choice for an open-source tool.
