// World geometry shared by every stage scene (1920x1080 canvas coordinates).
const G = {
  person: [170, 905], editor: [300, 250, 520, 450], socket: [820, 475],
  bot_old: [1040, 860], bench: [1580, 905], bubble: [1040, 430], lia: [1040, 650],
  model: [1740, 430], wire: [[1210, 430], [1650, 430]],
  link: [[820, 475], [850, 475], [850, 650], [910, 650]],
  click: [700, 520],
};
const BAR = { w: 44, h: 56, gap: 8, n: 9, cached: 5 };

// ---------- drawing parts ----------
function seg_x(i, s) { const tot = (BAR.n * BAR.w + (BAR.n - 1) * BAR.gap) * s; return -tot / 2 + i * (BAR.w + BAR.gap) * s; }
// o.lit: cached segments; o.glow 0..1; o.front_fill colour override; o.seg(i) -> {dx,dy,rot,a} for the front pieces
function request_bar(cx, cy, s, o = {}) {
  const lit = o.lit ?? BAR.cached, glow = o.glow ?? 1;
  for (let i = 0; i < BAR.n; i++) {
    const x = seg_x(i, s), w = BAR.w * s, h = BAR.h * s;
    const m = o.seg ? o.seg(i) : { dx: 0, dy: 0, rot: 0, a: 1 };
    if (m.a <= 0) continue;
    ctx.save(); ctx.globalAlpha *= m.a; ctx.translate(cx + x + w / 2 + m.dx, cy + m.dy); ctx.rotate(m.rot);
    if (i < lit) {
      if (glow > 0) { ctx.shadowColor = COL.acc; ctx.shadowBlur = 26 * s * glow; }
      rr(-w / 2, -h / 2, w, h, 8 * s); fill_stroke(o.front_fill || COL.acc, null);
    } else { rr(-w / 2, -h / 2, w, h, 8 * s); fill_stroke(o.tail_fill || null, o.tail_stroke || COL.dim, Math.max(2, 4 * s)); }
    ctx.restore();
  }
}

function tool_icon(x, y, kind, s = 1, col = COL.ink) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (kind === 0) { rr(-16, -16, 32, 32, 6); fill_stroke(COL.panel, col, 4); line(-16, -7, -27, -7, col, 4); line(-16, 7, -27, 7, col, 4); }
  else { ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(21, 0); ctx.lineTo(0, 21); ctx.lineTo(-21, 0); ctx.closePath(); fill_stroke(COL.panel, col, 4); }
  ctx.restore();
}

function model_node(x, y, s, glow = 0, dim = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha *= 1 - 0.55 * dim;
  if (glow > 0) { ctx.shadowColor = COL.acc; ctx.shadowBlur = 40 * glow; }
  circle(0, 0, 90, COL.panel, glow > 0.05 ? COL.acc : COL.ink, 5);
  ctx.shadowBlur = 0;
  const pts = [[55, 0], [17, 52], [-44, 32], [-44, -32], [17, -52]];
  pts.forEach(p => line(0, 0, p[0], p[1], COL.dim, 4));
  circle(0, 0, 16, COL.ink); pts.forEach(p => circle(p[0], p[1], 8, COL.ink));
  ctx.restore();
}

function cursor_arrow(x, y, sc, col = COL.ink) {
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 36); ctx.lineTo(9, 28); ctx.lineTo(16, 44); ctx.lineTo(24, 40); ctx.lineTo(17, 25); ctx.lineTo(30, 25); ctx.closePath();
  fill_stroke(col, COL.bg, 3); ctx.restore();
}

function mouth(mood) {
  ctx.beginPath();
  if (mood === 'happy' || mood === 'relax') { ctx.arc(0, -138, 24, 0.15 * Math.PI, 0.85 * Math.PI); }
  else if (mood === 'sad') { ctx.arc(0, -112, 18, 1.2 * Math.PI, 1.8 * Math.PI); }
  else if (mood === 'surprised') { ctx.ellipse(0, -128, 9, 12, 0, 0, Math.PI * 2); }
  else if (mood === 'dizzy' || mood === 'worried') { ctx.moveTo(-18, -128); for (let i = 1; i <= 6; i++) ctx.lineTo(-18 + i * 6, -128 + (i % 2 ? -5 : 5)); }
  else { ctx.arc(0, -142, 16, 0.2 * Math.PI, 0.8 * Math.PI); }
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
}

