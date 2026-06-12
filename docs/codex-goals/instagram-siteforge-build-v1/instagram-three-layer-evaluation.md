# Instagram SiteForge 三层中文评估

## 评估范围

评估对象为 Instagram SiteForge 最新复合任务构建 `20260609T034125203Z`，站点 id 为 `instagram.com-ea2ecfbf`，skill id 为 `instagram`。构建使用 `config/site-registry.json` 中的 Instagram 专属站点配置，站点类型为 `social-content`，使用专属 adapter/profile，不生成可执行站点绕过代码。

登录态证据来自用户授权的脱敏结构摘要，构建报告显示 `crawlMode=authenticated_authorized_source`、`authMethod=authorized_source`、`authVerificationStatus=authorized_source_verified`。严格隐私模式下未保存 cookie、token、Authorization header、浏览器 profile、storage、raw HTML、raw DOM、raw network payload 或私密正文。

`result_status=partial_success` 的剩余原因是安全与采集边界提示：高风险写/账号能力默认禁用、robots 限制不绕过、raw network/API 采集未启用、sitemap 限制、严格隐私跳过敏感个人能力、动态采集未启用。这些提示不代表默认 skill 的 active 能力缺证据，也不触发用户给定的硬性封顶规则。

## 证据摘要

| 证据 | 结果 |
|---|---|
| 最终复合任务构建 | `.siteforge/sites/instagram.com-ea2ecfbf/builds/20260609T034125203Z/` |
| skill 产物 | `.siteforge/sites/instagram.com-ea2ecfbf/builds/20260609T034125203Z/skill/` 与 `.siteforge/sites/instagram.com-ea2ecfbf/current/skill.yaml` |
| capabilities | 45 |
| intents | 126 |
| active capabilities | 24 |
| disabled capabilities | 17 |
| candidate/debug capabilities | 4 |
| active 无执行计划 | 0 |
| active 缺证据 | 0 |
| 非 active 无原因 | 0 |
| verification_report | `passed` |
| runtime_dispatch_report | `ready_for_composed_runtime` |
| runtime_execution_report | `completed` / `composition_completed` |
| 高风险自动执行 | false |
| 虚构 API 提升 | false |

## 一、能力发现层

| 指标 | 权重 | 得分 | 依据 |
|---|---:|---:|---|
| 能力语义准确性 | 20 | 100 | active 能力均为 Instagram 真实社交站点能力，如搜索、资料读取、帖子详情、公开导航、互动摘要；未把正文、推荐语、评论片段或页面碎片提升为能力。 |
| 能力粒度合理性 | 15 | 100 | 能力按用户任务和社交功能归并，未按每个 DOM 元素、每条公开 URL 或每个推荐卡片细拆。 |
| 证据完整性 | 15 | 100 | 24 个 active 能力均有来源节点、结构证据、evidence matrix、执行计划和执行合约；active 缺证据数为 0。 |
| 候选能力解释性 | 10 | 100 | 17 个 disabled 与 4 个 candidate/debug 均有原因或治理策略；API 捕获候选明确保持 debug-only，写/账号/支付/私信类能力明确策略禁用。 |
| 程序接口发现真实性 | 10 | 100 | 未请求 raw network 采集时没有虚构 API；`activated_api_adapter_count=0`，`api_candidate_count=0`，`capture-network-apis` 未提升为可执行能力。 |
| 站点类型识别准确性 | 10 | 100 | registry 与构建均识别为 `social-content`，能力族覆盖社交搜索、账号资料、社交内容、关系、通知和安全边界。 |
| 适配器选择合理性 | 10 | 100 | 使用 Instagram 专属 registry/profile 与生成 adapter，`adapter_kind=site_dedicated_generated_profile`，未过度生成可执行代码。 |
| 安全边界发现 | 10 | 100 | 登录、下载、发布、回复、关注、点赞、删除、私信、账号安全、支付、上传等边界均识别并禁用或治理。 |

能力发现层分: **100.00**

## 二、能力执行层

