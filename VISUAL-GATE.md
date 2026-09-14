# 视觉门禁（硬步骤）

> **视觉核验翻译必须走 Cursor bridge，禁止 DeepSeek。**  
> 门禁脚本在跑站前会通过 CDP 写入 `engine: "cursor"` + `cursorApiUrl: http://127.0.0.1:47821/v1/chat/completions`。  
> 先启动 bridge：`CURSOR_AGENT_BIN=/home/box/.local/bin/agent node bridge/server.mjs`

> 仅有 DOM 计数 / 自动截图 **不算过关**。  
> 每一版对外说「可用」前，必须跑本门禁，并由幕僚长 / pstack **看图** 再判。

对照：`LAYOUT-SPACE-RULES.md`、`DESKTOP-ACCEPTANCE.md` §1/§4。

## 何时跑

- 改注入 / 排版 / 双单 / 浮钮 / 队列后
- 准备打手机 CRX 前
- 用户说「继续优化」告一段落要收口时

## 每站必出 5 张图（手机 390×844）

| 序号 | 文件后缀 | 时机 |
| --- | --- | --- |
| 1 | `-before.png` | 点「译」前 |
| 2 | `-bilingual-top.png` | 热区出译后顶屏（可另存 `-bilingual.png`） |
| 3 | `-bilingual-mid.png` | 下滚 ~1.2 屏并等待补译 |
| 4 | `-bilingual-bot.png` | 滚到底并等待补译 |
| 5 | `-hide-top.png` | 回顶点「隐」后仅译文（可另存 `-hide-orig.png`） |

桌面 1280×800：至少维基 + 一站新闻/博客各补双语一张（`-desktop-bi.png`）。

站点最低集：维基、博客、新闻、文档、Google、GitHub、官网、电商、论坛；扩场景另含 BBC/Verge/Medium/Substack/Stripe/Apple/SO/Reddit/arXiv/Amazon/Notion（见 `visual-gate-wide.mjs`，共约 19 站）。漏译盯：热区出译后正文仍大段无 `.pbt-tr`、queued 久不清、ellipsis>0。
工具/产品落地（cursor/vercel/linear/figma 等）：译后布局不得塌成白页/纯文本；禁止 `textContent` 整替有子结构的节点。

滑动过关：mid/bot 继续出译；已译不丢不叠；无满屏 `…`；译文 nextSibling 贴宿主。

## 看图必过（V1–V6）

| ID | 过关标准 |
| --- | --- |
| V1 | 无满屏 `…` / 空白洞；失败段仍是原文 |
| V2 | 双语：中英各一次；无双中文叠字；译文贴宿主 |
| V3 | 「隐」后原文不可见、译文只一次；再「显」恢复双语 |
| V4 | 手机一律上下排；标题不竖排挤字；flex 导航/芯片不炸 |
| V5 | 双语不太疏（间隙约 0.15–0.35em）；正文像书 |
| V6 | 浮钮小、不挡主内容；可拖且拖后不误触 |
| V7 | 原文对齐稳定（译文 nextSibling 贴宿主；双语间隙约 0.15–0.35em；不挤开原文基线） |
| V8 | 大标题译文整句在下，且字号比原文小两号（目测明显小一截） |

DOM 辅助（脚本自动写进报告，**不能替代看图**）：

- `ok / fail / skip / queued`
- `ellipsis` 段数 = 0
- `.pbt-tr` 与 `ok` 大致同量级；顶屏 `nextSiblingTr` 可贴宿主

## 流程

1. Edge CDP `9222` 已开；`NODE_PATH=/tmp/node_modules node accept-shots/visual-gate-wide.mjs`
2. 报告：`accept-shots/visual-gate/wide-*/REPORT.md`（五张齐）
3. 幕僚长 / pstack 看图过 V1–V6
4. 有一条不过 → 记 bug → 改 → 重跑该站；全部过才可升版/打 CRX

核验 skill：`.cursor/skills/verify-page-bilingual/`

## 判定用语

- **视觉过**：五张齐 + V1–V6 目测全过，报告附截图路径
- **仅指标过**：DOM 好看但没看图 / 缺滑动样张 → **禁止**当最终过关

### 最近宽场景跑
- `accept-shots/visual-gate/wide-20260914-0800/` — **视觉过**（幕僚长+参谋长 V1–V6；当时矩阵尚无独立电商站）
- `accept-shots/visual-gate/wide-20260914-0845-v1416/` — **视觉过**（1.4.16 幕僚长+参谋长 V1–V6）
