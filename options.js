const KEYS = [
  "targetLang",
  "engine",
  "deepseekApiUrl",
  "deepseekModel",
  "cursorApiUrl",
  "cursorModel",
  "displayMode",
  "scope",
  "excludeCss",
  "hoverEnabled",
  "hoverKey",
  "selectionEnabled",
  "inputEnabled",
  "inputGesture",
  "trSize",
  "trColor",
  "trOpacity",
];

async function renderProperNouns() {
  const store = await PBT.pnLoad();
  const list = document.getElementById("pnList");
  const count = document.getElementById("pnCount");
  if (!list) return;
  list.innerHTML = "";
  const terms = PBT.pnTermList(store);
  for (const term of terms) {
    const key = PBT.pnNormKey(term);
    const pinned = !!store.terms[key]?.pinned;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = pinned ? `${term} ×` : `${term} ×`;
    chip.title = pinned ? "用户固定 · 点击删除" : "点击删除";
    chip.style.cssText =
      "border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:2px 8px;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;cursor:pointer";
    if (pinned) chip.style.borderColor = "#111";
    chip.onclick = async () => {
      await PBT.pnRemove(term);
      renderProperNouns();
    };
    list.appendChild(chip);
  }
  if (count) count.textContent = `共 ${terms.length} / ${PBT.PN_CAP}（超出时优先淘汰未固定的旧词）`;
}

(async () => {
  const s = await PBT.loadAll();
  const lang = document.getElementById("targetLang");
  for (const [code, label] of PBT.LANGS) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${label} (${code})`;
    lang.appendChild(o);
  }
  for (const k of KEYS) {
    const el = document.getElementById(k);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!s[k];
    else el.value = s[k] ?? "";
  }
  document.getElementById("deepseekApiKey").value = s.deepseekApiKey || "";
  await renderProperNouns();

  document.getElementById("pnAddBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("pnAdd");
    const term = input?.value || "";
    const next = await PBT.pnAdd(term, { pinned: true });
    if (!next) return;
    if (input) input.value = "";
    renderProperNouns();
  });
  document.getElementById("pnAdd")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("pnAddBtn")?.click();
    }
  });

  document.getElementById("save").onclick = async () => {
    const patch = {};
    for (const k of KEYS) {
      const el = document.getElementById(k);
      if (!el) continue;
      patch[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    }
    patch.deepseekApiKey = document.getElementById("deepseekApiKey").value.trim();
    await PBT.save(patch);
    const note = document.getElementById("saved");
    note.textContent = "已保存";
    setTimeout(() => (note.textContent = ""), 1600);
  };

  const errEl = document.getElementById("errLog");
  async function refreshErrLog() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "PBT_GET_ERROR_LOG" });
      const entries = r?.entries || [];
      if (!entries.length) {
        errEl.textContent = "（暂无记录。触发一次翻译失败后再刷新。）";
        return;
      }
      errEl.textContent = JSON.stringify(entries.slice(-40).reverse(), null, 2);
    } catch (e) {
      errEl.textContent = String(e.message || e);
    }
  }
  document.getElementById("errRefresh").onclick = () => refreshErrLog();
  document.getElementById("errCopy").onclick = async () => {
    const text = errEl.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      const note = document.getElementById("saved");
      note.textContent = "日志已复制";
      setTimeout(() => (note.textContent = ""), 1600);
    } catch (e) {
      const note = document.getElementById("saved");
      note.textContent = String(e.message || e);
    }
  };
  document.getElementById("errClear").onclick = async () => {
    await chrome.runtime.sendMessage({ type: "PBT_CLEAR_ERROR_LOG" });
    refreshErrLog();
  };
  refreshErrLog();
})();
