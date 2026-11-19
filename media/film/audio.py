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


# pad chords: (start, end, midi notes)
AM = [45, 52, 57, 60]; F = [41, 48, 53, 57]; DM = [38, 45, 50, 53]; C = [48, 52, 55, 60]; G = [43, 50, 55, 59]; CM9 = [48, 55, 59, 62, 64, 71]
for a, b, notes, amp, cut in [
    (0, 3, AM, 0.10, 700), (3, 6, AM, 0.13, 800), (6, 9, F, 0.13, 800), (9, 12, DM, 0.15, 900),
    (12, 14, C, 0.16, 3200), (14, 16, G, 0.16, 3200), (16, 18, C, 0.17, 4200), (18, 20, G, 0.17, 4200),
    (20, 22, [45, 52, 57, 60, 64], 0.17, 4200), (22, 24, F, 0.17, 4200), (24, 26.5, C, 0.16, 4200),
]:
    put(music, a, pad([m2f(n) for n in notes], b - a, 1.0, cut), 0, amp, rev=0.25)
put(music, 26.5, pad([m2f(n) for n in CM9], 3.0, 1.0, 5200, attack=0.3, release=0.8), 0, 0.2, rev=0.45)   # held final chord

# outset: soft plucks on the beat (the bot at its task)
for i, t0 in enumerate(beats(0.5, 3.0)):
    put(music, t0, pluck(m2f([69, 76, 72, 76][i % 4]), 1.0, 0.5), (-0.3, 0.3)[i % 2], 0.07, rev=0.2)
