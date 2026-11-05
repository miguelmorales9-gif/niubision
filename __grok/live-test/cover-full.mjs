import { chromium } from 'playwright';
const BASE = 'https://hybrid.niubision-ui-preview.pages.dev';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-PR' });
await context.addInitScript(() => {
  // Skip intro video hang for faster QA - stub HTMLVideoElement.play
});
const page = await context.newPage();
const net = [];
page.on('response', r => { if (r.status()>=400) net.push(r.status()+' '+r.url()); });

await page.goto(BASE + '/?fresh=' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#holdLogo', { timeout: 15000 });

// Hold until ring 100 then wait for intro timeout (7s) + buffer
await page.locator('#holdLogo').dispatchEvent('pointerdown');
await page.waitForFunction(() => {
  const el = document.getElementById('holdLogo');
  return el && parseFloat(getComputedStyle(el).getPropertyValue('--hold')||'0') >= 100;
}, { timeout: 8000 });
console.log('ring full at', Date.now());
// Do NOT pointerup required - go() already fired
await page.waitForFunction(() => !document.getElementById('holdLogo'), { timeout: 12000 }).catch(()=>{});
await page.waitForTimeout(500);
let text = await page.innerText('body');
console.log('AFTER INTRO:', text.slice(0,600).replace(/\n/g,' | '));
await page.screenshot({ path: 'cover.png', fullPage: true });

// Cover structure
const cover = await page.evaluate(() => {
  const order = [...document.querySelectorAll('.cover-actions-row button, .cover-actions-row a, .actions button')].map(b => b.innerText.trim());
  const quiet = [...document.querySelectorAll('.cover-quiet button, .quiet-links button')].map(b => {
    const s = getComputedStyle(b);
    return { t: b.innerText.trim(), color: s.color, fontSize: s.fontSize, opacity: s.opacity };
  });
  const disclaimer = (document.querySelector('.disclaimer')||{}).innerText||'';
  return { order, quiet, disclaimer: disclaimer.slice(0,120), hasEntrar: !!document.getElementById('haveCode'), hasPlanes: !!document.getElementById('seePlans'), hasCoach: !!document.getElementById('studioLock') };
});
console.log('COVER', JSON.stringify(cover, null, 2));

// Planes
if (await page.locator('#seePlans').count()) {
  await page.click('#seePlans');
  await page.waitForTimeout(600);
  console.log('PLANES', (await page.innerText('body')).slice(0,700).replace(/\n/g,' | '));
  await page.screenshot({ path: 'planes2.png', fullPage: true });
  // back - look for exit
  const back = page.locator('button:has-text("Salir"), button:has-text("Volver"), #switchRole').first();
  if (await back.count()) await back.click();
  else {
    await page.evaluate(() => { localStorage.removeItem('nb_role'); });
    await page.goto(BASE + '/?demo=skip');
  }
}

// Re-get cover via clearing role after intro seen
await page.evaluate(() => {
  localStorage.setItem('nb_seen_intro','true');
  localStorage.setItem('nb_seen_cover','true');
  localStorage.removeItem('nb_role');
  // force reload state
});
await page.goto(BASE + '/?cover=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
// If splash again, hold quick
if (await page.locator('#holdLogo').count()) {
  await page.locator('#holdLogo').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !document.getElementById('holdLogo'), { timeout: 15000 });
}
await page.waitForTimeout(500);
console.log('COVER2', (await page.innerText('body')).slice(0,500).replace(/\n/g,' | '));

// Privacy
if (await page.locator('#seePrivacy').count()) {
  await page.click('#seePrivacy');
  await page.waitForTimeout(500);
  console.log('PRIV', (await page.innerText('body')).slice(0,400).replace(/\n/g,' | '));
  await page.screenshot({ path: 'priv2.png', fullPage: true });
}

// Entrar with 240101
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(BASE + '/?c=' + Date.now(), { waitUntil: 'networkidle' });
if (await page.locator('#holdLogo').count()) {
  await page.locator('#holdLogo').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !document.getElementById('holdLogo'), { timeout: 15000 });
}
await page.waitForTimeout(400);
if (await page.locator('#haveCode').count()) {
  await page.click('#haveCode');
  await page.waitForTimeout(400);
  console.log('CODE SHEET', (await page.innerText('body')).slice(0,400).replace(/\n/g,' | '));
  const input = page.locator('#codeIn, input[inputmode="numeric"], .sheet input.field').first();
  await input.fill('240101');
  const go = page.locator('button:has-text("Entrar"), #codeGo, .sheet .btn.primary').first();
  await go.click();
  await page.waitForTimeout(1200);
  console.log('AFTER CODE', (await page.innerText('body')).slice(0,600).replace(/\n/g,' | '));
  await page.screenshot({ path: 'after-code.png', fullPage: true });
}

// YO and PLAN tabs from demo
await page.goto(BASE + '/?demo=hoy&t=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
for (const tab of ['YO', 'PLAN', 'PROGRAMAS']) {
  const b = page.locator(`button:has-text("${tab}")`).first();
  if (await b.count()) {
    await b.click({ force: true });
    await page.waitForTimeout(600);
    const t = await page.innerText('body');
    console.log('TAB '+tab+':', t.slice(0,700).replace(/\n/g,' | '));
    await page.screenshot({ path: 'tab-'+tab+'.png', fullPage: true });
    // dead buttons: click each primary action and see
    const dead = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a.btn')].filter(b => b.offsetParent !== null);
      return btns.map(b => b.innerText.trim().slice(0,40)).filter(Boolean).slice(0,25);
    });
    console.log('BTNS '+tab, JSON.stringify(dead));
  }
}

// Programas: open catalog properly + Pedir flow
await page.locator('button:has-text("PROGRAMAS")').click({ force: true });
await page.waitForTimeout(400);
const ver = page.locator('button:has-text("Ver plantillas")').first();
if (await ver.count()) {
  await ver.click();
  await page.waitForTimeout(700);
  console.log('CATALOG OPEN', (await page.innerText('body')).slice(0,800).replace(/\n/g,' | '));
  await page.screenshot({ path: 'catalog-open.png', fullPage: true });
  // check cards
  const cards = await page.evaluate(() => ({
    cards: document.querySelectorAll('.prog-card, .routine-card, [data-rid]').length,
    gateStill: !!document.querySelector('.prog-catalog-gate'),
    tipo: document.querySelector('select.prog-kind-select') && document.querySelector('select.prog-kind-select').value
  }));
  console.log('CATALOG META', JSON.stringify(cards));
}
const pedir = page.locator('button:has-text("Pedir")').first();
if (await pedir.count()) {
  await pedir.click();
  await page.waitForTimeout(800);
  console.log('PEDIR', (await page.innerText('body')).slice(0,800).replace(/\n/g,' | '));
  await page.screenshot({ path: 'pedir2.png', fullPage: true });
  const modal = await page.locator('.modal, .sheet').count();
  console.log('modal count', modal);
}

console.log('NET', [...new Set(net)].slice(0,30));
await browser.close();
