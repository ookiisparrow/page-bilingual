(() => {
  if (window.__pbtLoaded) return;
  window.__pbtLoaded = true;

  // Never collected; omitted from a host's source text when inline.
  const SKIP =
    "script,style,noscript,template,svg,math,canvas,iframe,video,audio,pre,textarea,input,select,option,[contenteditable],#pbt-root,.pbt-tr";
  // Never collected; kept verbatim (still shown to the model for context) when inline.
  const KEEP = "code,kbd,samp,var,time,[translate='no'],.notranslate";
  const BLOCK_TAGS = new Set(
    "P DIV SECTION ARTICLE MAIN HEADER FOOTER NAV ASIDE UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TD TH CAPTION H1 H2 H3 H4 H5 H6 BLOCKQUOTE FIGURE FIGCAPTION FORM FIELDSET LEGEND DETAILS SUMMARY BUTTON HR ADDRESS".split(" ")
  );
  const INLINE_TAGS = new Set("EM STRONG B I U S SMALL MARK ABBR SUP SUB Q CITE DEL INS BR WBR IMG PICTURE SVG CODE KBD SAMP VAR TIME".split(" "));
  const MAIN_ROOT = "article,main,[role='main'],#mw-content-text,.markdown-body";
  const HOVER_BLOCK = "p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd,blockquote,figcaption,summary,button,label";
  const TARGET_SCRIPT = { zh: /[\u4e00-\u9fff]/, ja: /[\u3040-\u30ff]/, ko: /[\uac00-\ud7af]/, en: /[A-Za-z]/ };
  // URLs, emails, paths, identifiers: one token with a digit/underscore, a leading slash or two slashes.
  const NOISE = /^(?:https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|\S*[\d_]\S*|\/\S+|\S+\/\S+\/\S*)$/i;
  const CACHE_KEY = "pbt.segCache.v2";
  const CACHE_CAP = 2000;
  const MAX_CHARS = 2400;
  const MAX_HOST_CHARS = 4000;
  const MO_OPTS = { childList: true, subtree: true };

  const unitOf = new Map(); // host element → unit
  const cache = new Map(); // cacheKey → translation (insertion order = LRU)
  let settings = { ...PBT.DEFAULTS };
  let glossary = [];
  let nouns = [];
  let active = false;
  let runId = 0;
  let queue = [];
  let workers = 0;
  let mo = null;
  let moTimer = 0;
  const dirty = new Set(); // mutation roots awaiting re-collect
  const thrash = new WeakMap(); // host → times the page rewrote it after we painted
  let scrollTimer = 0;
  let persistTimer = 0;
  let lastSel = null;
  let hoverEl = null;
  let lastXY = { x: 0, y: 0 };
  let spaceHits = [];
  let lastPath = location.pathname + location.search;
  const ui = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stripTags = (s) => String(s || "").replace(/<\/?b\d+>/g, "");
  const hasLetters = (n) => /\p{L}/u.test(n.textContent || "");
  const isCursor = () => /^(cursor|bridge)$/i.test(settings.engine || "");
  const engineId = () => (isCursor() ? `cursor:${settings.cursorModel}` : `deepseek:${settings.deepseekModel}`);
  const cacheKey = (src) => `${settings.targetLang}|${engineId()}|${src}`;
  const glossKey = () => `pbt.glossary.${location.host}`;
  const count = (st) => [...unitOf.values()].filter((u) => u.el.dataset.pbtState === st).length;
  const okCount = () => count("ok");

  function safeMatches(el, sel) {
    try {
      return !!sel && el.matches(sel);
    } catch {
      return false;
    }
  }

  /* ---------- collect: block-level element = translation unit ---------- */

  function isBlockBox(n) {
    if (n.nodeType !== 1) return false;
    if (n.dataset.pbtState || BLOCK_TAGS.has(n.tagName)) return true;
    if (INLINE_TAGS.has(n.tagName)) return false;
    return !getComputedStyle(n).display.startsWith("inline");
  }

  /** Host text with inline descendants as <bN>…</bN> so the model can keep links/emphasis in place. */
  function serialize(host) {
    const map = [];
    let plain = "";
    const walk = (el, keep) => {
      let s = "";
      for (const n of el.childNodes) {
        if (n.nodeType === 3) {
          s += n.data;
          if (!keep) plain += n.data;
        } else if (n.nodeType === 1 && !n.matches(SKIP) && /\p{L}|\p{N}/u.test(n.textContent)) {
          const k = keep || n.matches(KEEP);
          const id = map.push({ el: n, keep: k });
          s += `<b${id}>${walk(n, k)}</b${id}>`;
        }
      }
      return s;
    };
    const src = walk(host, false).replace(/\s+/g, " ").trim();
    return { el: host, src, map, plain: plain.trim() };
  }

  function needsTranslate(text) {
    const letters = text.match(/\p{L}/gu) || [];
    if (letters.length < 2 || NOISE.test(text.trim())) return false;
    const re = TARGET_SCRIPT[settings.targetLang.slice(0, 2)];
    return !re || letters.filter((c) => re.test(c)).length / letters.length < 0.5;
  }

  // ponytail: orphan text next to block siblings gets a span wrapper (unwrapped on restore).
  function wrap(run) {
    const span = document.createElement("span");
    span.className = "pbt-wrap";
    run[0].parentNode.insertBefore(span, run[0]);
    span.append(...run);
    return span;
  }

  function collect(root, out) {
    const push = (el) => {
      const u = serialize(el);
      const ok = needsTranslate(u.plain) && u.plain.length <= MAX_HOST_CHARS;
      if (ok) out.push(u);
      return ok;
    };
    const visit = (el) => {
      if (el.nodeType !== 1 || el.dataset.pbtState || el.matches(SKIP) || el.matches(KEEP) || safeMatches(el, settings.excludeCss)) return;
      if (el.shadowRoot) {
        mo?.observe(el.shadowRoot, MO_OPTS);
        children(el.shadowRoot);
      }
      children(el);
    };
    const children = (el) => {
      const kids = [...el.childNodes];
      if (!kids.some(isBlockBox)) {
        if (el.nodeType === 1) push(el);
        return;
      }
      let run = [];
      const flush = () => {
        const span = run.some((n) => n.nodeType === 3 && hasLetters(n)) && wrap(run);
        if (!span || !push(span)) {
          if (span) span.replaceWith(...span.childNodes);
          run.forEach((n) => n.nodeType === 1 && visit(n));
        }
        run = [];
      };
      for (const n of kids) {
        if (isBlockBox(n)) {
          flush();
          visit(n);
        } else run.push(n);
      }
      flush();
    };
    visit(root);
  }

  /* ---------- queue: viewport-first, dedupe, cache ---------- */

  function distance(el) {
    const r = el.getBoundingClientRect();
    return r.width || r.height ? Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) : Infinity;
  }

  function sortQueue() {
    const d = new Map(queue.map((u) => [u, distance(u.el)]));
    queue.sort((a, b) => d.get(a) - d.get(b));
  }

  function enqueue(units) {
    for (const u of units) {
      u.el.dataset.pbtState = "queued";
      unitOf.set(u.el, u);
      queue.push(u);
    }
    sortQueue();
    for (let n = (isCursor() ? 2 : 3) - workers; n > 0 && queue.length; n--) worker(runId);
  }

  async function worker(my) {
    workers += 1;
    try {
      while (queue.length && my === runId) {
        const batch = [];
        let chars = 0;
        while (queue.length && batch.length < (isCursor() ? 6 : 12) && (!batch.length || chars + queue[0].src.length <= MAX_CHARS)) {
          const u = queue.shift();
          if (u.dead) continue;
          batch.push(u);
          chars += u.src.length;
        }
        if (batch.length) await translateBatch(batch, my);
        if (my === runId) toast(`翻译中 ${okCount()}/${unitOf.size}…`, false, true);
      }
    } finally {
      // workers of a superseded run (restore → start) must not count against the new one
      if (my === runId && !(workers -= 1)) finish();
    }
  }

  function finish() {
    for (const el of [...unitOf.keys()]) if (!el.isConnected) unitOf.delete(el);
    const ok = okCount();
    const fail = count("fail");
    toast(fail ? `完成 ${ok} · 失败 ${fail}` : `已翻译 ${ok} 段`, fail > 0);
    renderFab();
  }

  async function translateBatch(batch, my) {
    const groups = new Map();
    for (const u of batch) (groups.get(u.src) || groups.set(u.src, []).get(u.src)).push(u);
    const items = [];
    for (const [src, us] of groups) {
      const hit = cache.get(cacheKey(src));
      if (hit) us.forEach((u) => accept(u, hit));
      else items.push({ id: String(items.length), text: src, us });
    }
    if (!items.length) return;
    try {
      const rows = await request(items.map(({ id, text }) => ({ id, text })));
      if (my !== runId) return;
      const byId = new Map(rows.map((r) => [String(r.id), r.text]));
      for (const it of items) for (const u of it.us) (byId.get(it.id) ? accept(u, byId.get(it.id)) : settle(u, "fail"));
    } catch (e) {
      if (my !== runId) return;
      for (const it of items) for (const u of it.us) settle(u, "fail");
      toast(String(e.message || e), true);
    }
  }

  async function request(items) {
    const blob = items.map((i) => i.text).join("\n").toLowerCase();
    const msg = {
      type: "PBT_BATCH",
      items,
      targetLang: settings.targetLang,
      glossary,
      properNouns: nouns.filter((t) => blob.includes(t.toLowerCase())).slice(0, 80),
      page: { title: document.title, host: location.host },
    };
    const res = await withTimeout(chrome.runtime.sendMessage(msg), 100000, "扩展后台超时 100s（翻译引擎无响应）").catch((e) => {
      chrome.runtime
        .sendMessage({ type: "PBT_LOG_ERROR", message: String(e.message || e).slice(0, 400), source: "content", host: location.host, engine: settings.engine })
        .catch(() => {});
      throw e;
    });
    if (!res?.ok) throw new Error(res?.error || "翻译失败");
    return res.items || [];
  }

  function withTimeout(p, ms, msg) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(msg)), ms);
      p.then(
        (v) => (clearTimeout(t), res(v)),
        (e) => (clearTimeout(t), rej(e))
      );
    });
  }

  /* ---------- result gate ---------- */

  /** Model parroted the source (or answered in the wrong script): keep the original. */
  function shouldSkipResult(src, dst) {
    const norm = (t) => stripTags(t).replace(/\s+/g, "").toLowerCase();
    const d = norm(dst);
    if (!d || d === norm(src)) return true;
    const re = TARGET_SCRIPT[settings.targetLang.slice(0, 2)];
    return !!re && !re.test(d);
  }

  /** "EN — ZH": drop a verbatim copy of the source glued in front of the translation. */
  function clean(src, dst) {
    const d = String(dst || "").trim();
    if (src.length >= 6 && d.length > src.length && d.toLowerCase().startsWith(src.toLowerCase())) {
      const rest = d.slice(src.length).replace(/^[\s—–\-:：|·、,，.。/（(【[]+/, "");
      if (rest && !shouldSkipResult(src, rest)) return rest;
    }
    return d;
  }

  function accept(u, dst) {
    dst = clean(u.src, dst);
    if (shouldSkipResult(u.src, dst)) {
      // bounded retry budget: one more single-item attempt, then keep the original
      if (!u.retried) {
        u.retried = true;
        queue.unshift(u);
        return;
      }
      settle(u, "skip");
      return;
    }
    remember(cacheKey(u.src), dst);
    paint(u, dst);
  }

  function settle(u, state) {
    u.el.dataset.pbtState = state;
  }

  /* ---------- paint ---------- */

  function parse(s) {
    const root = { parts: [] };
    const stack = [root];
    const seen = new Set();
    const re = /<(\/?)b(\d+)>/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      const top = stack[stack.length - 1];
      if (m.index > last) top.parts.push(s.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) {
        if (stack.length > 1) stack.pop();
      } else {
        const node = { id: +m[2], parts: [] };
        seen.add(node.id);
        top.parts.push(node);
        stack.push(node);
      }
    }
    if (last < s.length) stack[stack.length - 1].parts.push(s.slice(last));
    return { parts: root.parts, seen };
  }

  const flatten = (parts) => parts.map((p) => (typeof p === "string" ? p : flatten(p.parts))).join("");

  /** Text between tags → the text-node slot at the same position among E's tagged children. */
  function write(u, E, parts) {
    const tagged = new Set(u.map.map((m) => m.el));
    const slots = [[]];
    const anchors = [];
    for (const n of E.childNodes) {
      if (n.nodeType === 3) slots[slots.length - 1].push(n);
      else if (tagged.has(n)) {
        anchors.push(n);
        slots.push([]);
      }
    }
    let p = 0;
    let buf = "";
    const flush = () => {
      const nodes = slots[p] || [];
      if (nodes.length) nodes.forEach((n, i) => (n.data = i ? "" : buf));
      else if (buf.trim()) u.created.push(E.insertBefore(document.createTextNode(buf), anchors[p] || null));
      buf = "";
      p += 1;
    };
    for (const part of parts) {
      if (typeof part === "string") {
        buf += part;
        continue;
      }
      flush();
      const m = u.map[part.id - 1];
      if (!m) buf += flatten(part.parts);
      else if (!m.keep) write(u, m.el, part.parts);
    }
    flush();
    for (let q = p; q < slots.length; q++) slots[q].forEach((n) => (n.data = ""));
  }

  /** Fallback when the model dropped tags: spread the plain translation over the original text nodes. */
  function distribute(nodes, text) {
    const live = nodes.filter((n) => n.data.trim() && !n.parentElement?.closest(`${KEEP},${SKIP}`));
    const chars = [...text];
    const total = live.reduce((a, n) => a + n.data.trim().length, 0);
    let at = 0;
    live.forEach((n, i) => {
      const end = i === live.length - 1 ? chars.length : at + Math.round((chars.length * n.data.trim().length) / total);
      n.data = chars.slice(at, end).join("");
      at = end;
    });
  }

  function textNodes(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }

  function paint(u, dst) {
    if (settings.displayMode === "replace") {
      const nodes = textNodes(u.el);
      u.snap = nodes.map((n) => [n, n.data]);
      u.created = [];
      const { parts, seen } = parse(dst);
      if (u.map.every((m, i) => m.keep || seen.has(i + 1))) write(u, u.el, parts);
      else distribute(nodes, stripTags(dst));
    } else {
      u.bar = document.createElement("div");
      u.bar.className = "pbt-tr";
      u.bar.textContent = stripTags(dst);
      u.el.after(u.bar);
      u.el.classList.toggle("pbt-hide-visual", settings.displayMode === "translation");
    }
    u.el.classList.add("pbt-host");
    u.el.dataset.pbtState = "ok";
    mo?.takeRecords();
  }

  function resetHost(el) {
    const u = unitOf.get(el);
    if (!u) return;
    u.dead = true;
    u.bar?.remove();
    u.created?.forEach((n) => n.remove());
    u.snap?.forEach(([n, d]) => (n.data = d));
    el.classList.remove("pbt-host", "pbt-hide-visual");
    delete el.dataset.pbtState;
    if (el.classList.contains("pbt-wrap")) el.replaceWith(...el.childNodes);
    unitOf.delete(el);
  }

  /* ---------- lifecycle ---------- */

  async function start(scope) {
    if (!document.body) return { ok: false, error: "no body" };
    const mode = settings.displayMode === "replace" ? "full" : scope || settings.scope;
    const root = (mode === "main" && document.querySelector(MAIN_ROOT)) || document.body;
    if (!active) {
      active = true;
      runId += 1;
      observe();
      renderFab();
    }
    const units = [];
    collect(root, units);
    mo?.takeRecords();
    if (!units.length && !unitOf.size) toast("没有可翻译的段落");
    else toast(`翻译中 0/${units.length}（先译可见区）…`, false, true);
    enqueue(units);
    while (workers) await sleep(250);
    return { ok: true, translated: active, count: okCount() };
  }

  function restore() {
    runId += 1;
    active = false;
    queue = [];
    workers = 0;
    mo?.disconnect();
    mo = null;
    clearTimeout(moTimer);
    moTimer = 0;
    dirty.clear();
    for (const el of [...unitOf.keys()]) resetHost(el);
    renderFab();
    return { ok: true, translated: false };
  }

  function setService(on) {
    settings.serviceOn = on;
    if (on) settings.displayMode = "replace";
    PBT.save(on ? { serviceOn: true, displayMode: "replace", scope: "full" } : { serviceOn: false });
    if (on) return start("full");
    restore();
    toast("已恢复原文");
    return { ok: true, translated: false };
  }

  function translateNew(roots) {
    const units = [];
    for (const r of roots) if (r?.isConnected && !r.closest(`${SKIP},${KEEP}`)) collect(r, units);
    mo?.takeRecords();
    if (units.length) enqueue(units);
  }

  /** Page mutations only; our own writes are drained with takeRecords() right after each paint. */
  function observe() {
    if (mo) return;
    mo = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!t) continue;
        const host = t.closest("[data-pbt-state]");
        if (host) {
          const parent = host.parentElement;
          const n = (thrash.get(host) || 0) + 1;
          thrash.set(host, n);
          resetHost(host);
          // page keeps rewriting this node (ticker / typewriter): stop chasing it
          if (n > 3) host.dataset.pbtState = "skip";
          dirty.add(parent || t);
        } else dirty.add(t);
      }
      // fixed window, not a trailing debounce: pages that mutate continuously must still flush
      if (!moTimer) {
        moTimer = setTimeout(() => {
          moTimer = 0;
          const roots = [...dirty];
          dirty.clear();
          if (active) translateNew(roots);
        }, 400);
      }
    });
    mo.observe(document.body, MO_OPTS);
  }

  function onNav() {
    const p = location.pathname + location.search;
    if (p === lastPath) return;
    lastPath = p;
    if (active) restore();
    if (settings.serviceOn) setTimeout(() => start("full"), 300);
  }

  /* ---------- cache ---------- */

  async function loadCache() {
    try {
      const d = await chrome.storage.local.get(CACHE_KEY);
      for (const [k, v] of d[CACHE_KEY] || []) cache.set(k, v);
      chrome.storage.local.remove("pbt.segCache.v1");
    } catch {
      /* optional */
    }
  }

  function remember(k, v) {
    cache.delete(k);
    cache.set(k, v);
    while (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistCache, 2000);
  }

  function persistCache() {
    chrome.storage.local.set({ [CACHE_KEY]: [...cache] }).catch(() => {});
  }

  /* ---------- hover / selection / input ---------- */

  function hoverKeyDown(e) {
    const k = settings.hoverKey || "Alt";
    return k === "Shift" ? e.shiftKey : k === "Control" ? e.ctrlKey || e.metaKey : e.altKey;
  }

  function blockAt(x, y) {
    const el = document.elementsFromPoint(x, y).find((e) => !e.closest("#pbt-root"));
    return el && (el.closest(HOVER_BLOCK) || el);
  }

  async function translateOne(el) {
    if (!el || el.closest("[data-pbt-state]")) return { ok: true };
    const units = [];
    collect(el, units);
    mo?.takeRecords();
    if (!units.length) return { ok: false };
    enqueue(units);
    while (workers) await sleep(250);
    return { ok: true };
  }

  function translateHover() {
    const el = hoverEl || blockAt(lastXY.x, lastXY.y);
    if (!el) {
      toast("请先把指针移到一段文字上");
      return { ok: false };
    }
    return translateOne(el);
  }

  async function translateText(text) {
    const k = cacheKey(text);
    if (cache.has(k)) return cache.get(k);
    const dst = (await request([{ id: "0", text }]))[0]?.text;
    if (!dst) throw new Error("翻译失败");
    remember(k, dst);
    return dst;
  }

  async function translateSelection(force) {
    if (!settings.selectionEnabled && !force) return { ok: true };
    const sel = getSelection();
    const text = String(sel).replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) {
      if (!force) hideTip();
      return { ok: true };
    }
    if (sel.anchorNode?.parentElement?.closest("#pbt-root")) return { ok: true };
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (text.length > 2500) {
      showTip(rect, "选中文字过长（上限 2500 字）");
      return { ok: false };
    }
    showTip(rect, "翻译中…");
    try {
      const dst = await translateText(text);
      lastSel = { text, dst, host: sel.anchorNode?.parentElement?.closest("[data-pbt-state]") };
      showTip(rect, dst, true);
      return { ok: true };
    } catch (e) {
      showTip(rect, String(e.message || e));
      return { ok: false };
    }
  }

  /** Re-translate the host a pinned term came from, bypassing the cache. */
  function redo(host) {
    const u = host && unitOf.get(host);
    if (!u) return;
    cache.delete(cacheKey(u.src));
    const parent = host.parentElement;
    resetHost(host);
    translateNew([parent]);
  }

  async function pinTerm() {
    if (!lastSel) return;
    const src = lastSel.text.slice(0, 80);
    const dst = lastSel.dst || src;
    glossary = glossary.filter((g) => g.src.toLowerCase() !== src.toLowerCase()).concat({ src, dst });
    chrome.storage.local.set({ [glossKey()]: glossary }).catch(() => {});
    if (PBT.pnNormKey(src) === PBT.pnNormKey(dst)) nouns = PBT.pnTermList(await PBT.pnAdd(src, { pinned: true }));
    toast(`已固定术语：${src} → ${dst}`);
    redo(lastSel.host);
  }

  async function pinProperNoun() {
    if (!lastSel) return;
    const src = PBT.pnSanitizeTerm(lastSel.text.slice(0, 64));
    if (!src) return toast("专名过长或无效", true);
    nouns = PBT.pnTermList(await PBT.pnAdd(src, { pinned: true }));
    toast(`已保留专名：${src}`);
    redo(lastSel.host);
  }

  const isEditable = (el) =>
    !!el && (safeMatches(el, "input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],textarea") || el.isContentEditable);

  function translateFocusedInput() {
    const el = document.activeElement;
    if (!isEditable(el)) {
      toast("请先点进输入框");
      return { ok: false };
    }
    return translateEditable(el);
  }

  async function translateEditable(el) {
    const text = (el.isContentEditable ? el.textContent : el.value).replace(/\s+/g, " ").trim();
    if (!text) return { ok: false };
    toast("正在翻译输入框…");
    try {
      const dst = await translateText(text);
      if (el.isContentEditable) el.textContent = dst;
      else {
        el.value = dst;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      toast("输入框已翻译");
      return { ok: true };
    } catch (e) {
      toast(String(e.message || e), true);
      return { ok: false };
    }
  }

  /* ---------- UI (shadow root: fab, toast, tip) ---------- */

  function mountUi() {
    if (ui.shadow) return;
    const host = document.createElement("div");
    host.id = "pbt-root";
    host.setAttribute("translate", "no");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .fab { position: fixed; right: max(14px, env(safe-area-inset-right, 0px)); bottom: max(28px, env(safe-area-inset-bottom, 0px));
          z-index: 2147483646; touch-action: none; user-select: none; cursor: grab; }
        .orb { width: 26px; height: 28px; border: 1px solid #000; border-radius: 7px; background: #000; color: #fff;
          font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; opacity: .9; box-shadow: 0 1px 6px rgba(0,0,0,.22); }
        .orb.on { background: #fff; color: #000; opacity: 1; }
        .toast, .tip { position: fixed; z-index: 2147483645; background: #000; color: #fff; border: 1px solid #000; border-radius: 8px; display: none;
          box-shadow: 0 4px 14px rgba(0,0,0,.28); font: 10px/1.3 ui-sans-serif, system-ui, sans-serif; }
        .toast { right: max(14px, env(safe-area-inset-right, 0px)); bottom: calc(max(28px, env(safe-area-inset-bottom, 0px)) + 72px);
          max-width: min(168px, 40vw); padding: 4px 7px; pointer-events: none; }
        .toast.err { border-color: #fff; }
        .tip { z-index: 2147483647; max-width: min(420px, 90vw); padding: 8px 10px; font-size: 13px; line-height: 1.45; }
        .tip-text { white-space: pre-wrap; }
        .tip-actions { margin-top: 6px; display: flex; gap: 6px; }
        .tip-actions button { padding: 4px 8px; border: 0; border-radius: 6px; background: #333; color: #fff; font-size: 12px; cursor: pointer; }
      </style>
      <div class="fab"><button class="orb" id="orb">译</button></div>
      <div class="toast" id="toast"></div>
      <div class="tip" id="tip"><div class="tip-text" id="tipText"></div>
        <div class="tip-actions"><button id="pin">固定术语</button><button id="pinPn">保留专名</button></div></div>`;
    document.documentElement.appendChild(host);
    ui.shadow = shadow;
    const fab = shadow.querySelector(".fab");
    bindDrag(fab);
    shadow.getElementById("orb").addEventListener("click", (e) => {
      e.preventDefault();
      if (!fab.dataset.moved) setService(!(settings.serviceOn || active));
    });
    shadow.getElementById("pin").addEventListener("click", pinTerm);
    shadow.getElementById("pinPn").addEventListener("click", pinProperNoun);
    renderFab();
  }

  function bindDrag(fab) {
    let sx, sy, ox, oy, moved;
    try {
      const s = JSON.parse(localStorage.getItem("pbtFabPos"));
      if (s) placeFab(fab, s.left, s.top);
    } catch {
      /* ignore */
    }
    fab.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      const r = fab.getBoundingClientRect();
      [sx, sy, ox, oy, moved] = [e.clientX, e.clientY, r.left, r.top, false];
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener("pointermove", (e) => {
      if (!fab.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      placeFab(fab, ox + dx, oy + dy);
    });
    fab.addEventListener("pointerup", (e) => {
      fab.releasePointerCapture(e.pointerId);
      if (!moved) return;
      const r = fab.getBoundingClientRect();
      try {
        localStorage.setItem("pbtFabPos", JSON.stringify({ left: r.left, top: r.top }));
      } catch {
        /* ignore */
      }
      fab.dataset.moved = "1";
      setTimeout(() => delete fab.dataset.moved, 0);
    });
  }

  function placeFab(fab, left, top) {
    fab.style.left = `${Math.min(Math.max(0, left), innerWidth - 30)}px`;
    fab.style.top = `${Math.min(Math.max(0, top), innerHeight - 30)}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  }

  function renderFab() {
    const orb = ui.shadow?.getElementById("orb");
    if (!orb) return;
    const on = !!(settings.serviceOn || active);
    orb.textContent = on ? "原" : "译";
    orb.title = on ? "停止翻译并恢复原文" : "开启整页替换翻译";
    orb.classList.toggle("on", on);
  }

  let toastTimer = 0;
  function toast(text, err, sticky) {
    mountUi();
    const el = ui.shadow.getElementById("toast");
    el.textContent = text;
    el.classList.toggle("err", !!err);
    el.style.display = "block";
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => (el.style.display = "none"), err ? 7000 : 2800);
  }

  function showTip(rect, text, pinable) {
    mountUi();
    const el = ui.shadow.getElementById("tip");
    ui.shadow.getElementById("tipText").textContent = text;
    el.querySelector(".tip-actions").style.display = pinable ? "flex" : "none";
    el.style.display = "block";
    el.style.top = `${Math.min(innerHeight - 12, rect.bottom + 8)}px`;
    el.style.left = `${Math.min(innerWidth - 24, Math.max(8, rect.left))}px`;
  }

  function hideTip() {
    const el = ui.shadow?.getElementById("tip");
    if (el) el.style.display = "none";
  }

  function applyStyle() {
    const r = document.documentElement.style;
    r.setProperty("--pbt-size", settings.trSize || "0.98em");
    r.setProperty("--pbt-color", settings.trColor || "inherit");
    r.setProperty("--pbt-opacity", settings.trOpacity || "1");
  }

  /* ---------- wiring ---------- */

  function handle(msg) {
    switch (msg.type) {
      case "PBT_TOGGLE":
        return setService(!(settings.serviceOn || active));
      case "PBT_TRANSLATE":
        return start(msg.scope);
      case "PBT_RESTORE":
        toast("已恢复原文");
        return restore();
      case "PBT_HOVER":
        return translateHover();
      case "PBT_INPUT":
        return translateFocusedInput();
      case "PBT_SELECTION":
        return translateSelection(true);
      case "PBT_STATUS":
        return { ok: true, translated: active, count: okCount() };
      default:
        return { ok: true };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    Promise.resolve()
      .then(() => handle(msg))
      .then((r) => reply(r || { ok: true }), (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  });

  chrome.storage.onChanged.addListener((chg, area) => {
    if (area !== "local") return;
    if (chg[PBT.PN_STORE_KEY]) nouns = PBT.pnTermList(PBT.pnEnsureStore(chg[PBT.PN_STORE_KEY].newValue));
    for (const k of Object.keys(chg)) if (k in PBT.DEFAULTS) settings[k] = chg[k].newValue;
    applyStyle();
    if (chg.serviceOn) {
      if (settings.serviceOn && !active) start("full");
      else if (!settings.serviceOn && active) restore();
    } else if (active && (chg.displayMode || chg.targetLang || chg.engine)) {
      restore();
      start();
    }
  });

  document.addEventListener(
    "mousemove",
    (e) => {
      lastXY = { x: e.clientX, y: e.clientY };
      hoverEl?.classList.remove("pbt-hovering");
      hoverEl = settings.hoverEnabled && hoverKeyDown(e) ? blockAt(e.clientX, e.clientY) : null;
      hoverEl?.classList.add("pbt-hovering");
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (settings.hoverEnabled && hoverEl && hoverKeyDown(e) && !e.repeat) translateOne(hoverEl);
      const t = e.target;
      if (!settings.inputEnabled || settings.inputGesture !== "triple-space" || !isEditable(t)) return;
      if (e.key !== " ") return void (spaceHits = []);
      const now = Date.now();
      spaceHits = spaceHits.filter((x) => now - x < 700).concat(now);
      if (spaceHits.length < 3) return;
      spaceHits = [];
      e.preventDefault();
      if (t.isContentEditable) t.textContent = t.textContent.replace(/ {0,2}$/, "");
      else t.value = t.value.replace(/ {0,2}$/, "");
      translateEditable(t);
    },
    true
  );
  document.addEventListener("keyup", () => hoverEl?.classList.remove("pbt-hovering"), true);
  document.addEventListener(
    "mouseup",
    (e) => {
      if (settings.selectionEnabled && !e.target?.closest?.("#pbt-root")) setTimeout(() => translateSelection(false), 20);
    },
    true
  );
  addEventListener(
    "scroll",
    () => {
      if (!queue.length) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(sortQueue, 200);
    },
    { passive: true, capture: true }
  );
  addEventListener("pagehide", persistCache);
  addEventListener("popstate", onNav);
  for (const fn of ["pushState", "replaceState"]) {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(onNav);
      return r;
    };
  }

  PBT.settings().then(async (s) => {
    settings = s;
    applyStyle();
    glossary = (await chrome.storage.local.get(glossKey()))[glossKey()] || [];
    nouns = PBT.pnTermList(await PBT.pnLoad());
    await loadCache();
    mountUi();
    // after load: SSR frameworks have hydrated, so our text swaps don't trip hydration mismatches
    if (settings.serviceOn) document.readyState === "complete" ? start("full") : addEventListener("load", () => start("full"));
  });
})();