// feet at (x,y); o: mood, t, handL/handR (local coords), sag 0..1, antenna 0..1
function bot(x, y, s, o = {}) {
  const mood = o.mood || 'ok', t = o.t || 0, sag = o.sag || 0, ant = o.antenna ?? 1;
  const hL = o.handL || [-96, -30 + 12 * Math.sin(t * 3)], hR = o.handR || [96, -30 + 12 * Math.sin(t * 3 + 2)];
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s * (1 - 0.07 * sag)); ctx.translate(0, 0);
  const bob = mood === 'relax' ? 0 : Math.sin(t * Math.PI * 2) * 2;
  ctx.translate(0, bob);
  [[-30], [30]].forEach(f => { rr(f[0] - 18, -22, 36, 22, 9); fill_stroke(COL.panel, COL.ink, 5); });
  [[-46, hL], [46, hR]].forEach(([sx, h]) => {
    let dx = h[0] - sx, dy = h[1] + 80; const L = Math.hypot(dx, dy), m = 92;
    if (L > m) { dx *= m / L; dy *= m / L; }
    line(sx, -80, sx + dx, -80 + dy, COL.ink, 7); circle(sx + dx, -80 + dy, 9, COL.panel, COL.ink, 5);
  });
  rr(-50, -102, 100, 82, 18); fill_stroke(COL.panel, COL.ink, 5);
  circle(0, -62, 9, ant > 0.5 ? COL.acc : COL.dim);
  line(0, -212, 0, -242, COL.ink, 5);
  ctx.save(); if (ant > 0.5) { ctx.shadowColor = COL.acc; ctx.shadowBlur = 14; } circle(0, -248, 9, ant > 0.5 ? COL.acc : COL.dim); ctx.restore();
  rr(-62, -214, 124, 100, 28); fill_stroke(COL.panel, COL.ink, 5);
  const bl = (t % 3.2) > 3.08 ? 0.15 : 1;
  [-24, 24].forEach(ex => {
    ctx.save(); ctx.translate(ex, -166);
    if (mood === 'dizzy') { line(-9, -9, 9, 9, COL.ink, 5); line(9, -9, -9, 9, COL.ink, 5); }
    else if (mood === 'relax') { ctx.beginPath(); ctx.arc(0, 4, 10, 1.15 * Math.PI, 1.85 * Math.PI); ctx.strokeStyle = COL.ink; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke(); }
    else { const r = mood === 'surprised' ? 12 : 9; ctx.scale(1, bl); circle(0, 0, r, COL.ink); }
    ctx.restore();
  });
  if (mood === 'sad' || mood === 'worried') {
    const k = 1;
    line(-36, -186 + 4 * k, -14, -186 - 6 * k, COL.ink, 4); line(36, -186 + 4 * k, 14, -186 - 6 * k, COL.ink, 4);
  }
  mouth(mood);
  ctx.restore();
}

function person(x, y, s, o = {}) {
  const mood = o.mood || 'ok', t = o.t || 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(-100, 0); ctx.quadraticCurveTo(-100, -95, 0, -95); ctx.quadraticCurveTo(100, -95, 100, 0); ctx.closePath(); fill_stroke(COL.panel, COL.ink, 5);
  const tilt = o.tilt || 0;
  ctx.save(); ctx.translate(0, -150); ctx.rotate(tilt);
  circle(0, 0, 52, COL.panel, COL.ink, 5);
  ctx.beginPath(); ctx.arc(0, -6, 56, 1.1 * Math.PI, 1.95 * Math.PI); ctx.strokeStyle = COL.acc; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.stroke();
  const lx = (o.look || 0) * 6;
  circle(-17 + lx, 2, 5, COL.ink); circle(17 + lx, 2, 5, COL.ink);
  ctx.beginPath();
  if (mood === 'happy') ctx.arc(lx, 14, 18, 0.15 * Math.PI, 0.85 * Math.PI);
  else if (mood === 'sad') ctx.arc(lx, 38, 14, 1.2 * Math.PI, 1.8 * Math.PI);
  else ctx.arc(lx, 8, 14, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();
  ctx.restore();
  if (o.arm !== undefined) {
    const th = lerp(-0.9, 0.9, o.arm), hx = 70 + Math.cos(th) * 110, hy = -70 - Math.sin(th) * 110 + 40;
    line(70, -70, hx, hy, COL.ink, 9); circle(hx, hy, 11, COL.panel, COL.ink, 5);
    if (o.thumb) { rr(hx - 5, hy - 34, 11, 26, 5); fill_stroke(COL.panel, COL.ink, 4); }
  }
  ctx.restore();
  // hand position in world coords for the pointer
  const th = lerp(-0.9, 0.9, o.arm ?? 0);
  return [x + (70 + Math.cos(th) * 110) * s, y + (-70 - Math.sin(th) * 110 + 40) * s];
}

// editor window with abstract bars, an ACP socket and the task track
function editor(t, n, o = {}) {
  const [x, y, w, h] = G.editor;
  rr(x, y, w, h, 20); fill_stroke(COL.panel, COL.ink, 5);
  ctx.beginPath(); ctx.moveTo(x, y + 56); ctx.lineTo(x + w, y + 56); ctx.strokeStyle = COL.line; ctx.lineWidth = 4; ctx.stroke();
  [0, 1, 2].forEach(i => circle(x + 30 + i * 26, y + 28, 8, COL.line));
  const widths = [0.62, 0.8, 0.45, 0.72, 0.55, 0.38];
  widths.forEach((f, i) => { rr(x + 36, y + 92 + i * 44, (w - 72) * f, 14, 7); fill_stroke(COL.line, null); });
  // task track
  for (let i = 0; i < 8; i++) {
    const cx = x + 64 + i * 56, cy = y + h - 56, done = i < n;
    const pop = done ? spring_t(t - (o.tick_t ? o.tick_t(i) : -99), 9, 2.5) : 0;
    const r = 15 * (done ? 0.85 + 0.15 * Math.min(1.4, pop) : 1);
    if (done) circle(cx, cy, r, COL.acc); else circle(cx, cy, 15, null, COL.line, 4);
    if (o.waiting === i) { ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6); circle(cx, cy, 15, null, COL.dim, 4); ctx.restore(); }
  }
  circle(G.socket[0], G.socket[1], 11, COL.panel, o.socket_col || COL.dim, 5);
}

