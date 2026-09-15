/* Public settings + language list. API keys never go to content scripts. */
const PBT = {
  DEFAULTS: {
    targetLang: "zh-CN",
    engine: "deepseek",
    deepseekApiUrl: "https://api.deepseek.com/chat/completions",
    deepseekModel: "deepseek-flash",
    cursorApiUrl: "http://127.0.0.1:47821/v1/chat/completions",
    cursorModel: "composer-2.5-fast",
    serviceOn: false,
    excludeCss: "",
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

  /** Durable proper-noun whitelist (not the segment translation cache). */
  PN_STORE_KEY: "pbt.properNouns.v1",
  PN_CAP: 400,
  /** Bump to re-merge PN_SEED into existing installs without wiping user pins. */
  PN_SEED_REV: 2,
  PN_SEED: [
    // OS / hardware / tech
    "Windows",
    "Linux",
    "macOS",
    "Mac",
    "GitHub",
    "Git",
    "Omarchy",
    "CPU",
    "GPU",
    "RAM",
    "SSD",
    "HDD",
    "USB",
    "Wi-Fi",
    "Bluetooth",
    "Chrome",
    "Firefox",
    "Edge",
    "Safari",
    "DeepSeek",
    "OpenAI",
    "Cursor",
    "Docker",
    "Kubernetes",
    "npm",
    "Node.js",
    "Python",
    "JavaScript",
    "TypeScript",
    "Rust",
    "React",
    "AWS",
    "Azure",
    "DigitalOcean",
    "Office",
    "Microsoft",
    "Apple",
    "Google",
    "Intel",
    "NVIDIA",
    "AMD",
    "API",
    "HTTP",
    "HTTPS",
    "JSON",
    "HTML",
    "CSS",
    "SQL",
    "Redis",
    "Postgres",
    "PostgreSQL",
    "Ubuntu",
    "Debian",
    "Arch",
    "Neovim",
    "VS Code",
    "PowerShell",
    "WSL",
    "Cloudflare",
    "Vercel",
    "Stripe",
    "ChatGPT",
    "Claude",
    "Gemini",
    "PyTorch",
    "CUDA",
    "Hyprland",
    "Wayland",
    "GNOME",
    "KDE",
    "iPhone",
    "iPad",
    "Android",
    "iOS",
    "YouTube",
    "Discord",
    "Slack",
    // Common brands / products (keep Latin as-is)
    "Nike",
    "Adidas",
    "Tesla",
    "SpaceX",
    "Spotify",
    "Netflix",
    "Instagram",
    "Facebook",
    "Meta",
    "Twitter",
    "TikTok",
    "LinkedIn",
    "WhatsApp",
    "Telegram",
    "WeChat",
    "Airbnb",
    "Uber",
    "Lyft",
    "PayPal",
    "Visa",
    "Mastercard",
    "Adobe",
    "Photoshop",
    "Notion",
    "Figma",
    "Zoom",
    "Dropbox",
    "Shopify",
    "Salesforce",
    "Oracle",
    "IBM",
    "Samsung",
    "Sony",
    "LG",
    "Huawei",
    "Xiaomi",
    "Lenovo",
    "Dell",
    "HP",
    "ASUS",
    "Acer",
    "Qualcomm",
    "Broadcom",
    "Cisco",
    "Intel Arc",
    "GeForce",
    "Radeon",
    "PlayStation",
    "Xbox",
    "Nintendo",
    "Steam",
    "Epic Games",
    "Unreal Engine",
    "Unity",
    "Coca-Cola",
    "Pepsi",
    "Starbucks",
    "McDonald's",
    "IKEA",
    "Walmart",
    "Amazon",
    "Prime",
    "Kindle",
    "Alexa",
    "Siri",
    "Copilot",
    "Bing",
    "Wikipedia",
    "Reddit",
    "Pinterest",
    "Snapchat",
    "Twitch",
    "Patreon",
    "Substack",
    "Medium",
    "WordPress",
    "Shopify",
    "Squarespace",
    "Webflow",
    "GitLab",
    "Bitbucket",
    "Jira",
    "Confluence",
    "Trello",
    "Asana",
    "Linear",
    "Notion",
    "Obsidian",
    "JetBrains",
    "IntelliJ",
    "PyCharm",
    "WebStorm",
    "Homebrew",
    "systemd",
    "Nginx",
    "Apache",
    "MySQL",
    "MongoDB",
    "Elasticsearch",
    "Kafka",
    "Grafana",
    "Prometheus",
    "Datadog",
    "Sentry",
    "Hugging Face",
    "Anthropic",
    "Perplexity",
    "Midjourney",
    "Stable Diffusion",
    "LangChain",
    "TensorFlow",
    "Keras",
    "scikit-learn",
    "pandas",
    "NumPy",
  ],

  pnNormKey(term) {
    return String(term || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  },

  pnSanitizeTerm(term) {
    const t = String(term || "").trim().replace(/\s+/g, " ");
    return !t || t.length > 64 || /[\n\r]/.test(t) ? "" : t;
  },

  /** Build / merge store blob. Evicts oldest non-pinned when over cap. */
  pnEnsureStore(raw, now = Date.now()) {
    const store = raw && typeof raw === "object" ? raw : {};
    const terms = store.terms && typeof store.terms === "object" ? { ...store.terms } : {};
    let seeded = !!store.seeded;
    let seedRev = Number(store.seedRev) || 0;
    if (!seeded || seedRev < PBT.PN_SEED_REV) {
      for (const term of PBT.PN_SEED) {
        const key = PBT.pnNormKey(term);
        if (!key || terms[key]) continue;
        terms[key] = { term, pinned: false, lastAt: now, seed: true };
      }
      seeded = true;
      seedRev = PBT.PN_SEED_REV;
    }
    PBT.pnTrimTerms(terms);
    return { seeded, seedRev, terms };
  },

  pnTrimTerms(terms, cap = PBT.PN_CAP) {
    const keys = Object.keys(terms);
    if (keys.length <= cap) return;
    const ranked = keys
      .map((k) => ({ k, e: terms[k] }))
      .sort((a, b) => {
        const ap = a.e?.pinned ? 1 : 0;
        const bp = b.e?.pinned ? 1 : 0;
        if (ap !== bp) return ap - bp; // unpinned first
        return (a.e?.lastAt || 0) - (b.e?.lastAt || 0); // oldest first
      });
    let over = keys.length - cap;
    for (const row of ranked) {
      if (over <= 0) break;
      if (row.e?.pinned) continue;
      delete terms[row.k];
      over -= 1;
    }
  },

  pnTermList(store) {
    const terms = store?.terms || {};
    return Object.values(terms)
      .map((e) => e?.term)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  },

  async pnLoad() {
    try {
      const data = await chrome.storage.local.get(PBT.PN_STORE_KEY);
      const next = PBT.pnEnsureStore(data[PBT.PN_STORE_KEY]);
      const prev = data[PBT.PN_STORE_KEY];
      const needWrite =
        !prev ||
        !prev.seeded ||
        (Number(prev.seedRev) || 0) < PBT.PN_SEED_REV ||
        Object.keys(prev.terms || {}).length !== Object.keys(next.terms).length;
      if (needWrite) await chrome.storage.local.set({ [PBT.PN_STORE_KEY]: next });
      return next;
    } catch {
      return PBT.pnEnsureStore(null);
    }
  },

  async pnSave(store) {
    const next = PBT.pnEnsureStore(store);
    await chrome.storage.local.set({ [PBT.PN_STORE_KEY]: next });
    return next;
  },

  async pnAdd(term, { pinned = true } = {}) {
    const clean = PBT.pnSanitizeTerm(term);
    if (!clean) return null;
    const store = await PBT.pnLoad();
    const key = PBT.pnNormKey(clean);
    const prev = store.terms[key];
    store.terms[key] = {
      term: clean,
      pinned: pinned || !!prev?.pinned,
      lastAt: Date.now(),
      seed: prev?.seed && prev.term === clean ? true : undefined,
    };
    if (!store.terms[key].seed) delete store.terms[key].seed;
    return PBT.pnSave(store);
  },

  async pnRemove(term) {
    const key = PBT.pnNormKey(term);
    if (!key) return PBT.pnLoad();
    const store = await PBT.pnLoad();
    delete store.terms[key];
    return PBT.pnSave(store);
  },

  /** Structured failure log for agents / options export (no secrets). */
  ERROR_LOG_KEY: "pbtErrorLog",
  ERROR_LOG_CAP: 100,

  ERROR_KINDS: [
    [/Extension context invalidated/i, "extension_context_invalidated"],
    [/未填写.*API Key|missing.*key|no api key/i, "auth_missing_key"],
    [/insufficient\s*balance|余额不足/i, "auth_balance"],
    [/agent login|not logged in|CURSOR_API_KEY|Authentication|Unauthorized|401/i, "auth_cli_or_key"],
    [/Could not start Cursor CLI|cursor-agent|Install: curl/i, "bridge_cli_missing"],
    [/Cursor CLI timed out|bridge.*超时|请求超时/i, "timeout"],
    [/Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|网络/i, "network"],
    [/429|rate.?limit|HTTP 429/i, "rate_limit"],
    [/HTTP 5\d\d|502|503|504/i, "http_5xx"],
    [/JSON|parse|没有返回 JSON/i, "parse_json"],
    [/扩展后台超时|翻译引擎无响应/i, "background_timeout"],
    [/Cursor bridge|Cursor CLI/i, "bridge_error"],
    [/DeepSeek/i, "deepseek_error"],
  ],

  classifyError(message) {
    const m = String(message || "");
    return (PBT.ERROR_KINDS.find(([re]) => re.test(m)) || [null, "unknown"])[1];
  },
};
