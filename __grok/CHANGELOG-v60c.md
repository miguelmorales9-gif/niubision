# v60c-preview — Pulso cálido re-QA must-fixes

Preview only · branch `eng/ui-surprise-v60` · **NO merge / no niubision.com / logo untouched**

## Must-fix
- **Gente / backup / all file pickers**: every `<input type="file">` goes through `filePickHtml` — native control is sr-only (opacity 0 / clip / pointer-events none + `.hidden`). Spanish triggers only:
  - Gente + studio settings restore → **Elegir archivo JSON**
  - Progress photos → **Elegir foto**
  - Coach routine upload → **Elegir archivo JSON**
- **Cache bump**: unified `v60c-preview` / `nb-offline-v60c-preview` across index.html, sw.js SHELL + CACHE, app.js SW register. No mixed 60-preview / 60b.

## Cache
`v60c-preview` / `nb-offline-v60c-preview`
