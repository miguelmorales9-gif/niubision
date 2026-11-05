import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.NB_URL || 'https://hybrid.niubision-ui-preview.pages.dev';
const outDir = '/workspace/niubision/__grok/live-test';
fs.mkdirSync(outDir, { recursive: true });

const findings = [];
const note = (s) => { console.log(s); findings.push(s); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-PR',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  // Capture console + network failures
  const page = await context.newPage();
  const consoleLogs = [];
  const netFails = [];
  page.on('console', m => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => note('PAGEERROR: ' + e.message));
  page.on('response', r => {
    const u = r.url();
    if (r.status() >= 400 && !/favicon|fonts\.g|googletag/.test(u)) {
      netFails.push(`${r.status()} ${u}`);
    }
  });

  // 1) Splash
  await page.goto(BASE + '/?nocache=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: outDir + '/01-splash.png', fullPage: true });
  note('URL after load: ' + page.url());
  const bodyText = await page.locator('body').innerText().catch(() => '');
  note('Splash/body snippet: ' + bodyText.slice(0, 300).replace(/\n/g, ' | '));

  // Hold logo ring
  const hold = page.locator('#holdLogo');
  if (await hold.count()) {
    const box = await hold.boundingBox();
    if (box) {
      await page.touchscreen.tap(box.x + box.width/2, box.y + box.height/2);
      // long press via mouse
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      await page.mouse.down();
      await page.waitForTimeout(1600);
      await page.mouse.up();
      await page.waitForTimeout(600);
    }
  } else {
    note('FAIL: #holdLogo missing on splash');
  }
  await page.screenshot({ path: outDir + '/02-after-hold.png', fullPage: true });
  const afterHold = await page.locator('body').innerText().catch(() => '');
  note('After hold snippet: ' + afterHold.slice(0, 500).replace(/\n/g, ' | '));

  // Cover checks
  const entrar = page.getByRole('button', { name: /Entrar/i }).or(page.locator('button:has-text("Entrar")'));
  const planes = page.getByRole('button', { name: /Planes/i }).or(page.locator('button:has-text("Planes"), a:has-text("Planes")'));
  const soyCoach = page.locator('text=Soy coach').first();
  note('Cover Entrar visible: ' + (await entrar.count() > 0));
  note('Cover Planes count: ' + await planes.count());
  note('Cover Soy coach: ' + (await soyCoach.count() > 0));
  
  // Check Planes is under Entrar - DOM order
  const coverOrder = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('button, a.btn, .btn, .cover-actions *')]
      .map(el => (el.innerText || el.textContent || '').trim())
      .filter(Boolean);
    return texts.slice(0, 30);
  });
  note('Cover action texts: ' + JSON.stringify(coverOrder));

  // Legal links
  const legal = await page.evaluate(() => {
    return [...document.querySelectorAll('a, button')].map(a => ({
      t: (a.innerText||'').trim(), href: a.getAttribute('href') || '', cls: a.className
    })).filter(x => /acerca|privacidad|términos|terminos|legal|planes/i.test(x.t));
  });
  note('Legal/planes links: ' + JSON.stringify(legal));

  // Check legal readability (contrast / size)
  const legalStyle = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, p, .muted, .cover-legal, footer *')]
      .filter(el => /privacidad|acerca|términos|terminos/i.test(el.innerText||''));
    return els.map(el => {
      const s = getComputedStyle(el);
      return { t: el.innerText.trim().slice(0,40), color: s.color, fontSize: s.fontSize, opacity: s.opacity };
    });
  });
  note('Legal styles: ' + JSON.stringify(legalStyle));

  // Demo entry via ?demo=hoy (fresh context)
  await page.goto(BASE + '/?demo=hoy&nocache=' + Date.now(), { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outDir + '/03-demo-hoy.png', fullPage: true });
  const hoyText = await page.locator('body').innerText().catch(() => '');
  note('Demo Hoy snippet: ' + hoyText.slice(0, 800).replace(/\n/g, ' | '));
  note('Demo Hoy length chars: ' + hoyText.length);

  // Measure welcome + session stack bulk
  const hoyMetrics = await page.evaluate(() => {
    const welcome = document.querySelector('.welcome-dayone, .assign-notice, .hoy-welcome');
    const session = document.querySelector('.session-start, .client-hoy-v62, .hoy-hero');
    const app = document.querySelector('#app');
    const rect = (el) => el ? { h: el.getBoundingClientRect().height, t: (el.innerText||'').slice(0,120) } : null;
    return {
      vh: window.innerHeight,
      welcome: rect(welcome),
      session: rect(session),
      appH: app ? app.scrollHeight : null,
      nav: [...document.querySelectorAll('nav button, .tabbar button, [data-view]')].map(b => (b.innerText||b.getAttribute('data-view')||'').trim())
    };
  });
  note('Hoy metrics: ' + JSON.stringify(hoyMetrics));

  // Empezar
  const empezar = page.locator('button:has-text("Empezar"), button:has-text("Abrir sesión"), [data-action="start"]').first();
  if (await empezar.count()) {
    await empezar.click({ force: true }).catch(e => note('Empezar click err: ' + e.message));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: outDir + '/04-session.png', fullPage: true });
    note('After Empezar: ' + (await page.locator('body').innerText()).slice(0, 500).replace(/\n/g, ' | '));
  } else {
    note('FAIL/NOTE: Empezar button not found');
  }

  // Navigate tabs
  async function tapTab(label) {
    const t = page.locator(`nav button:has-text("${label}"), .tabbar button:has-text("${label}"), button:has-text("${label}")`).first();
    if (await t.count()) {
      await t.click({ force: true });
      await page.waitForTimeout(700);
      return true;
    }
    return false;
  }

  // Back to hoy if in session
  await page.goto(BASE + '/?demo=hoy', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  for (const tab of ['Programas', 'Semana', 'Log', 'Más', 'Hoy']) {
    const ok = await tapTab(tab);
    note(`Tab ${tab}: ${ok ? 'found' : 'MISSING'}`);
    if (ok) {
      await page.screenshot({ path: `${outDir}/tab-${tab}.png`, fullPage: true });
      const txt = await page.locator('body').innerText();
      note(`Tab ${tab} snippet: ` + txt.slice(0, 600).replace(/\n/g, ' | '));
      // English leak rough
      const eng = await page.evaluate(() => {
        const t = document.body.innerText;
        const suspects = [];
        const re = /\b(Start|Save|Cancel|Delete|Edit|Submit|Loading|Settings|Home|Week|Programs|Clients|Inbox|Approve|Assign|Request|Empty|Nothing here|Coming soon|Error|Success|Continue|Next|Back|Done|Close|Open|Log|More)\b/g;
        let m; while ((m = re.exec(t))) suspects.push(m[0]);
        return [...new Set(suspects)];
      });
      if (eng.length) note(`Tab ${tab} EN leaks?: ` + eng.join(', '));
      // overflow
      const overflow = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('*').forEach(el => {
          const s = getComputedStyle(el);
          if (s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 8 && el.clientWidth > 0) {
            if (el.scrollWidth > window.innerWidth + 4) bad.push({tag: el.tagName, cls: el.className?.toString?.().slice(0,60), sw: el.scrollWidth, cw: el.clientWidth});
          }
        });
        return bad.slice(0, 8);
      });
      if (overflow.length) note(`Tab ${tab} overflow: ` + JSON.stringify(overflow));
    }
  }

  // Programas deep
  await tapTab('Programas');
  await page.waitForTimeout(500);
  const prog = await page.evaluate(() => {
    const active = document.querySelector('.prog-hero-active, .prog-active');
    const gate = document.querySelector('.prog-catalog-gate');
    const tipo = document.querySelector('select.prog-kind-select, select#progKind, select[name="tipo"]');
    const pedir = [...document.querySelectorAll('button')].filter(b => /Pedir/i.test(b.innerText));
    const plantillasOpen = !gate || getComputedStyle(gate).display === 'none' || !document.body.contains(gate);
    return {
      activeText: active ? active.innerText.slice(0,200) : null,
      gateText: gate ? gate.innerText.slice(0,200) : null,
      tipoOptions: tipo ? [...tipo.options].map(o => o.text) : null,
      pedirCount: pedir.length,
      plantillasVisible: !gate
    };
  });
  note('Programas deep: ' + JSON.stringify(prog));

  // Open catalog if gated
  const openCat = page.locator('.prog-catalog-gate button, button:has-text("Ver plantillas"), button:has-text("Explorar")').first();
  if (await openCat.count()) {
    await openCat.click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: outDir + '/programas-catalog.png', fullPage: true });
    note('Catalog after open: ' + (await page.locator('body').innerText()).slice(0,500).replace(/\n/g, ' | '));
  }

  // Pedir flow
  const pedirBtn = page.locator('button:has-text("Pedir")').first();
  if (await pedirBtn.count()) {
    await pedirBtn.click({ force: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: outDir + '/pedir.png', fullPage: true });
    note('Pedir sheet: ' + (await page.locator('body').innerText()).slice(0,500).replace(/\n/g, ' | '));
    // close modal if any
    const close = page.locator('#closeSheet, button:has-text("Cancelar"), button:has-text("Cerrar")').first();
    if (await close.count()) await close.click({ force: true }).catch(()=>{});
  }

  // Planes from cover - go guest
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch(e){} });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  // skip splash if needed
  const hold2 = page.locator('#holdLogo');
  if (await hold2.count()) {
    const box = await hold2.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
      await page.mouse.down(); await page.waitForTimeout(1600); await page.mouse.up();
      await page.waitForTimeout(500);
    }
  }
  const planesBtn = page.locator('button:has-text("Planes"), a:has-text("Planes")').first();
  if (await planesBtn.count()) {
    await planesBtn.click({ force: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: outDir + '/planes.png', fullPage: true });
    note('Planes: ' + (await page.locator('body').innerText()).slice(0,700).replace(/\n/g, ' | '));
  } else note('FAIL: Planes button missing on cover');

  // Privacy link
  const priv = page.locator('a:has-text("Privacidad"), button:has-text("Privacidad")').first();
  if (await priv.count()) {
    await priv.click({ force: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: outDir + '/privacy.png', fullPage: true });
    note('Privacy: ' + (await page.locator('body').innerText()).slice(0,400).replace(/\n/g, ' | '));
  }

  // SW cache version
  await page.goto(BASE + '/?demo=hoy', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const swInfo = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const cachesNames = await caches.keys();
    let swUrl = regs.map(r => r.active && r.active.scriptURL);
    return { swUrl, cachesNames };
  });
  note('SW/caches: ' + JSON.stringify(swInfo));

  // Network 404s
  const uniqNet = [...new Set(netFails)].slice(0, 40);
  note('Net fails (' + uniqNet.length + '): ' + uniqNet.join(' || '));
  note('Console errors: ' + consoleLogs.filter(l => l.startsWith('[error]')).slice(0,20).join(' || '));

  fs.writeFileSync(outDir + '/findings.json', JSON.stringify(findings, null, 2));
  await browser.close();
  console.log('DONE', findings.length);
})().catch(e => { console.error(e); process.exit(1); });
