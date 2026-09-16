/**
 * Benchmark ok mode (tags preserved) — normal production path.
 */
import { createRequire } from "module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire("/tmp/pbt-test/node_modules/playwright-core/package.json");
const { chromium } = require("playwright-core");
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = "/cursor/stores/bc-0e734b8a-3c7b-404e-a396-bcc89b495698/media/markup-remap";

async function run(variant) {
  const dest = `/tmp/pbt-ext-${variant}`;
  execSync(`VARIANT=${variant} DEST=${dest} bash ${ROOT}/scripts/markup-remap-stub.sh`, { stdio: "ignore" });
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(`/tmp/bench-ok-${variant}-`), {
    headless: true, channel: "chromium", ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${dest}`, `--load-extension=${dest}`, "--no-sandbox"],
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  await sw.evaluate(() => chrome.storage.local.set({ serviceOn: true, engine: "deepseek", deepseekApiKey: "stub", pbtStubMode: "ok", pbtStubLatency: 750 }));
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const t0 = Date.now();
  await page.goto("https://en.wikipedia.org/wiki/Goal_setting", { waitUntil: "load", timeout: 90000 });
  let firstOk = null;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const ok = await page.evaluate(() => document.querySelectorAll('[data-pbt-state="ok"]').length);
    if (ok && !firstOk) firstOk = Date.now() - t0;
    if (ok >= 120) break;
  }
  const top = await page.evaluate(() => ({
    ok: document.querySelectorAll('[data-pbt-state="ok"]').length,
    skip: document.querySelectorAll('[data-pbt-state="skip"]').length,
    emptyLinks: [...document.querySelectorAll("a[href]")].filter((a) => a.getClientRects().length && !a.querySelector("img,svg,picture") && !a.textContent.trim()).length,
    tr: document.querySelectorAll(".pbt-tr").length,
  }));
  const stub = await sw.evaluate(() => globalThis.__stub);
  await ctx.close();
  return { variant, firstOkMs: firstOk, top, calls: stub.calls, promptChars: stub.chars };
}

fs.mkdirSync(OUT, { recursive: true });
const rows = [await run("baseline"), await run("remap")];
fs.writeFileSync(path.join(OUT, "bench-ok-mode.json"), JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
