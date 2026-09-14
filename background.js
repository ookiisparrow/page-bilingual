importScripts("shared.js");
try { importScripts("local-key.js"); } catch (e) { /* phone packs omit this */ }

const MENU = {
  page: "pbt-translate-page",
  restore: "pbt-show-original",
  selection: "pbt-translate-selection",
};

let activeRoute = "auto";


function syncServiceBadge(on) {
  try {
    const text = on ? "ON" : "";
    chrome.action.setBadgeText({ text });
    if (on) chrome.action.setBadgeBackgroundColor({ color: "#000000" });
    chrome.action.setTitle({ title: on ? "双语网页翻译（服务开）" : "双语网页翻译" });
  } catch (e) { /* MV3 action optional */ }
}

chrome.storage.onChanged.addListener((chg, area) => {
  if (area !== "local" || !Object.prototype.hasOwnProperty.call(chg, "serviceOn")) return;
  syncServiceBadge(!!chg.serviceOn.newValue);
});

chrome.storage.local.get(["serviceOn"], (s) => {
  syncServiceBadge(!!s.serviceOn);
});


chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["serviceOn"], (s) => syncServiceBadge(!!s.serviceOn));
  if (typeof PBT_LOCAL_DEEPSEEK_KEY === "string" && PBT_LOCAL_DEEPSEEK_KEY) {
    chrome.storage.local.get(["deepseekApiKey", "engine"], (s) => {
      const patch = { deepseekModel: "deepseek-flash" };
      // Phone / local-key default stays DeepSeek unless user already chose cursor/bridge
      if (!s.engine || s.engine === "glm" || s.engine === "auto") patch.engine = "deepseek";
      if (!s.deepseekApiKey) patch.deepseekApiKey = PBT_LOCAL_DEEPSEEK_KEY;
      chrome.storage.local.set(patch);
    });
  }
  chrome.storage.local.get(["engine", "deepseekModel", "displayMode"], (s) => {
    const patch = {};
    // Keep cursor / bridge; only coerce unset / legacy glm / auto → deepseek
    if (!s.engine || s.engine === "glm" || s.engine === "auto") patch.engine = "deepseek";
    if (!s.deepseekModel || s.deepseekModel === "deepseek-chat") patch.deepseekModel = "deepseek-flash";
    if (!s.displayMode || s.displayMode === "translation" || s.displayMode === "bilingual") patch.displayMode = "replace";
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "翻译本页", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.restore, title: "显示原文", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.selection, title: "翻译选中文字", contexts: ["selection"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU.page) send(tab.id, { type: "PBT_TRANSLATE" });
  if (info.menuItemId === MENU.restore) send(tab.id, { type: "PBT_RESTORE" });
  if (info.menuItemId === MENU.selection) send(tab.id, { type: "PBT_SELECTION" });
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "toggle-translate") send(tab.id, { type: "PBT_TOGGLE" });
  if (command === "translate-full-page") send(tab.id, { type: "PBT_TRANSLATE", scope: "full" });
  if (command === "translate-hovered") send(tab.id, { type: "PBT_HOVER" });
  if (command === "translate-input") send(tab.id, { type: "PBT_INPUT" });
});

