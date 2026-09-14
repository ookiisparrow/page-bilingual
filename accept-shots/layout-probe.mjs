/**
 * 布局门禁探针：译前/译后比几何与 DOM 形状，不需要任何 API Key。
 *
 * 用真页 + 离线确定性译文跑 content.js，专盯 LAYOUT-SPACE-RULES A1/A5：
 * 文档宽度不得涨、列表/文件行高与行数不得变、行内宿主不得被插 .pbt-tr。
 *
 *   node accept-shots/layout-probe.mjs <url> <out-dir> [replace|bilingual|control]
 *
 * control = 不注入扩展，用来把站点自己的异步重排和我们的改动分开。
 * 环境变量：PBT_VW / PBT_VH（视口，默认 440x956）、PBT_SRC（扩展目录）。
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PBT_PW || 'playwright-core');

const URL_ = process.argv[2] || 'https://github.com/omacom/omarchy';
const OUT = process.argv[3] || '/tmp/pbt-layout-probe';
const MODE = process.argv[4] || 'replace';
const SRC = process.env.PBT_SRC || process.cwd();
const VW = Number(process.env.PBT_VW || 440);
const VH = Number(process.env.PBT_VH || 956);
const CHROME_BIN = process.env.PBT_CHROME || '/usr/local/bin/google-chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 确定性假译文：常见 chrome 词走词表，其余按源长度出等比汉字，模拟中文密度
const DICT = new Map(Object.entries({
  Code: '代码', Issues: '问题', Actions: '操作', Security: '安全', Insights: '洞察',
  Settings: '设置', About: '关于', Readme: '自述文件', 'View all files': '查看所有文件',
}));
const FILLER = '译文内容占位文字段落示例翻译结果说明信息条目';
function fakeZh(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  const hit = DICT.get(s) || DICT.get(s.toLowerCase());
  if (hit) return hit;
  const n = Math.max(2, Math.min(120, Math.round(s.length * 0.55)));
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) out += FILLER[(seed + i * 7) % FILLER.length];
  return out;
}

/** 页内执行：几何 + 结构指纹；.pbt-* 注入节点单独计数，不混进原站统计 */
function snapshot() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const rows = [...document.querySelectorAll('table[aria-labelledby] tbody tr, .react-directory-row, tr')]
    .filter(vis)
    .slice(0, 40)
    .map((tr) => {
      const a = tr.querySelector('a[href]');
      return {
        h: Math.round(tr.getBoundingClientRect().height),
        name: (a?.textContent || '').trim().slice(0, 40),
        // 本行自己有译文时长高是应该的；没译却变形才是我们把邻行顶坏了
        translated: !!tr.querySelector('[data-pbt-state="ok"]'),
      };
    });

  // A1 的实质违规：译文和宿主并排占同一行，而不是落在宿主下方
  let sameRowTr = 0;
  for (const node of document.querySelectorAll('.pbt-tr[data-pbt-for]')) {
    const host = document.querySelector(`[data-pbt-id="${CSS.escape(node.dataset.pbtFor)}"]`);
    if (!host) continue;
    const h = host.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    if (n.height < 2 || h.height < 2) continue;
    const beside = n.left >= h.right - 2 || n.right <= h.left + 2;
    const sameLine = n.top < h.bottom - 2 && n.bottom > h.top + 2;
    if (beside && sameLine) sameRowTr += 1;
  }
  return {
    docW: Math.round(document.documentElement.scrollWidth),
    docH: Math.round(document.documentElement.scrollHeight),
    vw: window.innerWidth,
    anchors: document.querySelectorAll('a[href]').length,
    buttons: document.querySelectorAll('button:not(.pbt-retry)').length,
    liCount: [...document.querySelectorAll('li')].filter(vis).length,
    rows,
    sameRowTr,
    ok: document.querySelectorAll('[data-pbt-state="ok"]').length,
    injected: document.querySelectorAll('.pbt-tr').length,
  };
}

fs.mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext(path.join(OUT, 'profile'), {
  executablePath: CHROME_BIN,
  headless: false,
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 2,
  isMobile: VW < 700,
  hasTouch: VW < 700,
  args: ['--no-sandbox', '--no-first-run', '--hide-scrollbars'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.stack || e).slice(0, 600)));

