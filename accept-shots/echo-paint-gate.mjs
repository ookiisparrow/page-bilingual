// Offline gate for echo discard + paint distribution (no API key).
// Extends the replace-echo fixture with Wikipedia-style person/year prose,
// TOC geometry, inline link/bold hosts, and identifier skips.
//
//   node accept-shots/echo-paint-gate.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(
  path.join(process.env.PBT_MODULES || "/usr/local/lib/node_modules", "puppeteer-core", "package.json")
);
const puppeteer = require("puppeteer-core");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = process.env.PBT_REPO || path.join(HERE, "..");
const OUT = process.env.PBT_OUT || "/tmp/pbt-echo-paint";
const MEDIA = process.env.PBT_MEDIA || "";
const FIXTURE = path.join(REPO, "demo", "echo-paint.html");
const TAG = process.env.PBT_TAG || "echo-paint";

const DICT = {
  History: "历史",
  "Goal setting theory": "目标设定理论",
  "In practice": "实践中",
  "Goal setting": "目标设定",
  "Goal setting theory has been developed through both in the field and laboratory settings. Cecil Alec Mace carried out the first empirical studies in 1935.":
    "目标设定理论是在实地和实验室环境中发展起来的。塞西尔·亚历克·梅斯于1935年进行了首次实证研究。",
  "Locke and colleagues (1981) examined the behavioral effects of goal-setting on the task of brainstorming. See also Edwin A. Locke for the later synthesis.":
    "洛克及其同事（1981）研究了目标设定对头脑风暴任务的行为效应。关于后来的综合，另见 Edwin A. Locke。",
  "Neovim is the default, with VSCode, Cursor, Zed, Sublime Text, Helix, Vim, and Emacs ready to install.":
    "Neovim是默认编辑器，VSCode、Cursor、Zed、Sublime Text、Helix、Vim和Emacs也可安装。",
  "Choose Install > Windows from the Omarchy menu. Hardware virtualization brings near-native CPU performance for Office and everyday work.":
    "从 Omarchy 菜单中选择「安装 > Windows」。硬件虚拟化为 Office 和日常办公带来接近原生的 CPU 性能。",
};

const FILLER = "此处为占位译文用于核对替换是否真正落地本段应当完全没有英文残留";

const stub = (dict, filler) => {
  const norm = (t) => String(t).replace(/\s+/g, " ").trim();
  const tr = (t) => {
    const k = norm(t);
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    // strip nested tags' flattened text variants
    for (const [src, dst] of Object.entries(dict)) {
      if (norm(src) === k) return dst;
    }
    const want = Math.max(2, Math.round(k.length * 0.45));
    let out = "";
    while (out.length < want) out += filler;
    return out.slice(0, want);
  };
  const store = { displayMode: "replace", scope: "full", serviceOn: false, engine: "deepseek", targetLang: "zh-CN" };
  window.__pbtCalls = [];
  window.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: (fn) => { window.__pbtOnMsg = fn; } },
      sendMessage: (msg, cb) => {
        if (msg && msg.type === "PBT_BATCH") {
          const items = (msg.items || []).map((it) => {
            window.__pbtCalls.push(it.text);
            return { id: it.id, text: tr(it.text) };
          });
          setTimeout(() => cb({ ok: true, items }), 5);
          return;
        }
        setTimeout(() => cb({ ok: true }), 0);
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of [].concat(keys || [])) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (patch) => { Object.assign(store, patch); },
        remove: async () => {},
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: () => {} },
    },
  };
};

