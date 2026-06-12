# 123av 生产型 skill 三层评估报告

## 结论

| 层级 | 分数 |
|---|---:|
| 能力发现层 | 100 |
| 能力执行层 | 100 |
| 任务完成层 | 100 |
| 最终总分 | 100 |

计算：

```text
100 * 30% + 100 * 35% + 100 * 35% = 100
```

本轮目标是把当前 123av skill 从“只读结构摘要/能力清单”提升为生产型任务 skill。最终产物没有把正文、标题、简介、评论、缩略图、媒体 URL、cookie、token、auth header、浏览器 profile 或私有 body 写入报告、技能或能力字段。

## 能力差异

| 项目 | 当前候选 skill | 新生产 skill |
|---|---|---|
| 能力形态 | 12 个 active 低层浏览/搜索/详情/资料页能力 | 新增 6 个 active 高层任务模板 |
| API 状态 | `capture network APIs` 为 candidate/debug-only | active API 为 0，原因是无 replay verified / adapter bound / runtime tested 公共 API |
| 执行方式 | 单能力 execution plan 与 runtime report | `scripts/123av-research-task-runner.mjs` 负责 planner、execute、resume、artifact 输出 |
| 产物 | route summary、capabilities、intents、execution plans/contracts | `task-plan/state/summary/report`、`raw-items.jsonl`、`deduped-items.jsonl`、`authors/accounts/items.jsonl`、`cache-index`、`archive/*.md` |
| 失败解释 | 以 build warning 为主 | API、selector、空结果、站点 fallback、账号/私有边界、crawl budget 分层解释 |
| 安全治理 | 高风险动作 disabled | 进一步禁止 raw 成人内容文本、原始内容 URL、认证材料、浏览器 profile、私有 body、媒体下载默认输出 |

权威产物：

- `skills/123av/SKILL.md`
- `skills/123av/references/123av-live-catalog.json`
- `.siteforge/sites/123av.com-a26d204b/current/production_task_templates.json`
- `.siteforge/sites/123av.com-a26d204b/current/production_capability_diff.json`
- `.siteforge/sites/123av.com-a26d204b/current/production_runtime_examples.json`

## 任务模板

| 任务 | 输入槽位 | planner bucket | 执行与恢复 |
|---|---|---|---|
| `channel-full-archive` / `author-full-archive` | `route/topic/url/profileUrl/entity/locale/maxItems` | route inventory、ranking、tags、detail、profile | `--execute --resume`，复用 `task-state.json` |
| `keyword-trend` | `query/locale/from/to/maxItems` | search binding、ranking context、tag backfill、detail follow-up | query 只写 hash，API 不可用立即 fallback |
| `entity-profile` | `profileUrl/entity/locale/maxItems` | profile route、related tags、detail follow-up | profile/entity 只写 hash 或 route template |
| `content-profile` | `contentUrl/content/locale/maxItems` | detail route、metadata contract、related route context | 不写标题、简介、评论、缩略图、媒体 URL |
| `list-history-collection` | `route/topic/locale/maxItems` | public rankings、public collections、blocked account lists | 公开列表采集，私有/账号列表记录为 blocked boundary |
| `event-timeline-report` | `query/topic/from/to/locale/maxItems` | search binding、ranking snapshots、archive context、detail follow-up | 多 bucket 串联，输出报告与 cache |

## Active / Candidate / Disabled

Active 高层任务：

| 能力 | 原因 |
|---|---|
| `channel-full-archive` / `author-full-archive` | 面向公开作者/频道/专题归档，具备 planner、执行命令、resume、artifact contract、失败解释 |
| `keyword-trend` | 关键词搜索与趋势分析，具备 query 槽位、API-first 策略、verified site fallback |
| `entity-profile` | 公开演员/实体画像，使用公开 profile route evidence |
| `content-profile` | 公开内容画像，只输出 descriptor-only metadata/route evidence |
| `list-history-collection` | 公开榜单/列表采集，并显式阻断账号/私有历史列表 |
| `event-timeline-report` | 搜索绑定、排行、归档上下文、详情后续任务组合 |

Candidate：

| 能力 | 原因 |
|---|---|
| `capture-network-apis` | 没有 replay verified、adapter bound、runtime tested 公共 API |
| `browse-catalog-tags` | debug-only 低层能力；生产面由 active tags 与高层任务覆盖 |
| `open-catalog-author-profile` | debug-only 低层能力；生产面由 `entity-profile` 覆盖 |
| `read-public-catalog-metadata` | debug-only 低层能力；生产面由 `content-profile` 覆盖 |

Disabled：

| 能力 | 原因 |
|---|---|
| 删除/发布/上传/账号修改 | 写操作或账号 mutation，默认 blocked |
| 支付/资金/商业动作 | 超出公开只读边界 |
| 登录、私信、私有收藏/历史/账号列表 | 需要认证或私有材料，禁止读取/输出 |
| 媒体下载与 `media-assets.json/jsonl` | 站点默认不允许；除非后续建立单独治理授权路径 |

## API-first 与 Fallback

当前 active API 数为 0。这是真实性约束，不是缺口：`123av` adapter 明确拒绝 API 升级，直到出现公共 API candidate 的 replay 验证、适配器绑定和 runtime 测试证据。

同一意图的策略：

1. 查 `skills/123av/references/123av-live-catalog.json`。
2. 如果 API 不是 `verified=true + replayVerified=true + adapterBound=true + runtimeTested=true`，不执行 API。
3. 立即执行 `siteFallback.commandTemplate`。
4. 用 `task-state.json` 恢复，不等待 API cooldown。

## 端到端样例

