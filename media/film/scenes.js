// World geometry (1920x1080 canvas coordinates). The server box holds the bots; the gauge and RAM stick sit beside it.
const FLOOR = 880;
const BOXR = { x: 140, y: 340, w: 1360, h: 560 };
const CRATE = { w: 150, h: 130 };
const CELLS = [[0, 0], [0, 1], [1, 0], [0, 2], [1, 1], [2, 0]];   // where each crate lands in the pile
const SOCKET = [840, 290];
const MARK_W = 150, MARK_H = 98;
const WARN = '#ff6b6b', AMBER = '#f2c879';
const TINTS = [COL.acc, '#8ab4f8', AMBER, '#e58fb0', '#e6edf3', '#b79cf5', '#b79cf5', '#8ab4f8', AMBER, '#e58fb0'];

const cell_pos = k => [190 + 75 + CELLS[k][0] * 150, FLOOR - 65 - CELLS[k][1] * 130];
const land_t = k => 4.35 + 0.5 * k;
const chip_t = k => 21.0 + 0.5 * k;
const spread_x = i => 560 + i * 168;
const pack_x = i => 840 + i * 110;
const final_x = j => 250 + j * 128;
const WAVE_T = [24.5, 25.0];                       // bots 6 and 7 slide in from the door
const NEW_FINAL = [1, 0];                       // their floor slots, nearest the door last

function col_mix(a, b, p) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return 'rgb(' + pa.map((v, i) => Math.round(lerp(v, pb[i], clamp01(p)))).join(',') + ')';
}

// ---------- memory: how full the server is ----------
function level(t) {
  let v = 0.12;
  for (let k = 0; k < 6; k++) v += 0.13 * ease.out_cubic(prog(t, land_t(k) - 0.35, land_t(k) + 0.1));
  for (let k = 0; k < 6; k++) v -= 0.125 * ease.in_out_cubic(prog(t, chip_t(k) + 0.1, chip_t(k) + 0.5));
  for (let j = 0; j < 2; j++) v += 0.015 * prog(t, WAVE_T[j], WAVE_T[j] + 0.6);
  return v;
}
const level_col = v => (v < 0.5 ? col_mix(COL.acc, AMBER, v / 0.5) : col_mix(AMBER, WARN, (v - 0.5) / 0.35));

// ---------- parts ----------
function bot(x, y, s, o = {}) {
  const mood = o.mood || 'ok', t = o.t || 0, sag = o.sag || 0, tint = o.tint || COL.acc;
  const hL = o.handL || [-96, -30], hR = o.handR || [96, -30];
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s * (1 - 0.1 * sag));
  ctx.translate(0, mood === 'relax' ? 0 : Math.sin(t * Math.PI * 2) * 2);
  [-30, 30].forEach(fx => { rr(fx - 18, -22, 36, 22, 9); fill_stroke(COL.panel, COL.ink, 5); });
  [[-46, hL], [46, hR]].forEach(([sx, h]) => {
    let dx = h[0] - sx, dy = h[1] + 80; const L = Math.hypot(dx, dy), m = 92;
    if (L > m) { dx *= m / L; dy *= m / L; }
    line(sx, -80, sx + dx, -80 + dy, COL.ink, 7); circle(sx + dx, -80 + dy, 9, COL.panel, COL.ink, 5);
  });
  rr(-50, -102, 100, 82, 18); fill_stroke(COL.panel, COL.ink, 5);
  rr(-34, -42, 68, 12, 6); fill_stroke(tint, null);
  circle(0, -66, 9, tint);
  line(0, -212, 0, -242, COL.ink, 5);
  ctx.save(); ctx.shadowColor = tint; ctx.shadowBlur = 14; circle(0, -248, 9, tint); ctx.restore();
  rr(-62, -214, 124, 100, 28); fill_stroke(COL.panel, COL.ink, 5);
  [-1, 1].forEach(sd => { rr(sd * 62 - (sd > 0 ? 0 : 10), -178, 10, 34, 5); fill_stroke(tint, null); });
  const bl = (t % 3.2) > 3.08 ? 0.15 : 1;
  [-24, 24].forEach(ex => {
    ctx.save(); ctx.translate(ex, -166);
    if (mood === 'relax' || mood === 'happy') { ctx.beginPath(); ctx.arc(0, 4, 10, 1.15 * Math.PI, 1.85 * Math.PI); ctx.strokeStyle = COL.ink; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke(); }
    else { ctx.scale(1, bl); circle(0, 0, mood === 'surprised' ? 12 : 9, COL.ink); }
    ctx.restore();
  });
  if (mood === 'sad' || mood === 'worried') { line(-36, -182, -14, -192, COL.ink, 4); line(36, -182, 14, -192, COL.ink, 4); }
  ctx.beginPath();
  if (mood === 'happy' || mood === 'relax') ctx.arc(0, -138, 24, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood === 'sad') ctx.arc(0, -112, 18, 1.2 * Math.PI, 1.8 * Math.PI);
  else if (mood === 'surprised') ctx.ellipse(0, -128, 9, 12, 0, 0, Math.PI * 2);
  else if (mood === 'worried') { ctx.moveTo(-18, -128); for (let i = 1; i <= 6; i++) ctx.lineTo(-18 + i * 6, -128 + (i % 2 ? -5 : 5)); }
  else ctx.arc(0, -142, 16, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
}

