# Instagram SiteForge 构建目标台账

## 目标

对 `https://www.instagram.com/` 执行 SiteForge 构建：先配置 `config/site-registry.json`，按 Instagram 需要登录态的社交站点建模，使用专属适配器策略，生成 `instagram` 站点 skill，并按能力发现层、能力执行层、任务完成层做中文评估。结束条件是实证总分达到 100 分。

## 复核结论

最初报告的 `100.00` 分存在错估。复核发现当时存在三个实质缺口：认证态报告口径不准、详情/回复路由曾被错误绑定、复合任务没有真正形成 `search-posts -> read-post-detail` 的多能力链路。

本轮已修复并重新迭代。最终采用最新证据矩阵，三层评分均为 100，总分为 100，未触发任何硬性封顶规则。

## 关键产物

- registry 配置: `config/site-registry.json` 中 `www.instagram.com`，`siteKey=instagram`，`adapterId=instagram`，`siteArchetype=social-content`，`auth.required=true`，`evidencePersistence=sanitized-structure-only`，`sessionMaterialPersistence=forbidden`。
- 最终复合任务构建: `.siteforge/sites/instagram.com-ea2ecfbf/builds/20260609T034125203Z/`
- 最终 skill 包: `.siteforge/sites/instagram.com-ea2ecfbf/builds/20260609T034125203Z/skill/`
- 当前 skill: `.siteforge/sites/instagram.com-ea2ecfbf/current/skill.yaml`
- 关键报告: `capabilities.json`、`intents.json`、`execution_plans.json`、`execution_contracts.json`、`runtime_dispatch_report.json`、`runtime_execution_report.json`、`verification_report.json`。
- 中文评估: `docs/codex-goals/instagram-siteforge-build-v1/instagram-three-layer-evaluation.md`
- 评分 JSON: `docs/codex-goals/instagram-siteforge-build-v1/instagram-three-layer-evaluation.json`
- 复核审计: `docs/codex-goals/instagram-siteforge-build-v1/instagram-score-audit-20260609.md`

## 最终任务运行证据

| 任务 | build id | 分发/执行结果 |
|---|---|---|
| search posts | `20260609T033952326Z` | `search-posts`，`ready_for_controlled_runtime`，`completed`，`api_read_completed`，结构化输出含 `/explore/search/`、`search-results-page`、`query` |
| read profile content | `20260609T034017808Z` | `read-profile-content`，`ready_for_controlled_runtime`，`completed`，结构化输出含 `/{account}/`、`author-page`、`account` |
| read post detail | `20260609T034040741Z` | `read-post-detail`，`ready_for_controlled_runtime`，`completed`，结构化输出含 `/p/{shortcode}/`、`content-detail-page` |
| publish post | `20260609T034102951Z` | 精确命中 `publish-post`，`blocked_task_policy_disabled`，无高风险自动执行 |
| search posts then read post detail | `20260609T034125203Z` | `ready_for_composed_runtime`，两步均 `completed`，`composition_completed`，上下文从第 1 步传递到第 2 步 |

## 最终能力与安全摘要

- 能力总数 45；active 24；disabled 17；candidate/debug 4。
- active 无执行计划: 0。
- active 缺证据: 0。
- 非 active 无原因: 0。
- 可疑写操作 active: 0。
- 高风险自动执行: false。
- API 发现: 未请求 raw network 采集，未持久化 raw traces，未发现 API candidate，未激活任何未回放验证的 API adapter；`capture-network-apis` 保持 debug-only 并给出原因。
- 登录态: 使用用户授权的脱敏结构摘要，`crawlMode=authenticated_authorized_source`，`authMethod=authorized_source`，`authVerificationStatus=authorized_source_verified`。
- 敏感材料: 未保存 cookie、token、Authorization header、浏览器 profile、storage、raw HTML、raw DOM、raw network payload、私密正文。

## 结束判定

三层评分:

- 能力发现层: 100。
- 能力执行层: 100。
- 任务完成层: 100。
- 加权总分: 100。

硬性封顶检查:

- 正文、简介、评论、章节内容被提升为能力: 否。
- 只读内容被误判为发布、提交、删除、支付: 否。
- 虚构程序接口能力: 否。
- active 能力大量没有执行计划: 否。
- 无法解释失败原因: 否。
- 敏感材料进入报告、技能或能力字段: 否。

目标状态: 已达成。