function wire_old(t) {
  const [a, b] = G.wire, brk = t >= 7.5 && t < 12;
  if (!brk) { line(a[0], a[1], b[0], b[1], COL.line, 6); return; }
  line(a[0], a[1], 1400, a[1], COL.line, 6); line(1470, a[1], b[0], b[1], COL.line, 6);
  const sp = prog(t, 7.5, 8.0);
  if (sp < 1) for (let k = 0; k < 7; k++) {
    const ang = hash(k + 3) * Math.PI * 2, r1 = 8 + 40 * sp, r2 = r1 + 14 * (1 - sp);
    line(1435 + Math.cos(ang) * r1, a[1] + Math.sin(ang) * r1, 1435 + Math.cos(ang) * r2, a[1] + Math.sin(ang) * r2, COL.ink, 4);
  }
  ctx.save(); ctx.globalAlpha = 0.75; line(1424, a[1] - 14, 1446, a[1] + 14, COL.ink, 6); line(1446, a[1] - 14, 1424, a[1] + 14, COL.ink, 6); ctx.restore();
}

function chip_on(pts, u, s, o) {
  const p = poly_at(pts, u); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); request_bar(0, 0, s, o); ctx.restore();
  return p;
}

// ---------- the stage (outset, problem, solution, result share it) ----------
function tasks_done(t) {
  if (t < 14.5) return Math.min(5, Math.max(0, Math.floor((t - 0.5) / 0.55)));
  if (t < 15.5) return 6;
  if (t < 24.5) return 7;
  return 8;
}
function tick_t(i) { return i < 5 ? 0.5 + i * 0.55 + 0.55 : i === 5 ? 14.5 : i === 6 ? 15.5 : 24.5; }

function packet_loop(t, t0, period, pts, s, o) {
  // request out, reply back, repeating: u runs 0→1 then 1→0
  if (t < t0) return -1;
  const k = ((t - t0) % period) / period;
  return k < 0.5 ? k * 2 : 2 - k * 2;
}

