#!/usr/bin/env python3
"""Post-build perf pass for dist/app (behavior-preserving):
- move base64 images embedded in app.js (LOGO, MARK, MARK_HERO, COACH) to /app/img/* files
- minify app.js (whitespace + syntax only, no identifier mangling) with esbuild if available
- content-hash the app.js URL (index.html + sw.js) and bump the SW cache name
- precache the extracted images in the SW, preload the splash mark (LCP)
"""
import base64, hashlib, re, subprocess, sys, os
out = sys.argv[1]
js_p = f"{out}/app/app.js"
s = open(js_p, encoding="utf-8").read()
os.makedirs(f"{out}/app/img", exist_ok=True)
imgs = {}
ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
def repl(m):
    name, mime, b64 = m.group(1), m.group(2), m.group(3)
    data = base64.b64decode(b64)
    if name == "MARK" and mime == "image/png":  # splash/LCP logo: WebP q90 + lossless alpha (PSNR ~44 dB, 161 KB -> ~47 KB)
        import io
        from PIL import Image
        buf = io.BytesIO(); Image.open(io.BytesIO(data)).convert("RGBA").save(buf, "WEBP", quality=90, alpha_quality=100, method=6)
        data, mime = buf.getvalue(), "image/webp"
    h = hashlib.sha256(data).hexdigest()[:10]
    fn = f"{name.lower()}.{h}.{ext[mime]}"
    open(f"{out}/app/img/{fn}", "wb").write(data)
    imgs[name] = "/app/img/" + fn
    return f'const {name} = "/app/img/{fn}";'
s, n = re.subn(r'const (LOGO|MARK|MARK_HERO|COACH) = "data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)";', repl, s)
assert n == 4, n
# Code-split: exercise library + stock routines -> lazy /app/data.<hash>.js (loaded by nbLoadData()).
A = s.index("window.NBexercises = [")
END = "window.NBroutines = window.NBroutinesStock;"
B = s.index(END) + len(END)
data_js = s[A:B] + "\n"
s = s[:A] + s[B:]
data_p = f"{out}/app/data.js"
open(data_p, "w", encoding="utf-8").write(data_js)
open(js_p, "w", encoding="utf-8").write(s)
try:
    subprocess.run(["npx", "-y", "esbuild@0.28.2", data_p, "--minify-whitespace", "--minify-syntax", "--charset=utf8",
                    "--log-level=warning", "--outfile=" + data_p, "--allow-overwrite"], check=True)
except Exception as e:
    print("esbuild data minify skipped:", e, file=sys.stderr)
dh = hashlib.sha256(open(data_p, "rb").read()).hexdigest()[:10]
data_url = f"/app/data.{dh}.js"
os.rename(data_p, f"{out}{data_url}")
# Code-split views: functions not reachable before render()'s gate -> lazy /app/views.<hash>.js
deps = "/tmp/nb-build-deps"
if not os.path.isdir(f"{deps}/node_modules/acorn-walk"):
    subprocess.run(["npm", "install", "--silent", "--no-audit", "--no-fund", "--prefix", deps, "acorn@8", "acorn-walk@8"], check=True)
open(js_p, "w", encoding="utf-8").write(s)
views_p = f"{out}/app/views.js"
subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "split-app.cjs"), js_p, views_p],
               check=True, env=dict(os.environ, NODE_PATH=f"{deps}/node_modules"))
s = open(js_p, encoding="utf-8").read()
try:
    subprocess.run(["npx", "-y", "esbuild@0.28.2", views_p, "--minify-whitespace", "--minify-syntax", "--charset=utf8",
                    "--log-level=warning", "--outfile=" + views_p, "--allow-overwrite"], check=True)
except Exception as e:
    print("esbuild views minify skipped:", e, file=sys.stderr)
vh = hashlib.sha256(open(views_p, "rb").read()).hexdigest()[:10]
views_url = f"/app/views.{vh}.js"
os.rename(views_p, f"{out}{views_url}")
s = f'window.NB_DATA_SRC = "{data_url}";\nwindow.NB_VIEWS_SRC = "{views_url}";\n' + s
open(js_p, "w", encoding="utf-8").write(s)
try:
    subprocess.run(["npx", "-y", "esbuild@0.28.2", js_p, "--minify-whitespace", "--minify-syntax", "--charset=utf8",
                    "--log-level=warning", "--outfile=" + js_p, "--allow-overwrite"], check=True)
except Exception as e:
    print("esbuild minify skipped:", e, file=sys.stderr)
h = hashlib.sha256(open(js_p, "rb").read()).hexdigest()[:10]
for f in ("index.html", "sw.js"):
    t = open(f"{out}/{f}", encoding="utf-8").read()
    t = re.sub(r'/app/app\.js\?v=[A-Za-z0-9._-]+', f"/app/app.js?v={h}", t)
    if f == "sw.js":
        t = re.sub(r'const CACHE = "[^"]+"', f'const CACHE = "nb-app-{h}"', t, count=1)
        t = t.replace('  "/logo.png",\n', '  "/logo.png",\n' + "".join(f'  "{u}",\n' for u in list(imgs.values()) + [data_url, views_url]), 1)
    else:
        t = t.replace('<link rel="stylesheet"', f'<link rel="preload" as="image" href="{imgs["MARK"]}" fetchpriority="high">\n<link rel="stylesheet"', 1)
        # Google Fonts CSS off the critical path (display=swap already; same fonts once loaded)
        t, nf = re.subn(r'<link href="(https://fonts\.googleapis\.com/css2\?[^"]+)" rel="stylesheet">',
                        lambda m: f'<link rel="preload" as="style" href="{m.group(1)}" onload="this.onload=null;this.rel=\'stylesheet\'">'
                                  f'<noscript><link rel="stylesheet" href="{m.group(1)}"></noscript>', t, count=1)
        assert nf == 1, "fonts link not found"
    open(f"{out}/{f}", "w", encoding="utf-8").write(t)
print(f"optimize-app: {n} images extracted, app.js v={h}, {os.path.getsize(js_p)} bytes, data {data_url} {os.path.getsize(out + data_url)} bytes, views {views_url} {os.path.getsize(out + views_url)} bytes")
