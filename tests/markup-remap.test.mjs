/**
 * Unit tests for §N§ local markup remap (serialize / parse / alignPlain / per-node fallback).
 * Run: node tests/markup-remap.test.mjs
 */
import assert from "node:assert/strict";

const phOpen = (id) => `§${id}§`;
const phClose = (id) => `§/${id}§`;

function serializeTree(nodes, map = [], plainRef = { v: "" }) {
  let s = "";
  for (const n of nodes) {
    if (n.type === "text") {
      s += n.data;
      plainRef.v += n.data;
    } else if (n.type === "inline") {
      const id = map.push({ keep: !!n.keep, label: n.label });
      s += phOpen(id) + serializeTree(n.children, map, plainRef) + phClose(id);
    }
  }
  return s;
}

function parse(s) {
  const root = { parts: [] };
  const stack = [root];
  const seen = new Set();
  const re = /§(\/?)(\d+)§/g;
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

function flatten(parts) {
  return parts.map((p) => (typeof p === "string" ? p : flatten(p.parts))).join("");
}

function fallbackIds(map, seen) {
  const fb = new Set();
  map.forEach((m, i) => {
    if (!m.keep && !seen.has(i + 1)) fb.add(i + 1);
  });
  return fb;
}

function alignPlain(slots, dst) {
  const clean = String(dst || "").replace(/§\/?\d+§/g, "").trim();
  if (!clean) return null;
  const textIdx = slots.map((s, i) => (s.len != null ? i : -1)).filter((i) => i >= 0);
  const total = textIdx.reduce((a, i) => a + slots[i].len, 0) || 1;
  let pos = 0;
  const texts = textIdx.map((i, j) => {
    const end = j === textIdx.length - 1 ? clean.length : pos + Math.round((slots[i].len / total) * clean.length);
    const t = clean.slice(pos, end);
    pos = end;
    return t;
  });
  const parts = [];
  let ti = 0;
  for (const s of slots) {
    if (s.len != null) parts.push(texts[ti++] || "");
    else parts.push({ id: s.inline, parts: [] });
  }
  return parts;
}

// --- tests ---

const map = [];
const src = serializeTree(
  [
    { type: "text", data: "Hello " },
    { type: "inline", label: "a", children: [{ type: "text", data: "world" }] },
    { type: "text", data: " and " },
    { type: "inline", label: "b", children: [{ type: "text", data: "bold" }] },
    { type: "text", data: " text" },
  ],
  map,
  { v: "" }
);
assert.equal(src, "Hello §1§world§/1§ and §2§bold§/2§ text");
assert.equal(map.length, 2);

const ok = parse("你好 §1§世界§/1§ 和 §2§粗体§/2§ 文本");
assert.deepEqual([...ok.seen], [1, 2]);
assert.equal(flatten(ok.parts), "你好 世界 和 粗体 文本");
assert.equal(fallbackIds(map, ok.seen).size, 0);

const drop1 = parse("你好 世界 和 §2§粗体§/2§ 文本");
assert.equal(fallbackIds(map, drop1.seen).has(1), true);
assert.equal(fallbackIds(map, drop1.seen).has(2), false);

const dropAll = parse("你好世界和粗体文本");
assert.equal(fallbackIds(map, dropAll.seen).size, 2);

const slots = [{ len: 6 }, { inline: 1 }, { len: 5 }, { inline: 2 }, { len: 5 }];
const aligned = alignPlain(slots, "你好世界和粗体文本");
assert.equal(aligned.length, 5);
assert.equal(typeof aligned[0], "string");
assert.equal(aligned[0].length + aligned[2].length + aligned[4].length, "你好世界和粗体文本".length);

// tag-drop vs placeholder-drop: bN whole-block skip simulated
const bNmap = [{ keep: false }, { keep: false }];
const bNseen = new Set();
assert.equal(bNmap.every((m, i) => m.keep || bNseen.has(i + 1)), false, "bN: missing tag → whole block skip");
const phseen = new Set([2]);
assert.equal(fallbackIds(bNmap, phseen).has(1), true);
assert.equal(fallbackIds(bNmap, phseen).has(2), false, "§: one dropped placeholder → only that inline falls back");

console.log("markup-remap.test.mjs: all passed");
