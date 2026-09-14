import { createRequire } from 'module';
const require = createRequire('/tmp/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');
import fs from 'fs';
import path from 'path';

const OUT = process.env.PBT_VG_OUT || '/workspace/page-bilingual-shots/visual-gate';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = [
  { id: 'wiki', url: 'https://en.wikipedia.org/wiki/Goal_setting' },
  { id: 'google', url: 'https://www.google.com/search?q=goal+setting' },
  { id: 'github', url: 'https://github.com/vercel/next.js' },
  { id: 'ookla', url: 'https://www.ookla.com/about' },
];


async function setCursorEngineViaExtension(context) {
  const EXT_ID = process.env.PBT_EXT_ID || 'bmacdmdgbgmlcdjhdbillailpdfpohha';
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${EXT_ID}/options.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(async () => {
      await chrome.storage.local.set({
        engine: 'cursor',
        cursorApiUrl: 'http://127.0.0.1:47821/v1/chat/completions',
        cursorModel: 'composer-2.5-fast',
      });
      // Gate profile: do not rely on DeepSeek
      await chrome.storage.local.remove(['deepseekApiKey']);
    });
    const got = await page.evaluate(async () => chrome.storage.local.get(['engine', 'cursorApiUrl']));
    console.log('gate storage set', got);
  } finally {
    await page.close();
  }
}

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
    return {
      ok: count('ok'),
      fail: count('fail'),
      skip: count('skip'),
      queued: count('queued'),
      tr: document.querySelectorAll('.pbt-tr').length,
      ellipsis,
      modeBtn: document.getElementById('pbt-root')?.shadowRoot?.getElementById('modeBtn')?.textContent || '',
    };
  });
}

async function runSite(page, site, viewport) {
  const tag = `${site.id}-${viewport.name}`;
  const dir = OUT;
  await page.setViewportSize(viewport.size);
  await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(2000);
  const hasFab = await waitFab(page);
  const before = path.join(dir, `${tag}-before.png`);
  await page.screenshot({ path: before, fullPage: false });
  if (!hasFab) {
    return { id: tag, error: 'no-fab', shots: [before] };
  }
  const t0 = Date.now();
  await clickOrb(page, 'orb');
  let firstOk = null;
  let st = null;
  // §4：等热区出译再截（至少 1 段 ok；优先等到 3+ 或 20s）
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    st = await stats(page);
    if (firstOk == null && st.ok > 0) firstOk = Date.now() - t0;
    if (st.ok >= 3) break;
    if (i >= 14 && st.ok >= 1) break;
  }
  if (!st || st.ok < 1) {
    // 再多等 10s，避免假阴性
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      st = await stats(page);
      if (firstOk == null && st.ok > 0) firstOk = Date.now() - t0;
      if (st.ok >= 1) break;
    }
  }
  const bi = path.join(dir, `${tag}-bilingual.png`);
  await page.screenshot({ path: bi, fullPage: false });
  const stBi = await stats(page);

  let hideShot = null;
  let stHide = null;
  const clickedHide = await clickOrb(page, 'mode');
  if (clickedHide) {
    await sleep(800);
    hideShot = path.join(dir, `${tag}-hide-orig.png`);
    await page.screenshot({ path: hideShot, fullPage: false });
    stHide = await stats(page);
    // back to bilingual for cleanliness
    await clickOrb(page, 'mode');
  }

  return {
    id: tag,
    url: site.url,
    firstOkMs: firstOk,
    bilingual: stBi,
    hide: stHide,
    shots: [before, bi, hideShot].filter(Boolean),
    hideClicked: clickedHide,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
await setCursorEngineViaExtension(context);
const page = await context.newPage();
const mobile = { name: 'mobile', size: { width: 390, height: 844 } };
const results = [];
for (const site of SITES) {
  try {
    console.log('run', site.id);
    results.push(await runSite(page, site, mobile));
  } catch (e) {
    results.push({ id: site.id + '-mobile', error: String(e.message || e) });
  }
}
await page.close();

const report = [];
report.push('# 视觉门禁报告');
report.push('');
report.push(`生成：${new Date().toISOString()}（脚本；**须人工看图**）`);
report.push('');
report.push('| 站 | firstOk | ok/fail/skip/queued | … | 隐钮 | 截图 |');
report.push('| --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  if (r.error) {
    report.push(`| ${r.id} | ERR | ${r.error} | | | |`);
    continue;
  }
  const b = r.bilingual || {};
  report.push(
    `| ${r.id} | ${r.firstOkMs ?? '-'}ms | ${b.ok}/${b.fail}/${b.skip}/${b.queued} | ${b.ellipsis} | ${r.hideClicked ? 'yes' : 'no'} | ${r.shots.map((s) => path.basename(s)).join(', ')} |`
  );
}
report.push('');
report.push('## 人工 checklist（幕僚长填）');
report.push('');
report.push('- [ ] V1 无满屏省略号/空洞');
report.push('- [ ] V2 双语各一次、无双中文');
report.push('- [ ] V3 隐原文后干净');
report.push('- [ ] V4 手机 stack、标题不挤');
report.push('- [ ] V5 间隙紧、可读');
report.push('- [ ] V6 浮钮小可拖');
report.push('');
report.push('判定：□ 视觉过  □ 仅指标过（不算过）  □ 不过');
report.push('');

const md = path.join(OUT, 'REPORT.md');
fs.writeFileSync(md, report.join('\n'));
fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify(results, null, 2));
console.log('wrote', md);
console.log(JSON.stringify(results.map((r) => ({ id: r.id, err: r.error, ok: r.bilingual?.ok, fail: r.bilingual?.fail })), null, 2));
