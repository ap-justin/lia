// The whole frame is the server's memory: one rounded field. Agents are flat single-color shapes with two eyes; a session is the soft gray halo around one.
const FIELD = { x: 110, y: 80, w: 1700, h: 880, r: 80 };
const RED = '#ff4433', DIM_LINE = '#3b4655', EYE = '#12161c', HALO = [170, 178, 190];
const KINDS = [
  { shape: 'tri', col: '#ff7eb6' }, { shape: 'hex', col: '#ffd24d' }, { shape: 'circle', col: '#a58bff' },
  { shape: 'sq', col: '#ff9a4a' }, { shape: 'hex', col: '#62d26f' }, { shape: 'pill', col: '#ff6070' },
];
const R_AGENT = 68, R_HALO = 1.9, RING_K = 1.3;
const ORIG = [{ kind: 0, x: 520, y: 360 }, { kind: 1, x: 960, y: 520 }, { kind: 2, x: 1400, y: 360 }, { kind: 3, x: 720, y: 760 }, { kind: 4, x: 1240, y: 760 }];
const COLLAPSE_T = [21.0, 17.5, 21.5, 22.0, 22.5];            // when each original halo becomes a ring
const WAVE_N = 17, WAVE_T0 = 23.0, WAVE_DT = 0.15;
const HERO = 1;                                                // the agent the camera dives into
const ZOOM = 3.0;

// ---------- agents that stream in at the end ----------
const AGENTS = ORIG.map((a, i) => ({ ...a, r: R_AGENT, arrive: -1, orig: i }));
(function make_wave() {
  const placed = ORIG.map(a => [a.x, a.y]);
  for (let k = 0; k < WAVE_N; k++) {
    let p = null;
    for (let tries = 0; tries < 400 && !p; tries++) {
      const x = FIELD.x + 110 + hash(k * 7.3 + tries * 1.7) * (FIELD.w - 220), y = FIELD.y + 100 + hash(k * 13.1 + tries * 2.9) * (FIELD.h - 200);
      const min = tries < 300 ? 175 : 140;
      if (placed.every(q => Math.hypot(q[0] - x, q[1] - y) >= min)) p = [x, y];
    }
    placed.push(p);
    const kind = k === 0 ? 5 : (k + 2) % 6, side = k === 0 ? 3 : Math.floor(hash(k * 5.1) * 4);
    const from = side === 0 ? [p[0], FIELD.y - 160] : side === 1 ? [FIELD.x + FIELD.w + 160, p[1]] : side === 2 ? [p[0], FIELD.y + FIELD.h + 160] : [-120, p[1]];
    AGENTS.push({ kind, x: p[0], y: p[1], r: 48, arrive: WAVE_T0 + WAVE_DT * k, from: k === 0 ? [-10, 520] : from, wave: k });
  }
})();

// ---------- messages between agents ----------
const MSGS = [];
(function make_msgs() {
  const pairs = [[0, 1], [1, 2], [1, 3], [3, 4], [2, 4], [0, 3], [1, 4], [0, 2]];
  const add = (t0, a, b, d, phase) => MSGS.push({ t0, a, b, d, phase });
  let k = 0;
  for (let t = 0.3; t < 3.95; t += 0.3, k++) { const p = pairs[k % pairs.length]; k % 2 ? add(t, p[1], p[0], 0.5, 'a') : add(t, p[0], p[1], 0.5, 'a'); }
  for (let t = 4.0; t < 10.6; t += 0.25, k++) { const p = pairs[Math.floor(hash(k * 3.3) * pairs.length)]; hash(k) > 0.5 ? add(t, p[0], p[1], 0.45, 'b') : add(t, p[1], p[0], 0.45, 'b'); }
  for (let t = 20.6; t < 26.0; t += (t < 22.4 ? 0.2 : 0.11), k++) {
    const live = AGENTS.map((a, i) => i).filter(i => AGENTS[i].arrive + 0.7 <= t);
    const a = live[Math.floor(hash(k * 5.7) * live.length)];
    const near = live.filter(j => j !== a && Math.hypot(AGENTS[j].x - AGENTS[a].x, AGENTS[j].y - AGENTS[a].y) < 460);
    if (near.length) add(t, a, near[Math.floor(hash(k * 9.1) * near.length)], t < 22.4 ? 0.4 : 0.3, 'd');
  }
})();