function crate(x, y, s, o = {}) {
  const w = CRATE.w * s, h = CRATE.h * s, open = o.open || 0, a = o.a ?? 1;
  ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(o.rot); ctx.globalAlpha *= a;
  if (open > 0.001) { rr(-w / 2, -h / 2, w, h, 10 * s); fill_stroke('#05080c', COL.ink, 5 * s); }
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * open * w * 0.85, 0);
    const x0 = side < 0 ? -w / 2 : 0;
    ctx.beginPath(); ctx.rect(x0, -h / 2, w / 2, h); fill_stroke('#1a2029', COL.ink, Math.max(2, 5 * s));
    for (let i = 1; i < 4; i++) line(x0, -h / 2 + i * h / 4, x0 + w / 2, -h / 2 + i * h / 4, '#2f3a47', Math.max(1.5, 3 * s));
    line(x0 + (side < 0 ? 14 : w / 2 - 14) * s, -h / 2, x0 + (side < 0 ? 14 : w / 2 - 14) * s, h / 2, COL.dim, Math.max(2, 7 * s));
    line(x0 + 4 * s, side < 0 ? -h / 2 + 4 * s : h / 2 - 4 * s, x0 + w / 2 - 4 * s, side < 0 ? h / 2 - 4 * s : -h / 2 + 4 * s, '#2f3a47', Math.max(1.5, 4 * s));
    ctx.restore();
  }
  ctx.restore();
}

function chip(x, y, s, a = 1, t = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= a;
  ctx.shadowColor = COL.acc; ctx.shadowBlur = 14;
  rr(-26, -18, 52, 36, 8); fill_stroke(COL.acc, null); ctx.shadowBlur = 0;
  draw_mark(0, 0, 24, COL.bg); ctx.restore();
}

function ram_stick(x, y, hot) {
  ctx.save(); ctx.translate(x, y);
  if (hot > 0.05) { ctx.shadowColor = WARN; ctx.shadowBlur = 30 * hot; }
  rr(-62, -24, 124, 48, 6); fill_stroke(COL.panel, hot > 0.5 ? WARN : COL.ink, 5); ctx.shadowBlur = 0;
  [-34, 0, 34].forEach(cx => { rr(cx - 14, -12, 28, 24, 4); fill_stroke(COL.line, null); });
  for (let i = -5; i <= 5; i++) line(i * 10, 24, i * 10, 36, hot > 0.5 ? WARN : AMBER, 4);
  ctx.restore();
}

