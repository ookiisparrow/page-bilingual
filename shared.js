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
};
