# Seguridad — niubision.app

## Límite honesto
Una app web **no puede impedir capturas de pantalla** ni grabaciones (ni fotos con otro teléfono). Lo que sigue **disuade** y **identifica** el origen de una filtración.

## 1. Marca de agua por usuario
- `nbGuard()` en `app/app.js`: con sesión de **cliente** (nombre · ID · fecha) o **coach** ("NiuBision · Coach · fecha") se pinta `#nbWm`: mosaico SVG tenue (opacidad .05), `pointer-events: none`, `aria-hidden`.
- No aparece en portada, planes, “sobre”, privacidad ni términos (sin sesión o invitado).
- Se recalcula en cada `render()`; un `MutationObserver` la repone si se borra u oculta desde DevTools (quitarla sigue siendo posible para alguien decidido).

## 2. Disuasivos
- Sin selección de texto, sin menú de clic derecho / pulsación larga, sin arrastrar imágenes en `#app` (los campos siguen editables).
- Al ocultar la app (cambio de pestaña, multitarea, pérdida de foco) el contenido se desenfoca (`:root.nb-hidden`). **Es de mejor esfuerzo**: en iOS/Android la miniatura del multitarea puede capturarse antes y no impide capturas.
- Al imprimir el contenido protegido sale en blanco.

## 3. Endurecimiento (cloud/worker.js — en el PR, **no desplegado**)
| Área | Cambio |
|---|---|
| Sesiones | Vencimiento absoluto (coach 12 h, cliente 8 h) **+ inactividad** (coach 30 min, cliente 2 h). `last` se renueva como máx. 1 escritura/5 min. |
| Coach 2.º factor | TOTP (RFC 6238) si existe el secreto `COACH_TOTP_SECRET`. Login: PIN → luego código de 6 dígitos. Con TOTP activo el **PIN suelto** (`?pin=`, `x-nb-pin`, `/api/studio`) deja de autorizar. |
| Límites | Ya existían `RL_AUTH` por IP + bloqueo 15 min tras 8 fallos; ahora los fallos de TOTP también cuentan. |
| Comparación | PIN y TOTP con comparación de tiempo constante. |
| Cabeceras API | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS, CSP `default-src 'none'; frame-ancestors 'none'`. |
| Cabeceras app (`build-split.sh`) | `X-Frame-Options: DENY`, CSP **aplicada** `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; upgrade-insecure-requests`, Permissions-Policy + `display-capture=()`, serial/hid/bluetooth. La CSP completa sigue en *Report-Only* porque la app usa scripts/estilos en línea. |
| Cookies | La app no usa cookies (token Bearer en `sessionStorage`). |

### Riesgos cerrados (antes pendientes)
- **Token fijo del estudio**: `row.token` ya no autoriza nada. `studioToken` y `/api/studio` devuelven una **sesión de coach** que vence (12 h absoluto, 30 min sin uso). Tras desplegar, el coach entra de nuevo con su PIN una vez.
- **`/api/report`** exige sesión del propio cliente (o coach); conocer un código ya no basta (401). La app vuelve a entrar sola con el código guardado y reintenta una vez.
- **Credenciales en la URL**: `?pin=` y `?token=` se ignoran; el PIN va en `X-Nb-Pin` o en el cuerpo, el token en `Authorization: Bearer`.
- El resumen diario (`/api/admin/daily-summary`) sigue igual: `Authorization: Bearer SUMMARY_TOKEN` o `X-Nb-Pin`.

### Activar TOTP (cuando Miguel apruebe desplegar el worker)
1. Escanear `/home/box/.nfw-secrets/niubision_coach_totp_qr.png` con Google Authenticator / 1Password / Authy.
2. `cd cloud && wrangler secret put COACH_TOTP_SECRET < /home/box/.nfw-secrets/niubision_coach_totp.txt`
3. Desplegar el worker. Sin el secreto, todo funciona como hoy (sólo PIN).

## 4. Android (TWA) — FLAG_SECURE (sólo nota, no construido)
Una TWA (Chrome) **no permite** `FLAG_SECURE`: la ventana la controla Chrome. Opciones:
1. **Envoltorio WebView propio (p. ej. Capacitor)**: en `MainActivity.onCreate` → `getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)`. Bloquea capturas, grabación y miniatura del multitarea en Android. Se pierde parte de la integración de Chrome (Custom Tabs, PWA updates automáticos).
2. **TWA + actividad nativa** con `FLAG_SECURE` sólo para la pantalla del programa (más complejo).
3. **Android 14+** `Activity.registerScreenCaptureCallback`: no bloquea, sólo avisa → podría registrar el evento en el servidor.
- **iOS**: no existe equivalente; sólo detección (`UIScreen.capturedDidChange`, notificación de captura).
- Incluso con FLAG_SECURE se puede fotografiar la pantalla con otro dispositivo — la marca de agua sigue siendo la defensa útil.
