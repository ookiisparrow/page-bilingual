import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire('/usr/local/lib/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');

const OUT =
  process.env.PBT_VG_OUT ||
  `/workspace/page-bilingual-shots/visual-gate/wide-${new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[:T]/g, '')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** §1 matrix: 新闻/博客/文档/电商/论坛 + 原有维基/SERP/代码/官网
 *  P0 必含 stripe（反序回归）+ cursor/vercel/linear/figma（工具落地门禁） */
const SITES = [
  // 原矩阵
  { id: 'wiki', type: 'longform', url: 'https://en.wikipedia.org/wiki/Goal_setting' },
  { id: 'cloudflare', type: 'blog', url: 'https://blog.cloudflare.com/' },
  { id: 'nyt', type: 'news', url: 'https://www.nytimes.com/section/technology' },
  { id: 'mdn', type: 'docs', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Introduction' },
  { id: 'google', type: 'serp', url: 'https://www.google.com/search?q=goal+setting&hl=en' },
  { id: 'github', type: 'code', url: 'https://github.com/vercel/next.js' },
  { id: 'ookla', type: 'landing', url: 'https://www.ookla.com/about' },
  { id: 'shopify', type: 'ecommerce', url: 'https://www.shopify.com/' },
  { id: 'hn', type: 'forum', url: 'https://news.ycombinator.com/' },
  // 扩场景：盯漏译 / 标题对齐 / 复杂 DOM
  { id: 'bbc', type: 'news', url: 'https://www.bbc.com/news/technology' },
  { id: 'verge', type: 'news', url: 'https://www.theverge.com/' },
  { id: 'medium', type: 'blog', url: 'https://medium.com/tag/productivity' },
  { id: 'substack', type: 'blog', url: 'https://www.lennysnewsletter.com/' },
  { id: 'stripe', type: 'landing', url: 'https://stripe.com/' },
  { id: 'apple', type: 'landing', url: 'https://www.apple.com/' },
  { id: 'stackoverflow', type: 'docs', url: 'https://stackoverflow.com/questions/231767/what-does-the-yield-keyword-do-in-python' },
  { id: 'reddit', type: 'forum', url: 'https://www.reddit.com/r/explainlikeimfive/hot/' },
  { id: 'arxiv', type: 'docs', url: 'https://arxiv.org/abs/1706.03762' },
  { id: 'amazon', type: 'ecommerce', url: 'https://www.amazon.com/dp/B0D1XD1ZV3' },
  { id: 'notion', type: 'docs', url: 'https://www.notion.so/help/guides/using-notion-ai' },
  // 工具/产品落地页（易碎布局）
  { id: 'cursor', type: 'tool', url: 'https://cursor.com/' },
  { id: 'vercel', type: 'tool', url: 'https://vercel.com/' },
  { id: 'linear', type: 'tool', url: 'https://linear.app/' },
  { id: 'figma', type: 'tool', url: 'https://www.figma.com/' },
  { id: 'github-features', type: 'tool', url: 'https://github.com/features' },
  { id: 'react', type: 'docs', url: 'https://react.dev/learn' },
  { id: 'webdev', type: 'docs', url: 'https://web.dev/articles/vitals' },
  { id: 'openai', type: 'tool', url: 'https://openai.com/' },
  { id: 'npm', type: 'docs', url: 'https://www.npmjs.com/package/react' },
  { id: 'guardian', type: 'news', url: 'https://www.theguardian.com/technology' },
  { id: 'producthunt', type: 'forum', url: 'https://www.producthunt.com/' },
  { id: 'tailwind', type: 'docs', url: 'https://tailwindcss.com/docs/installation' },
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
    const hosts = [...document.querySelectorAll('.pbt-host[data-pbt-state="ok"]')];
    let nextOk = 0;
    // Stripe regress: column-reverse 曾把译文视觉放到宿主上方；tr 整盒在宿主之上 = fail 信号
    let trAboveHost = 0;
    for (const h of hosts) {
      const n = h.nextElementSibling;
      if (n && n.classList?.contains('pbt-tr')) {
        nextOk += 1;
        try {
          const hr = h.getBoundingClientRect();
          const nr = n.getBoundingClientRect();
          if (nr.height > 0 && nr.bottom <= hr.top + 2) trAboveHost += 1;
        } catch { /* ignore */ }
      }
    }
    return {
      ok: count('ok'),
      fail: count('fail'),
      skip: count('skip'),
      queued: count('queued'),
      tr: document.querySelectorAll('.pbt-tr').length,
      ellipsis,
      nextSiblingTr: nextOk,
      trAboveHost,
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

async function runSite(page, site) {
  const tag = `${site.id}-mobile`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => {
    throw new Error(`goto: ${e.message || e}`);
  });
  await sleep(2500);
  const hasFab = await waitFab(page);
  const shots = [];
  const before = await shot(page, `${tag}-before.png`);
  shots.push(before);
  if (!hasFab) return { id: tag, type: site.type, url: site.url, error: 'no-fab', shots: shots.map((s) => path.basename(s)) };

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

  return {
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

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
// 视觉核验必须走 Cursor bridge，禁止 DeepSeek
await setCursorEngineViaExtension(context);
const page = await context.newPage();
const results = [];
for (const site of SITES) {
  try {
    console.log('run', site.id);
    results.push(await runSite(page, site));
  } catch (e) {
    console.log('ERR', site.id, e.message || e);
    results.push({
      id: site.id + '-mobile',
      type: site.type,
      url: site.url,
      error: String(e.message || e),
      fiveComplete: false,
    });
  }
}
await page.close();

const lines = [
  '# 宽场景视觉门禁（每站五张 + 滑动）',
  '',
  `OUT: ${OUT}`,
  `生成: ${new Date().toISOString()}`,
  '',
  '矩阵：长文/博客/新闻/文档/SERP/代码/官网/电商/论坛',
  '五张：before · bilingual-top · mid · bot · hide-top（另存 bilingual / hide-orig / trans-only）',
  '',
  '| 站 | 类型 | 五张齐 | firstOk | top ok/fail | mid | bot | nextSibling | trAbove | … | 错 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  if (r.error) {
    lines.push(
      `| ${r.id} | ${r.type} | no | — | ERR | | | | | | ${String(r.error).slice(0, 60)} |`
    );
    continue;
  }
  const t = r.top || {};
  lines.push(
    `| ${r.id} | ${r.type} | ${r.fiveComplete ? 'yes' : 'no'} | ${r.firstOkMs ?? '-'} | ${t.ok}/${t.fail} | ${r.mid?.ok ?? '-'} | ${r.bot?.ok ?? '-'} | ${t.nextSiblingTr ?? '-'} | ${t.trAboveHost ?? 0} | ${t.ellipsis} | ${(r.missing || []).join(',') || ''} |`
  );
}
lines.push('');
lines.push('## 过关（人工 / pstack）');
lines.push('- 每站五张齐；缺滑动样张 = 不过');
lines.push('- 下滑后新可见区继续出译文（mid/bot ok 不掉、可增）');
lines.push('- 已译段不丢不叠；译文 nextSibling 贴宿主；无满屏 …');
lines.push('- Stripe 等：trAboveHost===0（译文不得视觉在宿主上方；insertTrAfter order 纠偏）');
lines.push('- 工具落地 cursor/vercel/linear/figma 必跑；仅译文不得塌成白页');
lines.push('- 必须看图（V1–V6）；DOM 不能替代');
lines.push('');
lines.push('判定：□ 视觉过  □ 不过');

fs.writeFileSync(path.join(OUT, 'REPORT.md'), lines.join('\n'));
fs.writeFileSync(path.join(OUT, 'REPORT.json'), JSON.stringify({ out: OUT, results }, null, 2));
console.log('wrote', path.join(OUT, 'REPORT.md'));
console.log(
  JSON.stringify(
    results.map((r) => ({
      id: r.id,
      type: r.type,
      five: r.fiveComplete,
      err: r.error,
      top: r.top?.ok,
      mid: r.mid?.ok,
      bot: r.bot?.ok,
    })),
    null,
    2
  )
);
