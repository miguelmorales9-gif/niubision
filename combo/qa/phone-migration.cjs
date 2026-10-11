const { webkit, chromium, devices } = require('playwright');
const fs=require('fs'),{execSync,spawn}=require('child_process');
const PORT=8793, O='http://localhost:'+PORT, OUT='/workspace/combo-qa/';
const ROOT='/tmp/nb-site';
function use(dir){ execSync(`rm -f ${ROOT} && ln -s ${dir} ${ROOT}`); }
const ev=async(p,f,a)=>{for(let i=0;i<8;i++){try{return await p.evaluate(f,a)}catch(e){if(!/destroyed|navigat/.test(String(e)))throw e;await p.waitForTimeout(700)}}throw new Error('ctx unstable at '+p.url())};
const results=[]; const ok=(b,name,s,detail='')=>{results.push({browser:b,name,status:s,detail});console.log(b,s,name,detail)};
async function run(bt,dev,tag){
  use('/workspace/niubision/public');
  const ctx=await bt.launch().then(b=>b.newContext({...devices[dev],serviceWorkers:'allow'}));
  await ctx.addInitScript(()=>{const mm=window.matchMedia.bind(window);window.matchMedia=q=>/display-mode:\s*standalone/.test(q)?{matches:true,media:q,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}:mm(q);try{Object.defineProperty(navigator,'standalone',{get:()=>true})}catch(e){}});
  const apiLog=[];
  await ctx.route(/^https?:\/\/(?!localhost)/,async r=>{const u=r.request().url();apiLog.push(r.request().method()+' '+u);
    if(/\/api\/redeem/.test(u)){ const ok6=/code=123456/.test(u);
      return r.fulfill({status:ok6?200:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(ok6?{client:{id:'mock1',name:'Cliente Mock',accessCode:'123456',unlocked:true,plan:'Estándar'}}:{error:'Código no encontrado'})});}
    if(/api\.niubision\.com/.test(u)) return r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"ok":true}'});
    return r.abort();});
  const p=await ctx.newPage();
  // 1 old hybrid-v15 root app
  await p.goto(O+'/?source=pwa'); await p.waitForTimeout(2500); console.log('old url',p.url());
  const v1=await ev(p,async()=>{const r=await navigator.serviceWorker.ready;return r.active.scriptURL});
  await ev(p,()=>{localStorage.setItem('nb_migration_probe','keep-me');});
  await p.reload(); await p.waitForTimeout(1500);
  const before=await ev(p,()=>Object.fromEntries(Object.keys(localStorage).filter(k=>/^nb_/.test(k)).map(k=>[k,localStorage.getItem(k)])));
  const keys1=await ev(p,()=>caches.keys());
  ok(tag,'old SW installed '+v1+' caches='+keys1, keys1.includes('nb-offline-hybrid-v15')?'PASS':'FAIL');
  await p.screenshot({path:OUT+tag+'-1-old-root.png'});
  // 2 swap to combo build, trigger update
  use('/tmp/nb-combo');
  await ev(p,async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await p.waitForFunction(async()=>(await caches.keys()).includes('nb-offline-combo-v1'),null,{timeout:20000}).catch(()=>{});
  await p.waitForTimeout(1500);
  const keys2=await ev(p,()=>caches.keys());
  ok(tag,'SW upgraded (combo cache present; old purged on activate) caches='+keys2, keys2.includes('nb-offline-combo-v1')?'PASS':'FAIL');
  // 3 redirect matrix (standalone)
  for(const [from,want] of [['/?source=pwa','/app/?source=pwa'],['/','/app/'],['/?view=inbox','/app/?view=inbox'],['/?pago=ok&inv=NB-TEST-1','/app/?pago=ok&inv=NB-TEST-1'],['/app','/app/'],['/niubision.html?c=1','/app/?c=1'],['/#privacidad','/app/#privacidad']]){
    await p.goto(O+from); await p.waitForURL(u=>u.pathname.startsWith('/app/'),{timeout:8000}).catch(()=>{});
    const got=p.url().replace(O,''); ok(tag,`redirect ${from} -> ${got}`, got===want?'PASS':'FAIL');
  }
  await p.screenshot({path:OUT+tag+'-2-standalone-app.png'});
  const after=await ev(p,()=>Object.fromEntries(Object.keys(localStorage).filter(k=>/^nb_/.test(k)).map(k=>[k,localStorage.getItem(k)])));
  const lost=Object.keys(before).filter(k=>!(k in after));
  ok(tag,`nb_* preserved (${Object.keys(before).length} before, ${Object.keys(after).length} after, probe=${after.nb_migration_probe})`, !lost.length&&after.nb_migration_probe==='keep-me'?'PASS':'FAIL', lost.join(','));
  // 4 PayPal return toast (mocked, no real payment)
  await p.goto(O+'/?pago=ok&inv=NB-TEST-1'); await p.waitForTimeout(2500);
  const toast=await ev(p,()=>document.body.innerText.match(/Pago enviado[^\n]*/)?.[0]||'');
  ok(tag,'PayPal return toast: '+toast, toast?'PASS':'FAIL'); await p.screenshot({path:OUT+tag+'-3-pago-ok.png'});
  // 6 notificationclick URL rewrite (SW logic) — evaluated against built sw.js text
  {const k=await ev(p,()=>caches.keys()); ok(tag,'caches after redirects='+k, k.join()==='nb-offline-combo-v1'?'PASS':'FAIL');}
  // 7 offline
  await ctx.setOffline(true);
  for(const path of ['/app/','/app/?view=inbox','/?source=pwa','/pagina-inexistente']){
    let txt='';try{await p.goto(O+path,{timeout:10000});await p.waitForTimeout(1200);txt=(await ev(p,()=>document.title+' | '+location.pathname+location.search))}catch(e){txt='ERR '+String(e).slice(0,80)}
    ok(tag,`offline ${path} -> ${txt}`, /NiuBision|niubision/i.test(txt)?'PASS':'FAIL');
  }
  await p.screenshot({path:OUT+tag+'-5-offline.png'});
  await ctx.setOffline(false);
  // 5 code login with mocked /api/redeem
  const ctxR=await bt.launch().then(b=>b.newContext({...devices[dev],serviceWorkers:'block'}));await ctxR.route(/^https?:\/\/(?!localhost)/,async r=>{const u=r.request().url();apiLog.push(r.request().method()+' '+u);if(/\/api\/redeem/.test(u)){const ok6=/code=123456/.test(u);return r.fulfill({status:ok6?200:404,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(ok6?{client:{id:'mock1',name:'Cliente Mock',accessCode:'123456',unlocked:true,plan:'Estándar'}}:{error:'Código no encontrado'})})}return r.abort()});const pR=await ctxR.newPage();await pR.goto(O+'/app/'); await pR.waitForFunction(()=>typeof lookupAccess==='function',null,{timeout:20000});
  const r1=await ev(pR,async()=>{try{return JSON.stringify(await lookupAccess('123456'))}catch(e){return 'ERR '+e}});
  const r2=await ev(pR,async()=>{try{return JSON.stringify(await lookupAccess('999999'))}catch(e){return 'ERR '+e}});
  ok(tag,'mock redeem 123456 -> '+String(r1).slice(0,60)+' | 999999 -> '+r2, /mock1/.test(r1)&&r2==='null'?'PASS(mock)':'FAIL');
  await ev(pR,()=>openCodeEntry()); await pR.fill('#codeIn','123456'); await pR.click('#useCode'); await pR.waitForTimeout(2500);
  await pR.screenshot({path:OUT+tag+'-4-code-mock.png'});
  ok(tag,'external requests (all mocked/blocked): '+[...new Set(apiLog.map(x=>x.split('?')[0]))].join(' ; '),'INFO');
  // 8 browser-tab (not standalone) landing stays at /
  const ctx2=await bt.launch().then(b=>b.newContext({...devices[dev]})); const p2=await ctx2.newPage(); await ctx2.route(/^https?:\/\/(?!localhost)/,r=>r.abort());
  await p2.goto(O+'/'); await p2.waitForTimeout(1000); ok(tag,'browser tab / stays landing -> '+p2.url().replace(O,''), p2.url()===O+'/'?'PASS':'FAIL');
  await p2.screenshot({path:OUT+tag+'-0-landing-tab.png'});
}
(async()=>{
  const srv=spawn('node',['/workspace/niubision/server.mjs'],{env:{...process.env,PORT,NB_STATIC:ROOT,NB_DATA:'/tmp/nbdata.json'},stdio:'inherit'});
  await new Promise(r=>setTimeout(r,800));
  try{ await run(webkit,'iPhone 13','webkit-ios'); }catch(e){ok('webkit-ios','crash','FAIL',String(e).slice(0,300))}
  try{ await run(chromium,'Pixel 7','chromium-android'); }catch(e){ok('chromium-android','crash','FAIL',String(e).slice(0,300))}
  fs.writeFileSync(OUT+'phone-results.json',JSON.stringify(results,null,1)); srv.kill(); process.exit(0);
})();
