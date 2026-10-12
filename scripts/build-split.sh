#!/usr/bin/env bash
# Build the split architecture: marketing landing (web/) + app at its own root.
#   NB_ENV=preview    bash scripts/build-split.sh   -> dist/web, dist/app (pages.dev URLs, noindex)
#   NB_ENV=production bash scripts/build-split.sh   -> niubision.com / app.niubision.com (indexable)
# Single source of truth for cross-links: the case block below (WEB_URL / APP_URL).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
env="${NB_ENV:-preview}"
case "$env" in
  production) WEB_URL="https://niubision.com"; APP_URL="https://app.niubision.com"; ROBOTS="index, follow" ;;
  preview)    WEB_URL="https://web.niubision-ui-preview.pages.dev"; APP_URL="https://app.niubision-ui-preview.pages.dev"; ROBOTS="noindex, nofollow" ;;
  *) echo "NB_ENV must be preview|production" >&2; exit 1 ;;
esac
cmp -s "$root/app/app.js" "$root/public/app/app.js" || { echo "app/app.js and public/app/app.js differ" >&2; exit 1; }
out="$root/dist"; rm -rf "$out"; mkdir -p "$out/web" "$out/app/app"
sub() { sed -e "s#__WEB_URL__#$WEB_URL#g" -e "s#__APP_URL__#$APP_URL#g" -e "s#__ROBOTS__#$ROBOTS#g" "$1" > "$2"; }

# ---- web (landing) ----
cp -r "$root/web/assets" "$out/web/"
sub "$root/web/index.html" "$out/web/index.html"
cp "$root/web/404.html" "$out/web/404.html"
if [ "$env" = production ]; then
  printf 'User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n' "$WEB_URL" > "$out/web/robots.txt"
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>%s/</loc></url></urlset>\n' "$WEB_URL" > "$out/web/sitemap.xml"
else
  printf 'User-agent: *\nDisallow: /\n' > "$out/web/robots.txt"
  printf '/*\n  X-Robots-Tag: noindex, nofollow\n' > "$out/web/_headers"
fi

# ---- app (own origin, root scope) ----
cp "$root/app/app.js" "$root/app/styles.css" "$out/app/app/"
for f in favicon.svg logo.png icon-*.png screenshot-phone.png screenshot-wide.png og.jpg intro-poster.jpg intro.mp4 studios.json; do
  [ -e "$root/$f" ] && cp "$root"/$f "$out/app/" 2>/dev/null || true
done
printf 'window.NB_ENV = { ENV: "%s", WEB_URL: "%s", APP_URL: "%s" };\n' "$env" "$WEB_URL" "$APP_URL" > "$out/app/config.js"
python3 - "$root" "$out/app" "$WEB_URL" "$APP_URL" "$ROBOTS" <<'PY'
import sys, re, json
root, out, WEB, APP, ROBOTS = sys.argv[1:]
s = open(f"{root}/index.html", encoding="utf-8").read()
s = s.replace('<script src="/app/app.js', '<script src="/config.js"></script>\n<script src="/app/app.js', 1)
s = s.replace("https://niubision.com/#privacy", APP + "/?view=privacy").replace("https://niubision.com/#terms", APP + "/?view=terms")
s = s.replace("https://niubision.com/manifest.webmanifest", "/manifest.webmanifest")
s = re.sub(r'<link rel="sitemap"[^>]*>\n?', "", s)
s = re.sub(r'https://niubision\.com/(?=[a-z0-9_-]+\.(png|jpg|svg))', APP + "/", s)
s = s.replace("https://niubision.com/", WEB + "/")  # canonical, hreflang, JSON-LD ids -> marketing site
s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="%s">' % ROBOTS, 1)
s = s.replace('<p><a href="' + APP + '/?view=privacy">', '<p><a href="' + WEB + '/">niubision.com</a> · <a href="' + APP + '/?view=privacy">', 1)
open(f"{out}/index.html", "w", encoding="utf-8").write(s)
m = json.load(open(f"{root}/manifest.webmanifest", encoding="utf-8"))
m["id"] = APP + "/"; m["start_url"] = "/"; m["scope"] = "/"
m.pop("related_applications", None)
def rel(u): return re.sub(r"^https://niubision\.com", "", u)
for sc in m.get("shortcuts", []):
    sc["url"] = rel(sc["url"]); [i.update(src=rel(i["src"])) for i in sc.get("icons", [])]
for i in m["icons"] + m.get("screenshots", []): i["src"] = rel(i["src"])
json.dump(m, open(f"{out}/manifest.webmanifest", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
sw = open(f"{root}/sw.js", encoding="utf-8").read()
sw = re.sub(r'const CACHE = "[^"]+"', 'const CACHE = "nb-app-split-v1"', sw, count=1)
sw = sw.replace('  "/index.html",\n', '  "/index.html",\n  "/config.js",\n', 1)
open(f"{out}/sw.js", "w", encoding="utf-8").write(sw)
PY
if [ "$env" = preview ]; then printf 'User-agent: *\nDisallow: /\n' > "$out/app/robots.txt"; printf '/*\n  X-Robots-Tag: noindex, nofollow\n' > "$out/app/_headers"
else printf 'User-agent: *\nAllow: /\n' > "$out/app/robots.txt"; fi
printf '/sw.js\n  Cache-Control: no-cache\n/config.js\n  Cache-Control: no-cache\n' >> "$out/app/_headers"
# assetlinks.json is intentionally NOT copied: see PLAYSTORE.md (template only).
echo "built $env: web=$WEB_URL app=$APP_URL -> $out"
