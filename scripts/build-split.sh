#!/usr/bin/env bash
# Build the split architecture: marketing landing (web/) + app at its own root.
#   NB_ENV=preview    bash scripts/build-split.sh   -> dist/web, dist/app (pages.dev URLs, noindex)
#   NB_ENV=production bash scripts/build-split.sh   -> niubision.com / niubision.app (indexable)
# Deploy: (cd dist/web-project && wrangler pages deploy ../web --project-name niubision-web --branch main)
#         wrangler pages deploy dist/app --project-name niubision-app --branch main
# Single source of truth for cross-links: the case block below (WEB_URL / APP_URL).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
env="${NB_ENV:-preview}"
case "$env" in
  production) WEB_URL="https://niubision.com"; APP_URL="https://niubision.app"; NFW_URL="https://workouts.niubision.app"; ROBOTS="index, follow" ;;
  preview)    WEB_URL="https://web.niubision-ui-preview.pages.dev"; APP_URL="https://app.niubision-ui-preview.pages.dev"; NFW_URL="https://v3-premium.nfw-preview.pages.dev"; ROBOTS="noindex, nofollow" ;;
  *) echo "NB_ENV must be preview|production" >&2; exit 1 ;;
esac
cmp -s "$root/app/app.js" "$root/public/app/app.js" || { echo "app/app.js and public/app/app.js differ" >&2; exit 1; }
out="$root/dist"; rm -rf "$out"; mkdir -p "$out/web" "$out/app/app"
# Tarjeta (Stripe) solo cuando esté activa: NB_STRIPE=1. Si no, PayPal y ATH Móvil.
if [ "${NB_STRIPE:-0}" = 1 ]; then PAY_LD="PayPal, ATH Móvil, tarjeta (Stripe)"; PAY_FAQ="PayPal, ATH Móvil o tarjeta por Stripe"; else PAY_LD="PayPal, ATH Móvil"; PAY_FAQ="PayPal o ATH Móvil"; fi
sub() { sed -e "s#__PAY_LD__#$PAY_LD#g" -e "s#__PAY_FAQ__#$PAY_FAQ#g" -e "s#__WEB_URL__#$WEB_URL#g" -e "s#__APP_URL__#$APP_URL#g" -e "s#__ROBOTS__#$ROBOTS#g" -e "s#__NFW_URL__#$NFW_URL#g" "$1" > "$2"; }

LASTMOD="$(date -u +%Y-%m-%d)"
WEB_HEADERS="/*\n  Strict-Transport-Security: max-age=15552000\n  Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), interest-cohort=()\n  X-Frame-Options: DENY\n  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com https://api.niubision.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; base-uri 'self'; object-src 'none'\n/\n  ! Access-Control-Allow-Origin\n"
APP_HEADERS="/*\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self \"https://www.paypal.com\"), usb=(), serial=(), hid=(), bluetooth=(), display-capture=(), interest-cohort=()\n  X-Frame-Options: DENY\n  Cross-Origin-Opener-Policy: same-origin-allow-popups\n  X-Permitted-Cross-Domain-Policies: none\n  Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests\n  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline' https://www.paypal.com https://www.youtube.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://cloudflareinsights.com https://api.niubision.com https://niubision-api.miguel-morales9.workers.dev https://ntfy.sh https://www.paypal.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.paypal.com; media-src 'self' https: blob:; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self' https://www.paypal.com; object-src 'none'\n/\n  ! Access-Control-Allow-Origin\n"
# ---- web (landing) ----
cp -r "$root/web/assets" "$out/web/"
sub "$root/web/index.html" "$out/web/index.html"
[ "${NB_STRIPE:-0}" = 1 ] && sed -i 's/ data-stripe hidden/ data-stripe/g' "$out/web/index.html"
cp "$root/web/404.html" "$out/web/404.html"
cp "$root/web/sw.js" "$out/web/sw.js"   # self-unregistering: retires old app SW on niubision.com
# Pages Functions live outside the static dir (wrangler reads ./functions from the cwd):
#   cd dist/web-project && wrangler pages deploy ../web --project-name niubision-web
mkdir -p "$out/web-project/functions"; sub "$root/web/functions/_middleware.js" "$out/web-project/functions/_middleware.js"
for f in google4d9e616e9d676137.html d5b45a2523994bee80acf6eec24fbe1c.txt; do cp "$root/$f" "$out/web/"; done  # Search Console + IndexNow
if [ "$env" = production ]; then
  printf 'User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n' "$WEB_URL" > "$out/web/robots.txt"
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>%s/</loc><lastmod>%s</lastmod></url></urlset>\n' "$WEB_URL" "$LASTMOD" > "$out/web/sitemap.xml"
  sed -i '/class="preview-note"/d' "$out/web/index.html"   # preview-only banner
