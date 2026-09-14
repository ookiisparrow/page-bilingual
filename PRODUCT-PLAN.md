# Page Bilingual — product plan

Goal: an Edge/Chrome MV3 extension that puts a translation **under each paragraph**. Default engine: **Cursor**. Product bar: **more useful than Immersive Translate** for daily article reading — not a feature-list clone, and not PDF / video / manga.

Not affiliated with Immersive Translate. Public UX docs and FluentRead’s open implementation are references only. Do not reverse a proprietary CRX or copy site-rule packs.

## Quality bar (clearly more usable — not feature parity)

Win on **reading quality** (Cursor): page title/host in the prompt, pinned terms, viewport-first batches so the fold fills first, main-content climb plus skip for bylines/share/nav-like list items.

Win on **friction**: Options start is API key + language; Translate is the first popup click; bilingual ↔ translation-only is CSS-only; restore increments a run id so late batches cannot write back.

Do **not** ship PDF / video / manga in v1.

## Differentiators (lock these)

1. **Zero login / paywall** — no account, no subscription UI, no engine marketplace.
2. **Structure roles** — nav, buttons, tabs, and chrome stay original even in “entire page” mode. Main-content heuristic + optional exclude CSS.
3. **Page glossary + pin term** — selection card can pin a term; later batches and per-paragraph retry use it so names stay consistent.
4. **Paragraph progress / retry** — toast `done/total`, failed nodes keep `data-pbt-id` and a Retry control. Bilingual ↔ translation-only is CSS-only (no second Cursor call).

## Cursor path

- API key lives in `chrome.storage.local` and is read **only** by the background worker (and the options page to save it). Content scripts never load the key.
- Background tries the configured Cursor HTTP URL first (`https://api.cursor.com/v1/chat/completions` by default). Cursor does not currently ship a public chat-completions API; if that call is blocked or 404s, fall back to `node bridge/server.mjs` (official `agent` CLI).
- Batches send `{id,text}` plus the page glossary. Response is a JSON array aligned on `id`.
- The user’s Cursor quota is large. Do **not** add free backends or cost-saving rate limits. Batch only for latency.

## In scope

Popup translate, floating side control, context menu, shortcuts, bilingual / main-content scope, Alt+hover, selection card, triple-space input, progress toast, glossary.

## Out of scope

PDF, ePub, DOCX, video subtitles, meeting captions, image/manga OCR, mobile Safari/Kiwi, proprietary site marketplaces, accounts.

## Milestones

- **M0** Shell + popup + Cursor path + bilingual under paragraphs + restore
- **M1** Main-content / structure skip, code skip, paragraph retry
- **M2** Selection, hover, triple-space, context menu, shortcuts, side ball
- **M3** Page glossary + pin term + checklist
