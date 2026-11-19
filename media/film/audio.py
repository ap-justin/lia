"""Synthesized score and effects for the 30 s film: 120 BPM, 48 kHz stereo, music + sfx buses, reverb send.

usage: python audio.py [WORK_DIR]   -> WORK_DIR/score.wav and score.mp3 (MP3 is what the player embeds)
Every effect sits on a visual time from scenes.js; the cause is named beside it.
"""
import pathlib, subprocess, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

SR, DUR, BPM = 48000, 30.0, 120
BEAT = 60 / BPM
N = int(SR * DUR)
WORK = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).parent / 'work'
rng = np.random.default_rng(7)

music = np.zeros((N, 2))
sfx = np.zeros((N, 2))
send = np.zeros((N, 2))   # reverb send, fed by chimes, pads and claps


def m2f(n): return 440.0 * 2 ** ((n - 69) / 12)


def filt(x, kind, f, order=2):
    return sosfilt(butter(order, f, btype=kind, fs=SR, output='sos'), x)


def put(bus, t0, mono, pan=0.0, amp=1.0, rev=0.0):
    i = int(t0 * SR)
    if i >= N or i < 0:
        return
    seg = mono[: N - i] * amp
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    bus[i:i + len(seg), 0] += seg * l * 1.414
    bus[i:i + len(seg), 1] += seg * r * 1.414
    if rev:
        send[i:i + len(seg), 0] += seg * l * rev
        send[i:i + len(seg), 1] += seg * r * rev


def tt(d): return np.arange(int(d * SR)) / SR
def prog_s(t, a, b): return min(1.0, max(0.0, (t - a) / (b - a)))


# ---- instruments ----
def kick(amp=1.0):
    t = tt(0.4); f = 45 + 110 * np.exp(-t * 28)
    return amp * (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) + 0.3 * np.exp(-t * 400) * rng.standard_normal(len(t)))


def hat(amp=1.0, d=0.05):
    t = tt(d); return amp * filt(rng.standard_normal(len(t)), 'high', 7000) * np.exp(-t * (60 if d < 0.08 else 14))


def clap(amp=1.0):
    t = tt(0.25); n = filt(rng.standard_normal(len(t)), 'band', [900, 3500])
    env = sum(np.exp(-np.clip(t - o, 0, None) * 60) * (t >= o) for o in (0, 0.012, 0.026)) * 0.5 + np.exp(-t * 18) * 0.5
    return amp * n * env


def pluck(f, amp=1.0, d=0.6):
    t = tt(d); y = sum(np.sin(2 * np.pi * f * k * t) * (0.5 / k) * np.exp(-t * (6 + 4 * k)) for k in range(1, 6))
    return amp * y * np.minimum(1, t * 400)


def bass(f, d=0.5, amp=1.0):
    t = tt(d); saw = 2 * ((f * t) % 1) - 1
    y = filt(saw, 'low', 420) * 0.6 + np.sin(2 * np.pi * f * t) * 0.7
    return amp * y * np.minimum(1, t * 200) * np.exp(-t * 2.2)


def chime(f, amp=1.0, d=1.6):
    t = tt(d); y = sum(np.sin(2 * np.pi * f * r * t) * a * np.exp(-t * dec) for r, a, dec in ((1, 1, 2.2), (2.76, 0.4, 3.5), (5.4, 0.2, 6), (8.9, 0.1, 9)))
    return amp * y * np.minimum(1, t * 800)


def pad(freqs, d, amp=1.0, cutoff=1800, attack=0.5, release=0.8):
    t = tt(d + release); y = np.zeros(len(t))
    for f in freqs:
        for det in (-0.007, 0.0, 0.007):
            y += 2 * (((f * (1 + det)) * t + det * 7) % 1) - 1
    y = filt(y, 'low', cutoff) / (len(freqs) * 3)
    env = np.minimum(1, t / attack) * np.where(t < d, 1, np.exp(-(t - d) * 6 / release))
    return amp * y * env


