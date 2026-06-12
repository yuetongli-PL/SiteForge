# 起点 SiteForge 三层评估

评估对象：`https://www.qidian.com/`  
当前 build：`20260609T224242461Z`  
当前 skill：`qidian-live-actions`  
认证模式：无登录态，`auth=none`  
隐私模式：`strict`

## 总分

| 层级 | 层级分 | 权重 | 加权分 |
|---|---:|---:|---:|
| 能力发现层 | 99.35 | 30% | 29.805 |
| 能力执行层 | 99.62 | 35% | 34.867 |
| 任务完成层 | 99.06 | 35% | 34.671 |
| **最终总分** |  |  | **99.34** |

结论：不能写 100，也不能结束目标。当前 skill 已具备 planner、runner、resume、artifact 合约、API-first gate、verified site/local fallback、失败分类、端到端样例和 `429/429` 自检；但 active verified API 仍为 0，title-only 作品画像和作者名归档仍缺 verified resolver，任意作者/频道/专题全量归档仍未达到生产级。最新 no-login resolver probe 证明书名和作者名解析都会进入 security iframe 且精确匹配数为 0；额外 10 种 `soushu/search/so` URL 形态同样没有公开 result link，因此不能把 resolver 升级为 active。

## 一、能力发现层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 能力语义准确性 | 100 | active 任务均为真实起点公开任务：能力审计、API probe、关键词搜索、榜单、全部作品筛选、作品画像、主题报告、作者结构归档；无正文、简介、评论、章节正文被提升为能力 |
| 能力粒度合理性 | 100 | 以高层任务模板建模，未把每个路由或页面元素提升为能力 |
| 证据完整性 | 100 | active 任务均有 planner、runner、resume、artifact 合约、样例目录和自检覆盖 |
| 候选能力解释性 | 100 | title-only 作品画像、作者名归档、任意作者/频道/专题归档和 API seeds 均有 reasonCode 与 recovery |
| 程序接口发现真实性 | 94.8 | 发现 16 个 API seeds，adapter accepted 16；但 replayVerified=0、activatedApiAdapterCount=0，因此不能满分 |
| 站点类型识别准确性 | 100 | `siteKey=qidian`，小说/章节内容站点；能力围绕作品、作者、榜单、筛选和公开元数据 |
| 适配器选择合理性 | 100 | 使用起点专属适配器和 `qidian-live-actions` skill；未把未验证 API 伪装成 active |
| 安全边界发现 | 100 | 登录、cookie/token/header/profile、支付、订阅、打赏、投票、收藏、评论、发布、删除、账号书架/历史、正文下载均被识别为禁用或边界 |

能力发现层加权平均：**99.35**。

## 二、能力执行层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 参数/槽位建模质量 | 100 | query、ranking、channel、category、status、attribute、word_count、quality、updated_within、tag、sign_site、bookUrl/bookId、author/authorId 等槽位已建模 |
| 执行计划完整性 | 100 | active/diagnostic/degraded 任务均由 planner 给出执行命令或 blocked artifactCommand |
| 运行时绑定稳定性 | 100 | 代表任务产物可通过 `--resume` 复用；边界任务记录 `resumeCacheUsed=true` |
| 单能力执行成功率 | 99.0 | 公开结构任务可产出 artifact；API replay、live search/topic 仍 degraded |
| 结果验证能力 | 100 | `verify-qidian-skill.mjs` 最新通过 `429/429`，覆盖筛选、榜单、搜索、作品、作者、账号边界、书名/作者名 resolver probe 边界、route-variant resolver 探针、生产评估一致性和敏感材料扫描 |
| 输出结构化质量 | 100 | 每个任务写 `task-plan.json`、`task-state.json`、`task-summary.json`、`task-report.md`、JSONL、cache、archive |
| 错误恢复能力 | 98.0 | WAF、API 签名缺失、权限/账号、证据缺失、空结果均有 reasonCode 和 recovery；但真正的 API replay 与 resolver 仍未恢复 |
| 执行安全治理 | 100 | 无登录态、无 session material、无 raw private body；账号/写操作/支付/正文下载默认 blocked |

能力执行层加权平均：**99.62**。

