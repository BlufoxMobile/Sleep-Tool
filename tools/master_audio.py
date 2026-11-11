#!/usr/bin/env python3
"""Night Sounds mastering pipeline.

Builds the three seamless rain loops that ship in audio/v3/ from the original
public-domain field recordings on the Internet Archive.

What it does, per sound:
  1. Fetches the original recording (or uses --source), verifies its MD5,
     and decodes it to 32 kHz stereo float with the SoX resampler.
  2. Cleans it: DC/rumble high-pass, hum notches, low-frequency thump
     limiting (tent rain), and slow, look-ahead thunder taming (thunder).
  3. Levels each source segment with a slow multiband leveller (running
     median band levels, long Gaussian smoothing, no pumping) so every
     stretch has the same loudness, tone and left/right balance.
  4. Splices the clean segments into ONE circular loop of exactly
     LOOP_SECONDS. Every join, including the loop seam, is a long,
     correlation-aware, equal-power crossfade.
  5. Levels the finished loop again in circular mode, so the gain curve
     itself wraps around the seam, then softens rare transient peaks and
     normalises to TARGET_RMS_DBFS.
  6. Cuts the loop into CHUNKS equal chunks. Each chunk file carries PAD
     seconds of the neighbouring audio on both sides, so the app can drop
     AAC encoder priming/padding and crossfade identical material at the
     joins. Encodes AAC-LC 32 kHz stereo.
  7. Decodes the encoded chunks again, reassembles them exactly the way
     app.js does, and measures the seam, the joins and the loudness range.
     Writes audio/<version>/manifest.json and processing-report.json.

Usage (from the repo root):
  python3 tools/master_audio.py --cache /tmp/night-sounds-sources
  python3 tools/master_audio.py --source tentrain=/path/to.flac ...
Options: --only tentrain,rain  --plots DIR  --no-encode

Requires ffmpeg/ffprobe (with soxr), numpy and scipy. Takes a few minutes
and roughly 3 GB of RAM.
"""
import argparse
import hashlib
import json
import os
import subprocess
import tempfile

import numpy as np
from scipy import ndimage, signal

SR = 32000
VERSION = "v3"
LOOP_SECONDS = 390            # 6 min 30 s: every sound and every mix repeats no sooner
CHUNKS = 10                   # 39 s per chunk
PAD_SECONDS = 0.25            # neighbouring audio carried on each side of a chunk
JOIN_FADE = 2048              # app-side crossfade between chunk encodings (samples)
BITRATE = "160k"
TARGET_RMS_DBFS = -24.0
PEAK_CEILING_DBFS = -3.0      # transient softening ceiling (crest <= 21 dB)

L = LOOP_SECONDS * SR
C = L // CHUNKS
P = int(PAD_SECONDS * SR)
assert C * CHUNKS == L

NFFT = 4096
HOP = 800                     # 25 ms; L is a multiple of HOP so circular processing is exact
assert L % HOP == 0
BAND_EDGES = [20, 90, 180, 350, 700, 1400, 2800, 5000, 8000, 11000, 16000]

SOUNDS = {
    "tentrain": {
        "name": "Rain on Tent",
        "archive": "aporee_70996_82798",
        "file": "1711160710pluietentecampgroundAckerman.flac",
        "md5": "3fec2df96879dbc4ad467246bdbbc5a1",
        # 192.0-216.0 s: a vehicle engine (tones at ~100/130-160 Hz) and a
        # +23 dB low-frequency thump at 199.6 s. 446.0 s on: handling noise
        # as the recording stops. 0-0.5 s: recorder start.
        "segments": [(0.5, 192.0), (216.0, 446.0)],
        "join_fade": 11.5,
        "seam_fade": 20.0,
        "highpass": 30.0,
        # Steady 120.1 Hz mains hum (+28 dB over the noise floor) and harmonics.
        "notches": [(120.1, 1.6), (239.75, 1.6), (359.9, 1.6), (480.0, 1.6)],
        "dethump": {"fc": 250.0, "over_db": 8.0},
        "thunder": None,
        "drops": None,
        "level": {"percentile": 50, "window": 15.0, "sigma": 6.0},
        "excluded": [
            [0.0, 0.5, "recorder start"],
            [192.0, 216.0, "vehicle engine idling/revving (99.6, 130-160 Hz tones) and a +23 dB thump at 199.6 s"],
            [446.0, 451.6, "handling noise as the recording stops"],
        ],
    },
    "rain": {
        "name": "Summer Rain",
        "archive": "aporee_50040_57088",
        "file": "sateenropina.mp3",
        "md5": "2434b6efa85bcce192d1f5005bd302ab",
        # Cars pass on a wet street throughout 0-1000 s (swooshes up to
        # +20 dB) and from 1492 s on. 1002-1472 s has none; the best seam
        # inside that window is searched for automatically.
        "search": (1002.0, 1472.0),
        "seam_fade": 20.0,
        "highpass": 30.0,
        "notches": [],
        "dethump": {"fc": 200.0, "over_db": 9.0},
        "thunder": None,
        "drops": {"drop_over": 8.0, "cluster_over": 2.0},
        "level": {"percentile": 50, "window": 15.0, "sigma": 6.0},
        "excluded": [
            [0.0, 1002.0, "frequent cars on the wet street (12 passes of +10 to +20 dB, 10-27 s each)"],
            [1472.0, 1523.4, "car passes from 1475 s and the recording end"],
        ],
    },
    "thunder": {
        "name": "Distant Thunder",
        "archive": "aporee_41798_47650",
        "file": "RainandthunderinThailandTH181001T01.mp3",
        "md5": "b635db599df8ad3f6473ae92b3285b56",
        # 0-640 s: near-continuous, very loud thunder; 1700 s on: frogs and
        # insects. 735-1160 s holds a steady rain bed with five spaced rolls.
        "search": (735.0, 1160.0),
        "seam_fade": 20.0,
        "highpass": 25.0,
        # Intermittent insect chirps at 3.45-3.49 kHz (up to +20 dB over the rain).
        "notches": [(3472.0, 90.0)],
        "dethump": None,
        "thunder": {"f1": 300.0, "f2": 1500.0},
        "drops": None,
        "level": {"percentile": 25, "window": 60.0, "sigma": 8.0},
        "excluded": [
            [0.0, 735.0, "thunder every 20-40 s, peaks to -0.9 dBFS; engine hum lines at 640-740 s"],
            ["3.43-3.51 kHz", "", "intermittent insect chirps (about 6 s in total) notched out, not cut in time"],
            [1160.0, 2100.6, "louder close strikes (1215-1314 s), frogs and insects from about 1700 s"],
        ],
    },
}