function gauge(t) {
  const v = level(t), x = 1680, y0 = 350, h = 520, w = 64, col = level_col(v);
  rr(x - w / 2, y0, w, h, 32); fill_stroke(COL.panel, COL.ink, 5);
  ctx.save(); rr(x - w / 2 + 6, y0 + 6, w - 12, h - 12, 26); ctx.clip();
  const fh = (h - 12) * clamp01(v), blink = v > 0.88 ? 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 2) : 1;
  ctx.fillStyle = col; ctx.globalAlpha *= blink; ctx.fillRect(x - w / 2, y0 + h - 6 - fh, w, fh); ctx.restore();
  [0.33, 0.66].forEach(f => line(x + w / 2 + 4, y0 + h - h * f, x + w / 2 + 20, y0 + h - h * f, COL.dim, 4));
  ram_stick(x, 290, v > 0.88 ? 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 2) : 0);
}

function server_box(t, led) {
  const b = BOXR;
  rr(b.x, b.y, b.w, b.h, 18); fill_stroke('#0e141b', null);
  ctx.beginPath(); ctx.moveTo(b.x, 640); ctx.lineTo(b.x, b.y + 18); ctx.arcTo(b.x, b.y, b.x + 18, b.y, 18); ctx.lineTo(b.x + b.w - 18, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + 18, 18); ctx.lineTo(b.x + b.w, b.y + b.h - 18); ctx.arcTo(b.x + b.w, b.y + b.h, b.x + b.w - 18, b.y + b.h, 18);
  ctx.lineTo(b.x + 18, b.y + b.h);
  fill_stroke(null, led > 0.5 ? col_mix(COL.ink, COL.acc, led) : COL.ink, 6);
  for (let i = 0; i < 7; i++) line(1000 + i * 60, b.y + 25, 1030 + i * 60, b.y + 25, COL.line, 5);
  const v = level(t);
  for (let i = 0; i < 4; i++) circle(1440, b.y + 70 + i * 40, 9, v > 0.88 && t < 21 ? (Math.sin(t * 12 + i) > 0 ? WARN : COL.line) : (led > 0.5 ? COL.acc : (v < 0.5 ? COL.acc : COL.line)));
  // socket in the top rail
  rr(SOCKET[0] - 80, b.y - 12, 160, 24, 6); fill_stroke(COL.panel, COL.dim, 4);
  line(SOCKET[0] - 30, b.y + 12, SOCKET[0] - 30, b.y + 26, COL.dim, 4); line(SOCKET[0] + 30, b.y + 12, SOCKET[0] + 30, b.y + 26, COL.dim, 4);
  if (led > 0) {
    const L = 600 * led;
    line(SOCKET[0] - L, b.y + 12, SOCKET[0] + L, b.y + 12, COL.acc, 5);
  }
}

