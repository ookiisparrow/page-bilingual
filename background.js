importScripts("shared.js");
try { importScripts("local-key.js"); } catch (e) { /* phone packs omit this */ }

const MENU = { page: "pbt-translate-page", restore: "pbt-show-original" };
let activeRoute = "deepseek";

function syncServiceBadge(on) {
  try {
    chrome.action.setBadgeText({ text: on ? "ON" : "" });
    if (on) chrome.action.setBadgeBackgroundColor({ color: "#000000" });
    chrome.action.setTitle({ title: on ? "双语网页翻译（服务开）" : "双语网页翻译" });
  } catch (e) { /* MV3 action optional */ }
}

chrome.storage.onChanged.addListener((chg, area) => {
  if (area === "local" && chg.serviceOn) syncServiceBadge(!!chg.serviceOn.newValue);
});
chrome.storage.local.get(["serviceOn"], (s) => syncServiceBadge(!!s.serviceOn));

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["serviceOn", "engine", "deepseekModel", "deepseekApiKey", "deeplApiKey"], (s) => {
    syncServiceBadge(!!s.serviceOn);
    const patch = {};
    // Keep cursor / bridge / deepl; only coerce unset / legacy glm / auto → deepseek
    if (!s.engine || s.engine === "glm" || s.engine === "auto") patch.engine = "deepseek";
    if (!s.deepseekModel || s.deepseekModel === "deepseek-chat") patch.deepseekModel = "deepseek-flash";
    if (!s.deepseekApiKey && typeof PBT_LOCAL_DEEPSEEK_KEY === "string" && PBT_LOCAL_DEEPSEEK_KEY) patch.deepseekApiKey = PBT_LOCAL_DEEPSEEK_KEY;
    if (!s.deeplApiKey && typeof PBT_LOCAL_DEEPL_KEY === "string" && PBT_LOCAL_DEEPL_KEY) patch.deeplApiKey = PBT_LOCAL_DEEPL_KEY;
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.page, title: "翻译本页", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU.restore, title: "显示原文", contexts: ["page"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === MENU.page) send(tab.id, { type: "PBT_TRANSLATE" });
  if (info.menuItemId === MENU.restore) send(tab.id, { type: "PBT_RESTORE" });
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "toggle-translate") send(tab.id, { type: "PBT_TOGGLE" });
  if (command === "translate-full-page") send(tab.id, { type: "PBT_TRANSLATE" });
});

function send(tabId, payload) {
  chrome.tabs.sendMessage(tabId, payload).catch(() =>
    chrome.scripting
      .executeScript({ target: { tabId }, files: ["shared.js", "content.js"] })
      .then(() => chrome.tabs.sendMessage(tabId, payload))
      .catch(() => {})
  );
}

const isCursorEngine = (engine) => /^(bridge|cursor)$/i.test(String(engine || ""));
const isDeepLEngine = (engine) => /^deepl$/i.test(String(engine || ""));

async function readErrorLog() {
  const data = await chrome.storage.local.get([PBT.ERROR_LOG_KEY]);
  return Array.isArray(data[PBT.ERROR_LOG_KEY]) ? data[PBT.ERROR_LOG_KEY] : [];
}

