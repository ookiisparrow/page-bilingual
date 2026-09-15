/**
 * Benchmark §N§ local remap vs 1.4.59 <bN> baseline on Wikipedia (stub DeepSeek @ 750ms).
 * Run: node scripts/markup-remap-bench.mjs
 */
import { createRequire } from "module";
const require = createRequire("/tmp/pbt-test/node_modules/playwright-core/package.json");
const { chromium } = require("playwright-core");
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.PBT_BENCH_OUT || "/cursor/stores/bc-0e734b8a-3c7b-404e-a396-bcc89b495698/media/markup-remap";
const LATENCY = +(process.env.LATENCY || 750);
const SITES = [
  { id: "goal", url: "https://en.wikipedia.org/wiki/Goal_setting" },
  { id: "hyperlink", url: "https://en.wikipedia.org/wiki/Hyperlink" },
];

import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function buildStub(variant) {
  const dest = `/tmp/pbt-ext-${variant}`;
  execSync(`VARIANT=${variant} DEST=${dest} bash ${ROOT}/scripts/markup-remap-stub.sh`, { stdio: "inherit" });
  return dest;
}

async function runSite(ctx, sw, site, extPath, tag) {
  await sw.evaluate(async () => {
    await chrome.storage.local.remove("pbt.segCache.v3");
    globalThis.__stub = { counts: {}, calls: 0, chars: 0 };
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const t0 = Date.now();
  await page.goto(site.url, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(2500);
  let firstOk = null;
  let st = {};
  let since = Date.now();
  while (Date.now() - since < 35000) {
    await page.waitForTimeout(500);
    st = await page.evaluate(() => ({
      ok: document.querySelectorAll('[data-pbt-state="ok"]').length,
      skip: document.querySelectorAll('[data-pbt-state="skip"]').length,
      fail: document.querySelectorAll('[data-pbt-state="fail"]').length,
      queued: document.querySelectorAll('[data-pbt-state="queued"]').length,
      tr: document.querySelectorAll(".pbt-tr").length,
      emptyLinks: [...document.querySelectorAll("a[href]")].filter(
        (a) => a.getClientRects().length && !a.querySelector("img,svg,picture") && !a.textContent.trim()
      ).length,
    }));
    if (st.ok && firstOk == null) firstOk = Date.now() - t0;
    const sig = JSON.stringify(st);
    if (!st.queued && Date.now() - since > 3000) break;
    if (sig !== JSON.stringify(st)) since = Date.now();
  }
  await page.evaluate(() => scrollTo(0, Math.round(innerHeight * 1.2)));
  await page.waitForTimeout(2500);
  const mid = await page.evaluate(() => ({
    ok: document.querySelectorAll('[data-pbt-state="ok"]').length,
    skip: document.querySelectorAll('[data-pbt-state="skip"]').length,
    leftovers: [...document.querySelectorAll("p,li,h1,h2,h3")].filter((p) => {
      const t = (p.textContent || "").trim();
      return /^[A-Za-z]/.test(t) && t.length > 20 && !p.closest("code,.notranslate");
    }).length,
  }));
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(3000);
  const bot = await page.evaluate(() => ({
    ok: document.querySelectorAll('[data-pbt-state="ok"]').length,
    skip: document.querySelectorAll('[data-pbt-state="skip"]').length,
  }));
  const stub = await sw.evaluate(() => globalThis.__stub);
  const shot = path.join(OUT, `${tag}-${site.id}-top.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await page.close();
  return {
    tag,
    site: site.id,
    url: site.url,
    firstOkMs: firstOk,
    settleMs: Date.now() - t0,
    top: st,
    mid,
    bot,
    callsFull: stub.calls,
    promptChars: stub.chars,
    maxPerText: Math.max(0, ...Object.values(stub.counts || {})),
    shot,
  };
}

async function benchVariant(variant) {
  const extPath = buildStub(variant);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`/tmp/pbt-bench-${variant}-`), {
    headless: true,
    channel: "chromium",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--disable-extensions-except=" + extPath, "--load-extension=" + extPath, "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(
    ([mode, lat]) =>
      chrome.storage.local.set({ serviceOn: true, engine: "deepseek", deepseekApiKey: "stub", pbtStubMode: mode, pbtStubLatency: lat }),
    ["droptags", LATENCY]
  );
  const rows = [];
  for (const site of SITES) rows.push(await runSite(ctx, sw, site, extPath, variant));
  await ctx.close();
  return rows;
}

fs.mkdirSync(OUT, { recursive: true });
console.log("Building baseline (bN) and remap (§) stubs…");
const baseline = await benchVariant("baseline");
const remap = await benchVariant("remap");
const report = { baseline, remap, at: new Date().toISOString(), latency: LATENCY };
fs.writeFileSync(path.join(OUT, "bench-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
