"""Dump the film's event schedule (messages, arrivals, strain curve) from the page so audio.py lands every effect on its visual time.

usage: python export_events.py WORK_DIR   (needs out/lia-30s.html from build.py)
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
work = pathlib.Path(sys.argv[1]); work.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage', '--no-sandbox'])
    pg = b.new_page()
    pg.goto(f'file://{HERE / "out" / "lia-30s.html"}?render')
    pg.wait_for_function('window.reel_ready===true')
    ev = pg.evaluate('''() => ({
      msgs: MSGS.map(m => ({t0: m.t0, d: m.d, phase: m.phase, a: m.a, b: m.b, ax: AGENTS[m.a].x, bx: AGENTS[m.b].x})),
      arrivals: AGENTS.map((a, i) => ({i, arrive: a.arrive, x: a.x, wave: a.wave === undefined ? -1 : a.wave})),
      collapse: COLLAPSE_T,
      strain: Array.from({length: 601}, (_, k) => strain_at(k / 20)),
      coverage: Array.from({length: 601}, (_, k) => coverage(k / 20)),
    })''')
    b.close()
(work / 'events.json').write_text(json.dumps(ev))
print('events', len(ev['msgs']), 'messages', len(ev['arrivals']), 'agents')
