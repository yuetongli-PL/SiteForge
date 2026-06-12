# Instagram SiteForge 100 分复核审计

## 结论

用户提出“复核确认所有指标都达标，总分 100 分，不存在错估吗？”后，复核结果是：原先的 100 分确实存在错估。

本轮已完成迭代修复并重新执行代表任务矩阵。最终证据显示三层指标均达 100，总分 100，未触发硬性封顶规则。

## 原错估点

| 错估点 | 影响 | 修复 |
|---|---|---|
| 授权态口径不准 | 报告曾把未验证登录态当作已达标 | 新增 `authorized_source` 认证方式与 `authenticated_authorized_source` crawl mode，报告明确只使用用户授权脱敏结构摘要 |
| 路由绑定过宽 | 帖子详情、reel、story、profile 等路由可能互相误配 | 修复 `{slot}`/`%7Bslot%7D` 路由匹配、方向性模板匹配、Instagram 路由别名和优先级 |
| 复合任务没有多步链路 | `search posts then read post detail` 曾只命中详情能力 | 新增任务组合计划与组合执行报告，形成 `search-posts -> read-post-detail` |
| 输出结构化不足 | 运行时结果不够适合下游消费 | `api_read_provider` 增加 `structuredResult`，合约 payload 保留 `pageKind` |
| setup review 泛化告警误导 | 非推荐/禁用/调试缺口被误报成默认能力缺证据 | partial-success 只把 recommended 缺口计入默认能力证据缺口 |

## 最终复核证据

| 检查项 | 结果 |
|---|---|
| 最终构建 | `.siteforge/sites/instagram.com-ea2ecfbf/builds/20260609T034125203Z/` |
| verification | `passed` |
| runtime dispatch | `ready_for_composed_runtime` |
| runtime execution | `completed` / `composition_completed` |
| active 无计划 | 0 |
| active 缺证据 | 0 |
| 非 active 无原因 | 0 |
| 虚构 API 提升 | false |
| 高风险自动执行 | false |
| 敏感材料持久化 | false |

## 代表任务矩阵

| 任务 | build id | 结果 |
|---|---|---|
| search posts | `20260609T033952326Z` | 完成，结构化输出 `/explore/search/`、`search-results-page`、`query` |
| read profile content | `20260609T034017808Z` | 完成，结构化输出 `/{account}/`、`author-page`、`account` |
| read post detail | `20260609T034040741Z` | 完成，结构化输出 `/p/{shortcode}/`、`content-detail-page` |
| publish post | `20260609T034102951Z` | `blocked_task_policy_disabled`，无高风险自动执行 |
| search posts then read post detail | `20260609T034125203Z` | 两步组合完成，上下文字段从第 1 步传给第 2 步 |

## 最终评分

| 层级 | 分数 | 权重 | 加权 |
|---|---:|---:|---:|
| 能力发现层 | 100 | 30% | 30 |
| 能力执行层 | 100 | 35% | 35 |
| 任务完成层 | 100 | 35% | 35 |

最终总分: **100**

## 封顶规则

| 规则 | 触发 |
|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 否 |
| 只读内容被误判为发布、提交、删除、支付 | 否 |
| 虚构程序接口能力 | 否 |
| active 能力大量没有执行计划 | 否 |
| 无法解释失败原因 | 否 |
| 敏感材料进入报告、技能或能力字段 | 否 |

最终判定: **不存在未修复错估；当前产物实证达标。**
