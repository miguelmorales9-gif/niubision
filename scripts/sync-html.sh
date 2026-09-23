#!/usr/bin/env bash
# Canonical app shell is ./index.html (+ ./sw.js + ./app/). public/ copies are deploy mirrors.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cp -f "$root/index.html" "$root/public/index.html"
cp -f "$root/index.html" "$root/public/niubision.html"
cp -f "$root/sw.js" "$root/public/sw.js"
mkdir -p "$root/public/app"
cp -f "$root/app/styles.css" "$root/public/app/styles.css"
cp -f "$root/app/app.js" "$root/public/app/app.js"
if [ -f "$root/app/index.html" ]; then cp -f "$root/app/index.html" "$root/public/app/index.html"; fi
echo "Synced index.html, sw.js, and app/ -> public/"
