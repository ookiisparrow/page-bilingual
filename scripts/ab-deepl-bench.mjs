/**
 * Real A/B: DeepSeek flash vs DeepL translate API (first-paint speed).
 * Chrome for Testing + --load-extension. Cold profile per engine.
 *   DEEPSEEK_API_KEY=... DEEPL_API_KEY=... node scripts/ab-deepl-bench.mjs
 */
import { createRequire } from "module";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/tmp/pbt-test/node_modules/playwright-core/package.json");
const { chromium } = require("playwright-core");

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.env.PBT_BENCH_OUT || "/cursor/stores/bc-0e734b8a-3c7b-404e-a396-bcc89b495698/media/ab-deepl";
const DS_KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || "";
const DL_KEY = process.env.DEEPL_API_KEY || "";
const BLOCKED = !DS_KEY || !DL_KEY;
const CFT =
  process.env.CHROME_FOR_TESTING ||
  "/tmp/pbt-test/chrome/linux-153.0.8010.47/chrome-linux64/chrome";
const CASES = (
  process.env.CASES ||
  "goal-mobile,goal-desktop,hyperlink-mobile,hyperlink-desktop"
).split(",");
const ALL = {
  "goal-mobile": { site: "goal", url: "https://en.wikipedia.org/wiki/Goal_setting", vp: { width: 390, height: 844 } },
  "goal-desktop": { site: "goal", url: "https://en.wikipedia.org/wiki/Goal_setting", vp: { width: 1280, height: 800 } },
  "hyperlink-mobile": { site: "hyperlink", url: "https://en.wikipedia.org/wiki/Hyperlink", vp: { width: 390, height: 844 } },
  "hyperlink-desktop": { site: "hyperlink", url: "https://en.wikipedia.org/wiki/Hyperlink", vp: { width: 1280, height: 800 } },
};

function build() {
  const dest = "/tmp/pbt-ext-deepl-ab";
  execSync(`DEST=${dest} bash ${ROOT}/scripts/ab-deepl-build.sh`, {
    stdio: "inherit",
    env: { ...process.env, DEEPSEEK_API_KEY: DS_KEY, DEEPL_API_KEY: DL_KEY },
  });
  return dest;
}

function launchChrome(extPath, port) {
  const profile = `/tmp/pbt-cft-deepl-${port}`;
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(
    CFT,
    [
      `--user-data-dir=${profile}`,
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--headless=new",
    ],
    { stdio: "ignore", detached: true }
  );
  proc.unref();
  return { profile, port, pid: proc.pid };
}