/** Ring buffer in storage.local; best-effort mirror to the local Cursor bridge dump. */
async function appendErrorLog(entry) {
  const row = {
    t: Date.now(),
    kind: PBT.classifyError(entry?.message),
    message: String(entry?.message || "").slice(0, 400),
    source: String(entry?.source || "background").slice(0, 40),
    engine: String(entry?.engine || activeRoute || "").slice(0, 20),
    host: String(entry?.host || "").slice(0, 120),
    itemCount: Number(entry?.itemCount) || 0,
    status: entry?.status,
  };
  try {
    const list = (await readErrorLog()).concat(row).slice(-PBT.ERROR_LOG_CAP);
    await chrome.storage.local.set({ [PBT.ERROR_LOG_KEY]: list });
    const s = await PBT.loadAll();
    const base = String(s.cursorApiUrl || PBT.DEFAULTS.cursorApiUrl).replace(/\/v1\/chat\/completions\/?$/i, "").replace(/\/$/, "");
    if (base) fetch(`${base}/debug/log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) }).catch(() => {});
  } catch (e) {
    console.warn("[pbt] error log write failed", e);
  }
  return row;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const jobs = {
    PBT_HAS_KEY: async () => {
      const s = await PBT.loadAll();
      const cursor = isCursorEngine(s.engine);
      const deepl = isDeepLEngine(s.engine);
      const engine = cursor ? "cursor" : deepl ? "deepl" : "deepseek";
      const hasKey = cursor || (deepl ? Boolean(s.deeplApiKey) : Boolean(s.deepseekApiKey));
      return { ok: true, hasKey, engine };
    },
    PBT_GET_ERROR_LOG: async () => ({ ok: true, entries: await readErrorLog() }),
    PBT_CLEAR_ERROR_LOG: async () => {
      await chrome.storage.local.set({ [PBT.ERROR_LOG_KEY]: [] });
      return { ok: true };
    },
    PBT_LOG_ERROR: async () => ({ ok: true, entry: await appendErrorLog({ ...msg, source: msg.source || "content" }) }),
    PBT_BATCH: async () => {
      const items = msg.items || [];
      try {
        return { ok: true, items: await translateBatch(items, msg.targetLang, msg.page || {}, msg.properNouns || []), route: activeRoute };
      } catch (err) {
        const message = String(err.message || err);
        await appendErrorLog({ message, source: "PBT_BATCH", engine: activeRoute, host: msg.page?.host, itemCount: items.length, status: err.status });
        return { ok: false, error: message };
      }
    },
  };
  const job = jobs[msg?.type];
  if (!job) return;
  job().then(reply, (err) => reply({ ok: false, error: String(err.message || err) }));
  return true;
});

async function fetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return { res, data: await res.json().catch(() => ({})) };
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`请求超时 ${ms / 1000}s（检查网络/代理或 Key）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonArray(text) {
  const s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(s);
    const arr = Array.isArray(parsed) ? parsed : parsed?.segments || parsed?.items || parsed?.translations;
    if (Array.isArray(arr)) return arr;
  } catch (_) { /* fall through */ }
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON 数组。");
  return JSON.parse(s.slice(start, end + 1));
}

const rowText = (r) => (r == null ? "" : String(r.text ?? r.translatedText ?? r.translation ?? r.targetText ?? ""));

function buildPrompt(targetLang, items, page, properNouns) {
  const zh = /^zh\b/i.test(targetLang);
  const where = [page?.host, page?.title].filter(Boolean).join(" — ");
  return (
    `把下面网页段落翻译成「${targetLang}」。\n` +
    (zh ? "必须是中文，禁止回英文、禁止中英混抄整句。\n" : `Output language must be ${targetLang}, not the source language.\n`) +
    "人名与品牌名原样保留，勿翻译、勿音译。\n" +
    "§N§…§/N§ 成对原样保留，内部照译，不可增删。\n" +
    `只输出 [{"id":"...","text":"译文"}]，id/顺序/数量与输入一致。\n` +
    (where ? `页面: ${where}\n` : "") +
    (properNouns.length ? "白名单:\n" + properNouns.slice(0, 80).map((t) => `- ${t}`).join("\n") + "\n" : "") +
    `Items: ${JSON.stringify(items.map((x) => ({ id: String(x.id), text: String(x.text ?? "") })))}`
  );
}

/** id-first; same-length order fallback for models that drop or mangle ids. */
function align(items, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map(list.filter((r) => r?.id != null && r.id !== "" && rowText(r)).map((r) => [String(r.id), rowText(r)]));
  return items.map((x, i) => ({
    id: x.id,
    text: byId.get(String(x.id)) || (list.length === items.length || !byId.size ? rowText(list[i]) : ""),
  }));
}

/** One OpenAI-compatible chat-completions call (DeepSeek or Cursor bridge). */
async function chatCompletions(s, items, page, cfg) {
  const apiKey = String(cfg.apiKey || "").trim();
  if (cfg.requireKey && !apiKey) throw new Error(`未填写 ${cfg.label} API Key，请到选项页设置。`);
  const messages = [
    {
      role: "system",
      content:
        "只输出 JSON 数组 [{id,text}]，不要 markdown。",
    },
    { role: "user", content: buildPrompt(s.targetLang, items, page, s.properNouns) },
  ];
  const call = async (body) => {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const { res, data } = await fetchJson(cfg.url, { method: "POST", headers, body: JSON.stringify(body) }, cfg.timeoutMs);
    if (!res.ok) {
      let msg = data.error?.message || data.error || `${cfg.label} HTTP ${res.status}`;
      if (typeof msg !== "string") msg = JSON.stringify(msg);
      if (/insufficient\s*balance/i.test(msg)) msg = "DeepSeek 余额不足，请充值或更换 API Key";
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
  };
  let data;
  try {
    data = await call({ model: cfg.model, temperature: 0.2, thinking: { type: "disabled" }, messages });
  } catch (err) {
    if (err.status !== 400 && !/thinking/i.test(String(err.message || ""))) throw err;
    data = await call({ model: cfg.model, temperature: 0.2, messages });
  }
  const msg = data.choices?.[0]?.message || {};
  const text = msg.content || msg.reasoning_content || data.output_text || data.text || JSON.stringify(data);
  return align(items, extractJsonArray(text));
}

// Ablation switch (test builds fill this; empty in the shipped file). See docs/ablation-1.4.56.md.
const ABLATE = new Set();

/** One retry after a short backoff, then give up (content keeps the source and logs the error). */
async function translateHttp(s, items, page, cfg) {
  try {
    return await chatCompletions(s, items, page, cfg);
  } catch (err) {
    if (ABLATE.has("retry")) throw err;
    await new Promise((r) => setTimeout(r, 600));
    return chatCompletions(s, items, page, cfg);
  }
}

function deeplTargetLang(targetLang) {
  const t = String(targetLang || "zh-CN").toUpperCase();
  if (/^ZH(-TW|_TW|HANT)/.test(t)) return "ZH-HANT";
  if (/^ZH/.test(t)) return "ZH";
  return t.slice(0, 2);
}

/** Plaintext DeepL translate; § placeholders preserved, no layout HTML. */
async function translateDeepL(s, items) {
  const apiKey = String(s.deeplApiKey || "").trim();
  if (!apiKey) throw new Error("未填写 DeepL API Key，请到选项页设置。");
  const body = { text: items.map((x) => String(x.text ?? "")), target_lang: deeplTargetLang(s.targetLang) };
  const bases = apiKey.endsWith(":fx")
    ? ["https://api-free.deepl.com/v2/translate", "https://api.deepl.com/v2/translate"]
    : ["https://api.deepl.com/v2/translate", "https://api-free.deepl.com/v2/translate"];
  let lastErr;
  for (const url of bases) {
    try {
      const { res, data } = await fetchJson(
        url,
        { method: "POST", headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${apiKey}` }, body: JSON.stringify(body) },
        28000
      );
      if (!res.ok) {
        const msg = data.message || data.error || `DeepL HTTP ${res.status}`;
        lastErr = Object.assign(new Error(msg), { status: res.status });
        if (res.status === 403) continue;
        throw lastErr;
      }
      const rows = data.translations || [];
      return items.map((x, i) => ({ id: x.id, text: String(rows[i]?.text ?? "") }));
    } catch (err) {
      lastErr = err;
      if (err.status === 403) continue;
      throw err;
    }
  }
  throw lastErr || new Error("DeepL 请求失败");
}

/** One retry after a short backoff for DeepL. */
async function translateDeepLHttp(s, items) {
  try {
    return await translateDeepL(s, items);
  } catch (err) {
    if (ABLATE.has("retry")) throw err;
    await new Promise((r) => setTimeout(r, 600));
    return translateDeepL(s, items);
  }
}

async function translateBatch(items, targetLang, page, properNouns) {
  globalThis.__pbtBgCalls = (globalThis.__pbtBgCalls || 0) + 1;
  if (!items.length) return [];
  const s = await PBT.loadAll();
  if (!s.deepseekApiKey && typeof PBT_LOCAL_DEEPSEEK_KEY === "string") s.deepseekApiKey = PBT_LOCAL_DEEPSEEK_KEY;
  if (!s.deeplApiKey && typeof PBT_LOCAL_DEEPL_KEY === "string") s.deeplApiKey = PBT_LOCAL_DEEPL_KEY;
  s.targetLang = targetLang || s.targetLang;
  s.properNouns = Array.isArray(properNouns) ? properNouns : [];
  if (isCursorEngine(s.engine)) {
    activeRoute = "cursor";
    const cfg = {
      url: s.cursorApiUrl || PBT.DEFAULTS.cursorApiUrl,
      model: s.cursorModel || PBT.DEFAULTS.cursorModel,
      apiKey: s.cursorApiKey || "bridge",
      label: "Cursor",
      timeoutMs: 95000,
    };
    return translateHttp(s, items, page, cfg);
  }
  if (isDeepLEngine(s.engine)) {
    activeRoute = "deepl";
    return translateDeepLHttp(s, items);
  }
  activeRoute = "deepseek";
  const cfg = {
    url: s.deepseekApiUrl || PBT.DEFAULTS.deepseekApiUrl,
    model: s.deepseekModel || PBT.DEFAULTS.deepseekModel,
    apiKey: s.deepseekApiKey,
    label: "DeepSeek",
    requireKey: true,
    timeoutMs: 28000,
  };
  return translateHttp(s, items, page, cfg);
}
