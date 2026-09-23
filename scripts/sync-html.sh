#!/usr/bin/env bash
# Canonical app shell is ./index.html (+ ./sw.js). public/ copies are deploy mirrors.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cp -f "$root/index.html" "$root/public/index.html"
cp -f "$root/index.html" "$root/public/niubision.html"
cp -f "$root/sw.js" "$root/public/sw.js"
echo "Synced index.html and sw.js -> public/"
