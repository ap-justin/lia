"""Contact sheet of chosen timestamps: python preview.py OUT_PNG t1,t2,...

Fails on any page or console error. /dev/shm is 64 MB on this sandbox, hence --disable-dev-shm-usage.
"""
import base64, pathlib, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
HTML = HERE / 'out' / 'lia-30s.html'
out = pathlib.Path(sys.argv[1])
times = [float(x) for x in sys.argv[2].split(',')]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 2

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-dev-shm-usage', '--no-sandbox'])
    pg = b.new_page(viewport={'width': 1920, 'height': 1080})
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('console', lambda m: errors.append(f'console {m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    pg.goto(f'file://{HTML}?render')
    pg.wait_for_function('window.reel_ready===true')
    shots = [pg.evaluate(f'(draw_at({t}), window.canvas.toDataURL("image/jpeg", 0.85))') for t in times]
    w = 1920 // cols
    sheet = b.new_page(viewport={'width': 1920, 'height': 10})
    cells = ''.join(f'<div style="width:{w}px;float:left;position:relative"><img src="{s}" style="width:{w}px;display:block">'
                    f'<span style="position:absolute;left:8px;top:6px;font:700 22px monospace;color:#fff;background:#000a;padding:2px 8px">{t:.2f}s</span></div>'
                    for t, s in zip(times, shots))
    sheet.set_content(f'<body style="margin:0;background:#222">{cells}</body>')
    sheet.screenshot(path=str(out), full_page=True)
    b.close()
if errors:
    print('\n'.join(errors)); sys.exit(1)
print('sheet', out, len(times), 'frames, no page or console errors')