## 三、任务完成层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 用户意图覆盖率 | 99.0 | 能覆盖能力查询、榜单、全部作品筛选、关键词、主题、作品画像、covered authorId、账号边界；title-only 与作者名请求仍 degraded |
| 意图分发准确率 | 100 | planner 能把筛选、榜单、搜索、作品、作者、账号书架/历史分别分发到正确任务或 blocked surface |
| 多步任务规划质量 | 99.0 | 搜索/榜单/筛选 -> 结构验证/画像/主题报告可组合；API-first gate 与 fallback 路径明确 |
| 能力组合成功率 | 98.8 | 公开任务组合成功；API replay、live 采集、任意作者/频道归档仍受阻 |
| 上下文传递正确率 | 100 | 通过 bookId/bookUrl、authorId、route、ranking、filter dimension 等结构字段传递上下文 |
| 端到端任务完成率 | 98.6 | 大多数公开任务完成；账号书架/历史正确 blocked；书名画像和作者名归档只能输出边界产物 |
| 任务结果质量 | 99.0 | 输出为结构化、可复用 artifact；不输出长正文或私密数据 |
| 失败解释与修复建议 | 100 | 每个 degraded/blocked 样例均有 reasonCode、artifact 和 recovery |
| 任务级安全合规 | 100 | 多步任务仍遵守无登录态、只读、脱敏、无正文持久化边界 |

任务完成层加权平均：**99.06**。

## 端到端样例产物

| 样例 | 状态 | 产物路径 |
|---|---|---|
| 能力审计 | `passed_with_local_evidence` | `.siteforge/qidian-research-tasks/sample-capability-audit` |
| API replay probe | `captured_with_warning` | `.siteforge/qidian-research-tasks/sample-api-replay-probe` |
| 全部作品筛选 | `passed_with_local_evidence` | `.siteforge/qidian-research-tasks/sample-all-works-filter-map` |
| 榜单快照 | `passed_with_local_evidence` | `.siteforge/qidian-research-tasks/sample-ranking-snapshot` |
| 关键词趋势 | `captured_with_warning` | `.siteforge/qidian-research-tasks/sample-keyword-search-trend` |
| 作品画像 | `passed_with_browser_evidence` | `.siteforge/qidian-research-tasks/sample-book-profile` |
| 书名画像边界 | `captured_with_warning` | `.siteforge/qidian-research-tasks/probe-book-title-boundary` |
| 主题报告 | `captured_with_warning` | `.siteforge/qidian-research-tasks/sample-topic-report` |
| 作者结构归档 | `passed_with_browser_evidence` | `.siteforge/qidian-research-tasks/sample-author-channel-archive` |
| 作者名归档边界 | `captured_with_warning` | `.siteforge/qidian-research-tasks/probe-author-name-boundary` |
| 账号书架/历史边界 | `blocked` | `.siteforge/qidian-research-tasks/sample-account-library-history` |
| 生产自检 | `passed`，429/429 | `.siteforge/qidian-research-tasks/production-skill-evaluation` |

书名和作者名 resolver 边界补充证据：`probe-book-title-boundary/archive/entity-resolver-probe.md` 与 `probe-author-name-boundary/archive/entity-resolver-probe.md` 均只保存 blocker reason、recovery、security iframe / zero-match 计数和 promotion gate；不保存原始查询文本、匹配文本、raw HTML、raw DOM、正文、简介、cookie、token 或 storage。当前书名 probe 的 exactBookMatchCount=0，作者名 probe 的 exactAuthorMatchCount=0；route-variant 参考证据覆盖 7 个书名 URL 形态和 3 个作者名 URL 形态，全部 securityIframeCount=1 且 book/author link count=0。

## 硬性封顶规则检查

| 规则 | 状态 |
|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 未触发 |
| 只读内容被误判为发布、提交、删除、支付 | 未触发 |
| 虚构程序接口能力 | 未触发，active verified API 为 0 |
| active 能力大量没有执行计划 | 未触发 |
| 无法解释失败原因 | 未触发，degraded/blocked 样例均有 reasonCode 和 recovery |
| 敏感材料进入报告、技能或能力字段 | 未触发，自检覆盖敏感材料扫描 |

## 未完成项

1. 解决 production-safe `qidian_sign_unavailable`，不能采用 anti-automation 诊断条件，也不能读取或保存 cookie、token、storage、header、signature、raw body。
2. API 必须达到 replay verified / adapter bound / runtime tested 才能 active。
3. 为 title-only 作品画像补 verified title-to-book resolver。
4. 为作者名归档补 verified author-name-to-authorId resolver。
5. 扩展任意作者、频道、专题全量归档的目标匹配和分页证据。
6. 若未来支持账号书架/历史，必须另设受治理登录/session provider；当前无登录态 skill 继续 blocked。
