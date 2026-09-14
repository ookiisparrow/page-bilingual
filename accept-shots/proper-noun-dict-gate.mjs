#!/usr/bin/env node
/**
 * Light gate for proper-noun whitelist + person/brand preserve helpers (no Chrome / no API).
 * Run: node accept-shots/proper-noun-dict-gate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedSrc = fs.readFileSync(path.join(root, "shared.js"), "utf8");

const mem = new Map();
const chrome = {
  storage: {
    local: {
      async get(keys) {
        const out = {};
        const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
        for (const k of list) if (mem.has(k)) out[k] = mem.get(k);
        return out;
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) mem.set(k, v);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) mem.delete(k);
      },
    },
  },
};

const ctx = { chrome, console };
vm.createContext(ctx);
vm.runInContext(`${sharedSrc}\n;globalThis.PBT = PBT;`, ctx);
const { PBT } = ctx;
if (!PBT?.pnEnsureStore) {
  console.error("FAIL: PBT.pnEnsureStore missing");
  process.exit(1);
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

const seeded = PBT.pnEnsureStore(null, 1000);
assert(seeded.seeded, "first ensure seeds");
assert(seeded.seedRev === PBT.PN_SEED_REV, "seed rev stamped");
assert(seeded.terms.windows?.term === "Windows", "seed includes Windows");
assert(seeded.terms.omarchy?.term === "Omarchy", "seed includes Omarchy");
assert(seeded.terms.github?.term === "GitHub", "seed includes GitHub");
assert(seeded.terms.nike?.term === "Nike", "seed includes brand Nike");
assert(seeded.terms.spotify?.term === "Spotify", "seed includes brand Spotify");
assert(seeded.terms.tesla?.term === "Tesla", "seed includes brand Tesla");
assert(Object.keys(seeded.terms).length <= PBT.PN_CAP, "seed under cap");

// Seed rev bump merges new brands without wiping pinned user terms
const oldStore = {
  seeded: true,
  seedRev: 1,
  terms: {
    windows: { term: "Windows", pinned: false, lastAt: 1, seed: true },
    custompin: { term: "CustomPin", pinned: true, lastAt: 2 },
  },
};
const bumped = PBT.pnEnsureStore(oldStore, 5000);
assert(bumped.seedRev === PBT.PN_SEED_REV, "rev bump applies");
assert(bumped.terms.custompin?.pinned === true, "user pin survives rev bump");
assert(bumped.terms.nike?.term === "Nike", "rev bump adds new brand seeds");

// Eviction: fill past cap with unpinned; pinned survives
const fat = PBT.pnEnsureStore({ seeded: true, seedRev: PBT.PN_SEED_REV, terms: { ...seeded.terms } }, 2000);
fat.terms.keepme = { term: "KeepMe", pinned: true, lastAt: 1 };
for (let i = 0; i < PBT.PN_CAP + 40; i++) {
  fat.terms[`x${i}`] = { term: `X${i}`, pinned: false, lastAt: 3000 + i };
}
PBT.pnTrimTerms(fat.terms);
assert(Object.keys(fat.terms).length <= PBT.PN_CAP, "trim respects cap");
assert(fat.terms.keepme?.term === "KeepMe", "pinned survives eviction");

const stripped = PBT.pnStripForEcho(
  "Omarchy ships Windows and Linux on one CPU.",
  ["Omarchy", "Windows", "Linux", "CPU"]
);
assert(!/omarchy|windows|linux|cpu/i.test(stripped), "strip removes whitelist tokens");
assert(/ships/.test(stripped) && /on one/.test(stripped), "strip keeps surrounding prose");

// Echo-style check: with PN stripped, Chinese+names should not look like latin echo
const src = "Omarchy makes Windows and Linux feel fast.";
const dst = "Omarchy 让 Windows 和 Linux 感觉很快。";
const s1 = PBT.pnStripForEcho(src, ["Omarchy", "Windows", "Linux"]).toLowerCase();
const d1 = PBT.pnStripForEcho(dst, ["Omarchy", "Windows", "Linux"]).toLowerCase();
const words = (t) => t.split(/[^a-z0-9]+/i).filter((w) => w.length >= 2);
const sw = new Set(words(s1));
const dw = new Set(words(d1));
let inter = 0;
for (const w of dw) if (sw.has(w)) inter += 1;
const cover = dw.size ? inter / Math.min(sw.size, dw.size) : 0;
assert(cover < 0.9, `whitelist strip breaks false echo cover=${cover}`);

// Person-name heuristic
const names = PBT.pnDetectPersonNames("Tim Cook said Nike and Spotify matter to Elon Musk.");
assert(names.includes("Tim Cook"), "detects Tim Cook");
assert(names.includes("Elon Musk"), "detects Elon Musk");
assert(!names.includes("Nike"), "single-token brand not treated as person name");
assert(!PBT.pnDetectPersonNames("Getting Started with Open Source").length, "rejects UI / open-source phrases");
assert(!PBT.pnDetectPersonNames("Learn More about Privacy Policy").length, "rejects Learn More / Privacy Policy");

const personDst = "Tim Cook 表示 Nike 仍然重要。";
const personStrip = PBT.pnStripForEcho(personDst, ["Nike"]);
assert(!/tim|cook|nike/i.test(personStrip), "strip removes heuristic person names + brands");
assert(/表示|仍然|重要/.test(personStrip), "strip keeps Chinese prose around names");

const merged = PBT.pnMergeBatchPreserve(
  ["Tim Cook uses Spotify daily."],
  ["Spotify", "Windows"]
);
assert(merged[0] === "Tim Cook", "detected person names sort first for prompt budget");
assert(merged.includes("Spotify") && merged.includes("Windows"), "whitelist still merged");

// Separate key from segment cache
assert(PBT.PN_STORE_KEY === "pbt.properNouns.v1", "durable key name");
assert(PBT.PN_STORE_KEY !== "pbt.segCache.v1", "not segment cache key");

// Round-trip add/remove via mock storage
mem.clear();
await PBT.pnLoad();
await PBT.pnAdd("HyprlandExtra", { pinned: true });
const loaded = await PBT.pnLoad();
assert(loaded.terms.hyprlandextra?.pinned === true, "add pins term");
await PBT.pnRemove("HyprlandExtra");
const after = await PBT.pnLoad();
assert(!after.terms.hyprlandextra, "remove deletes term");

// Prompt shape smoke (background snippet)
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
assert(/专有名词白名单/.test(bg), "background prompt mentions whitelist");
assert(/人名与品牌名必须原样保留/.test(bg), "background prompt forbids translating names/brands");
assert(/properNouns/.test(bg), "background accepts properNouns");

const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
assert(/pnStripForEcho/.test(content), "content strips PN for echo");
assert(/pnMergeBatchPreserve|pnDetectPersonNames/.test(content), "content merges heuristic names");
assert(/preserveTermsForPair/.test(content), "content builds pair preserve list");
assert(/pinProperNoun/.test(content), "content has pinProperNoun");
assert(/pbt\.properNouns\.v1|PN_STORE_KEY/.test(content), "content uses durable PN store");
assert(/carriesTargetScript/.test(content), "content keeps Han gate beside PN strip");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert(manifest.version === "1.4.54", "version bumped for browser stutter fix");

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nALL PASS");
