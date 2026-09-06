# NiuBision

App de coaching para Puerto Rico.

## App en la web

Cuando GitHub Pages termine de publicar:

https://miguelmorales9-gif.github.io/niubision/

Esa dirección es la app. Compártala con clientes. No guarda expedientes; solo sirve el programa.

## Nube de expedientes

Los cuestionarios, contratos y series viven en el servidor `server.mjs`, no en este repositorio.

En Render, Railway o un VPS:

1. Suba esta carpeta.
2. Arranque: `node server.mjs`
3. Copie la URL https que le den (ejemplo: `https://niubision-cloud.onrender.com`)
4. En la app, modo estudio → Nube NiuBision → pegue esa URL → Conectar estudio.

El cliente, con el código NB2, baja el expediente de ese mismo servidor.

No suba `data.json` a un repo público. Ahí viajan datos de salud.