def sweep(d, f0, f1, amp=1.0, q=0.35, rising=True):
    # block-wise swept bandpass noise
    n = int(d * SR); out = np.zeros(n); blk = 512; z = None
    for i in range(0, n, blk):
        p = i / n; f = f0 * (f1 / f0) ** p
        sos = butter(2, [f * (1 - q), min(f * (1 + q), SR / 2 - 100)], btype='band', fs=SR, output='sos')
        seg, z = sosfilt(sos, rng.standard_normal(min(blk, n - i)), zi=z if z is not None else np.zeros((sos.shape[0], 2)))
        out[i:i + len(seg)] = seg
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** (1.5 if rising else 1)
    if rising: env = np.linspace(0, 1, n) ** 1.6 * (1 - np.linspace(0, 1, n)) ** 0.3
    return amp * out * env * 4


def impact(amp=1.0):
    t = tt(0.9); sub = np.sin(2 * np.pi * (52 + 40 * np.exp(-t * 14)) * t) * np.exp(-t * 4.5)
    return amp * (sub + 0.5 * filt(rng.standard_normal(len(t)), 'low', 2500) * np.exp(-t * 18))


def blip(f, amp=1.0, d=0.18):
    t = tt(d); return amp * np.sin(2 * np.pi * f * t) * np.exp(-t * 22) * np.minimum(1, t * 600)


def tick(f=1800, amp=1.0):
    t = tt(0.04); return amp * filt(rng.standard_normal(len(t)), 'band', [f * 0.7, f * 1.3]) * np.exp(-t * 120)


def zap(d=0.3, amp=1.0):
    t = tt(d); f = 3000 * np.exp(-t * 9) + 200
    return amp * np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-t * 12) * 0.5 + amp * 0.3 * filt(rng.standard_normal(len(t)), 'high', 3000) * np.exp(-t * 30)


def glide(f0, f1, d, amp=1.0):
    t = tt(d); f = f0 * (f1 / f0) ** (t / d)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.4 * np.sin(4 * np.pi * np.cumsum(f) / SR)
    return amp * y * np.exp(-t * 2.5) * np.minimum(1, t * 60)


def crack(amp=1.0):
    t = tt(0.5); n = filt(rng.standard_normal(len(t)), 'band', [1500, 9000])
    ev = sum((t >= o) * np.exp(-np.clip(t - o, 0, None) * 90) for o in (0, 0.03, 0.07, 0.12, 0.2, 0.3)) / 3
    return amp * n * ev


def scribble(d, amp=1.0):
    t = tt(d); n = filt(rng.standard_normal(len(t)), 'band', [2500, 7000]); return amp * n * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t)) * np.sin(np.pi * t / d) * 0.5


# ---- arrangement (all times in seconds on the 0.5 s beat grid) ----
def beats(a, b): return np.arange(a, b, BEAT)


LAND = [4.35 + 0.5 * k for k in range(6)]          # crate k thuds into the pile (scenes.js land_t)
CHIP = [21.0 + 0.5 * k for k in range(6)]          # crate k shrinks into a chip (scenes.js chip_t)
DROP = 19.5                                         # the lia block clicks into the socket

AM = [45, 52, 57, 60]; F = [41, 48, 53, 57]; DM = [38, 45, 50, 53]; C = [48, 52, 55, 60]; G = [43, 50, 55, 59]; CM9 = [48, 55, 59, 62, 64, 71]
# pads: light and open at the start, closed and low while the server fills, bright after the click
for a, b, notes, amp, cut in [
    (0, 4, AM, 0.50, 1200), (4, 8, AM, 0.30, 500), (8, 11, DM, 0.55, 600), (11, 12, [38, 45, 50, 53, 56], 0.30, 600),
    (12, 16, [45, 52, 57, 60, 64], 0.2, 900), (16, DROP, [45, 52, 57, 60], 0.2, 1200),
    (DROP, 21, C, 0.17, 4200), (21, 22.5, G, 0.17, 4200), (22.5, 24, [45, 52, 57, 60, 64], 0.17, 4200), (24, 25.5, F, 0.17, 4200), (25.5, 26.5, C, 0.16, 4200),
]:
    put(music, a, pad([m2f(n) for n in notes], b - a, 1.0, cut), 0, amp, rev=0.25)
put(music, 26.5, pad([m2f(n) for n in CM9], 3.0, 1.0, 5200, attack=0.3, release=0.8), 0, 0.2, rev=0.45)   # held final chord
# low drag under the problem: a long sub note every two beats, rumble that swells with the gauge
for t0 in beats(4.0, DROP)[::2]:
    put(music, t0, bass(m2f(33 if t0 < 11 else 31), 1.4, 1.0), 0, 0.26 if t0 < 12 else 0.2)
