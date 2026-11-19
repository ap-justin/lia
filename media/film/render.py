"""Render frames as JPEG, resumable: python render.py FRAMES_DIR [WORKERS]. Existing frames are skipped."""
import base64, pathlib, subprocess, sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
HTML = HERE / 'out' / 'lia-30s.html'
FPS, DUR = 30, 30


def work(frames_dir, part, parts):
    todo = [i for i in range(FPS * DUR) if i % parts == part and not (frames_dir / f'{i:05d}.jpg').exists()]
    if not todo:
        return
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--disable-dev-shm-usage', '--no-sandbox'])
        pg = b.new_page(viewport={'width': 1920, 'height': 1080})
        pg.on('pageerror', lambda e: sys.exit(f'pageerror: {e}'))
        pg.goto(f'file://{HTML}?render')
        pg.wait_for_function('window.reel_ready===true')
        for n, i in enumerate(todo):
            url = pg.evaluate(f'(draw_at({i / FPS}), window.canvas.toDataURL("image/jpeg", 0.96))')
            tmp = frames_dir / f'{i:05d}.tmp'
            tmp.write_bytes(base64.b64decode(url.split(',', 1)[1]))
            tmp.rename(frames_dir / f'{i:05d}.jpg')
            if n % 50 == 0:
                print(f'part {part}: {n}/{len(todo)}', flush=True)
        b.close()


if __name__ == '__main__':
    frames_dir = pathlib.Path(sys.argv[1]); frames_dir.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 3 and sys.argv[3] == '--part':
        work(frames_dir, int(sys.argv[4]), int(sys.argv[5]))
    else:
        workers = int(sys.argv[2]) if len(sys.argv) > 2 else 6
        procs = [subprocess.Popen([sys.executable, __file__, str(frames_dir), str(workers), '--part', str(k), str(workers)]) for k in range(workers)]
        codes = [p.wait() for p in procs]
        print('frames on disk:', len(list(frames_dir.glob('*.jpg'))), 'exit codes', codes)
