// Offline gate for replace mode + echo, no translation engine required.
// Injects content.js with a stubbed chrome API whose PBT_BATCH returns
// canned Chinese (plus deliberate echo / mixed-language rows).
//
//   npm i -g puppeteer-core   (or PBT_MODULES=/path/to/node_modules)
//   node accept-shots/replace-echo-gate.mjs              # replace mode
//   PBT_MODE=bilingual node accept-shots/replace-echo-gate.mjs
//
// Replace mode fails on any leftover English sentence, any .pbt-tr node, or a
// host left half English. Bilingual mode fails if no .pbt-tr is built or if a
// bar just repeats its English host.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// PBT_MODULES: any node_modules holding puppeteer-core (ESM import ignores NODE_PATH)
const require = createRequire(
  path.join(process.env.PBT_MODULES || "/usr/local/lib/node_modules", "puppeteer-core", "package.json")
);
const puppeteer = require("puppeteer-core");

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = process.env.PBT_REPO || path.join(HERE, "..");
const OUT = process.env.PBT_OUT || "/tmp/pbt-shots";
const FIXTURE = process.env.PBT_FIXTURE || path.join(HERE, "..", "demo", "omarchy-cards.html");
const TAG = process.env.PBT_TAG || "run";
const MODE = process.env.PBT_MODE || "replace";

const DICT = {
  "Recent news": "近期动态",
  "Introducing Omarchy M": "隆重推出 Omarchy M",
  "On September 11, 2026 Omarchy MApple made excellent hardware. They always have. But so did many others.":
    "2026年9月11日 推出 Omarchy MApple 制造出色的硬件。他们一贯如此（除了那次蝴蝶键盘事件）。而许多其他厂商也是如此。",
  "Omacom Foundation hires Emir Beganović as Head of Infrastructure":
    "Omacom 基金会聘请 Emir Beganović 担任基础设施负责人",
  "On September 10, 2026 the Omacom Foundation hired Emir Beganović to lead infrastructure work across the project.":
    "2026年9月10日 Omacom 基金会聘请 Emir Beganović 领导整个项目的基础设施工作。",
  // proper-noun echo: model returns the source verbatim
  DigitalOcean: "DigitalOcean",
  "On September 9, 2026 DigitalOcean joined the Omacom Foundation as a founding corporate sponsor.":
    "2026年9月9日 DigitalOcean 以创始企业赞助者的身份加入 Omacom 基金会。",
  "All the news": "所有新闻",
  Windows: "Windows",
  "Your Windows apps, right at home": "你的 Windows 应用，宾至如归",
  "Choose Install > Windows from the Omarchy menu. Hardware virtualization brings near-native CPU performance for Office and everyday work, with a shared clipboard and a folder for moving files between Windows and Linux.":
    "从 Omarchy 菜单中选择「安装 > Windows」。硬件虚拟化为 Office 和日常办公带来接近原生的 CPU 性能，并提供共享剪贴板，以及一个用于在 Windows 与 Linux 之间移动文件的文件夹。",
  "Bring your own Windows key": "带上你的 Windows 密钥",
  // mixed model output: source echoed, then the translation appended
  "Bring a Windows 11 Pro license valid for a VM. Run omarchy windows key to retrieve your machine's original key (this only works on Pro, not Home licenses).":
    "Bring a Windows 11 Pro license valid for a VM. Run omarchy windows key to retrieve your machine's original key (this only works on Pro, not Home licenses). — 请准备一份可用于虚拟机的 Windows 11 专业版许可证。运行 omarchy windows key 即可取回本机的原始密钥（仅适用于专业版，不支持家庭版）。",
  "For work, not gaming": "用于工作，而非游戏",
  "This setup has no GPU acceleration or passthrough. It is an ideal home for documents, spreadsheets and Windows-only work apps, but a poor fit for gaming or demanding graphics work.":
    "此方案没有 GPU 加速或直通。它是文档、电子表格和 Windows 专属工作应用的理想归宿，但不适合游戏或高要求的图形工作。",
  "Where the manual lives": "手册在哪里",
  "Read the Omarchy manual before you install anything, then follow the setup steps in order.":
    "在安装任何东西之前，请先阅读 Omarchy 手册，然后按顺序完成安装步骤。",
  "Set up Windows": "设置 Windows",
};

const FILLER = "此处为占位译文用于核对替换是否真正落地本段应当完全没有英文残留";