function stage(t, mode, ex = {}) {
  const old = mode === 'old', focus = ex.focus || 0;
  const [bx, by] = G.bot_old;
  // person
  ctx.save(); ctx.globalAlpha *= 1 - focus;
  let handP;
  if (old) {
    const raise = prog(t, 9.0, 9.6);
    const arm = t < 9 ? undefined : (t < 11.5 ? lerp(0.2, 0.9, raise) - (t > 10.5 ? 0.2 * Math.sin((t - 10.5) * 4) : 0) : 0.4);
    handP = person(G.person[0], G.person[1], 1.3, { mood: t > 9.5 ? 'sad' : 'ok', t, look: 1, arm, tilt: t > 10.6 && t < 11.4 ? -0.12 : 0 });
  } else {
    const thumbs = t > 24.9;
    handP = person(G.person[0], G.person[1], 1.3, { mood: t > 13.5 ? 'happy' : 'ok', t, look: 1, arm: thumbs ? 0.85 : (t > 11.5 && t < 12.3 ? 0.5 : undefined), thumb: thumbs });
  }
  ctx.restore();

  ctx.save(); ctx.globalAlpha *= 1 - focus;
  editor(t, tasks_done(t), { tick_t, waiting: old && t > 3.4 ? 5 : -1, socket_col: old ? COL.dim : COL.acc });
  ctx.restore();

  // model + wire
  ctx.save(); ctx.globalAlpha *= 1 - focus;
  const pts = G.wire;
  if (old) {
    wire_old(t);
    const dim = t > 7.5 ? 1 : 0;
    // outset: request out and reply back along the wire
    if (t < 3.0) {
      const u = packet_loop(t, 0.4, 1.5);
      if (u >= 0) circle(lerp(pts[0][0], pts[1][0], u), pts[0][1], 12, COL.acc);
    }
    // re-send after the cache is lost
    if (t > 5.2 && t < 6.05) { const u = ease.in_out_cubic(prog(t, 5.2, 6.0)); chip_on(pts, u, 0.32, { lit: 0, tail_stroke: COL.dim, tail_fill: COL.accDark }); }
    // the in-flight request that the break destroys
    if (t > 6.4 && t < 7.5) { const u = prog(t, 6.4, 7.5) * 0.46; chip_on(pts, u, 0.32, { lit: 5 }); }
    if (t >= 7.5 && t < 8.6) {
      const p = prog(t, 7.5, 8.6);
      for (let i = 0; i < 6; i++) {
        const a = hash(i + 9) * Math.PI * 2, d = 90 * ease.out_cubic(p);
        ctx.save(); ctx.globalAlpha *= 1 - p; rr(1400 + Math.cos(a) * d - 8, pts[0][1] + Math.sin(a) * d - 10 + 50 * p * p, 16, 20, 4); fill_stroke(i < 4 ? COL.acc : null, i < 4 ? null : COL.dim, 3); ctx.restore();
      }
    }
    model_node(G.model[0], G.model[1], 1, t < 6.1 ? pulse(t, 6.0, 0.4) : 0, dim);
  } else {
    line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], COL.line, 6);
    const run = packet_loop(t, 14.2, 1.2);
    if (run >= 0 && t < 24.4) circle(lerp(pts[0][0], pts[1][0], run), pts[0][1], 12, COL.acc);
    model_node(G.model[0], G.model[1], 1, t > 14.2 ? 0.3 + 0.3 * Math.sin(t * 5) : 0, 0);
  }
  ctx.restore();

  // bot
  if (old) {
    let mood = 'ok', hR, hL, sag = 0;
    const slotp = [bx + 104, by - 85];
    const item = track(t, [[0, 1290, 840], [2.2, 1290, 840], [3.0, 1215, 745], [3.85, 1215, 745], [4.0, slotp[0], slotp[1]]], ease.in_cubic);
    if (t < 2.2) { const ph = Math.sin(t * Math.PI * 4); hL = [-70, -40 - 14 * ph]; hR = [70, -40 + 14 * ph]; }
    else if (t < 4.0) { hR = [(item[0] - bx) / 1.3, (item[1] - by) / 1.3]; hL = [-80, -30]; }
    if (t >= 4.0 && t < 5.0) mood = 'surprised'; else if (t >= 5 && t < 7.5) mood = 'worried'; else if (t >= 7.5 && t < 9) mood = 'dizzy'; else if (t >= 9) mood = 'sad';
    if (t >= 4.0 && t < 7.5) { hL = [-96, -80 + 8 * Math.sin(t * 12)]; hR = [96, -80 - 8 * Math.sin(t * 12)]; }
    sag = ease.out_cubic(prog(t, 7.5, 8.5)) * (t >= 9 ? 1 : 0.7);
    if (t >= 7.5) { hL = [-70, -20]; hR = [70, -20]; }
    bot(bx, by, 1.3, { mood, t, handL: hL, handR: hR, sag, antenna: t >= 7.5 ? 0 : 1 });
    // tool slot on the bot's side with the tool plugged in
    rr(bx + 62 * 1.3, by - 138, 54, 108, 10); fill_stroke(COL.panel, COL.line, 4);
    [0, 1, 2].forEach(i => { ctx.save(); ctx.globalAlpha *= 0.5; line(bx + 76 * 1.3 + 4, by - 112 + i * 34, bx + 108 * 1.3 - 12, by - 112 + i * 34, COL.line, 4); ctx.restore(); });
    tool_icon(item[0], item[1], 0, 0.9);
    // the bubble carrying the request above the bot
    ctx.save(); ctx.globalAlpha *= 1 - focus;
    request_bubble(t, 'old');
    ctx.restore();
    // glass dome the person can't get through
    if (t >= 9.0 && t < 12) {
      const a = ease.out_cubic(prog(t, 9.0, 9.5));
      ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.ellipse(bx, by - 130, 170, 250, 0, Math.PI, Math.PI * 2); ctx.lineTo(bx + 170, by + 40); ctx.lineTo(bx - 170, by + 40); ctx.closePath();
      ctx.fillStyle = 'rgba(126,226,184,0.06)'; ctx.fill(); ctx.strokeStyle = 'rgba(230,237,243,0.35)'; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
    }
    // the person's arrow flies at it and bounces off
    if (t >= 9.6 && t < 11.5) {
      const hit = [bx - 120, by - 190];
      const hp = [handP[0], handP[1]];
      const fly = prog(t, 9.6, 10.5), back = prog(t, 10.5, 11.3);
      const x = lerp(hp[0], hit[0], ease.in_cubic(fly)) - 160 * ease.out_cubic(back), y = lerp(hp[1], hit[1], ease.in_cubic(fly)) + 340 * back * back - 80 * Math.sin(back * Math.PI);
      ctx.save(); ctx.globalAlpha *= 1 - prog(t, 11.1, 11.5); cursor_arrow(x - 4, y - 4, 1.6, COL.ink); ctx.restore();
      const ip = prog(t, 10.5, 10.95);
      if (ip > 0 && ip < 1) { ctx.save(); ctx.globalAlpha *= 1 - ip; circle(hit[0], hit[1], 30 + 90 * ip, null, COL.acc, 6); ctx.restore(); }
    }
    // cost view the person can't see: a dark gauge with a question mark
    if (t >= 10.3) {
      const a = ease.out_cubic(prog(t, 10.3, 10.8)); ctx.save(); ctx.globalAlpha *= a * (1 - focus);
      ctx.translate(1040, 262); ctx.beginPath(); ctx.arc(0, 0, 70, Math.PI, 2 * Math.PI); ctx.strokeStyle = COL.line; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -26, 17, 1.1 * Math.PI, 2.35 * Math.PI); ctx.lineTo(0, -4); ctx.strokeStyle = COL.dim; ctx.lineWidth = 7; ctx.stroke(); circle(0, 8, 4, COL.dim);
      ctx.restore();
    }
  } else {
    // solution: hop to the bench, lia takes over
    const hop = prog(t, 12.5, 13.5);
    const px = lerp(1300, G.bench[0], ease.in_out_cubic(hop)), py = G.bench[1] - 90 * Math.sin(hop * Math.PI);
    let mood = t < 12.5 ? 'worried' : (t < 13.5 ? 'surprised' : (t >= 24.0 ? 'relax' : 'happy'));
    let hL, hR;
    if (t >= 24.0) { hL = [-66, -196]; hR = [66, -196]; }
    else if (t >= 13.5) { const w = Math.sin(t * 6); hL = [-80, -30]; hR = [96, -110 + 20 * w]; }
    ctx.save(); ctx.globalAlpha *= 1 - focus; ctx.globalAlpha *= 1;
    bot(px, py, 1.1, { mood, t, handL: hL, handR: hR, sag: 0 });
    if (t >= 13.5) { rr(G.bench[0] - 120, G.bench[1] + 4, 240, 22, 10); fill_stroke(COL.panel, COL.line, 4); }
    ctx.restore();
    // ACP link and the task card riding it
    ctx.save(); ctx.globalAlpha *= 1 - focus;
    const lp = prog(t, 12.0, 12.5);
    stroke_poly(G.link, COL.acc, 6, 0, ease.out_cubic(lp));
    if (t >= 12.5 && t < 13.5) {
      const u = ease.in_out_cubic(prog(t, 12.5, 13.5)), p = poly_at(G.link, u);
      ctx.save(); ctx.translate(p.x, p.y); rr(-22, -28, 44, 56, 8); fill_stroke(COL.panel, COL.acc, 4);
      [0, 1, 2].forEach(i => line(-12, -14 + i * 14, 12 - (i === 2 ? 8 : 0), -14 + i * 14, COL.acc, 3)); ctx.restore();
    }
    line(1040, 485, 1040, 565, COL.acc, 6);
    request_bubble(t, 'new');
    // meter replaces the dark gauge
    if (t >= 14.5) {
      const a = ease.out_cubic(prog(t, 14.5, 15.0)); ctx.save(); ctx.globalAlpha *= a;
      const lit = t < 15.0 ? 2 : t < 15.5 ? 3 : t < 16.5 ? 4 : t < 24.5 ? 6 : 8;
      for (let i = 0; i < 8; i++) { rr(1040 - 4 * 22 + i * 22 + 2, 240, 18, 36, 5); fill_stroke(i < lit ? COL.acc : COL.line, null); }
      ctx.restore();
    }
    ctx.restore();
    // result: a check over the editor
    if (t >= 25.0) {
      const p = spring_t(t - 25.0, 8, 2), e = G.editor;
      ctx.save(); ctx.translate(e[0] + e[2] / 2, e[1] + 250); ctx.scale(Math.min(1.3, p), Math.min(1.3, p));
      circle(0, 0, 90, COL.panel, COL.acc, 8); ctx.beginPath(); ctx.moveTo(-40, 4); ctx.lineTo(-10, 36); ctx.lineTo(44, -30); ctx.strokeStyle = COL.acc; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
    }
  }
}

