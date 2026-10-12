// Cloudflare Pages Function (web project): 301 old app URLs on the marketing
// domain to the app origin, preserving path + query. __APP_URL__ is set by build-split.sh.
const APP = "__APP_URL__";
const APP_PARAMS = ["view", "pago", "c", "code", "inv"];
const APP_PATHS = /^\/(app(\/.*)?|niubision\.html|index\.html|manifest\.webmanifest|config\.js|studios\.json)$/;
export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  // Search Console needs the exact .html URL with 200 (Pages would 308 it to the extensionless path).
  if (url.pathname === "/google4d9e616e9d676137.html") {
    return new Response("google-site-verification: google4d9e616e9d676137.html", { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const q = url.searchParams;
  const appQuery = APP_PARAMS.some((k) => q.has(k)) || q.get("source") === "pwa";
  if (appQuery || APP_PATHS.test(url.pathname)) {
    let path = url.pathname;
    if (path === "/app" || path === "/app/" || path === "/niubision.html" || path === "/index.html") path = "/";
    return Response.redirect(APP + path + url.search, 301);
  }
  return ctx.next();
}