function fakeTranslate(text) {
  const key = String(text).replace(/\s+/g, " ").trim();
  if (Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
  const want = Math.max(2, Math.round(key.length * 0.45));
  let out = "";
  while (out.length < want) out += FILLER;
  return out.slice(0, want);
}

const stub = (dict, filler, mode) => {
  const norm = (t) => String(t).replace(/\s+/g, " ").trim();
  const tr = (t) => {
    const k = norm(t);
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    const want = Math.max(2, Math.round(k.length * 0.45));
    let out = "";
    while (out.length < want) out += filler;
    return out.slice(0, want);
  };
  const store = { displayMode: mode, scope: "full", serviceOn: false, engine: "deepseek" };
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

// Every host that still reads as English after a replace-mode run is a failure.
function audit() {
  const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const han = (t) => (norm(t).match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = (t) => (norm(t).match(/[A-Za-z]{3,}/g) || []).length;
  // a run of 6+ consecutive English words = an untranslated sentence,
  // as opposed to proper nouns kept inside a Chinese sentence
  const englishRun = (t) => /(?:[A-Za-z][A-Za-z'’-]*[ ,]+){5,}[A-Za-z]/.test(norm(t));
  const out = { trNodes: 0, englishLeft: [], mixed: [], echoKept: [], swapped: 0 };
  out.trNodes = document.querySelectorAll(".pbt-tr").length;
  // bilingual: a translation bar must never be a second copy of its English host
  out.doubleEnglish = [...document.querySelectorAll(".pbt-tr")]
    .map((tr) => norm(tr.querySelector(".pbt-tr-text")?.textContent))
    .filter((t) => t && han(t) === 0 && latinWords(t) >= 2);
  for (const el of document.querySelectorAll(".pbt-text-swap, .pbt-host, .pbt-skip")) {
    const txt = norm(el.innerText || el.textContent);
    if (!txt) continue;
    const src = norm(el.dataset.pbtOrigText || "");
    const info = {
      tag: el.tagName.toLowerCase(),
      state: el.dataset.pbtState || "",
      reason: el.dataset.pbtSkipReason || el.dataset.pbtFailReason || "",
      text: txt.slice(0, 90),
    };
    if (el.classList.contains("pbt-text-swap")) out.swapped += 1;
    if (el.dataset.pbtState === "skip") {
      if (latinWords(txt) >= 1 && han(txt) === 0) out.echoKept.push(info);
      continue;
    }
    if (han(txt) === 0 && latinWords(txt) >= 3) out.englishLeft.push(info);
    else if (han(txt) > 0 && src && englishRun(txt)) out.mixed.push(info);
  }
  // sentence-shaped English anywhere in the article body
  for (const el of document.querySelectorAll(".shell p, .shell h2, .shell h3, .shell span")) {
    if (el.querySelector("p,h2,h3,span")) continue;
    const txt = norm(el.innerText || el.textContent);
    if (han(txt) === 0 && englishRun(txt)) {
      out.englishLeft.push({ tag: el.tagName.toLowerCase(), state: el.dataset.pbtState || "none", reason: "uncollected-or-skipped", text: txt.slice(0, 90) });
    }
  }
  return out;
}

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || "/usr/local/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 440, height: 956, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(stub, DICT, FILLER, MODE);
  await page.goto("file://" + FIXTURE, { waitUntil: "load" });

  await page.addStyleTag({ content: fs.readFileSync(path.join(REPO, "content.css"), "utf8") });
  await page.screenshot({ path: path.join(OUT, `before-${TAG}.png`), fullPage: true });

  await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, "shared.js"), "utf8") });
  await page.addScriptTag({ content: fs.readFileSync(path.join(REPO, "content.js"), "utf8") });
  await page.waitForFunction("typeof window.__pbtOnMsg === 'function'", { timeout: 5000 });

  await page.evaluate(
    () => new Promise((res) => window.__pbtOnMsg({ type: "PBT_TRANSLATE", scope: "full" }, null, res))
  );
  // let the miss sweep retry anything marked fail
  await new Promise((r) => setTimeout(r, 3500));

  const report = await page.evaluate(audit);
  report.requested = await page.evaluate(() => window.__pbtCalls.length);
  await page.screenshot({ path: path.join(OUT, `after-${TAG}.png`), fullPage: true });
  await browser.close();

  const fail =
    MODE === "replace"
      ? report.englishLeft.length > 0 || report.trNodes > 0 || report.mixed.length > 0
      : report.trNodes === 0 || report.doubleEnglish.length > 0;
  console.log(`mode=${MODE}`);
  console.log(JSON.stringify(report, null, 2));
  console.log(fail ? "GATE: FAIL" : "GATE: PASS");
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
