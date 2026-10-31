#!/usr/bin/env bash
# Salida en vivo de NFW + niubision.app + niubision.com. Por defecto es ENSAYO (solo imprime).
# Ejecutar de verdad SOLO con el OK explícito de Miguel:
#   GO_LIVE_OK=SI NFW_ORIGIN=https://<dominio-nfw> RUN=1 bash go-live.sh [paso]
# Pasos: preflight | merge | stripe | secrets | deploy | smoke | all.  Nunca imprime secretos.
set -euo pipefail
S=/home/box/.nfw-secrets; NFW=/workspace/nfw; NB=/workspace/niubision; HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="${RUN:-0}"; STEP="${1:-all}"
say(){ printf '\n\033[1m== %s\033[0m\n' "$*"; }
do_(){ if [ "$RUN" = 1 ]; then echo "+ $*"; eval "$@"; else echo "[ensayo] $*"; fi; }
need(){ [ "${GO_LIVE_OK:-}" = SI ] || { echo "Falta GO_LIVE_OK=SI (OK de Miguel)"; exit 1; }; [ -n "${NFW_ORIGIN:-}" ] || { echo "Falta NFW_ORIGIN"; exit 1; }; }
secret(){ # secret NOMBRE archivo-o-valor toml-dir [config]
  local name=$1 src=$2 dir=$3 cfg=${4:-wrangler.toml}
  if [ -f "$src" ]; then do_ "(cd $dir && tr -d '\\n' < '$src' | npx wrangler secret put $name -c $cfg >/dev/null)"; else do_ "(cd $dir && printf '%s' '$src' | npx wrangler secret put $name -c $cfg >/dev/null)"; fi; }
[ "$RUN" = 1 ] && need

preflight(){ say "1. Comprobaciones"
  do_ "(cd $NFW && npm test 2>&1 | grep -E '^# (pass|fail)')"
  do_ "(cd $NB && node --test test/*.mjs 2>&1 | grep -E '^# (pass|fail)')"
  do_ "cmp $NB/app/app.js $NB/public/app/app.js"
  do_ "test -s $S/stripe_live_rk.txt && grep -qE '^(rk|sk)_live_' $S/stripe_live_rk.txt"
  do_ "(cd $NB/cloud && npx wrangler d1 export niubision-db --remote --output /home/box/niubision-backups/pre-golive-\$(date +%Y%m%d-%H%M).sql)"
  do_ "(cd $NFW/api && npx wrangler d1 export nfw-db --remote --output /home/box/niubision-backups/nfw-pre-golive-\$(date +%Y%m%d-%H%M).sql)"; }

merge(){ say "2. Fusionar: un PR de lanzamiento por repo (rama superior de la pila → main, merge normal)"
  do_ "gh pr create -R miguelmorales9-gif/niubision-fitness-workouts --base main --head v3-premium --title 'Lanzamiento NFW' --body 'Incluye PR #2–#7 y v3-premium.' || true"
  do_ "gh pr merge v3-premium -R miguelmorales9-gif/niubision-fitness-workouts --merge"
  do_ "gh pr create -R miguelmorales9-gif/niubision --base main --head premium-final --title 'Lanzamiento NiuBision' --body 'Incluye PR #55, #56 y premium-final.' || true"
  do_ "gh pr merge premium-final -R miguelmorales9-gif/niubision --merge"
  do_ "(cd $NFW && git checkout main && git pull -q) && (cd $NB && git checkout main && git pull -q)"; }

stripe(){ say "3. Objetos Stripe live (idempotente) + webhooks"
  do_ "MODE=live GO_LIVE_OK=SI NFW_ORIGIN=$NFW_ORIGIN node $HERE/stripe-setup.mjs"; }

