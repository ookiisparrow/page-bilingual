#!/usr/bin/env node
/**
 * Collector coverage audit — does collect() reach every eligible sibling?
 *
 *   node accept-shots/collector-audit.mjs [--json out.json] [--shots dir] [--paint]
 *
 * Runs the real content.js collector against real pages in Chrome, then scores
 * two things the user-visible bug reduces to:
 *
 *   uncovered  — visible foreign text no collected block contains
 *   split      — parents whose eligible children are part collected, part not
 *                (the "para 1 and 3 translate, 2 stays English" report)
 *
 * `--paint` additionally drives the full pipeline with a MOCK engine (no network,
 * deterministic pseudo-Chinese) so coverage is visible in a screenshot. Mock text
 * is not a translation-quality signal; it only proves a node was reached.
 *
 * Needs: playwright-core (NODE_PATH), a Chrome binary (PBT_CHROME).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(process.env.PBT_REQUIRE_BASE || '/tmp/pbt/package.json');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME = process.env.PBT_CHROME || '/usr/local/bin/google-chrome';
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const PAINT = args.includes('--paint');
const OUT_JSON = flag('--json', '');
const SHOTS = flag('--shots', '');
const VIEWPORT = { width: 440, height: 956 };

const DEFAULT_SITES = [
  { id: 'omarchy-home', url: 'https://omarchy.org/', anchors: ['#hardware', '#news'] },
  { id: 'github-omarchy', url: 'https://github.com/omacom/omarchy', anchors: [] },
];
// PBT_SITES=id=url,id=url runs a wider regression matrix without editing this file.
const SITES = process.env.PBT_SITES
  ? process.env.PBT_SITES.split(',').map((s) => {
      const i = s.indexOf('=');
      return { id: s.slice(0, i), url: s.slice(i + 1), anchors: [] };
    })
  : DEFAULT_SITES;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** content.js is an IIFE; re-expose its internals for the audit without shipping a hook. */
function auditBundle() {
  const shared = fs.readFileSync(path.join(ROOT, 'shared.js'), 'utf8');
  // PBT_CONTENT points at an alternate content.js so a run can A/B against a baseline.
  const content = fs.readFileSync(process.env.PBT_CONTENT || path.join(ROOT, 'content.js'), 'utf8');
  const cut = content.lastIndexOf('})();');
  if (cut < 0) throw new Error('content.js: no IIFE tail to patch');
  const exposed = `
  window.__pbtAudit = {
    BLOCKS, SKIP, CHROME,
    collect, collectNewBlocks, collectFromRoot, collectLooseLatin,
    needsTranslate, worth, isSkip, isStructure, isMetaLine, textOf,
    isContentLink, isTextControl, isEffectivelyVisible,
    isFragileLayout, isTightClip, isChipListItem, isReplaceFull,
    hasMultipleProseChildren, looksLikeIdentifier, looksLikeHeroTitle,
    settings: () => settings,
    translatePage,
  };
`;
  return shared + '\n' + content.slice(0, cut) + exposed + content.slice(cut);
}

/** Minimal chrome.* so content.js boots in the page's main world. */
function chromeStub(mockEngine) {
  return `
(() => {
  const store = { targetLang: 'zh-CN', displayMode: 'replace', scope: 'full', serviceOn: false };
  const area = {
    async get(keys) {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(obj) { Object.assign(store, obj); },
    async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
  };
  // Deterministic pseudo-Chinese: proves a node was reached, not translation quality.
  const HAN = '译文测试内容节点覆盖检查中文字符样例';
  function mock(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    const n = Math.max(2, Math.min(18, Math.round(text.length / 2.2)));
    let s = '';
    for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) >>> 0; s += HAN[h % HAN.length]; }
    return s;
  }
  window.chrome = {
    storage: { local: area, session: area, sync: area, onChanged: { addListener() {} } },
    runtime: {
      lastError: null,
      id: 'pbt-audit',
      getURL: (p) => p,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        const reply = (r) => { try { cb && cb(r); } catch {} };
        if (!${mockEngine}) return reply({ ok: false, error: 'no-engine (audit stub)' });
        const items = msg?.items || [];
        if (Array.isArray(items) && items.length) {
          const rows = items.map((it) => ({ id: it.id, text: mock(String(it.text || '')) }));
          return setTimeout(() => reply({ ok: true, items: rows }), 12);
        }
        const t = msg?.text;
        if (t) return setTimeout(() => reply({ ok: true, text: mock(String(t)) }), 12);
        return reply({ ok: true });
      },
    },
    i18n: { getMessage: () => '' },
  };
})();
`;
}