function request_bubble(t, mode) {
  const [cx, cy] = G.bubble;
  ctx.save();
  rr(cx - 175, cy - 62, 350, 124, 26); fill_stroke(COL.panel, COL.line, 4);
  ctx.beginPath(); ctx.moveTo(cx - 16, cy + 62); ctx.lineTo(cx, cy + 86); ctx.lineTo(cx + 16, cy + 62); ctx.closePath(); fill_stroke(COL.panel, COL.line, 4);
  ctx.restore();
  const s = 0.6;
  if (mode === 'old') {
    let o = { lit: 5, glow: 1 };
    if (t >= 4.0) {
      o.glow = 0;
      o.seg = i => {
        if (i >= 5) return { dx: 0, dy: 0, rot: 0, a: 1 };
        const fall = prog(t, 4.08, 4.7), reb = prog(t, 4.8 + i * 0.07, 5.2 + i * 0.07);
        if (t < 4.08) return { dx: 0, dy: 0, rot: 0, a: 1 };
        if (t < 4.7) return { dx: (hash(i + 1) - 0.5) * 70 * fall, dy: 260 * fall * fall, rot: (hash(i + 4) - 0.5) * 2 * fall, a: 1 - fall };
        return { dx: 0, dy: 0, rot: 0, a: ease.out_cubic(reb) };
      };
      o.front_fill = t < 4.08 ? '#ffffff' : COL.accDark;
    }
    request_bar(cx, cy, s, o);
  } else {
    // front stays lit while tools load; the tail changes
    const o = { lit: 5, glow: 1 };
    o.lit = t < 13.5 ? 0 : 5;
    request_bar(cx, cy, s, { ...o, tail_stroke: COL.dim });
  }
}