// ---------- state as pure functions of t ----------
const swell = (i, t) => {
  let g = 1;
  for (const m of MSGS) if (m.phase === 'b' && m.b === i) g += 0.32 * ease.out_cubic(prog(t, m.t0 + m.d - 0.05, m.t0 + m.d + 0.4));
  return g;
};
const collapse = (i, t) => (i < 5 ? ease.in_out_cubic(prog(t, COLLAPSE_T[i], COLLAPSE_T[i] + 0.55)) : 1);
const halo_r = (i, t) => lerp(R_AGENT * R_HALO * swell(i, t), AGENTS[i].r * RING_K, collapse(i, t));
const here = (i, t) => t >= AGENTS[i].arrive;
function agent_pos(i, t) {
  const a = AGENTS[i];
  if (!a.from) return [a.x, a.y];
  const p = ease.out_back(prog(t, a.arrive, a.arrive + 0.7));
  return [lerp(a.from[0], a.x, p), lerp(a.from[1], a.y, p)];
}
function coverage(t) {
  let A = 0;
  for (let i = 0; i < 5; i++) A += Math.PI * halo_r(i, t) ** 2 * (1 - collapse(i, t) * 0.9);
  return A / (FIELD.w * FIELD.h * 0.85);
}
const strain_at = t => ease.in_out_cubic(prog(coverage(t), 0.55, 1.0));
function pop_at(i, t) {   // a message landing wakes the agent
  let s = 0;
  for (const m of MSGS) if (m.b === i) { const dt = t - (m.t0 + m.d); if (dt > 0 && dt < 0.7) s += Math.exp(-dt * 9) * Math.cos(dt * 22); }
  return s;
}

// ---------- drawing ----------
function agent_path(shape, r) {
  ctx.beginPath();
  if (shape === 'tri') { for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * 2 * Math.PI / 3; ctx.lineTo(Math.cos(a) * r * 1.12, Math.sin(a) * r * 1.12 + r * 0.14); } ctx.closePath(); }
  else if (shape === 'hex') { for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); }
  else if (shape === 'circle') ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
  else if (shape === 'sq') { const h = r * 0.82; ctx.moveTo(-h, -h); ctx.lineTo(h, -h); ctx.lineTo(h, h); ctx.lineTo(-h, h); ctx.closePath(); }
  else { rr(-r * 1.15, -r * 0.68, r * 2.3, r * 1.36, r * 0.68); }
}
// mood: squint 0..1 (strained), pleased 0..1 (curved eyes), curious (eyes wide and glancing up)
function eyes(r, shape, mood, t, seed) {
  const ey = shape === 'tri' ? r * 0.16 : 0, ex = shape === 'pill' ? r * 0.42 : r * 0.28;
  const blink = ((t + seed * 1.7) % 3.6) > 3.47 ? 0.12 : 1;
  const sq = mood.squint || 0, pl = mood.pleased || 0, cu = mood.curious || 0;
  const lx = (mood.look ? mood.look[0] : 0) * r * 0.07, ly = (mood.look ? mood.look[1] : 0) * r * 0.07 - cu * r * 0.05;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(s * ex + lx, ey + ly);
    const rx = r * 0.12 * (1 + 0.25 * cu), ry = r * 0.19 * (1 + 0.3 * cu) * (1 - 0.82 * sq) * blink;
    if (pl > 0.5) { ctx.beginPath(); ctx.arc(0, r * 0.06, r * 0.13, 1.12 * Math.PI, 1.88 * Math.PI); ctx.strokeStyle = EYE; ctx.lineWidth = r * 0.075; ctx.lineCap = 'round'; ctx.stroke(); }
    else { ctx.rotate(sq * s * -0.28); ctx.beginPath(); ctx.ellipse(0, 0, rx, Math.max(r * 0.03, ry), 0, 0, Math.PI * 2); ctx.fillStyle = EYE; ctx.fill(); }
    ctx.restore();
  }
}
function agent_draw(i, t, mood, extra = {}) {
  const [x, y] = extra.pos || agent_pos(i, t), a = AGENTS[i], k = KINDS[a.kind];
  const breathe = 1 + 0.03 * Math.sin(t * 2.2 + i) + 0.09 * pop_at(i, t);
  ctx.save(); ctx.translate(x, y); ctx.rotate((mood.tilt || 0) + 0.02 * Math.sin(t * 1.3 + i)); ctx.scale(breathe, breathe * (extra.squash || 1));
  agent_path(k.shape, a.r); ctx.fillStyle = k.col; ctx.fill();
  ctx.strokeStyle = k.col; ctx.lineWidth = a.r * 0.28; ctx.lineJoin = 'round'; ctx.stroke();
  eyes(a.r, k.shape, mood, t, i);
  ctx.restore();
}