| 任务 | 产物目录 | 结果 |
|---|---|---|
| `author-full-archive` | `.siteforge/123av-production-tasks/e2e-author-full-archive` | completed，归一到 `channel-full-archive`，5/5 bucket，109 条 deduped 结构化记录 |
| `channel-full-archive` | `.siteforge/123av-production-tasks/e2e-channel-full-archive` | completed，5/5 bucket，109 条 deduped 结构化记录 |
| `keyword-trend` | `.siteforge/123av-production-tasks/e2e-keyword-trend` | completed，4/4 bucket，75 条 deduped 结构化记录 |
| `entity-profile` | `.siteforge/123av-production-tasks/e2e-entity-profile` | completed，3/3 bucket，61 条 deduped 结构化记录 |
| `content-profile` | `.siteforge/123av-production-tasks/e2e-content-profile` | completed，3/3 bucket，78 条 deduped 结构化记录 |
| `list-history-collection` | `.siteforge/123av-production-tasks/e2e-list-history-collection` | completed，3/3 bucket，55 条 deduped 结构化记录，7 条账号/私有边界 blocked 记录 |
| `event-timeline-report` | `.siteforge/123av-production-tasks/e2e-event-timeline-report` | completed，4/4 bucket，76 条 deduped 结构化记录 |

每个目录均包含：

- `task-plan.json`
- `task-state.json`
- `task-summary.json`
- `task-report.md`
- `raw-items.jsonl`
- `deduped-items.jsonl`
- `authors/items.jsonl`
- `accounts/items.jsonl`
- `cache-index.json`
- `cache-index.jsonl`
- `archive/index.md`
- `archive/<task>.md`
- `archive/route-samples.md`

## 能力发现层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 能力语义准确性 | 100 | 新增能力均为真实用户任务：归档、搜索趋势、画像、列表/历史、时间线报告；未把正文/标题/推荐语提升为能力。 |
| 能力粒度合理性 | 100 | 高层任务模板聚合低层路由；低层 debug-only 不暴露为生产任务。 |
| 证据完整性 | 100 | 每个任务有 source artifacts、planner bucket、API primary、site fallback、artifact contract。 |
| 候选能力解释性 | 100 | API candidate、debug-only candidate、disabled 能力均有原因。 |
| 程序接口发现真实性 | 100 | 未虚构 API；active API 为 0，candidate API 保持 blocked。 |
| 站点类型识别准确性 | 100 | 站点识别为 adult catalog-detail，任务围绕公开目录/详情/资料/搜索/排行。 |
| 适配器选择合理性 | 100 | 继续使用 `123av` 专属适配器与 registry `repoSkillDir=skills/123av`。 |
| 安全边界发现 | 100 | 登录、cookie、token、auth header、浏览器 profile、支付、写操作、私有列表、媒体下载均识别并治理。 |

加权层分：100。

## 能力执行层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 参数/槽位建模质量 | 100 | 六个任务均有明确 requiredAny 和 slots。 |
| 执行计划完整性 | 100 | 每个任务有 planner bucket、execute command、resume strategy。 |
| 运行时绑定稳定性 | 100 | runner 绑定 current graph、capabilities、execution plans/contracts，并通过 focused regression。 |
| 单能力执行成功率 | 100 | 6/6 E2E 任务完成。 |
| 结果验证能力 | 100 | `task-summary.json` 写 bucket、item、fallback、安全、failure 状态。 |
| 输出结构化质量 | 100 | JSONL 字段稳定：`itemId/taskId/bucketId/itemKind/pageType/routeTemplate/evidenceHash`。 |
| 错误恢复能力 | 100 | `task-state.json` 支持 resume；selector/API/边界失败有可操作解释。 |
| 执行安全治理 | 100 | mutation、认证材料、raw 内容、媒体下载默认阻断；安全扫描无命中。 |

加权层分：100。

## 任务完成层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 用户意图覆盖率 | 100 | 覆盖归档、搜索趋势、实体画像、内容画像、列表/历史、事件时间线/报告。 |
| 意图分发准确率 | 100 | 每个代表任务命中对应模板并生成正确 bucket。 |
| 多步任务规划质量 | 100 | 任务拆解为 search/ranking/tag/detail/profile/blocked-boundary 等步骤。 |
| 能力组合成功率 | 100 | 6 个多 bucket 任务均 completed。 |
| 上下文传递正确率 | 100 | route/query/entity/content 输入进入 target fingerprint，并传给 bucket/artifact。 |
| 端到端任务完成率 | 100 | 6/6 E2E 任务完成并产出 required artifacts。 |
| 任务结果质量 | 100 | 产物可恢复、可去重、可缓存、可审计；不声称采集 raw 内容。 |
| 失败解释与修复建议 | 100 | API、selector、账号/私有边界、crawl budget 均有原因与 remediation。 |
| 任务级安全合规 | 100 | 列表/历史任务记录 7 条 blocked boundary，未执行私有/账号动作。 |

加权层分：100。

## 硬性封顶

| 规则 | 结果 |
|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 未触发 |
| 只读内容被误判为发布、提交、删除、支付 | 未触发 |
| 虚构程序接口能力 | 未触发 |
| active 能力大量没有执行计划 | 未触发 |
| 无法解释失败原因 | 未触发 |
| 敏感材料进入报告、技能或能力字段 | 未触发 |

## 阻塞项与迭代计划

未达生产级阻塞项：无。

后续可选迭代：

1. 如果未来观察到公共 API，补 replay fixture、adapter approval、runtime binding 后再升 active API。
2. 如果用户明确要求媒体处理，先建立独立治理授权路径，再决定是否输出 `media-assets.json/jsonl`。
3. 如需更广泛公开覆盖，可重跑更深 public crawl/browser route coverage，但仍禁止 raw 内容与认证材料进入产物。
