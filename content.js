(() => {
  if (window.__pbtLoaded) return;
  window.__pbtLoaded = true;

  // Ablation switches (test builds fill this set; empty in the shipped file). See docs/ablation-1.4.56.md.
  const ABLATE = new Set();
  const off = (name) => ABLATE.has(name);

  // Never collected; omitted from a host's source text when inline.
  const SKIP =
    "script,style,noscript,template,svg,math,canvas,iframe,video,audio,pre,textarea,input,select,option,[contenteditable],#pbt-root";
  // Never collected; kept verbatim (still shown to the model for context) when inline.
  const KEEP = "code,kbd,samp,var,time,relative-time,[translate='no'],.notranslate";
  const BLOCK_TAGS = new Set(
    "P DIV SECTION ARTICLE MAIN HEADER FOOTER NAV ASIDE UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TD TH CAPTION H1 H2 H3 H4 H5 H6 BLOCKQUOTE FIGURE FIGCAPTION FORM FIELDSET LEGEND DETAILS SUMMARY BUTTON HR ADDRESS".split(" ")
  );
  const INLINE_TAGS = new Set("EM STRONG B I U S SMALL MARK ABBR SUP SUB Q CITE DEL INS BR WBR IMG PICTURE SVG CODE KBD SAMP VAR TIME".split(" "));
  const TARGET_SCRIPT = { zh: /[\u4e00-\u9fff]/, ja: /[\u3040-\u30ff]/, ko: /[\uac00-\ud7af]/, en: /[A-Za-z]/ };
  // URLs, emails, identifiers and paths: one token that is dotted / digit- or underscore-bearing (README.md, v1),
  // or two same-case tokens joined by a slash (omacom / omarchy, agents/skills, CI/CD — but not the UI label Print/export).
  const NOISE = /^(?:https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|\S*[\d_.]\S*|\/\S+|[a-z][\w.-]*\s*\/\s*[a-z][\w.-]*|[A-Z][A-Z-]*\/[A-Z][A-Z-]*)$/;
  // One all-lowercase or ALL-CAPS token; only an identifier when it names its own link target (see isPathLabel).
  const HANDLE = /^(?:[a-z][a-z-]*|[A-Z][A-Z-]+)$/;
  const CACHE_KEY = "pbt.segCache.v2";
  const CACHE_CAP = 2000;
  const MAX_CHARS = 3600;
  const MAX_HOST_CHARS = 4000;
  const SLICE_MS = 8; // collect work per frame
  const MO_OPTS = { childList: true, subtree: true };

  const unitOf = new Map(); // host element → unit
  const cache = new Map(); // cacheKey → translation (insertion order = LRU)
  const dirty = new Set(); // mutation roots awaiting re-collect
  const thrash = new WeakMap(); // host → times the page rewrote it after we painted
  const inflight = new Set(); // source texts currently being requested
  const failed = new Set(); // source texts whose request failed in this run
  let settings = { ...PBT.DEFAULTS };
  let nouns = [];
  let active = false;
  let runId = 0;
  let queue = [];
  let workers = 0;
  let mo = null;
  let moTimer = 0;
  let persistTimer = 0;
  let collecting = Promise.resolve(); // collects run one at a time so a subtree is never wrapped twice
  const ui = {};

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const stripTags = (s) => String(s || "").replace(/<\/?b\d+>/g, "");
  const hasLetters = (n) => /\p{L}/u.test(n.textContent || "");
  const isCursor = () => /^(cursor|bridge)$/i.test(settings.engine || "");
  const engineId = () => (isCursor() ? `cursor:${settings.cursorModel}` : `deepseek:${settings.deepseekModel}`);
  const cacheKey = (src) => `${settings.targetLang}|${engineId()}|${src}`;
  const okCount = () => [...unitOf.values()].filter((u) => u.el.dataset.pbtState === "ok").length;

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

  /** Host text with inline descendants as <bN>…</bN> so the model can keep links/emphasis in place (links lose their words without it). */
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
    const tagged = walk(host, false).replace(/\s+/g, " ").trim();
    return { el: host, src: off("tags") ? stripTags(tagged) : tagged, map, plain: plain.trim() };
  }

  function needsTranslate(u) {
    const t = u.plain;
    const letters = t.match(/\p{L}/gu) || [];
    if (letters.length < 2 || (!off("identifier") && (NOISE.test(t) || isPathLabel(u.el, t)))) return false;
    const re = TARGET_SCRIPT[settings.targetLang.slice(0, 2)];
    return !re || letters.filter((c) => re.test(c)).length / letters.length < 0.5;
  }

  /** `bin` → /tree/quattro/bin, `ryanrhughes` → /ryanrhughes: the label is the last path segment of its own link.
   *  `edit` → ?action=edit and an href-less `hide` button are UI words and get translated. */
  function isPathLabel(el, t) {
    if (!HANDLE.test(t)) return false;
    const a = el.matches("a[href]") ? el : el.querySelector("a[href]");
    try {
      return !!a && decodeURIComponent(new URL(a.href).pathname).split("/").filter(Boolean).pop()?.toLowerCase() === t.toLowerCase();
    } catch {
      return false;
    }
  }

  // ponytail: orphan text next to block siblings gets a span wrapper (unwrapped on restore). Ablation: +63 leftovers without it.
  function wrap(run) {
    const span = document.createElement("span");
    span.className = "pbt-wrap";
    run[0].parentNode.insertBefore(span, run[0]);
    span.append(...run);
    return span;
  }

  /** Depth-first walk as a generator so the driver can yield to the frame between elements. */
  function* visit(el, out) {
    if (el.nodeType !== 1 || el.dataset.pbtState || el.matches(SKIP) || el.matches(KEEP) || safeMatches(el, settings.excludeCss)) return;
    yield;
    if (el.shadowRoot && !off("shadow")) {
      // MDN compat table / mdn-button: +2–4 leftovers without shadow descent
      mo?.observe(el.shadowRoot, MO_OPTS);
      yield* children(el.shadowRoot, out);
    }
    yield* children(el, out);
  }

  function* children(el, out) {
    const kids = [...el.childNodes];
    if (!kids.some(isBlockBox)) {
      if (el.nodeType === 1) push(el, out);
      return;
    }
    let run = [];
    for (const n of kids) {
      if (isBlockBox(n)) {
        yield* flush(run, out);
        run = [];
        yield* visit(n, out);
      } else run.push(n);
    }
    yield* flush(run, out);
  }

  /** An inline run between block siblings: wrap it into one unit if it carries text, else visit its elements. */
  function* flush(run, out) {
    const span = !off("wrap") && run.some((n) => n.nodeType === 3 && hasLetters(n)) && wrap(run);
    if (span && push(span, out)) return;
    if (span) span.replaceWith(...span.childNodes);
    for (const n of run) if (n.nodeType === 1) yield* visit(n, out);
  }

  function push(el, out) {
    const u = serialize(el);
    const ok = needsTranslate(u) && u.plain.length <= MAX_HOST_CHARS;
    if (ok) out.push(u);
    return ok;
  }

  /** Collect `root` in ≤ SLICE_MS slices, enqueueing what each slice found; own DOM writes are drained before yielding.
   *  Ablation: worst main-thread task on omarchy 167 → 98 ms; Wikipedia/MDN collect is < 50 ms either way. */
  function collect(root) {
    const job = async () => {
      const out = [];
      let deadline = performance.now() + SLICE_MS;
      for (const it = visit(root, out); !it.next().done; ) {
        if (off("chunk") || performance.now() < deadline) continue;
        mo?.takeRecords();
        enqueue(out.splice(0));
        await frame();
        deadline = performance.now() + SLICE_MS;
      }
      mo?.takeRecords();
      enqueue(out);
    };
    return (collecting = collecting.then(job, job));
  }

  /* ---------- queue: viewport-first, dedupe, cache ---------- */

  function distance(el) {
    const r = el.getBoundingClientRect();
    return r.width || r.height ? Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) : Infinity;
  }

  function enqueue(units) {
    if (!units.length) return;
    for (const u of units) {
      u.el.dataset.pbtState = "queued";
      unitOf.set(u.el, u);
      queue.push(u);
    }
    // viewport-first order protects CLS (0.094 → 0.139 without it)
    if (!off("sort")) {
      const d = new Map(queue.map((u) => [u, distance(u.el)]));
      queue.sort((a, b) => d.get(a) - d.get(b));
    }
    // 6 parallel requests: settle +2.3 s at 3, ×3 at 1
    const max = off("workers") ? 1 : isCursor() ? 2 : off("workers6") ? 3 : 6;
    for (let n = max - workers; n > 0 && queue.length; n--) worker(runId);
  }

  /** Pull the next batch off the queue; units whose text is already in flight wait for the cache hit.
   *  Char-packed 20-block batches: ablation showed 12-block batches cost +112 requests / +0.7 s settle, and
   *  small first batches bought ~100 ms of first paint for +0.56 s settle and 4× the calls during an outage. */
  function nextBatch() {
    const batch = [];
    const deferred = [];
    const size = off("batch") ? 1 : isCursor() ? 6 : 20;
    let chars = 0;
    while (queue.length && batch.length < size && (!batch.length || chars + queue[0].src.length <= MAX_CHARS)) {
      const u = queue.shift();
      if (u.dead) continue;
      if (inflight.has(u.src)) deferred.push(u);
      else {
        batch.push(u);
        chars += u.src.length;
      }
    }
    queue.push(...deferred);
    return batch;
  }

  async function worker(my) {
    workers += 1;
    try {
      while (queue.length && my === runId) {
        const batch = nextBatch();
        if (batch.length) await translateBatch(batch, my);
        else await sleep(50);
      }
    } finally {
      // workers of a superseded run (restore → start) must not count against the new one
      if (my === runId) workers -= 1;
    }
  }

  /** Group a batch by source text; cache hits paint immediately, the rest become request items.
   *  Dedupe + in-flight wait: 16 requests per text without it. Cache: warm reload 441 → 1105 ms and 302 calls without it. */
  function splitBatch(batch) {
    const groups = new Map();
    for (const u of batch) {
      const key = off("dedupe") ? u : u.src;
      (groups.get(key) || groups.set(key, []).get(key)).push(u);
    }
    const items = [];
    for (const us of groups.values()) {
      const hit = !off("cache") && cache.get(cacheKey(us[0].src));
      if (hit) us.forEach((u) => paint(u, hit));
      // a text that already failed this run is not requested again by its other copies (bounds an outage to 2 calls per text)
      else if (failed.has(us[0].src) && !off("failmemo")) us.forEach((u) => settle(u, "fail"));
      else items.push({ id: String(items.length), text: us[0].src, us });
    }
    return items;
  }

  async function translateBatch(batch, my) {
    const items = splitBatch(batch);
    if (!items.length) return;
    if (!off("dedupe")) items.forEach((it) => inflight.add(it.text));
    try {
      const rows = await request(items.map(({ id, text }) => ({ id, text })));
      if (my !== runId) return;
      const byId = new Map(rows.map((r) => [String(r.id), r.text]));
      for (const it of items) for (const u of it.us) accept(u, byId.get(it.id));
    } catch (e) {
      if (my !== runId) return;
      for (const it of items) {
        failed.add(it.text);
        for (const u of it.us) settle(u, "fail");
      }
      toast(String(e.message || e));
    } finally {
      items.forEach((it) => inflight.delete(it.text));
    }
  }

  async function request(items) {
    const blob = items.map((i) => i.text).join("\n").toLowerCase();
    const msg = {
      type: "PBT_BATCH",
      items,
      targetLang: settings.targetLang,
      properNouns: off("nouns") ? [] : nouns.filter((t) => blob.includes(t.toLowerCase())).slice(0, 80),
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

  /** Missing row → one re-request (ablation: +140 blocks on partial responses); still missing → keep the source.
   *  A result identical to the source is simply painted (a no-op), so no echo check is needed. */
  function accept(u, dst) {
    if (!dst && !u.retried && !off("missretry")) {
      u.retried = true;
      queue.unshift(u);
      return;
    }
    if (!dst) return settle(u, "skip");
    if (!off("cache")) remember(cacheKey(u.src), dst);
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
    const flushSlot = () => {
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
      flushSlot();
      const m = u.map[part.id - 1];
      if (!m) buf += flatten(part.parts);
      else if (!m.keep) write(u, m.el, part.parts);
    }
    flushSlot();
    for (let q = p; q < slots.length; q++) slots[q].forEach((n) => (n.data = ""));
  }

  function paint(u, dst) {
    // result for a unit the page already rewrote or removed: painting it would overwrite the page's newer text (stale paint)
    if (!off("deadguard") && (u.dead || !u.el.isConnected)) return;
    const { parts, seen } = parse(dst);
    const nodes = [];
    const w = document.createTreeWalker(u.el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    u.snap = nodes.map((n) => [n, n.data]);
    u.created = [];
    if (u.map.every((m, i) => m.keep || seen.has(i + 1))) write(u, u.el, parts);
    else {
      // tags did not round-trip: plain translation into the longest text node, blank the rest (structure kept)
      const live = nodes.filter((n) => n.data.trim() && !n.parentElement?.closest(`${KEEP},${SKIP}`));
      const main = live.reduce((a, n) => (n.data.trim().length > (a?.data.trim().length || 0) ? n : a), null);
      live.forEach((n) => (n.data = n === main ? stripTags(dst) : ""));
    }
    u.el.dataset.pbtState = "ok";
    if (!off("selfignore")) mo?.takeRecords();
  }

  function resetHost(el) {
    const u = unitOf.get(el);
    if (!u) return;
    u.dead = true;
    u.created?.forEach((n) => n.remove());
    u.snap?.forEach(([n, d]) => (n.data = d));
    delete el.dataset.pbtState;
    if (el.classList.contains("pbt-wrap")) el.replaceWith(...el.childNodes);
    unitOf.delete(el);
  }

  /* ---------- lifecycle ---------- */

  async function start() {
    if (!document.body) return { ok: false, error: "no body" };
    if (!active) {
      active = true;
      runId += 1;
      observe();
      renderFab();
    }
    await collect(document.body);
    while (workers) await sleep(250);
    return { ok: true, translated: active, count: okCount() };
  }

  function restore() {
    runId += 1;
    active = false;
    failed.clear();
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
    PBT.save({ serviceOn: on });
    return on ? start() : restore();
  }

  async function translateNew(roots) {
    for (const r of roots) if (r?.isConnected && !r.closest(`${SKIP},${KEEP}`)) await collect(r);
  }

  /** A page mutation under one of our hosts: give the host back to the page and re-collect from its parent. */
  function markDirty(t) {
    const host = t.closest("[data-pbt-state]");
    if (!host) return dirty.add(t);
    const parent = host.parentElement;
    const n = (thrash.get(host) || 0) + 1;
    thrash.set(host, n);
    resetHost(host);
    // page keeps rewriting this node (ticker / typewriter): stop chasing it — settle +25 s on omarchy without this
    if (n > 3 && !off("thrash")) host.dataset.pbtState = "skip";
    dirty.add(parent || t);
  }

  /** Page mutations only (+753 leftovers without the observer); our own writes are drained with takeRecords()
   *  right after each paint (853 repaints and half-painted blocks without that). */
  function observe() {
    if (mo || off("observer")) return;
    mo = new MutationObserver((records) => {
      for (const r of records) {
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (t) markDirty(t);
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

  /* ---------- UI: one toggle button, one error toast ---------- */

  function mountUi() {
    if (ui.shadow) return;
    const host = document.createElement("div");
    host.id = "pbt-root";
    host.setAttribute("translate", "no");
    ui.shadow = host.attachShadow({ mode: "open" });
    ui.shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .orb { position: fixed; right: max(14px, env(safe-area-inset-right, 0px)); bottom: max(28px, env(safe-area-inset-bottom, 0px));
          z-index: 2147483646; width: 26px; height: 28px; border: 1px solid #000; border-radius: 7px; background: #000; color: #fff;
          font: 700 11px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer; opacity: .9; box-shadow: 0 1px 6px rgba(0,0,0,.22); }
        .orb.on { background: #fff; color: #000; opacity: 1; }
        .toast { position: fixed; right: max(14px, env(safe-area-inset-right, 0px)); bottom: calc(max(28px, env(safe-area-inset-bottom, 0px)) + 40px);
          z-index: 2147483645; max-width: min(240px, 60vw); padding: 4px 7px; border: 1px solid #fff; border-radius: 8px; background: #000; color: #fff;
          font: 10px/1.3 ui-sans-serif, system-ui, sans-serif; display: none; pointer-events: none; }
      </style>
      <button class="orb" id="orb">译</button>
      <div class="toast" id="toast"></div>`;
    document.documentElement.appendChild(host);
    ui.shadow.getElementById("orb").addEventListener("click", () => setService(!(settings.serviceOn || active)));
    renderFab();
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
  function toast(text) {
    mountUi();
    const el = ui.shadow.getElementById("toast");
    el.textContent = text;
    el.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.display = "none"), 7000);
  }

  /* ---------- wiring ---------- */

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    const jobs = {
      PBT_TOGGLE: () => setService(!(settings.serviceOn || active)),
      PBT_TRANSLATE: start,
      PBT_RESTORE: restore,
      PBT_STATUS: () => ({ ok: true, translated: active, count: okCount() }),
    };
    Promise.resolve()
      .then(jobs[msg?.type] || (() => ({ ok: true })))
      .then(reply, (e) => reply({ ok: false, error: String(e.message || e) }));
    return true;
  });

  chrome.storage.onChanged.addListener((chg, area) => {
    if (area !== "local") return;
    if (chg[PBT.PN_STORE_KEY]) nouns = PBT.pnTermList(PBT.pnEnsureStore(chg[PBT.PN_STORE_KEY].newValue));
    for (const k of Object.keys(chg)) if (k in PBT.DEFAULTS) settings[k] = chg[k].newValue;
    if (chg.serviceOn) {
      if (settings.serviceOn && !active) start();
      else if (!settings.serviceOn && active) restore();
    } else if (active && (chg.targetLang || chg.engine || chg.excludeCss)) {
      restore();
      start();
    }
  });

  addEventListener("pagehide", persistCache);

  PBT.settings().then(async (s) => {
    settings = s;
    nouns = PBT.pnTermList(await PBT.pnLoad());
    await loadCache();
    mountUi();
    // after load: SSR frameworks have hydrated, so our text swaps don't trip hydration mismatches (repaints +4 without it)
    if (!settings.serviceOn) return;
    if (off("loadgate") || document.readyState === "complete") start();
    else addEventListener("load", () => start());
  });
})();