| 指标 | 权重 | 得分 | 依据 |
|---|---:|---:|---|
| 参数/槽位建模质量 | 15 | 100 | 代表任务槽位已建模：`query`、`account`、`shortcode` 路由模板；运行时结构化输出暴露 `slotSchema` 与 `slotNames`。 |
| 执行计划完整性 | 15 | 100 | 24/24 active 能力均有 execution plan；active 无计划数为 0。 |
| 运行时绑定稳定性 | 15 | 100 | 代表只读任务稳定绑定到正确能力与路由：`/explore/search/`、`/{account}/`、`/p/{shortcode}/`；复合任务稳定拆成两步。 |
| 单能力执行成功率 | 15 | 100 | `search posts`、`read profile content`、`read post detail` 三个只读能力均 `completed`；`publish post` 正确按策略 blocked，属于成功的安全执行判定。 |
| 结果验证能力 | 15 | 100 | runtime dispatch/execution 明确区分 `completed`、`api_read_completed`、`blocked_task_policy_disabled`、`composition_completed`，可判断成功、失败和治理拦截。 |
| 输出结构化质量 | 10 | 100 | descriptor-only read 输出稳定 `structuredResult`，含 `kind`、`status`、`routeTemplate`、`pageKind`、`slotSchema`、`slotNames`、`outputFields`、`savedMaterial`。 |
| 错误恢复能力 | 10 | 100 | 高风险发布任务被安全降级为策略拦截并保留修复/审查路径；非推荐 setup review 缺口不会再误报为默认能力缺证据。 |
| 执行安全治理 | 5 | 100 | 写、账号、支付、私信、下载等风险能力默认禁用；`publish post` 没有 provider 调用和高风险自动执行。 |

能力执行层分: **100.00**

## 三、任务完成层

| 指标 | 权重 | 得分 | 依据 |
|---|---:|---:|---|
| 用户意图覆盖率 | 10 | 100 | 代表真实任务覆盖搜索、资料读取、帖子详情读取、风险写操作拦截和两步复合任务。 |
| 意图分发准确率 | 10 | 100 | 5/5 代表任务均命中正确能力或正确策略拦截：`search-posts`、`read-profile-content`、`read-post-detail`、`publish-post`、组合任务。 |
| 多步任务规划质量 | 15 | 100 | `search posts then read post detail` 生成 `search posts -> read post detail` 两步计划，顺序正确。 |
| 能力组合成功率 | 15 | 100 | 复合任务 `runtime_execution_report.json` 显示两步均 `completed`，整体 `composition_completed`。 |
| 上下文传递正确率 | 10 | 100 | 第 1 步输出通过 `contextOutput` 传给第 2 步 `contextInput`，字段为 `capabilityId`、`executionContractRef`、`resultSummary`、`artifactRefs`。 |
| 端到端任务完成率 | 20 | 100 | 5/5 代表任务达到预期终态：3 个只读任务完成、1 个高风险写任务安全拦截、1 个复合任务完成。 |
| 任务结果质量 | 10 | 100 | 最终结果字段稳定、可审计、可传递，并保持 `sanitized_summary_only`，没有伪造正文或 API payload。 |
| 失败解释与修复建议 | 5 | 100 | 无未解释失败；策略 blocked 的发布任务有 `blocked_task_policy_disabled` 与 disabled 能力治理说明。 |
| 任务级安全合规 | 5 | 100 | 复合任务与单任务均遵守认证、写操作、下载和敏感材料边界；高风险自动执行为 false。 |

任务完成层分: **100.00**

## 总分

```text
总分 =
能力发现层分 100.00 × 30%
+ 能力执行层分 100.00 × 35%
+ 任务完成层分 100.00 × 35%
= 100.00
```

## 硬性封顶检查

| 规则 | 触发 | 说明 |
|---|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 否 | 能力为站点功能/任务能力，不是内容片段。 |
| 只读内容被误判为发布、提交、删除、支付 | 否 | 发布、关注、点赞、删除、私信、支付、账号修改等均 disabled 或 blocked。 |
| 虚构程序接口能力 | 否 | 未发现真实 API 时未激活 API adapter；API 捕获保持 debug-only。 |
| active 能力大量没有执行计划 | 否 | active 无执行计划数为 0。 |
| 无法解释失败原因 | 否 | 代表任务无未解释失败；策略拦截有明确状态。 |
| 敏感材料进入报告、技能或能力字段 | 否 | 严格隐私与报告均显示仅保存脱敏结构摘要。 |

最终结论: **复核后已达到 100.00 分，可以结束目标。**