function halo_draw(i, t) {
  const [x, y] = agent_pos(i, t), R = halo_r(i, t), c = collapse(i, t);
  if (c < 0.98) {
    const g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
    g.addColorStop(0, `rgba(${HALO},0.10)`); g.addColorStop(0.75, `rgba(${HALO},0.20)`); g.addColorStop(1, `rgba(${HALO},0)`);
    ctx.save(); ctx.globalAlpha *= 1 - c; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (c > 0.02) {
    ctx.save(); ctx.globalAlpha *= c; ctx.shadowColor = COL.acc; ctx.shadowBlur = 16;
    circle(x, y, R, null, COL.acc, AGENTS[i].r * 0.07 + 1.5); ctx.restore();
  }
}

function field_path(inset, r) { rr(FIELD.x + inset, FIELD.y + inset, FIELD.w - 2 * inset, FIELD.h - 2 * inset, r); }
function field_draw(t, strain) {
  ctx.save(); field_path(0, FIELD.r); ctx.fillStyle = '#0e141b'; ctx.fill(); ctx.restore();
  const flick = strain > 0.05 ? (0.55 + 0.45 * (Math.sin(t * 2 * Math.PI * 4) > 0 ? 1 : 0.35)) : 1;
  const inset = 16 * strain, lw = 3 + 6 * strain;
  const calm = t >= 21 ? ease.out_cubic(prog(t, 21, 24)) : 0;
  const base = col_mix_rgb(DIM_LINE, '#3f7c68', calm);
  ctx.save(); ctx.globalAlpha *= strain > 0.05 ? flick : 1;
  field_path(inset, FIELD.r - inset * 0.5); ctx.strokeStyle = strain > 0.05 ? col_mix_rgb(base, RED, strain) : base; ctx.lineWidth = lw; ctx.stroke();
  ctx.restore();
}
function col_mix_rgb(a, b, p) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(lerp(v, pb[i], clamp01(p))).toString(16).padStart(2, '0')).join('');
}

function messages_draw(t) {
  for (const m of MSGS) {
    if (t < m.t0 || t > m.t0 + m.d + 0.25) continue;
    if (!here(m.a, t) || !here(m.b, t)) continue;
    const A = agent_pos(m.a, t), B = agent_pos(m.b, t), p = clamp01((t - m.t0) / m.d), fade = 1 - prog(t, m.t0 + m.d, m.t0 + m.d + 0.25);
    const green = m.phase === 'd', col = green ? COL.acc : COL.ink;
    ctx.save(); ctx.globalAlpha *= 0.28 * fade; line(A[0], A[1], B[0], B[1], col, 3); ctx.restore();
    const e = ease.in_out_cubic(p);
    if (p < 1) { ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 12; circle(lerp(A[0], B[0], e), lerp(A[1], B[1], e), green ? 7 : 8, col); ctx.restore(); }
  }
}

function mood_of(i, t, strain) {
  const a = AGENTS[i];
  if (a.wave !== undefined) return { pleased: 1, look: [Math.sin(t * 2 + i), 0] };
  const c = collapse(i, t), look = [Math.sin(t * 0.9 + i * 2), Math.cos(t * 0.7 + i)];
  let m = { look };
  if (t >= 4 && t < COLLAPSE_T[i] + 0.3) m = { squint: strain, look };
  if (i === HERO && t >= 12.2 && t < 17.5) m = { curious: 1, look: [Math.sin(t * 1.5), -0.4], tilt: 0.08 * Math.sin(t * 2) };
  return { ...m, pleased: c > 0.5 ? 1 : 0, squint: c > 0.5 ? 0 : m.squint || 0 };
}

// the newcomer that finds no room: slides in from the left edge, bounces off the strained outline
function newcomer_state(t) {
  const x = t < 8.8 ? -130 : t < 9.5 ? lerp(-130, 44, ease.in_cubic(prog(t, 8.8, 9.5))) : t < 10.3 ? lerp(44, -10, ease.out_cubic(prog(t, 9.5, 10.3))) : -10;
  const squash = t > 9.45 && t < 9.9 ? 1 - 0.22 * Math.sin(Math.PI * prog(t, 9.45, 9.9)) : 1;
  return { x, y: 520, squash, bump: t >= 9.5 && t < 10.1 };
}