function normalizeEngine(engine) {
  const e = String(engine || "deepseek").toLowerCase();
  if (e === "bridge" || e === "cursor") return "cursor";
  return "deepseek";
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "PBT_HAS_KEY") {
    PBT.loadAll()
      .then((s) => {
        const engine = normalizeEngine(s.engine);
        // Cursor bridge uses logged-in agent; key optional
        const hasKey =
          engine === "cursor"
            ? true
            : Boolean(s.deepseekApiKey || s.cursorApiKey);
        reply({ ok: true, hasKey, engine });
      })
      .catch((err) => reply({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (msg?.type !== "PBT_BATCH") return;
  translateBatch(msg.items || [], msg.targetLang, msg.glossary || [], msg.page || {}, msg.properNouns || [])
    .then((items) => reply({ ok: true, items, route: activeRoute }))
    .catch((err) => reply({ ok: false, error: String(err.message || err) }));
  return true;
});

function send(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() => {
    Promise.all([
      chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }),
      chrome.scripting.executeScript({ target: { tabId }, files: ["shared.js", "content.js"] }),
    ])
      .then(() => chrome.tabs.sendMessage(tabId, payload))
      .catch(() => {});
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts, ms) {
  const t = ms || 25000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), t);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`请求超时 ${t / 1000}s（检查网络/代理或 Key）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonArray(text) {
  let s = String(text || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.segments)) return parsed.segments;
    if (Array.isArray(parsed?.items)) return parsed.items;
    if (Array.isArray(parsed?.translations)) return parsed.translations;
  } catch (_) { /* fall through */ }
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 数组。");
  return JSON.parse(s.slice(start, end + 1));
}

function rowText(r) {
  if (r == null) return "";
  return String(r.text ?? r.translatedText ?? r.translation ?? r.targetText ?? "");
}


function buildPrompt(targetLang, items, glossary, page, properNouns) {
  const gloss =
    !glossary?.length
      ? ""
      : "固定术语（优先）:\n" + glossary.map((g) => `- ${g.src} => ${g.dst}`).join("\n") + "\n";
  const pnList = Array.isArray(properNouns)
    ? properNouns.map((t) => String(t || "").trim()).filter(Boolean)
    : [];
  const pn =
    !pnList.length
      ? ""
      : "专有名词白名单（原样保留，勿翻译、勿音译）:\n" +
        pnList
          .slice(0, 80)
          .map((t) => `- ${t}`)
          .join("\n") +
        "\n";
  const where = [page?.host, page?.title].filter(Boolean).join(" — ") || "";
  const zh = /^zh\b/i.test(targetLang);
  return (
    `把下面网页段落翻译成「${targetLang}」。\n` +
    (zh
      ? "译文必须是中文，禁止原样返回英文，禁止中英混抄整句。\n"
      : `Output language must be ${targetLang}, not the source language.\n`) +
    "专有名词、代码、数字可保留。白名单中的词必须原样保留。\n" +
    `只输出 JSON 数组：[{"id":"...","text":"译文"}]。id/顺序/数量必须与输入一致。\n` +
    (where ? `页面: ${where}\n` : "") +
    gloss +
    pn +
    `Items: ${JSON.stringify(items.map((x) => ({ id: String(x.id), text: String(x.text ?? "") })))}`
  );
}

function align(items, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map();
  for (const r of list) {
    if (r == null || r.id == null || r.id === "") continue;
    const t = rowText(r);
    if (t) byId.set(String(r.id), t);
  }
  return items.map((x, i) => {
    let text = byId.get(String(x.id)) ?? "";
    // ponytail: id 优先；缺 id / 错 id 且等长时按顺序兜底（前沿契约容错）
    if (!text && list.length === items.length) text = rowText(list[i]);
    else if (!text && list.length && !byId.size) text = rowText(list[i]);
    return { id: x.id, text };
  });
}

function isTransient(err) {
  const m = String(err?.message || err || "");
  return /429|500|502|503|504|rate|timeout|temporar|网络|fetch|Failed to fetch|HTTP 429|HTTP 5/i.test(m);
}

function rowLooksBadZh(src, dst) {
  const s = String(src || "");
  const d = String(dst || "");
  if (!d.trim()) return true;
  if (s.length < 12) return false;
  const sn = s.replace(/\s+/g, "");
  const dn = d.replace(/\s+/g, "");
  const almostSame = sn === dn || sn.toLowerCase() === dn.toLowerCase();
  if (almostSame) return true;
  const hasHan = /[\u4e00-\u9fff]/.test(d);
  if (hasHan) return false;
  // latin-dominant dst without Han → 未译成中文，触发 repair
  const latin = (d.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
  return dn.length > 0 && latin / dn.length >= 0.5;
}

/** Shared OpenAI-compatible chat-completions call (DeepSeek or Cursor bridge). */
async function chatCompletionsOnce(s, items, glossary, page, cfg) {
  const url = String(cfg.url || "").trim();
  const model = String(cfg.model || "").trim();
  const apiKey = String(cfg.apiKey || "").trim();
  const label = cfg.label || "API";
  if (cfg.requireKey && !apiKey) throw new Error(cfg.missingKeyMsg || `未填写 ${label} API Key，请到选项页设置。`);
  const messages = [
    {
      role: "system",
      content:
        "你是网页翻译器。只输出 JSON 数组 [{id,text}]，不要 markdown。目标语言必须是用户指定语言；若目标是中文，text 必须是中文。",
    },
    { role: "user", content: buildPrompt(s.targetLang, items, glossary, page, s.properNouns) },
  ];
  async function call(body) {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const { res, data } = await fetchJson(
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      cfg.timeoutMs || 28000
    );
    if (!res.ok) {
      let msg = data.error?.message || data.error || `${label} HTTP ${res.status}`;
      if (typeof msg !== "string") msg = JSON.stringify(msg);
      if (/insufficient\s*balance/i.test(msg)) msg = "DeepSeek 余额不足，请充值或更换 API Key";
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  let data;
  try {
    data = await call({
      model,
      temperature: 0.2,
      thinking: { type: "disabled" },
      messages,
    });
  } catch (err) {
    if (err.status === 400 || /thinking/i.test(String(err.message || ""))) {
      data = await call({ model, temperature: 0.2, messages });
    } else {
      throw err;
    }
  }
  const msg = data.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning_content || data.output_text || data.text || JSON.stringify(data);
  const aligned = align(items, extractJsonArray(text));
  return aligned.map((r) => ({ id: r.id, text: r.text }));
}

async function deepseekOnce(s, items, glossary, page) {
  return chatCompletionsOnce(s, items, glossary, page, {
    url: s.deepseekApiUrl || PBT.DEFAULTS.deepseekApiUrl,
    model: s.deepseekModel || "deepseek-flash",
    apiKey: s.deepseekApiKey,
    label: "DeepSeek",
    requireKey: true,
    missingKeyMsg: "未填写 DeepSeek API Key，请到选项页设置。",
    timeoutMs: 28000,
  });
}

async function cursorOnce(s, items, glossary, page) {
  return chatCompletionsOnce(s, items, glossary, page, {
    url: s.cursorApiUrl || PBT.DEFAULTS.cursorApiUrl || "http://127.0.0.1:47821/v1/chat/completions",
    model: s.cursorModel || PBT.DEFAULTS.cursorModel || "composer-2.5-fast",
    apiKey: s.cursorApiKey || "bridge",
    label: "Cursor",
    requireKey: false,
    timeoutMs: 95000,
  });
}

/** 带退避重试；大批失败则对半分治 */
async function translateHttp(s, items, glossary, page, depth, onceFn, failLabel) {
  const d = depth || 0;
  if (!items.length) return [];

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt) await sleep(400 * Math.pow(2, attempt - 1));
      const aligned = await onceFn(s, items, glossary, page);
      if (!/^zh\b/i.test(s.targetLang)) return aligned;

      const good = [];
      const badItems = [];
      aligned.forEach((row, i) => {
        const src = items[i];
        if (rowLooksBadZh(src?.text, row.text)) badItems.push(src);
        else good.push(row);
      });

      // 多数成功：好的留下，坏的单独再译（或对半分）
      if (badItems.length && badItems.length <= items.length * 0.5 && d < 3) {
        const repaired = await translateHttp(s, badItems, glossary, page, d + 1, onceFn, failLabel);
        const byId = new Map(repaired.map((r) => [String(r.id), r.text]));
        return items.map((it) => {
          const hit = good.find((g) => String(g.id) === String(it.id));
          if (hit?.text) return hit;
          return { id: it.id, text: byId.get(String(it.id)) || "" };
        }).filter((r) => r.text);
      }
      if (badItems.length > items.length * 0.5) {
        throw new Error("模型仍返回英文，未译成中文。");
      }
      return good.length ? good : aligned.filter((r) => r.text);
    } catch (err) {
      lastErr = err;
      // JSON/英文问题或大批：对半分治
      if (items.length >= 4 && d < 4 && (/JSON|英文|未译|parse/i.test(String(err.message || "")) || items.length > 6)) {
        const mid = Math.ceil(items.length / 2);
        const left = await translateHttp(s, items.slice(0, mid), glossary, page, d + 1, onceFn, failLabel);
        await sleep(200);
        const right = await translateHttp(s, items.slice(mid), glossary, page, d + 1, onceFn, failLabel);
        return left.concat(right);
      }
      if (!isTransient(err) || attempt === 2) break;
    }
  }
  throw lastErr || new Error(failLabel || "翻译失败");
}

async function translateBatch(items, targetLang, glossary, page, properNouns) {
  const s = await PBT.loadAll();
  if (!s.deepseekApiKey && typeof PBT_LOCAL_DEEPSEEK_KEY === "string") s.deepseekApiKey = PBT_LOCAL_DEEPSEEK_KEY;
  s.targetLang = targetLang || s.targetLang;
  s.properNouns = Array.isArray(properNouns) ? properNouns : [];
  if (!items.length) return [];

  const engine = normalizeEngine(s.engine);
  if (engine === "cursor") {
    activeRoute = "cursor";
    return await translateHttp(s, items, glossary, page, 0, cursorOnce, "Cursor bridge 翻译失败");
  }

  if (!s.deepseekApiKey) throw new Error("未填写 DeepSeek API Key，请到选项页设置。");
  activeRoute = "deepseek";
  return await translateHttp(s, items, glossary, page, 0, deepseekOnce, "DeepSeek 翻译失败");
}
