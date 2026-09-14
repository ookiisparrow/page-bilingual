# Page Bilingual

Manifest V3 extension for **Chrome** and **Edge**. One click turns an article into vertical bilingual paragraphs (original + translation). Default target: **Simplified Chinese**. Default engine: **Cursor**.

No account. No paywall. No engine marketplace. Not affiliated with Immersive Translate.

The product goal is to be **clearly more usable for daily reading**, not a feature-list clone: Cursor-aware terminology, fewer nav false-positives, viewport-first paint, one-click start, instant bilingual ↔ translation-only, reliable restore.

Interaction patterns (paragraph-under-original, smart vs full page, side tab, hover+modifier, triple-space) are documented in **[DESIGN.md](DESIGN.md)**. References: public Immersive Translate usage docs, the [archived pre-2023 old-immersive-translate](https://github.com/immersive-translate/old-immersive-translate) repo, paraphrased intent from [immersive-translate/prompts](https://github.com/immersive-translate/prompts), and MV3 ideas from [FluentRead](https://github.com/FluentRead/FluentRead). No current store package was downloaded or reverse-engineered. Not affiliated with Immersive Translate.

## Install (unpacked)

### Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder (the one with `manifest.json`)

### Microsoft Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → this folder

## Cursor API key

1. Create a **user** API key at [cursor.com/dashboard/api](https://cursor.com/dashboard/api) (not a Team Admin `admin:*` key).
2. Open the extension **Options**.
3. Paste the key. Save.

The key is stored in `chrome.storage.local`. Only the **background worker** (and this options page) reads it. The page content script never sees the secret.

The worker calls the Cursor HTTP URL first (`https://api.cursor.com/v1/chat/completions` by default). Cursor does not currently document a stable public chat-completions API. If that request is blocked or 404s, start the official-CLI fallback and leave it running:

```bash
node bridge/server.mjs
```

(`curl https://cursor.com/install -fsS | bash` if `agent` / `cursor-agent` is missing.)

UI-only check without Cursor: `node bridge/server.mjs --mock`

Cursor is the only translation engine. Batching exists so a long article finishes in fewer round-trips, not to ration quota.

## Three shortcuts

| Shortcut | Action |
| --- | --- |
| **Alt+A** | Translate page / restore original |
| **Alt+W** | Translate more of the page (still skips nav/buttons/code) |
| **Alt+S** | Translate the paragraph under the pointer |

Also: hold **Alt** on a paragraph; select text to pin a term; triple-space in an input; right-click **Translate page**; side ball `译` / `原`. Change bindings at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

## Manual checklist

- [ ] Wikipedia-style long article: body is bilingual; nav / ToC / buttons stay original
- [ ] MDN-style `pre`/`code`: not translated
- [ ] Bilingual ↔ translation-only: no second Cursor request
- [ ] No login wall in popup or options
- [ ] Select a term → **Pin term** → later paragraphs / Retry stay consistent
- [ ] Alt + hover translates one paragraph
- [ ] Triple-space in an input swaps the typed text
- [ ] Right-click Translate page / Show original
- [ ] Alt+A / Alt+W / Alt+S
- [ ] Side ball toggles translate / restore

Open `demo/article.html` (static server preferred; for `file://` enable **Allow access to file URLs**).

## Later (not v1)

PDF / ePub / video subtitles / manga OCR / mobile Safari / site-rule marketplace.

## Repo

```
manifest.json
background.js     # key + Cursor HTTP, then CLI bridge
content.js        # paragraphs, roles, retry, glossary, FAB
shared.js         # public settings only
bridge/server.mjs
DESIGN.md
PRODUCT-PLAN.md
```

MIT. See `LICENSE`.