// ---------- the world ----------
function world(t) {
  const strain = strain_at(t);
  field_draw(t, strain);
  ctx.save(); field_path(0, FIELD.r); ctx.clip();
  for (let i = 0; i < AGENTS.length; i++) if (here(i, t)) halo_draw(i, t);
  messages_draw(t);
  for (let i = 0; i < AGENTS.length; i++) {
    if (!here(i, t)) continue;
    agent_draw(i, t, mood_of(i, t, strain));
  }
  ctx.restore();
  if (t >= 8.8 && t < 23.0) {
    const n = newcomer_state(t);
    ctx.save(); ctx.translate(n.x, n.y); ctx.scale(1, n.squash);
    agent_path('pill', R_AGENT); ctx.fillStyle = KINDS[5].col; ctx.fill(); ctx.strokeStyle = KINDS[5].col; ctx.lineWidth = R_AGENT * 0.28; ctx.lineJoin = 'round'; ctx.stroke();
    eyes(R_AGENT, 'pill', n.bump ? { squint: 0.8 } : { curious: 1, look: [1, -0.3] }, t, 9);
    ctx.restore();
    if (n.bump) { const p = prog(t, 9.5, 10.1); ctx.save(); ctx.globalAlpha *= 1 - p; circle(FIELD.x, 520, 30 + 90 * p, null, RED, 6); ctx.restore(); }
  }
}

// ---------- the dive into one halo: five layers made for people ----------
const LAYERS = [['terminal UI', 300, 540], ['slash commands', 385, 400], ['SDKs', 470, 680], ['upgrades', 555, 260], ['sign-ins', 640, 820]];
const SEGS = 10;
function layer_pt(R, y) { return 960 + Math.sqrt(Math.max(0, R * R - (y - 540) ** 2)); }

function s_why(t) {
  const cx = 960, cy = 540;
  LAYERS.forEach(([tag, R, ty], k) => {
    const lit = prog(t, 12.5 + 0.5 * k, 12.85 + 0.5 * k), born = ease.out_cubic(prog(t, 12.2 + 0.08 * k, 12.6 + 0.08 * k));
    const peel0 = 16.0 + 0.25 * k;
    for (let s = 0; s < SEGS; s++) {
      const a0 = s * 2 * Math.PI / SEGS + 0.05, a1 = (s + 1) * 2 * Math.PI / SEGS - 0.05, dt = Math.max(0, t - (peel0 + 0.03 * s));
      const off = dt * 260 + 0.5 * 2600 * dt * dt, rot = dt * ((s + k) % 2 ? 1.6 : -1.9), mid = (a0 + a1) / 2;
      if (off > 1500) continue;
      ctx.save(); ctx.translate(cx + Math.cos(mid) * dt * 160, cy + off * 0.8 + Math.sin(mid) * dt * 160); ctx.rotate(rot);
      ctx.globalAlpha *= born * (1 - prog(dt, 0.7, 1.1)); ctx.shadowColor = '#e6edf3'; ctx.shadowBlur = 18 * lit * (dt ? 0 : 1);
      ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.strokeStyle = col_mix_rgb('#6b7482', '#e6edf3', lit); ctx.lineWidth = 34; ctx.lineCap = 'butt'; ctx.stroke(); ctx.restore();
    }
    if (t >= 12.5 + 0.5 * k && t < peel0 + 0.3) {
      const a = lit * (1 - prog(t, peel0, peel0 + 0.3)), px = layer_pt(R, ty);
      ctx.save(); ctx.globalAlpha *= a; line(px, ty, 1620, ty, '#e6edf3', 3); circle(px, ty, 8, '#e6edf3'); text(tag, 1640, ty + 10, 30, COL.ink, 700, 'left'); ctx.restore();
    }
  });
  // collapse into the tight green ring, and the mark flashes once on it
  if (t >= 18.2 && t < 19.2) {
    const p = prog(t, 18.2, 19.2), s = spring_t(t - 18.2, 8, 2) ;
    ctx.save(); ctx.globalAlpha *= (1 - p) * 0.9 + 0.1 * (t < 18.9 ? 1 : 0); ctx.translate(960, 540 - AGENTS[HERO].r * RING_K * ZOOM - 90);
    ctx.scale(Math.min(1.2, s), Math.min(1.2, s)); ctx.shadowColor = COL.acc; ctx.shadowBlur = 30; draw_mark(0, 0, 170, COL.acc); ctx.restore();
  }
}