else
  printf 'User-agent: *\nDisallow: /\n' > "$out/web/robots.txt"
  printf '/*\n  X-Robots-Tag: noindex, nofollow\n' > "$out/web/_headers"
fi
printf "$WEB_HEADERS" >> "$out/web/_headers"
printf '/sw.js\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n  ! Access-Control-Allow-Origin\n/assets/*\n  Cache-Control: public, max-age=604800\n' >> "$out/web/_headers"

# ---- app (own origin, root scope) ----
cp "$root/app/app.js" "$root/app/styles.css" "$out/app/app/"
for f in favicon.svg logo.png icon-*.png screenshot-phone.png screenshot-wide.png og.jpg intro-poster.jpg intro.mp4 studios.json; do
  [ -e "$root/$f" ] && cp "$root"/$f "$out/app/" 2>/dev/null || true
done
# NB_STRIPE=1 muestra «Tarjeta (Stripe)» en la app (solo cuando el Worker tenga la llave y STRIPE_LIVE_OK, con el OK de Miguel).
stripe_flag=""; [ "${NB_STRIPE:-0}" = "1" ] && stripe_flag=', STRIPE: true'
printf 'window.NB_ENV = { ENV: "%s", WEB_URL: "%s", APP_URL: "%s"%s };\n' "$env" "$WEB_URL" "$APP_URL" "$stripe_flag" > "$out/app/config.js"
python3 - "$root" "$out/app" "$WEB_URL" "$APP_URL" "$ROBOTS" <<'PY'
import sys, re, json
root, out, WEB, APP, ROBOTS = sys.argv[1:]
s = open(f"{root}/index.html", encoding="utf-8").read()
s = s.replace('<script src="/app/app.js', '<script src="/config.js"></script>\n<script src="/app/app.js', 1)
s = s.replace("https://niubision.com/#privacy", APP + "/?view=privacy").replace("https://niubision.com/#terms", APP + "/?view=terms")
s = s.replace("https://niubision.com/manifest.webmanifest", "/manifest.webmanifest")
s = re.sub(r'<link rel="sitemap"[^>]*>\n?', "", s)
s = re.sub(r'https://niubision\.com/(?=[a-z0-9_-]+\.(png|jpg|svg))', APP + "/", s)
s = re.sub(r'<link rel="canonical"[^>]*>', '<link rel="canonical" href="%s/">' % APP, s, count=1)  # app is its own canonical
s = re.sub(r'[ \t]*<link rel="alternate" hreflang="[^"]*"[^>]*>\n?', "", s)  # no hreflang on the app
s = s.replace("https://niubision.com/", WEB + "/")  # JSON-LD ids, og -> marketing site
s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="%s">' % ROBOTS, 1)
s = s.replace('<p><a href="' + APP + '/?view=privacy">', '<p><a href="' + WEB + '/">niubision.com</a> · <a href="' + APP + '/?view=privacy">', 1)
# --- app SEO: own identity (avoid duplicating niubision.com), WebApplication JSON-LD, noindex for param views ---
AT = "NiuBision App · Su plan y la sesión de hoy | Miguel Morales"
AD = "La app de NiuBision: su plan escrito, la sesión de hoy y el contacto con su entrenador, Miguel Morales (DRD, licencia 9798-3322359). Entre con su código de 6 dígitos."
s = re.sub(r'<title>[^<]*</title>', '<title>%s</title>' % AT, s, count=1)
s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % AD, s, count=1)
for k in ("og:title", "twitter:title"):
    s = re.sub(r'<meta (property|name)="%s" content="[^"]*">' % k, lambda m: '<meta %s="%s" content="%s">' % (m.group(1), k, AT), s, count=1)
