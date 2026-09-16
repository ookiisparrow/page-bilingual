/**
 * Real DeepSeek A/B: 1.4.62 non-stream vs 1.4.63 stream.
 * Chrome for Testing + --load-extension. Run:
 *   DEEPSEEK_API_KEY=... node scripts/stream-ab-bench.mjs
 */
import { createRequire } from "module";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/tmp/pbt-test/node_modules/playwright-core/package.json");
const { chromium } = require("playwright-core");

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT =
  process.env.PBT_BENCH_OUT ||
  "/cursor/stores/bc-0e734b8a-3c7b-404e-a396-bcc89b495698/media/stream-ab";
const KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || "";
const BLOCKED = !KEY;
const CFT =
  process.env.CHROME_FOR_TESTING ||
  "/tmp/pbt-test/chrome/linux-153.0.8010.47/chrome-linux64/chrome";
const CASES = (
  process.env.CASES ||
  "goal-mobile,goal-desktop,hyperlink-mobile,hyperlink-desktop"
).split(",");
const ALL = {
  "goal-mobile": { url: "https://en.wikipedia.org/wiki/Goal_setting", vp: { width: 390, height: 844 } },
  "goal-desktop": { url: "https://en.wikipedia.org/wiki/Goal_setting", vp: { width: 1280, height: 800 } },
  "hyperlink-mobile": { url: "https://en.wikipedia.org/wiki/Hyperlink", vp: { width: 390, height: 844 } },
  "hyperlink-desktop": { url: "https://en.wikipedia.org/wiki/Hyperlink", vp: { width: 1280, height: 800 } },
};

function build(variant) {
  const dest = `/tmp/pbt-ext-${variant}`;
  execSync(`VARIANT=${variant} DEST=${dest} bash ${ROOT}/scripts/stream-ab-build.sh`, { stdio: "inherit" });
  return dest;
}

function launchChrome(extPath, port) {
  const profile = `/tmp/pbt-cft-stream-${port}`;
  fs.rmSync(profile, { recursive: true, force: true });
  const proc = spawn(
    CFT,
    [
      `--user-data-dir=${profile}`,
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
      engineCalls: globalThis.__pbtEngineCalls || 0,
      bgCalls: globalThis.__pbtBgCalls || 0,
    };
  });
}

async function prepExtension(browser, key) {
  const ctx = browser.contexts()[0];
  let sw = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    sw = ctx.serviceWorkers().find((s) => s.url().includes("/background.js") && !s.url().includes("glbjnfimc"));
    if (sw) break;
  }
  if (!sw) throw new Error("extension service worker missing");
  await sw.evaluate(
    async ([apiKey]) => {
      globalThis.__pbtBgCalls = 0;
      await chrome.storage.local.remove("pbt.segCache.v3");
      await chrome.storage.local.set({
        serviceOn: true,
        engine: "deepseek",
        deepseekApiKey: apiKey,
        deepseekModel: "deepseek-flash",
      });
    },
    [key]
  );
  return sw;
}

async function runCase(browser, caseId, variant, sw) {
  const c = ALL[caseId];
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.setViewportSize(c.vp);
  const t0 = Date.now();
  await page.goto(c.url, { waitUntil: "load", timeout: 120000 });
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
      callsAtFirstOk = (await sw.evaluate(() => globalThis.__pbtBgCalls || 0)) || top.engineCalls;
    }
    if (top.ok !== lastOk) {
      lastOk = top.ok;
      since = Date.now();
    }
    if (!top.queued && Date.now() - since > 5000) break;
  }
  await page.evaluate(() => scrollTo(0, Math.round(innerHeight * 2)));
  await page.waitForTimeout(2500);
  const hop1 = await metrics(page);
  hop1.bgCalls = await sw.evaluate(() => globalThis.__pbtBgCalls || 0);
  const shot = path.join(OUT, `${variant}-${caseId}-top.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await page.close();
  return {
    tag: caseId,
    variant,
    firstOkMs: firstOk,
    callsAtFirstOk,
    callsFull: hop1.bgCalls || hop1.engineCalls,
    top,
    hop1,
    shot,
    pass:
      top.skip === 0 &&
      top.emptyLinks === 0 &&
      top.tr === 0 &&
      top.bareTags === 0 &&
      top.cjkOk > 0 &&
      top.fab &&
      top.orb,
  };
}

async function benchVariant(variant, port) {
  if (BLOCKED) return { variant, blocked: true, results: [] };
  const extPath = build(variant);
  const chrome = launchChrome(extPath, port);
  await waitCdp(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const sw = await prepExtension(browser, KEY);
    const results = [];
    for (const id of CASES) {
      if (!ALL[id]) continue;
      await sw.evaluate(() => {
        globalThis.__pbtBgCalls = 0;
      });
      results.push(await runCase(browser, id, variant, sw));
    }
    return { variant, blocked: false, results, chromePid: chrome.pid, extPath };
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
console.log("DEEPSEEK_API_KEY set:", !!KEY);
const baseline = await benchVariant("baseline", 9240);
const current = await benchVariant("current", 9241);
const report = {
  at: new Date().toISOString(),
  deepseekKeySet: !!KEY,
  blocked: BLOCKED,
  chrome: CFT,
  baseline: baseline.results,
  current: current.results,
};
fs.writeFileSync(path.join(OUT, "ab-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
