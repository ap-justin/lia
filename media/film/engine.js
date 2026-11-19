// Canvas engine: draw(t) repaints a whole frame from t alone, so renders are deterministic and the player can scrub.
let W = 1920, H = 1080;
const FPS = 30, DUR = 30, BEAT = 0.5;
const COL = {
  bg: '#0d1117', bg2: '#131a22', ink: '#e6edf3', dim: '#7d8a94', line: '#2a3340',
  panel: '#0a0e13', acc: '#7ee2b8', accDark: '#2f6b57',
};
const FONT = '"JetBrains Mono", monospace';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const prog = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const ease = {
  out_cubic: p => 1 - (1 - p) ** 3,
  in_cubic: p => p ** 3,
  in_out_cubic: p => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  out_expo: p => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  in_expo: p => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  out_back: p => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};
function spring_t(dt, damp = 7, freq = 2.2) {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-damp * dt) * Math.cos(2 * Math.PI * freq * dt);
}
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
// keys: [[t, v...], ...] eased per segment; returns the interpolated tuple
function track(t, keys, fn = ease.in_out_cubic) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      const p = fn((t - a[0]) / (b[0] - a[0]));
      return a.slice(1).map((v, k) => lerp(v, b[k + 1], p));
    }
  }
  return keys[keys.length - 1].slice(1);
}
const pulse = (t, t0, d = 0.35) => (t < t0 || t > t0 + d ? 0 : Math.sin(Math.PI * (t - t0) / d));
const alpha_of = (t, a, b, fi = 0.25, fo = 0.25) => ease.out_cubic(prog(t, a, a + fi)) * (1 - ease.in_cubic(prog(t, b - fo, b)));

const canvas = typeof document !== 'undefined' ? document.getElementById('c') : null;
const ctx = canvas ? canvas.getContext('2d') : null;

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fill_stroke(fill, stroke, lw = 5) {
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
}
function circle(x, y, r, fill, stroke, lw = 5) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); fill_stroke(fill, stroke, lw); }
function line(x0, y0, x1, y1, col, lw = 5) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
}

// polyline paths: pts = [[x,y],...]
function poly_len(pts) { let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return L; }
function poly_at(pts, u) {
  const L = poly_len(pts); let d = clamp01(u) * L;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= s || i === pts.length - 2) { const p = s ? d / s : 0; return { x: lerp(a[0], b[0], p), y: lerp(a[1], b[1], p), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
    d -= s;
  }
}
function stroke_poly(pts, col, lw, from = 0, to = 1) {
  const L = poly_len(pts);
  ctx.save(); ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.setLineDash([Math.max(0, (to - from) * L), L + 10]); ctx.lineDashOffset = -from * L; ctx.stroke(); ctx.restore();
}

function text(str, x, y, size, col, weight = 700, align = 'center', a = 1) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha *= a; ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = col;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(str, x, y); ctx.restore();
}
// words rise out of a clip mask with stagger; masked exit. travel 1.3x size in, 1.6x out so descenders stay hidden.
function kinetic(str, x, y, t, t0, t1, size = 56, col = COL.ink, weight = 700) {
  if (t < t0 || t > t1) return;
  ctx.save(); ctx.font = `${weight} ${size}px ${FONT}`;
  const words = str.split(' '), sp = ctx.measureText(' ').width;
  const ws = words.map(w => ctx.measureText(w).width);
  const total = ws.reduce((a, b) => a + b, 0) + sp * (words.length - 1);
  let cx = x - total / 2;
  ctx.beginPath(); ctx.rect(x - total / 2 - 20, y - size * 1.05, total + 40, size * 1.5); ctx.clip();
  words.forEach((w, i) => {
    const pin = ease.out_cubic(prog(t, t0 + i * 0.07, t0 + i * 0.07 + 0.38));
    const pout = ease.in_cubic(prog(t, t1 - 0.3 + i * 0.03, t1 - 0.02));
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(w, cx, y + (1 - pin) * size * 1.3 - pout * size * 1.6);
    cx += ws[i] + sp;
  });
  ctx.restore();
}

// lia mark: three filled paths on a 32-unit grid
const MARK = ['M14 2H20L32 8L28 10H10Z', 'M9 12H24A10 10 0 0 1 14 22H4Z', 'M3 24H12L0 30Z'];
const MARK_P = typeof Path2D !== 'undefined' ? MARK.map(d => new Path2D(d)) : [];
function draw_mark(cx, cy, size, col, a = 1) {
  ctx.save(); ctx.globalAlpha *= a; ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 32, size / 32);
  ctx.fillStyle = col; MARK_P.forEach(p => ctx.fill(p)); ctx.restore();
}

// finishing pass: tiled grain (offset per frame) and a soft vignette
let grain_tile = null;
function make_grain() {
  const g = document.createElement('canvas'); g.width = g.height = 256;
  const gc = g.getContext('2d'), im = gc.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = (hash(i + 1) * 255) | 0; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  gc.putImageData(im, 0, 0); return g;
}
function finish(t) {
  if (!grain_tile) grain_tile = make_grain();
  const f = Math.floor(t * FPS), ox = (hash(f * 3.1) * 256) | 0, oy = (hash(f * 7.7) * 256) | 0;
  ctx.save(); ctx.globalAlpha = 0.04; ctx.globalCompositeOperation = 'overlay';
  for (let y = -256 + oy; y < H; y += 256) for (let x = -256 + ox; x < W; x += 256) ctx.drawImage(grain_tile, x, y);
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.0);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
}

function backdrop() {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, H * 0.95);
  g.addColorStop(0, COL.bg2); g.addColorStop(1, COL.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
