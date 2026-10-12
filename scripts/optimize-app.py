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
    if name == "MARK" and mime == "image/png":  # splash/LCP logo: lossless WebP = identical pixels, ~40% smaller
        import io
        from PIL import Image
        buf = io.BytesIO(); Image.open(io.BytesIO(data)).save(buf, "WEBP", lossless=True, method=6)
        data, mime = buf.getvalue(), "image/webp"
    h = hashlib.sha256(data).hexdigest()[:10]
    fn = f"{name.lower()}.{h}.{ext[mime]}"
    open(f"{out}/app/img/{fn}", "wb").write(data)
    imgs[name] = "/app/img/" + fn
    return f'const {name} = "/app/img/{fn}";'
s, n = re.subn(r'const (LOGO|MARK|MARK_HERO|COACH) = "data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)";', repl, s)
assert n == 4, n
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
        t = t.replace('  "/logo.png",\n', '  "/logo.png",\n' + "".join(f'  "{u}",\n' for u in imgs.values()), 1)
    else:
        t = t.replace('<link rel="stylesheet"', f'<link rel="preload" as="image" href="{imgs["MARK"]}" fetchpriority="high">\n<link rel="stylesheet"', 1)
    open(f"{out}/{f}", "w", encoding="utf-8").write(t)
print(f"optimize-app: {n} images extracted, app.js v={h}, {os.path.getsize(js_p)} bytes")
