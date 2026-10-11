#!/usr/bin/env bash
# Build PREVIEW combined site: landing at /, app at /app/. Usage: combo/build-combo.sh <landing_dir> <out_dir>
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"; L="${1:-/workspace/saas-landing}"; OUT="${2:-/tmp/nb-combo}"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$REPO/public/." "$OUT/"; rm -rf "$OUT/__grok" "$OUT/CNAME"
cmp "$REPO/app/app.js" "$REPO/public/app/app.js"
# app at /app/
python3 - "$REPO" "$OUT" <<'PY'
import sys,json,re
repo,out=sys.argv[1],sys.argv[2]
h=open(f"{repo}/public/index.html").read()
h=h.replace('href="/manifest.webmanifest?v=and2"','href="/app/manifest.webmanifest?v=combo1"')
open(f"{out}/app/index.html","w").write(h)
m=json.load(open(f"{repo}/public/manifest.webmanifest"))
fix=lambda u:re.sub(r'^https://niubision\.com','',u)
m["id"]="/pwa"  # same resolved id as prod (https://niubision.com/pwa) -> existing installs update in place
m["start_url"]="/app/?source=pwa"; m["scope"]="/app/"
for s in m["shortcuts"]:
    s["url"]=fix(s["url"]).replace("/?","/app/?",1)
    for i in s["icons"]: i["src"]=fix(i["src"])
for i in m["icons"]+m["screenshots"]: i["src"]=fix(i["src"])
m["related_applications"][0]["url"]="/app/manifest.webmanifest"
for p in ("app/manifest.webmanifest","manifest.webmanifest"): json.dump(m,open(f"{out}/{p}","w"),ensure_ascii=False,indent=2)
# SW at root (app.js registers /sw.js, scope / covers /app/)
sw=open(f"{repo}/public/sw.js").read()
sw=sw.replace('nb-offline-hybrid-v15','nb-offline-combo-v1',1).replace('  "/",\n  "/index.html",','  "/app/",\n  "/app/index.html",',1)
sw=sw.replace('(await caches.match("/")) || (await caches.match("/index.html"))','(await caches.match("/app/")) || (await caches.match("/app/index.html"))')
redir='''
// combo: old root app URLs (start_url /?source=pwa, ?view=, ?c=, ?pago=, notification links) -> /app/
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  if (!(u.pathname === "/" || u.pathname === "/index.html" || u.pathname === "/niubision.html")) return;
  let app = false;
  u.searchParams.forEach((v, k) => { if (!/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) app = true; });
  if (app) { e.respondWith(Response.redirect("/app/" + u.search, 302)); e.stopImmediatePropagation(); }
});
'''
sw=sw.replace('self.addEventListener("fetch"', redir.strip()+'\nself.addEventListener("fetch"',1)
sw=sw.replace('const raw = (e.notification.data && e.notification.data.url) || "/";','let raw = (e.notification.data && e.notification.data.url) || "/app/";\n  if (/^\\/(\\?|#|$)/.test(raw)) raw = "/app" + raw;\n  else if (/^[?#]/.test(raw)) raw = "/app/" + raw;')
nc=sw.split('self.addEventListener("notificationclick"',1)
nc[1]=nc[1].replace('let target = "/";','let target = "/app/";',1).replace('target = "/?view=inbox"','target = "/app/?view=inbox"',1).replace('target = "/?view=work"','target = "/app/?view=work"',1).replace('catch (err) { target = "/"; }','catch (err) { target = "/app/"; }',1)
sw='self.addEventListener("notificationclick"'.join(nc)
open(f"{out}/sw.js","w").write(sw)
open(f"{out}/niubision.html","w").write('<!DOCTYPE html><meta charset="utf-8"><script>location.replace("/app/"+location.search+location.hash)</script><meta http-equiv="refresh" content="0; url=/app/">')
PY
# landing at /
cp -r "$L/assets" "$OUT/assets"; cp "$L/404.html" "$OUT/404.html"
python3 - "$L" "$OUT" "$REPO/combo/landing-redirect.html" <<'PY'
import sys
l,out,r=sys.argv[1:]
h=open(f"{l}/index.html").read()
for a in ['href="https://niubision.com/">Entrar','href="https://niubision.com/">Ya tengo código · Entrar']:
    assert a in h; h=h.replace(a,a.replace("https://niubision.com/","/app/"))
h=h.replace('href="https://niubision.com/#privacidad"','href="/app/#privacidad"').replace('href="https://niubision.com/#terminos"','href="/app/#terminos"')
h=h.replace("<head>","<head>\n"+open(r).read().strip(),1)
open(f"{out}/index.html","w").write(h)
PY
printf '/app  /app/  301\n' > "$OUT/_redirects"
printf '/sw.js\n  Cache-Control: no-cache\n/app/manifest.webmanifest\n  Cache-Control: no-cache\n' > "$OUT/_headers"
echo "built $OUT"
