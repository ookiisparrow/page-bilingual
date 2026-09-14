import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire('/usr/local/lib/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');

const OUT = process.env.PBT_VG_OUT || '/workspace/page-bilingual-shots/smoke-wiki';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const site = { id: 'wiki', type: 'longform', url: 'https://en.wikipedia.org/wiki/Goal_setting' };

async function waitFab(page) {
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => !!document.getElementById('pbt-root'))) return true;
    await sleep(300);
  }
  return false;
}

async function clickOrb(page, which) {
  return page.evaluate((which) => {
    const root = document.getElementById('pbt-root');
    const sr = root?.shadowRoot;
    if (!sr) return false;
    const el = sr.getElementById(which === 'mode' ? 'modeBtn' : 'orb');
    if (!el || el.style.display === 'none') return false;
    el.click();
    return true;
  }, which);
}

async function stats(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-pbt-state]')];
    const count = (s) => all.filter((e) => e.dataset.pbtState === s).length;
    const ellipsis = [...document.querySelectorAll('p,li,h1,h2,h3')].filter((p) => {
      const t = (p.textContent || '').trim();
      return t === '…' || t === '...';
    }).length;
    const hosts = [...document.querySelectorAll('.pbt-host[data-pbt-state="ok"]')];
    let nextOk = 0;
    for (const h of hosts) {
      const n = h.nextElementSibling;
      if (n && n.classList?.contains('pbt-tr')) nextOk += 1;
    }
    return {
      ok: count('ok'),
      fail: count('fail'),
      skip: count('skip'),
      queued: count('queued'),
      tr: document.querySelectorAll('.pbt-tr').length,
      ellipsis,
      nextSiblingTr: nextOk,
      scrollY: Math.round(window.scrollY),
      scrollMax: Math.round(
        Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      ),
    };
  });
}

async function waitHot(page, t0) {
  let firstOk = null;
  let st = null;
  for (let i = 0; i < 22; i++) {
    await sleep(1000);
    st = await stats(page);
    if (firstOk == null && st.ok > 0) firstOk = Date.now() - t0;
    if (st.ok >= 3) break;
    if (i >= 14 && st.ok >= 1) break;
  }
  if (!st || st.ok < 1) {
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      st = await stats(page);
      if (firstOk == null && st.ok > 0) firstOk = Date.now() - t0;
      if (st.ok >= 1) break;
    }
  }
  return { firstOk, st };
}

async function shot(page, file) {
  const p = path.join(OUT, file);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

function aliasCopy(srcAbs, destName) {
  const dest = path.join(OUT, destName);
  fs.copyFileSync(srcAbs, dest);
  return dest;
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = await browser.contexts()[0].newPage();
const tag = `${site.id}-mobile`;
await page.setViewportSize({ width: 390, height: 844 });
console.log('goto', site.url);
await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(2500);
const hasFab = await waitFab(page);
console.log('hasFab', hasFab);
const shots = [];
shots.push(await shot(page, `${tag}-before.png`));
let result;
if (!hasFab) {
  result = { id: tag, error: 'no-fab', shots: shots.map((s) => path.basename(s)) };
} else {
  const t0 = Date.now();
  await clickOrb(page, 'orb');
  const { firstOk, st: stHot } = await waitHot(page, t0);
  const top = await shot(page, `${tag}-bilingual-top.png`);
  shots.push(top);
  aliasCopy(top, `${tag}-bilingual.png`);
  await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 1.2)));
  await sleep(2500);
  const stMid = await stats(page);
  shots.push(await shot(page, `${tag}-bilingual-mid.png`));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(3500);
  const stBot = await stats(page);
  shots.push(await shot(page, `${tag}-bilingual-bot.png`));
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(800);
  let stHide = null;
  if (await clickOrb(page, 'mode')) {
    await sleep(900);
    stHide = await stats(page);
    const hide = await shot(page, `${tag}-hide-top.png`);
    shots.push(hide);
    aliasCopy(hide, `${tag}-hide-orig.png`);
    aliasCopy(hide, `${tag}-trans-only.png`);
    await clickOrb(page, 'mode');
  }
  const required = [
    `${tag}-before.png`,
    `${tag}-bilingual-top.png`,
    `${tag}-bilingual-mid.png`,
    `${tag}-bilingual-bot.png`,
    `${tag}-hide-top.png`,
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(OUT, f)));
  result = {
    id: tag,
    type: site.type,
    url: site.url,
    firstOkMs: firstOk,
    top: stHot,
    mid: stMid,
    bot: stBot,
    hide: stHide,
    fiveComplete: missing.length === 0,
    missing,
    shots: shots.map((s) => path.basename(s)),
  };
}
await page.close();
fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify({ out: OUT, result }, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log('OUT', OUT);