rum = filt(rng.standard_normal(int(7.0 * SR)), 'low', 160) * np.linspace(0.05, 0.5, int(7.0 * SR)) ** 1.5
put(music, 4.0, rum, 0, 0.22)

# outset: soft plucks on the beat (the bots at work)
for i, t0 in enumerate(beats(0.5, 4.0)):
    put(music, t0, pluck(m2f([69, 76, 72, 76][i % 4]), 1.0, 0.5), (-0.3, 0.3)[i % 2], 0.17, rev=0.2)
# problem: a heartbeat kick that tightens, ticking hats from the red zone
for t0 in beats(4.0, 12.0):
    put(sfx, t0, kick(1.0), 0, 0.25 + 0.35 * prog_s(t0, 4, 10))
for t0 in beats(8.0, 12.0):
    put(music, t0 + BEAT / 2, hat(1.0), 0.3, 0.10)
# inside the crate: sparse bell notes as each unused part appears
for k, t0 in enumerate((12.5, 13.0, 13.5, 14.0, 14.5)):
    put(music, t0, chime(m2f((69, 72, 76, 74, 71)[k]), 1.0, 1.6), (-0.4, -0.2, 0, 0.2, 0.4)[k], 0.09, rev=0.5)
# build into the click: hats on 16ths from the parts falling away
for t0 in np.arange(16.0, DROP, BEAT / 4):
    put(music, t0, hat(1.0), 0.2, 0.04 + 0.12 * prog_s(t0, 16, DROP))

# the release: kick on every beat, offbeat hat, clap on 2 and 4, bass, bright arpeggio
BASS = [(19.5, 36), (21.0, 43), (22.5, 33), (24.0, 41), (25.5, 36)]
ends = [21.0, 22.5, 24.0, 25.5, 26.5]
for (a, root), b in zip(BASS, ends):
    for t0 in beats(a, b):
        put(music, t0, bass(m2f(root + (0, 12, 7, 12)[int((t0 - a) / BEAT) % 4]), 0.45, 1.0), 0, 0.30)
kick_times = list(beats(DROP, 26.0))
for t0 in kick_times:
    put(sfx, t0, kick(1.0), 0, 0.55); put(music, t0 + BEAT / 2, hat(1.0), 0.25, 0.12)
for t0 in beats(20.0, 26.0)[::2]:
    put(music, t0, clap(1.0), 0, 0.28, rev=0.25)
ARP = [(19.5, 21.0, C), (21.0, 22.5, G), (22.5, 24.0, [57, 60, 64, 67]), (24.0, 25.5, F), (25.5, 26.5, C)]
for a, b, notes in ARP:
    for k, t0 in enumerate(np.arange(a, b, BEAT / 2)):
        n = notes[[1, 2, 3, 2, 1, 3, 2, 0][k % 8] % len(notes)] + 12
        put(music, t0, pluck(m2f(n), 1.0, 0.35), (-0.4, 0.4)[k % 2], 0.10, rev=0.25)
for t0, n in ((26.5, 72), (27.5, 76), (28.0, 79), (28.5, 83)):                       # drums stop; shimmer on the brand beats
    put(music, t0, chime(m2f(n), 1.0, 2.2), 0, 0.10, rev=0.6)

# ---- effects, each at the exact visual time ----
# outset: bots arrive through the door (hop-walk) at 1.0, 2.0, 3.0
for t0 in (1.0, 2.0, 3.0):
    for k in range(4):
        put(sfx, t0 + 0.12 + 0.28 * k, tick(1100, 1.0), -0.7 + 0.1 * k, 0.35)
    put(sfx, t0 + 1.2, blip(m2f(81), 1.0, 0.2), -0.2, 0.10, rev=0.3)
# problem: each crate thuds into the pile and the gauge steps up
for k, t0 in enumerate(LAND):
    put(sfx, t0 - 0.35, sweep(0.35, 2400, 500, 0.12, q=0.5, rising=False), -0.2, 1.0)    # the crate drops in
    put(sfx, t0, impact(1.0), -0.5 + 0.2 * k * 0.5, 0.42)
    put(sfx, t0, filt(rng.standard_normal(int(0.4 * SR)), 'low', 1200) * np.exp(-tt(0.4) * 9), -0.3, 0.5)   # dust
    put(sfx, t0 + 0.1, glide(m2f(52 + 2 * k), m2f(50 + 2 * k), 0.4, 1.0), 0.8, 0.10 + 0.01 * k)             # gauge steps up
    put(sfx, t0 + 0.05, tick(500, 1.0), 0.4, 0.5)                                                           # rope pulls tight
