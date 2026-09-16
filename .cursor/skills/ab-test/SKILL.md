---
name: ab-test
description: "Run controlled A/B benchmarks with real engines and reproducible browser harnesses. Use when the user asks for A/B, 对照实验, 实译检验, extension bench, baseline vs treatment comparison, or perf regression gates before merge."
---

# A/B Test Harness (generic)

Controlled **baseline vs treatment** comparison with a **real** backend/engine — never stubbed keys, never fake passes.

Lead with these rules; details below.

## Do / Don't

| Do | Don't |
|---|---|
| **Set up environment FIRST** (secrets, browser, pinned deps) before writing product code | Jump into code changes then discover the harness cannot load your extension |
| Inject API secrets **at pod boot**; start a **fresh Cloud Agent** after adding secrets | Paste keys in chat and expect a running VM to pick them up |
| Use **Chrome for Testing** (e.g. `@puppeteer/browsers` `chrome@stable` / `linux-153`) with `--load-extension` | Retry Playwright default Chromium or branded Chrome for MV3 extension load — they often **ignore** `--load-extension` |
| Headless: `headless=new` + CfT; **confirm** service worker + product root (e.g. `#pbt-root`) before measuring | Trust DOM metrics when the extension never loaded (silent false PASS) |
| Extension storage: **selective** `chrome.storage.local.set` / `remove` for keys you need | `chrome.storage.local.clear()` — races `onInstalled` and resets defaults |
| Pin browser + Playwright (or puppeteer-core) versions in the harness `package.json` | Leave versions floating so the next agent rediscovers browser pain |
| Same pages, viewports, wait policy, engine, cold/warm — state which | Change multiple variables between A and B |
| One metric table: `firstOkMs`, calls-to-first-ok, skip/ok, emptyLinks, leftovers, product quality gates | Narrative-only “feels faster” without numbers |
| Report **BLOCKED** when a required key is missing | Stub the API and call results real |
| One A/B worker at a time against a **paid** API | Run overlapping A/B agents hitting the same paid quota |
| Draft PR + note Bugbot needs `bugbot run` or Ready unless Review Draft PRs is on | Assume draft PRs get automatic review |

---

## When to use

- User asks for **A/B**, **对照**, **实译检验**, **extension bench**, baseline vs treatment, or “is this actually faster?”
- Before merge when perf or API-call count is the claim
- After building a harness for one product — **generalize** the pattern, don’t one-off prose

---

## Setup once (environment)

Do this **before** product changes. Environment setup is the expensive part.

### 1. Secrets (Cloud Agent)

- [ ] Required keys exist as **environment secrets** (examples: `DEEPSEEK_API_KEY`, `CURSOR_API_KEY`) — names vary by product
- [ ] Secrets injected **only at pod boot** — filling a chat box does **not** update a running VM
- [ ] After adding/updating secrets → **start a fresh Cloud Agent**
- [ ] Verify presence with a boolean probe only (`true`/`false`) — **never print key values**
- [ ] If key missing → status **BLOCKED**; do not stub and call it real

### 2. Browser (MV3 extensions)

- [ ] Install **Chrome for Testing**, not branded Chrome:

```bash
# Example — pin the build your harness documents
npx @puppeteer/browsers install chrome@stable
# or: npx playwright-core install chromium  # ONLY if you verified --load-extension works for your build
```

- [ ] Launch with extension flags:

```text
--disable-extensions-except=/path/to/unpacked-ext
--load-extension=/path/to/unpacked-ext
--no-sandbox
--disable-dev-shm-usage
headless=new   # CfT supports headless=new + load-extension
```

- [ ] **Do not** burn time on Playwright `channel: 'chrome'` or default Chromium if logs show  
  `--load-extension is not allowed in Google Chrome, ignoring`

### 3. Harness package (pin versions)

- [ ] `package.json` pins `playwright-core` / `puppeteer-core` / `@puppeteer/browsers` (exact or narrow range)
- [ ] Document the CfT build id (e.g. `linux-153`) in the harness README or script header
- [ ] Script outputs JSON (`ab-report.json`) — not only stdout

### 4. Extension storage hygiene

- [ ] Set engine/options with **targeted** `storage.local.set({ engine: '…', … })`
- [ ] Remove only keys you must override with `storage.local.remove([...])`
- [ ] **Never** `storage.local.clear()` before setting engine — races `onInstalled`