# --------------------------------------------------------------------------
# I/O
# --------------------------------------------------------------------------

def md5sum(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch_source(sound_id, cfg, cache_dir, override):
    if override:
        path = override
    else:
        folder = os.path.join(cache_dir, sound_id)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, cfg["file"])
        if not os.path.exists(path):
            url = f"https://archive.org/download/{cfg['archive']}/{cfg['file']}"
            print(f"  downloading {url}")
            subprocess.run(["curl", "-sSLf", "-o", path, url], check=True)
    digest = md5sum(path)
    if digest != cfg["md5"]:
        raise SystemExit(f"{sound_id}: MD5 mismatch for {path} ({digest} != {cfg['md5']})")
    return path


def decode(path):
    cmd = ["ffmpeg", "-hide_banner", "-v", "error", "-i", path,
           "-af", f"aresample={SR}:resampler=soxr:precision=28", "-ac", "2",
           "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    raw = subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def db(p):
    return 10 * np.log10(np.maximum(p, 1e-20))


def frame_power(x, hop):
    """Mean power (both channels) per hop-sized frame."""
    n = len(x) // hop
    seg = x[: n * hop].astype(np.float64)
    return (seg ** 2).reshape(n, hop, -1).mean(axis=(1, 2))


def gains_to_samples(g_db, hop, n):
    """Frame-rate dB gains (frame m centred at m*hop) to per-sample linear gains."""
    t = np.arange(len(g_db)) * hop
    return (10 ** (np.interp(np.arange(n), t, g_db) / 20)).astype(np.float32)


def tile(x, margin):
    return np.concatenate([x[-margin:], x, x[:margin]])


# --------------------------------------------------------------------------
# Cleaning
# --------------------------------------------------------------------------

def highpass(x, fc):
    sos = signal.butter(2, fc, "highpass", fs=SR, output="sos")
    return signal.sosfiltfilt(sos, x, axis=0).astype(np.float32)


def notch(x, notches):
    """Zero-phase notches; each entry is (centre Hz, -3 dB width Hz)."""
    y = x.astype(np.float64)
    for f, width in notches:
        b, a = signal.iirnotch(f, f / width, fs=SR)
        y = signal.filtfilt(b, a, y, axis=0)
    return y.astype(np.float32)


def split(x, fc):
    sos = signal.butter(4, fc, "lowpass", fs=SR, output="sos")
    low = signal.sosfiltfilt(sos, x, axis=0).astype(np.float32)
    return low, x - low


def dethump(x, fc, over_db, hop=80):
    """Limit brief low-frequency bumps (drops on the tent pole, wind on the
    mic) to over_db above the running low-band median. 2.5 ms resolution,
    30 ms look-ahead, ~120 ms smooth release."""
    low, high = split(x, fc)
    env = db(ndimage.uniform_filter1d(frame_power(low, hop), int(0.02 * SR / hop)))
    ref = ndimage.median_filter(env, size=int(8 * SR / hop), mode="reflect")
    g = -np.maximum(0, env - (ref + over_db))
    g = ndimage.minimum_filter1d(g, int(0.06 * SR / hop), mode="reflect")
    g = ndimage.gaussian_filter1d(g, 0.03 * SR / hop, mode="reflect")
    gs = gains_to_samples(g, hop, len(x))[:, None]
    stats = {"frames_reduced_pct": round(float((g < -1).mean() * 100), 2),
             "max_reduction_db": round(float(-g.min()), 1)}
    return high + low * gs, stats


def slew_up(level_db, max_rise_db_per_frame):
    out = level_db.copy()
    for i in range(1, len(out)):
        out[i] = min(out[i], out[i - 1] + max_rise_db_per_frame)
    return out


def three_way(x, f1, f2):
    """Zero-phase three-band split; low + mid + high == x exactly."""
    low, rest = split(x, f1)
    mid, high = split(rest, f2)
    return low, mid, high


def compress(lev, thr, ratio, fps, rise_db_s=None, lookahead_s=0.0, sigma_s=0.0):
    """Downward gain (dB) for a level curve: ratio above thr, optional limit
    on how fast the output may rise, centred look-ahead and smoothing."""
    g = -(1 - 1 / ratio) * np.maximum(0, lev - thr)
    if rise_db_s:
        out = slew_up(lev + g, rise_db_s / fps)
        g = np.minimum(g, out - lev)
    if lookahead_s:
        g = ndimage.minimum_filter1d(g, 2 * int(lookahead_s * fps) + 1, mode="reflect")
    if sigma_s:
        g = ndimage.gaussian_filter1d(g, sigma_s * fps, mode="reflect")
    return g


def smoothed_level(band, hop, seconds):
    fps = SR / hop
    return db(ndimage.uniform_filter1d(frame_power(band, hop), max(1, int(seconds * fps))))


def tame_thunder(x, f1=300.0, f2=1500.0, hop=800):
    """Three-band, look-ahead thunder taming referenced to the rain bed.

    Rumble (<f1): 4:1 above (rain bed - 4 dB); the reduction starts up to
    1 s before an onset and the output may rise at most 15 dB/s, so rolls
    swell in instead of cracking. Crack body (f1-f2): 3:1 above its own bed
    + 3 dB, 20 dB/s. Rain band (>f2): only 2:1 above bed + 4 dB, so the
    rain itself is not ducked when thunder rolls. The bed of each band is
    its running 20th percentile over 60 s. All zero-phase and smoothed.
    """
    low, mid, high = three_way(x, f1, f2)
    fps = SR / hop

    def bed(band):
        b = ndimage.percentile_filter(smoothed_level(band, hop, 0.4), 20, size=int(60 * fps), mode="reflect")
        return ndimage.gaussian_filter1d(b, 5 * fps, mode="reflect")

    bed_m, bed_h = bed(mid), bed(high)
    rain_bed = db(10 ** (bed_m / 10) + 10 ** (bed_h / 10))
    gl = compress(smoothed_level(low, hop, 0.4), rain_bed - 4.0, 4.0, fps, 15.0, 1.0, 0.5)
    gm = compress(smoothed_level(mid, hop, 0.2), bed_m + 3.0, 3.0, fps, 20.0, 0.5, 0.25)
    gh = compress(smoothed_level(high, hop, 0.1), bed_h + 4.0, 2.0, fps, None, 0.2, 0.1)
    n = len(x)
    y = (low * gains_to_samples(gl, hop, n)[:, None] + mid * gains_to_samples(gm, hop, n)[:, None]
         + high * gains_to_samples(gh, hop, n)[:, None])
    stats = {"rumble_max_reduction_db": round(float(-gl.min()), 1),
             "rumble_frames_reduced_pct": round(float((gl < -1).mean() * 100), 1),
             "crack_band_max_reduction_db": round(float(-gm.min()), 1),
             "rain_band_max_reduction_db": round(float(-gh.min()), 1),
             "rain_band_frames_reduced_pct": round(float((gh < -1).mean() * 100), 2)}
    return y.astype(np.float32), stats


def soften_drops(x, f1=150.0, f2=4500.0, drop_over=8.0, cluster_over=1.5):
    """Even out the 'plop' drips close to the open window (Summer Rain).

    Only the 150-4500 Hz band, where the drips live, is touched; the hiss
    above and the rumble below are left alone. Stage 1 (2.5 ms frames): a
    single drop more than drop_over dB above the running 4 s median is
    reduced 3:1 with a 10 ms look-ahead. Stage 2 (25 ms frames): a cluster of
    drops whose 0.3 s level is more than cluster_over dB above the running
    8 s median is reduced 3:1 with 150 ms look-ahead and soft edges.
    """
    low, mid, high = three_way(x, f1, f2)
    n = len(x)
    fast = 80
    lev = smoothed_level(mid, fast, 0.01)
    ref = ndimage.median_filter(lev, size=int(4 * SR / fast), mode="reflect")
    g1 = compress(lev, ref + drop_over, 3.0, SR / fast, None, 0.01, 0.005)
    mid = mid * gains_to_samples(g1, fast, n)[:, None]
    slow = 800
    lev2 = smoothed_level(mid, slow, 0.3)
    ref2 = ndimage.median_filter(lev2, size=int(8 * SR / slow), mode="reflect")
    g2 = compress(lev2, ref2 + cluster_over, 3.0, SR / slow, None, 0.15, 0.12)
    mid = mid * gains_to_samples(g2, slow, n)[:, None]
    stats = {"single_drop_max_reduction_db": round(float(-g1.min()), 1),
             "single_drop_frames_reduced_pct": round(float((g1 < -1).mean() * 100), 2),
             "cluster_max_reduction_db": round(float(-g2.min()), 1),
             "cluster_frames_reduced_pct": round(float((g2 < -1).mean() * 100), 1)}
    return (low + mid + high).astype(np.float32), stats


# --------------------------------------------------------------------------
# Slow multiband leveller (STFT domain)
# --------------------------------------------------------------------------

FREQS = np.fft.rfftfreq(NFFT, 1 / SR)
BAND_IDX = [np.where((FREQS >= lo) & (FREQS < hi))[0] for lo, hi in zip(BAND_EDGES[:-1], BAND_EDGES[1:])]
CENTRES = np.log2([np.sqrt(lo * hi) for lo, hi in zip(BAND_EDGES[:-1], BAND_EDGES[1:])])
# Bin-by-band matrix: linear interpolation of band gains in log frequency.
INTERP = np.stack([np.interp(np.log2(np.maximum(FREQS, 1.0)), CENTRES, e) for e in np.eye(len(CENTRES))], axis=1)


def stft(ch):
    return signal.stft(ch, fs=SR, window="hann", nperseg=NFFT, noverlap=NFFT - HOP)[2].astype(np.complex64)


def istft(Z, n):
    return signal.istft(Z, fs=SR, window="hann", nperseg=NFFT, noverlap=NFFT - HOP)[1][:n].astype(np.float32)


def band_levels(x):
    """Per-frame band powers (dB, both channels) and per-channel broadband levels."""
    bands = np.zeros((len(BAND_IDX), 0))
    chan = []
    total = None
    for c in range(2):
        Z = stft(x[:, c])
        p = (np.abs(Z) ** 2).astype(np.float64)
        b = np.stack([p[idx].sum(0) for idx in BAND_IDX])
        total = b if total is None else total + b
        chan.append(db(b.sum(0)))
        del Z, p
    return db(total), np.stack(chan)


def smooth_levels(lev, cfg, mode):
    fps = SR / HOP
    win = int(cfg["window"] * fps) | 1
    if cfg["percentile"] == 50:
        s = ndimage.median_filter(lev, size=(1, win), mode=mode)
    else:
        s = ndimage.percentile_filter(lev, cfg["percentile"], size=(1, win), mode=mode)
    return ndimage.gaussian_filter1d(s, cfg["sigma"] * fps, axis=1, mode=mode)


def level(x, target, cfg, circular=False, max_gain=12.0, max_tilt=8.0, max_bal=4.0):
    """Ride every band towards `target` (dB per band) with long time constants.
    In circular mode the input is treated as one period of a loop."""
    n = len(x)
    margin = 60 * SR if circular else 0
    xx = tile(x, margin) if circular else x
    mode = "nearest" if circular else "reflect"
    lev, chan = band_levels(xx)
    s = smooth_levels(lev, cfg, mode)
    sc = smooth_levels(chan, cfg, mode)
    tot_target = db(np.sum(10 ** (target / 10)))
    broad = tot_target - db(np.sum(10 ** (s / 10), axis=0))
    broad = np.clip(broad, -max_gain, max_gain)
    tilt = np.clip((target[:, None] - s) - broad[None, :], -max_tilt, max_tilt)
    g = broad[None, :] + tilt
    g = ndimage.gaussian_filter1d(g, 2 * SR / HOP, axis=1, mode=mode)
    bal = np.clip(sc[1] - sc[0], -max_bal, max_bal)
    bal = ndimage.gaussian_filter1d(bal, 2 * SR / HOP, mode=mode)
    gbins = (INTERP @ g).astype(np.float32)
    out = np.empty_like(xx)
    for c in range(2):
        Z = stft(xx[:, c])
        ch_gain = (bal / 2) if c == 0 else (-bal / 2)
        Z *= (10 ** ((gbins + ch_gain[None, :].astype(np.float32)) / 20)).astype(np.float32)
        out[:, c] = istft(Z, len(xx))
        del Z
    if circular:
        out = out[margin:margin + n]
        sl = slice(margin // HOP, (margin + n) // HOP)
    else:
        sl = slice(None)
    info = {"broadband_gain_db": [round(float(broad[sl].min()), 2), round(float(broad[sl].max()), 2)],
            "balance_correction_db": [round(float(bal[sl].min()), 2), round(float(bal[sl].max()), 2)],
            "max_tilt_correction_db": round(float(np.abs(tilt[:, sl]).max()), 2)}
    return out, info


def target_spectrum(segments, cfg):
    levs = [smooth_levels(band_levels(s)[0], cfg, "reflect") for s in segments]
    allv = np.concatenate(levs, axis=1)
    return np.median(allv, axis=1)


# --------------------------------------------------------------------------
# Splicing
# --------------------------------------------------------------------------

def crossfade(out_tail, in_head):
    """Correlation-aware equal-power crossfade of two equal-length blocks."""
    n = len(out_tail)
    a, b = out_tail.astype(np.float64), in_head.astype(np.float64)
    rho = float(np.clip((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-30), -0.9, 1.0))
    t = (np.arange(n) + 0.5) / n
    fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    norm = np.sqrt(1 + 2 * rho * fin * fout)
    w_in, w_out = (fin / norm)[:, None], (fout / norm)[:, None]
    return (a * w_out + b * w_in).astype(np.float32), rho


def build_loop(segments, join_fade, seam_fade):
    """Concatenate segments with join crossfades, then close the circle with
    the seam crossfade. Returns the loop and the join centres (samples)."""
    xj, xs = int(join_fade * SR), int(seam_fade * SR)
    lin = segments[0]
    joins, rhos = [], []
    for seg in segments[1:]:
        mixed, rho = crossfade(lin[-xj:], seg[:xj])
        joins.append(len(lin) - xj // 2)
        rhos.append(rho)
        lin = np.concatenate([lin[:-xj], mixed, seg[xj:]])
    if len(lin) < L + xs:
        raise SystemExit(f"not enough material: {len(lin)/SR:.1f}s < {(L + xs)/SR:.1f}s")
    lin = lin[: L + xs]
    seam, rho = crossfade(lin[L:L + xs], lin[:xs])
    rhos.append(rho)
    loop = np.concatenate([seam, lin[xs:L]])
    # Loop index i >= xs is linear index i; the seam crossfade occupies
    # [0, xs) and sample L-1 runs straight into sample 0.
    return loop, joins + [xs // 2], rhos


def choose_seam(x, offset, search, seam_fade, cfg, avoid_low=False):
    """Pick the start of a single contiguous L + seam_fade window inside
    `search` whose head and tail match best in band level, and (for thunder)
    whose crossfade regions are free of rumble."""
    span = L + int(seam_fade * SR)
    lo = int((search[0] - offset) * SR)
    hi = int((search[1] - offset) * SR) - span
    region = x[lo:hi + span]
    lev, _ = band_levels(region)
    s = smooth_levels(lev, {"percentile": 50, "window": 5.0, "sigma": 2.0}, "reflect")
    xs = int(seam_fade * SR) // HOP
    best = None
    for st in range(0, (hi - lo) // HOP + 1, int(0.5 * SR / HOP)):
        head = s[:, st:st + xs]
        tail = s[:, st + L // HOP: st + L // HOP + xs]
        cost = np.mean(np.abs(head.mean(1) - tail.mean(1)))
        if avoid_low:
            raw = lev[:2]
            cost += 0.25 * max(0.0, float(raw[:, st:st + xs].max() - np.median(raw)) - 6)
            cost += 0.25 * max(0.0, float(raw[:, st + L // HOP: st + L // HOP + xs].max() - np.median(raw)) - 6)
        if best is None or cost < best[0]:
            best = (cost, st)
    start = lo + best[1] * HOP
    return start, best[0]


# --------------------------------------------------------------------------
# Peaks and loudness
# --------------------------------------------------------------------------

def soften_peaks(x, ceiling_db, circular=True):
    """Zero-phase look-ahead peak softener: 10 ms min-filter + 10 ms Hann."""
    ceiling = 10 ** (ceiling_db / 20)
    m = int(0.01 * SR) | 1
    xx = tile(x, SR) if circular else x
    pk = np.abs(xx).max(axis=1)
    req = np.minimum(1.0, ceiling / np.maximum(pk, 1e-9))
    g = ndimage.minimum_filter1d(req, m, mode="wrap" if circular else "nearest")
    win = np.hanning(m + 2)[1:-1]
    g = ndimage.convolve1d(g, win / win.sum(), mode="wrap" if circular else "nearest")
    y = xx * g[:, None].astype(np.float32)
    if circular:
        y, g = y[SR:SR + len(x)], g[SR:SR + len(x)]
    stats = {"samples_reduced_1db_pct": round(float((g < 0.891).mean() * 100), 3),
             "samples_reduced_pct": round(float((g < 0.999).mean() * 100), 3),
             "max_reduction_db": round(float(-20 * np.log10(g.min())), 2)}
    return y.astype(np.float32), stats


def rms_db(x):
    return float(db((x.astype(np.float64) ** 2).mean()))


# --------------------------------------------------------------------------
# Measurements
# --------------------------------------------------------------------------

M_BANDS = [(20, 250), (250, 1000), (1000, 4000), (4000, 16000)]


def window_stats(x, win):
    """Per-window RMS (dB), band levels (dB) and spectral centroid (Hz)."""
    n = len(x) // win
    seg = x[: n * win].astype(np.float64).mean(axis=1).reshape(n, win)
    rms = db((x[: n * win].astype(np.float64) ** 2).reshape(n, win, 2).mean(axis=(1, 2)))
    spec = np.abs(np.fft.rfft(seg * np.hanning(win), axis=1)) ** 2
    f = np.fft.rfftfreq(win, 1 / SR)
    bands = np.stack([db(spec[:, (f >= lo) & (f < hi)].sum(1)) for lo, hi in M_BANDS], axis=1)
    cen = (spec * f).sum(1) / spec.sum(1)
    return rms, bands, cen


def seam_metrics(loop, pos, around=60.0, win_s=2.0):
    """Compare the 2 s windows touching `pos` (circular) with the surrounding
    `around` seconds on each side. Also report how unusual that is: the same
    statistic for every other 2 s window in the loop."""
    n = len(loop)
    win = int(win_s * SR)
    k = int(around / win_s)
    # windows aligned so that `pos` is a window boundary, plus one centred on it
    idx = (np.arange(-k * win, k * win) + pos) % n
    z = loop[idx]
    rms, bands, cen = window_stats(z, win)
    cz = loop[(np.arange(-win // 2, win // 2) + pos) % n]
    crms, cbands, ccen = window_stats(cz, win)
    others = np.delete(rms, [k - 1, k])
    ref_rms = db(np.mean(10 ** (others / 10)))
    med_rms = float(np.median(others))
    # Median references: robust to the odd thunder roll or drip cluster nearby.
    ref_bands = np.median(np.delete(bands, [k - 1, k], axis=0), axis=0)
    ref_cen = float(np.median(np.delete(cen, [k - 1, k])))
    seam_rms = np.array([rms[k - 1], crms[0], rms[k]])
    seam_bands = np.stack([bands[k - 1], cbands[0], bands[k]])
    seam_cen = np.array([cen[k - 1], ccen[0], cen[k]])
    d = np.diff(loop.astype(np.float64), axis=0)
    step = np.abs(loop[pos % n].astype(np.float64) - loop[(pos - 1) % n]).max()
    return {
        "rms_dev_db": round(float(np.abs(seam_rms - ref_rms).max()), 2),
        "rms_dev_vs_median_db": round(float(np.abs(seam_rms - med_rms).max()), 2),
        "band_dev_db": round(float(np.abs(seam_bands - ref_bands).max()), 2),
        "centroid_dev_pct": round(float(np.abs(seam_cen / ref_cen - 1).max() * 100), 1),
        "surrounding_2s_rms_spread_db": round(float(np.percentile(rms, 95) - np.percentile(rms, 5)), 2),
        "sample_step_vs_p99_step": round(float(step / np.percentile(np.abs(d), 99)), 3),
        "before_after_minute_rms_db": [round(float(db(np.mean(10 ** (rms[:k] / 10)))), 2),
                                       round(float(db(np.mean(10 ** (rms[k:] / 10)))), 2)],
    }


def typical_window_dev(loop, win_s=2.0, around=60.0):
    """The same seam statistics for EVERY 2 s window of the (circular) loop,
    compared with its own surrounding windows: the natural drop-to-drop
    variation that a seam is judged against. Returns 50th/95th percentiles."""
    win = int(win_s * SR)
    rms, bands, cen = window_stats(loop, win)
    n = len(rms)
    k = min(int(around / win_s), (n - 1) // 2)
    p = 10 ** (rms / 10)
    dev, devm, bdev, cdev = [], [], [], []
    for i in range(n):
        idx = np.r_[i - k:i, i + 1:i + k + 1] % n
        dev.append(abs(rms[i] - db(p[idx].mean())))
        devm.append(abs(rms[i] - np.median(rms[idx])))
        bdev.append(np.abs(bands[i] - np.median(bands[idx], axis=0)).max())
        cdev.append(abs(cen[i] / np.median(cen[idx]) - 1) * 100)
    pct = lambda v: [round(float(np.percentile(v, 50)), 2), round(float(np.percentile(v, 95)), 2)]
    return {"rms_dev_db_p50_p95": pct(dev), "rms_dev_vs_median_db_p50_p95": pct(devm),
            "band_dev_db_p50_p95": pct(bdev), "centroid_dev_pct_p50_p95": pct(cdev)}


def calm_rotation(loop, fades, avoid_low=False):
    """Pick where the file starts: the wrap point is sample-continuous, so it
    can sit anywhere. Choose a moment >= 15 s from every crossfade whose 2 s
    neighbourhood is closest to the local median level (and, for thunder,
    with no rumble within 15 s). Also where an iPhone restarts the file."""
    win = int(0.5 * SR)
    rms, bands, _ = window_stats(loop, win)
    n = len(rms)
    med = ndimage.median_filter(rms, size=121, mode="wrap")
    local = ndimage.uniform_filter1d(10 ** (rms / 10), 4, mode="wrap")
    cost = np.abs(db(local) - med)
    if avoid_low:
        low = bands[:, 0]
        cost += np.maximum(0, ndimage.maximum_filter1d(low, 61, mode="wrap") - np.median(low) - 6)
    pos = np.arange(n) * win
    for c0, c1 in fades:
        d = np.minimum(np.abs(pos - (c0 + c1) // 2), L - np.abs(pos - (c0 + c1) // 2))
        cost[d < (c1 - c0) // 2 + 15 * SR] = np.inf
    i = int(np.argmin(cost))
    return (i * win + win // 2) % L


def loudness_range(loop):
    out = {}
    for w in (2, 10, 30):
        win = w * SR
        n = len(loop) // win
        r = db((loop[: n * win].astype(np.float64) ** 2).reshape(n, win, 2).mean(axis=(1, 2)))
        out[f"{w}s_rms_min_max_db"] = [round(float(r.min()), 2), round(float(r.max()), 2)]
        out[f"{w}s_rms_p5_p95_spread_db"] = round(float(np.percentile(r, 95) - np.percentile(r, 5)), 2)
    out["rms_dbfs"] = round(rms_db(loop), 2)
    out["peak_dbfs"] = round(float(20 * np.log10(np.abs(loop).max())), 2)
    return out


# --------------------------------------------------------------------------
# Encoding and app-equivalent reassembly
# --------------------------------------------------------------------------

def chunk_audio(loop, k):
    idx = (np.arange(k * C - P, (k + 1) * C + P)) % L
    return loop[idx]


def encode_chunks(loop, sound_id, out_dir):
    files = []
    for k in range(CHUNKS):
        name = f"{sound_id}-{k:02d}.m4a"
        path = os.path.join(out_dir, name)
        data = np.ascontiguousarray(chunk_audio(loop, k), dtype=np.float32)
        cmd = ["ffmpeg", "-hide_banner", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2",
               "-i", "-", "-c:a", "aac", "-b:a", BITRATE, "-aac_pns", "0", "-aac_is", "0",
               "-cutoff", "15000", "-ar", str(SR), "-map_metadata", "-1", "-fflags", "+bitexact",
               "-flags:a", "+bitexact", "-movflags", "+faststart", path]
        subprocess.run(cmd, input=data.tobytes(), check=True)
        files.append(name)
    return files


def find_lag(prev, prev_start, nxt, nxt_start, window=2048, max_lag=2304):
    """Mirror of NightAudio.findLag: normalised cross-correlation of mid
    channels; returns (lag, corr) such that nxt[nxt_start+lag+t] ~ prev[prev_start+t]."""
    a = prev[prev_start:prev_start + window].mean(1).astype(np.float64)
    seg = nxt[nxt_start - max_lag:nxt_start + max_lag + window].mean(1).astype(np.float64)
    c = signal.correlate(seg, a, mode="valid")
    e = np.convolve(seg ** 2, np.ones(window), mode="valid")
    nc = c / np.sqrt(e * (a ** 2).sum() + 1e-30)
    i = int(np.argmax(nc))
    return i - max_lag, float(nc[i])


def reassemble(decoded):
    """Exactly what app.js does with decoded chunks (one sound, gain 1)."""
    out = np.zeros((L, 2), np.float32)
    lags, corrs = [], []
    read = [P] * CHUNKS
    F = JOIN_FADE
    w = ((np.arange(F) + 0.5) / F)[:, None]
    for k in range(CHUNKS):
        d = decoded[k]
        if k > 0:
            lag, corr = find_lag(decoded[k - 1], read[k - 1] + C - 1024, d, read[k - 1] - 1024)
            read[k] = read[k - 1] + (lag if corr >= 0.5 else 0)
            lags.append(read[k] - read[k - 1])
            corrs.append(round(corr, 4))
        r = read[k]
        out[k * C:(k + 1) * C] = d[r:r + C]
        if k > 0:
            prev = decoded[k - 1][read[k - 1] + C: read[k - 1] + C + F]
            out[k * C:k * C + F] = prev * (1 - w) + d[r:r + F] * w
    # wrap: last chunk's tail into the first chunk's head
    lag, corr = find_lag(decoded[-1], read[-1] + C - 1024, decoded[0], read[0] - 1024)
    lags.append(lag + read[-1] - read[0])
    corrs.append(round(corr, 4))
    tail = decoded[-1][read[-1] + C: read[-1] + C + F]
    out[:F] = tail * (1 - w) + decoded[0][read[0]:read[0] + F] * w
    return out, lags, corrs


# --------------------------------------------------------------------------
# Old (v2) loops, for before/after numbers
# --------------------------------------------------------------------------

def old_seamloop(x, fade_s):
    """Python port of the v2 runtime NightAudio.seamLoop."""
    fade = min(int(round(fade_s * SR)), len(x) // 4)
    n = len(x) - fade
    a, b = x[:fade].astype(np.float64), x[n:n + fade].astype(np.float64)
    rho = np.clip((a[::8] * b[::8]).sum() / np.sqrt((a[::8] ** 2).sum() * (b[::8] ** 2).sum()), -.9, 1)
    t = np.arange(fade) / (fade - 1)
    fa, fb = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    out = x[:n].astype(np.float64).copy()
    out[:fade] = (a * fa[:, None] + b * fb[:, None]) / np.sqrt(1 + 2 * rho * fa * fb)[:, None]
    return out.astype(np.float32)


def measure_old(repo, sound_id):
    path = os.path.join(repo, "audio", f"{sound_id}.m4a")
    if not os.path.exists(path):
        return None
    x = decode(path)
    loop = old_seamloop(x, 2.5 if sound_id == "tentrain" else 8)
    around = 20.0 if len(loop) < 120 * SR else 60.0
    return {
        "loop_seconds": round(len(loop) / SR, 2),
        "seam": seam_metrics(loop, 0, around=around),
        "typical_2s_window_dev_db": typical_window_dev(loop, around=around),
        "loudness": loudness_range(loop),
    }


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def plot(sound_id, loop, joins, plot_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    win = 2 * SR
    z = np.concatenate([loop[-60 * SR:], loop, loop[:60 * SR]])
    rms, bands, cen = window_stats(z, win)
    t = np.arange(len(rms)) * 2 - 60
    fig, ax = plt.subplots(3, 1, figsize=(18, 9), sharex=True)
    ax[0].plot(t, rms); ax[0].set_ylabel("2 s RMS dBFS")
    for i, (lo, hi) in enumerate(M_BANDS):
        ax[1].plot(t, bands[:, i], label=f"{lo}-{hi} Hz")
    ax[1].legend(fontsize=7); ax[2].plot(t, cen); ax[2].set_ylabel("centroid Hz")
    for a in ax:
        for j in joins:
            a.axvline(j / SR, color="r", alpha=.3)
        a.axvline(0, color="k", alpha=.5); a.axvline(LOOP_SECONDS, color="k", alpha=.5)
        a.grid(alpha=.3)
    fig.suptitle(f"{sound_id}: loop with 60 s of wrap on each side (black = seam)")
    fig.tight_layout()
    fig.savefig(os.path.join(plot_dir, f"{sound_id}-loop.png"), dpi=60)
    plt.close(fig)


def process(sound_id, cfg, src_path, out_dir, args):
    print(f"[{sound_id}] decoding {os.path.basename(src_path)}")
    x = decode(src_path)
    report = {"name": cfg["name"], "source": f"https://archive.org/details/{cfg['archive']}",
              "source_file": cfg["file"], "source_md5": cfg["md5"],
              "source_seconds": round(len(x) / SR, 2), "excluded": cfg["excluded"]}
    lev_cfg = cfg["level"]

    # Work only on the material that can be used (plus context for filters).
    if "segments" in cfg:
        spans = cfg["segments"]
    else:
        spans = [cfg["search"]]
    ctx = 30.0
    first, last = max(0.0, spans[0][0] - ctx), min(len(x) / SR, spans[-1][1] + ctx)
    work = x[int(first * SR):int(last * SR)]
    del x

    work = highpass(work, cfg["highpass"])
    if cfg["notches"]:
        work = notch(work, cfg["notches"])
    if cfg["dethump"]:
        work, report["dethump"] = dethump(work, **cfg["dethump"])
    if cfg["thunder"]:
        work, report["thunder_taming"] = tame_thunder(work, **cfg["thunder"])
    if cfg["drops"]:
        work, report["drop_softening"] = soften_drops(work, **cfg["drops"])

    if "segments" in cfg:
        segs = [work[int((a - first) * SR):int((b - first) * SR)] for a, b in cfg["segments"]]
        used = [[a, b] for a, b in cfg["segments"]]
        join_fade = cfg["join_fade"]
        need = sum(len(s) for s in segs) - int(join_fade * SR) * (len(segs) - 1)
        surplus = need - (L + int(cfg["seam_fade"] * SR))
        if surplus < 0:
            raise SystemExit(f"{sound_id}: {surplus / SR:.1f}s short")
        if surplus:
            segs[-1] = segs[-1][:len(segs[-1]) - surplus]
            used[-1][1] = round(used[-1][1] - surplus / SR, 3)
    else:
        start, cost = choose_seam(work, first, cfg["search"], cfg["seam_fade"], lev_cfg,
                                  avoid_low=bool(cfg["thunder"]))
        span = L + int(cfg["seam_fade"] * SR)
        segs = [work[start:start + span]]
        a = first + start / SR
        used = [[round(a, 3), round(a + span / SR, 3)]]
        join_fade = 0
        report["seam_search_cost_db"] = round(cost, 3)
    report["source_ranges_used_seconds"] = used
    print(f"[{sound_id}] using {used}")

    target = target_spectrum(segs, lev_cfg)
    report["target_band_levels_db"] = [round(float(v), 2) for v in target]
    levelled, pre_info = [], []
    for s in segs:
        y, info = level(s, target, lev_cfg)
        levelled.append(y)
        pre_info.append(info)
    report["segment_levelling"] = pre_info

    loop, joins, rhos = build_loop(levelled, join_fade, cfg["seam_fade"])
    report["joins_seconds_in_loop"] = [round(j / SR, 2) for j in joins]
    report["join_correlations"] = [round(r, 4) for r in rhos]
    report["crossfades_seconds"] = {"seam": cfg["seam_fade"], "internal": join_fade}

    loop, report["loop_levelling"] = level(loop, target, lev_cfg, circular=True, max_gain=6.0, max_tilt=4.0)
    loop *= 10 ** ((TARGET_RMS_DBFS - rms_db(loop)) / 20)
    loop, report["peak_softening"] = soften_peaks(loop, PEAK_CEILING_DBFS)
    loop *= 10 ** ((TARGET_RMS_DBFS - rms_db(loop)) / 20)
    loop = np.clip(loop, -1, 1).astype(np.float32)

    xs, xj = int(cfg["seam_fade"] * SR), int(join_fade * SR)
    fades = [(j - xj // 2, j + xj // 2) for j in joins[:-1]] + [(0, xs)]
    rot = calm_rotation(loop, fades, avoid_low=bool(cfg["thunder"]))
    loop = np.roll(loop, -rot, axis=0)
    joins = [int((j - rot) % L) for j in joins]
    report["file_starts_at_loop_seconds"] = round(rot / SR, 2)
    report["joins_seconds_in_file"] = [round(j / SR, 2) for j in joins]

    report["master"] = {
        "loop_seconds": LOOP_SECONDS,
        "wrap_point": seam_metrics(loop, 0),
        "seam": seam_metrics(loop, joins[-1]),
        "joins": [seam_metrics(loop, j) for j in joins[:-1]],
        "typical_2s_window_dev_db": typical_window_dev(loop),
        "loudness": loudness_range(loop),
    }
    if args.plots:
        plot(sound_id, loop, joins, args.plots)
    if args.masters:
        os.makedirs(args.masters, exist_ok=True)
        loop.astype(np.float32).tofile(os.path.join(args.masters, f"{sound_id}.f32"))
    if args.no_encode:
        return report, None

    files = encode_chunks(loop, sound_id, out_dir)
    decoded = [decode(os.path.join(out_dir, f)) for f in files]
    lengths = sorted({len(d) for d in decoded})
    re, lags, corrs = reassemble(decoded)
    err = re - loop
    report["encoded"] = {
        "codec": f"AAC-LC {BITRATE}bps {SR} Hz stereo (ffmpeg aac, PNS and intensity stereo off)",
        "files": files,
        "bytes": int(sum(os.path.getsize(os.path.join(out_dir, f)) for f in files)),
        "decoded_chunk_lengths": lengths,
        "chunk_join_lags": lags,
        "chunk_join_correlations": corrs,
        "codec_snr_db": round(float(db((loop.astype(np.float64) ** 2).mean()) - db((err.astype(np.float64) ** 2).mean())), 2),
        "wrap_point": seam_metrics(re, 0),
        "seam": seam_metrics(re, joins[-1]),
        # Codec error in the 100 ms around each chunk join relative to the
        # codec error everywhere: ~0 dB means the joins are not audible as joins.
        "chunk_join_error_vs_overall_db_max": round(max(
            float(db((err[(np.arange(-1600, 1600) + k * C) % L].astype(np.float64) ** 2).mean())
                  - db((err.astype(np.float64) ** 2).mean())) for k in range(CHUNKS)), 2),
        "chunk_join_step_vs_p99_step_max": round(max(seam_metrics(re, k * C, around=4)["sample_step_vs_p99_step"]
                                                     for k in range(CHUNKS)), 3),
        "loudness": loudness_range(re),
    }
    peak = float(np.abs(re).max())
    return report, {"files": files, "peak": round(peak, 4), "rms_dbfs": round(rms_db(re), 2)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "night-sounds-sources"))
    ap.add_argument("--source", action="append", default=[], help="id=path to an already downloaded original")
    ap.add_argument("--only", default="")
    ap.add_argument("--plots", default="")
    ap.add_argument("--no-encode", action="store_true")
    ap.add_argument("--masters", default="", help="also write each master loop as raw float32 stereo here")
    args = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(repo, "audio", VERSION)
    os.makedirs(out_dir, exist_ok=True)
    overrides = dict(s.split("=", 1) for s in args.source)
    ids = [s for s in SOUNDS if not args.only or s in args.only.split(",")]
    report_path = os.path.join(out_dir, "processing-report.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    report = json.load(open(report_path)) if os.path.exists(report_path) else {"sounds": {}}
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"sounds": {}}
    for sid in ids:
        cfg = SOUNDS[sid]
        src = fetch_source(sid, cfg, args.cache, overrides.get(sid))
        rep, man = process(sid, cfg, src, out_dir, args)
        old = measure_old(repo, sid)
        if old:
            rep["before_v2"] = old
        elif sid in report["sounds"] and "before_v2" in report["sounds"][sid]:
            rep["before_v2"] = report["sounds"][sid]["before_v2"]
        report["sounds"][sid] = rep
        if man:
            manifest["sounds"][sid] = man
        print(json.dumps({k: rep[k] for k in ("source_ranges_used_seconds", "master") if k in rep}, indent=1))
    report.update({"version": VERSION, "sample_rate": SR, "loop_seconds": LOOP_SECONDS,
                   "chunks": CHUNKS, "pad_seconds": PAD_SECONDS, "target_rms_dbfs": TARGET_RMS_DBFS,
                   "peak_ceiling_dbfs": PEAK_CEILING_DBFS,
                   "pipeline": "tools/master_audio.py"})
    with open(report_path, "w") as f:
        json.dump(report, f, indent=1)
    if not args.no_encode:
        manifest.update({"version": VERSION, "sampleRate": SR, "channels": 2, "loopFrames": L,
                         "chunkFrames": C, "padFrames": P, "chunks": CHUNKS, "joinFade": JOIN_FADE})
        manifest["sounds"] = {k: manifest["sounds"][k] for k in SOUNDS if k in manifest["sounds"]}
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=1)
    print("done")


if __name__ == "__main__":
    main()
