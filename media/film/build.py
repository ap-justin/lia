"""Inline fonts, the score and the three JS files into one HTML that is both the ?render target and the player.

usage: python build.py [WORK_DIR]   (WORK_DIR holds score.mp3 after audio.py; default ./work)
"""
import base64, pathlib, sys

HERE = pathlib.Path(__file__).parent
WORK = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'work'
OUT = HERE / 'out' / 'lia-30s.html'


def b64(path):
    return base64.b64encode(pathlib.Path(path).read_bytes()).decode()


fonts = ''.join(
    "@font-face{font-family:'JetBrains Mono';font-weight:%d;src:url(data:font/woff2;base64,%s) format('woff2');}\n"
    % (w, b64(HERE / 'assets' / f'jetbrains-mono-latin-{w}-normal.woff2'))
    for w in (400, 700)
)
score = WORK / 'score.mp3'
audio = f'<audio id="score" preload="auto" src="data:audio/mpeg;base64,{b64(score)}"></audio>' if score.exists() else ''
js = '\n'.join((HERE / f).read_text() for f in ('engine.js', 'scenes.js', 'player.js'))

html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>lia in 30 seconds</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
{fonts}
html,body{{margin:0;height:100%;background:#0d1117;overflow:hidden;font-family:'JetBrains Mono',monospace;color:#e6edf3}}
#stage{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}}
canvas{{max-width:100vw;max-height:calc(100vh - 64px);aspect-ratio:16/9;width:auto;height:auto;background:#0d1117}}
body.render canvas{{max-width:none;max-height:none;width:1920px;height:1080px}}
#bar{{position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;align-items:center;gap:16px;padding:0 20px;background:#0a0e13;border-top:1px solid #2a3340}}
body.render #bar{{display:none}}
button{{font:inherit;color:#e6edf3;background:none;border:1px solid #2a3340;border-radius:8px;padding:6px 14px;cursor:pointer}}
button:hover{{border-color:#7ee2b8}}
#track{{position:relative;flex:1;height:24px;display:flex;align-items:center}}
#tl{{width:100%;accent-color:#7ee2b8;margin:0}}
#marks i{{position:absolute;top:2px;width:2px;height:20px;background:#7d8a94;opacity:.6;pointer-events:none}}
#clock{{min-width:130px;text-align:right;color:#7d8a94;font-size:14px}}
</style></head>
<body>
<div id="stage"><canvas id="c" width="1920" height="1080"></canvas></div>
<div id="bar"><button id="play">play</button><button id="snd">sound on</button>
<div id="track"><input id="tl" type="range" min="0" max="1000" value="0"><div id="marks"></div></div><span id="clock"></span></div>
{audio}
<script>
{js}
</script></body></html>
"""
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(html)
print('wrote', OUT, f'{OUT.stat().st_size / 1e6:.2f} MB', 'with score' if audio else 'no score')