for k in ("og:description", "twitter:description"):
    s = re.sub(r'<meta (property|name)="%s" content="[^"]*">' % k, lambda m: '<meta %s="%s" content="%s">' % (m.group(1), k, AD), s, count=1)
s = re.sub(r'<meta property="og:url" content="[^"]*">', '<meta property="og:url" content="%s/">' % APP, s, count=1)
app_ld = {"@context": "https://schema.org", "@graph": [
  {"@type": "WebApplication", "@id": APP + "/#app", "name": "NiuBision", "alternateName": "NiuBision App", "url": APP + "/",
   "description": AD, "applicationCategory": "HealthApplication", "applicationSubCategory": "Entrenamiento personal",
   "operatingSystem": "Web, Android, iOS", "browserRequirements": "Requiere JavaScript", "inLanguage": "es-PR",
   "image": APP + "/og.jpg", "screenshot": [APP + "/screenshot-phone.png", APP + "/screenshot-wide.png"],
   "publisher": {"@id": WEB + "/#business"}, "author": {"@id": WEB + "/#miguel"}, "isAccessibleForFree": False,
   "offers": {"@type": "Offer", "price": "43.49", "priceCurrency": "USD", "url": WEB + "/#planes", "name": "Evaluación de 40 minutos (entrada a la app)"}},
  {"@type": ["HealthAndBeautyBusiness", "LocalBusiness"], "@id": WEB + "/#business", "name": "NiuBision", "url": WEB + "/", "sameAs": ["https://www.facebook.com/NiuBision", "https://www.facebook.com/61553061513345", "https://www.instagram.com/niubision/"], "address": {"@type": "PostalAddress", "addressLocality": "Arecibo", "addressRegion": "PR", "addressCountry": "US"}},
  {"@type": "Person", "@id": WEB + "/#miguel", "name": "Miguel Morales", "url": WEB + "/"}]}
s, nld = re.subn(r'<script type="application/ld\+json">.*?</script>', lambda m: '<script type="application/ld+json">' + json.dumps(app_ld, ensure_ascii=False) + '</script>', s, count=1, flags=re.S)
assert nld == 1
# pre-render text (seen before JS / by non-JS crawlers): app-specific, links to the marketing site
s, nh = re.subn(r'<p>Sitio oficial de Miguel Morales[^<]*</p>', '<p>App de clientes de NiuBision: el plan escrito, la sesión de hoy y el contacto con su entrenador, Miguel Morales, certificado por el DRD, licencia 9798-3322359. Planes y precios en <a href="%s/">niubision.com</a>.</p>' % WEB, s, count=1)
assert nh == 1
# any query (?pago, ?c, ?inv, ?view=...) is a private/state URL: noindex, keep canonical root indexable
s, nr = re.subn(r'(<meta name="robots" content="[^"]*">)', lambda m: m.group(1) + '\n<script>if(location.search){document.querySelectorAll(\'meta[name=robots]\').forEach(function(m){m.setAttribute("content","noindex, follow");});}</script>', s, count=1)
assert nr == 1
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
else printf 'User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n' "$APP_URL" > "$out/app/robots.txt"
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>%s/</loc><lastmod>%s</lastmod></url></urlset>\n' "$APP_URL" "$LASTMOD" > "$out/app/sitemap.xml"; fi
printf "$APP_HEADERS" >> "$out/app/_headers"
printf '/sw.js\n  Cache-Control: no-cache\n/config.js\n  Cache-Control: no-cache\n' >> "$out/app/_headers"
python3 "$root/scripts/optimize-app.py" "$out/app"
printf '/app/img/*\n  Cache-Control: public, max-age=31536000, immutable\n' >> "$out/app/_headers"
# assetlinks.json is intentionally NOT copied: see PLAYSTORE.md (template only).
echo "built $env: web=$WEB_URL app=$APP_URL -> $out"
