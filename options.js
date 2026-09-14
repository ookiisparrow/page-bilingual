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