// ---------- scenes ----------
function s_stage(t) {
  // outset through solution and result run on one stage with a moving camera
  const keys = [[0, 1.0, 960, 540], [3.0, 1.55, 1050, 650], [5.5, 1.5, 1040, 640], [6.0, 1.35, 1420, 610], [8.5, 1.35, 1420, 610], [9.0, 1.2, 760, 620],
    [11.5, 1.2, 760, 620], [12.0, 1.0, 960, 540], [14.0, 1.0, 960, 540], [15.4, 1.5, 1040, 620]];
  let [z, cx, cy] = track(t, keys, ease.in_out_cubic);
  if (t >= 15.4 && t < 16.0) { const p = ease.in_expo(prog(t, 15.4, 16.0)); z = 1.5 * Math.exp(Math.log(14 / 1.5) * p); cx = 1040; cy = 650; }
  if (t >= 23.5 && t < 24.5) { const p = ease.out_expo(prog(t, 23.5, 24.1)); z = 14 * Math.exp(-Math.log(14 / 1.0) * p); cx = lerp(1040, 960, p); cy = lerp(650, 540, p); }
  if (t >= 24.1 && t < 26.0) { z = 1.0; cx = 960; cy = 540; }
  if (t >= 26.0) { const p = ease.in_out_cubic(prog(t, 26.0, 26.5)); z = lerp(1.0, 2.69, p); cx = lerp(960, 1040, p); cy = lerp(540, 650, p); }
  z *= 1 + 0.006 * Math.sin(t * 1.3);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
  const focus = t >= 26.0 ? ease.in_out_cubic(prog(t, 26.0, 26.4)) : 0;
  if (t < 11.5) stage(t, 'old');
  else if (t < 12.0) {
    stage(t, 'old');
    const R = 1800 * ease.in_cubic(prog(t, 11.5, 12.0));
    ctx.save(); ctx.beginPath(); ctx.arc(G.click[0], G.click[1], R, 0, Math.PI * 2); ctx.clip();
    const m = ctx.getTransform(); ctx.setTransform(1, 0, 0, 1, 0, 0); backdrop(); ctx.setTransform(m);
    stage(t, 'new'); lia_block(t); ctx.restore();
  } else { stage(t, 'new', { focus }); lia_block(t, focus); }
  // person's click ripple
  if (t >= 11.2 && t < 12.0) {
    const p = prog(t, 11.5, 12.0), a = 1 - p;
    cursor_arrow(G.click[0] - 4, G.click[1] - 4, 1.5, COL.ink);
    if (t >= 11.5) { ctx.save(); ctx.globalAlpha *= a; circle(G.click[0], G.click[1], 16 + 90 * p, null, COL.acc, 5); ctx.restore(); }
  }
  ctx.restore();
}

function lia_block(t, focus = 0) {
  const [x, y] = G.lia, born = 11.8;
  const sc = t < born ? 0 : Math.min(1.12, spring_t(t - born, 7, 2));
  if (sc <= 0) return;
  const pu = 1 + 0.06 * pulse(t, 13.5, 0.3) + 0.03 * pulse(t, 14.5, 0.3) + 0.02 * pulse(t, 15.0, 0.3);
  ctx.save(); ctx.translate(x, y); ctx.scale(sc * pu, sc * pu);
  if (t > 13.4) { ctx.shadowColor = COL.acc; ctx.shadowBlur = 30 * (0.5 + 0.5 * pulse(t, 13.5, 0.6)); }
  rr(-130, -85, 260, 170, 22); fill_stroke(COL.acc, null);
  ctx.shadowBlur = 0; draw_mark(0, 0, 86, COL.bg);
  ctx.restore();
}

// ---------- demo scenes (inside lia) ----------
function corner_bot(t, mood, hands) { bot(230, 1020, 1.0, { mood, t, handL: hands && hands[0], handR: hands && hands[1] }); }

function s_demo1(t) {
  backdrop();
  const cx = 960, cy = 360, s = 1.9;
  ctx.save(); ctx.globalAlpha *= ease.out_cubic(prog(t, 16.0, 16.5));
  request_bar(cx, cy, s, { lit: 5, glow: 1, tail_stroke: COL.dim });
  const x0 = cx + seg_x(0, s), x1 = cx + seg_x(4, s) + BAR.w * s, by = cy + BAR.h * s / 2 + 44;
  const br = ease.out_cubic(prog(t, 16.4, 17.0)); stroke_poly([[x0, by - 14], [x0, by], [x1, by], [x1, by - 14]], COL.acc, 5, 0, br);
  ctx.restore();
  // menu
  const mx = 980, my = 600, mw = 640, mh = 300; ctx.save(); ctx.globalAlpha *= ease.out_cubic(prog(t, 16.2, 16.7));
  rr(mx, my, mw, mh, 22); fill_stroke(COL.panel, COL.ink, 5);
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.setLineDash([12, 12]); rr(mx + 24, my + 24 + i * 68, mw - 48, 52, 12); ctx.strokeStyle = COL.line; ctx.lineWidth = 3; ctx.stroke(); ctx.restore(); }
  const segx = cx + seg_x(7, s) + BAR.w * s / 2, hot = [0, 1, 2, 3].reduce((a, i) => Math.max(a, pulse(t, 17.0 + i * 0.5 + 0.1, 0.4)), 0);
  stroke_poly([[mx + mw / 2, my], [mx + mw / 2, by + 60], [segx, by + 60], [segx, cy + BAR.h * s / 2]], hot > 0 ? COL.ink : COL.line, 4);
  ctx.restore();
  // the tail changes as menu entries load
  const hotseg = [0, 1, 2, 3].reduce((a, i) => Math.max(a, pulse(t, 17.0 + i * 0.5 + 0.1, 0.4)), 0);
  if (hotseg > 0) { ctx.save(); ctx.globalAlpha *= hotseg * 0.9; const w = BAR.w * s, h = BAR.h * s; rr(cx + seg_x(7, s), cy - h / 2, w, h, 12 * s / 2); fill_stroke(COL.ink, null); ctx.restore(); }
  // tools fly into the slots
  for (let i = 0; i < 4; i++) {
    const arrive = 17.0 + i * 0.5, sx = 360 + i * 120, sy = 780;
    const p = ease.in_out_cubic(prog(t, arrive - 0.7, arrive));
    const px = lerp(sx, mx + 70, p), py = lerp(sy, my + 50 + i * 68, p) - 90 * Math.sin(p * Math.PI);
    ctx.save(); ctx.globalAlpha *= ease.out_cubic(prog(t, 16.2 + i * 0.1, 16.6 + i * 0.1)); tool_icon(px, py, i % 2, 1.1); ctx.restore();
    if (t >= arrive) { const r = prog(t, arrive, arrive + 0.5); ctx.save(); ctx.globalAlpha *= 1 - r; rr(mx + 24, my + 24 + i * 68, mw - 48, 52, 12); ctx.strokeStyle = COL.acc; ctx.lineWidth = 4; ctx.stroke(); ctx.restore(); }
  }
  corner_bot(t, 'happy', [[-80, -30], [96, -110 + 18 * Math.sin(t * 6)]]);
  kinetic('cache stays warm', 960, 990, t, 16.5, 18.5, 60);
}

