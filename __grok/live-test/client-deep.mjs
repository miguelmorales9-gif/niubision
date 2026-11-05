import { chromium } from 'playwright';
const BASE = 'https://hybrid.niubision-ui-preview.pages.dev';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, locale:'es-PR' });
const page = await ctx.newPage();
const fails=[];
page.on('response', r => { if (r.status()>=400 && /api\.|workers\.dev/.test(r.url())) fails.push(r.status()+' '+r.url().split('?')[0]); });

await page.goto(BASE+'/?demo=hoy&x='+Date.now(), { waitUntil:'networkidle' });
await page.waitForTimeout(1000);

// Force welcome banner to measure bulk
await page.evaluate(() => localStorage.setItem('nb_welcome_v43', '0'));
await page.reload({ waitUntil:'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path:'hoy-with-welcome.png', fullPage:true });
const bulk = await page.evaluate(() => {
  const app = document.querySelector('#app');
  const welcome = document.querySelector('#welcomeDayone');
  const hero = document.querySelector('.hoy-hero');
  const prio = document.querySelector('.prioridad');
  const late = [...document.querySelectorAll('li.late, .prioridad li')].map(li => li.innerText);
  return {
    appH: app?.scrollHeight, vh: innerHeight,
    welcomeH: welcome?.getBoundingClientRect().height,
    heroH: hero?.getBoundingClientRect().height,
    late, prioText: prio?.innerText?.slice(0,200),
    bodyTop: document.body.innerText.slice(0,500)
  };
});
console.log('BULK', JSON.stringify(bulk,null,2));

// Programas catalog
await page.click('button:has-text("PROGRAMAS")');
await page.waitForTimeout(500);
await page.click('#progOpenCatalog');
await page.waitForTimeout(600);
const cat = await page.evaluate(() => ({
  gate: !!document.querySelector('.prog-catalog-gate'),
  cards: document.querySelectorAll('.prog-card, [data-prog-pedir], [data-rid]').length,
  shelves: [...document.querySelectorAll('.prog-shelf-label')].map(e=>e.innerText),
  firstCard: document.querySelector('.prog-card, .list-row, [data-prog-pedir]')?.innerText?.slice(0,150)
}));
console.log('CATALOG', JSON.stringify(cat,null,2));
await page.screenshot({ path:'catalog3.png', fullPage:true });

// Pedir otro
const ask = page.locator('#progAskOther, button:has-text("Pedir otro")').first();
if (await ask.count()) {
  await ask.click();
  await page.waitForTimeout(700);
  console.log('PEDIR MODAL', await page.locator('.modal .sheet').innerText().catch(()=> 'NO SHEET'));
  await page.screenshot({ path:'pedir3.png', fullPage:true });
  await page.locator('#closeSheet, button:has-text("Cerrar"), button:has-text("Cancelar")').first().click().catch(()=>{});
}

// Card Pedir
const cardPedir = page.locator('[data-prog-pedir], button:has-text("Pedir")').nth(1);
if (await cardPedir.count()) {
  await cardPedir.click({ force:true });
  await page.waitForTimeout(700);
  console.log('CARD PEDIR', (await page.locator('.modal').innerText().catch(()=>'none')).slice(0,400));
  await page.screenshot({ path:'pedir-card.png', fullPage:true });
}

// YO / PLAN
for (const t of ['YO','PLAN']) {
  await page.click(`button:has-text("${t}")`);
  await page.waitForTimeout(500);
  const txt = await page.innerText('body');
  console.log('\n=== '+t+' ===\n'+txt.slice(0,900));
  await page.screenshot({ path:'deep-'+t+'.png', fullPage:true });
  // english
  const eng = txt.match(/\b(Start|Save|Cancel|Delete|Edit|Settings|Loading|Error|Continue|Next|Back|Done|Close|Open|Empty|Nothing|Coming soon|Submit|Assign|Approve|Request|Week|Log|More|Home)\b/g);
  console.log('EN', eng);
}

// Soy coach gate UI (no PIN attempt to avoid 429)
await page.evaluate(()=>{ localStorage.clear(); sessionStorage.clear(); });
await page.goto(BASE+'/?g='+Date.now(), { waitUntil:'networkidle' });
if (await page.locator('#holdLogo').count()) {
  await page.locator('#holdLogo').dispatchEvent('pointerdown');
  await page.waitForFunction(()=>!document.getElementById('holdLogo'), {timeout:15000});
}
await page.waitForTimeout(400);
await page.click('#studioLock');
await page.waitForTimeout(400);
console.log('COACH GATE', await page.locator('.modal .sheet').innerText().catch(()=>'fail'));
await page.screenshot({ path:'coach-gate.png', fullPage:true });
await page.click('#closeSheet');

console.log('API fails', [...new Set(fails)]);
await browser.close();