// ---------- the bots ----------
function bot_x(i, t) {
  if (i < 6) {
    if (i >= 3) { const a = 1.0 + (i - 3); const arr = ease.in_out_cubic(prog(t, a, a + 1.2)); if (t < a + 1.2) return lerp(150, spread_x(i), arr); }
    const sq = ease.in_out_cubic(prog(t, 4.0, 8.0)), un = ease.in_out_cubic(prog(t, 23.2, 24.4));
    const x = lerp(spread_x(i), pack_x(i), sq);
    return lerp(x, final_x(2 + i), un);
  }
  if (i === 6) {
    if (t < 9.0) return -80;
    if (t < 10.0) return lerp(-80, 130, ease.out_cubic(prog(t, 9.0, 10.0)));
    if (t < 10.7) return lerp(130, 70, ease.out_cubic(prog(t, 10.0, 10.7)));
    if (t < WAVE_T[0]) return 70;
    return lerp(70, final_x(NEW_FINAL[0]), ease.in_out_cubic(prog(t, WAVE_T[0], WAVE_T[0] + 0.6)));
  }
  const j = i - 6; return t < WAVE_T[j] ? -120 : lerp(-120, final_x(NEW_FINAL[j]), ease.in_out_cubic(prog(t, WAVE_T[j], WAVE_T[j] + 0.6)));
}
function bot_here(i, t) { return i < 3 || (i < 6 && t >= 1.0 + (i - 3)) || (i === 6 && t >= 9.0) || (i > 6 && t >= WAVE_T[i - 6]); }
function bot_mood(i, t) {
  if (i === 6) return t < 10.0 ? 'ok' : t < 19.5 ? (t < 10.7 ? 'surprised' : 'sad') : t < 24.4 ? 'ok' : 'happy';
  if (i > 6) return 'happy';
  if (t >= chip_t(i) + 0.5) return 'happy';
  if (t < 4.2) return 'ok';
  if (t < 6.6 && t >= land_t(i) - 0.1 && t < land_t(i) + 0.5) return 'surprised';
  return t < 9.5 ? 'worried' : 'sad';
}
function bot_draw(i, t) {
  if (!bot_here(i, t)) return;
  const x = bot_x(i, t), walking = (i >= 3 && i < 6 && t < 1.0 + (i - 3) + 1.2) || (i === 6 && t > 9 && t < 10.7) || (i > 6 && t < WAVE_T[i - 6] + 0.6) || (i === 6 && t >= WAVE_T[0] && t < WAVE_T[0] + 0.6);
  const hop = walking ? Math.abs(Math.sin(t * 9 + i)) * 14 : 0;
  const heavy = i < 6 ? 1 - ease.in_out_cubic(prog(t, 21.0 + 0.5 * i, 21.6 + 0.5 * i)) : 0;
  const crate_on = i < 6 ? (t >= land_t(i) ? 1 : 0) : 0;
  let sag = (i < 6 ? 0.35 * pulse(t, land_t(i), 0.5) * (t < 6.6 ? 1 : 0) + 0.3 * ease.out_cubic(prog(t, 4.5, 8.0)) * heavy * crate_on : 0);
  if (i === 6 && t > 10.0 && t < 10.5) sag = 0.5 * pulse(t, 10.0, 0.5);
  const work = i < 6 && t < 21.0 ? 1 - 0.8 * ease.out_cubic(prog(t, 4.0, 8.5)) : 1;
  const speed = i < 6 && t < 21.0 ? lerp(2.0, 0.7, prog(t, 4.0, 8.0)) : 2.0;
  const ph = Math.sin(t * Math.PI * speed + i * 1.3) * work;
  const happy = bot_mood(i, t) === 'happy';
  let hL = [-70, -42 - 16 * ph], hR = [70, -42 + 16 * ph];
  if (happy) { const w = Math.sin(t * 7 + i); hL = [-92, -100 + 20 * w]; hR = [92, -100 - 20 * w]; }
  if (i === 6 && t >= 10.7 && t < 11.0) hR = [120, -120];
  bot(x, FLOOR - hop, 1.1, { mood: bot_mood(i, t), t: t + i * 0.37, tint: TINTS[i], sag, handL: hL, handR: hR });
}

// ---------- world ----------
function dust(x, y, p) {
  if (p <= 0 || p >= 1) return;
  for (let k = 0; k < 6; k++) { const d = (k - 2.5) * 26 * ease.out_cubic(p); ctx.save(); ctx.globalAlpha *= 0.5 * (1 - p); circle(x + d, y - 6 * p * (k % 2 + 1), 10 + 12 * p, COL.dim); ctx.restore(); }
}