### 5. Sanity gate (every run)

- [ ] Service worker / background context alive
- [ ] Product root in DOM (project-specific: e.g. `#pbt-root`, app mount node)
- [ ] If root missing → **FAIL setup**, not “0 ms miracle”

---

## Run A/B (protocol)

### Prep

- [ ] **Baseline** = unpacked dir or build from control branch/commit (document SHA)
- [ ] **Treatment** = unpacked dir or build from feature branch/commit
- [ ] State **cold** (fresh profile per variant) vs **warm** (same profile) — default **cold** for perf
- [ ] Same **engine** (real API), same **wait policy**, same **harness script**
- [ ] Viewports (minimum): **mobile 390×844**, **desktop 1280×800** — add more only if product requires
- [ ] Same canonical URLs / fixtures across A and B
- [ ] No concurrent second worker on the same paid API

### Execute

```bash
# Pattern — adapt script names to the repo
BASELINE_EXT=/tmp/ext-baseline TREATMENT_EXT=/tmp/ext-treatment node scripts/ab-bench.mjs
```

- [ ] Run baseline → save `ab-report.json` (or `baseline-*.json`)
- [ ] Run treatment → save alongside with clear names
- [ ] Capture screenshots only for failures or visual gates — not every step

### Metric table (required)

One table per comparison. Adapt column names to the product; keep the core semantics:

| Case | Viewport | Variant | firstOkMs | calls@firstOk | callsFull | skip | ok | emptyLinks | leftovers@N | quality gates |
|------|----------|---------|----------:|--------------:|----------:|-----:|---:|-----------:|------------:|---------------|
| … | mobile | baseline | | | | | | | | PASS/FAIL |
| … | mobile | treatment | | | | | | | | PASS/FAIL |

**Metric definitions (generic):**

- **firstOkMs** — time until first successful unit of work (first translated block, first OK response, etc.)
- **calls@firstOk** — API/network calls accumulated by `firstOkMs`
- **callsFull** — calls until harness stop condition (scroll hops, idle, timeout)
- **skip / ok** — skipped vs completed work units (product-specific counters)
- **emptyLinks / leftovers** — quality leak detectors after N scroll hops or settle time
- **Quality gates** — product hard gates (e.g. no orphan nodes, CJK landed, layout intact)

### Interpretation gates

| Observation | Verdict |
|-------------|---------|
| Δ firstOkMs within **±~30–50 ms** | **Noise** — not a win or loss (tens of ms is RTT jitter) |
| Large firstOkMs drop (hundreds+ ms) or **calls@firstOk** drop ≥ ~30–40% | Candidate **win** — still require quality gates PASS |
| More calls or slower firstOk with same quality | **Regression** or neutral |
| Quality gate FAIL on either arm | **FAIL** — do not ship on perf claims |
| “大幅度” (major) speed claim | Needs fewer round-trips **or** large firstOkMs drop — not noise-band movement |

### Report footer (required)

- Harness browser + version
- Extension paths / commits (baseline vs treatment)
- Cold vs warm
- Engine + key present (`true`/`false` only)
- **Verdict:** WIN / NEUTRAL / REGRESSION / BLOCKED
- Artifact paths (`ab-report.json`, screenshots)

---

## Extension-specific notes (optional)

When benchmarking **browser extensions**:

- Unpack with stable paths; use `--disable-extensions-except` + `--load-extension`
- Prefer stub engine only for **ablation** matrices (switch flips), never for shipping A/B vs production API
- Scroll protocol: document hop count (e.g. 3-hop) for `leftovers@N`
- Visual QA is a **separate** skill — DOM counters alone never pass visual gates

---

## CI / PR

- Land harness + pinned deps on a branch; **draft PR** is fine for skill-only changes
- Draft PRs do **not** get Bugbot unless **Review Draft PRs** is enabled, you comment `bugbot run`, or mark **Ready for review**
- Do not merge on A/B numbers until quality gates pass on **real** engine

---

## Quick reference checklist

**Setup once:** secrets@boot → fresh agent → CfT + load-extension → pin versions → no storage.clear → confirm root  
**Run A/B:** baseline dir vs treatment dir → same viewports/URLs/engine → one table → noise band → BLOCKED if no key → single paid-API worker
