// Modes: ?render exposes a bare canvas for the frame renderer; no query is the scrubbable player.
const RENDER = location.search.includes('render');
const POSTER_T = 8.0;
const CHAPTERS = [[0, 'outset'], [3, 'problem'], [12, 'solution'], [16, 'demo'], [24, 'result'], [26.5, 'brand']];

async function boot() {
  await Promise.all([document.fonts.load('400 40px "JetBrains Mono"'), document.fonts.load('700 40px "JetBrains Mono"')]);
  canvas.width = W; canvas.height = H;
  window.canvas = canvas;
  window.draw_at = t => { draw(t); };
  if (RENDER) {
    document.body.classList.add('render');
    window.reel_ready = true;
    return;
  }
  build_player();
  window.reel_ready = true;
}

function build_player() {
  const bar = document.getElementById('bar'), play = document.getElementById('play'), snd = document.getElementById('snd');
  const tl = document.getElementById('tl'), clock = document.getElementById('clock'), marks = document.getElementById('marks');
  const audio = document.getElementById('score');
  const has_score = !!audio;
  if (!has_score) snd.style.display = 'none';
  CHAPTERS.forEach(([t, name]) => {
    const m = document.createElement('i'); m.style.left = (t / DUR * 100) + '%'; m.title = name; marks.appendChild(m);
  });
  let playing = false, sound = has_score, t = POSTER_T, t_anchor = 0, wall_anchor = 0;
  const show = () => {
    draw(t); tl.value = t / DUR * 1000;
    clock.textContent = t.toFixed(1) + ' / ' + DUR.toFixed(0) + ' s';
  };
  const set_playing = on => {
    playing = on; play.textContent = on ? 'pause' : 'play';
    if (on) {
      if (t >= DUR - 0.05) t = 0;
      t_anchor = t; wall_anchor = performance.now();
      if (has_score && sound) { audio.currentTime = t; audio.play(); }
    } else if (has_score) audio.pause();
  };
  const frame = () => {
    if (playing) {
      t = has_score && sound && !audio.paused ? audio.currentTime : t_anchor + (performance.now() - wall_anchor) / 1000;
      if (t >= DUR) { t = DUR - 0.001; set_playing(false); }
    }
    show(); requestAnimationFrame(frame);
  };
  play.onclick = () => set_playing(!playing);
  snd.onclick = () => {
    sound = !sound; snd.textContent = sound ? 'sound on' : 'sound off';
    if (playing && has_score) { if (sound) { audio.currentTime = t; audio.play(); } else audio.pause(); t_anchor = t; wall_anchor = performance.now(); }
  };
  snd.textContent = 'sound on';
  tl.oninput = () => { t = tl.value / 1000 * DUR; t_anchor = t; wall_anchor = performance.now(); if (has_score) audio.currentTime = t; show(); };
  window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); set_playing(!playing); } });
  frame();
}
boot();