function world(t) {
  const lv = level(t);
  const quake = t >= 7.5 && t < 11 ? 3 * prog(t, 7.5, 8.2) : 0;
  let sy = 0, sx = 0;
  for (let k = 0; k < 6; k++) sy += 7 * pulse(t, land_t(k), 0.2);
  sx = quake * Math.sin(t * 55); sy += quake * Math.cos(t * 47) * 0.6;
  if (t >= 10.0 && t < 10.4) sx += 5 * Math.sin(t * 90);
  ctx.save(); ctx.translate(sx, sy);
  const led = t >= 19.5 ? ease.out_cubic(prog(t, 19.5, 20.6)) : 0;
  server_box(t, led);
  // crates and ropes
  for (let k = 0; k < 6; k++) {
    const cp = cell_pos(k);
    const bx = bot_x(k, t) - 62, by = FLOOR - 112;
    const fall = prog(t, land_t(k) - 0.35, land_t(k));
    const chp = ease.in_out_cubic(prog(t, chip_t(k), chip_t(k) + 0.5));
    if (fall <= 0) continue;
    let cx = cp[0], cy = lerp(cp[1] - 700, cp[1], ease.in_cubic(fall)), s = 1, op = k === 1 ? ease.out_cubic(prog(t, 11.95, 12.35)) : 0;
    const landed = fall >= 1;
    if (landed) cy += 4 * Math.exp(-(t - land_t(k)) * 10) * Math.cos(30 * (t - land_t(k)));
    if (t >= 10.0 && t < 10.5 && CELLS[k][0] === 0) cx += 5 * Math.sin(t * 90);
    if (chp > 0) { cx = lerp(cp[0], bx, chp); cy = lerp(cy, by, chp); s = lerp(1, 0.3, chp); }
    if (landed && chp < 1) { ctx.save(); ctx.globalAlpha *= 1 - chp; ctx.setLineDash([8, 10]); line(bx, by, cx, cy, COL.dim, 3); ctx.restore(); }
    crate(cx, cy, s, { open: op, a: 1 - prog(chp, 0.2, 0.8) });
    if (chp > 0.2 && chp < 1) chip(cx, cy, 1, prog(chp, 0.3, 0.8));
    if (landed) dust(cp[0], FLOOR, prog(t, land_t(k), land_t(k) + 0.5));
  }
  for (let i = 0; i < 8; i++) bot_draw(i, t);
  // chips ride on the bots' backs
  for (let k = 0; k < 6; k++) if (t >= chip_t(k) + 0.5) chip(bot_x(k, t) - 62, FLOOR - 112, 1.0, 1);
  for (let j = 0; j < 2; j++) if (bot_here(6 + j, t)) chip(bot_x(6 + j, t) - 62, FLOOR - 112, 1.0, 1);
  // free slots on the floor: room for more bots
  if (t >= 24.4) { const a = ease.out_cubic(prog(t, 24.4, 25.0)); [8, 9].forEach(j => { ctx.save(); ctx.globalAlpha *= 0.7 * a; ctx.setLineDash([12, 12]); rr(final_x(j) - 55, FLOOR - 250, 110, 250, 26); ctx.strokeStyle = COL.dim; ctx.lineWidth = 4; ctx.stroke(); ctx.setLineDash([]); line(final_x(j) - 16, FLOOR - 125, final_x(j) + 16, FLOOR - 125, COL.dim, 5); line(final_x(j), FLOOR - 141, final_x(j), FLOOR - 109, COL.dim, 5); ctx.restore(); }); }
  // no entry sign at the door
  if (t >= 10.0 && t < 11.0) { const a = ease.out_cubic(prog(t, 10.0, 10.3)) * (1 - prog(t, 10.8, 11.0)); ctx.save(); ctx.globalAlpha *= a; ctx.translate(230, 560); circle(0, 0, 36, COL.panel, WARN, 8); line(-24, 24, 24, -24, WARN, 8); ctx.restore(); }
  ctx.restore();
  gauge(t);
}

function lia_block_world(t) {
  const fly = ease.in_out_cubic(prog(t, 18.4, 19.5));
  const start = cell_pos(1), end = SOCKET;
  const p = [lerp(start[0], end[0], fly), lerp(start[1], end[1], fly) - 140 * Math.sin(Math.PI * fly)];
  const size = lerp(22 / MARK_W, 1, ease.in_out_cubic(prog(t, 18.0, 19.3)));
  if (t < 18.0) return;
  const land = t >= 19.5 ? 1 - 0.1 * Math.exp(-(t - 19.5) * 9) * Math.cos(26 * (t - 19.5)) : 1;
  ctx.save(); ctx.translate(p[0], p[1] + (t >= 19.5 ? 0 : 0)); ctx.scale(size * land, size * land);
  ctx.shadowColor = COL.acc; ctx.shadowBlur = 24; rr(-MARK_W / 2, -MARK_H / 2, MARK_W, MARK_H, 14); fill_stroke(COL.acc, null); ctx.shadowBlur = 0;
  draw_mark(0, 0, 66, COL.bg); ctx.restore();
  if (t >= 19.5 && t < 20.2) { const r = prog(t, 19.5, 20.2); ctx.save(); ctx.globalAlpha *= 1 - r; circle(SOCKET[0], SOCKET[1] + 40, 60 + 160 * r, null, COL.acc, 6); ctx.restore(); }
}

