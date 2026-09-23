#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
for pair in \
  "index.html:public/index.html" \
  "index.html:public/niubision.html" \
  "sw.js:public/sw.js" \
  "app/styles.css:public/app/styles.css" \
  "app/app.js:public/app/app.js"
do
  src="${pair%%:*}"
  dst="${pair##*:}"
  if [ ! -f "$root/$dst" ] || ! cmp -s "$root/$src" "$root/$dst"; then
    echo "DRIFT: $src != $dst (run: npm run sync:html)"
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then exit 1; fi
echo "HTML/SW/app copies are in sync."