secrets(){ say "4. Secretos y variables de producción"
  # NFW (Worker nfw-api)
  secret STRIPE_SECRET_KEY $S/stripe_live_rk.txt $NFW/api
  secret STRIPE_WEBHOOK_SECRET $S/stripe_whsec_nfw_live.txt $NFW/api
  secret STRIPE_LIVE_OK 1 $NFW/api
  for k in STRIPE_PRICE_PREMIUM_MONTHLY STRIPE_PRICE_PREMIUM_YEARLY STRIPE_PRICE_COACHING_MONTHLY STRIPE_FOUNDER_COUPON STRIPE_COACH_FOUNDER_COUPON STRIPE_PORTAL_CONFIG; do
    do_ "(cd $NFW/api && node -e 'process.stdout.write(require(\"$S/stripe_nfw_live_ids.json\").$k)' | npx wrangler secret put $k >/dev/null)"; done
  echo "   NFW wrangler.toml (editar y commitear): APP_ORIGIN=$NFW_ORIGIN, ALLOWED_ORIGINS=$NFW_ORIGIN, DEV_MAGIC_LINK=\"0\", DEMO_LOGIN=\"0\", MAIL_FROM=<remitente verificado en Resend> + secreto RESEND_API_KEY"
  # niubision (Worker niubision-api)
  secret STRIPE_SECRET_KEY $S/stripe_live_rk.txt $NB/cloud
  secret STRIPE_WEBHOOK_SECRET $S/stripe_whsec_niubision_live.txt $NB/cloud
  secret STRIPE_LIVE_OK 1 $NB/cloud; }

deploy(){ say "5. Despliegue (Workers primero, luego Pages)"
  do_ "(cd $NFW/api && npx wrangler deploy)"
  do_ "(cd $NB/cloud && npx wrangler deploy)"
  do_ "rm -rf /tmp/nfw-prod && cp -r $NFW/web /tmp/nfw-prod && sed -i '/class=\"nfw-preview\"/d' /tmp/nfw-prod/index.html"
  do_ "(cd $NFW && npx wrangler pages deploy /tmp/nfw-prod --project-name nfw-preview --branch main --commit-dirty=true)"
  do_ "(cd $NB && NB_ENV=production NB_STRIPE=1 bash scripts/build-split.sh)"
  do_ "(cd $NFW && npx wrangler pages deploy $NB/dist/app --project-name niubision-app --branch main --commit-dirty=true)"
  do_ "(cd $NFW && rm -rf .nbweb && mkdir .nbweb && cp -r $NB/dist/web .nbweb/site && npx wrangler pages functions build $NB/dist/web-project/functions --outdir .nbweb/site/_worker.js && npx wrangler pages deploy .nbweb/site --project-name niubision-web --branch main --commit-dirty=true; rm -rf .nbweb)"; }

smoke(){ say "6. Humo (sin cobrar)"
  do_ "curl -s https://nfw-api.miguel-morales9.workers.dev/api/health | grep -q '\"billing\":\"live\"' && echo NFW live OK"
  do_ "curl -s https://niubision-api.miguel-morales9.workers.dev/api/stripe/config | grep -q live && echo NiuBision live OK"
  do_ "curl -s https://niubision.com/ | grep -c 'IVU incluido'"
  do_ "curl -s https://niubision.app/ | grep -o 'STRIPE: true'"
  do_ "curl -s -o /dev/null -w '%{http_code}\\n' -X POST https://nfw-api.miguel-morales9.workers.dev/api/stripe/webhook -H 'stripe-signature: t=1,v1=00' -d '{}'   # espera 400"
  echo "   Manual (Miguel, 2 min): 1 compra real de la Evaluación 43.49 en niubision.app con su tarjeta → código + recibo con base 39.00 + IVU 4.49; reembolso desde el Dashboard."
  echo "   Manual: NFW Premium mensual 11.14 con su tarjeta → portal → cancelar → reembolso."; }

rollback(){ say "Volver atrás"
  echo "   Pages: Dashboard → proyecto → Deployments → 'Rollback' al anterior (o wrangler pages deployment list)."
  echo "   Workers: npx wrangler rollback (en api/ y cloud/)."
  echo "   Stripe: borrar STRIPE_LIVE_OK (npx wrangler secret delete STRIPE_LIVE_OK) → el pago con tarjeta queda inerte al instante; PayPal/ATH siguen."; }

case "$STEP" in
  all) preflight; merge; stripe; secrets; deploy; smoke; rollback;;
  preflight|merge|stripe|secrets|deploy|smoke|rollback) "$STEP";;
  *) echo "paso desconocido"; exit 1;;
esac
