# Design notes (legitimate references only)

Page Bilingual is **original code**. These notes record public UX behaviors we chose to match in spirit. We did **not** download, unpack, or reverse any current store CRX/XPI.

## Sources

1. Public docs: [immersivetranslate.com/zh-Hans/docs](https://immersivetranslate.com/zh-Hans/docs/), [usage (zh)](https://immersivetranslate.com/zh-Hans/docs/usage/), [usage (en)](https://immersivetranslate.com/en/docs/usage/)
2. Archived pre-2023 OSS: [immersive-translate/old-immersive-translate](https://github.com/immersive-translate/old-immersive-translate) (read for architecture; do not copy site-rule packs or branding)
3. Public prompts repo: [immersive-translate/prompts](https://github.com/immersive-translate/prompts) (intent only; our Cursor prompts are rewritten)
4. Optional peer: [FluentRead](https://github.com/FluentRead/FluentRead) (MV3 bilingual / local-config patterns)

Out of scope here (and in the product): PDF, video subtitles, manga/image OCR, mobile Safari/Kiwi, proprietary site marketplaces.

## Interaction / layout patterns

| Pattern | Public behavior | What we do |
| --- | --- | --- |
| Paragraph unit | Smallest unit is the paragraph so context stays together; translation appears **under** that block | Insert a translation node as the last child of the same block (`data-pbt-id`). Not sentence soup. |
| Smart vs full | Default: “smart” main column (reading-mode-like). **Alt+W**: whole page | Default `scope=main`. **Alt+W** = entire page. Nav/buttons/code still skipped (structure roles). |
| Toggle | **Alt+A**: translate, press again to show original | Same bind. Popup primary button and side control also toggle. |
| Bilingual vs translation-only | Bilingual is the default; a control next to Translate hides the original without a new request | CSS class on hosts. Popup + FAB have the switch. |
| Side shortcut | Icon on the **right edge** of the page | Slim right-edge tab (`译` / `原`), hover opens scope/mode. No Immersive branding. |
| Context menu | Right-click Translate page / Show original | Same actions, our wording. |
| Hover + modifier | Off by default in their docs; hold **Shift** (EN) or **Ctrl** (ZH) on a paragraph | We ship hover **on** (modifier still required — no drive-by spend). Our bind: **Alt** (or Alt+S). |
| Input | Quick **triple-space** in any text field | Same gesture; **Alt+I** as the quiet alternative. |
| Skip | script/style/svg/textarea/code/pre; `notranslate` / `translate=no` | Same families, plus buttons and landmark chrome. Optional extra CSS in Options. |
| Popup | Pin the extension, click Translate; Settings; target language | Compact panel: toggle, scope, display, language, Options for the Cursor key. |

## Main-content detection (ours)

Old archived code combined optional per-host selectors with a **word-density climb** (find the densest paragraph, walk up until ~40% of page words). We **do not** import their hostname rule packs.

Ours:

1. Semantic roots: `article`, `main`, `[role=main]`, common article/body ids (including `#mw-content-text`).
2. If those miss: climb from the densest visible `p` (then `div`) until the box holds a large share of the page’s words.
3. Always drop `nav` / `header` / `footer` / `aside` / buttons / `pre` / `code`.

## Prompt intent (paraphrased, not copied)

Public “AI expert” files emphasize: stay faithful, keep names/dates/figures, batch several segments with stable ids, optional term list. Our Cursor system+user prompt is written from scratch: webpage translator, JSON `[{id,text}]`, page glossary, no markdown.

## FluentRead (peer)

Useful MV3 ideas we already share: bilingual insert next to source, selection card, local-only settings, no first-party account. We do not take their engine marketplace; Cursor is the only backend.
