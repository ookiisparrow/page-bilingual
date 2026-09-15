import fs from "node:fs";
const file = process.argv[2];
let src = fs.readFileSync(file, "utf8");
const stub = `
globalThis.__stub = { counts: {}, calls: 0, chars: 0 };
async function translateBatch(items, targetLang, page, properNouns) {
  try { return await stubOnce(items, properNouns); } catch (e) { await new Promise((r) => setTimeout(r, 600)); return stubOnce(items, properNouns); }
}
async function stubOnce(items, properNouns) {
  const { pbtStubMode, pbtStubLatency } = await chrome.storage.local.get(["pbtStubMode", "pbtStubLatency"]);
  const mode = pbtStubMode || "ok";
  const lat = pbtStubLatency ?? 750;
  globalThis.__stub.calls += 1;
  for (const it of items) {
    globalThis.__stub.counts[it.text] = (globalThis.__stub.counts[it.text] || 0) + 1;
    globalThis.__stub.chars = (globalThis.__stub.chars || 0) + String(it.text).length;
  }
  const HAN = "译文测试内容节点覆盖检查中文字符样例段落链接标题按钮表格列表";
  const keep = new Set((properNouns || []).map((t) => t.toLowerCase()));
  const word = (w) => {
    if (keep.has(w.toLowerCase())) return w;
    let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const n = Math.max(1, Math.min(3, Math.round(w.length / 3))); let s = "";
    for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) >>> 0; s += HAN[h % HAN.length]; }
    return s;
  };
  const fake = (t) => t.split(/(§\\/?\\d+§|<\\/?b\\d+>)/).map((p) => (/^(§\\/?\\d+§|<\\/?b\\d+>)$/.test(p) ? p : p.replace(/[A-Za-z\\u00C0-\\u024F][A-Za-z\\u00C0-\\u024F''-]*/g, word))).join("");
  await new Promise((r) => setTimeout(r, lat * (0.8 + Math.random() * 0.4)));
  let rows = items.map((it) => ({ id: it.id, text: "译" + fake(String(it.text)) }));
  if (mode === "droptags") rows = rows.map((r) => ({ ...r, text: r.text.replace(/§\\/?\\d+§|<\\/?b\\d+>/g, "") }));
  return rows;
}
`;
const i = src.indexOf("async function translateBatch(");
fs.writeFileSync(file, src.slice(0, i) + stub);