# quake and the red zone: rumble, then an alarm on each beat
put(sfx, 7.5, filt(rng.standard_normal(int(1.0 * SR)), 'low', 220) * np.sin(np.pi * tt(1.0)), 0, 1.0)
for t0 in beats(8.0, 11.0):
    put(sfx, t0, blip(m2f(81), 1.0, 0.14), 0.7, 0.26); put(sfx, t0, blip(m2f(74), 1.0, 0.14), 0.7, 0.2)
# a new bot walks up, hits the pile at 10.0 and the "no entry" sign lights
for k in range(3):
    put(sfx, 9.2 + 0.28 * k, tick(1000, 1.0), -0.8, 0.35)
put(sfx, 10.0, impact(0.9), -0.7, 0.6); put(sfx, 10.0, crack(0.7), -0.5, 0.3)
put(sfx, 10.0, glide(220, 180, 0.35, 1.0), 0, 0.14)                                    # buzzer on the sign
put(sfx, 10.1, glide(220, 180, 0.35, 1.0), 0, 0.14)
put(sfx, 10.7, glide(m2f(64), m2f(52), 0.7, 1.0), -0.6, 0.12, rev=0.3)                 # the bot sags
# camera dives into one heavy crate; the doors open at 12.0
put(sfx, 11.0, sweep(1.0, 200, 5000, 0.35, q=0.5), 0, 1.0)
put(sfx, 11.95, impact(0.9), 0, 0.55); put(sfx, 11.95, sweep(0.5, 3000, 400, 0.22, q=0.5, rising=False), 0, 1.0)
put(sfx, 12.0, chime(m2f(88), 1.0, 2.0), 0, 0.14, rev=0.6)
# parts pop at 12.5-14.5 and are crossed out half a second later
for k in range(5):
    put(sfx, 12.5 + 0.5 * k, blip(m2f(72 + 3 * k), 1.0, 0.2), (-0.5 + 0.25 * k), 0.15, rev=0.3)
    put(sfx, 13.0 + 0.5 * k, sweep(0.3, 1500, 4500, 0.12, q=0.5), (-0.5 + 0.25 * k), 1.0)
    put(sfx, 13.3 + 0.5 * k, tick(3500, 1.0), (-0.5 + 0.25 * k), 0.5)
put(sfx, 15.4, sweep(0.6, 200, 2500, 0.3, q=0.5), 0, 1.0)                              # the shaking before they fall
# the unused parts fall away one after another
for k in range(5):
    put(sfx, 16.0 + 0.25 * k, glide(m2f(84 - 3 * k), m2f(60 - 3 * k), 0.7, 1.0), -0.5 + 0.25 * k, 0.13, rev=0.3)
    put(sfx, 16.0 + 0.25 * k, sweep(0.5, 2500, 500, 0.12, q=0.5, rising=False), -0.5 + 0.25 * k, 1.0)
# what is left becomes lia
put(sfx, 17.0, chime(m2f(79), 1.0, 2.0), 0, 0.18, rev=0.6)
put(sfx, 17.4, scribble(0.4, 1.0), 0, 0.3)
put(sfx, 17.5, chime(m2f(91), 1.0, 2.0), 0, 0.10, rev=0.6)
put(sfx, 18.0, sweep(1.0, 5000, 200, 0.3, q=0.5, rising=False), 0, 1.0)                # the camera pulls back out
for k, n in enumerate((60, 64, 67, 72, 76)):                                           # the block flies to the socket (18.4-19.5)
    put(sfx, 18.45 + 0.2 * k, pluck(m2f(n + 12), 1.0, 0.4), -0.3 + 0.15 * k, 0.12, rev=0.3)
