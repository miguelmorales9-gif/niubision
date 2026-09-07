# NiuBision

App de coaching para Puerto Rico.

## App en la web

https://miguelmorales9-gif.github.io/niubision/

Dominio propio (después de apuntar el DNS en Porkbun): https://niubision.com

Esa dirección es la app. Compártala con clientes. No guarda expedientes; solo sirve el programa.

## DNS para niubision.com (Porkbun)

En el panel de Porkbun, quite la página de parking y deje estos registros:

Apex `niubision.com` — tipo A:

- 185.199.108.153
- 185.199.109.153
- 185.199.110.153
- 185.199.111.153

`www.niubision.com` — tipo CNAME → `miguelmorales9-gif.github.io`

Opcional IPv6 (AAAA):

- 2606:50c0:8000::153
- 2606:50c0:8001::153
- 2606:50c0:8002::153
- 2606:50c0:8003::153

## Nube de expedientes

Los cuestionarios, contratos y series viven en el servidor `server.mjs`, no en este repositorio.

En Render, Railway o un VPS:

1. Suba esta carpeta.
2. Arranque: `node server.mjs`
3. Copie la URL https que le den (ejemplo: `https://niubision-cloud.onrender.com`)
4. En la app, modo estudio → Nube NiuBision → pegue esa URL → Conectar estudio.

El cliente, con el código NB2, baja el expediente de ese mismo servidor.

No suba `data.json` a un repo público. Ahí viajan datos de salud.