function s_demo2(t) {
  backdrop();
  const ly = 540;
  line(450, ly, 900, ly, COL.dim, 6); line(1020, ly, 1470, ly, COL.dim, 6);
  const healed = prog(t, 20.0, 20.25), broken = t < 20.0;
  if (broken) { ctx.save(); ctx.globalAlpha *= 0.9; line(938, 518, 982, 562, COL.ink, 7); line(982, 518, 938, 562, COL.ink, 7); ctx.restore(); }
  if (healed > 0) stroke_poly([[900, ly], [1020, ly]], COL.acc, 6, 0, healed);
  // lia
  ctx.save(); ctx.translate(360, ly); rr(-90, -62, 180, 124, 18); fill_stroke(COL.acc, null); draw_mark(0, 0, 62, COL.bg); ctx.restore();
  // retry arrow
  const sp = prog(t, 19.6, 20.0);
  ctx.save(); ctx.translate(360, 410); ctx.rotate(sp * Math.PI * 2 * ease.in_out_cubic(1)); ctx.beginPath(); ctx.arc(0, 0, 40, 1.2 * Math.PI, 2.75 * Math.PI); ctx.strokeStyle = COL.ink; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(30, -34); ctx.lineTo(44, -16); ctx.lineTo(20, -12); ctx.strokeStyle = COL.ink; ctx.stroke(); ctx.restore();
  // packets
  if (t >= 19.1 && t < 19.6) circle(lerp(450, 900, (t - 19.1) / 0.5), ly, 17, COL.acc);
  if (t >= 19.6 && t < 19.95) { const p = (t - 19.6) / 0.35; ctx.save(); ctx.globalAlpha *= 1 - p; circle(900, ly, 17 + 40 * p, null, COL.acc, 5); ctx.restore(); }
  if (t >= 20.0 && t < 21.1) { const x = lerp(450, 1470, (t - 20.0) / 1.1); circle(x, ly, 17, COL.acc); }
  model_node(1560, ly, 1, t >= 21.1 ? 0.5 + 0.5 * pulse(t, 21.1, 0.4) + 0.3 : 0, 0);
  corner_bot(t, t < 19.6 ? 'ok' : (t < 21.1 ? 'worried' : 'happy'), [[-80, -30], [96, -30 + 14 * Math.sin(t * 5)]]);
  kinetic('retries', 960, 860, t, 19.3, 21.3, 60);
}

