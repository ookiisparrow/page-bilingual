# Interactive coverage (1.4.45)

What `collect` / `collectNewBlocks` / miss-sweep pick up for **buttons, links, labels, drawers**.

## Core selectors

| Kind | Selectors | Gate |
|------|-----------|------|
| Prose blocks | `p,h1–h6,li,blockquote,figcaption,dt,dd,[role=heading]`, menu roles | `pushBlock` → `worth` + `needsTranslate` / `hasForeignScript` |
| Text controls | `button,[role=button],[role=tab]`, CTA-like `a` | `isTextControl` (min len 2; **replace** allows site-chrome) |
| Content links | `a[href]` | `isContentLink` (min len 2; not nested in button; not URL/id) |
| Labels | `label` | `isLabelLeaf` (page-wide in replace/full) |
| Menu items | `[role=menuitem|menuitemcheckbox|menuitemradio|option|treeitem]` | popup surface or menu item; visible |
| Drawer / dialog / sheet | `POPUP` set (see below) | on open → `scheduleTranslatePanel` + panel re-sweep |
| Loose leaves | `collectLooseLatin` always merged on replace/full | span/div/button/label cap 220 |

## Replace-mode relaxations (1.4.45)

- `worth`: skip fragile/tightClip gates (keep chip + extreme ellipsis)
- `collect`: always merge `collectLooseLatin` even when some BLOCKS exist
- Miss-sweep: full-page unsettled up to 80; re-queue until idle while `serviceOn`
- SPA: `pushState`/`replaceState`/`popstate`/`hashchange` + body `MutationObserver` + empty-collect retries

## `POPUP` surfaces (drawer/dialog/sheet)

Includes: `[role=dialog|alertdialog|menu|listbox|tree]`, `[popover]`, `details`, Radix/Headless/MUI/Ant/Element dropdowns, and class hits: `drawer`, `Drawer`, `offcanvas`, `sheet`, `Sheet`, `SideNav`, `side-nav`, `mobile-nav`, `van-popup`, `van-action-sheet`, `amu-drawer`, etc.

## Skip vs allow for interactive leaves

- Hard skip: `script,style,svg,code,pre,input,textarea,…` (`SKIP_HARD`)
- `button` / `[role=button]` / `label` exempted when `isTextControl` / `isLabelLeaf` / menu / popup
- Consent / cookie walls still skipped (`isConsentWall`)
- Pure icon buttons (≤6 chars + svg/img, no whitespace) skipped

## Miss sweep

After batches / scroll idle / drawer open / serviceOn: `collectMissedVisible` → unsettled worth nodes (cap 80 in replace) re-queued until empty.

## Not collected

- `input` / `textarea` / `contenteditable` (separate Alt+I / gesture path)