/** Page-side scoring. Deliberately does NOT reuse the collector's own gates. */
const SCORE = `(() => {
  const A = window.__pbtAudit;
  const blocks = A.collect('full');
  const els = blocks.map((b) => b.el);
  // covered: this exact text sits inside a collected block.
  const covered = (node) => {
    for (const e of els) if (e === node || e.contains(node)) return true;
    return false;
  };
  // reached: the subtree got some collector attention (self, ancestor or descendant).
  // Partial reach still shows up in \`uncovered\`; splits use this to avoid double counting.
  const reached = (node) => {
    for (const e of els) if (e === node || e.contains(node) || node.contains(e)) return true;
    return false;
  };
  // Product-intent exclusions: commands, code, machine time, opted-out subtrees.
  const KEEP_EN = 'script,style,noscript,svg,canvas,iframe,textarea,select,option,code,pre,kbd,samp,' +
    '[translate="no"],.notranslate,time,[datetime],relative-time,time-ago,#pbt-root,.pbt-tr,.pbt-float';
  // Commit dates and bare URLs must stay as-is (LAYOUT-SPACE-RULES A5) — not omissions.
  const MACHINE = (t) =>
    /^https?:\\/\\//i.test(t) ||
    /^[A-Z][a-z]{2}\\s+\\d{1,2},\\s+\\d{4}$/.test(t) ||
    /^\\d{1,2}\\s+[A-Z][a-z]{2}\\s+\\d{4}$/.test(t);
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.08) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const pathOf = (el) => {
    const out = [];
    for (let n = el; n && n.nodeType === 1 && out.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { out.unshift(s + '#' + n.id); break; }
      const cls = String(n.className || '').split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) s += '.' + cls;
      out.unshift(s);
    }
    return out.join(' > ');
  };

  // Which gate rejected a candidate host — turns "missed" into an actionable cause.
  const why = (el) => {
    if (!el || el.nodeType !== 1) return {};
    const t = A.textOf(el);
    const r = { on: el.tagName.toLowerCase(), len: t.length };
    try {
      if (A.isSkip(el)) r.isSkip = 1;
      if (A.isStructure(el)) r.isStructure = 1;
      if (el.querySelector && el.querySelector(A.BLOCKS)) r.hasBlockChild = 1;
      if (!A.needsTranslate(t)) r.notForeign = 1;
      if (A.isMetaLine(el, t)) r.isMetaLine = 1;
      if (A.isChipListItem(el)) r.isChip = 1;
      if (A.isTightClip(el)) r.tightClip = 1;
      if (A.isFragileLayout(el)) r.fragile = 1;
      if (A.hasMultipleProseChildren(el)) r.multiProse = 1;
      if (!A.worth(el, t)) r.notWorth = 1;
      // A block that passes every gate but holds a collected descendant was
      // dropped by pruneAncestorBlocks — the inline-link-beats-prose case.
      const inner = els.filter((e) => e !== el && el.contains(e));
      if (inner.length) {
        r.prunedBy = inner.length;
        r.prunedFor = inner.slice(0, 3).map((e) => e.tagName.toLowerCase() + ':' + A.textOf(e).slice(0, 24));
      }
    } catch (e) { r.err = String(e.message || e); }
    return r;
  };
  const blockish = (el) => el.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,dt,figcaption,td,th,caption') || el;

  // 1) uncovered visible foreign text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const uncovered = [];
  const seenHost = new Set();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const raw = String(t.nodeValue || '').replace(/\\s+/g, ' ').trim();
    if (raw.length < 2) continue;
    const host = t.parentElement;
    if (!host || host.closest(KEEP_EN)) continue;
    if (!A.needsTranslate(raw) || MACHINE(raw)) continue;
    if (!visible(host)) continue;
    if (covered(t)) continue;
    if (seenHost.has(host)) continue;
    seenHost.add(host);
    const blk = blockish(host);
    uncovered.push({
      tag: host.tagName.toLowerCase(),
      path: pathOf(host),
      text: raw.slice(0, 90),
      whyHost: why(host),
      whyBlock: blk === host ? null : why(blk),
    });
  }

  // 2) split sibling groups — the "1 and 3 but not 2" failure
  const splits = [];
  const parents = new Set();
  const all = document.body.querySelectorAll('*');
  for (const p of all) {
    if (p.children.length < 2) continue;
    if (p.closest(KEEP_EN)) continue;
    const kids = [...p.children].filter((c) => {
      if (c.closest(KEEP_EN)) return false;
      if (!visible(c)) return false;
      const txt = A.textOf(c);
      if (MACHINE(txt)) return false;
      return txt.length >= 2 && A.needsTranslate(txt) || (c.dataset && c.dataset.pbtState);
    });
    if (kids.length < 2) continue;
    const hit = kids.filter((c) => reached(c));
    const missSet = kids.filter((c) => !reached(c));
    if (hit.length && missSet.length) {
      parents.add(p);
      splits.push({
        parent: pathOf(p),
        total: kids.length,
        collected: hit.length,
        missed: missSet.length,
        missedText: missSet.slice(0, 6).map((c) => A.textOf(c).slice(0, 60)),
      });
    }
  }

  // Host size matters as much as coverage: replace paints one text node, so a
  // unit that swallowed a whole row/section renders badly even when "covered".
  const lens = blocks.map((b) => String(b.text || '').length).sort((x, y) => x - y);
  const at = (q) => (lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * q))] : 0);
  const tags = {};
  for (const b of blocks) {
    const t = b.el.tagName.toLowerCase();
    tags[t] = (tags[t] || 0) + 1;
  }
  // Replace paints ONE text node, so a multi-text-node host leaves English behind.
  // Keep this low: it is the collector's side of the "no English leftovers" rule.
  const countText = (e) => {
    let n = 0;
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if ((t.nodeValue || '').trim()) n += 1;
    return n;
  };
  const multiTextHosts = blocks.filter((b) => countText(b.el) > 1).length;

  return {
    collected: blocks.length,
    units: { median: at(0.5), p95: at(0.95), max: lens[lens.length - 1] || 0, over600: lens.filter((l) => l > 600).length, multiTextHosts, tags },
    uncoveredCount: uncovered.length,
    uncovered: uncovered.slice(0, 60),
    splitGroups: splits.length,
    splits: splits.slice(0, 25),
  };
})()`;

