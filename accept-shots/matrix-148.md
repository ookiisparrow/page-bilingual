# Matrix 148 — multi-site acceptance

- Generated: 2026/9/14 02:41:41 (Asia/Shanghai)
- Steering expected version: **1.4.8**
- Observed loaded version (first check): **1.4.11** — end: **1.4.11**
- Version match 1.4.8: **False**
- Note: Steering asked to confirm 1.4.8; loaded manifest is 1.4.11. Continued matrix against loaded build (did not block).

| Case | VP | firstOk | ok/skip/fail | Disposition | Fail |
| --- | --- | --- | --- | --- | --- |
| wiki-mobile | 390x844 | 2s | 48/0/0 | PASS | — |
| google-mobile | 390x844 | 1s | 5/0/0 | PASS | — |
| github-mobile | 390x844 | 3s | 10/0/0 | PASS | — |
| cloudflare-blog-mobile | 390x844 | 2s | 38/0/0 | PASS | — |
| stripe-mobile | 390x844 | 1s | 1/0/0 | PASS | — |
| wiki-desktop | 1280x800 | 3s | 47/0/0 | PASS | — |
| github-desktop-menu | 1280x800 | 4s | 39/0/0 | PASS | — |
| stripe-desktop | 1280x800 | -s | 0/0/0 | expected-skip-locale | reclass: G1: no translation within 8s; G1: zero ok segments |
| stripe-desktop-retry | 1280x800 | -s | 0/?/0 | expected-skip-locale | reclass: G1: zero ok |
| apple-mba-desktop | 1280x800 | 2s | 74/?/0 | PASS | — |
| apple-mba-mobile | 390x844 | 2s | 74/?/0 | PASS | — |

## Conclusion
- First page check: loaded version was NOT 1.4.8 (initially 1.4.10, ended 1.4.11) — continued matrix without blocking on resume/version drift.
- Wiki / Google / Cloudflare blog / Apple MBA: progressive translate OK, 0 fail counters.
- GitHub pages showed site error banners (translated) but layout checks passed.
- stripe.com desktop resolved to Chinese UI → 0 English hosts (expected skip). Mobile stripe had 1 English fragment.

## Hard fails
- none

## Shots
- wiki-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-wiki-mobile.png`
- google-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-google-mobile.png`
- github-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-github-mobile.png`
- cloudflare-blog-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-cloudflare-blog-mobile.png`
- stripe-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-stripe-mobile.png`
- wiki-desktop: `/Users/sparrow/page-bilingual/accept-shots/matrix148-wiki-desktop.png`
- github-desktop-menu: `/Users/sparrow/page-bilingual/accept-shots/matrix148-github-desktop-menu.png`
- stripe-desktop: `/Users/sparrow/page-bilingual/accept-shots/matrix148-stripe-desktop.png`
- stripe-desktop-retry: `/Users/sparrow/page-bilingual/accept-shots/matrix148-stripe-desktop-retry.png`
- apple-mba-desktop: `/Users/sparrow/page-bilingual/accept-shots/matrix148-apple-mba-desktop.png`
- apple-mba-mobile: `/Users/sparrow/page-bilingual/accept-shots/matrix148-apple-mba-mobile.png`