function audit() {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const han = (t) => (norm(t).match(/[\u4e00-\u9fff]/g) || []).length;
  const out = {
    trNodes: document.querySelectorAll(".pbt-tr").length,
    echoDiscarded: [],
    blankToc: [],
    giantLink: [],
    giantBold: [],
    idTranslated: [],
    paragraphsOk: [],
    paragraphsBad: [],
  };

  for (const el of document.querySelectorAll("[data-pbt-skip-reason='same-lang'], [data-pbt-skip-reason='echo']")) {
    const src = norm(el.dataset.pbtOrigText || el.textContent);
    if (/Mace|Locke|Neovim|Windows/.test(src)) {
      out.echoDiscarded.push({ reason: el.dataset.pbtSkipReason, text: src.slice(0, 80) });
    }
  }

  for (const a of document.querySelectorAll("nav.toc a")) {
    const label = a.querySelector(".label");
    const chev = a.querySelector(".chev");
    const num = a.querySelector(".num");
    if (label && !norm(label.textContent)) out.blankToc.push(norm(a.textContent));
    if (chev && !norm(chev.textContent)) out.blankToc.push("missing-chev");
    if (num && !norm(num.textContent)) out.blankToc.push("missing-num");
  }

  for (const p of document.querySelectorAll("article p")) {
    const txt = norm(p.innerText || p.textContent);
    const info = { id: p.id, han: han(txt), text: txt.slice(0, 100) };
    if (han(txt) >= 2) out.paragraphsOk.push(info);
    else out.paragraphsBad.push(info);

    // whole paragraph wrapped as one link/bold after paint?
    const only = p.childNodes.length === 1 ? p.firstChild : null;
    if (only && only.nodeType === 1 && only.matches?.("a[href]") && han(txt) >= 2) {
      out.giantLink.push(p.id);
    }
    // text length inside <a> equals full paragraph → giant link paint
    const links = [...p.querySelectorAll("a[href]")];
    for (const a of links) {
      if (norm(a.textContent).length >= txt.length * 0.85 && txt.length > 40) out.giantLink.push(p.id);
    }
    const bolds = [...p.querySelectorAll("b,strong")];
    for (const b of bolds) {
      if (norm(b.textContent).length >= txt.length * 0.85 && txt.length > 40) out.giantBold.push(p.id);
    }
  }

  for (const li of document.querySelectorAll(".ids li")) {
    const t = norm(li.textContent);
    if (han(t) > 0) out.idTranslated.push(t);
  }

  return out;
}

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (MEDIA) fs.mkdirSync(MEDIA, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(stub, DICT, FILLER);
  await page.goto("file://" + FIXTURE, { waitUntil: "load" });
  await page.addStyleTag({ content: fs.readFileSync(path.join(REPO, "content.css"), "utf8") });

  const beforePath = path.join(OUT, `before-${TAG}.png`);
  await page.screenshot({ path: beforePath, fullPage: true });

  await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, "shared.js"), "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, "content.js"), "utf8") });
  await page.waitForFunction("typeof window.__pbtOnMsg === 'function'", { timeout: 5000 });
  await page.evaluate(
    () => new Promise((res) => window.__pbtOnMsg({ type: "PBT_TRANSLATE", scope: "full" }, null, res))
  );
  await new Promise((r) => setTimeout(r, 3500));

  const report = await page.evaluate(audit);
  report.requested = await page.evaluate(() => window.__pbtCalls.length);
  report.callsSample = await page.evaluate(() => window.__pbtCalls.slice(0, 30));

  const afterPath = path.join(OUT, `after-${TAG}.png`);
  await page.screenshot({ path: afterPath, fullPage: true });

  // mobile spot
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const afterMobile = path.join(OUT, `after-${TAG}-mobile.png`);
  await page.screenshot({ path: afterMobile, fullPage: true });

  if (MEDIA) {
    for (const [src, name] of [
      [beforePath, `after-echo-paint-before.png`],
      [afterPath, `after-echo-paint-desktop.png`],
      [afterMobile, `after-echo-paint-mobile.png`],
    ]) {
      fs.copyFileSync(src, path.join(MEDIA, name));
    }
  }

  await browser.close();

  const fail =
    report.trNodes > 0 ||
    report.echoDiscarded.length > 0 ||
    report.blankToc.length > 0 ||
    report.giantLink.length > 0 ||
    report.giantBold.length > 0 ||
    report.idTranslated.length > 0 ||
    report.paragraphsBad.length > 0 ||
    report.paragraphsOk.length < 3;

  console.log(JSON.stringify(report, null, 2));
  console.log(fail ? "GATE: FAIL" : "GATE: PASS");
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
