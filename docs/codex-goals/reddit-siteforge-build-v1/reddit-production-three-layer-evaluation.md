# Reddit 生产型 Skill 三层评分报告

生成时间: 2026-06-09T09:48:26.097Z

## 总分

| 层级 | 权重 | 层级分 |
| --- | --- | --- |
| 能力发现层 | 30% | 99.8 |
| 能力执行层 | 35% | 99.6 |
| 任务完成层 | 35% | 99 |

最终总分: 99.45 / 100

复核结论: 未达到 100。公开 feed 提供的正文已保存为 sanitized contentText；仍未达到 100 的原因是 OAuth JSON/API replay 被 Reddit network security 阻断，登录态 saved/history 只能安全执行结构归档，不能把私有正文或 descriptor-only 摘要说成完整内容采集。

## 能力发现层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 能力语义准确性 | 20 | 100 | 6 个高层任务均面向真实 Reddit 用户任务；没有把正文、评论、标题或页面碎片提升为能力。 |
| 能力粒度合理性 | 15 | 100 | 能力以归档、趋势、画像、发现、时间线、登录态结构归档为粒度；没有按 DOM 或每条路由泛滥生成。 |
| 证据完整性 | 15 | 100 | registry、专属适配器、API catalog、public feed replay、runner、测试、端到端 artifact 和 redaction 证据齐全。 |
| 候选能力解释性 | 10 | 100 | OAuth/API candidate、空 feed、私有 saved/history、mutation disabled 均有 reason、activationRequirement 或 remediation。 |
| 程序接口发现真实性 | 10 | 98 | active API 只包含 replay verified/adapter bound/runtime tested 的公开 Atom feed；OAuth JSON/API 被保留为 candidate，未虚构 active。 |
| 站点类型识别准确性 | 10 | 100 | registry 将 Reddit 建模为 social-content，任务和安全边界符合社交讨论站点。 |
| 适配器选择合理性 | 10 | 100 | 使用 reddit 专属 registry、known-sites/reddit catalog、reddit-action 入口和生产 task runner，未退回泛用页面摘要。 |
| 安全边界发现 | 10 | 100 | 登录态、私信、账号设置、支付、发布、回复、投票、关注、删除和 raw private body 边界均被识别并治理。 |

## 能力执行层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 参数/槽位建模质量 | 15 | 100 | subreddit、account、query、from/to、collectionMode、maxItems、downloadMedia 和自然语言 request 均被建模。 |
| 执行计划完整性 | 15 | 100 | 每个高层任务都有 planner、bucket 计划、active feed 或 candidate/fallback、resume 和 artifact 合约。 |
| 运行时绑定稳定性 | 15 | 100 | 公开 feed bucket 通过 live task-state HTTP 200；Browser Bridge 登录态结构 route 覆盖 21/21。 |
| 单能力执行成功率 | 15 | 98 | 5 个公开任务全量 active feed 成功；saved/history 因私有内容边界只执行结构归档。 |
| 结果验证能力 | 15 | 100 | task-summary 明确 completed、apiCompletedBucketCount、siteFallbackBucketCount、descriptorOnly、blocked/degraded 和失败层。 |
| 输出结构化质量 | 10 | 99 | 公开任务产出 item-level JSONL、contentText/contentTextLength/contentTextTruncated、communities/accounts/authors；saved/history 有 OAuth candidate 与 --allow-private-content 白名单治理，当前样例因缺 OAuth 仍只产出结构摘要。 |
| 错误恢复能力 | 10 | 100 | feed/OAuth/缺凭证/权限/rate limit/空结果均立即切换 verified fallback 或保留可恢复状态。 |
| 执行安全治理 | 5 | 100 | 未持久化 cookie、token、auth header、browser profile、raw private body 或 raw feed；mutation 默认 disabled。 |

## 任务完成层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 用户意图覆盖率 | 10 | 98 | 覆盖 subreddit 归档、关键词趋势、redditor 画像、社区发现、事件时间线、登录态 saved/subscribed 结构归档；私有内容采集不开放。 |
| 意图分发准确率 | 10 | 100 | --request planner 已测试 subreddit/user/timeline/community/trend 分发，并记录 inference/signals/confidence。 |
| 多步任务规划质量 | 15 | 100 | 任务拆分为 posts/profile/search/timeline/relations/library bucket，顺序、fallback、no-stall 和 artifact 合约完整。 |
| 能力组合成功率 | 15 | 100 | 公开代表任务均端到端 completed 且 0 descriptor-only；saved/history 结构任务按安全边界 completed。 |
| 上下文传递正确率 | 10 | 100 | plan/state/cache-index/items/communities/accounts/authors 传递 target、bucket、item 字段和 artifact 路径。 |
| 端到端任务完成率 | 20 | 97 | 公开读任务含 feed 提供正文的端到端采集已完成；OAuth rich JSON 和私有 saved/history 内容采集仍不能安全完成。 |
| 任务结果质量 | 10 | 98 | 公开任务给出可复用 item-level JSONL 和 sanitized contentText；私有登录态任务具备授权门禁和白名单，但当前 runtime 只能给结构证据，未达到 private full content archive。 |
| 失败解释与修复建议 | 5 | 100 | 明确 API auth、network security、permission、rate limit、empty feed、selector/site policy 和 remediation。 |
| 任务级安全合规 | 5 | 100 | 复杂任务仍遵守登录态、写操作、下载和私有内容边界；没有为提分泄露敏感材料。 |

## 硬性封顶复核

| 问题 | 状态 |
| --- | --- |
| contentPromotedAsCapability | 未触发 |
| readMisclassifiedAsMutation | 未触发 |
| fictionalApiCapability | 未触发 |
| activeCapabilitiesWithoutPlans | 未触发 |
| failureExplanationMissing | 未触发 |
| sensitiveMaterialPersisted | 未触发 |

## 未满 100 的具体阻塞

1. OAuth JSON/API replay verified count remains 0
   - 证据: reddit-public-json-replay-report.json 显示 reddit-network-security-blocked，公共 JSON 与 oauth.reddit.com 样例均为 HTTP 403 text/html。
   - 修复: 从允许访问 Reddit JSON/OAuth API 的网络或提供运行时 OAuth inputs 后重新 replay；只提升 replay verified / adapter bound / runtime tested 的 GET 操作。
2. 登录态 saved/history 内容采集未开放
   - 证据: 公开 feed 样例已保存 sanitized contentText；runner 已实现 --allow-private-content 白名单门禁；auth crawl 与 saved-history 当前样例仍只保存 sanitized structure summary；raw private body/private content persisted=false。
   - 修复: 如需私有 saved/history item-level archive，需要运行时 OAuth token/User-Agent、用户明确授权 --allow-private-content、最小字段白名单、redaction contract 和单独 runtime proof。
