(() => {
  if (window.__pbtLoaded) return;
  window.__pbtLoaded = true;

  const SKIP =
    "script,style,noscript,svg,code,pre,textarea,input,select,option,math,canvas,iframe,video,audio,button,[role='button'],[role='tab'],[contenteditable],[contenteditable='true'],[translate='no'],.notranslate,.pbt-tr,#pbt-root,.code-example,.highlight,.token,relative-time,time-ago,time,[datetime]";
  const SKIP_HARD =
    "script,style,noscript,svg,code,pre,textarea,input,select,option,math,canvas,iframe,video,audio,.pbt-tr,#pbt-root";
  const MENU_ITEM_SEL =
    "[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='option'],[role='treeitem']";
  const CHROME =
    "nav,header,footer,aside,form,time,cite,[rel='author'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='search'],#mw-navigation,#mw-panel,#mw-head,#mw-page-base,#siteNotice,.vector-header,.vector-sitenotice,.vector-toc,#toc,.toc,.mw-portlet,.mw-editsection,.navbox,.vertical-navbox,.byline,.author,.breadcrumb,.pagination,.pager,.share,.social,.tags,.comment-meta,.cookie,.cookie-banner,#fbar,.fbar,#footcnt,#sfooter,#bottomads,.commit-tease,.js-details-container .flex-auto .text-small,.react-directory-commit-age,[data-testid='latest-commit-details'],[data-testid='latest-commit'],.Box-header .text-small,#onetrust-banner-sdk,#onetrust-consent-sdk,[id^='sp_message_container'],[id*='sp_message'],[class*='cookie-consent'],[class*='CookieConsent'],[id*='cookie-banner'],[class*='ConsentBanner'],[class*='privacy-gate'],[id*='privacy-gate'],[class*='PrivacyManager'],[data-testid*='consent']";
  const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,dt,dd,[role='heading'],[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio'],[role='option'],[role='treeitem']";
  // GitHub/GitLab 目录列表行：文件名、提交信息、时间列都是 chrome（LAYOUT A5）
  const REPO_FILE_ROW =
    ".react-directory-row,.react-directory-filename-column,.react-directory-filename-cell,.react-directory-truncate,.react-directory-commit-message,.react-directory-commit-age,[aria-labelledby='folders-and-files'],.js-navigation-item,[data-testid='latest-commit'],[data-testid='latest-commit-details'],[class*='LatestCommit-module'],.commit-tease,.tree-browser,.file-navigation";
  const MAIN_HINTS = [
    "article",
    "[role='main']",
    "main",
    "#mw-content-text",
    ".mw-parser-output",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".article-body",
    ".story-body",
    ".post-body",
    ".markdown-body",
    "#content",
    "#main-content",
  ].join(",");

  // viewport-first knobs（对齐沉浸式 dynamic）· 1.4.46 DeepSeek 加速 / 抗斑驳
  const PBT_HOT_PAD = 0.75;
  const PBT_BATCH = 14; // DeepSeek：~12–16；Cursor 仍走 PBT_BATCH_CURSOR
  const PBT_BATCH_CURSOR = 5;
  const PBT_COLD_SLICE = 16;
  const PBT_HOT_WORKERS = 3;
  const PBT_COLD_WORKERS = 2;
  const PBT_HOT_WORKERS_CURSOR = 2;
  const PBT_COLD_WORKERS_CURSOR = 1;
  const PBT_MERGE_CHARS = 120;
  const PBT_MISS_SWEEP_MS = 1000; // 800–1200：降 thrash

  const cache = new Map();
  let settings = { ...PBT.DEFAULTS, displayMode: "replace", scope: "full" };
  let glossary = [];
  /** Global proper-noun whitelist (chrome.storage.local); complements page glossary. */
  let properNounStore = { seeded: false, terms: {} };
  let properNounList = [];
  let translated = false;
  let translating = false; // run in progress; FAB 译→原 only after first ok
  let hoverEl = null;
  let seq = 0;
  let spaceHits = [];
  let lastSel = null;
  let runId = 0;
  let moTimer = 0;
  let mo = null;
  let missSweepTimer = 0;
  let missSweepRunning = false;
  let panelHotTimer = 0;
  let allowMissSweep = false; // 首热批上屏前不扫全页漏译
  let hotFirstPaintDone = false;

  function isCursorEngine() {
    const e = String(settings.engine || "").toLowerCase();
    return e === "cursor" || e === "bridge";
  }
  function queueBatchSize() {
    return isCursorEngine() ? PBT_BATCH_CURSOR : PBT_BATCH;
  }
  function hotWorkerCount() {
    return isCursorEngine() ? PBT_HOT_WORKERS_CURSOR : PBT_HOT_WORKERS;
  }
  function coldWorkerCount() {
    return isCursorEngine() ? PBT_COLD_WORKERS_CURSOR : PBT_COLD_WORKERS;
  }
  function isReplaceMode() {
    return (settings.displayMode || "replace") === "replace";
  }


  const ui = { host: null, shadow: null };

  PBT.settings().then(async (s) => {
    settings = s;
    applyStyle();
    glossary = await loadGlossary();
    await loadProperNouns();
    await loadTrCache();
    mountUi();
    // 全局翻译开关：新页面自动开译
    if (settings.serviceOn) {
      watchServiceOnSpaDom();
      setTimeout(() => {
        if (settings.serviceOn && !translated && !translating) {
          if (settings.displayMode !== "replace") settings.displayMode = "replace";
          settings.scope = "full";
          translatePage("full")
            .then(() => scheduleMissSweep(PBT_MISS_SWEEP_MS))
            .catch(() => softAutoTranslate("boot", 1));
        }
      }, 350);
    }
  });
  chrome.storage.onChanged.addListener((chg, area) => {
    if (area !== "local") return;
    if (Object.prototype.hasOwnProperty.call(chg, PBT.PN_STORE_KEY)) {
      applyProperNounStore(chg[PBT.PN_STORE_KEY].newValue);
    }
    const langChanged = Object.prototype.hasOwnProperty.call(chg, "targetLang");
    const serviceChanged = Object.prototype.hasOwnProperty.call(chg, "serviceOn");
    for (const [k, v] of Object.entries(chg)) {
      if (PBT.SECRET_KEYS.includes(k) || k === PBT.PN_STORE_KEY) continue;
      settings[k] = v.newValue;
    }
    applyStyle();
    if (langChanged) clearPageTrCache();
    if (translated) setMode(settings.displayMode);
    if (serviceChanged) {
      renderFab();
      if (settings.serviceOn && !translated && !translating) {
        if (settings.displayMode !== "replace") settings.displayMode = "replace";
        settings.scope = "full";
        watchServiceOnSpaDom();
        translatePage("full")
          .then(() => scheduleMissSweep(PBT_MISS_SWEEP_MS))
          .catch(() => softAutoTranslate("storage", 1));
      } else if (!settings.serviceOn && (translated || translating)) {
        restoreAll();
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    const run = handle(msg);
    if (run && typeof run.then === "function") {
      run.then((r) => reply(r || { ok: true })).catch((e) => reply({ ok: false, error: String(e.message || e) }));
      return true;
    }
    reply(run || { ok: true });
  });

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keydown", onInputGesture, true);


  function isSettledPbt(el) {
    if (!el) return true;
    const st = el.dataset?.pbtState;
    if (st === "ok" || st === "skip" || st === "pending" || st === "queued") return true;
    if (el.classList?.contains("pbt-skip") || el.classList?.contains("pbt-host") || el.classList?.contains("pbt-text-swap")) return true;
    if (!isReplaceMode() && el.nextElementSibling?.classList?.contains("pbt-tr")) return true;
    return false;
  }

  function collectNewBlocks(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return [];
    const out = [];
    const seen = new Set(document.querySelectorAll(".pbt-host, .pbt-skip, .pbt-text-swap"));
    // 新出现 / 刚变为可见的散文块（含 details / accordion / drawer 展开后）
    for (const el of root.querySelectorAll(BLOCKS)) {
      if (seen.has(el) || el.closest(".pbt-host") || isSettledPbt(el)) continue;
      pushBlock(out, seen, el);
    }
    // 弹出层：菜单项等（走 text 叶替换；isSkip 已对 menu 放行 button）
    for (const el of root.querySelectorAll(MENU_ITEM_SEL)) {
      if (seen.has(el) || el.closest(".pbt-host") || isSkip(el) || isSettledPbt(el)) continue;
      if (!isPopupSurface(el) && !isMenuItemEl(el)) continue;
      const text = textOf(el);
      if (!needsTranslate(text) || text.length < 2) continue;
      if (looksLikeRelativeTime(text) || looksLikeIdentifier(text)) continue;
      if (!isEffectivelyVisible(el)) continue;
      seen.add(el);
      out.push({ el, text });
    }
    // SPA 文案按钮 / 正文返回链 / label
    for (const el of root.querySelectorAll("button,[role='button'],[role='tab'],a[href],label")) {
      if (seen.has(el) || el.closest(".pbt-host") || isSettledPbt(el)) continue;
      if (!(isTextControl(el) || isContentLink(el) || isLabelLeaf(el))) continue;
      pushBlock(out, seen, el);
    }
    // drawer/dialog 内散文 div（无 p/h 时）
    if (root !== document.body && isRevealSurface(root)) {
      for (const el of root.querySelectorAll("div,span,label")) {
        if (out.length >= 80) break;
        if (seen.has(el) || isSettledPbt(el) || isSkip(el)) continue;
        if (el.querySelector?.(BLOCKS)) continue;
        const text = textOf(el);
        if (!worth(el, text)) continue;
        seen.add(el);
        out.push({ el, text });
      }
    }
    return pruneAncestorBlocks(out);
  }

  async function translateNewBlocks(root, hot) {
    if (!(translated || translating)) return;
    const my = runId;
    const blocks = collectNewBlocks(root);
    if (!blocks.length) return;
    const items = blocks.map((b) => {
      markQueued(b.el);
      return { id: ensureId(b.el), text: b.text, el: b.el };
    });
    await runQueue(items, { size: queueBatchSize(), workers: hot ? hotWorkerCount() : coldWorkerCount(), my, atomicReplace: !!hot });
    scheduleMissSweep(hot ? PBT_MISS_SWEEP_MS : PBT_MISS_SWEEP_MS + 200);
  }

  function scheduleTranslateNew() {
    if (!(translated || translating)) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => {
      translateNewBlocks().catch(() => {});
    }, 220);
  }

  function isRevealSurface(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.matches?.(POPUP)) return true;
      if (el.matches?.("[role='dialog'],[role='alertdialog'],[role='menu'],[popover],details")) return true;
      const cl = typeof el.className === "string" ? el.className : "";
      if (/\b(drawer|offcanvas|sheet|sidenav|side-nav|mobile-nav|van-popup|action-sheet)\b/i.test(cl)) return true;
    } catch { /* ignore */ }
    return false;
  }

  function looksExpanded(el, attr) {
    if (!el) return false;
    try {
      if (attr === "open") return el.hasAttribute("open") || el.open === true;
      if (attr === "hidden") return !el.hasAttribute("hidden");
      if (attr === "aria-hidden") return el.getAttribute("aria-hidden") !== "true";
      if (attr === "aria-expanded") return el.getAttribute("aria-expanded") === "true";
      if (attr === "aria-selected") return el.getAttribute("aria-selected") === "true";
      if (attr === "data-state") {
        const v = el.getAttribute("data-state") || "";
        return /^(open|visible|expanded|show)$/i.test(v);
      }
      if (attr === "data-open") {
        const v = el.getAttribute("data-open");
        return v === "" || v === "true" || v === "open";
      }
      if (attr === "class") {
        const cl = typeof el.className === "string" ? el.className : "";
        if (/\b(open|show|visible|expanded|is-open|is-active|drawer-open|offcanvas-show|translate-x-0)\b/i.test(cl)) return true;
        if (isRevealSurface(el) && isEffectivelyVisible(el)) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  function revealPanelFor(el) {
    if (!el) return null;
    try {
      if (isRevealSurface(el) && isEffectivelyVisible(el)) return el;
      // aria-expanded 在触发器上：找控件/同组面板
      if (el.getAttribute?.("aria-expanded") === "true") {
        const id = el.getAttribute("aria-controls");
        if (id) {
          const panel = document.getElementById(id);
          if (panel) return panel;
        }
        const sib = el.nextElementSibling;
        if (sib && isRevealSurface(sib)) return sib;
        // details/summary
        if (el.tagName === "SUMMARY" && el.parentElement?.tagName === "DETAILS") return el.parentElement;
      }
      const panel = el.closest?.(POPUP) || el.closest?.("[role='dialog'],[role='alertdialog'],details");
      if (panel && isEffectivelyVisible(panel)) return panel;
    } catch { /* ignore */ }
    // 非弹层/抽屉：不把任意节点当 panel（交给 scheduleTranslateNew 全页增量）
    return null;
  }

  function scheduleTranslatePanel(panel) {
    if (!(translated || translating) || !panel) return;
    clearTimeout(panelHotTimer);
    panelHotTimer = setTimeout(() => {
      translateNewBlocks(panel, true).catch(() => {});
    }, 80);
  }

  function watchDynamicMenus() {
    if (mo) return;
    mo = new MutationObserver((mutations) => {
      if (!(translated || translating)) return;
      const panels = [];
      const seen = new Set();
      for (const m of mutations) {
        if (m.type === "attributes") {
          const el = m.target;
          if (!el || el.nodeType !== 1) continue;
          if (!looksExpanded(el, m.attributeName)) continue;
          const panel = revealPanelFor(el);
          if (panel && !seen.has(panel)) {
            seen.add(panel);
            panels.push(panel);
          }
        } else if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (!n || n.nodeType !== 1) continue;
            if (isRevealSurface(n) || n.querySelector?.(POPUP)) {
              const panel = isRevealSurface(n) ? n : n.querySelector?.(POPUP);
              if (panel && isEffectivelyVisible(panel) && !seen.has(panel)) {
                seen.add(panel);
                panels.push(panel);
              }
            }
          }
        }
      }
      if (panels.length) {
        for (const p of panels) scheduleTranslatePanel(p);
        scheduleMissSweep(PBT_MISS_SWEEP_MS);
      } else {
        scheduleTranslateNew();
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "aria-hidden", "aria-expanded", "aria-selected", "data-state", "data-open", "class"],
    });
  }

  function unwatchDynamicMenus() {
    if (mo) {
      mo.disconnect();
      mo = null;
    }
    clearTimeout(moTimer);
    moTimer = 0;
    clearTimeout(panelHotTimer);
    panelHotTimer = 0;
    clearTimeout(missSweepTimer);
    missSweepTimer = 0;
  }

  /** 漏译扫描：replace 用整页 collect 重扫 fail/未收块；双语仍扫增量。 */
  function collectMissedVisible() {
    const root = document.body;
    if (!root) return [];
    const raw = isReplaceMode() ? collect("full") : collectNewBlocks(root);
    const all = raw.filter((b) => {
      if (!b?.el || b.el.classList?.contains("pbt-skip")) return false;
      const st = b.el.dataset?.pbtState;
      if (st === "ok" || st === "skip" || st === "pending") return false;
      if (st === "queued") return !translating;
      if (st === "fail") return true;
      if (b.el.classList.contains("pbt-host") || b.el.classList.contains("pbt-text-swap")) return false;
      return true;
    });
    const prefer =
      isReplaceMode() || isReplaceFull() || settings.serviceOn
        ? all
        : all.filter((b) => inView(b.el, 0.75));
    return prefer.slice(0, isReplaceMode() || isReplaceFull() || settings.serviceOn ? 80 : 24);
  }

  function scheduleMissSweep(delay) {
    if (!(translated || translating || settings.serviceOn)) return;
    clearTimeout(missSweepTimer);
    const base = delay == null ? PBT_MISS_SWEEP_MS : delay;
    // 首热批未上屏：只挂长延迟，避免全页 miss-sweep 抢额度导致斑驳
    const wait = allowMissSweep ? base : Math.max(base, 1200);
    missSweepTimer = setTimeout(() => {
      if (!allowMissSweep && (translating || settings.serviceOn)) {
        // 再等一轮；hot 完成后会 allowMissSweep=true 并主动 schedule
        scheduleMissSweep(PBT_MISS_SWEEP_MS);
        return;
      }
      sweepMissedVisible().catch(() => {});
    }, wait);
  }

  async function sweepMissedVisible() {
    if (missSweepRunning || !(translated || translating || settings.serviceOn)) return;
    if (!allowMissSweep) return;
    missSweepRunning = true;
    let n = 0;
    try {
      const my = runId;
      const blocks = collectMissedVisible();
      n = blocks.length;
      if (!blocks.length) return;
      const items = blocks.map((b) => {
        markQueued(b.el);
        return { id: ensureId(b.el), text: b.text, el: b.el };
      });
      await runQueue(items, { size: queueBatchSize(), workers: coldWorkerCount(), my });
    } finally {
      missSweepRunning = false;
      // 有漏就继续扫，直到空闲（拉长间隔降 thrash）
      if (n > 0 && (translated || translating || settings.serviceOn)) {
        scheduleMissSweep(PBT_MISS_SWEEP_MS);
      }
    }
  }

  function handle(msg) {
    switch (msg.type) {
      case "PBT_TOGGLE":
        if (translated || settings.serviceOn) {
          settings.serviceOn = false;
          PBT.save({ serviceOn: false });
          return restoreAll();
        }
        settings.displayMode = "replace";
        settings.scope = "full";
        settings.serviceOn = true;
        PBT.save({ displayMode: "replace", scope: "full", serviceOn: true });
        return translatePage("full");
      case "PBT_TRANSLATE":
        return translatePage(msg.scope);
      case "PBT_RESTORE":
        return restoreAll();
      case "PBT_HOVER":
        return translateHover();
      case "PBT_INPUT":
        return translateFocusedInput();
      case "PBT_SELECTION":
        return translateSelection(true);
      case "PBT_MODE":
        setMode(msg.mode);
        return { ok: true };
      case "PBT_SCOPE":
        settings.scope = msg.scope;
        return { ok: true };
      case "PBT_STATUS":
        return { ok: true, translated, count: document.querySelectorAll(".pbt-host").length };
      default:
        return { ok: true };
    }
  }

  function applyStyle() {
    document.documentElement.style.setProperty("--pbt-size", settings.trSize || "0.98em");
    document.documentElement.style.setProperty("--pbt-color", settings.trColor || "inherit");
    document.documentElement.style.setProperty("--pbt-opacity", settings.trOpacity || "1");
  }

  function glossKey() {
    return `pbt.glossary.${location.host}`;
  }

  async function loadGlossary() {
    try {
      const data = await chrome.storage.session.get(glossKey());
      return data[glossKey()] || [];
    } catch {
      return [];
    }
  }

  async function persistGlossary() {
    try {
      await chrome.storage.session.set({ [glossKey()]: glossary });
    } catch {
      /* session storage optional */
    }
  }

  function applyProperNounStore(raw) {
    properNounStore = PBT.pnEnsureStore(raw);
    properNounList = PBT.pnTermList(properNounStore);
  }

  async function loadProperNouns() {
    try {
      properNounStore = await PBT.pnLoad();
      properNounList = PBT.pnTermList(properNounStore);
    } catch {
      applyProperNounStore(null);
    }
  }

  function touchProperNounsInText(text) {
    const s = String(text || "");
    if (!s || !properNounList.length) return false;
    let touched = false;
    const now = Date.now();
    for (const term of properNounList) {
      const key = PBT.pnNormKey(term);
      const entry = properNounStore.terms[key];
      if (!entry) continue;
      const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
      if (re.test(s)) {
        entry.lastAt = now;
        touched = true;
      }
    }
    return touched;
  }

  async function persistProperNounsSoon() {
    try {
      await PBT.pnSave(properNounStore);
    } catch {
      /* local optional */
    }
  }

  /**
   * Glossary rows for the API: page pins + identity rows for whitelist brands
   * and heuristic person names present in the batch (keep as-is).
   */
  function glossaryWithProperNouns(batchTexts) {
    const out = glossary.map((g) => ({ src: g.src, dst: g.dst }));
    const seen = new Set(out.map((g) => PBT.pnNormKey(g.src)));
    const blob = (batchTexts || []).join("\n");
    const preserve = PBT.pnMergeBatchPreserve(batchTexts, properNounList);
    for (const term of preserve) {
      const key = PBT.pnNormKey(term);
      if (!key || seen.has(key)) continue;
      const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
      if (!re.test(blob)) continue;
      out.push({ src: term, dst: term });
      seen.add(key);
    }
    return out;
  }

  /** Whitelist + heuristic person names for one src/dst pair (echo / restore). */
  function preserveTermsForPair(src, dst) {
    return PBT.pnUniqueTerms([
      properNounList,
      PBT.pnDetectPersonNames(src),
      PBT.pnDetectPersonNames(dst),
    ]);
  }

  /* Global segment cache — LFU-lite (one-hit probation + light aging).
     Upgrades the existing Map / requestBatch / trCache* path; not a parallel cache. */
  const TR_CACHE_CAP = 4000;
  const TR_CACHE_BYTES = 1536 * 1024; // ~1.5MB UTF-16 estimate
  const TR_CACHE_PERSIST_MAX_LEN = 200;
  const TR_CACHE_AGE_EVERY = 64;
  const SEG_CACHE_KEY = "pbt.segCache.v1";
  let trCachePersistTimer = 0;
  let trCacheInserts = 0;

  function engineId() {
    const e = String(settings.engine || "deepseek").toLowerCase();
    const eng = e === "bridge" ? "cursor" : e;
    const model =
      eng === "cursor"
        ? settings.cursorModel || "composer-2.5-fast"
        : settings.deepseekModel || "deepseek-flash";
    return `${eng}:${model}`;
  }

  function normalizeCacheText(text) {
    return String(text || "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ");
  }

  function glossFp() {
    if (!glossary.length) return "";
    const s = glossary.map((x) => `${x.src}=${x.dst}`).join("|");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function cacheKey(text) {
    return `auto\0${settings.targetLang}\0${engineId()}\0${glossFp()}\0${normalizeCacheText(text)}`;
  }

  function entryBytes(k, text) {
    return (String(k).length + String(text || "").length) * 2 + 32;
  }

  function cacheGetText(key) {
    const e = cache.get(key);
    if (!e || typeof e.text !== "string") return null;
    e.freq = (e.freq || 1) + 1;
    e.lastAt = Date.now();
    return e.text;
  }

  function cachePut(key, text) {
    if (typeof text !== "string" || !text || text === "…") return;
    const prev = cache.get(key);
    if (prev) {
      prev.text = text;
      prev.freq = (prev.freq || 1) + 1;
      prev.lastAt = Date.now();
      prev.bytes = entryBytes(key, text);
      return;
    }
    cache.set(key, {
      text,
      freq: 1,
      lastAt: Date.now(),
      bytes: entryBytes(key, text),
    });
    trCacheInserts += 1;
    if (trCacheInserts % TR_CACHE_AGE_EVERY === 0) ageCacheFreq();
  }

  function ageCacheFreq() {
    for (const e of cache.values()) {
      e.freq = Math.max(1, Math.floor((e.freq || 1) / 2));
    }
  }

  function cacheByteSize() {
    let n = 0;
    for (const e of cache.values()) n += e.bytes || 0;
    return n;
  }

  /** Evict one: cold (freq==1) oldest first, else lowest freq then least-recent. */
  function evictOne() {
    if (!cache.size) return false;
    let bestK = null;
    let best = null;
    for (const [k, e] of cache) {
      if (!best) {
        bestK = k;
        best = e;
        continue;
      }
      const ef = e.freq || 1;
      const bf = best.freq || 1;
      const el = e.lastAt || 0;
      const bl = best.lastAt || 0;
      if (ef === 1 && bf > 1) {
        bestK = k;
        best = e;
      } else if (ef === 1 && bf === 1) {
        if (el < bl) {
          bestK = k;
          best = e;
        }
      } else if (bf > 1 && (ef < bf || (ef === bf && el < bl))) {
        bestK = k;
        best = e;
      }
    }
    if (bestK == null) return false;
    cache.delete(bestK);
    return true;
  }

  function trimCache() {
    while (cache.size > TR_CACHE_CAP || cacheByteSize() > TR_CACHE_BYTES) {
      if (!evictOne()) break;
    }
  }

  async function reclaimOldTrCacheKeys() {
    // Only drop this page's legacy per-URL blob — never storage.get(null) from content
    // (would pull API keys into the page world).
    const legacy = `pbt.trCache.${location.origin}${location.pathname}${location.search}`;
    try {
      await chrome.storage.local.remove(legacy);
    } catch { /* optional */ }
    try {
      await chrome.storage.session.remove(legacy);
    } catch { /* optional */ }
  }

  async function loadTrCache() {
    try {
      const data = await chrome.storage.local.get(SEG_CACHE_KEY);
      const blob = data[SEG_CACHE_KEY];
      if (!blob || typeof blob !== "object") {
        await reclaimOldTrCacheKeys();
        return;
      }
      const entries = Array.isArray(blob.entries) ? blob.entries : [];
      for (const row of entries) {
        if (!row || typeof row.k !== "string" || typeof row.t !== "string") continue;
        if (cache.has(row.k)) continue;
        cache.set(row.k, {
          text: row.t,
          freq: Math.max(1, Number(row.f) || 1),
          lastAt: Number(row.a) || 0,
          bytes: entryBytes(row.k, row.t),
        });
      }
      trimCache();
      await reclaimOldTrCacheKeys();
    } catch { /* optional */ }
  }

  async function persistTrCacheNow() {
    trCachePersistTimer = 0;
    try {
      trimCache();
      const entries = [];
      for (const [k, e] of cache) {
        if (!e || typeof e.text !== "string") continue;
        const src = k.includes("\0") ? k.slice(k.lastIndexOf("\0") + 1) : "";
        if (src.length > TR_CACHE_PERSIST_MAX_LEN || e.text.length > TR_CACHE_PERSIST_MAX_LEN) {
          continue; // memory may keep long hits; durable store stays phrase-heavy
        }
        entries.push({ k, t: e.text, f: e.freq || 1, a: e.lastAt || 0 });
      }
      await chrome.storage.local.set({ [SEG_CACHE_KEY]: { v: 1, entries } });
    } catch { /* quota / optional */ }
  }

  function schedulePersistTrCache() {
    if (trCachePersistTimer) clearTimeout(trCachePersistTimer);
    trCachePersistTimer = setTimeout(() => {
      persistTrCacheNow();
    }, 200);
  }

  async function clearPageTrCache() {
    // Lang change: drop memory; durable store is key-partitioned (do not wipe global).
    cache.clear();
    if (trCachePersistTimer) {
      clearTimeout(trCachePersistTimer);
      trCachePersistTimer = 0;
    }
    try {
      await loadTrCache();
    } catch { /* optional */ }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistTrCacheNow();
  });
  window.addEventListener("pagehide", () => {
    persistTrCacheNow();
  });

  function isMenuItemEl(el) {
    return !!(el && el.matches && el.matches(MENU_ITEM_SEL));
  }

  /** 站点顶栏/页脚 chrome；main/article 内的 nav（SPA 侧栏页签）不算 */
  function inSiteChrome(el) {
    if (!el || !el.closest) return true;
    if (el.closest("#pbt-root,.pbt-tr,.pbt-float")) return true;
    if (el.closest("header,footer,[role='banner'],[role='contentinfo']")) return true;
    const nav = el.closest("nav,[role='navigation']");
    if (nav && !el.closest("main,article,[role='main']")) return true;
    return false;
  }

  /** SPA 文案按钮/页签/CTA；抽屉/弹层内更宽；整页也收短按钮叶 */
  function isTextControl(el) {
    if (!el || !el.matches) return false;
    const asBtn = el.matches("button,[role='button'],[role='tab']");
    let asCta = false;
    if (!asBtn && el.tagName === "A") {
      try {
        const cs = getComputedStyle(el);
        const cls = String(el.className || "");
        asCta =
          /(?:^|[\s_-])(btn|button|cta)(?:[\s_-]|$)/i.test(cls) ||
          ((cs.display.includes("flex") || cs.display === "inline-flex") &&
            (parseFloat(cs.height) >= 32 || parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) >= 12));
      } catch {
        asCta = false;
      }
    }
    if (!asBtn && !asCta) return false;
    const inPopup = isPopupSurface(el);
    // replace/full：顶栏/页脚文案叶也收；双语模式仍跳过 site chrome
    if (!inPopup && inSiteChrome(el) && !isReplaceFull()) return false;
    if (isConsentWall(el)) return false;
    if (isMenuItemEl(el) || el.closest?.(MENU_ITEM_SEL)) return false;
    const text = textOf(el);
    const minLen = 2;
    const maxLen = inPopup ? 240 : 220;
    if (!needsTranslate(text) || text.length < minLen || text.length > maxLen) return false;
    if (/^show (more|less)$/i.test(text)) return false;
    if (text.length <= 6 && el.querySelector("svg,img") && !/\s/.test(text)) return false;
    return true;
  }

  /** label / 表单旁文案叶 */
  function isLabelLeaf(el) {
    if (!el || !el.matches) return false;
    if (!el.matches("label")) return false;
    if (el.closest?.("button,[role='button']")) return false;
    const inPopup = isPopupSurface(el);
    if (!inPopup && inSiteChrome(el) && !isReplaceFull()) return false;
    if (isConsentWall(el)) return false;
    const text = textOf(el);
    if (!needsTranslate(text) || text.length < 2 || text.length > 200) return false;
    if (el.querySelector?.(BLOCKS)) return false;
    if (looksLikeUrl(text) || looksLikeEmail(text) || looksLikeIdentifier(text)) return false;
    return true;
  }

  function isReplaceFull() {
    return (settings.displayMode || "replace") === "replace" || settings.scope === "full" || !!settings.serviceOn;
  }

  /** 超链接叶文本；抽屉/弹层内短链也收；整页 min 更低 */
  function isContentLink(el) {
    if (!el || el.tagName !== "A" || !el.hasAttribute("href")) return false;
    if (el.closest?.("button,[role='button']")) return false;
    const inPopup = isPopupSurface(el);
    if (!inPopup && inSiteChrome(el) && !isReplaceFull()) return false;
    // 已由 isTextControl 收的 CTA 链不重复
    if (isTextControl(el)) return false;
    const text = textOf(el);
    const minLen = inPopup ? 2 : 2;
    const maxLen = inPopup ? 160 : 120;
    if (!needsTranslate(text) || text.length < minLen || text.length > maxLen) return false;
    if (el.querySelector?.(BLOCKS)) return false;
    if (looksLikeUrl(text) || looksLikeEmail(text) || looksLikeIdentifier(text)) return false;
    return true;
  }

  /** Show more/less 常紧跟宿主；译文插在 toggle 后，避免叠字 */
  function attachAnchorFor(el) {
    let anchor = el;
    let n = el.nextElementSibling;
    for (let i = 0; i < 3 && n; i++) {
      const t = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim();
      if (/^show (more|less)$/i.test(t)) {
        anchor = n;
        n = n.nextElementSibling;
        continue;
      }
      break;
    }
    return anchor;
  }

  /** line-clamp / overflow:hidden 祖先会裁掉 nextSibling 译文 → 放宽 */
  function relaxClipAncestors(el) {
    if (!el) return;
    let n = el.parentElement;
    for (let i = 0; i < 6 && n && n !== document.body; i++, n = n.parentElement) {
      try {
        const s = getComputedStyle(n);
        const clamp = s.webkitLineClamp;
        const clamped = (clamp && clamp !== "none" && clamp !== "0") || /line-clamp/i.test(n.className || "");
        // 行 chrome（不换行 flex 行 / 截断的文件名格）：放开 overflow 会把邻列顶开
        const rowChrome =
          (s.display.includes("flex") &&
            s.flexWrap === "nowrap" &&
            s.flexDirection !== "column" &&
            s.flexDirection !== "column-reverse") ||
          s.textOverflow === "ellipsis";
        if (rowChrome) continue;
        if (clamped || s.overflow === "hidden" || s.overflowY === "hidden") {
          // 仅当可能裁到宿主下方兄弟时放宽（矮盒子 / line-clamp）
          if (clamped || n.clientHeight < 280 || (n.scrollHeight > n.clientHeight + 4)) {
            n.classList.add("pbt-clip-relax");
            n.style.setProperty("overflow", "visible", "important");
            n.style.setProperty("overflow-y", "visible", "important");
            n.style.setProperty("-webkit-line-clamp", "unset", "important");
            n.style.setProperty("max-height", "none", "important");
          }
        }
      } catch { /* ignore */ }
    }
  }

  function isSkip(el) {
    if (!el || !el.closest) return true;
    if (el.id === "pbt-root") return true;
    if (el.closest(SKIP_HARD)) return true;
    // 菜单/弹出层/文案按钮：不因 button/[role=button] 整段 SKIP
    if (
      isPopupSurface(el) ||
      isMenuPopup(el) ||
      isMenuItemEl(el) ||
      el.closest?.(MENU_ITEM_SEL) ||
      isTextControl(el) ||
      isContentLink(el) ||
      isLabelLeaf(el)
    ) {
      if (el.closest("[contenteditable],[contenteditable='true'],[translate='no'],.notranslate,.code-example,.highlight,.token,relative-time,time-ago,time,[datetime]"))
        return true;
      return false;
    }
    return !!el.closest(SKIP);
  }

  function extraExclude(el) {
    const sel = (settings.excludeCss || "").trim();
    if (!sel) return false;
    try {
      return !!el.closest(sel);
    } catch {
      return false;
    }
  }

  const POPUP =
    "[role='menu'],[role='listbox'],[role='tree'],[role='dialog'],[role='alertdialog'],[popover],details,[data-radix-accordion-content],[data-state='open'],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-radix-dropdown-menu-content],[data-radix-select-content],[data-floating-ui-portal],[data-headlessui-state],[id^='headlessui-'],.PopoverPanel,[data-melt-dropdown],[cmdk-list],.tippy-content,.MuiMenu-list,.MuiPopover-root,.ant-dropdown,.ant-select-dropdown,.el-dropdown-menu,.el-select-dropdown,.Select-menu,.dropdown-menu,[class*='DropdownMenu'],[class*='PopoverContent'],[class*='drawer' i],[class*='Drawer'],[class*='offcanvas' i],[class*='Offcanvas'],[class*='sheet' i],[class*='Sheet'],[class*='SideNav'],[class*='side-nav'],[class*='mobile-nav' i],[class*='MobileNav'],.van-popup,.van-action-sheet,.amu-drawer";
  const MENU_POPUP =
    "[role='menu'],[role='listbox'],[role='tree'],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-radix-dropdown-menu-content],[data-radix-select-content],[data-floating-ui-portal],[data-headlessui-state],[id^='headlessui-'],.PopoverPanel,[data-melt-dropdown],[cmdk-list],.tippy-content,.MuiMenu-list,.ant-dropdown,.ant-select-dropdown,.el-dropdown-menu,.el-select-dropdown,.Select-menu,.dropdown-menu,[class*='DropdownMenu']";

  function isPopupSurface(el) {
    return !!(el && el.closest && el.closest(POPUP));
  }

  function isMenuPopup(el) {
    return !!(el && el.closest && el.closest(MENU_POPUP));
  }

  function isConsentWall(el) {
    if (!el || !el.closest) return false;
    if (el.closest(CHROME)) {
      const t = (el.textContent || "").slice(0, 200);
      if (/privacy|cookie|consent|terms of use|your privacy rights/i.test(t)) return true;
    }
    if (el.closest("#onetrust-banner-sdk,#onetrust-consent-sdk,[id*='sp_message'],[class*='Consent'],[class*='consent-banner'],[class*='privacy-gate'],[class*='PrivacyManager']")) return true;
    const dlg = el.closest("[role='dialog'],[role='alertdialog']");
    if (dlg) {
      const t = (dlg.getAttribute("aria-label") || "") + " " + (dlg.textContent || "").slice(0, 280);
      if (/privacy|cookie|consent|terms of use|your privacy rights|accept.*cookie/i.test(t)) return true;
    }
    return false;
  }

  function isStructure(el) {
    if (!el || !el.closest) return true;
    // 页面内弹出菜单/对话框：允许翻译
    if (isPopupSurface(el)) return !!extraExclude(el);
    if (extraExclude(el)) return true;
    if (el.closest(CHROME)) {
      // SPA main 内 nav 页签/文案按钮（x.ai Memories 等）放行
      if (isTextControl(el) || isContentLink(el) || isLabelLeaf(el)) {
        /* allow */
      } else if (isReplaceFull() && (isHeading(el) || isProseTag(el))) {
        const t = textOf(el);
        if (t.length >= 8 && needsTranslate(t)) {
          /* replace：header/nav 内短散文也放行 */
        } else {
          return true;
        }
      } else {
        // Stripe 等把 hero H1 放在 <header>：实质标题仍译，导航短句仍跳过
        const inHeader = !!el.closest("header,[role='banner']");
        const inNav = !!el.closest("nav,footer,aside,[role='navigation'],[role='contentinfo'],[role='complementary']");
        if (inHeader && !inNav && (isHeading(el) || el.dataset?.pbtRole === "hero")) {
          const t = textOf(el);
          if (t.length >= 18 && needsTranslate(t)) {
            /* allow hero in header */
          } else {
            return true;
          }
        } else {
          return true;
        }
      }
    }
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      try {
        if (isPopupSurface(n)) return false;
        const s = getComputedStyle(n);
        // sticky/fixed 导航壳：跳过；正文里偶发 sticky 段仍允许标题/散文
        if (s.position === "fixed" || s.position === "sticky") {
          if (isTextControl(el) || isContentLink(el) || isLabelLeaf(el)) continue;
          if (isHeading(el) || el.dataset?.pbtRole === "hero" || isProseTag(el)) {
            const t = textOf(el);
            if (t.length >= (isReplaceFull() ? 8 : 24)) continue;
          }
          return true;
        }
      } catch {
        break;
      }
    }
    return false;
  }

  function effectiveOpacity(el) {
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === "hidden") return 0;
      const op = Number(s.opacity);
      if (!Number.isNaN(op)) o *= op;
      if (o < 0.05) return o;
    }
    return o;
  }

  function needsFloat(el) {
    if (!el || !el.isConnected) return true;
    if (effectiveOpacity(el) < 0.12) return true;
    const s = getComputedStyle(el);
    if (s.display === "none") return true;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return true;
    return false;
  }

  function ensureFloatRoot() {
    let root = document.getElementById("pbt-float-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "pbt-float-root";
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function placeFloat(node, el) {
    const r = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(window.innerWidth - 24, r.left + window.scrollX));
    const y = Math.max(8, r.bottom + window.scrollY + 6);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.width = `${Math.min(Math.max(r.width, 220), Math.min(560, window.innerWidth - 16))}px`;
  }

  function refreshFloats() {
    document.querySelectorAll(".pbt-float[data-pbt-for]").forEach((node) => {
      const id = node.dataset.pbtFor;
      const el = document.querySelector(`[data-pbt-id="${CSS.escape(id)}"]`);
      if (!el) {
        node.remove();
        return;
      }
      if (!needsFloat(el)) {
        const span = node.querySelector(".pbt-tr-text");
        const text = span?.textContent || "";
        node.remove();
        if (text) attach(el, text, el.dataset.pbtState || "ok");
        return;
      }
      placeFloat(node, el);
    });
  }

  let floatListening = false;
  function watchFloats() {
    if (floatListening) return;
    floatListening = true;
    window.addEventListener("scroll", refreshFloats, { passive: true, capture: true });
    window.addEventListener("resize", refreshFloats, { passive: true });
    setInterval(refreshFloats, 700);
  }

  function textOf(el) {
    // 标题/hero：优先 innerText（Stripe H1 含隐藏 SEO 长句，textContent 会污染）
    if (isHeading(el) || el?.dataset?.pbtRole === "hero") {
      try {
        const vis = String(el.innerText || "").replace(/\s+/g, " ").trim();
        if (vis) return vis;
      } catch { /* fall through */ }
    }
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".pbt-tr,script,style,noscript,.mw-editsection,button,[role='button']").forEach((n) => n.remove());
    // 标题只要自身文案，去掉嵌套块（防把正文拼进 h1）
    if (isHeading(el)) {
      clone.querySelectorAll(BLOCKS).forEach((n) => {
        if (n !== clone) n.remove();
      });
    }
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isHeading(el) {
    if (/^H[1-6]$/.test(el.tagName)) return true;
    if (el.getAttribute?.("role") === "heading") return true;
    return el?.dataset?.pbtRole === "hero";
  }

  function isMetaLine(el, text) {
    if (el.closest?.("time,relative-time,time-ago,[rel='author'],.byline,.author,.meta,.breadcrumb,.pagination,.share,.social,.tags")) return true;
    if (text.length < 48 && /^(home|next|previous|share|subscribe|sign in|log in|menu|skip to content|public|private|open|closed)$/i.test(text)) return true;
    if (text.length < 40 && /^\d{1,2}\s+\w+\s+\d{4}/.test(text)) return true;
    if (el.tagName === "LI") {
      const a = el.querySelector("a");
      if (a && text.length < 72 && textOf(a).length >= text.length * 0.85) return true;
    }
    return false;
  }

  function hanRatio(text) {
    const chars = String(text).replace(/\s+/g, "");
    if (!chars.length) return 0;
    const han = (chars.match(/[\u4e00-\u9fff]/g) || []).join("").length;
    return han / chars.length;
  }

  function hasLatin(text) {
    return /[A-Za-z]{2,}/.test(text);
  }

  /** 主要外文脚本：拉丁(含西欧变音)/假名/韩文/西里尔/阿语/希伯来/泰/希腊/天城文 等 */
  function hasForeignScript(text) {
    const t = String(text || "");
    if (/[A-Za-z\u00C0-\u024F]{2,}/.test(t)) return true;
    if (/[\u3040-\u30ff]/.test(t)) return true; // 日文假名
    if (/[\uac00-\ud7af]/.test(t)) return true; // 韩文
    if (/[\u0400-\u04ff]/.test(t)) return true; // 西里尔
    if (/[\u0600-\u06ff]/.test(t)) return true; // 阿拉伯
    if (/[\u0590-\u05ff]/.test(t)) return true; // 希伯来
    if (/[\u0e00-\u0e7f]/.test(t)) return true; // 泰
    if (/[\u0370-\u03ff]/.test(t)) return true; // 希腊
    if (/[\u0900-\u097f]/.test(t)) return true; // 天城文（印地等）
    if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(t)) return true;
    return false;
  }

  /** @deprecated alias — 收集门仍可调用 */
  function hasForeignToTranslate(text) {
    return hasForeignScript(text);
  }

  /** 已是目标中文：高汉字、无明显外文脚本 */
  function looksAlreadyChinese(text) {
    const t = String(text || "");
    if (/[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f\u0900-\u097f]/.test(t)) return false;
    const compact = t.replace(/\s+/g, "");
    if (compact.length < 2) return true;
    const ratio = hanRatio(t);
    if (ratio >= 0.7 && !/[A-Za-z]{4,}/.test(t)) return true;
    if (ratio >= 0.55 && !hasForeignScript(t)) return true;
    return false;
  }

  /** 已是英文（防英译英）：高拉丁、极少其它脚本 */
  function looksAlreadyEnglish(text) {
    const t = String(text || "");
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f\u0900-\u097f]/.test(t)) return false;
    const compact = t.replace(/\s+/g, "");
    if (compact.length < 2) return true;
    const latin = (t.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return latin / compact.length >= 0.55;
  }

  /**
   * 是否值得译：按目标语泛化脚本检测。
   * - zh-*：有外文脚本且非已是中文
   * - en：有非英文脚本（汉/假名/韩/西里尔/阿…）且非已是英文
   * - 其它：有「非目标」脚本迹象即可（保守放行长文）
   */
  function needsTranslate(text) {
    const t = String(text || "");
    if (!t || t.length < 2) return false;
    const lang = String(settings.targetLang || "zh-CN");
    if (/^zh\b/i.test(lang)) {
      if (looksAlreadyChinese(t)) return false;
      return hasForeignScript(t);
    }
    if (/^en\b/i.test(lang)) {
      if (looksAlreadyEnglish(t)) return false;
      return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f\u0900-\u097f]/.test(t);
    }
    if (/^ja\b/i.test(lang)) {
      if (/[\u3040-\u30ff]/.test(t) && hanRatio(t) < 0.15 && !/[A-Za-z]{4,}/.test(t)) return false;
      return hasLatin(t) || /[\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(t);
    }
    if (/^ko\b/i.test(lang)) {
      if (/[\uac00-\ud7af]/.test(t) && !hasLatin(t) && hanRatio(t) < 0.15) return false;
      return hasLatin(t) || /[\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff\u0600-\u06ff]/.test(t);
    }
    // 其它目标语：跳过纯目标脚本难判时，有拉丁或其它脚本且够长就译
    if (t.length < 4) return false;
    return hasForeignScript(t) || /[\u4e00-\u9fff]/.test(t);
  }


  /** 统计目标语脚本字符数（汉/假名/韩文） */
  function targetScriptCount(text, lang) {
    const t = String(text || "");
    if (/^zh\b/i.test(lang)) return (t.match(/[\u4e00-\u9fff]/g) || []).length;
    if (/^ja\b/i.test(lang)) return (t.match(/[\u3040-\u30ff]/g) || []).length;
    if (/^ko\b/i.test(lang)) return (t.match(/[\uac00-\ud7af]/g) || []).length;
    if (/^en\b/i.test(lang)) return (t.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return 0;
  }

  /**
   * 译文带来了原文没有的目标语脚本 → 真译文，绝不当回声。
   * 专名/年份留拉丁时 hanRatio 可低至 ~0.15；用「绝对字数 OR 比例」双门槛。
   */
  function carriesTargetScript(src, dst) {
    const lang = String(settings.targetLang || "zh-CN");
    if (/^zh\b/i.test(lang)) {
      if (hanRatio(src) >= 0.1) return false;
      const han = targetScriptCount(dst, lang);
      // ≥2 汉字且原文几乎无汉 → 真中译（含 Neovim/VSCode 堆专名的短句）
      if (han >= 2) return true;
      return hanRatio(dst) >= 0.15;
    }
    if (/^ja\b/i.test(lang)) {
      const n = targetScriptCount(dst, lang);
      return n >= 2 && targetScriptCount(src, lang) === 0;
    }
    if (/^ko\b/i.test(lang)) {
      const n = targetScriptCount(dst, lang);
      return n >= 2 && targetScriptCount(src, lang) === 0;
    }
    if (/^en\b/i.test(lang)) return looksAlreadyEnglish(dst) && !looksAlreadyEnglish(src);
    return false;
  }

  /**
   * 译文与原文同语 / 近回声 / 目标中文却仍外文主导：勿挂载。
   * true → 应 skip attach（markSkip same-lang）。
   * 白名单品牌 / 启发式人名不计入拉丁词集；与 Han 目标脚本门互补，
   * 避免「中文 + Tim Cook / Nike」被当成回声丢掉。
   *
   * 禁止用 min(|src|,|dst|) 做覆盖率：中译保留专名时 dst Latin ⊂ src Latin，
   * inter/min → 1.0，会把正确译文当回声丢掉（维基人名/年份尤甚）。
   */
  function nearEchoOverlap(src, dst) {
    // 目标语脚本门：有实质汉/假名/韩文则永不判回声；人名品牌经 pnStripForEcho 剥离
    if (carriesTargetScript(src, dst)) return false;
    const keep = preserveTermsForPair(src, dst);
    const s0 = PBT.pnStripForEcho(src, keep);
    const d0 = PBT.pnStripForEcho(dst, keep);
    const s = String(s0 || "").trim().toLowerCase();
    const d = String(d0 || "").trim().toLowerCase();
    if (!s || !d) return false;
    if (s.length >= 8 && d.length >= 8) {
      if (s.includes(d) || d.includes(s)) {
        const ratio = Math.min(s.length, d.length) / Math.max(s.length, d.length);
        if (ratio >= 0.72) return true;
      }
    }
    const words = (t) => t.split(/[^a-z0-9\u00c0-\u024f]+/i).filter((w) => w.length >= 2);
    const sw = words(s);
    const dw = words(d);
    if (sw.length >= 3 && dw.length >= 3) {
      const setS = new Set(sw);
      const setD = new Set(dw);
      let inter = 0;
      for (const w of setD) if (setS.has(w)) inter += 1;
      const uni = setS.size + setD.size - inter;
      // 仅 Jaccard：子集专名不会抬到阈值；真英译英两边词集接近才会命中
      if (uni && inter / uni >= 0.82) return true;
    }
    const sn = s.replace(/\s+/g, "");
    const dn = d.replace(/\s+/g, "");
    if (sn.length >= 6 && dn.length >= 6) {
      const grams = (t) => {
        const g = new Set();
        for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
        return g;
      };
      const gs = grams(sn);
      const gd = grams(dn);
      let inter = 0;
      for (const g of gd) if (gs.has(g)) inter += 1;
      // 用 max 分母，避免短 dst 被 min 抬成伪高覆盖
      const denom = Math.max(gs.size, gd.size);
      if (denom && inter / denom >= 0.85) {
        const lenRatio = Math.min(sn.length, dn.length) / Math.max(sn.length, dn.length);
        if (lenRatio >= 0.7) return true;
      }
    }
    return false;
  }

  function sameLanguageAsSource(src, dst) {
    const s = String(src || "").trim();
    const d = String(dst || "").trim();
    if (!d) return true;
    const sn = s.replace(/\s+/g, "");
    const dn = d.replace(/\s+/g, "");
    if (!dn) return true;
    if (sn === dn || sn.toLowerCase() === dn.toLowerCase()) return true;
    if (nearEchoOverlap(s, d)) return true;

    if (looksAlreadyChinese(s) && looksAlreadyChinese(d)) return true;
    if (looksAlreadyEnglish(s) && looksAlreadyEnglish(d)) return true;

    const looksJa = (t) => /[\u3040-\u30ff]/.test(t) && hanRatio(t) < 0.35 && !/[A-Za-z]{6,}/.test(t);
    const looksKo = (t) => /[\uac00-\ud7af]/.test(t) && !hasLatin(t) && hanRatio(t) < 0.2;
    const scriptDom = (re, t, thr) => {
      const c = String(t).replace(/\s+/g, "");
      if (!c.length) return false;
      const n = (String(t).match(re) || []).length;
      return n / c.length >= thr;
    };
    if (looksJa(s) && looksJa(d)) return true;
    if (looksKo(s) && looksKo(d)) return true;
    if (scriptDom(/[\u0400-\u04ff]/g, s, 0.45) && scriptDom(/[\u0400-\u04ff]/g, d, 0.45)) return true;
    if (scriptDom(/[\u0600-\u06ff]/g, s, 0.45) && scriptDom(/[\u0600-\u06ff]/g, d, 0.45)) return true;

    const lang = String(settings.targetLang || "zh-CN");
    if (/^zh\b/i.test(lang)) {
      const hr = hanRatio(d);
      if (hr < 0.12 && hasForeignScript(d)) {
        const latin = (d.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
        const foreignHeavy =
          latin / dn.length >= 0.4 ||
          /[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(d);
        if (foreignHeavy) return true;
      }
    }
    return false;
  }

  /** 专名回声：短、无句读、词首大写/标识符 → 原文即正解，永久保留原文 */
  function isProperNounEcho(src) {
    const s = String(src || "").trim();
    if (!s || s.length > 32) return false;
    if (/[。！？；.!?;,，:：]/.test(s)) return false;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;
    return words.every((w) => /^[A-Z0-9]/.test(w) || /[A-Z0-9]{2,}/.test(w) || /[._/-]/.test(w));
  }

  /**
   * 模型把原文照抄一份再附译文（「EN — ZH」/「EN（ZH）」/ 换行拼接）：只留译文段。
   * 否则宿主会被写成英中混排，等同 replace 模式下的「上英下中」。
   */
  function stripSourceEcho(src, dst) {
    const s = String(src || "").replace(/\s+/g, " ").trim();
    let d = String(dst || "").trim();
    if (!s || !d || s.length < 6) return dst;

    const lines = d.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (lines.length > 1) {
      const keep = lines.filter((ln) => !sameLanguageAsSource(s, ln));
      if (keep.length && keep.length < lines.length) d = keep.join(" ");
    }

    const flat = d.replace(/\s+/g, " ").trim();
    const lower = flat.toLowerCase();
    const sl = s.toLowerCase();
    let rest = "";
    if (lower.startsWith(sl)) rest = flat.slice(s.length);
    else if (lower.endsWith(sl)) rest = flat.slice(0, flat.length - s.length);
    else return d;

    rest = rest.replace(/^[\s—–\-−:：|·、,，.。/（(【\[]+/, "").replace(/[\s—–\-−:：|·、（(【\[)）\]】]+$/, "").trim();
    if (!rest || rest.length < 2) return d;
    if (sameLanguageAsSource(s, rest)) return d;
    return rest;
  }

  /** 上屏前统一清洗：折叠重复 + 去英文回声段 */
  function cleanTranslation(src, dst) {
    return stripSourceEcho(src, collapseRepeatedTranslation(dst));
  }

  /** 强启发式：疑似整页已是目标语（空收集 toast） */
  function looksAlreadyTargetLang(text) {
    const t = String(text || "");
    const lang = settings.targetLang || "zh-CN";
    const compact = t.replace(/\s+/g, "");
    if (compact.length < 24) return false;
    if (/^zh\b/i.test(lang)) {
      if (/[\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/.test(t)) return false;
      const ratio = hanRatio(t);
      const latin = (t.match(/[A-Za-z]/g) || []).length;
      return ratio >= 0.35 && latin < Math.max(16, Math.floor(compact.length * 0.08));
    }
    if (/^en\b/i.test(lang)) {
      return looksAlreadyEnglish(t) && !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t);
    }
    return false;
  }

  /** 浅层 open shadowRoot（最多一层），供 SPA/工具落地收集；不深挖 closed */
  function openShadowRoots(root, maxDepth) {
    const out = [];
    const depthCap = maxDepth == null ? 1 : maxDepth;
    if (!root || depthCap < 1) return out;
    try {
      const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for (const el of nodes) {
        const sr = el.shadowRoot;
        // 宿主本身就是 SKIP（relative-time / time / code…）：里面的文案同样不该收
        if (sr && !el.matches?.(SKIP_HARD) && !el.matches?.(SKIP)) out.push(sr);
      }
    } catch { /* ignore */ }
    return out;
  }

  /** closest()，但能跨 open shadow 边界上溯（自定义元素把文案放在 shadow 内） */
  function closestAcrossShadow(el, sel) {
    let n = el;
    while (n && n.nodeType === 1) {
      const hit = n.closest?.(sel);
      if (hit) return hit;
      const root = n.getRootNode?.();
      n = root && root.host ? root.host : null;
    }
    return null;
  }

  function looksLikeUrl(text) {
    const t = String(text || "").trim();
    if (!t || /\s/.test(t)) return false;
    if (/^(https?:\/\/|www\.)/i.test(t)) return true;
    if (/^[\w.-]+\.[a-z]{2,}(\/[\w./?#%&=+-]*)?$/i.test(t)) return true;
    return false;
  }

  function looksLikeRelativeTime(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 40) return false;
    if (/^(yesterday|today|just now|now)$/i.test(t)) return true;
    if (/^\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*ago$/i.test(t)) return true;
    if (/^(a|an)\s+(minute|hour|day|week|month|year)\s+ago$/i.test(t)) return true;
    if (/^(last|next|this)\s+(week|month|year)$/i.test(t)) return true;
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4}$/i.test(t)) return true;
    if (/^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i.test(t)) return true;
    if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(t)) return true;
    return false;
  }

  function looksLikeEmail(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 120 || /\s/.test(t)) return false;
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(t);
  }

  function looksLikeFilePath(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 160) return false;
    if (/\s/.test(t) && !/^[A-Za-z0-9._-]+\s*\/\s*[A-Za-z0-9._-]+$/.test(t)) return false;
    if (/^(~\/|\.\/|\.\.\/|\/)[\w./@+-]+$/.test(t)) return true;
    if (/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\/?$/.test(t)) return true; // a/b, agents/skills
    if (/\.(js|ts|tsx|jsx|mjs|cjs|json|md|txt|yml|yaml|toml|lock|css|html|svg|png|sh|py|rb|go|rs|conf|cfg)$/i.test(t) && !/\s/.test(t)) {
      return true;
    }
    return false;
  }

  function looksLikeIdentifier(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 64) return false;
    if (looksLikeEmail(t)) return true;
    if (looksLikeFilePath(t)) return true;
    // owner / repo（含「omacom / omarchy」带空格）
    if (/^[A-Za-z0-9._-]+\s*\/\s*[A-Za-z0-9._-]+$/.test(t)) return true;
    // 几乎只会出现在仓库文件树的路径段（整宿主=此词才跳；勿误伤导航文案 Plugins/Themes）
    if (/^(bin|lib|src|dist|build|node_modules|vendor|__pycache__|\.github|\.gitlab|\.vscode|\.idea)$/i.test(t)) {
      return true;
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(t)) return true; // owner/repo
    if (/^@?[A-Za-z][\w-]{0,38}$/.test(t) && !/^(Public|Private|Open|Closed|Code|Issues|Pull|About)$/i.test(t)) {
      // bare handle / single token — skip translating usernames
      if (!/\s/.test(t) && !/^(Who|What|Why|How|The|Our|Home)$/i.test(t)) {
        return (
          (/^[A-Za-z0-9][\w-]{2,}$/.test(t) && /\d/.test(t)) ||
          /^[a-z]+[0-9]+/i.test(t) ||
          /^[a-z]+_[a-z0-9]+$/i.test(t)
        );
      }
    }
    return false;
  }

  /** 多段路径/邮箱拼成一个宿主（文件列表被收到 ul 上）时整段跳过 */
  function looksLikeIdentifierBlob(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (looksLikeIdentifier(t)) return true;
    const normalized = t.replace(/\s*\/\s*/g, "/");
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 16) return false;
    return parts.every(
      (p) => looksLikeEmail(p) || looksLikeFilePath(p) || looksLikeIdentifier(p) || /^[A-Za-z0-9._+-]{1,40}$/.test(p)
    );
  }

  /** Google/Bing 等结果标题：链上 h3，after 易叠字 */
  function isSerpResultTitle(el) {
    if (!el || !isHeading(el)) return false;
    const host = location.hostname || "";
    if (!/(^|\.)google\.|bing\.com|duckduckgo\.com|search\.yahoo\./i.test(host)) return false;
    if (el.closest("a[href]")) return true;
    if (el.querySelector(":scope > a[href], :scope a[href]")) return true;
    // 结果卡内短标题
    if (el.closest("[data-sokoban-container], #search, #rso, .g, [data-hveid]")) {
      const t = textOf(el);
      if (t.length > 0 && t.length <= 160) return true;
    }
    return false;
  }

  /** GitHub 文件树/路径名/分支名不译 */
  function isRepoFileLabel(el, text) {
    const host = location.hostname || "";
    if (!/github\.com$/i.test(host) && !/gitlab\./i.test(host)) return false;
    const t = String(text || "").trim();
    if (!t) return false;
    // 目录行整行都是元数据（文件名 / 提交信息 / 时间列）：A5 一律不译
    if (closestAcrossShadow(el, REPO_FILE_ROW)) return true;
    if (el.closest("[aria-labelledby*='folder'], [data-testid*='file'], table[aria-labelledby]")) {
      if (t.length <= 80 && !/\s{2,}/.test(t)) return true;
    }
    if (/^\.[A-Za-z0-9._-]+$/.test(t)) return true; // .github
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]*$/.test(t) && t.length < 64) return true;
    return false;
  }

  /** A5：文件列表元数据 / 路径 / 相对时间 —— 任何采集路径都不译 */
  function isRowChromeText(el, text) {
    return isRepoFileLabel(el, text) || looksLikeRelativeTime(text);
  }

  function isTightClip(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      let n = el;
      for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.textOverflow === "ellipsis") return true;
        if (s.whiteSpace === "nowrap" && (s.overflow === "hidden" || s.overflowX === "hidden")) return true;
        if ((s.overflow === "hidden" || s.overflowY === "hidden") && n.clientHeight && n.scrollHeight <= n.clientHeight + 2) {
          const maxH = parseFloat(s.maxHeight);
          if (n.clientHeight < 48 || (!Number.isNaN(maxH) && maxH < 64)) return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  function isFragileLayout(el) {
    if (!el || el.nodeType !== 1) return false;
    // hero 大标题常在 overflow:hidden 营销壳内：仍允许挂 tr（靠 overflow:visible）
    const heroish = el.dataset?.pbtRole === "hero" || el.tagName === "H1";
    if (isTightClip(el) && !heroish) return true;
    const headingOk = isHeading(el) && textOf(el).length >= (el.dataset?.pbtRole === "hero" ? 8 : 12);
    try {
      const cs = getComputedStyle(el);
      // 大标题常含多 span / 自身 flex：不得因此整段跳过（Stripe/Apple/BBC hero）
      if (!headingOk && (cs.display.includes("flex") || cs.display.includes("grid")) && el.children.length >= 2) {
        if (textOf(el).length <= 100) return true;
      }
      if (!headingOk) {
        let n = el;
        for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.overflow === "hidden" || s.overflowX === "hidden" || s.overflowY === "hidden") {
            if (textOf(el).length <= 120) return true;
          }
        }
      }
      const p = el.parentElement;
      if (p) {
        const ps = getComputedStyle(p);
        const rowFlex =
          (ps.display.includes("flex") || ps.display.includes("grid")) &&
          ps.flexDirection !== "column" &&
          ps.flexDirection !== "column-reverse";
        if (rowFlex) {
          const t = textOf(el);
          // 维基折叠行：[箭头][短 h2] — after 仍抢宽；长标题/hero 放行，靠 insert 换行
          // 注意：Stripe hero 父级 grid 内常有 CTA button，不能用「祖先下任意 button」误杀 H1
          if (isHeading(el) || el.closest?.("h1,h2,h3,h4,h5,h6,[role='heading']")) {
            if (el.tagName === "H1" && t.length >= 18) {
              /* hero H1 永不因 row/grid 旁路 CTA 判 fragile */
            } else {
              const sibChrome = [...p.children].some(
                (c) =>
                  c !== el &&
                  c.matches?.(
                    "svg,button,[class*='chevron' i],[class*='arrow' i],[class*='toggle' i],.mw-editsection"
                  )
              );
              if (sibChrome && t.length <= 40) return true;
              if (!headingOk && t.length <= 32) return true;
            }
          } else {
            if (t.length <= 80 && (el.tagName === "A" || el.closest("a") || el.querySelector("svg,img"))) return true;
            if (t.length <= 48) return true;
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  function hostDisplayKind(el) {
    try {
      const d = getComputedStyle(el).display || "";
      if (d.includes("flex")) return "flex";
      if (d.includes("grid")) return "grid";
      if (d.includes("inline")) return "inline";
      return "block";
    } catch {
      return "block";
    }
  }

  /**
   * 宿主占着「一行里的一个格子」：插兄弟必然抢同行宽度或撑高行（LAYOUT A1）。
   * 两类：不换行的横向 flex 项（GitHub UnderlineNav）、单行高的表格/列表行内节点。
   * 这类宿主只许原地换字，不许 after() 插 .pbt-tr。
   */
  function isRowLockedHost(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const p = el.parentElement;
      if (p) {
        const ps = getComputedStyle(p);
        const rowFlex =
          (ps.display.includes("flex") || ps.display.includes("grid")) &&
          ps.flexDirection !== "column" &&
          ps.flexDirection !== "column-reverse";
        // nowrap：新兄弟换不了行，只能把容器固有宽度顶爆
        if (rowFlex && ps.flexWrap === "nowrap" && !ps.display.includes("grid")) return true;
      }
      const row = el.closest("tr,[role='row']");
      if (row) {
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 16) * 1.4;
        if (row.getBoundingClientRect().height <= lh * 2.2) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function isChipListItem(el) {
    // Google「还搜索了」类：父级横向 flex，多项短链
    if (!el || el.nodeType !== 1) return false;
    const p = el.parentElement;
    if (!p) return false;
    try {
      const ps = getComputedStyle(p);
      if (!(ps.display.includes("flex") || ps.display.includes("grid"))) return false;
      if (ps.flexDirection === "column" || ps.flexDirection === "column-reverse") return false;
      const kids = [...p.children].filter((c) => c.tagName === "A" || c.getAttribute?.("role") === "link");
      if (kids.length >= 3 && textOf(el).length <= 80) return true;
    } catch {
      return false;
    }
    return false;
  }

  function isProseTag(el) {
    return /^(P|H[1-6]|LI|BLOCKQUOTE|FIGCAPTION|DT|DD|ARTICLE|SECTION)$/.test(el.tagName)
      || el.getAttribute?.("role") === "heading"
      || el.dataset?.pbtRole === "prose";
  }

  function isEffectivelyVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (effectiveOpacity(el) < 0.08) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      // 屏外很远的副本仍可冷译；零尺寸副本跳过即可
      return true;
    } catch {
      return true;
    }
  }

  function worth(el, text) {
    if (!text) return false;
    if (el.getAttribute?.("translate") === "no" || el.classList?.contains("notranslate")) return false;
    if (!isEffectivelyVisible(el)) return false;
    // 隐私墙常把 main 设 aria-hidden：主文仍译；纯弹层隐藏节点跳过
    if (el.closest?.("[aria-hidden='true']")) {
      if (isConsentWall(el)) return false;
      // Stripe 渐变双层 H1：装饰层 aria-hidden，译了会双显
      if (isHeading(el) || el.dataset?.pbtRole === "hero") return false;
      if (!el.closest(MAIN_HINTS) && !/^(P|LI|BLOCKQUOTE)$/.test(el.tagName)) return false;
    }
    if (isConsentWall(el)) return false;
    // Google「翻译此页」等浏览器 chrome
    if (/翻译此页|Translate this page|Translate to\b/i.test(text)) return false;
    if (looksLikeUrl(text)) return false;
    if (looksLikeEmail(text)) return false;
    if (looksLikeRelativeTime(text)) return false;
    if (looksLikeIdentifier(text) || looksLikeIdentifierBlob(text)) return false;
    if (el.tagName === "CITE") return false;
    if (el.closest?.("relative-time,time-ago,time,[datetime]")) return false;
    // 芯片仍跳；replace 模式大幅放宽 fragile/tightClip（无双语兄弟，布局风险低）
    if (isChipListItem(el) || isChipListItem(el.parentElement)) return false;
    const textCtrl = isTextControl(el) || isContentLink(el) || isLabelLeaf(el);
    if (!textCtrl) {
      if (isReplaceFull()) {
        // 仅极短 nowrap+ellipsis 跳过
        if (isTightClip(el) && !(isHeading(el) || el.dataset?.pbtRole === "hero") && text.length < 8) return false;
      } else {
        if (isFragileLayout(el)) return false;
        if (isTightClip(el) && !(isHeading(el) || el.dataset?.pbtRole === "hero")) return false;
      }
    }
    // SERP 结果标题：要译（贴下方 stack）；芯片仍由 isChipListItem 挡
    if (isRepoFileLabel(el, text)) return false;
    // 折叠节标题：短标题+chevron 的横向 flex 不译；hero/长标题放行
    if (isHeading(el)) {
      const p = el.parentElement;
      if (p) {
        try {
          const ps = getComputedStyle(p);
          if (
            (ps.display.includes("flex") || ps.display.includes("grid")) &&
            ps.flexDirection !== "column" &&
            ps.flexDirection !== "column-reverse"
          ) {
            if (!(el.tagName === "H1" && text.length >= 18)) {
              const sibChrome = [...p.children].some(
                (c) =>
                  c !== el &&
                  c.matches?.(
                    "svg,button,[class*='chevron' i],[class*='arrow' i],[class*='toggle' i],.mw-editsection"
                  )
              );
              if (sibChrome && text.length <= 40) return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    if (!isPopupSurface(el) && isMetaLine(el, text)) return false;
    if (el.querySelector?.("img") && el.childNodes.length < 3 && text.length < 40 && !needsTranslate(text)) return false;
    if (text.length < 2) return false;
    return needsTranslate(text);
  }

  function wordCount(el) {
    return (el.innerText || "").match(/\S+/g)?.length || 0;
  }

  function climbToContent() {
    const pageWords = wordCount(document.body);
    if (!pageWords) return document.body;
    let nodes = [...document.body.querySelectorAll("p")].filter((p) => !isStructure(p) && !isSkip(p) && p.offsetHeight);
    if (!nodes.length) {
      nodes = [...document.body.querySelectorAll("div")].filter((d) => !isStructure(d) && !isSkip(d) && d.offsetHeight);
    }
    let dense = document.body;
    let denseN = 0;
    for (const n of nodes) {
      const w = wordCount(n);
      if (w > denseN) {
        dense = n;
        denseN = w;
      }
    }
    let box = dense.tagName === "P" ? dense.parentElement : dense;
    while (box && box !== document.body && box.parentElement && wordCount(box) / pageWords < 0.4) {
      box = box.parentElement;
    }
    if (box?.tagName === "P") box = box.parentElement;
    return box || document.body;
  }

  function findMainRoot() {
    const found = [...document.querySelectorAll(MAIN_HINTS)].filter((el) => !isStructure(el));
    if (found.length) return found.sort((a, b) => textOf(b).length - textOf(a).length)[0];
    return climbToContent();
  }

  function pushBlock(out, seen, el) {
    if (!el || isSkip(el) || isStructure(el)) return;
    if (el.closest(".pbt-tr") || el.closest(".pbt-float")) return;
    if (seen.has(el)) return;
    if (el.dataset?.pbtState === "skip" || el.dataset?.pbtState === "ok" || el.classList?.contains("pbt-skip")) return;
    // 祖先若含其它散文块子节点，不收集（留给叶子 p/h/li）
    if (el.querySelector?.(BLOCKS)) return;
    const text = textOf(el);
    if (!worth(el, text)) return;
    seen.add(el);
    if (el.dataset.pbtRole !== "hero" && el.dataset.pbtRole !== "control") {
      if (isTextControl(el) || isLabelLeaf(el)) el.dataset.pbtRole = "control";
      else el.dataset.pbtRole = "prose";
    }
    out.push({ el, text });
  }

  function looksLikeHeroTitle(el) {
    if (!el || el.nodeType !== 1) return false;
    if (/^H[1-6]$/.test(el.tagName) || el.getAttribute?.("role") === "heading") return false;
    if (el.closest?.(SKIP_HARD) || isConsentWall(el)) return false;
    // header/nav chrome：仍允许大字营销标题（Apple/Stripe）
    if (el.closest?.(CHROME)) {
      const inNav = !!el.closest("nav,footer,aside,[role='navigation'],[role='contentinfo']");
      if (inNav) return false;
    }
    // 不用全量 isStructure：sticky 外壳会误杀 Verge 等站大标题
    if (el.querySelector?.(BLOCKS)) return false;
    // Apple 等营销标题常多 span 嵌套
    if (el.children.length > 10) return false;
    try {
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize) || 0;
      if (px < 20) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 64 || r.height < 14) return false;
      if (effectiveOpacity(el) < 0.08) return false;
      const text = textOf(el);
      // iPhone 16 Pro / AirPods 等短英雄标题
      if (!needsTranslate(text) || text.length < 8 || text.length > 160) return false;
      if (text.length >= 48 && px < 24) return false;
      // 视口内大字优先认 hero
      const vh = window.innerHeight || 800;
      if (r.top > vh * 1.2) return false;
      return true;
    } catch {
      return false;
    }
  }

  function collectFromRoot(root) {
    const out = [];
    const seen = new Set();
    for (const el of root.querySelectorAll(BLOCKS)) pushBlock(out, seen, el);
    // 散文补充：main/article 内接近段落的 div（不扫 a/td/chip）
    const proseRoot = root.querySelector?.(MAIN_HINTS) || root;
    for (const el of proseRoot.querySelectorAll("div")) {
      if (seen.has(el)) continue;
      if (el.closest?.(SKIP) || isStructure(el)) continue;
      if (el.children.length > 3 && !looksLikeHeroTitle(el)) continue;
      if (el.querySelector?.(BLOCKS)) continue;
      // 多子块包装器：子级各自有长文案时只译叶子，勿拼父级
      if (hasMultipleProseChildren(el)) continue;
      if (isFragileLayout(el) || isChipListItem(el)) continue;
      const text = textOf(el);
      const hero = looksLikeHeroTitle(el);
      if (!needsTranslate(text) || text.length > 800) continue;
      if (!hero && text.length < (isReplaceFull() ? 8 : 18)) continue;
      let dup = false;
      for (const p of seen) {
        if (p.contains?.(el) && Math.abs(textOf(p).length - text.length) < 8) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      if (hero) el.dataset.pbtRole = "hero";
      pushBlock(out, seen, el);
    }
    // 全页扫一层大字号短标题（Verge/Apple 等不在 main 提示符内的 hero）
    const heroSel =
      "div,a,p,span,section,[role='heading'],[class*='hero' i],[class*='Hero' i],[class*='headline' i],[class*='Headline' i],[class*='display' i],[data-analytics-section-engagement*='unit' i]";
    for (const el of root.querySelectorAll(heroSel)) {
      if (seen.has(el)) continue;
      if (!looksLikeHeroTitle(el)) continue;
      if (isFragileLayout(el) || isChipListItem(el)) continue;
      el.dataset.pbtRole = "hero";
      pushBlock(out, seen, el);
    }
    // Apple-like 自定义元素（带连字符 tag）大字标题
    let customN = 0;
    for (const el of root.querySelectorAll("*")) {
      if (customN >= 120) break;
      if (!el.tagName || !el.tagName.includes("-")) continue;
      customN += 1;
      if (seen.has(el)) continue;
      if (!looksLikeHeroTitle(el)) continue;
      if (isFragileLayout(el) || isChipListItem(el)) continue;
      el.dataset.pbtRole = "hero";
      pushBlock(out, seen, el);
    }
    // SPA 文案按钮 / 超链接 / label / 抽屉·对话框内交互叶
    for (const el of root.querySelectorAll("button,[role='button'],[role='tab'],a[href],label")) {
      if (seen.has(el)) continue;
      if (isTextControl(el) || isLabelLeaf(el)) {
        el.dataset.pbtRole = "control";
        pushBlock(out, seen, el);
      } else if (isContentLink(el)) {
        el.dataset.pbtRole = "prose";
        pushBlock(out, seen, el);
      }
    }
    // 打开的 drawer/dialog/sheet：再扫一遍交互叶与短文（防 isSkip 漏）
    for (const panel of root.querySelectorAll(POPUP)) {
      if (!isEffectivelyVisible(panel)) continue;
      for (const el of panel.querySelectorAll("button,[role='button'],[role='tab'],a[href],"+MENU_ITEM_SEL+",label,span,div,p,li,h1,h2,h3,h4")) {
        if (seen.has(el) || isSettledPbt(el)) continue;
        if (el.querySelector?.(BLOCKS) && !isTextControl(el) && !isContentLink(el) && !isMenuItemEl(el)) continue;
        if (isTextControl(el) || isContentLink(el) || isMenuItemEl(el)) {
          if (isMenuItemEl(el)) {
            const text = textOf(el);
            if (!needsTranslate(text) || text.length < 2) continue;
            if (!isEffectivelyVisible(el)) continue;
            seen.add(el);
            out.push({ el, text });
          } else {
            el.dataset.pbtRole = isTextControl(el) ? "control" : "prose";
            pushBlock(out, seen, el);
          }
          continue;
        }
        // 抽屉内散文短叶
        if (isSkip(el) || isStructure(el)) continue;
        const text = textOf(el);
        if (!worth(el, text) || text.length > 400) continue;
        seen.add(el);
        out.push({ el, text });
      }
    }
    // 浅层 open shadow：工具落地/SPA/Apple 正文常在 shadow 内
    for (const sr of openShadowRoots(root, 1)) {
      for (const el of sr.querySelectorAll(BLOCKS)) pushBlock(out, seen, el);
      for (const el of sr.querySelectorAll(heroSel)) {
        if (seen.has(el)) continue;
        if (!looksLikeHeroTitle(el)) continue;
        el.dataset.pbtRole = "hero";
        pushBlock(out, seen, el);
      }
      for (const el of sr.querySelectorAll("button,[role='button'],[role='tab'],a[href],label")) {
        if (seen.has(el)) continue;
        if (isTextControl(el) || isLabelLeaf(el)) {
          el.dataset.pbtRole = "control";
          pushBlock(out, seen, el);
        } else if (isContentLink(el)) {
          el.dataset.pbtRole = "prose";
          pushBlock(out, seen, el);
        }
      }
    }
    return pruneAncestorBlocks(out);
  }

  /** 父级下多个块级子节点各自有段落级文案 → 父级是容器非叶子 */
  function hasMultipleProseChildren(el) {
    if (!el || !el.children || el.children.length < 2) return false;
    let n = 0;
    for (const c of el.children) {
      if (c.nodeType !== 1) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|IMG|BR|HR)$/.test(c.tagName)) continue;
      const t = textOf(c);
      if (needsTranslate(t) && t.length >= 24) n += 1;
      if (n >= 2) return true;
    }
    return false;
  }

  function isCollectBlock(el) {
    try {
      return !!el?.matches?.(BLOCKS);
    } catch {
      return false;
    }
  }

  /** Prefer BLOCK units (p/h/li) over descendant leaves; still drop non-block wrappers. */
  function pruneAncestorBlocks(blocks) {
    if (!blocks.length) return blocks;
    const els = blocks.map((b) => b.el);
    return blocks.filter(({ el }) => {
      for (const other of els) {
        if (other === el) continue;
        if (other.contains(el) && isCollectBlock(other)) return false;
        if (el.contains(other) && !isCollectBlock(el)) return false;
      }
      return true;
    });
  }

  function collect(scope) {
    const mode = scope || settings.scope || "main";
    let out = collectFromRoot(mode === "full" ? document.body : findMainRoot());
    if (!out.length && mode !== "full") out = collectFromRoot(document.body);
    // replace/full：始终补扫叶子短文，避免「只收到几个 p」漏掉大量 span/div/button
    if (mode === "full" || isReplaceFull()) {
      const extra = collectLooseLatin(document.body);
      if (extra.length) {
        const seen = new Set(out.map((b) => b.el));
        for (const b of extra) {
          if (seen.has(b.el)) continue;
          if (out.some((a) => a.el.contains(b.el) && isCollectBlock(a.el))) continue;
          seen.add(b.el);
          out.push(b);
        }
        out = pruneAncestorBlocks(out);
      }
    } else if (!out.length) {
      out = collectLooseLatin(document.body);
    }
    // 收尾统一否决站点行 chrome：散叶/合并父级等旁路不过 worth()，只有这里挡得住（A5）
    return out.filter((b) => !isRowChromeText(b.el, b.text));
  }

  /** 是否「结构安全」：仅极小纯文本叶可 textContent；hero/大标题/有结构一律否 */
  function canSafelyReplaceText(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.dataset?.pbtRole === "hero") return false;
    if (el.querySelector("a,button,input,textarea,select,svg,img,video,iframe,canvas,form,ul,ol,table,section,article")) return false;
    const kids = [...el.children].filter((c) => !/^(BR|WBR)$/.test(c.tagName));
    if (kids.length) return false;
    try {
      const px = parseFloat(getComputedStyle(el).fontSize) || 16;
      if (isHeading(el) && px >= 22) return false;
      const r = el.getBoundingClientRect();
      // 默认仅译文走 hide-visual；textContent 仅白名单矮叶（<80px）
      if (r.height > 80) return false;
      if (r.height > Math.min(80, (window.innerHeight || 800) * 0.12)) return false;
    } catch { /* ignore */ }
    return true;
  }

  /** BLOCKS 空时兜底：只收真叶子短英文，绝不收大容器（cursor.com 等工具落地页） */
  function collectLooseLatin(root) {
    const out = [];
    const seen = new Set();
    const roots = [root, ...openShadowRoots(root, 1)];
    const cap = isReplaceFull() ? 220 : 64;
    for (const scanRoot of roots) {
      if (!scanRoot) continue;
      // 交互叶优先补收
      for (const el of scanRoot.querySelectorAll("button,[role='button'],[role='tab'],a[href],label")) {
        if (out.length >= cap) break;
        if (seen.has(el) || isSettledPbt(el)) continue;
        if (!(isTextControl(el) || isContentLink(el) || isLabelLeaf(el))) continue;
        const text = textOf(el);
        seen.add(el);
        el.dataset.pbtRole = isTextControl(el) || isLabelLeaf(el) ? "control" : "prose";
        out.push({ el, text });
      }
      for (const el of scanRoot.querySelectorAll("h1,h2,h3,h4,p,span,label,li,div")) {
        if (out.length >= cap) break;
        if (seen.has(el)) continue;
        if (isSkip(el) || el.closest?.(SKIP_HARD)) continue;
        // replace：不因嵌在 nav/footer 丢叶子；仍跳过表单控件
        if (el.closest?.("input,textarea,select")) continue;
        if (!isReplaceFull() && el.closest?.("button,[role='button'],nav,footer")) continue;
        const hero = looksLikeHeroTitle(el) || isHeading(el);
        const heavy = [...el.children].filter((c) => !/^(BR|WBR|SVG|IMG|SPAN)$/.test(c.tagName));
        if (!hero && heavy.length) continue;
        if (!hero && el.querySelector?.("div,p,h1,h2,h3,ul,ol,section,article")) continue;
        const text = textOf(el);
        const minLen = hero ? 8 : (isReplaceFull() ? 6 : 12);
        if (!needsTranslate(text) || text.length < minLen || text.length > 200) continue;
        if (looksLikeUrl(text) || looksLikeEmail(text) || looksLikeIdentifier(text) || looksLikeIdentifierBlob(text) || isConsentWall(el)) continue;
        if (!isEffectivelyVisible(el)) continue;
        try {
          const r = el.getBoundingClientRect();
          if (r.width < 24) continue;
          if (!hero && r.height > 160) continue;
          if (hero && r.height > 280) continue;
        } catch { /* ignore */ }
        let anc = false;
        for (const s of seen) {
          if (s.contains?.(el)) { anc = true; break; }
        }
        if (anc) continue;
        seen.add(el);
        el.dataset.pbtRole = hero ? "hero" : "prose";
        out.push({ el, text });
      }
    }
    return mergeAdjacentShortLeaves(pruneAncestorBlocks(out));
  }

  /** 相邻短叶合并：同父下相邻 sibling，合计 < ~120 字 → 少 API、少闪烁 */
  function siblingsClose(a, b) {
    if (!a || !b || a.parentElement !== b.parentElement) return false;
    let n = a.nextSibling;
    while (n && n !== b) {
      if (n.nodeType === 3) {
        if (String(n.textContent || "").trim()) return false;
      } else if (n.nodeType === 1) {
        if (/^(BR|WBR)$/.test(n.tagName)) {
          /* ok */
        } else if (/^(SVG|IMG|I|SPAN)$/.test(n.tagName) && !String(n.textContent || "").trim()) {
          /* decorative */
        } else if (!String(n.textContent || "").trim()) {
          /* empty */
        } else {
          return false;
        }
      }
      n = n.nextSibling;
    }
    return n === b;
  }

  function mergeAdjacentShortLeaves(blocks) {
    const MAX = PBT_MERGE_CHARS;
    if (!blocks || blocks.length < 2) return blocks || [];
    const skip = new Set();
    const out = [];
    for (let i = 0; i < blocks.length; i++) {
      const a = blocks[i];
      if (!a?.el || skip.has(a.el)) continue;
      const parent = a.el.parentElement;
      const aLen = String(a.text || "").length;
      if (!parent || aLen >= MAX || aLen >= 80) {
        out.push(a);
        continue;
      }
      const group = [a];
      let total = aLen;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (!b?.el || skip.has(b.el)) continue;
        if (b.el.parentElement !== parent) break;
        if (!siblingsClose(group[group.length - 1].el, b.el)) break;
        const bl = String(b.text || "").length;
        if (bl >= 80) break;
        if (total + bl > MAX) break;
        group.push(b);
        total += bl;
      }
      if (group.length >= 2) {
        let useParent = false;
        try {
          const pText = textOf(parent);
          const heavy = [...parent.children].filter((c) => !/^(BR|WBR|SVG|IMG|SPAN|I|B|EM|STRONG|A)$/.test(c.tagName));
          useParent =
            pText.length > 0 &&
            pText.length <= MAX + 24 &&
            pText.length >= Math.floor(total * 0.65) &&
            !isSettledPbt(parent) &&
            !isSkip(parent) &&
            !parent.closest?.(".pbt-host,.pbt-tr") &&
            heavy.length <= group.length + 1 &&
            needsTranslate(pText);
        } catch { useParent = false; }
        if (useParent) {
          const pText = textOf(parent);
          // 文件列表短叶合并到 ul 后会变成「bin agents/skills …」整段误译 → 直接丢弃
          if (looksLikeIdentifier(pText) || looksLikeIdentifierBlob(pText)) {
            for (const g of group) skip.add(g.el);
            continue;
          }
          parent.dataset.pbtRole = parent.dataset.pbtRole || "prose";
          out.push({ el: parent, text: pText });
          for (const g of group) skip.add(g.el);
          continue;
        }
      }
      out.push(a);
    }
    return pruneAncestorBlocks(out);
  }

  function ensureId(el) {
    if (!el.dataset.pbtId) el.dataset.pbtId = `p${++seq}`;
    return el.dataset.pbtId;
  }


  /** 按字体栈从左到右判定：先命中衬线→宋体；先命中无衬线→继承。修「Georgia, sans-serif」被误判成无衬线。 */
  function isSerifFamily(ff) {
    const s = String(ff || "").toLowerCase().replace(/["']/g, "");
    const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
    const serifRe =
      /^(serif|ui-serif)$|\b(times|times new roman|georgia|garamond|palatino|cambria|constantia|libertinus|libertine|bookerly|charter|literata|merriweather|lora|baskerville|libre baskerville|caslon|didot|bodoni|playfair|crimson|eb garamond|pt serif|source serif|noto serif|roboto serif|ibm plex serif|newsreader|iowan|new york|hoefler|minion|trajan|simsun|songti|stsong|song|宋体|明体|mingliu|ming|batang|nsimsun)\b/;
    const sansRe =
      /^(sans-serif|ui-sans-serif|system-ui|-apple-system|blinkmacsystemfont)$|\b(arial|helvetica|helvetica neue|roboto|inter|segoe ui|verdana|tahoma|trebuchet|noto sans|pingfang|hiragino sans|hiragino kaku|microsoft yahei|msyh|source sans|ibm plex sans|ubuntu|cantarell|fira sans|open sans|lato|montserrat|poppins|nunito|work sans|sf pro|san francisco)\b/;
    for (const part of parts) {
      if (serifRe.test(part)) return true;
      if (sansRe.test(part)) return false;
    }
    return false;
  }

  function paintColorFrom(el) {
    try {
      const cs = getComputedStyle(el);
      let fill = "";
      try {
        fill = cs.webkitTextFillColor || "";
      } catch { /* ignore */ }
      const fillRgb = parseRgb(fill);
      // 非透明 fill 才是真正上色（渐变字常 color=transparent + fill 有色/透明）
      if (fill && fill !== "transparent" && fillRgb && fillRgb.a >= 0.12) return fill;
      let col = cs.color || "";
      const m = String(col).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
      if (!col || col === "transparent" || (m && Number(m[4] || 1) < 0.12)) {
        let p = el.parentElement;
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
          const got = paintColorFrom(p);
          if (got) return got;
        }
        return "";
      }
      return col;
    } catch {
      return "";
    }
  }

  function applyTypeMatch(el, host) {
    const cs = getComputedStyle(el);
    const srcPx = parseFloat(cs.fontSize) || 16;
    // 大标题（h1/h2 或 ≥18px 的 heading）：译文固定小两号（中文字号约 2pt/号 → 4pt）
    let trPx = srcPx;
    if (isHeading(el) && srcPx >= 18) {
      const twoHao = (4 * 96) / 72; // 4pt
      trPx = Math.max(12, srcPx - twoHao);
    }
    host.style.setProperty("--pbt-size", `${trPx}px`);
    host.style.setProperty("--pbt-weight", cs.fontWeight);
    // 严格对照原文：computed color；非透明 -webkit-text-fill-color 优先
    let col = paintColorFrom(el) || cs.color || "";
    const rgb = parseRgb(col);
    // 仅当真近不可见时才对比救援；禁止默认灰/主题色冲淡
    if (!col || col === "transparent" || (rgb && rgb.a < 0.12)) {
      col = forceReadableColor(el, col || "#1f2937");
    } else {
      const rescued = forceReadableColor(el, col);
      // 仅当对比灾难性（返回值与原色差很大且原色近底色）才采用救援
      if (rescued !== col) {
        const L = relativeLuminance(rgb);
        const bgL = sampleBgLuminance(el);
        if (Math.abs(L - bgL) < 0.12) col = rescued;
      }
    }
    host.style.setProperty("--pbt-color", col);
    host.style.setProperty("--pbt-fill", col);
    host.style.setProperty("--pbt-tr-mix", "100%");
    host.style.setProperty("--pbt-tr-opacity", "1");
    if (isHeading(el) || el.dataset?.pbtRole === "hero") {
      host.style.setProperty("--pbt-tr-mix", "100%");
      host.style.setProperty("--pbt-tr-opacity", "1");
    }
    const lh = cs.lineHeight;
    host.style.setProperty("--pbt-lh", lh === "normal" ? "1.45" : lh);
    host.style.setProperty("--pbt-ls", cs.letterSpacing);
    if (isSerifFamily(cs.fontFamily)) {
      host.style.setProperty(
        "--pbt-ff",
        '"Songti SC","Songti TC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun","宋体",serif'
      );
    } else {
      host.style.setProperty("--pbt-ff", "inherit");
    }
  }

  /** 手机强制上下；桌面离屏测宽；绝不改宿主 display */
  function isMobileViewport() {
    try {
      return window.matchMedia("(max-width: 600px)").matches || window.innerWidth < 600;
    } catch {
      return (window.innerWidth || 360) < 600;
    }
  }

  function measureNeedsStack(el, srcText, trText) {
    try {
      const r = el.getBoundingClientRect();
      if (!r.width) return true;
      const cs = getComputedStyle(el);
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none;";
      probe.style.font = cs.font;
      probe.style.fontSize = cs.fontSize;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.textContent = `${srcText} · ${trText}`;
      document.documentElement.appendChild(probe);
      const w = probe.scrollWidth;
      probe.remove();
      return w > r.width * 0.92;
    } catch {
      return true;
    }
  }

  function pickLayout(el, text, trText) {
    const t = String(text || textOf(el) || "").trim();
    if (!t) return "stack";
    if (isMobileViewport()) return "stack";
    if (isHeading(el) || isPopupSurface(el)) return "stack";
    const kind = hostDisplayKind(el);
    if (kind === "flex" || kind === "grid") return "stack";
    if (isFragileLayout(el) || isProseTag(el) === false && el.children.length >= 2) return "stack";
    if (trText && measureNeedsStack(el, t, trText)) return "stack";
    if (t.length <= 48 && kind === "inline") return "row";
    return "stack";
  }

  function applyLayout(el, trNode, text, trText) {
    const layout = pickLayout(el, text, trText);
    el.dataset.pbtLayout = layout;
    if (trNode) {
      trNode.classList.toggle("pbt-layout-row", layout === "row");
      trNode.classList.toggle("pbt-layout-stack", layout === "stack");
      if (layout === "row") {
        requestAnimationFrame(() => {
          try {
            if (trNode.getClientRects().length > 1) {
              trNode.classList.remove("pbt-layout-row");
              trNode.classList.add("pbt-layout-stack");
              el.dataset.pbtLayout = "stack";
            }
          } catch { /* ignore */ }
        });
      }
    }
    return layout;
  }


  /** 模型偶发把同一中文句重复 2–3 遍；折叠为一次再上屏 */
  function collapseRepeatedTranslation(text) {
    let t = String(text || "").trim();
    if (!t || t.length < 4) return t;
    // 整串精确重复 ×2 / ×3
    for (let n = 2; n <= 3; n++) {
      if (t.length % n !== 0) continue;
      const part = t.slice(0, t.length / n);
      if (part && part.repeat(n) === t) return part.trim();
    }
    // 无分隔：中文密接重复
    const m = t.match(/^(.{4,}?)\1{1,2}$/u);
    if (m) return m[1].trim();
    // 单空格/少量空白分隔的同句重复（Linear 英雄常见）
    const mSp = t.match(/^(.{4,}?)\s+\1(?:\s+\1)?$/u);
    if (mSp && mSp[1].replace(/\s+/g, "").length >= 4) return mSp[1].trim();
    // 带句读重复："甲。甲。甲。" / "甲！甲！"
    const m2 = t.match(/^(.+?[。！？；.!?;，,])\1{1,2}$/u);
    if (m2 && m2[1].replace(/\s+/g, "").length >= 4) return m2[1].trim();
    // 任意空白分隔：各段完全相同则折叠
    const parts = t.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4 && parts[0].length >= 4 && parts.every((p) => p === parts[0])) {
      return parts[0];
    }
    // 两段长句用单空格拼接（整句重复）
    const mid = Math.floor(t.length / 2);
    for (const cut of [mid, mid - 1, mid + 1]) {
      if (cut < 4 || cut >= t.length - 4) continue;
      const a = t.slice(0, cut).trim();
      const b = t.slice(cut).trim();
      if (a.length >= 4 && a === b) return a;
    }
    return t;
  }

  /** 数字/$/%/B/M 占比高的短串：禁止 anywhere 折行弄断 */
  function isNumberHeavyRun(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 96) return false;
    const dig = (t.match(/[\d$€£¥%.,+\-–—]/g) || []).length;
    if (dig < 2) return false;
    return dig / t.length >= 0.4;
  }

  function parseRgb(col) {
    const s = String(col || "");
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  }

  function relativeLuminance(rgb) {
    if (!rgb) return 0.5;
    const lin = (c) => {
      const x = c / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  }

  function sampleBgLuminance(el) {
    try {
      let n = el;
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        const rgb = parseRgb(bg);
        if (!rgb || rgb.a < 0.15) continue;
        return relativeLuminance(rgb);
      }
    } catch { /* ignore */ }
    return 0.96; // 默认偏亮底
  }

  /** 近透明 / 霓虹浅绿 / 与底对比过低 → 强制可读实色 */
  function forceReadableColor(el, col) {
    const rgb = parseRgb(col);
    const bgL = sampleBgLuminance(el);
    const dark = "#1f2937";
    const light = "#f8fafc";
    if (!rgb || col === "transparent" || rgb.a < 0.18) return bgL > 0.55 ? dark : light;
    const L = relativeLuminance(rgb);
    // Stripe 等：浅绿/青低饱和 + 透明叠色 → 几乎看不见
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const greenish = rgb.g > rgb.r + 20 && rgb.g > rgb.b + 10;
    if (greenish && (L > 0.55 || sat < 0.35)) return bgL > 0.45 ? dark : light;
    // 对比粗判：与底同亮/同暗
    if (Math.abs(L - bgL) < 0.22) return bgL > 0.55 ? dark : light;
    if (bgL > 0.7 && L > 0.62) return dark;
    if (bgL < 0.3 && L < 0.38) return light;
    return col;
  }


  // REPLACE-TYPO-SPEC.md — 思源黑/宋栈与映射
  const PBT_HEI_STACK =
    '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Source Han Sans SC","Microsoft YaHei",system-ui,sans-serif';
  const PBT_SONG_STACK =
    '"Songti SC","STSong","Noto Serif SC","Source Han Serif SC","SimSun",serif';
  const PBT_MONO_STACK =
    '"Sarasa Mono SC","Noto Sans Mono CJK SC","ui-monospace",monospace';

  function isMonoFamily(ff) {
    const s = String(ff || "").toLowerCase().replace(/["']/g, "");
    return /\b(mono|menlo|consolas|courier|source code|fira code|jetbrains|sarasa|ui-monospace)\b/.test(s);
  }

  function replaceRole(el, srcPx) {
    const tag = (el.tagName || "").toUpperCase();
    const role = el.dataset?.pbtRole || "";
    if (role === "control" || isTextControl(el) || /^(BUTTON)$/.test(tag) || el.getAttribute?.("role") === "tab") {
      return "control";
    }
    if (tag === "H1" || role === "hero" || srcPx >= 28) return "h1";
    if (/^H[23]$/.test(tag) || (srcPx >= 20 && srcPx <= 27 && isHeading(el))) return "h2";
    if (isHeading(el) || role === "hero") return srcPx >= 28 ? "h1" : "h2";
    if (srcPx <= 13) return "meta";
    return "body";
  }

  /** 规格 §2 字号映射（computed px） */
  function mapReplaceSizePx(srcPx, role) {
    const px = srcPx || 16;
    if (px <= 11) return 12;
    if (px <= 13) return px; // 同宿主；辅文
    if (px <= 20) return px;
    if (px <= 28) return Math.max(14, px - 1); // 必要时 −1
    if (px <= 40) return Math.round(px * 0.95);
    return Math.round(px * 0.92);
  }

  /** 规格 §3 字重；serif=true 走宋列 */
  function mapReplaceWeight(w, serif, role, el) {
    let n = Number.parseInt(String(w), 10);
    if (!Number.isFinite(n)) n = 400;
    try {
      if (el && el.closest && el.closest("b,strong")) n = Math.max(n, 700);
      else if (el && /^(B|STRONG)$/.test(el.tagName)) n = Math.max(n, 700);
    } catch { /* ignore */ }
    if (role === "control") return String(Math.max(600, n >= 700 ? 700 : 600));
    if (role === "h1") {
      if (n >= 800) return serif ? "700" : "800";
      return "700";
    }
    if (role === "h2") {
      if (n >= 700) return "700";
      return "600";
    }
    // body / meta
    if (n <= 300) return "300";
    if (n <= 400) return "400";
    if (n <= 500) return serif ? "500" : "500";
    if (n <= 600) return "600";
    if (n <= 700) return "700";
    return serif ? "700" : "800";
  }

  function unitlessLineHeight(cs, srcPx) {
    const lh = cs.lineHeight;
    if (!lh || lh === "normal") return null;
    if (String(lh).endsWith("px")) return (parseFloat(lh) || srcPx * 1.4) / (srcPx || 16);
    const n = parseFloat(lh);
    return Number.isFinite(n) ? n : null;
  }

  /** 整页替换排版：computed → map(size/weight/family) → 中文地板与对比（REPLACE-TYPO-SPEC） */
  function applyReplaceTypography(el, srcCs) {
    if (!el) return;
    let cs = srcCs;
    try {
      if (!cs) cs = getComputedStyle(el);
    } catch {
      return;
    }
    const srcPx = parseFloat(cs.fontSize) || 16;
    const role = replaceRole(el, srcPx);
    const mono = isMonoFamily(cs.fontFamily);
    // 标题即便正文站点偏宋，H1/英雄走黑；H2 随宿主 serif；正文/辅文按 isSerifFamily
    let useSong = false;
    if (role === "h1" || role === "control") useSong = false;
    else if (mono && role === "body") useSong = false;
    else useSong = isSerifFamily(cs.fontFamily);

    let ff = useSong ? PBT_SONG_STACK : PBT_HEI_STACK;
    if (mono && role !== "body" && role !== "meta" && role !== "h1" && role !== "h2" && role !== "control") {
      ff = PBT_MONO_STACK;
    } else if (mono && /code|pre|kbd|samp/i.test(el.tagName || "")) {
      ff = PBT_MONO_STACK;
    }

    const px = mapReplaceSizePx(srcPx, role);
    const weight = mapReplaceWeight(cs.fontWeight, useSong, role, el);

    // 颜色：替换模式严格保留宿主色（勿主题灰）；仅透明/clip-text 才实色
    let col = paintColorFrom(el) || cs.color || "";
    let inheritColor = true;
    let clipText = false;
    try {
      clipText =
        /text/i.test(cs.webkitBackgroundClip || "") || /text/i.test(cs.backgroundClip || "");
    } catch { /* ignore */ }
    try {
      const m = String(col).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
      const nearClear = !col || col === "transparent" || (m && Number(m[4] || 1) < 0.18);
      if (nearClear || clipText) {
        inheritColor = false;
        if (!col || nearClear) {
          let p = el.parentElement;
          for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
            const pc = paintColorFrom(p) || getComputedStyle(p).color;
            const pm = String(pc).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/i);
            if (pc && pc !== "transparent" && !(pm && Number(pm[4] || 1) < 0.18)) {
              col = pc;
              break;
            }
          }
        }
        if (!col || col === "transparent") {
          const bgL = sampleBgLuminance(el);
          col = bgL > 0.55 ? "#1f2937" : "#f8fafc";
        }
        // clip-text：卸 clip 后用已解析的实色，仍对照原文色而非主题灰
      }
    } catch { /* ignore */ }
    // 仅灾难对比才救援；有实色则保留
    const rgb0 = parseRgb(col);
    if (rgb0 && rgb0.a >= 0.18) {
      const L = relativeLuminance(rgb0);
      const bgL = sampleBgLuminance(el);
      if (Math.abs(L - bgL) < 0.1) {
        const forced = forceReadableColor(el, col);
        if (forced !== col) {
          inheritColor = false;
          col = forced;
        }
      }
    } else if (clipText) {
      inheritColor = false;
    }
    // 行距
    let lhNum = unitlessLineHeight(cs, srcPx);
    if (role === "control") {
      lhNum = lhNum != null && lhNum >= 1.0 && lhNum <= 1.25 ? lhNum : 1.15;
    } else if (role === "h1") {
      if (lhNum == null || lhNum < 1.2) lhNum = 1.25;
      else if (lhNum > 1.35) lhNum = 1.3;
    } else if (role === "h2") {
      if (lhNum == null || lhNum < 1.25) lhNum = 1.3;
      else if (lhNum > 1.4) lhNum = 1.35;
    } else if (role === "meta") {
      if (lhNum == null || lhNum < 1.45) lhNum = 1.5;
      else if (lhNum < 1.5) lhNum = Math.max(lhNum, 1.45);
    } else {
      // body：宿主 ≥1.5 保持；<1.5 → 1.55～1.7
      if (lhNum == null) lhNum = 1.65;
      else if (lhNum < 1.5) lhNum = Math.min(1.7, Math.max(1.55, lhNum < 1.2 ? 1.65 : 1.55));
    }
    // 行内格子宿主：抬行高/加外边距就是撑行，保持宿主原值（A1/A3）
    const rowLocked = isRowLockedHost(el);
    if (rowLocked) lhNum = unitlessLineHeight(cs, srcPx);

    // 字距：中文正文默认 0；宽 tracking 收束
    let ls = cs.letterSpacing;
    if (role === "body" || role === "meta") {
      if (!ls || ls === "normal") ls = "0";
      else {
        const lsPx = parseFloat(ls);
        if (Number.isFinite(lsPx) && lsPx > 0.15) ls = "0.02em";
        else if (Number.isFinite(lsPx) && lsPx > 0) ls = "0";
      }
    } else if (ls && ls !== "normal") {
      const lsPx = parseFloat(ls);
      if (Number.isFinite(lsPx) && lsPx > 0.5) ls = "0.02em";
    }

    el.style.fontFamily = ff;
    el.style.fontSize = `${px}px`;
    el.style.fontWeight = weight;
    if (!inheritColor) el.style.color = col;
    else el.style.removeProperty("color"); // 继承
    if (lhNum != null) el.style.lineHeight = String(Math.round(lhNum * 100) / 100);
    else el.style.removeProperty("line-height");
    if (ls && ls !== "normal") el.style.letterSpacing = ls;
    else el.style.letterSpacing = "0";
    el.style.wordBreak = mono ? "break-all" : "normal";
    // clip-text / 渐变字：卸 clip，实色填充（Fable P0）
    if (clipText || !inheritColor) {
      el.style.setProperty("-webkit-text-fill-color", col);
      el.style.setProperty("-webkit-background-clip", "border-box");
      el.style.backgroundClip = "border-box";
      el.style.backgroundImage = "none";
    }
    // 英雄/标题：防裁切
    if (role === "h1" || role === "h2") {
      el.style.overflow = "visible";
      el.style.maxHeight = "none";
      el.style.webkitLineClamp = "unset";
      el.style.lineBreak = "auto";
      relaxClipAncestors(el);
    }
    // text-align / text-indent / white-space：继承
    try {
      const mt = parseFloat(cs.marginTop) || 0;
      const mb = parseFloat(cs.marginBottom) || 0;
      if (!rowLocked && role === "body" && mt + mb < srcPx * 0.35) {
        if (mb < srcPx * 0.25) el.style.marginBottom = "0.55em";
      }
    } catch { /* ignore */ }
    el.classList.add("pbt-replace");
    el.dataset.pbtReplaceTypo = "1";
    el.dataset.pbtReplaceRole = role;
  }

  function clearReplaceTypography(el) {
    if (!el) return;
    el.classList.remove("pbt-replace");
    if (el.dataset.pbtReplaceTypo) {
      el.style.removeProperty("font-family");
      el.style.removeProperty("font-size");
      el.style.removeProperty("font-weight");
      el.style.removeProperty("color");
      el.style.removeProperty("line-height");
      el.style.removeProperty("letter-spacing");
      el.style.removeProperty("word-break");
      el.style.removeProperty("margin-bottom");
      el.style.removeProperty("text-align");
      el.style.removeProperty("text-indent");
      el.style.removeProperty("overflow");
      el.style.removeProperty("max-height");
      el.style.removeProperty("-webkit-line-clamp");
      el.style.removeProperty("line-break");
      el.style.removeProperty("-webkit-text-fill-color");
      el.style.removeProperty("-webkit-background-clip");
      el.style.removeProperty("background-clip");
      el.style.removeProperty("background-image");
      delete el.dataset.pbtReplaceTypo;
      delete el.dataset.pbtReplaceRole;
    }
  }

  const hostTextSnaps = new WeakMap();

  function hostTextNodes(el) {
    const nodes = [];
    if (!el) return nodes;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.textContent || !n.textContent.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p && p.closest("script,style,noscript,svg,math,code,pre,.pbt-tr")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walk.nextNode())) nodes.push(n);
    return nodes;
  }

  /** 文本节点是否落在宿主内部的链接/按钮里（整段译文写进去会把整段变成可点） */
  function inInlineInteractive(el, node) {
    let p = node.parentElement;
    while (p && p !== el) {
      if (p.matches?.("a[href],button,[role='button'],summary,label")) return true;
      p = p.parentElement;
    }
    return false;
  }

  /** 承接整段译文的节点：优先非交互的最长节点，避免整段被包进内联链接 */
  function swapTargetIndex(el, nodes) {
    let best = -1;
    let bestLen = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (inInlineInteractive(el, nodes[i])) continue;
      const len = nodes[i].textContent.trim().length;
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    return best >= 0 ? best : 0;
  }

  /** code/kbd 原样保留；若译文已含同一串，藏掉宿主里那份，别让命令重复出现两次 */
  function hideDuplicateCode(el, translatedText) {
    const t = String(translatedText || "");
    el.querySelectorAll?.("code,kbd,samp").forEach((c) => {
      const s = (c.textContent || "").trim();
      if (s.length >= 3 && t.includes(s)) {
        c.dataset.pbtEchoHidden = "1";
        c.style.setProperty("display", "none", "important");
      }
    });
  }

  function showHiddenCode(el) {
    el.querySelectorAll?.("[data-pbt-echo-hidden]").forEach((c) => {
      c.style.removeProperty("display");
      delete c.dataset.pbtEchoHidden;
    });
  }

  /** TOC 序号、chevron、纯标点：换字时原样保留，避免导航几何被掏空 */
  function isChromeText(text) {
    const t = String(text || "").trim();
    if (!t) return true;
    if (/^[›»><▸▹▾▿▼▲►◀·•\|│¦\-\u2013\u2014\u00b7、]+$/.test(t)) return true;
    if (/^\d{1,3}([.\-]\d+){0,4}\.?$/.test(t)) return true;
    if (t.length <= 2 && !/[A-Za-z\u00C0-\u024F\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(t)) return true;
    return false;
  }

  /** 按原文各文本节点长度比例，把译文码点分配回去（保链接/加粗结构，勿整段灌进 node#0） */
  function distributeAcrossTextNodes(nodes, translatedText) {
    const chars = Array.from(String(translatedText || ""));
    if (!nodes.length) return;
    if (nodes.length === 1 || chars.length === 0) {
      nodes[0].textContent = translatedText;
      return;
    }
    const weights = nodes.map((n) => Math.max(1, Array.from(String(n.textContent || "").trim()).length));
    const total = weights.reduce((a, b) => a + b, 0);
    let offset = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (i === nodes.length - 1) {
        nodes[i].textContent = chars.slice(offset).join("");
        break;
      }
      const ideal = Math.round((chars.length * weights[i]) / total);
      const maxShare = Math.max(1, chars.length - offset - (nodes.length - i - 1));
      const share = Math.min(Math.max(1, ideal), maxShare);
      nodes[i].textContent = chars.slice(offset, offset + share).join("");
      offset += share;
    }
  }

  /** Put the full translation into host text nodes without blanking siblings / nuking TOC & links. */
  function swapHostTexts(el, translatedText) {
    const nodes = hostTextNodes(el);
    if (!nodes.length) return false;
    if (!hostTextSnaps.has(el)) hostTextSnaps.set(el, nodes.map((n) => ({ n, t: n.textContent })));

    const content = [];
    for (const n of nodes) {
      if (isChromeText(n.textContent)) continue; // leave chevrons / toc numbers
      content.push(n);
    }
    const targets = content.length ? content : nodes;

    if (targets.length === 1) {
      // 单内容节点：整段写入；若它在链接内且另有非交互节点，swapTargetIndex 已无其它可选
      const only = targets[0];
      const all = nodes;
      if (all.length > 1 && inInlineInteractive(el, only)) {
        const k = swapTargetIndex(el, all);
        if (k >= 0 && !inInlineInteractive(el, all[k]) && !isChromeText(all[k].textContent)) {
          all[k].textContent = translatedText;
        } else {
          only.textContent = translatedText;
        }
      } else {
        only.textContent = translatedText;
      }
    } else {
      // 多内容节点：按比例分配，保留 a/b/em 几何，避免整段变巨链/巨粗 + 兄弟被掏空
      distributeAcrossTextNodes(targets, translatedText);
    }

    hideDuplicateCode(el, translatedText);
    el.classList.add("pbt-text-swap");
    return true;
  }

  /** 整页替换：全部宿主文本 / 安全整替；不安全则 false（勿 textContent 毁结构） */
  function applyHostTranslation(el, translatedText) {
    if (!el) return false;
    if (el.dataset.pbtOrigText == null) el.dataset.pbtOrigText = textOf(el);
    if (swapHostTexts(el, translatedText)) return true;
    if (canSafelyReplaceText(el)) {
      el.textContent = translatedText;
      el.classList.add("pbt-text-swap");
      return true;
    }
    return false;
  }

  function trVisuallyAboveHost(el, node) {
    try {
      const hr = el.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      if (nr.height < 2 || hr.height < 2) return false;
      return nr.bottom <= hr.top + 2;
    } catch {
      return false;
    }
  }

  function rectsOverlap(a, b, pad) {
    const p = pad || 0;
    return !(a.right + p < b.left || a.left - p > b.right || a.bottom + p < b.top || a.top - p > b.bottom);
  }

  function clearAttached(el) {
    if (!el) return;
    const id = el.dataset.pbtId;
    el.querySelectorAll(":scope > .pbt-tr").forEach((n) => n.remove());
    // 宿主后连续兄弟 .pbt-tr（含无 data-pbt-for 的残留）一律清掉，防 Linear 叠×2–×3
    let sib = el.nextElementSibling;
    while (sib && sib.classList?.contains("pbt-tr")) {
      const next = sib.nextElementSibling;
      if (!id || !sib.dataset.pbtFor || sib.dataset.pbtFor === id) sib.remove();
      else break;
      sib = next;
    }
    if (id) {
      document.querySelectorAll(`.pbt-tr[data-pbt-for="${CSS.escape(id)}"]`).forEach((n) => n.remove());
      document.querySelectorAll(`.pbt-float[data-pbt-for="${CSS.escape(id)}"]`).forEach((n) => n.remove());
    }
    // 双保险：同父下仍挂着指向本宿主的 tr
    const p = el.parentElement;
    if (p && id) {
      p.querySelectorAll(`:scope > .pbt-tr[data-pbt-for="${CSS.escape(id)}"]`).forEach((n) => n.remove());
    }
  }

  function hasInteractiveDescBeyondIcons(el) {
    return !!el.querySelector(
      "a[href],button,input,textarea,select,[role='button']:not([role='menuitem']):not([role='option']):not([role='treeitem'])"
    );
  }

  function restoreTextSwap(el) {
    if (el.dataset.pbtOrigText == null) return;
    showHiddenCode(el);
    const snap = hostTextSnaps.get(el);
    if (snap) {
      for (const { n, t } of snap) {
        if (n) n.textContent = t;
      }
      hostTextSnaps.delete(el);
      delete el.dataset.pbtLeafOrig;
    } else if (el.dataset.pbtLeafOrig != null) {
      const leaf = hostTextNodes(el)[0];
      if (leaf) leaf.textContent = el.dataset.pbtLeafOrig;
      delete el.dataset.pbtLeafOrig;
    } else {
      el.textContent = el.dataset.pbtOrigText;
    }
    delete el.dataset.pbtOrigText;
    el.classList.remove("pbt-text-swap");
  }

  /** 弹出层：只换 Text，不插布局节点 */
  /** 始终 nextSibling 贴宿主；column-reverse 用 order 纠视觉反序；禁止标题竖排窄条 */
  function insertTrAfter(el, node) {
    // replace 模式零双语条：任何路径都不得在宿主下方插英上中下
    if (isReplaceMode()) return false;
    el.after(node);
    // 硬防竖排/逐字折行（Stripe hero 曾出现双列竖排）
    node.style.writingMode = "horizontal-tb";
    node.style.textOrientation = "mixed";
    node.style.whiteSpace = "normal";
    node.style.overflow = "visible";
    node.style.maxHeight = "none";
    node.style.boxSizing = "border-box";
    const srcTxt = textOf(el);
    const numHeavy = isNumberHeavyRun(srcTxt) || isNumberHeavyRun(node.querySelector?.(".pbt-tr-text")?.textContent || "");
    if (numHeavy) {
      node.style.overflowWrap = "normal";
      node.style.wordBreak = "keep-all";
      node.style.whiteSpace = "normal";
    } else {
      node.style.overflowWrap = "anywhere";
      node.style.wordBreak = "normal";
    }
    const p = el.parentElement;
    if (!p) return true;
    try {
      const ps = getComputedStyle(p);
      const dir = ps.flexDirection || "row";
      const isGrid = ps.display.includes("grid");
      const isFlex = ps.display.includes("flex");
      if (dir === "column-reverse" || dir === "row-reverse") {
        const base = Number.parseInt(getComputedStyle(el).order, 10);
        const b = Number.isFinite(base) ? base : 0;
        if (!el.style.order) el.style.order = String(b);
        // reverse 轴上 order 更小 → 视觉更靠后（在宿主下方）
        node.style.order = String(b - 1);
      } else if (isFlex || isGrid) {
        const base = Number.parseInt(getComputedStyle(el).order, 10);
        const b = Number.isFinite(base) ? base : 0;
        if (!el.style.order) el.style.order = String(b);
        // 正向 flex/grid：译文 order 必须 ≥ 宿主，避免卡片内 trAbove
        node.style.order = String(b + 1);
      }
      if (isGrid) {
        node.style.gridColumn = "1 / -1";
        node.style.width = "100%";
        node.style.maxWidth = "100%";
      } else if (isFlex && dir !== "column" && dir !== "column-reverse") {
        node.style.flex = "1 1 100%";
        node.style.flexBasis = "100%";
        node.style.width = "100%";
        node.style.maxWidth = "100%";
        // 用宿主内容盒宽度托底，避免被挤成 1ch 竖条
        const wr = el.getBoundingClientRect().width || p.getBoundingClientRect().width;
        if (wr >= 40) node.style.minWidth = `${Math.floor(wr)}px`;
      }
      if (isSerpResultTitle(el) || isHeading(el)) {
        node.style.display = "block";
        const wr = el.getBoundingClientRect().width;
        if (wr >= 40) {
          node.style.width = `${Math.floor(wr)}px`;
          node.style.maxWidth = "100%";
          node.style.minWidth = `${Math.min(Math.floor(wr), 280)}px`;
        }
      }
      // 视觉仍在宿主上方：再纠一次；仍失败则撤掉，由 attach 跳过
      if (trVisuallyAboveHost(el, node)) {
        const base = Number.parseInt(getComputedStyle(el).order, 10);
        const b = Number.isFinite(base) ? base : 0;
        if (!el.style.order) el.style.order = String(b);
        if (dir === "column-reverse" || dir === "row-reverse") node.style.order = String(b - 2);
        else node.style.order = String(b + 2);
      }
      if (trVisuallyAboveHost(el, node)) {
        node.remove();
        return false;
      }
    } catch { /* ignore */ }
    return true;
  }


  function attachPopupText(el, translatedText, state) {
    ensureId(el);
    if (el.dataset.pbtOrigText == null) el.dataset.pbtOrigText = textOf(el);
    el.classList.add("pbt-text-swap");
    el.dataset.pbtState = state || "ok";
    el.dataset.pbtRole = "popup";
    if (state === "pending") return true;

    // 1) 全部叶文本：保留 svg/img 等 chrome，勿只换最长节点
    if (swapHostTexts(el, translatedText)) return true;
    // 2) 纯文本叶：整替
    if (canSafelyReplaceText(el)) {
      el.textContent = translatedText;
      return true;
    }
    // 3) 仅图标 + 文本、无其它交互子节点：整替 textContent 仍不安全则跳过（勿插 .pbt-tr）
    if (!hasInteractiveDescBeyondIcons(el) && !el.querySelector("svg,img,video,iframe,canvas")) {
      el.textContent = translatedText;
      return true;
    }
    // 无安全叶：跳过，避免菜单里插 .pbt-tr 破坏布局
    el.classList.remove("pbt-text-swap");
    delete el.dataset.pbtOrigText;
    delete el.dataset.pbtLeafOrig;
    delete el.dataset.pbtRole;
    return false;
  }

  /** 标题宿主却配了正文级译文 → 错位，勿挂 */
  function headingTranslationMismatch(el, src, dst) {
    if (!isHeading(el) && el?.dataset?.pbtRole !== "hero") return false;
    const s = String(src || "").trim();
    const d = String(dst || "").trim();
    if (!s || !d || d === "…" || d === "...") return false;
    const srcWords = s.split(/\s+/).filter(Boolean);
    const zh = /[\u4e00-\u9fff]/.test(d);
    // 中文更密：标题译文不应明显长于原文，更不该出现正文句号扩写
    if (zh && s.length <= 120) {
      if (d.length > Math.max(Math.ceil(s.length * 1.15), 36)) return true;
      if (/[。；]/.test(d) && srcWords.length <= 14) return true;
    } else {
      if (s.length <= 90 && d.length > Math.max(Math.ceil(s.length * 1.8), 48)) return true;
    }
    if (srcWords.length <= 8 && (d.length > Math.max(s.length * 1.6, 36) || (d.match(/[。！？]/g) || []).length >= 2)) return true;
    if (srcWords.length <= 3 && (d.length > 40 || /[。！？；]/.test(d))) return true;
    return false;
  }

  /**
   * 回声（译文≈原文）处理：专名保留原文、永不再插第二份英文；
   * 其余算一次可重试的 fail，交给漏译扫描再打一轮，而不是永久 skip。
   */
  function echoSkip(el, srcText) {
    const tries = Number(el.dataset.pbtEchoTries || 0) + 1;
    el.dataset.pbtEchoTries = String(tries);
    if (tries >= 2 || isProperNounEcho(srcText)) {
      markSkip(el, "echo");
      return "skip";
    }
    failBack(el, "echo-retry");
    return "fail";
  }

  function attach(el, translatedText, state) {
    if (!el || !el.isConnected) return "dead";
    if (isConsentWall(el)) return "skip";
    const srcText = el.dataset.pbtOrigText != null ? el.dataset.pbtOrigText : textOf(el);
    translatedText = cleanTranslation(srcText, translatedText);
    if (state !== "fail" && state !== "pending" && sameLanguageAsSource(srcText, translatedText)) {
      return echoSkip(el, srcText);
    }
    // 行内格子宿主（不换行 flex 行 / 单行表格行）：只换字，禁止插兄弟抢行（A1）
    if (!isPopupSurface(el) && isRowLockedHost(el)) {
      clearAttached(el);
      return attachPopupText(el, translatedText, state) ? "ok" : "skip";
    }
    // 已成功挂过且同文：禁止再叠一层 .pbt-tr
    if (el.dataset.pbtState === "ok" && el.dataset.pbtId && state === "ok") {
      if (isReplaceMode()) {
        el.dataset.pbtTrText = translatedText === "…" ? "" : translatedText;
        if (translatedText && translatedText !== "…" && translatedText !== "...") {
          applyHostTranslation(el, translatedText);
        }
        clearAttached(el);
        return "ok";
      }
      const existing = document.querySelectorAll(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`);
      if (existing.length === 1) {
        const span = existing[0].querySelector(".pbt-tr-text");
        if (span && span.textContent === translatedText) return "ok";
        if (span) {
          span.textContent = translatedText;
          el.dataset.pbtTrText = translatedText;
          applyTypeMatch(el, existing[0]);
          applyLayout(el, existing[0], textOf(el), translatedText === "…" ? "" : translatedText);
          return "ok";
        }
      }
      if (existing.length > 1) {
        // 异常叠层：清到只留/重建
        clearAttached(el);
      }
    }
    // 脆弱宿主：双语禁止 append；replace 仍换字（芯片除外）
    if (
      !isReplaceMode() &&
      !isPopupSurface(el) &&
      !isTextControl(el) &&
      !isContentLink(el) &&
      (isFragileLayout(el) ||
        (isTightClip(el) && !(isHeading(el) || el.dataset?.pbtRole === "hero")) ||
        isChipListItem(el))
    ) {
      return "skip";
    }
    if (isReplaceMode() && (isChipListItem(el) || isChipListItem(el.parentElement))) {
      return "skip";
    }
    // 折叠短标题在横向 flex 行：禁止 after 抢宽；hero 长标题放行。replace 不插节点，无需回避
    if (!isReplaceMode() && isHeading(el)) {
      const p = el.parentElement;
      if (p) {
        try {
          const ps = getComputedStyle(p);
          if (
            (ps.display.includes("flex") || ps.display.includes("grid")) &&
            ps.flexDirection !== "column" &&
            ps.flexDirection !== "column-reverse"
          ) {
            const t = textOf(el);
            if (!(el.tagName === "H1" && t.length >= 18)) {
              const sibChrome = [...p.children].some(
                (c) =>
                  c !== el &&
                  c.matches?.(
                    "svg,button,[class*='chevron' i],[class*='arrow' i],[class*='toggle' i],.mw-editsection"
                  )
              );
              if (sibChrome && t.length <= 40) return "skip";
            }
          }
        } catch { /* ignore */ }
      }
    }

    // 标题只挂标题译文；正文级译文视为错位。replace 仍换字，避免标题整段漏译
    if (!isReplaceMode() && headingTranslationMismatch(el, textOf(el), translatedText)) {
      return "skip";
    }

    // 菜单/listbox/tree 项：叶文本替换（可含 svg）；勿 fallback 插 .pbt-tr
    if (isMenuPopup(el) || isMenuItemEl(el)) {
      return attachPopupText(el, translatedText, state) ? "ok" : "skip";
    }

    // 横向挤在一排的文案按钮：叶替换，避免插 tr 撑破工具栏
    if (isTextControl(el)) {
      try {
        const p = el.parentElement;
        const ps = p ? getComputedStyle(p) : null;
        const row =
          ps &&
          (ps.display.includes("flex") || ps.display.includes("grid")) &&
          ps.flexDirection !== "column" &&
          ps.flexDirection !== "column-reverse";
        if (row && textOf(el).length <= 48) {
          return attachPopupText(el, translatedText, state) ? "ok" : "skip";
        }
      } catch { /* fall through to stack */ }
    }

    if (isReplaceMode()) {
      if (state === "fail") {
        failBack(el, translatedText);
        return "skip";
      }
      ensureId(el);
      clearAttached(el);
      restoreTextSwap(el);
      const t = translatedText === "…" || translatedText === "..." ? "" : translatedText;
      el.dataset.pbtTrText = t;
      if (!t) {
        markPending(el);
        return "ok";
      }
      let srcCs = null;
      try {
        srcCs = getComputedStyle(el);
      } catch { /* ignore */ }
      relaxClipAncestors(el);
      if (!applyHostTranslation(el, t)) {
        markSkip(el, "no-replace");
        return "skip";
      }
      // 换字必须真的落地：宿主文本没变 = 英文原样留着，按可重试的 fail 处理
      if (textOf(el).replace(/\s+/g, " ").trim() === String(srcText).replace(/\s+/g, " ").trim()) {
        restoreTextSwap(el);
        failBack(el, "replace-noop");
        return "fail";
      }
      applyReplaceTypography(el, srcCs);
      el.classList.add("pbt-host");
      if (el.dataset.pbtRole !== "hero" && el.dataset.pbtRole !== "control") el.dataset.pbtRole = "prose";
      el.dataset.pbtState = state || "ok";
      try {
        if (typeof nudgeFabAwayFromContent === "function") nudgeFabAwayFromContent();
      } catch { /* ignore */ }
      return "ok";
    }

    const id = ensureId(el);
    clearAttached(el);
    restoreTextSwap(el);

    const node = document.createElement("div");
    node.className = "pbt-tr pbt-layout-stack";
    node.setAttribute("translate", "no");
    node.dataset.pbtFor = id;
    const text = document.createElement("span");
    text.className = "pbt-tr-text";
    text.textContent = translatedText;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "pbt-retry";
    retry.textContent = "重试";
    retry.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      retryOne(el);
    });
    node.append(text, retry);
    node.classList.toggle("pbt-fail", state === "fail");

    // 散文：块后兄弟插入；纠 column-reverse 反序 / row 挤占；视觉 trAbove 则跳过
    relaxClipAncestors(el);
    const placed = insertTrAfter(attachAnchorFor(el), node);
    if (placed === false) {
      return "skip";
    }
    // Show more/less 常绝对定位盖住译文首行：给一点顶距
    try {
      const prev = node.previousElementSibling;
      const pt = (prev?.innerText || "").replace(/\s+/g, " ").trim();
      if (/^show (more|less)$/i.test(pt)) node.style.marginTop = "1.35em";
    } catch { /* ignore */ }
    el.classList.add("pbt-host");
    if (el.dataset.pbtRole !== "hero" && el.dataset.pbtRole !== "control") el.dataset.pbtRole = "prose";
    el.dataset.pbtState = state || "ok";
    el.dataset.pbtTrText = translatedText === "…" ? "" : translatedText;
    applyTypeMatch(el, node);
    applyLayout(el, node, textOf(el), translatedText === "…" ? "" : translatedText);
    node.classList.remove("pbt-tr-off");
    node.hidden = false;
    if (!node.style.display) node.style.removeProperty("display");
    // hero：禁止被祖先 overflow 裁切译文
    if (isHeading(el) || el.dataset?.pbtRole === "hero") {
      node.style.overflow = "visible";
      node.style.maxHeight = "none";
      node.style.clipPath = "none";
    }
    if (isNumberHeavyRun(textOf(el)) || isNumberHeavyRun(translatedText)) {
      node.dataset.pbtNum = "1";
      node.style.overflowWrap = "normal";
      node.style.wordBreak = "keep-all";
    }
    syncModeFor(el, node);
    try {
      if (typeof nudgeFabAwayFromContent === "function") nudgeFabAwayFromContent();
    } catch { /* ignore */ }
    return "ok";
  }

  function rebuildTrNode(el, text) {
    if (!el?.dataset?.pbtId || !text) return null;
    if (isReplaceMode()) return null;
    const node = document.createElement("div");
    node.className = "pbt-tr pbt-layout-stack";
    node.setAttribute("translate", "no");
    node.dataset.pbtFor = el.dataset.pbtId;
    const span = document.createElement("span");
    span.className = "pbt-tr-text";
    span.textContent = text;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "pbt-retry";
    retry.textContent = "重试";
    retry.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      retryOne(el);
    });
    node.append(span, retry);
    insertTrAfter(attachAnchorFor(el), node);
    applyTypeMatch(el, node);
    applyLayout(el, node, textOf(el), text);
    return node;
  }

  function syncModeFor(el, trNode) {
    const mode = settings.displayMode || "replace";
    let tr =
      trNode ||
      (el.dataset.pbtId &&
        document.querySelector(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`));

    // 菜单/弹出层叶替换：各模式保持换字；replace 仅补排版
    if (el.classList.contains("pbt-text-swap") && el.dataset.pbtRole === "popup") {
      if (mode === "replace") applyReplaceTypography(el);
      else clearReplaceTypography(el);
      return;
    }

    if (mode === "replace") {
      el.classList.remove("pbt-trans-only", "pbt-hide-visual");
      let t = el.dataset.pbtTrText || "";
      if ((!t || t === "…" || t === "...") && tr) {
        t = tr.querySelector(".pbt-tr-text")?.textContent || "";
      }
      if (!t || t === "…" || t === "...") {
        if (el.dataset.pbtId) {
          document.querySelectorAll(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`).forEach((n) => n.remove());
        }
        return;
      }
      el.dataset.pbtTrText = t;

      // 采样原文排版：若尚未换字，computed 仍是原文
      let srcCs = null;
      try {
        srcCs = getComputedStyle(el);
      } catch { /* ignore */ }

      const ok = applyHostTranslation(el, t);
      if (!ok) {
        // 不安全：跳过换字（勿白屏）；仍移除 .pbt-tr，避免双语条残留
        clearReplaceTypography(el);
        if (el.dataset.pbtId) {
          document.querySelectorAll(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`).forEach((n) => n.remove());
        }
        return;
      }
      applyReplaceTypography(el, srcCs);
      // Fable P0：replace 零残留 .pbt-tr 双语条（缓存靠 pbtTrText）
      if (el.dataset.pbtId) {
        document.querySelectorAll(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`).forEach((n) => n.remove());
      }
      let sib = el.nextElementSibling;
      while (sib && sib.classList?.contains("pbt-tr")) {
        const next = sib.nextElementSibling;
        sib.remove();
        sib = next;
      }
      return;
    }

    // 离开 replace：还原宿主原文 + 清排版，再走 bilingual / translation
    if (el.classList.contains("pbt-replace") || (el.classList.contains("pbt-text-swap") && el.dataset.pbtRole !== "popup")) {
      clearReplaceTypography(el);
      const keepTr = el.dataset.pbtTrText;
      restoreTextSwap(el);
      if (keepTr) el.dataset.pbtTrText = keepTr;
      // restore 可能清掉 host 标记以外的状态；保持 pbt-host
      el.classList.add("pbt-host");
      tr =
        (el.dataset.pbtId &&
          document.querySelector(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`)) ||
        tr;
    }

    if (mode === "translation") {
      el.classList.add("pbt-trans-only");
      // 仅译文默认 hide-visual + 保留 .pbt-tr；禁止 textContent 整替（防工具落地白屏）
      if (!tr && el.dataset.pbtTrText && el.dataset.pbtId) {
        tr = rebuildTrNode(el, el.dataset.pbtTrText);
      }
      if (!tr) return;
      const spanEl = tr.querySelector(".pbt-tr-text");
      const t = spanEl?.textContent || "";
      if (t && t !== "…" && t !== "...") el.dataset.pbtTrText = t;
      el.classList.add("pbt-hide-visual");
      tr.classList.remove("pbt-tr-off");
      tr.hidden = false;
      tr.style.removeProperty("display");
      tr.classList.add("pbt-trans-only-tr");
    } else {
      // bilingual
      el.classList.remove("pbt-trans-only", "pbt-hide-visual");
      clearReplaceTypography(el);
      if (!tr && el.dataset.pbtId && el.dataset.pbtTrText) {
        tr = rebuildTrNode(el, el.dataset.pbtTrText);
      } else if (el.dataset.pbtOrigText != null && !el.querySelector("a,button,input,svg,img,video,iframe")) {
        const keepSpan = tr?.querySelector(".pbt-tr-text");
        const keepTr = keepSpan?.textContent;
        el.textContent = el.dataset.pbtOrigText;
        delete el.dataset.pbtOrigText;
        el.classList.remove("pbt-text-swap");
        if (tr && keepTr) {
          const span = tr.querySelector(".pbt-tr-text");
          if (span) span.textContent = keepTr;
        }
      }
      if (tr) {
        tr.classList.remove("pbt-trans-only-tr", "pbt-tr-off");
        tr.hidden = false;
        tr.style.removeProperty("display");
        tr.removeAttribute("aria-hidden");
      }
    }
  }

  /** replace 模式残留清道夫：含宿主已被回收/改 id 的孤儿双语条 */
  function purgeTrNodes() {
    document.querySelectorAll(".pbt-tr").forEach((n) => n.remove());
  }

  function setMode(mode) {
    const next = mode === "translation" || mode === "replace" ? mode : "bilingual";
    settings.displayMode = next;
    document.querySelectorAll(".pbt-host, .pbt-text-swap").forEach((el) => {
      // popup 叶替换也走 sync（replace 补排版）
      const tr =
        el.dataset.pbtId && document.querySelector(`.pbt-tr[data-pbt-for="${CSS.escape(el.dataset.pbtId)}"]`);
      if (next === "bilingual" && tr && !el.classList.contains("pbt-text-swap")) {
        applyTypeMatch(el, tr);
        applyLayout(el, tr, textOf(el), tr.querySelector(".pbt-tr-text")?.textContent || "");
      }
      syncModeFor(el, tr);
    });
    if (next === "replace") purgeTrNodes();
    renderFab();
    // 进入 replace：补全页未译块（缓存命中不重打）；不拆现有 attach
    if (next === "replace" && (translated || translating)) {
      settings.scope = "full";
      expandReplaceFull().catch(() => {});
    }
  }

  async function expandReplaceFull() {
    if (settings.displayMode !== "replace") return;
    if (!(translated || translating)) return;
    const my = runId;
    const blocks = collect("full").filter(
      (b) => b.el && !b.el.classList.contains("pbt-host") && !b.el.classList.contains("pbt-text-swap")
    );
    if (!blocks.length) return;
    translating = true;
    watchDynamicMenus();
    const items = blocks.map((b) => {
      markQueued(b.el);
      return { id: ensureId(b.el), text: b.text, el: b.el };
    });
    await runQueue(items, { size: queueBatchSize(), workers: coldWorkerCount(), my, atomicReplace: true });
    if (my === runId) {
      translating = false;
      renderFab();
    }
  }

  function restoreAll() {
    runId += 1;
    allowMissSweep = false;
    hotFirstPaintDone = false;
    unwatchDynamicMenus();
    if (stopScrollWatch) {
      stopScrollWatch();
      stopScrollWatch = null;
    }
    coldItems = [];
    document.querySelectorAll(".pbt-tr, .pbt-float").forEach((n) => n.remove());
    document.getElementById("pbt-float-root")?.replaceChildren();
    document.querySelectorAll(".pbt-host, .pbt-hovering").forEach((el) => {
      restoreTextSwap(el);
      clearReplaceTypography(el);
      el.classList.remove(
        "pbt-host",
        "pbt-trans-only",
        "pbt-hide-visual",
        "pbt-hovering",
        "pbt-layout-row",
        "pbt-layout-stack",
        "pbt-chrome",
        "pbt-host-flex",
        "pbt-text-swap",
        "pbt-replace"
      );
      delete el.dataset.pbtState;
      delete el.dataset.pbtLayout;
      delete el.dataset.pbtHostDisplay;
      delete el.dataset.pbtRole;
      delete el.dataset.pbtTrText;
      delete el.dataset.pbtOrigText;
      delete el.dataset.pbtLeafOrig;
      delete el.dataset.pbtFailed;
      el.classList.remove("pbt-queued");
      el.style.removeProperty("--pbt-size");
      el.style.removeProperty("--pbt-weight");
      el.style.removeProperty("--pbt-color");
      el.style.removeProperty("--pbt-lh");
      el.style.removeProperty("--pbt-ls");
      el.style.removeProperty("--pbt-ff");
      el.style.removeProperty("opacity");
      el.style.removeProperty("visibility");
      el.style.removeProperty("--pbt-opacity");
    });
    translated = false;
    translating = false;
    hideTip();
    hideBubble();
    toast("已恢复原文");
    renderFab();
    return { ok: true, translated: false };
  }

  function pageContext() {
    return { title: document.title || "", host: location.host || "" };
  }

  function reportError(message, extra) {
    const payload = {
      type: "PBT_LOG_ERROR",
      message: String(message || "").slice(0, 400),
      source: (extra && extra.source) || "content",
      host: location.host || "",
      itemCount: (extra && extra.itemCount) || 0,
      engine: settings?.engine || "",
    };
    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch (_) { /* SW gone */ }
  }

  function runtimeSend(msg, ms) {
    const t = ms || 35000;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const err = new Error(`扩展后台超时 ${t / 1000}s（翻译引擎无响应）`);
        reportError(err.message, { source: "runtimeSend.timeout", itemCount: msg?.items?.length });
        reject(err);
      }, t);
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) {
            const m = err.message || String(err);
            reportError(m, { source: "runtimeSend", itemCount: msg?.items?.length });
            reject(new Error(m));
          } else resolve(res);
        });
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reportError(e?.message || e, { source: "runtimeSend.catch" });
        reject(e);
      }
    });
  }

  async function requestBatch(batch) {
    const need = [];
    const have = [];
    for (const it of batch) {
      const hit = cacheGetText(cacheKey(it.text));
      if (hit != null) have.push({ id: it.id, text: hit });
      else need.push(it);
    }
    if (have.length) schedulePersistTrCache();
    if (!need.length) return have;
    let touchedPn = false;
    for (const it of need) {
      if (touchProperNounsInText(it.text)) touchedPn = true;
    }
    if (touchedPn) persistProperNounsSoon();
    const batchTexts = need.map((x) => x.text);
    const gloss = glossaryWithProperNouns(batchTexts);
    const preserve = PBT.pnMergeBatchPreserve(batchTexts, properNounList);
    const res = await runtimeSend({
      type: "PBT_BATCH",
      items: need.map(({ id, text }) => ({ id, text })),
      targetLang: settings.targetLang,
      glossary: gloss,
      properNouns: preserve,
      page: pageContext(),
    }, 100000);
    if (!res?.ok) throw new Error(res?.error || "Translation failed");
    let wrote = false;
    for (const row of res.items || []) {
      const src = need.find((b) => b.id === row.id);
      if (src && typeof row.text === "string" && row.text && row.text !== "…") {
        const text = restoreProperNouns(src.text, row.text, preserve);
        row.text = text;
        cachePut(cacheKey(src.text), text);
        wrote = true;
      }
    }
    if (wrote) {
      trimCache();
      schedulePersistTrCache();
    }
    return have.concat(res.items || []);
  }

  /**
   * Normalize whitelist / heuristic token spelling in the translation when the
   * model kept the name but changed case (Windows → windows, Tim Cook → tim cook).
   * Does not invent missing names.
   */
  function restoreProperNouns(src, dst, termList) {
    let out = String(dst ?? "");
    const s = String(src || "");
    const terms = termList?.length
      ? termList
      : preserveTermsForPair(src, dst);
    if (!out || !s || !terms.length) return out;
    for (const term of terms) {
      const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reSrc = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
      if (!reSrc.test(s)) continue;
      const reDst = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "gi");
      if (reDst.test(out)) out = out.replace(reDst, term);
    }
    return out;
  }

  function inView(el, pad) {
    const margin = pad == null ? 0.6 : pad;
    const r = el.getBoundingClientRect();
    const h = window.innerHeight || 600;
    const extra = h * margin;
    return r.bottom > -extra && r.top < h + extra;
  }

  function markQueued(el) {
    el.dataset.pbtState = "queued";
    el.classList.add("pbt-queued");
  }

  /** replace 抗斑驳：占位排队，不换字、不插 … */
  function markPending(el) {
    if (!el) return;
    el.dataset.pbtState = "pending";
    el.classList.add("pbt-queued");
  }

  function rAF() {
    return new Promise((r) => requestAnimationFrame(() => r()));
  }

  function failBack(el, reason) {
    clearAttached(el);
    restoreTextSwap(el);
    clearReplaceTypography(el);
    el.classList.remove("pbt-queued", "pbt-host", "pbt-trans-only", "pbt-hide-visual", "pbt-skip", "pbt-replace");
    el.dataset.pbtState = "fail";
    el.dataset.pbtFailed = "1";
    if (reason) el.dataset.pbtFailReason = String(reason).slice(0, 80);
    try {
      const arr = JSON.parse(sessionStorage.getItem("pbtFailLog") || "[]");
      arr.push({ id: el.dataset.pbtId || "", reason: String(reason || ""), t: Date.now() });
      sessionStorage.setItem("pbtFailLog", JSON.stringify(arr.slice(-80)));
    } catch { /* ignore */ }
  }

  function markSkip(el, reason) {
    clearAttached(el);
    restoreTextSwap(el);
    clearReplaceTypography(el);
    el.classList.remove("pbt-queued", "pbt-host", "pbt-trans-only", "pbt-hide-visual", "pbt-replace");
    el.classList.add("pbt-skip");
    el.dataset.pbtState = "skip";
    delete el.dataset.pbtFailed;
    if (reason) el.dataset.pbtSkipReason = String(reason).slice(0, 80);
  }

  function sweepLeftovers() {
    if (isReplaceMode()) {
      document.querySelectorAll(".pbt-tr").forEach((tr) => tr.remove());
      document.querySelectorAll(".pbt-text-swap").forEach((el) => {
        if (el.textContent.trim() === "…" || el.textContent.trim() === "...") restoreTextSwap(el);
      });
      return;
    }
    document.querySelectorAll(".pbt-tr").forEach((tr) => {
      const t = tr.querySelector(".pbt-tr-text")?.textContent || "";
      if (t === "…" || t === "...") tr.remove();
    });
    document.querySelectorAll('[data-pbt-state="pending"], [data-pbt-state="queued"]').forEach((el) => {
      if (el.dataset.pbtState === "ok" || el.dataset.pbtState === "skip") return;
      failBack(el, "sweep");
    });
    document.querySelectorAll(".pbt-text-swap").forEach((el) => {
      if (el.textContent.trim() === "…" || el.textContent.trim() === "...") restoreTextSwap(el);
    });
  }

  function countOk() {
    return document.querySelectorAll('.pbt-host[data-pbt-state="ok"]').length;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function requestBatchRetry(batch) {
    try {
      return await requestBatch(batch);
    } catch (err) {
      if (batch.length >= 2) {
        const mid = Math.ceil(batch.length / 2);
        await sleep(180);
        const left = await requestBatch(batch.slice(0, mid)).catch(() => []);
        await sleep(180);
        const right = await requestBatch(batch.slice(mid)).catch(() => []);
        const rows = [].concat(left || [], right || []);
        if (rows.length) return rows;
      } else {
        await sleep(350);
        try {
          return await requestBatch(batch);
        } catch {
          /* fall through */
        }
      }
      throw err;
    }
  }

  async function runQueue(items, { size = 5, workers = 1, my, atomicReplace = false }) {
    if (!items.length) return { done: 0, failed: 0, lastError: "" };
    const byId = new Map(items.map((x) => [String(x.id), x]));
    let cursor = 0;
    let done = 0;
    let failed = 0;
    let lastBatchError = "";
    const doAtomic = atomicReplace && settings.displayMode === "replace";

    async function applyRows(rows) {
      const got = new Set();
      for (const row of rows || []) {
        if (!row?.text) continue;
        const rid = String(row.id);
        const src = byId.get(rid) || byId.get(row.id);
        if (!src) continue;
        row.text = cleanTranslation(src.text || "", row.text);
        if (!row.text) continue;
        if (!src.el.isConnected) {
          markSkip(src.el, "dead");
          got.add(rid);
          continue;
        }
        if (src.el.dataset.pbtState === "ok" || src.el.dataset.pbtState === "skip") {
          got.add(rid);
          continue;
        }
        // 同批重复 id：只处理一次
        if (got.has(rid)) continue;
        {
          const srcText0 = src.text || textOf(src.el);
          if (sameLanguageAsSource(srcText0, row.text)) {
            if (echoSkip(src.el, srcText0) === "fail") failed += 1;
            got.add(rid);
            continue;
          }
        }
        if (headingTranslationMismatch(src.el, src.text || textOf(src.el), row.text)) {
          // 模型扩写时取首句短译，避免大标题整段跳过或挂正文
          const srcText = src.text || textOf(src.el);
          const cut = String(row.text).split(/[。！？；\n]/)[0].replace(/[—–-].*$/, "").trim();
          if (cut && !headingTranslationMismatch(src.el, srcText, cut)) {
            if (sameLanguageAsSource(srcText, cut)) {
              if (echoSkip(src.el, srcText) === "fail") failed += 1;
              got.add(rid);
              continue;
            }
            const stCut = attach(src.el, cut, "ok");
            if (stCut === "ok") {
              got.add(rid);
              done += 1;
              if (!translated) {
                translated = true;
                renderFab();
                toast(`已出译 ${countOk()} 段…`, false, true);
              }
              continue;
            }
          }
          // replace 不插节点：宁可标题吃下整句译文，也不留英文标题
          if (!isReplaceMode()) {
            markSkip(src.el, "heading-mismatch");
            got.add(rid);
            continue;
          }
        }
        const st = attach(src.el, row.text, "ok");
        if (st === "ok") {
          got.add(rid);
          done += 1;
          if (!translated) {
            translated = true;
            renderFab();
            toast(`已出译 ${countOk()} 段…`, false, true);
          }
        } else if (st === "fail") {
          // attach 已 failBack：保留可重试状态，勿覆写成永久 skip
          failed += 1;
          got.add(rid);
        } else if (st === "skip" || st === "dead") {
          const reason =
            st === "dead" ? "dead" : src.el.dataset.pbtSkipReason || "fragile";
          markSkip(src.el, reason);
          got.add(rid);
        }
      }
      return got;
    }

    function settled(it) {
      const st = it.el.dataset.pbtState;
      return st === "ok" || st === "skip" || st === "fail";
    }

    async function paintRows(rows) {
      if (doAtomic) {
        await rAF();
        const got = await applyRows(rows);
        if (!hotFirstPaintDone && settings.displayMode === "replace") {
          hotFirstPaintDone = true;
          allowMissSweep = true;
        }
        return got;
      }
      return await applyRows(rows);
    }

    async function worker() {
      while (cursor < items.length && my === runId) {
        const start = cursor;
        cursor += size;
        const batch = items.slice(start, start + size);
        if (!batch.length) break;
        // replace：请求前只标 pending，不换字 → 整批返回后一帧上屏，抗斑驳
        if (doAtomic) {
          for (const it of batch) {
            if (it.el?.isConnected) markPending(it.el);
          }
        }
        try {
          let rows = await requestBatchRetry(batch);
          if (my !== runId) return;
          let got = await paintRows(rows);
          // 顺序兜底：返回条数对齐时按位贴 id（provider 已 align；这里防漏网）
          if (Array.isArray(rows) && rows.length === batch.length) {
            const zip = [];
            for (let i = 0; i < batch.length; i++) {
              const it = batch[i];
              if (settled(it) || got.has(String(it.id))) continue;
              const t = rows[i]?.text;
              if (t) zip.push({ id: it.id, text: t });
            }
            if (zip.length) got = new Set([...got, ...(await paintRows(zip))]);
          }
          // 缺 id：单独再打一轮，避免整批误杀
          const miss = batch.filter((it) => !got.has(String(it.id)) && !got.has(it.id) && !settled(it));
          if (miss.length) {
            await sleep(220);
            rows = await requestBatchRetry(miss).catch(() => []);
            got = new Set([...got, ...(await paintRows(rows))]);
          }
          for (const it of batch) {
            if (settled(it)) continue;
            if (!got.has(String(it.id)) && !got.has(it.id)) {
              failBack(it.el, "missing-id");
              failed += 1;
            } else if (!settled(it)) {
              // 有译文但未挂上：当跳过，勿计失败
              markSkip(it.el, "no-attach");
            }
          }
        } catch (err) {
          if (my !== runId) return;
          lastBatchError = String(err?.message || err).slice(0, 100);
          reportError(err?.message || err, { source: "runQueue.batch", itemCount: batch.length });
          toast(lastBatchError, true, true);
          // 整批挂：逐条再试，能救一条是一条
          for (const it of batch) {
            if (my !== runId) return;
            if (settled(it)) continue;
            try {
              await sleep(180);
              const rows = await requestBatch([it]);
              await paintRows(rows);
              if (!settled(it)) {
                failBack(it.el, "item-retry:" + String(err?.message || err).slice(0, 40));
                failed += 1;
              }
            } catch (e2) {
              failBack(it.el, "item-catch:" + String(e2?.message || e2).slice(0, 40));
              failed += 1;
            }
          }
        }
        await sleep(doAtomic ? 60 : 120);
        if (my === runId) {
          const ok = countOk();
          toast(`翻译中 ${ok} 段${failed ? ` · 失败 ${failed}` : ""}…`, failed > 0, true);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, workers) }, () => worker()));
    return { done, failed, lastError: lastBatchError };
  }

  let scrollTimer = 0;
  let coldItems = [];
  let coldRunning = false;

  function nearScore(el) {
    const r = el.getBoundingClientRect();
    const mid = (window.innerHeight || 600) / 2;
    const c = (r.top + r.bottom) / 2;
    return Math.abs(c - mid);
  }

  async function pumpCold(my) {
    if (coldRunning || my !== runId) return;
    coldRunning = true;
    try {
      while (translating && my === runId) {
        const pending = coldItems.filter((it) => it.el.isConnected && it.el.dataset.pbtState !== "ok" && it.el.dataset.pbtState !== "fail" && it.el.dataset.pbtState !== "skip");
        if (!pending.length) break;
        pending.sort((a, b) => Number(inView(b.el, 0.75)) - Number(inView(a.el, 0.75)) || nearScore(a.el) - nearScore(b.el));
        const hotNow = pending.filter((it) => inView(it.el, 0.75));
        const batch = (hotNow.length ? hotNow : pending).slice(0, PBT_COLD_SLICE);
        await runQueue(batch, { size: queueBatchSize(), workers: coldWorkerCount(), my, atomicReplace: true });
        // 去掉已完成
        coldItems = coldItems.filter((it) => it.el.isConnected && it.el.dataset.pbtState !== "ok" && it.el.dataset.pbtState !== "skip" && it.el.dataset.pbtState !== "fail");
        if (!hotNow.length) {
          // 本轮没有视口项，再跑一小段冷的后歇一下
          break;
        }
      }
    } finally {
      coldRunning = false;
    }
  }

  function watchScrollTranslate(my) {
    const onScroll = () => {
      if (my !== runId) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        if (translating && my === runId) pumpCold(my).catch(() => {});
        // 滚动停稳后扫漏译（翻译中或已译完均可）
        if ((translated || translating) && my === runId) scheduleMissSweep(PBT_MISS_SWEEP_MS);
      }, 160);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      clearTimeout(scrollTimer);
    };
  }

  let stopScrollWatch = null;

  async function translatePage(scope) {
    // 兑现 Options scope：main→正文根（空则回退整页）；显式入参优先（Alt+W=full）
    // replace 模式强制整页收集；显式入参仍优先（Alt+W=full）
    let mode = scope || settings.scope || "main";
    if (!scope && settings.displayMode === "replace") mode = "full";
    if (settings.displayMode === "replace") mode = "full";
    settings.scope = mode === "full" ? "full" : "main";
    // 合法三态；非法回落 bilingual
    if (settings.displayMode !== "translation" && settings.displayMode !== "bilingual" && settings.displayMode !== "replace") {
      settings.displayMode = "replace";
    }
    if (!settings.displayMode) settings.displayMode = "replace";
    const my = ++runId;
    if (stopScrollWatch) {
      stopScrollWatch();
      stopScrollWatch = null;
    }
    const blocks = collect(mode);
    if (!blocks.length) {
      const bodyText = (document.body && document.body.innerText) || "";
      const hasVisibleForeign = needsTranslate(bodyText) || hasForeignScript(bodyText);
      if (hasVisibleForeign) {
        toast("识别不到段落（结构特殊/SPA）。可试：刷新后再译");
      } else if (looksAlreadyTargetLang(bodyText)) {
        toast("疑似已是中文，没有需要翻译的段落。");
      } else {
        toast("没有可识别的段落。可试：刷新后再译");
      }
      return { ok: false, error: "empty" };
    }
    // 推迟 translated=true 到首段 ok；translating 驱动队列
    translating = true;
    translated = false;
    allowMissSweep = false;
    hotFirstPaintDone = false;
    watchDynamicMenus();
    renderFab();

    // 不铺全页 …；只轻量排队标记
    const items = blocks.map((b) => {
      const id = ensureId(b.el);
      markQueued(b.el);
      return { id, text: b.text, el: b.el };
    });

    // 热区：严格视口优先；散文先进热队列，避免空转「翻译中」却无可见中文
    const strictPad = Math.min(PBT_HOT_PAD, 0.35);
    let hot = items.filter((it) => inView(it.el, strictPad));
    if (hot.length < 4) {
      const wider = items.filter((it) => inView(it.el, PBT_HOT_PAD) && !hot.includes(it));
      hot = hot.concat(wider);
    }
    coldItems = items.filter((it) => !hot.includes(it));
    const boost = (el) => {
      if (!el) return 0;
      if (el.tagName === "H1" || el.getAttribute?.("aria-level") === "1") return -72;
      if (el.dataset?.pbtRole === "hero") return -64;
      if (el.tagName === "H2") return -36;
      if (isHeading(el)) return -18;
      // 视口散文强优先（修 wiki/github/medium 热区空窗）
      if (/^(P|LI|BLOCKQUOTE)$/.test(el.tagName) || el.dataset?.pbtRole === "prose") return -40;
      try {
        const px = parseFloat(getComputedStyle(el).fontSize) || 16;
        if (px >= 28) return -30;
        if (px >= 22) return -14;
      } catch { /* ignore */ }
      return 0;
    };
    hot.sort((a, b) => nearScore(a.el) + boost(a.el) - (nearScore(b.el) + boost(b.el)));
    // 保证热批含若干视口散文，不只标题；散文插到标题后立刻译
    let proseHot = hot.filter((it) => !isHeading(it.el) && it.el.dataset?.pbtRole !== "hero");
    if (proseHot.length < 4) {
      const need = 8 - proseHot.length;
      const extra = coldItems
        .slice()
        .filter((it) => /^(P|LI|BLOCKQUOTE)$/.test(it.el.tagName) || it.el.dataset?.pbtRole === "prose")
        .sort((a, b) => nearScore(a.el) - nearScore(b.el))
        .slice(0, Math.max(0, need));
      if (extra.length) {
        const addSet = new Set(extra);
        hot = hot.concat(extra);
        coldItems = coldItems.filter((it) => !addSet.has(it));
        proseHot = hot.filter((it) => !isHeading(it.el) && it.el.dataset?.pbtRole !== "hero");
      }
    }
    // 交错：hero/H1 → 散文 → 散文，避免只出孤标题或只排队不可见块
    {
      const heroes = hot.filter((it) => isHeading(it.el) || it.el.dataset?.pbtRole === "hero");
      const prose = hot.filter((it) => !heroes.includes(it));
      const mixed = [];
      let i = 0, j = 0;
      while (i < heroes.length || j < prose.length) {
        if (i < heroes.length) mixed.push(heroes[i++]);
        if (j < prose.length) mixed.push(prose[j++]);
        if (j < prose.length) mixed.push(prose[j++]);
      }
      hot = mixed;
    }
    toast(`翻译中 0/${items.length}（先译可见区）…`, false, true);

    const hotStartedAt = Date.now();
    let hotWatch = setInterval(() => {
      if (my !== runId || !translating) {
        clearInterval(hotWatch);
        hotWatch = 0;
        return;
      }
      const ok = countOk();
      const queued = items.filter(
        (it) =>
          it.el.isConnected &&
          (it.el.dataset.pbtState === "queued" || it.el.dataset.pbtState === "pending")
      ).length;
      const elapsed = Date.now() - hotStartedAt;
      if (ok === 0 && queued > 0 && elapsed >= 10000) {
        let reason = "";
        try {
          const log = JSON.parse(sessionStorage.getItem("pbtFailLog") || "[]");
          reason = String(log.slice(-1)[0]?.reason || "").slice(0, 80);
        } catch { /* ignore */ }
        toast(
          `热区暂无译文（已 ${Math.round(elapsed / 1000)}s · 排队 ${queued}）${reason ? "：" + reason : "：检查 Key / 网络 / 桥"}`,
          true,
          true
        );
        clearInterval(hotWatch);
        hotWatch = 0;
      } else if (
        ok > 0 &&
        elapsed >= 8000 &&
        !isReplaceMode() &&
        document.querySelectorAll(".pbt-tr").length === 0
      ) {
        toast(`已标记 ${ok} 段但未见译文节点，请刷新重试`, true, true);
        clearInterval(hotWatch);
        hotWatch = 0;
      }
    }, 2000);

    // 热队列：DeepSeek 大批+3 worker；replace 整批 rAF 原子上屏（抗斑驳）
    // 热完再挂滚动 / miss-sweep，避免冷扫与热区抢额度
    await runQueue(hot, { size: queueBatchSize(), workers: hotWorkerCount(), my, atomicReplace: true });
    allowMissSweep = true;
    hotFirstPaintDone = true;
    if (hotWatch) {
      clearInterval(hotWatch);
      hotWatch = 0;
    }
    if (my !== runId) {
      translating = false;
      return { ok: true, translated: false, aborted: true };
    }

    stopScrollWatch = watchScrollTranslate(my);

    // 冷队列继续，滚动可插队（仍优先视口）
    await pumpCold(my);
    if (my !== runId) {
      translating = false;
      return { ok: true, translated: false, aborted: true };
    }
    // 扫尾：剩余冷段
    const rest = coldItems.filter((it) => it.el.isConnected && it.el.dataset.pbtState !== "ok" && it.el.dataset.pbtState !== "fail" && it.el.dataset.pbtState !== "skip");
    if (rest.length) await runQueue(rest, { size: queueBatchSize(), workers: coldWorkerCount(), my, atomicReplace: true });

    if (my !== runId) {
      translating = false;
      return { ok: true, translated: false, aborted: true };
    }
    sweepLeftovers();
    scheduleMissSweep(PBT_MISS_SWEEP_MS);
    // serviceOn：再扫几轮全页漏译（拉长间隔）
    if (settings.serviceOn || isReplaceFull()) {
      setTimeout(() => scheduleMissSweep(PBT_MISS_SWEEP_MS + 200), PBT_MISS_SWEEP_MS + 200);
      setTimeout(() => scheduleMissSweep(PBT_MISS_SWEEP_MS * 2), PBT_MISS_SWEEP_MS * 2);
    }
    const done = countOk();
    const skipped = items.filter((it) => it.el.dataset.pbtState === "skip").length;
    const failed = items.filter((it) => it.el.dataset.pbtFailed === "1" || it.el.dataset.pbtState === "fail").length;
    translating = false;
    translated = done > 0;
    renderFab();
    if (typeof refreshFloats === "function") refreshFloats();
    let reason = "";
    try {
      const log = JSON.parse(sessionStorage.getItem("pbtFailLog") || "[]");
      reason = String(log.slice(-1)[0]?.reason || "").slice(0, 60);
    } catch { /* ignore */ }
    if (done === 0) {
      toast(
        `未译出（失败 ${failed || items.length}）${reason ? "：" + reason : "：检查 Key / 手机能否访问 DeepSeek，或改 Mac 中转"}`,
        true
      );
    } else {
      toast(
        failed
          ? `完成 ${done}，失败 ${failed}${skipped ? ` · 跳过 ${skipped}` : ""}${reason ? " · " + reason : ""}`
          : `已翻译 ${done} 段${skipped ? ` · 跳过 ${skipped}` : ""}`,
        failed > 0
      );
    }
    return { ok: failed === 0, translated, count: done, failed };
  }

  async function retryOne(el) {
    const text = textOf(el);
    const id = ensureId(el);
    el.dataset.pbtState = "queued";
    delete el.dataset.pbtFailed;
    try {
      cache.delete(cacheKey(text));
      schedulePersistTrCache();
      const rows = await requestBatch([{ id, text, el }]);
      const row = rows.find((r) => r.id === id) || rows[0];
      if (!row?.text) {
        failBack(el);
        toast("本段仍失败，已恢复原文", true);
        return;
      }
      attach(el, row.text, "ok");
      toast("本段已更新");
    } catch (err) {
      failBack(el);
      toast(String(err.message || err) + "（已恢复原文）", true);
    }
  }

  function blockFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.id === "pbt-root" || el.closest?.("#pbt-root")) continue;
      const block = el.closest?.(BLOCKS);
      if (block && !isSkip(block) && !isStructure(block) && worth(block, textOf(block))) return block;
    }
    return null;
  }

  let lastXY = { x: 0, y: 0 };
  function onMove(e) {
    lastXY = { x: e.clientX, y: e.clientY };
    hoverEl = blockFromPoint(e.clientX, e.clientY);
    if (hoverEl && settings.hoverEnabled && hoverModifier(e)) {
      hoverEl.classList.add("pbt-hovering");
      showBubble(hoverEl, "This paragraph");
    } else {
      hideBubble();
    }
  }

  function hoverModifier(e) {
    const key = settings.hoverKey || "Alt";
    if (key === "Shift") return e.shiftKey;
    if (key === "Control") return e.ctrlKey || e.metaKey;
    if (key === "Alt") return e.altKey;
    return e.altKey;
  }

  function onKey(e) {
    if (!settings.hoverEnabled) return;
    if (!hoverModifier(e) || e.repeat) return;
    if (hoverEl) {
      hoverEl.classList.add("pbt-hovering");
      showBubble(hoverEl, "翻译中…");
      translateOne(hoverEl);
    }
  }

  function onKeyUp(e) {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") {
      document.querySelectorAll(".pbt-hovering").forEach((n) => n.classList.remove("pbt-hovering"));
    }
  }

  async function translateHover() {
    const el = hoverEl || blockFromPoint(lastXY.x, lastXY.y);
    if (!el) {
      toast("请先把指针移到一段文字上");
      return { ok: false };
    }
    return translateOne(el);
  }

  async function translateOne(el) {
    const text = textOf(el);
    if (!worth(el, text)) return { ok: false };
    try {
      const id = ensureId(el);
      const rows = await requestBatch([{ id, text, el }]);
      const row = rows.find((r) => r.id === id) || rows[0];
      if (row) attach(el, row.text, "ok");
      translated = true;
      renderFab();
      hideBubble();
      return { ok: true };
    } catch (err) {
      attach(el, String(err.message || err), "fail");
      toast(String(err.message || err), true);
      return { ok: false, error: String(err.message || err) };
    }
  }

  function onMouseUp(e) {
    if (e.target?.closest?.("#pbt-root")) return;
    if (!settings.selectionEnabled) return;
    setTimeout(() => translateSelection(false), 20);
  }

  async function translateSelection(force) {
    if (!settings.selectionEnabled && !force) return { ok: true };
    const sel = window.getSelection();
    const text = sel && String(sel).replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) {
      if (!force) hideTip();
      return { ok: true };
    }
    if (sel.anchorNode && sel.anchorNode.parentElement?.closest("#pbt-root")) return { ok: true };
    let rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch {
      return { ok: true };
    }
    if (text.length > 2500) {
      showTip(rect, "Selection too long (2500 char max).");
      return { ok: false };
    }
    const host = sel.anchorNode?.parentElement?.closest?.(".pbt-host");
    showTip(rect, "翻译中…");
    try {
      const id = `s${++seq}`;
      const rows = await requestBatch([{ id, text }]);
      const row = rows.find((r) => r.id === id) || rows[0];
      lastSel = { text, dst: row?.text || "", host };
      showTip(rect, lastSel.dst, true);
      return { ok: true };
    } catch (err) {
      showTip(rect, String(err.message || err));
      return { ok: false };
    }
  }

  async function pinTerm() {
    if (!lastSel?.text) return;
    const src = lastSel.text.slice(0, 80);
    const dst = lastSel.dst || src;
    const i = glossary.findIndex((g) => g.src.toLowerCase() === src.toLowerCase());
    if (i >= 0) glossary[i] = { src, dst };
    else glossary.push({ src, dst });
    await persistGlossary();
    // Identity pin also grows the durable proper-noun whitelist (keep-as-is).
    if (PBT.pnNormKey(src) === PBT.pnNormKey(dst)) {
      properNounStore = await PBT.pnAdd(src, { pinned: true });
      properNounList = PBT.pnTermList(properNounStore);
    }
    toast(`已固定术语：${src} → ${dst}`);
    if (lastSel.host) retryOne(lastSel.host);
  }

  /** Selection → keep as-is forever (durable whitelist, not page glossary). */
  async function pinProperNoun() {
    if (!lastSel?.text) return;
    const src = PBT.pnSanitizeTerm(lastSel.text.slice(0, 64));
    if (!src) {
      toast("专名过长或无效", true);
      return;
    }
    properNounStore = await PBT.pnAdd(src, { pinned: true });
    properNounList = PBT.pnTermList(properNounStore);
    toast(`已保留专名：${src}`);
    if (lastSel.host) retryOne(lastSel.host);
  }

  function onInputGesture(e) {
    if (!settings.inputEnabled) return;
    const t = e.target;
    if (!isEditable(t)) return;
    if (settings.inputGesture !== "triple-space") return;
    if (e.key !== " " && e.code !== "Space") {
      spaceHits = [];
      return;
    }
    const now = Date.now();
    spaceHits = spaceHits.filter((t0) => now - t0 < 700);
    spaceHits.push(now);
    if (spaceHits.length >= 3) {
      spaceHits = [];
      e.preventDefault();
      stripTrailingSpaces(t, 3);
      translateEditable(t);
    }
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.matches?.("input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],textarea")) return true;
    return !!el.isContentEditable;
  }

  function stripTrailingSpaces(el, n) {
    if (el.isContentEditable) {
      el.textContent = (el.textContent || "").replace(/ {1,3}$/, (m) => m.slice(0, Math.max(0, m.length - n)));
      return;
    }
    if (typeof el.value === "string") el.value = el.value.replace(/ {1,3}$/, (m) => m.slice(0, Math.max(0, m.length - n)));
  }

  async function translateFocusedInput() {
    const el = document.activeElement;
    if (!isEditable(el)) {
      toast("请先点进输入框");
      return { ok: false };
    }
    return translateEditable(el);
  }

  async function translateEditable(el) {
    const text = (el.isContentEditable ? el.textContent : el.value || "").replace(/\s+/g, " ").trim();
    if (!text) return { ok: false };
    toast("正在翻译输入框…");
    try {
      const id = `i${++seq}`;
      const rows = await requestBatch([{ id, text }]);
      const row = rows.find((r) => r.id === id) || rows[0];
      const next = row?.text || text;
      if (el.isContentEditable) el.textContent = next;
      else {
        el.value = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      toast("输入框已翻译");
      return { ok: true };
    } catch (err) {
      toast(String(err.message || err), true);
      return { ok: false };
    }
  }

  function mountUi() {
    if (ui.host) return;
    const host = document.createElement("div");
    host.id = "pbt-root";
    host.setAttribute("translate", "no");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .fab {
          position: fixed;
          right: max(14px, env(safe-area-inset-right, 0px));
          bottom: max(28px, env(safe-area-inset-bottom, 0px));
          top: auto; z-index: 2147483646;
          display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
          font: 11px/1.2 ui-sans-serif, system-ui, sans-serif;
          touch-action: none; user-select: none;
          cursor: grab;
        }
        .fab.dragging { cursor: grabbing; opacity: .92; }
        button { border: 0; cursor: pointer; color: #fff; background: #000; box-shadow: 0 1px 6px rgba(0,0,0,.22); }
        .orb {
          width: 26px; height: 28px; border-radius: 7px; font-weight: 700; font-size: 11px;
          opacity: .9; border: 1px solid #000; background: #000; color: #fff;
        }
        .orb:hover { opacity: 1; }
        .orb.on { opacity: 1; background: #fff; color: #000; border: 1px solid #000; }
        .toast {
          position: fixed;
          right: max(14px, env(safe-area-inset-right, 0px));
          bottom: calc(max(28px, env(safe-area-inset-bottom, 0px)) + 72px);
          left: auto; transform: none;
          z-index: 2147483645; max-width: min(168px, 40vw);
          background: #000; color: #fff; padding: 4px 7px; border-radius: 8px;
          font: 10px/1.3 ui-sans-serif, system-ui, sans-serif;
          box-shadow: 0 4px 14px rgba(0,0,0,.28); display: none;
          pointer-events: none; border: 1px solid #000;
        }
        .toast.err { background: #000; color: #fff; border: 1px solid #fff; }
        @media (max-width: 600px) {
          .fab {
            right: max(12px, env(safe-area-inset-right, 0px));
            bottom: max(24px, env(safe-area-inset-bottom, 0px));
          }
          .toast {
            max-width: min(136px, 36vw);
            font-size: 10px;
            padding: 3px 6px;
            bottom: calc(max(24px, env(safe-area-inset-bottom, 0px)) + 68px);
            right: max(12px, env(safe-area-inset-right, 0px));
          }
        }
        .tip, .bubble {
          position: fixed; z-index: 2147483647; max-width: min(420px, 90vw);
          background: #000; color: #fff; padding: 8px 10px; border-radius: 8px;
          font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
          box-shadow: 0 8px 28px rgba(0,0,0,.28); display: none;
          border: 1px solid #000;
        }
        .tip-text { white-space: pre-wrap; }
        .tip-actions { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
        .tip-actions button { padding: 4px 8px; border-radius: 6px; font-size: 12px; }
        .bubble { pointer-events: none; opacity: .92; font-size: 12px; padding: 4px 8px; }
      </style>
      <div class="fab">
        <button class="orb" id="orb" title="开启整页替换翻译">译</button>
      </div>
      <div class="toast" id="toast"></div>
      <div class="tip" id="tip">
        <div class="tip-text" id="tipText"></div>
        <div class="tip-actions">
          <button type="button" id="pin">固定术语</button>
          <button type="button" id="pinPn">保留专名</button>
        </div>
      </div>
      <div class="bubble" id="bubble"></div>
    `;
    document.documentElement.appendChild(host);
    ui.host = host;
    ui.shadow = shadow;
    const fab = shadow.querySelector(".fab");
    bindFabDrag(fab);
    shadow.getElementById("orb").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fab?.dataset.pbtMoved === "1") return;
      // 唯一浮钮：关→开（replace 整页 + 持久化）；开→关（restore + serviceOff）
      if (settings.serviceOn || translated || translating) {
        settings.serviceOn = false;
        PBT.save({ serviceOn: false });
        if (translated || translating) restoreAll();
        else {
          renderFab();
          toast("已恢复原文");
        }
      } else {
        settings.displayMode = "replace";
        settings.scope = "full";
        settings.serviceOn = true;
        PBT.save({ displayMode: "replace", scope: "full", serviceOn: true });
        renderFab();
        translatePage("full");
      }
    });
    shadow.getElementById("pin").addEventListener("click", (e) => {
      e.preventDefault();
      pinTerm();
    });
    shadow.getElementById("pinPn").addEventListener("click", (e) => {
      e.preventDefault();
      pinProperNoun();
    });
    renderFab();
  }

  function bindFabDrag(fab) {
    if (!fab || fab.dataset.pbtDragBound) return;
    fab.dataset.pbtDragBound = "1";
    const KEY = "pbtFabPos";
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        placeFab(fab, saved.left, saved.top);
      }
    } catch { /* ignore */ }

    let startX = 0, startY = 0, origL = 0, origT = 0, dragging = false, moved = false;

    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      fab.dataset.pbtMoved = "1";
      fab.classList.add("dragging");
      placeFab(fab, origL + dx, origT + dy);
      if (e.cancelable) e.preventDefault();
    };

    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      fab.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("touchmove", onMove, true);
      window.removeEventListener("touchend", onUp, true);
      if (moved) {
        const r = fab.getBoundingClientRect();
        try {
          localStorage.setItem(KEY, JSON.stringify({ left: r.left, top: r.top }));
        } catch { /* ignore */ }
        // 吞掉随后的 click
        setTimeout(() => { fab.dataset.pbtMoved = "0"; }, 0);
      } else {
        fab.dataset.pbtMoved = "0";
      }
    };

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      const pt = e.touches ? e.touches[0] : e;
      const r = fab.getBoundingClientRect();
      startX = pt.clientX;
      startY = pt.clientY;
      origL = r.left;
      origT = r.top;
      dragging = true;
      moved = false;
      fab.dataset.pbtMoved = "0";
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
      window.addEventListener("touchmove", onMove, { capture: true, passive: false });
      window.addEventListener("touchend", onUp, true);
    };

    fab.addEventListener("pointerdown", onDown);
    fab.addEventListener("touchstart", onDown, { passive: true });
  }


  function nudgeFabAwayFromContent() {
    if (!ui.shadow) return;
    const fab = ui.shadow.querySelector(".fab");
    const toastEl = ui.shadow.getElementById("toast");
    if (!fab) return;
    // 用户拖过则不自动挪
    try {
      if (localStorage.getItem("pbtFabPos")) return;
    } catch { /* ignore */ }
    const fr = fab.getBoundingClientRect();
    let hit = false;
    const midY0 = (window.innerHeight || 800) * 0.22;
    const midY1 = (window.innerHeight || 800) * 0.78;
    // toast 不得压中部段落
    if (toastEl && toastEl.style.display !== "none") {
      const tr = toastEl.getBoundingClientRect();
      if (tr.top < midY1 && tr.bottom > midY0) {
        toastEl.style.bottom = `calc(max(28px, env(safe-area-inset-bottom, 0px)) + 72px)`;
        toastEl.style.top = "auto";
        toastEl.style.right = `max(14px, env(safe-area-inset-right, 0px))`;
        toastEl.style.left = "auto";
      }
    }
    for (const node of document.querySelectorAll(".pbt-tr, .pbt-host")) {
      let r;
      try {
        r = node.getBoundingClientRect();
      } catch {
        continue;
      }
      if (r.width < 8 || r.height < 8) continue;
      if (rectsOverlap(fr, r, 10)) {
        hit = true;
        break;
      }
    }
    if (!hit) return;
    const w = fab.offsetWidth || 28;
    const h = fab.offsetHeight || 56;
    const left = Math.max(8, window.innerWidth - w - 16);
    const top = Math.max(8, window.innerHeight - h - 32);
    placeFab(fab, left, top);
  }

  function placeFab(fab, left, top) {
    const w = fab.offsetWidth || 28;
    const h = fab.offsetHeight || 56;
    const maxL = Math.max(0, window.innerWidth - w - 2);
    const maxT = Math.max(0, window.innerHeight - h - 2);
    const l = Math.min(maxL, Math.max(0, left));
    const t = Math.min(maxT, Math.max(0, top));
    fab.style.left = l + "px";
    fab.style.top = t + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  }

  function renderFab() {
    if (!ui.shadow) return;
    const orb = ui.shadow.getElementById("orb");
    if (!orb) return;
    // 唯一浮钮：关=「译」；开=「原」（恢复）
    const on = !!settings.serviceOn;
    orb.textContent = on ? "原" : "译";
    orb.title = on
      ? translated
        ? "停止翻译并恢复原文"
        : translating
          ? "翻译中…· 点击停止并恢复原文"
          : "翻译已开· 点击停止并恢复原文"
      : "开启整页替换翻译（全语言）";
    orb.classList.toggle("on", on);
  }

  let toastTimer;
  function toast(text, err, sticky) {
    mountUi();
    const el = ui.shadow.getElementById("toast");
    el.textContent = text;
    el.classList.toggle("err", !!err);
    el.style.display = "block";
    // 强制贴右下，勿落中部段落
    el.style.top = "auto";
    el.style.left = "auto";
    el.style.right = "max(14px, env(safe-area-inset-right, 0px))";
    el.style.bottom = "calc(max(28px, env(safe-area-inset-bottom, 0px)) + 72px)";
    clearTimeout(toastTimer);
    try {
      nudgeFabAwayFromContent();
    } catch { /* ignore */ }
    if (!sticky) {
      toastTimer = setTimeout(() => {
        el.style.display = "none";
      }, err ? 7000 : 2800);
    }
  }

  function showTip(rect, text, pinable) {
    mountUi();
    const el = ui.shadow.getElementById("tip");
    ui.shadow.getElementById("tipText").textContent = text;
    const show = pinable ? "inline-block" : "none";
    ui.shadow.getElementById("pin").style.display = show;
    const pinPn = ui.shadow.getElementById("pinPn");
    if (pinPn) pinPn.style.display = show;
    el.style.display = "block";
    el.style.top = `${Math.min(window.innerHeight - 12, rect.bottom + 8)}px`;
    el.style.left = `${Math.min(window.innerWidth - 24, Math.max(8, rect.left))}px`;
  }

  function hideTip() {
    const el = ui.shadow?.getElementById("tip");
    if (el) el.style.display = "none";
  }

  function showBubble(el, text) {
    mountUi();
    const b = ui.shadow.getElementById("bubble");
    b.textContent = text;
    b.style.display = "block";
    const r = el.getBoundingClientRect();
    b.style.top = `${Math.max(8, r.top - 28)}px`;
    b.style.left = `${Math.min(window.innerWidth - 160, Math.max(8, r.left))}px`;
  }

  function hideBubble() {
    const b = ui.shadow?.getElementById("bubble");
    if (b) b.style.display = "none";
  }

  /* —— serviceOn 软自动：SPA / bfcache / 可见性 / hash / DOM —— */
  let softAutoTimer = 0;
  let lastSoftUrl = location.href;
  let spaDomTimer = 0;
  let spaBodyMo = null;

  function clearPageTranslationLight() {
    runId += 1;
    unwatchDynamicMenus();
    if (stopScrollWatch) {
      try { stopScrollWatch(); } catch { /* ignore */ }
      stopScrollWatch = null;
    }
    coldItems = [];
    document.querySelectorAll(".pbt-tr, .pbt-float").forEach((n) => n.remove());
    document.querySelectorAll(".pbt-host, .pbt-text-swap, .pbt-replace, .pbt-skip, .pbt-queued").forEach((el) => {
      try { restoreTextSwap(el); } catch { /* ignore */ }
      try { clearReplaceTypography(el); } catch { /* ignore */ }
      el.classList.remove(
        "pbt-host", "pbt-trans-only", "pbt-hide-visual", "pbt-hovering",
        "pbt-layout-row", "pbt-layout-stack", "pbt-chrome", "pbt-host-flex",
        "pbt-text-swap", "pbt-replace", "pbt-queued", "pbt-skip"
      );
      delete el.dataset.pbtState;
      delete el.dataset.pbtTrText;
      delete el.dataset.pbtOrigText;
      delete el.dataset.pbtLeafOrig;
      delete el.dataset.pbtRole;
      delete el.dataset.pbtSkipReason;
      delete el.dataset.pbtFailed;
    });
    translated = false;
    translating = false;
    renderFab();
  }

  function softAutoTranslate(reason, attempt) {
    if (!settings.serviceOn) return;
    const att = attempt || 0;
    // 导航重试允许在空结果后再跑；普通路径避开并发
    if (translating) return;
    if (translated && att === 0 && reason !== "nav" && reason !== "hash" && reason !== "dom-empty") return;
    clearTimeout(softAutoTimer);
    const delay =
      reason === "nav" || reason === "hash"
        ? 380 + att * 700
        : reason === "dom" || reason === "dom-empty"
          ? 520 + att * 500
          : 280;
    softAutoTimer = setTimeout(async () => {
      if (!settings.serviceOn) return;
      if (translating) return;
      if (translated && att === 0 && reason !== "nav" && reason !== "hash" && reason !== "dom-empty") return;
      if (settings.displayMode !== "replace") settings.displayMode = "replace";
      settings.scope = "full";
      try {
        const r = await translatePage("full");
        if (settings.serviceOn && (!r || r.ok === false || r.error === "empty") && att < 5) {
          softAutoTranslate(reason === "dom" ? "dom-empty" : reason, att + 1);
        } else if (settings.serviceOn) {
          scheduleMissSweep(PBT_MISS_SWEEP_MS);
        }
      } catch {
        if (att < 5) softAutoTranslate(reason, att + 1);
      }
    }, delay);
  }

  function onSpaUrlMaybeChanged() {
    const href = location.href;
    if (href === lastSoftUrl) return;
    lastSoftUrl = href;
    // 同文档导航：轻量清 DOM 译文，再软自动（含未译态也重跑，防半页残留）
    if (translated || translating || document.querySelector(".pbt-host, .pbt-replace, .pbt-tr")) {
      clearPageTranslationLight();
    }
    loadTrCache().then(() => softAutoTranslate("nav")).catch(() => softAutoTranslate("nav"));
  }

  function watchServiceOnSpaDom() {
    if (spaBodyMo) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    spaBodyMo = new MutationObserver(() => {
      if (!settings.serviceOn) return;
      clearTimeout(spaDomTimer);
      spaDomTimer = setTimeout(() => {
        if (!settings.serviceOn) return;
        if (translating) {
          scheduleTranslateNew();
          scheduleMissSweep(PBT_MISS_SWEEP_MS);
          return;
        }
        if (!translated) softAutoTranslate("dom");
        else {
          scheduleTranslateNew();
          scheduleMissSweep(PBT_MISS_SWEEP_MS);
        }
      }, 480);
    });
    spaBodyMo.observe(root, { childList: true, subtree: true });
  }

  window.addEventListener("pageshow", (ev) => {
    if (settings.serviceOn && (!translated || ev.persisted)) softAutoTranslate("pageshow");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && settings.serviceOn && !translated && !translating) {
      softAutoTranslate("visible");
    }
  });
  window.addEventListener("popstate", () => onSpaUrlMaybeChanged());
  window.addEventListener("hashchange", () => onSpaUrlMaybeChanged());
  try {
    const _ps = history.pushState;
    const _rs = history.replaceState;
    history.pushState = function () {
      const r = _ps.apply(this, arguments);
      queueMicrotask(onSpaUrlMaybeChanged);
      return r;
    };
    history.replaceState = function () {
      const r = _rs.apply(this, arguments);
      queueMicrotask(onSpaUrlMaybeChanged);
      return r;
    };
  } catch { /* ignore */ }

  // 启动即挂 SPA DOM 观察（serviceOn 时补译 / 软自动）
  watchServiceOnSpaDom();

})();