function camera(t) {
  if (t < 4) return track(t, [[0, 1.12, 900, 620], [4, 1.0, 900, 600]], ease.out_cubic);
  if (t < 11) return [1.0, 900, 600];
  if (t < 12) { const p = ease.in_expo(prog(t, 11, 12)), c = cell_pos(1); return [Math.exp(lerp(0, Math.log(9), p)), lerp(900, c[0], p), lerp(600, c[1], p)]; }
  if (t < 18) return [9, ...cell_pos(1)];
  if (t < 19) { const p = ease.out_expo(prog(t, 18, 19)), c = cell_pos(1); return [Math.exp(lerp(Math.log(9), 0, p)), lerp(c[0], 900, p), lerp(c[1], 600, p)]; }
  if (t < 26) return [1.0 + 0.04 * prog(t, 19, 26), 900, 600];
  const p = ease.in_out_cubic(prog(t, 26, 26.5)); return [lerp(1.04, 700 / MARK_W, p), lerp(900, SOCKET[0], p), lerp(600, SOCKET[1], p)];
}

// ---------- scenes ----------
function s_stage(t) {
  const [z, cx, cy] = camera(t);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
  world(t); lia_block_world(t);
  ctx.restore();
}

function part_icon(kind, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (kind === 0) {            // terminal UI: a window with a title bar
    rr(-90, -66, 180, 132, 14); fill_stroke(COL.panel, COL.ink, 7);
    line(-90, -30, 90, -30, COL.ink, 6); [-70, -52, -34].forEach(dx => circle(dx, -48, 5, COL.ink));
    line(-62, 4, 20, 4, COL.dim, 8); line(-62, 34, 60, 34, COL.dim, 8);
  } else if (kind === 1) {     // slash commands: a square holding a slash
    rr(-70, -70, 140, 140, 22); fill_stroke(COL.panel, COL.ink, 7); line(-22, 42, 22, -42, COL.ink, 12);
  } else if (kind === 2) {     // SDKs: a package cube
    ctx.beginPath(); ctx.moveTo(0, -80); ctx.lineTo(70, -40); ctx.lineTo(70, 40); ctx.lineTo(0, 80); ctx.lineTo(-70, 40); ctx.lineTo(-70, -40); ctx.closePath(); fill_stroke(COL.panel, COL.ink, 7);
    line(-70, -40, 0, 0, COL.ink, 6); line(70, -40, 0, 0, COL.ink, 6); line(0, 0, 0, 80, COL.ink, 6);
  } else if (kind === 3) {     // upgrades: an up arrow in a ring
    circle(0, 0, 72, COL.panel, COL.ink, 7); ctx.beginPath(); ctx.moveTo(0, -42); ctx.lineTo(34, -4); ctx.lineTo(12, -4); ctx.lineTo(12, 40); ctx.lineTo(-12, 40); ctx.lineTo(-12, -4); ctx.lineTo(-34, -4); ctx.closePath(); fill_stroke(COL.ink, null);
  } else {                     // sign-ins: a key
    circle(-34, 0, 38, COL.panel, COL.ink, 7); circle(-34, 0, 10, COL.ink); line(4, 0, 84, 0, COL.ink, 9); line(58, 0, 58, 30, COL.ink, 9); line(78, 0, 78, 24, COL.ink, 9);
  }
  ctx.restore();
}
const PARTS = [['terminal UI', 0], ['slash commands', 1], ['SDKs', 2], ['upgrades', 3], ['sign-ins', 4]];
const PART_X = [470, 715, 960, 1205, 1450];

