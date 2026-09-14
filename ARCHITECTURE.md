# 双语网页 — 架构改动清单（对照前沿调研）

> 2026-09-14。ponytail：能不做就不做；下列按价值排序。

## 北极星

`segment(id)` → provider 批译 → renderer `after()` 贴宿主 → 双语⇄仅译文不重请求 → 视口优先。

## 已对齐

- [x] `el.after(.pbt-tr)`，不毁原 DOM
- [x] 热/冷队列 + 滚动补译
- [x] 双语 / 隐原文
- [x] 跳过 SERP 标题、GitHub 路径、脆弱壳
- [x] 视觉五张门禁 + pstack skill
- [x] **1.4.15** provider `align`：id 优先 + 同长顺序兜底；字段别名 `translatedText` 等
- [x] **1.4.15** CSS 主题 token（`--pbt-gap-*` / 透明度）
- [x] **1.4.15** 显式 `PBT_HOT_PAD` / `PBT_BATCH` / `PBT_COLD_SLICE`

## 下一步（用户点头再动）

| 项 | 做什么 | 不做 |
| --- | --- | --- |
| A 薄站点规则表 | 把散落 host 特例收成小表 `matches → exclude/skip` | 沉浸式级厚规则库 |
| B provider 再拆文件 | 仅当再加第 3 个引擎时 | 过早 abstract |
| C 桌面 Translator API | 仅桌面可选引擎 | 安卓主路径 |
| D br 切段 | Ookla 类单宿主增强 | 为切段重写 collector |
| E Google AI Overview | 热区出译更稳 | 译 SERP 标题 |

## 明确禁止

- 整页 HTML 进模型
- PDF/字幕逻辑塞进网页 collector
- 为安卓赌 Chrome on-device Translator API