// 扩展跑在隔离世界里；这里注进页面世界，得先让 CSP 让路
await page.route('**/*', async (route) => {
  if (route.request().resourceType() !== 'document') return route.continue();
  const res = await route.fetch();
  const headers = { ...res.headers() };
  delete headers['content-security-policy'];
  delete headers['content-security-policy-report-only'];
  return route.fulfill({ response: res, headers });
});
await page.exposeFunction('__pbtTranslate', (items) => items.map((it) => ({ id: it.id, text: fakeZh(it.text) })));
await page.addInitScript((mode) => {
  const store = { engine: 'cursor', targetLang: 'zh-CN', displayMode: mode, serviceOn: false, autoTranslate: false };
  const area = () => ({
    async get(keys) {
      if (keys == null) return { ...store };
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(patch) { Object.assign(store, patch); },
    async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
  });
  window.chrome = window.chrome || {};
  chrome.storage = { local: area(), session: area(), onChanged: { addListener() {} } };
  chrome.runtime = {
    id: 'pbt-probe',
    lastError: null,
    onMessage: { addListener(fn) { window.__pbtOnMessage = fn; } },
    sendMessage(msg, cb) {
      if (msg?.type === 'PBT_HAS_KEY') return cb?.({ ok: true, hasKey: true, engine: 'cursor' });
      if (msg?.type === 'PBT_BATCH') {
        window.__pbtTranslate((msg.items || []).map((x) => ({ id: String(x.id), text: String(x.text ?? '') })))
          .then((items) => cb?.({ ok: true, items }))
          .catch((e) => cb?.({ ok: false, error: String(e) }));
        return;
      }
      cb?.({ ok: true });
    },
    getURL: (p) => p,
  };
}, MODE);

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(4500);
const before = await page.evaluate(snapshot);
await page.screenshot({ path: path.join(OUT, 'before.png') });

if (MODE === 'control') {
  await sleep(13000);
} else {
  await page.addStyleTag({ content: fs.readFileSync(path.join(SRC, 'content.css'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(SRC, 'shared.js'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(SRC, 'content.js'), 'utf8') });
  await sleep(1200);
  await page.evaluate(() => window.__pbtOnMessage?.({ type: 'PBT_TRANSLATE', scope: 'full' }, {}, () => {}));
  await sleep(12000);
}

const after = await page.evaluate(snapshot);
await page.screenshot({ path: path.join(OUT, 'after.png') });
await ctx.close();

const widened = after.docW > before.docW + 2;
const rowsMoved = before.rows.filter(
  (r, i) => after.rows[i] && after.rows[i].h !== r.h && !after.rows[i].translated
).length;
const lostAnchors = before.anchors - after.anchors;
const fails = [
  widened && `文档变宽 ${before.docW} → ${after.docW}（视口 ${after.vw}）：A1 行内插节点抢宽`,
  rowsMoved && `${rowsMoved} 行没译却被改了高度：A1/A3 不得顶坏邻行`,
  after.sameRowTr && `${after.sameRowTr} 条译文和宿主并排同行：A1 禁止 after() 抢同行`,
  lostAnchors > 0 && `少了 ${lostAnchors} 个链接：整替毁了 DOM 结构`,
  pageErrors.length && `页面抛错 ${pageErrors.length} 次`,
].filter(Boolean);

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ url: URL_, mode: MODE, before, after, pageErrors, fails }, null, 2));
console.log(`${URL_}  ${MODE}  ${VW}x${VH}`);
console.log(`  docW ${before.docW} → ${after.docW} | docH ${before.docH} → ${after.docH}`);
console.log(`  anchors ${before.anchors} → ${after.anchors} | li ${before.liCount} → ${after.liCount}`);
console.log(`  ok ${after.ok} | injected ${after.injected} | 并排同行 ${after.sameRowTr} | rows ${before.rows.length}`);
console.log(fails.length ? `FAIL\n  - ${fails.join('\n  - ')}` : 'PASS 布局未变形');
process.exit(fails.length ? 1 : 0);