// ---------- camera ----------
function camera(t) {
  const [hx, hy] = [AGENTS[HERO].x, AGENTS[HERO].y];
  if (t < 11) return [1, 960, 540];
  if (t < 12) { const p = ease.in_expo(prog(t, 11, 12)); return [Math.exp(lerp(0, Math.log(ZOOM), p)), lerp(960, hx, p), lerp(540, hy, p)]; }
  if (t < 19) return [ZOOM, hx, hy];
  if (t < 20.2) { const p = ease.out_expo(prog(t, 19, 20.2)); return [Math.exp(lerp(Math.log(ZOOM), 0, p)), lerp(hx, 960, p), lerp(hy, 540, p)]; }
  return [1, 960, 540];
}

function s_stage(t) {
  const [z, cx, cy] = camera(t);
  ctx.save();
  if (t >= 26.0) ctx.globalAlpha *= 1 - ease.in_out_cubic(prog(t, 26.0, 26.4));
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
  world(t);
  ctx.restore();
  if (t >= 12.0 && t < 19.2) s_why(t);
  if (t >= 12.0 && t < 19.2) { const g = ctx.createLinearGradient(0, 900, 0, 1080); g.addColorStop(0, 'rgba(13,17,23,0)'); g.addColorStop(0.45, 'rgba(13,17,23,0.92)'); g.addColorStop(1, 'rgba(13,17,23,1)'); ctx.fillStyle = g; ctx.fillRect(0, 900, W, 180); }
  if (t >= 26.0) {   // the memory field contracts into the lia tile
    const p = ease.in_out_cubic(prog(t, 26.0, 26.5)), x = lerp(FIELD.x, 610, p), y = lerp(FIELD.y, 311.5, p), w = lerp(FIELD.w, 700, p), h = lerp(FIELD.h, 457, p), r = lerp(FIELD.r, 60, p);
    ctx.save(); ctx.globalAlpha *= p; rr(x, y, w, h, r); fill_stroke(COL.acc, null); ctx.restore();
    draw_mark(960, 540, 215, COL.bg, p);
  }
}

function s_brand(t) {
  backdrop();
  const rect = 1 - ease.in_out_cubic(prog(t, 26.6, 27.4));
  const move = ease.in_out_cubic(prog(t, 26.8, 27.6));
  const size = lerp(215, 300, move), mx = lerp(960, 742, move), my = lerp(540, 440, move);
  if (rect > 0.001) { ctx.save(); ctx.globalAlpha *= rect; rr(960 - 350, 540 - 228, 700, 457, 60); fill_stroke(COL.acc, null); ctx.restore(); }
  const k = prog(t, 26.6, 27.2);
  ctx.save(); ctx.shadowColor = COL.acc; ctx.shadowBlur = 30 * pulse(t, 27.4, 0.8);
  draw_mark(mx, my, size, k < 0.5 ? COL.bg : COL.acc); ctx.restore();
  kinetic('lia', 1135, 510, t, 27.5, 99, 220, COL.ink);
  kinetic('built for bots', 960, 640, t, 27.9, 99, 52, COL.ink, 400);
  const ua = ease.out_cubic(prog(t, 28.4, 28.9)); text('github.com/ap-justin/lia', 960, 790, 60, COL.acc, 700, 'center', ua);
  const ca = ease.out_cubic(prog(t, 28.9, 29.4)); text('Based on fx by Vercel Labs.', 960, 910, 30, COL.dim, 400, 'center', ca);
  if (t > 29.6) { ctx.save(); ctx.globalAlpha *= prog(t, 29.6, 30); ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function draw(t) {
  t = Math.max(0, Math.min(DUR - 1e-4, t));
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  backdrop();
  if (t < 26.5) s_stage(t); else s_brand(t);
  overlay_labels(t);
  finish(t);
}

function overlay_labels(t) {
  const y = 1035;
  kinetic('heavy', 960, y, t, 4.2, 10.8, 64);
  kinetic('built for people', 960, y, t, 12.4, 15.9, 60);
  kinetic('built for bots', 960, y, t, 17.2, 20.9, 64, COL.acc);
  kinetic('light', 960, y, t, 21.3, 23.9, 64);
  kinetic('room to grow', 960, y, t, 24.5, 26.3, 64);
}
