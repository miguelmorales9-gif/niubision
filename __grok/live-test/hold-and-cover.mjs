import { chromium } from 'playwright';
import fs from 'fs';
const BASE = 'https://hybrid.niubision-ui-preview.pages.dev';
const out = [];
const note = s => { console.log(s); out.push(s); };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-PR'
});
const page = await context.newPage();
page.on('console', m => { if (m.type()==='error') note('ERR '+m.text()); });

await page.goto(BASE + '/?bust=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Inspect hold binding
const holdInfo = await page.evaluate(() => {
  const el = document.getElementById('holdLogo');
  if (!el) return { missing: true };
  const s = getComputedStyle(el);
  return {
    tag: el.tagName, cls: el.className,
    html: el.outerHTML.slice(0,300),
    pointerEvents: s.pointerEvents,
    touchAction: s.touchAction,
    userSelect: s.userSelect,
    hasRing: !!el.querySelector('.hold-ring, .splash-ring, svg, canvas, .ring')
  };
});
note('holdInfo '+JSON.stringify(holdInfo));

// Try pointerdown/up with duration via dispatch
await page.evaluate(() => new Promise(resolve => {
  const el = document.getElementById('holdLogo');
  if (!el) return resolve();
  const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  setTimeout(() => {
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    resolve();
  }, 1800);
}));
await page.waitForTimeout(800);
await page.screenshot({ path: 'hold-pointer.png', fullPage: true });
note('after pointer hold: ' + (await page.innerText('body')).slice(0,400).replace(/\n/g,' | '));

// If still splash, try touchstart/touchend
const stillSplash = await page.locator('#holdLogo').count();
if (stillSplash) {
  await page.evaluate(() => new Promise(resolve => {
    const el = document.getElementById('holdLogo');
    const touch = new Touch({ identifier: 1, target: el, clientX: 200, clientY: 300, pageX: 200, pageY: 300 });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
    setTimeout(() => {
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
      resolve();
    }, 1800);
  }));
  await page.waitForTimeout(800);
  note('after touch hold: ' + (await page.innerText('body')).slice(0,400).replace(/\n/g,' | '));
  await page.screenshot({ path: 'hold-touch.png', fullPage: true });
}

// Force cover by setting localStorage like app does
await page.evaluate(() => {
  localStorage.setItem('nb_seen_intro', '1');
  localStorage.setItem('nb_seen_cover', '0');
});
// Call internal if exposed - instead navigate and set state via evaluate after load
await page.goto(BASE + '/?bust2=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
// Inject skip splash
await page.evaluate(() => {
  try {
    // App uses store - try common keys
    const keys = Object.keys(localStorage);
    return keys.filter(k => /nb_|splash|cover|intro/i.test(k));
  } catch(e) { return []; }
}).then(k => note('ls keys '+JSON.stringify(k)));

// Read splash code path from page - check if hold listeners attached
const listeners = await page.evaluate(() => {
  const el = document.getElementById('holdLogo');
  if (!el) return null;
  // check progress CSS var
  return {
    style: el.getAttribute('style'),
    children: [...el.children].map(c => c.className + ':' + c.tagName)
  };
});
note('listeners '+JSON.stringify(listeners));

// Long press via locator
if (await page.locator('#holdLogo').count()) {
  await page.locator('#holdLogo').dispatchEvent('pointerdown');
  // poll ring progress
  for (let i=0;i<20;i++) {
    await page.waitForTimeout(100);
    const prog = await page.evaluate(() => {
      const el = document.getElementById('holdLogo');
      const ring = el && (el.querySelector('[style*="--p"], .hold-progress, .splash-hold-ring'));
      return {
        cls: el && el.className,
        html: el && el.innerHTML.slice(0,200),
        cssVar: el && getComputedStyle(el).getPropertyValue('--hold'),
        bodyCls: document.body.className
      };
    });
    if (i===0 || i===10 || i===19) note('prog '+i+' '+JSON.stringify(prog));
  }
  await page.locator('#holdLogo').dispatchEvent('pointerup');
  await page.waitForTimeout(500);
  note('final after locator hold: ' + (await page.innerText('body')).slice(0,500).replace(/\n/g,' | '));
}

await browser.close();
fs.writeFileSync('hold-findings.json', JSON.stringify(out, null, 2));