put(sfx, 19.2, sweep(0.3, 400, 6000, 0.3, q=0.5), 0, 1.0)
# the click into the socket at 19.5, then the rack lights up
put(sfx, DROP, tick(2200, 1.0), 0, 1.0); put(sfx, DROP, impact(1.0), 0, 0.8)
put(sfx, DROP, chime(m2f(84), 1.0, 2.5), 0, 0.22, rev=0.6); put(sfx, DROP, chime(m2f(96), 1.0, 2.5), 0, 0.09, rev=0.6)
put(sfx, DROP + 0.05, scribble(1.0, 1.0), 0, 0.35)                                     # LED strip sweeps along the rail
# result: each crate shrinks into a chip on its bot's back on the beat
for k, t0 in enumerate(CHIP):
    put(sfx, t0, sweep(0.5, 3000, 600, 0.14, q=0.5, rising=False), -0.8 + 0.3 * k, 1.0)
    put(sfx, t0 + 0.5, tick(3000 + 300 * k, 1.0), -0.8 + 0.3 * k, 0.7)
    put(sfx, t0 + 0.5, chime(m2f((72, 74, 76, 79, 81, 84)[k]), 1.0, 1.4), -0.8 + 0.3 * k, 0.17, rev=0.5)
put(sfx, 23.2, sweep(1.0, 400, 3500, 0.2), 0, 1.0)                                      # bots spread out
put(sfx, 24.4, chime(m2f(91), 1.0, 2.0), 0.4, 0.12, rev=0.6)                           # free slots appear
for t0, pan in ((24.5, -0.8), (25.0, -0.8)):                                            # new bots slide in
    put(sfx, t0, sweep(0.6, 500, 2500, 0.16), pan, 1.0); put(sfx, t0 + 0.6, tick(1800, 1.0), pan + 0.3, 0.8)
put(sfx, 26.0, sweep(0.5, 300, 6000, 0.35, q=0.5), 0, 1.0)                             # zoom to the mark
# brand: the mark resolves, the wordmark, the line and the address land
put(sfx, 26.5, impact(0.9), 0, 0.45)
put(sfx, 26.6, scribble(0.8, 1.0), 0, 0.30)
put(sfx, 27.4, chime(m2f(91), 1.0, 2.5), 0, 0.22, rev=0.6)
put(sfx, 27.5, tick(1500, 1.0), 0, 0.7)
put(sfx, 27.9, tick(2000, 1.0), 0, 0.5)
put(sfx, 28.4, tick(2600, 1.0), 0, 0.5)
put(sfx, 28.9, tick(3400, 1.0), 0, 0.4)

# ---- mix ----
# sidechain duck on each kick from the drop onward, softer before
duck = np.ones(N)
for t0 in list(beats(4.0, 12.0)) + kick_times:
    i = int(t0 * SR); d = int(0.28 * SR); depth = 0.5 if t0 >= DROP else 0.88
    env = 1 - (1 - depth) * np.exp(-np.arange(min(d, N - i)) / (0.07 * SR))
    duck[i:i + len(env)] = np.minimum(duck[i:i + len(env)], env)
# music reads closed (low-passed) through the heavy beats and opens on the click
closed = filt(music, 'low', 900, 2)
w = np.clip((np.arange(N) / SR - 18.5) / 1.0, 0, 1)[:, None]
music = (closed * (1 - w) + music * w) * duck[:, None]

ir_n = int(2.0 * SR); ir_t = np.arange(ir_n) / SR
ir = np.stack([rng.standard_normal(ir_n) * np.exp(-ir_t * 2.6) for _ in range(2)], 1) * 0.05
rev = np.stack([fftconvolve(filt(send[:, c], 'high', 200, 1), ir[:, c])[:N] for c in range(2)], 1)

mix = music * 0.9 + sfx * 1.0 + rev * 0.8
mix = np.tanh(mix * 1.4) / np.tanh(1.4) * 0.95
fade = np.clip((DUR - np.arange(N) / SR) / 0.5, 0, 1)
mix *= fade[:, None]
mix *= 0.891 / np.max(np.abs(mix))                                                    # about -1 dBFS
WORK.mkdir(exist_ok=True)
wavfile.write(WORK / 'score.wav', SR, (mix * 32767).astype(np.int16))
print('peak', round(20 * np.log10(np.max(np.abs(mix))), 2), 'dBFS')
for a in range(0, int(DUR), 2):
    seg = mix[a * SR:(a + 2) * SR]
    print(f'{a:2d}-{a + 2:2d} s  rms {20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9):6.1f} dBFS')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(WORK / 'score.wav'), '-c:a', 'libmp3lame', '-b:a', '160k', str(WORK / 'score.mp3')], check=True)