async function waitCdp(port, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP not ready on :${port}`);
}

function metrics(page) {
  return page.evaluate(() => {
    const st = (x) => document.querySelectorAll(`[data-pbt-state="${x}"]`).length;
    const han = /[\u4e00-\u9fff]/;
    const okNodes = [...document.querySelectorAll('[data-pbt-state="ok"]')];
    const vpLeft = [...document.querySelectorAll("p,li,h1,h2,h3")].filter((p) => {
      const r = p.getBoundingClientRect();
      if (!r.width || !r.height || r.top > innerHeight || r.bottom < 0) return false;
      const t = (p.textContent || "").trim();
      return /^[A-Za-z]/.test(t) && t.length > 20 && !p.closest("code,.notranslate");
    }).length;
    return {
      ok: st("ok"),
      skip: st("skip"),
      fail: st("fail"),
      queued: st("queued"),
      tr: document.querySelectorAll(".pbt-tr").length,
      emptyLinks: [...document.querySelectorAll("a[href]")].filter(
        (a) => a.getClientRects().length && !a.querySelector("img,svg,picture") && !a.textContent.trim()
      ).length,
      bareTags: (document.body.innerText.match(/§\/?\d+§|<\/?b\d+>/g) || []).length,
      cjkOk: okNodes.filter((n) => han.test(n.textContent)).length,
      vpLeftovers: vpLeft,
      fab: !!document.querySelector("#pbt-root"),
      orb: !!document.querySelector("#pbt-root")?.shadowRoot?.getElementById("orb"),
      scrollY: scrollY,
    };
  });
}

async function prepExtension(browser, engine) {
  const ctx = browser.contexts()[0];
  await new Promise((r) => setTimeout(r, 2000));
  const sw = ctx.serviceWorkers().find((s) => s.url().includes("/background.js") && !s.url().includes("glbjnfimc"));
  if (!sw) throw new Error("extension service worker missing");
  await sw.evaluate(
    async ([eng, dsKey, dlKey]) => {
      globalThis.__pbtBgCalls = 0;
      await chrome.storage.local.remove("pbt.segCache.v3");
      const patch = { serviceOn: true, engine: eng, targetLang: "zh-CN" };
      if (eng === "deepseek") {
        patch.deepseekApiKey = dsKey;
        patch.deepseekModel = "deepseek-flash";
      } else {
        patch.deeplApiKey = dlKey;
      }
      await chrome.storage.local.set(patch);
    },
    [engine, DS_KEY, DL_KEY]
  );
  const root = await browser.contexts()[0].pages()[0]?.evaluate(() => !!document.querySelector("#pbt-root"));
  if (!root) {
    const p = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    await p.goto("about:blank");
  }
  return sw;
}

async function runCase(browser, caseId, engine, sw) {
  const c = ALL[caseId];
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.setViewportSize(c.vp);
  const t0 = Date.now();
  await page.goto(c.url, { waitUntil: "load", timeout: 120000 });
  await page.evaluate(() => {
    const orb = document.querySelector("#pbt-root")?.shadowRoot?.getElementById("orb");
    if (orb && orb.textContent?.includes("译")) orb.click();
  });
  let firstOk = null;
  let callsAtFirstOk = null;
  let top = {};
  let lastOk = 0;
  let since = Date.now();
  while (Date.now() - since < 90000) {
    await page.waitForTimeout(250);
    top = await metrics(page);
    if (top.ok && firstOk == null) {
      firstOk = Date.now() - t0;
      callsAtFirstOk = await sw.evaluate(() => globalThis.__pbtBgCalls || 0);
    }
    if (top.ok !== lastOk) {
      lastOk = top.ok;
      since = Date.now();
    }
    if (!top.queued && Date.now() - since > 5000) break;
  }
  const shotTop = path.join(OUT, `${engine}-${caseId}-top.png`);
  await page.screenshot({ path: shotTop, fullPage: false });
  const hops = [];
  for (let hop = 1; hop <= 3; hop++) {
    await page.evaluate(() => scrollTo(0, scrollY + Math.round(innerHeight * 2)));
    await page.waitForTimeout(2500);
    const m = await metrics(page);
    m.hop = hop;
    hops.push(m);
    await page.screenshot({ path: path.join(OUT, `${engine}-${caseId}-hop${hop}.png`), fullPage: false });
  }
  const callsFull = await sw.evaluate(() => globalThis.__pbtBgCalls || 0);
  const final = hops[hops.length - 1] || top;
  await page.close();
  const pass =
    final.skip === 0 &&
    final.emptyLinks === 0 &&
    final.tr === 0 &&
    final.bareTags === 0 &&
    final.cjkOk > 0 &&
    top.fab &&
    top.orb;
  return {
    tag: caseId,
    site: c.site,
    viewport: caseId.includes("mobile") ? "mobile" : "desktop",
    url: c.url,
    engine,
    warm: false,
    firstOkMs: firstOk,
    callsAtFirstOk,
    callsFull,
    top,
    hops,
    final,
    chineseLanded: final.cjkOk > 0,
    pass,
    skip: final.skip,
    ok: final.ok,
    leftovers: final.vpLeftovers,
    emptyLinks: final.emptyLinks,
    tr: final.tr,
    bareTags: final.bareTags,
    shots: [shotTop, ...hops.map((_, i) => `${engine}-${caseId}-hop${i + 1}.png`)],
  };
}

async function benchEngine(engine, port) {
  if (BLOCKED) return { engine, blocked: true, results: [] };
  const extPath = build();
  const chrome = launchChrome(extPath, port);
  await waitCdp(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const sw = await prepExtension(browser, engine);
    const results = [];
    for (const id of CASES) {
      if (!ALL[id]) continue;
      await sw.evaluate(() => {
        globalThis.__pbtBgCalls = 0;
      });
      results.push(await runCase(browser, id, engine, sw));
    }
    return { engine, blocked: false, results, chromePid: chrome.pid };
  } finally {
    await browser.close().catch(() => {});
    try {
      process.kill(chrome.pid);
    } catch {
      /* gone */
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
console.log("DEEPSEEK_API_KEY set:", !!DS_KEY);
console.log("DEEPL_API_KEY set:", !!DL_KEY);
const deepseek = await benchEngine("deepseek", 9240);
const deepl = await benchEngine("deepl", 9241);
const report = {
  at: new Date().toISOString(),
  deepseekKeySet: !!DS_KEY,
  deeplKeySet: !!DL_KEY,
  blocked: BLOCKED,
  browser: "Chrome for Testing linux-153.0.8010.47",
  version: "1.4.64",
  base: "cursor/aggressive-speed-1.4.62-fd9b",
  fairness: "cold profile per engine; seg cache cleared per case; same pages/viewports; real APIs only",
  deepseek: deepseek.results,
  deepl: deepl.results,
};
fs.writeFileSync(path.join(OUT, "ab-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
