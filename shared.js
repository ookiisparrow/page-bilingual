/* Public settings + language list. API keys never go to content scripts. */
const PBT = {
  DEFAULTS: {
    targetLang: "zh-CN",
    engine: "deepseek",
    deepseekApiUrl: "https://api.deepseek.com/chat/completions",
    deepseekModel: "deepseek-flash",
    cursorApiUrl: "http://127.0.0.1:47821/v1/chat/completions",
    cursorModel: "composer-2.5-fast",
    displayMode: "replace",
    serviceOn: false,
    scope: "full",
    hoverEnabled: true,
    hoverKey: "Alt",
    selectionEnabled: true,
    inputEnabled: true,
    inputGesture: "triple-space",
    excludeCss: "",
    trSize: "0.98em",
    trColor: "inherit",
    trOpacity: "1",
  },

  SECRET_KEYS: ["deepseekApiKey", "cursorApiKey"],

  LANGS: [
    ["zh-CN", "简体中文"],
    ["zh-TW", "繁体中文"],
    ["en", "英语"],
    ["ja", "日语"],
    ["ko", "韩语"],
    ["es", "西班牙语"],
    ["fr", "法语"],
    ["de", "德语"],
    ["pt", "葡萄牙语"],
    ["ru", "俄语"],
    ["it", "意大利语"],
    ["vi", "越南语"],
    ["th", "泰语"],
    ["ar", "阿拉伯语"],
    ["hi", "印地语"],
    ["id", "印尼语"],
  ],

  publicKeys() {
    return Object.keys(PBT.DEFAULTS);
  },

  async settings() {
    const stored = await chrome.storage.local.get(PBT.publicKeys());
    const out = { ...PBT.DEFAULTS, ...stored };
    for (const k of PBT.SECRET_KEYS) delete out[k];
    return out;
  },

  async loadAll() {
    const keys = [...PBT.publicKeys(), ...PBT.SECRET_KEYS];
    const stored = await chrome.storage.local.get(keys);
    return { ...PBT.DEFAULTS, deepseekApiKey: "", cursorApiKey: "", ...stored };
  },

  async save(patch) {
    await chrome.storage.local.set(patch);
  },

  /** Structured failure log for agents / options export (no secrets). */
  ERROR_LOG_KEY: "pbtErrorLog",
  ERROR_LOG_CAP: 100,

  classifyError(message) {
    const m = String(message || "");
    if (/Extension context invalidated/i.test(m)) return "extension_context_invalidated";
    if (/未填写.*API Key|missing.*key|no api key/i.test(m)) return "auth_missing_key";
    if (/insufficient\s*balance|余额不足/i.test(m)) return "auth_balance";
    if (/agent login|not logged in|CURSOR_API_KEY|Authentication|Unauthorized|401/i.test(m))
      return "auth_cli_or_key";
    if (/Could not start Cursor CLI|cursor-agent|Install: curl/i.test(m)) return "bridge_cli_missing";
    if (/Cursor CLI timed out|bridge.*超时|请求超时/i.test(m)) return "timeout";
    if (/Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|网络/i.test(m)) return "network";
    if (/429|rate.?limit|HTTP 429/i.test(m)) return "rate_limit";
    if (/HTTP 5\d\d|502|503|504/i.test(m)) return "http_5xx";
    if (/JSON|parse|没有返回 JSON/i.test(m)) return "parse_json";
    if (/仍返回英文|未译成中文/i.test(m)) return "model_still_english";
    if (/empty/i.test(m)) return "empty_collection";
    if (/扩展后台超时|翻译引擎无响应/i.test(m)) return "background_timeout";
    if (/Cursor bridge|Cursor CLI/i.test(m)) return "bridge_error";
    if (/DeepSeek/i.test(m)) return "deepseek_error";
    return "unknown";
  },
};