/** Named product assertions straight off the user screenshots. */
const PROBES = {
  'omarchy-home': `(() => {
    const A = window.__pbtAudit;
    const els = A.collect('full').map((b) => b.el);
    const cov = (n) => els.some((e) => e === n || e.contains(n));
    const out = {};
    const win = document.querySelector('#windows') || document.body;
    const ps = [...win.querySelectorAll('p')].filter((p) => A.needsTranslate(A.textOf(p)));
    out.windowsParas = ps.map((p) => ({ text: A.textOf(p).slice(0, 48), collected: cov(p) }));
    const news = document.querySelector('#news') || document.body;
    const cards = [...news.querySelectorAll('a')].filter((a) => A.textOf(a).length > 30);
    out.newsCards = cards.slice(0, 6).map((a) => {
      const spans = [...a.querySelectorAll('span,h1,h2,h3,h4,p')].filter((s) => A.needsTranslate(A.textOf(s)));
      return { text: A.textOf(a).slice(0, 48), selfCollected: cov(a), leaves: spans.length, leavesCollected: spans.filter(cov).length };
    });
    return out;
  })()`,
  'github-omarchy': `(() => {
    const A = window.__pbtAudit;
    const els = A.collect('full').map((b) => b.el);
    const kind = (n) => {
      if (els.includes(n)) return 'self';
      if (els.some((e) => e.contains(n))) return 'ancestor';
      if (els.some((e) => n.contains(e))) return 'descendant';
      return 'none';
    };
    const md = document.querySelector('.markdown-body') || document.body;
    const items = [...md.querySelectorAll('li')].filter((li) => A.needsTranslate(A.textOf(li)));
    const rows = items.map((li) => ({ text: A.textOf(li).slice(0, 40), via: kind(li) }));
    const tally = {};
    for (const r of rows) tally[r.via] = (tally[r.via] || 0) + 1;
    return { navTotal: items.length, navVia: tally, navSample: rows.slice(0, 12), navMissed: rows.filter((r) => r.via === 'none').slice(0, 12) };
  })()`,
};

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript({ content: chromeStub(PAINT) + '\n' + auditBundle() });
  const results = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  for (const site of SITES) {
    const page = await ctx.newPage();
    const rec = { id: site.id, url: site.url };
    try {
      await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(2500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(900);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      rec.score = await page.evaluate(SCORE);
      if (PROBES[site.id]) rec.probe = await page.evaluate(PROBES[site.id]);

      if (PAINT) {
        await page.evaluate(() => window.__pbtAudit.translatePage('full'));
        let idle = 0;
        for (let i = 0; i < 90; i++) {
          await sleep(1000);
          const st = await page.evaluate(() => document.querySelectorAll('[data-pbt-state="queued"],[data-pbt-state="pending"]').length);
          idle = st ? 0 : idle + 1;
          if (idle >= 3) break; // stay idle a few ticks: miss-sweep queues more work
        }
        await sleep(1500);
        rec.painted = await page.evaluate(() => {
          const n = (s) => document.querySelectorAll(s).length;
          // Residual English inside painted hosts = paint-side leftovers, not collection gaps.
          let residual = 0;
          for (const h of document.querySelectorAll('.pbt-text-swap,[data-pbt-state="ok"]')) {
            for (const t of h.childNodes) {
              if (t.nodeType === 3 && /[A-Za-z]{4,}/.test(t.nodeValue || '')) { residual += 1; break; }
            }
          }
          const reasons = {};
          for (const el of document.querySelectorAll('[data-pbt-state="skip"]')) {
            const r = el.dataset.pbtSkipReason || '(none)';
            reasons[r] = (reasons[r] || 0) + 1;
          }
          const skipSample = [];
          for (const el of document.querySelectorAll('[data-pbt-state="skip"]')) {
            if (skipSample.length >= 10) break;
            skipSample.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 34), text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46) });
          }
          const failReasons = {};
          const failSample = [];
          for (const el of document.querySelectorAll('[data-pbt-state="fail"]')) {
            const r = el.dataset.pbtFailReason || '(none)';
            failReasons[r] = (failReasons[r] || 0) + 1;
            if (failSample.length < 8) {
              failSample.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 40), reason: r, text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50) });
            }
          }
          // GitHub file/dir names and commit ages must never be swapped (LAYOUT A5).
          const fileRow = [...document.querySelectorAll(
            '.react-directory-filename-column,.react-directory-filename-cell,[data-testid="file-name-cell"],tr[id^="folder-row-"]'
          )];
          return {
            ok: n('[data-pbt-state="ok"]'),
            fail: n('[data-pbt-state="fail"]'),
            skip: n('[data-pbt-state="skip"]'),
            skipReasons: reasons,
            skipSample,
            failReasons,
            failSample,
            swapped: n('.pbt-text-swap'),
            residualEnglishHosts: residual,
            fileRowsSwapped: fileRow.filter((r) => r.querySelector('.pbt-text-swap') || r.classList.contains('pbt-text-swap')).length,
            fileRowsTotal: fileRow.length,
          };
        });
      }
      if (SHOTS) {
        for (const anchor of site.anchors.length ? site.anchors : ['']) {
          const tag = anchor ? `${site.id}-${anchor.replace(/^#|^text:/, '').replace(/\W+/g, '-').slice(0, 24)}` : site.id;
          if (anchor) {
            await page.evaluate((a) => {
              // "text:foo" scrolls to the block containing that phrase (sections without ids)
              if (a.startsWith('text:')) {
                const needle = a.slice(5).toLowerCase();
                for (const el of document.querySelectorAll('p,h1,h2,h3,h4,section,div')) {
                  const t = (el.textContent || '').toLowerCase();
                  if (t.includes(needle) && t.length < 400) {
                    el.scrollIntoView({ block: 'center' });
                    return;
                  }
                }
                return;
              }
              const el = document.querySelector(a);
              if (el) el.scrollIntoView({ block: 'start' });
            }, anchor);
            await sleep(700);
          }
          await page.screenshot({ path: path.join(SHOTS, `${tag}.png`) });
        }
      }
    } catch (e) {
      rec.error = String(e.message || e);
    }
    results.push(rec);
    await page.close();
  }
  await browser.close();

  for (const r of results) {
    if (r.error) {
      console.log(`\n## ${r.id}\nERROR ${r.error}`);
      continue;
    }
    const s = r.score;
    console.log(`\n## ${r.id}  collected=${s.collected} uncovered=${s.uncoveredCount} splitGroups=${s.splitGroups}`);
    if (r.painted) console.log(`   painted ${JSON.stringify(r.painted)}`);
    for (const g of s.splits.slice(0, 8)) {
      console.log(`   split ${g.collected}/${g.total} @ ${g.parent}`);
      for (const t of g.missedText) console.log(`         miss: ${t}`);
    }
    if (r.probe) console.log('   probe ' + JSON.stringify(r.probe, null, 2).replace(/\n/g, '\n   '));
  }
  if (OUT_JSON) {
    fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
    console.log(`\nwrote ${OUT_JSON}`);
  }
  const worst = results.reduce((a, r) => a + (r.score?.splitGroups || 0), 0);
  console.log(`\nTOTAL splitGroups=${worst}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
