const $ = (id) => document.getElementById(id);

async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function ask(payload) {
  const t = await tab();
  if (!t?.id) throw new Error("没有活动标签页");
  try {
    return await chrome.tabs.sendMessage(t.id, payload);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["shared.js", "content.js"] });
    return chrome.tabs.sendMessage(t.id, payload);
  }
}

function setStatus(text, err) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("err", !!err);
}

(async () => {
  const keyState = await chrome.runtime.sendMessage({ type: "PBT_HAS_KEY" });
  if (!keyState?.hasKey) {
    setStatus(
      keyState?.engine === "cursor"
        ? "Cursor bridge 未就绪（启动 bridge/server.mjs）。"
        : "请先在选项里填写 DeepSeek API Key。",
      true
    );
  }
  try {
    const st = await ask({ type: "PBT_STATUS" });
    $("toggle").textContent = st?.translated ? "显示原文" : "翻译本页";
  } catch { /* ignore */ }

  $("toggle").onclick = async () => {
    setStatus("处理中…");
    try {
      const r = await ask({ type: "PBT_TOGGLE" });
      $("toggle").textContent = r?.translated ? "显示原文" : "翻译本页";
      setStatus(r?.error || (r?.translated ? `完成（${r.count || 0}）` : "已恢复原文"), !!r?.error);
    } catch (e) {
      setStatus(String(e.message || e), true);
    }
  };
  $("opts").onclick = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
})();