function s_demo3(t) {
  backdrop();
  const BASE = 540, BEND = -260, JOIN = 1000, END = 1660, RUN = 21.6, SPD = 700;
  const sm = u => u * u * (3 - 2 * u);
  const bendp = ease.in_out_cubic(prog(t, 22.65, 23.15)), k = BEND * bendp;
  const yAt = x => (x <= JOIN ? BASE : BASE + k * sm((x - JOIN) / (END - JOIN)));
  const pts = []; for (let x = 260; x < JOIN; x += 40) pts.push([x, BASE]);
  for (let x = JOIN; x <= END; x += 20) pts.push([x, yAt(x)]);
  stroke_poly(pts, COL.dim, 6);
  circle(260, BASE, 16, COL.dim);
  circle(END, yAt(END), 17, COL.panel, COL.dim, 6);
  [500, 860, 1220, 1580].forEach((x, i) => {
    const pass = RUN + (x - 260) / SPD, on = t >= pass;
    circle(x, yAt(x), 23 + 10 * pulse(t, pass, 0.3), COL.panel, on ? COL.acc : COL.dim, 5);
  });
  const dx = Math.min(END, 260 + (t - RUN) * SPD);
  if (t >= RUN) circle(dx, yAt(dx), 17, COL.acc);
  // the person's arrow
  const hand = person(190, 1010, 0.9, { mood: 'ok', t, look: 1, arm: 0.7 });
  if (t >= 21.65 && t < 22.95) {
    const p = ease.in_out_cubic(prog(t, 21.65, 22.65)), x = lerp(hand[0], 1000, p), y = lerp(hand[1], BASE + 70, p) + 70 * Math.sin(p * Math.PI);
    ctx.save(); ctx.globalAlpha *= 1 - prog(t, 22.7, 22.95); cursor_arrow(x - 14, y - 4, 1.8, COL.acc); ctx.restore();
  }
  // meter
  const ma = ease.out_cubic(prog(t, 21.6, 22.0)); ctx.save(); ctx.globalAlpha *= ma;
  for (let i = 0; i < 8; i++) {
    rr(1260 + i * 50, 880, 40, 40, 6); fill_stroke(COL.line, null);
    const callIdx = Math.floor(i / 2), pass = RUN + ([500, 860, 1220, 1580][callIdx] - 260) / SPD + 0.05 + (i % 2) * 0.1;
    if (t >= pass) { ctx.save(); ctx.globalAlpha *= ease.out_cubic(prog(t, pass, pass + 0.25)); rr(1260 + i * 50, 880, 40, 40, 6); fill_stroke(COL.acc, null); ctx.restore(); }
  }
  ctx.restore();
  kinetic('steer', 1150, 960, t, 21.9, 23.0, 56);
  kinetic('live cost', 1455, 850, t, 22.1, 23.5, 56);
  if (t >= 23.0) { ctx.save(); ctx.globalAlpha *= ease.in_cubic(prog(t, 23.0, 23.5)); ctx.fillStyle = COL.acc; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

// ---------- brand ----------
function s_brand(t) {
  backdrop();
  const rect = 1 - ease.in_out_cubic(prog(t, 26.6, 27.4));
  const move = ease.in_out_cubic(prog(t, 26.8, 27.6));
  const size = lerp(232, 300, move), mx = lerp(960, 742, move);
  if (rect > 0.001) { ctx.save(); ctx.globalAlpha *= rect; rr(960 - 350, 540 - 228, 700, 457, 60); fill_stroke(COL.acc, null); ctx.restore(); }
  const mcol = rect > 0.6 ? COL.bg : COL.acc;
  const k = prog(t, 26.6, 27.2);
  ctx.save(); ctx.shadowColor = COL.acc; ctx.shadowBlur = 30 * pulse(t, 27.4, 0.8);
  draw_mark(mx, 470, size, k < 0.5 ? COL.bg : COL.acc); ctx.restore();
  kinetic('lia', 1135, 540, t, 27.5, 99, 220, COL.ink);
  const ua = ease.out_cubic(prog(t, 28.2, 28.7)); text('github.com/ap-justin/lia', 960, 760, 60, COL.acc, 700, 'center', ua);
  const ca = ease.out_cubic(prog(t, 28.8, 29.3)); text('Based on fx by Vercel Labs.', 960, 900, 30, COL.dim, 400, 'center', ca);
  if (t > 29.6) { ctx.save(); ctx.globalAlpha *= prog(t, 29.6, 30); ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H); ctx.restore(); }
}

function draw(t) {
  t = Math.max(0, Math.min(DUR - 1e-4, t));
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  backdrop();
  if (t < 16.0) s_stage(t);
  else if (t < 18.5) s_demo1(t);
  else if (t < 19.0) push(t, s_demo1, s_demo2, 18.5, 19.0);
  else if (t < 21.0) s_demo2(t);
  else if (t < 21.5) push(t, s_demo2, s_demo3, 21.0, 21.5);
  else if (t < 23.5) s_demo3(t);
  else if (t < 26.5) s_stage(t);
  else s_brand(t);
  // accent wash as the zoom-through lands inside lia, and as lia opens into the result
  if (t >= 16.0 && t < 16.4) { ctx.save(); ctx.globalAlpha = 1 - ease.out_cubic(prog(t, 16.0, 16.4)); ctx.fillStyle = COL.acc; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  if (t >= 23.5 && t < 24.0) { ctx.save(); ctx.globalAlpha = 1 - prog(t, 23.55, 23.95); ctx.fillStyle = COL.acc; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  overlay_labels(t);
  finish(t);
}

function push(t, a, b, t0, t1) {
  const p = ease.in_out_cubic(prog(t, t0, t1));
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.translate(-W * p, 0); a(t); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); ctx.translate(W * (1 - p), 0); b(t); ctx.restore();
}

function overlay_labels(t) {
  const y = 1015;
  kinetic('long task', 960, y, t, 0.8, 2.8, 60);
  kinetic('cache lost', 960, y, t, 4.1, 5.9, 60);
  kinetic('connection drops', 960, y, t, 6.4, 8.9, 60);
  kinetic('no steer, no cost', 960, y, t, 9.3, 11.4, 60);
  kinetic('ACP', 960, y, t, 12.5, 14.0, 60, COL.acc);
  kinetic('one binary', 960, y, t, 14.1, 15.6, 60);
  kinetic('done', 960, y, t, 24.6, 26.0, 60);
}
