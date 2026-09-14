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
})();