function s_why(t) {
  // overlay on the zoomed crate: parts a bot never uses pop in, get crossed out, then drop away
  const shake = t >= 15.4 && t < 16.0 ? 4 * (t - 15.4) / 0.6 : 0;
  PARTS.forEach(([tag, kind], k) => {
    const born = 12.5 + 0.5 * k, p = ease.out_back(prog(t, born, born + 0.4)), fall = Math.max(0, t - (16.0 + 0.25 * k));
    if (p <= 0) return;
    const x = PART_X[k] + (fall ? (k - 2) * 60 * fall : 0) + shake * Math.sin(t * 70 + k), y = 470 + 12 * Math.sin(t * 2 + k) + 0.5 * 3800 * fall * fall;
    if (y > 1400) return;
    ctx.save(); ctx.translate(x, y); ctx.rotate(fall ? fall * (k % 2 ? 2.2 : -2.6) : 0); ctx.scale(p, p);
    part_icon(kind, 0, 0, 1.25);
    text(tag, 0, 195, 30, COL.ink, 700, "center");
    const xp = prog(t, born + 0.5, born + 0.85);
    if (xp > 0) { ctx.globalAlpha = 0.95; line(-100, -100, -100 + 200 * xp, -100 + 200 * xp, WARN, 12); if (xp > 0.5) line(100, -100, 100 - 200 * (xp - 0.5) * 2, -100 + 200 * (xp - 0.5) * 2, WARN, 12); }
    ctx.restore();
  });
  // the bot that wanted in watches
  const bm = t < 13.5 ? 'surprised' : t < 16.2 ? 'sad' : 'happy';
  if (t >= 12.3) {
    const a = ease.out_cubic(prog(t, 12.3, 12.8)), w = Math.sin(t * 7);
    ctx.save(); ctx.globalAlpha *= a;
    bot(210, 1075, 1.1, { mood: bm, t, tint: TINTS[6], handL: [-92, -100 + (bm === 'happy' ? 20 * w : 0)], handR: [92, -100 - (bm === 'happy' ? 20 * w : 0)] });
    ctx.restore();
  }
  // the core that is left becomes lia
  if (t >= 17.0 && t < 18.0) {
    const g = Math.min(1.08, spring_t(t - 17.0, 8, 2.2)), cw = 200 * g, ch = 130 * g;
    ctx.save(); ctx.shadowColor = COL.acc; ctx.shadowBlur = 40; rr(960 - cw / 2, 540 - ch / 2, cw, ch, 22); fill_stroke(COL.acc, null); ctx.shadowBlur = 0;
    draw_mark(960, 540, 88 * g, COL.bg, prog(t, 17.4, 17.8)); ctx.restore();
  }
}

function s_brand(t) {
  backdrop();
  const rect = 1 - ease.in_out_cubic(prog(t, 26.6, 27.4));
  const move = ease.in_out_cubic(prog(t, 26.8, 27.6));
  const size = lerp(232, 300, move), mx = lerp(960, 742, move);
  if (rect > 0.001) { ctx.save(); ctx.globalAlpha *= rect; rr(960 - 350, 540 - 228, 700, 457, 60); fill_stroke(COL.acc, null); ctx.restore(); }
  const k = prog(t, 26.6, 27.2);
  ctx.save(); ctx.shadowColor = COL.acc; ctx.shadowBlur = 30 * pulse(t, 27.4, 0.8);
  draw_mark(mx, 440, size, k < 0.5 ? COL.bg : COL.acc); ctx.restore();
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
  if (t < 26.5) { s_stage(t); if (t >= 12.0 && t < 18.0) s_why(t); }
  else s_brand(t);
  // the zoom into the heavy crate lands on a dark interior; flash as the doors open
  if (t >= 11.9 && t < 12.3) { ctx.save(); ctx.globalAlpha = 0.5 * (1 - prog(t, 11.95, 12.3)); ctx.fillStyle = COL.ink; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  overlay_labels(t);
  finish(t);
}

function overlay_labels(t) {
  const y = 1030;
  kinetic('your bots', 960, y, t, 0.8, 3.4, 60);
  kinetic('heavy', 960, y, t, 4.2, 8.4, 64);
  kinetic('no room', 960, y, t, 9.9, 11.0, 60, WARN);
  kinetic('built for people', 960, y, t, 12.4, 15.9, 60);
  kinetic('built for bots', 960, y, t, 17.2, 20.9, 64, COL.acc);
  kinetic('light', 960, y, t, 21.3, 23.9, 64);
  kinetic('room to grow', 960, y, t, 24.5, 26.3, 64);
}
