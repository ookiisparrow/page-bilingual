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
  PN_SEED: [
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
  ],

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

  /** Build / merge store blob. Evicts oldest non-pinned when over cap. */
  pnEnsureStore(raw, now = Date.now()) {
    const store = raw && typeof raw === "object" ? raw : {};
    const terms = store.terms && typeof store.terms === "object" ? { ...store.terms } : {};
    let seeded = !!store.seeded;
    if (!seeded) {
      for (const term of PBT.PN_SEED) {
        const key = PBT.pnNormKey(term);
        if (!key || terms[key]) continue;
        terms[key] = { term, pinned: false, lastAt: now, seed: true };
      }
      seeded = true;
    }
    PBT.pnTrimTerms(terms);
    return { seeded, terms };
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

  /** Strip whitelist tokens so echo maths ignore kept Latin names. */
  pnStripForEcho(text, termList) {
    let out = String(text || "");
    if (!out || !termList?.length) return out;
    const sorted = [...termList].sort((a, b) => b.length - a.length);
    for (const term of sorted) {
      const t = String(term || "").trim();
      if (!t || t.length < 2) continue;
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
      out = out.replace(re, " ");
    }
    return out.replace(/\s+/g, " ").trim();
  },
};