# problem: sparse low notes, a heartbeat from 9 s, ticking hats
for t0 in beats(3.0, 9.0)[::2]:
    put(music, t0, pluck(m2f(57 + (0, 3, 7, 5)[int((t0 - 3) // 1) % 4]), 1.0, 0.7), 0, 0.06, rev=0.3)
for t0 in beats(9.0, 12.0):
    put(music, t0, kick(1.0), 0, 0.22)
    put(music, t0 + BEAT / 2, hat(1.0), 0.3, 0.12)
# build into the drop: snare-roll style hats on 16ths from 11
for t0 in np.arange(11.0, 12.0, BEAT / 4):
    put(music, t0, hat(1.0), 0.2, 0.06 + 0.12 * (t0 - 11))

# drop and demo: kick on every beat, offbeat hat, clap on 2 and 4, bass, arpeggio
BASS = {12: 36, 14: 43, 16: 36, 18: 43, 20: 33, 22: 41, 24: 36}
for a in range(12, 26, 2):
    root = BASS[a]
    for k in range(4):
        put(music, a + k * BEAT, bass(m2f(root + (0, 0, 12, 7)[k]), 0.45, 1.0), 0, 0.30)
kick_times = [t for t in beats(12.0, 26.0)]
for t0 in kick_times:
    put(music, t0, kick(1.0), 0, 0.55)
    put(music, t0 + BEAT / 2, hat(1.0), 0.25, 0.12)
for t0 in beats(12.5, 26.0)[::2]:
    put(music, t0, clap(1.0), 0, 0.28, rev=0.25)
ARP = {12: C, 14: G, 16: C, 18: G, 20: [57, 60, 64, 67], 22: F, 24: C}
for a in range(12, 26, 2):
    notes = ARP[a]
    for k in range(8):
        n = notes[[1, 2, 3, 2, 1, 3, 2, 0][k] % len(notes)] + 12
        put(music, a + k * BEAT / 2, pluck(m2f(n), 1.0, 0.35), (-0.4, 0.4)[k % 2], 0.08 if a < 16 else 0.10, rev=0.25)
# resolve: drums stop at 26.5, kick-less held chord; shimmer chimes on the brand beats
for t0, n in ((26.5, 72), (27.5, 76), (28.0, 79), (28.5, 83)):
    put(music, t0, chime(m2f(n), 1.0, 2.2), 0, 0.10, rev=0.6)

# ---- effects, each at the exact visual time ----
# outset: request packets out (0.4, 1.9) and back; task dots tick as they fill (tick_t in scenes.js)
for t0 in (0.4, 1.9):
    put(sfx, t0, blip(880, 1.0), 0.6, 0.12); put(sfx, t0 + 0.75, blip(660, 1.0), -0.2, 0.10)
for i, t0 in enumerate((1.05, 1.6, 2.15, 2.7, 3.25)):
    put(sfx, t0, chime(m2f(76 + (0, 2, 4, 7, 9)[i]), 1.0, 0.8), -0.5, 0.07, rev=0.3)
put(sfx, 2.2, sweep(0.5, 600, 1800, 0.12, rising=True), 0.4, 1.0)                    # bot reaches for the tool
# problem 1: the tool plugs in at 4.0 and the cached prompt shatters
put(sfx, 4.0, tick(1400, 1.0), 0.3, 0.9); put(sfx, 4.0, impact(0.8), 0.2, 0.5)
put(sfx, 4.08, crack(1.0), 0, 0.55, rev=0.15)
for k, t0 in enumerate(np.arange(4.8, 5.3, 0.07)):                                  # segments regrow dull
    put(sfx, t0, blip(m2f(55 + k), 1.0, 0.1), 0.2, 0.08)
put(sfx, 5.2, sweep(0.8, 300, 2500, 0.18), 0.5, 1.0)                                 # request re-sent along the wire
put(sfx, 5.5, sweep(0.5, 500, 4000, 0.22, q=0.5), 0.8, 1.0)                          # camera whip to the wire
put(sfx, 6.0, blip(m2f(60), 1.0, 0.3), 0.8, 0.12, rev=0.3)                           # re-sent request lands
# problem 2: the wire breaks at 7.5
put(sfx, 7.5, zap(0.35, 1.0), 0.3, 0.5, rev=0.2); put(sfx, 7.5, impact(1.0), 0, 0.7)
put(sfx, 7.5, crack(0.8), 0.4, 0.4)
put(sfx, 7.6, glide(330, 110, 0.9, 1.0), -0.3, 0.25, rev=0.3)                        # the bot slumps
put(sfx, 8.5, sweep(0.5, 4000, 500, 0.2, q=0.5, rising=False), -0.8, 1.0)            # camera pans to the person
# problem 3: dome, arrow, no cost view
put(sfx, 9.0, pad([m2f(n) for n in (70, 77, 82)], 0.6, 1.0, 5000, 0.3, 0.3), 0.3, 0.05, rev=0.5)
put(sfx, 9.6, sweep(0.9, 500, 3500, 0.2), -0.6, 1.0)                                 # arrow flies at the dome
put(sfx, 10.5, impact(0.8), 0.2, 0.5); put(sfx, 10.5, chime(m2f(64), 1.0, 1.2), 0.3, 0.10, rev=0.5)
for k, t0 in enumerate((10.85, 11.05, 11.2)):                                         # arrow bounces away
    put(sfx, t0, tick(900 - 150 * k, 1.0), -0.5, 0.5)
put(sfx, 10.3, glide(m2f(64), m2f(61), 0.6, 1.0), 0.0, 0.06, rev=0.5)                # the dark gauge appears
# the person clicks; circle wipe reveals lia
put(sfx, 11.5, tick(2500, 1.0), -0.3, 0.9)
put(sfx, 11.5, sweep(0.5, 400, 5000, 0.25), 0, 1.0)
put(sfx, 11.8, chime(m2f(84), 1.0, 1.8), 0.1, 0.16, rev=0.5)                         # lia pops in
put(sfx, 12.0, impact(1.0), 0, 0.6)                                                  # the drop
put(sfx, 12.0, scribble(0.5, 1.0), -0.2, 0.4)                                         # the ACP link draws
for k, n in enumerate((72, 76, 79, 84)):                                              # task card rides the link (12.5-13.5)
    put(sfx, 12.55 + k * 0.25, pluck(m2f(n), 1.0, 0.4), -0.2 + k * 0.15, 0.12, rev=0.3)
put(sfx, 12.5, glide(220, 440, 0.25, 1.0), 0.6, 0.2)                                 # bot hops aside
put(sfx, 13.5, impact(0.7), 0.7, 0.4)                                                # bot lands
put(sfx, 13.5, chime(m2f(79), 1.0, 2.2), 0, 0.2, rev=0.6)                            # lia lights the request
put(sfx, 13.5, chime(m2f(91), 1.0, 2.2), 0, 0.08, rev=0.6)
for t0 in np.arange(14.2, 24.4, 1.2):                                                 # packets run lia -> model
    if t0 < 16.0: put(sfx, t0, blip(990, 1.0, 0.1), 0.6, 0.08)
for t0, n in ((14.5, 88), (15.0, 90), (15.5, 91)):                                    # meter ticks up
    put(sfx, t0, blip(m2f(n), 1.0, 0.12), 0.0, 0.10)
put(sfx, 15.4, sweep(0.6, 200, 3500, 0.35, q=0.5), 0, 1.0)                           # zoom-through into lia
put(sfx, 16.0, impact(1.0), 0, 0.8); put(sfx, 16.0, sweep(0.5, 5000, 800, 0.2, q=0.5, rising=False), 0, 1.0)
# demo 1: tools load into the menu while the cached front stays lit
for k, n in enumerate((60, 64, 67, 72)):
    t0 = 17.0 + k * 0.5
    put(sfx, t0, tick(2200, 1.0), 0.4, 0.8); put(sfx, t0, pluck(m2f(n + 12), 1.0, 0.5), 0.2, 0.16, rev=0.4)
put(sfx, 18.5, sweep(0.5, 400, 4500, 0.24), 0, 1.0)                                   # push into the retry view
# demo 2: break, retry, heal
put(sfx, 19.1, sweep(0.5, 700, 2000, 0.1), -0.3, 1.0)
put(sfx, 19.6, zap(0.25, 1.0), 0, 0.3); put(sfx, 19.6, blip(180, 1.0, 0.2), 0, 0.3)
put(sfx, 19.6, sweep(0.4, 600, 2200, 0.16), -0.7, 1.0)                                # retry arrow spins
put(sfx, 20.0, chime(m2f(84), 1.0, 1.6), 0, 0.2, rev=0.5)                             # the wire heals
put(sfx, 20.0, sweep(1.0, 300, 3500, 0.22), 0.3, 1.0)                                 # request runs through
put(sfx, 21.1, chime(m2f(88), 1.0, 1.8), 0.6, 0.2, rev=0.5)                           # the model lights
put(sfx, 21.0, sweep(0.5, 400, 4500, 0.24), 0, 1.0)
# demo 3: arrow joins and bends the turn; meter ticks after each model call
put(sfx, 21.65, sweep(1.0, 400, 2800, 0.16), -0.6, 1.0)
put(sfx, 22.65, tick(900, 1.0), 0, 0.8); put(sfx, 22.65, sweep(0.5, 300, 2400, 0.2), 0.2, 1.0)
for i, x in enumerate((500, 860, 1220, 1580)):
    t0 = 21.6 + (x - 260) / 700
    put(sfx, t0, blip(m2f(72 + 2 * i), 1.0, 0.2), -0.4 + 0.3 * i, 0.16)              # model call
    put(sfx, t0 + 0.05, tick(3000 + 500 * i, 1.0), 0.5, 0.7); put(sfx, t0 + 0.15, tick(3400 + 500 * i, 1.0), 0.5, 0.7)
put(sfx, 23.0, sweep(0.5, 300, 5000, 0.35, q=0.5), 0, 1.0)                           # accent wash up
put(sfx, 23.5, sweep(0.5, 6000, 300, 0.30, q=0.5, rising=False), 0, 1.0)             # lia opens out to the stage
put(sfx, 24.0, impact(1.0), 0, 0.7); put(sfx, 24.0, chime(m2f(72), 1.0, 2.5), 0, 0.18, rev=0.6)
# result: dots pop, bot relaxes, the check lands
put(sfx, 24.5, chime(m2f(79), 1.0, 1.8), 0, 0.14, rev=0.5)
put(sfx, 24.6, glide(330, 220, 0.5, 1.0), 0.7, 0.08)
for k, n in enumerate((72, 76, 79)):
    put(sfx, 25.0 + k * 0.1, chime(m2f(n + 12), 1.0, 2.0), -0.1 + 0.1 * k, 0.16, rev=0.5)
put(sfx, 26.0, sweep(0.5, 300, 6000, 0.30, q=0.5), 0, 1.0)                            # zoom into lia for the brand
# brand: the mark resolves, the wordmark and address land
put(sfx, 26.5, impact(0.9), 0, 0.45)
put(sfx, 26.6, scribble(0.8, 1.0), 0, 0.30)
put(sfx, 27.4, chime(m2f(91), 1.0, 2.5), 0, 0.22, rev=0.6)
put(sfx, 27.5, tick(1500, 1.0), 0, 0.7)
put(sfx, 28.2, tick(2600, 1.0), 0, 0.5)
put(sfx, 28.8, tick(3400, 1.0), 0, 0.4)

# ---- mix ----
# sidechain duck on each kick from the drop onward, softer before
duck = np.ones(N)
for t0 in list(beats(9.0, 12.0)) + kick_times:
    i = int(t0 * SR); d = int(0.28 * SR); depth = 0.5 if t0 >= 12 else 0.85
    env = 1 - (1 - depth) * np.exp(-np.arange(min(d, N - i)) / (0.07 * SR))
    duck[i:i + len(env)] = np.minimum(duck[i:i + len(env)], env)
# music reads "closed" (low-passed) through the problem beat and opens at the drop
closed = filt(music, 'low', 900, 2)
w = np.clip((np.arange(N) / SR - 11.0) / 1.0, 0, 1)[:, None]
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
