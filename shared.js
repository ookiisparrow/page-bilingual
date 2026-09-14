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

  /**
   * Title-case English words that are rarely person-name tokens.
   * Heuristic NER only — grow the durable list via 保留专名 when wrong.
   */
  PN_NAME_STOP: new Set(
    [
      "the", "a", "an", "and", "or", "but", "if", "then", "else", "when", "where", "what",
      "who", "whom", "whose", "which", "why", "how", "this", "that", "these", "those",
      "there", "here", "with", "from", "into", "onto", "over", "under", "about", "after",
      "before", "between", "during", "without", "within", "among", "against", "through",
      "across", "behind", "beyond", "above", "below", "until", "while", "because",
      "although", "though", "whether", "either", "neither", "both", "each", "every",
      "any", "all", "some", "many", "much", "more", "most", "other", "another", "such",
      "only", "own", "same", "so", "than", "too", "very", "just", "also", "not", "no",
      "yes", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
      "do", "does", "did", "will", "would", "can", "could", "should", "may", "might",
      "must", "shall", "to", "of", "in", "on", "at", "by", "for", "as", "up", "out",
      "off", "down", "new", "old", "good", "bad", "big", "small", "great", "first",
      "last", "next", "previous", "open", "source", "free", "soft", "hard", "real",
      "virtual", "mobile", "social", "media", "digital", "global", "local", "national",
      "international", "general", "special", "public", "private", "personal", "official",
      "original", "available", "online", "offline", "getting", "started", "learn",
      "read", "more", "sign", "log", "privacy", "policy", "contact", "us", "about",
      "click", "here", "find", "out", "see", "show", "view", "coming", "soon", "stay",
      "tuned", "thank", "you", "best", "regards", "home", "page", "error", "found",
      "rights", "reserved", "select", "delete", "create", "add", "edit", "profile",
      "my", "account", "dark", "mode", "light", "full", "screen", "time", "machine",
      "learning", "artificial", "intelligence", "climate", "change", "human",
      "resources", "customer", "manager", "software", "engineer", "vice", "president",
      "chief", "executive", "senior", "junior", "director", "product", "design",
      "engineering", "support", "service", "services", "company", "inc", "ltd", "llc",
      "corp", "co", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
      "sunday", "january", "february", "march", "april", "may", "june", "july",
      "august", "september", "october", "november", "december", "today", "tomorrow",
      "yesterday", "week", "month", "year", "years", "days", "hours", "minutes",
    ].map((w) => w.toLowerCase())
  ),

  PN_PHRASE_STOP: new Set(
    [
      "getting started",
      "learn more",
      "read more",
      "sign in",
      "sign up",
      "log in",
      "log out",
      "sign out",
      "privacy policy",
      "contact us",
      "about us",
      "click here",
      "find out",
      "see more",
      "show more",
      "view all",
      "coming soon",
      "stay tuned",
      "thank you",
      "best regards",
      "good morning",
      "good afternoon",
      "good evening",
      "good night",
      "home page",
      "error page",
      "not found",
      "page not",
      "all rights",
      "rights reserved",
      "select all",
      "delete all",
      "create new",
      "add new",
      "edit profile",
      "my account",
      "dark mode",
      "light mode",
      "full screen",
      "real time",
      "open source",
      "machine learning",
      "artificial intelligence",
      "climate change",
      "human resources",
      "software engineer",
      "vice president",
      "chief executive",
      "project manager",
      "product manager",
      "customer service",
      "terms of",
      "table of",
      "list of",
      "set of",
      "kind of",
      "sort of",
    ].map((w) => w.toLowerCase())
  ),

  pnNormKey(term) {
    return String(term || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  },

  pnSanitizeTerm(term) {
    const t = String(term || "").trim().replace(/\s+/g, " ");
    if (!t || t.length > 64) return "";
    if (/[\n\r]/.test(t)) return "";
    return t;
  },

  pnUniqueTerms(lists) {
    const out = [];
    const seen = new Set();
    for (const list of lists || []) {
      for (const term of list || []) {
        const clean = PBT.pnSanitizeTerm(term);
        if (!clean) continue;
        const key = PBT.pnNormKey(clean);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
      }
    }
    return out;
  },

  /** True if Title-Case multi-word Latin span looks like a person name (heuristic). */
  pnLooksLikePersonName(phrase) {
    const raw = String(phrase || "").trim();
    if (!raw) return false;
    const key = PBT.pnNormKey(raw);
    if (PBT.PN_PHRASE_STOP.has(key)) return false;
    const parts = raw.split(/\s+/);
    if (parts.length < 2 || parts.length > 4) return false;
    for (const p of parts) {
      if (p.length < 2 || p.length > 18) return false;
      // Title case, optional internal hyphen / apostrophe (Jean-Luc, O'Brien)
      if (!/^[A-Z][a-z]+(?:['’-][A-Za-z]+)*$/.test(p)) return false;
      const tok = p.toLowerCase().replace(/['’].*$/, "").split("-")[0];
      if (PBT.PN_NAME_STOP.has(tok)) return false;
    }
    return true;
  },

  /**
   * Detect likely person names: capitalized multi-word Latin spans.
   * Not perfect NLP NER — prefer 保留专名 whitelist for corrections / growth.
   */
  pnDetectPersonNames(text) {
    const s = String(text || "");
    if (!s) return [];
    const out = [];
    const seen = new Set();
    const re =
      /\b([A-Z][a-z]+(?:['’-][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:['’-][A-Za-z]+)?){1,3})\b/g;
    let m;
    while ((m = re.exec(s))) {
      const phrase = m[1];
      if (!PBT.pnLooksLikePersonName(phrase)) continue;
      const key = PBT.pnNormKey(phrase);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(phrase);
    }
    return out;
  },

  /**
   * Batch preserve list: detected person names first (prompt budget), then whitelist.
   * Brands rely on seed/whitelist; people rely on heuristics + 保留专名.
   */
  pnMergeBatchPreserve(batchTexts, whitelist) {
    const blob = (batchTexts || []).join("\n");
    const detected = PBT.pnDetectPersonNames(blob);
    return PBT.pnUniqueTerms([detected, whitelist]);
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

  /**
   * Strip whitelist + heuristic person/brand tokens so echo maths ignore kept Latin names.
   * Complements Han carriesTargetScript gate — Chinese that retains names must not be discarded.
   */
  pnStripForEcho(text, termList) {
    let out = String(text || "");
    if (!out) return out;
    const merged = PBT.pnUniqueTerms([termList, PBT.pnDetectPersonNames(out)]);
    if (!merged.length) return out;
    const sorted = [...merged].sort((a, b) => b.length - a.length);
    for (const term of sorted) {
      const t = String(term || "").trim();
      if (!t || t.length < 2) continue;
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
      out = out.replace(re, " ");
    }
    return out.replace(/\s+/g, " ").trim();
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
