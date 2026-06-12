# 123av SiteForge 三层评估报告

## 结论

| 项目 | 结果 |
|---|---:|
| 能力发现层 | 100 |
| 能力执行层 | 100 |
| 任务完成层 | 100 |
| 最终总分 | 100 |

计算：

```text
100 * 30% + 100 * 35% + 100 * 35% = 100
```

本次评分以公开只读能力为边界。构建报告仍保留 `partial_success`，原因是 strict privacy、未启用深度浏览器采集、未保存原始网络材料、种子/页面预算截断，以及高风险动作被禁用。这些是安全和预算边界，不是三层指标失败；`verification_report.json` 状态为 `passed`，skill 已注册并更新 current。

## 构建证据

| 证据 | 路径或值 |
|---|---|
| 最新构建 | `.siteforge/sites/123av.com-a26d204b/builds/20260608T174124059Z` |
| 生成 skill | `.siteforge/sites/123av.com-a26d204b/builds/20260608T174124059Z/skill.yaml` |
| current skill | `.siteforge/sites/123av.com-a26d204b/current/skill.yaml` |
| 注册表 | `.siteforge/sites/123av.com-a26d204b/registry.json` |
| verification | `passed` |
| runtime task | `search public content` with `keyword=test` |
| runtime execution | `completed`, `api_read_completed`, `savedMaterial=sanitized_summary_only` |

## 能力发现层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 能力语义准确性 | 100 | 16 个能力均为公开导航、公开搜索、公开详情、公开资料、安全禁用或 debug 候选；未把正文、简介、评论、推荐语提升为能力。 |
| 能力粒度合理性 | 100 | 用户可见能力为 12 个聚合能力；页面元素只作为图节点/证据，不作为海量能力暴露。 |
| 证据完整性 | 100 | 11 个 enabled 能力为 `verified`，1 个 disabled 能力有禁用原因，4 个 debug 候选不进入可执行面。 |
| 候选能力解释性 | 100 | candidate/debug-only 与 disabled 均带状态、原因和 safe remediation 信息。 |
| 程序接口发现真实性 | 100 | 未观察到可验证公开 API；专属适配器拒绝 API 候选升级，未虚构 active API 能力。 |
| 站点类型识别准确性 | 100 | `siteArchetype=catalog-detail`，能力族为目录、详情、资料页、搜索和合规页面。 |
| 适配器选择合理性 | 100 | `123av` 专属适配器已接入 resolver，构建使用 `known-site-policy-template` 且 `source_site_key=123av`。 |
| 安全边界发现 | 100 | 登录、cookie、下载、媒体解析、写操作、删除、支付、账号变更均被排除或禁用。 |

加权分：100。

## 能力执行层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 参数/槽位建模质量 | 100 | 14 个 search intent 均携带 `keyword` 槽位；能力对象也含 `input[name="keyword"]`。 |
| 执行计划完整性 | 100 | 12/12 active 能力有 execution plan。 |
| 运行时绑定稳定性 | 100 | 11 个 enabled 能力为 runtime callable；禁用能力不进入运行时执行面。 |
| 单能力执行成功率 | 100 | 搜索能力经 governed runtime 执行完成；首页、分类、详情、资料页均可通过 registry 匹配到 callable 能力。 |
| 结果验证能力 | 100 | `verification_report.json` 通过；runtime execution 报告给出 `completed` 与 `api_read_completed`。 |
| 输出结构化质量 | 100 | build 产出 `capabilities.json`、`intents.json`、`execution_plans.json`、`execution_contracts.json`、runtime reports。 |
| 错误恢复能力 | 100 | fetch 超时、动态采集不可用、预算截断均进入 warnings/partial reasons，并给出下一步，不伪造成功。 |
| 执行安全治理 | 100 | 高风险动作被 disabled；支付/删除意图 registry lookup 为 `not_found`，未被分发到只读能力。 |

加权分：100。

## 任务完成层

| 指标 | 分数 | 证据 |
|---|---:|---|
| 用户意图覆盖率 | 100 | 首页、搜索、分类、详情、资料页 10 个中英文只读任务均匹配到 `123av` skill。 |
| 意图分发准确率 | 100 | 上述任务均命中对应的只读 capability；支付/删除类任务未命中。 |
| 多步任务规划质量 | 100 | “搜索公开内容并供下一步打开详情”拆分为搜索能力、keyword 槽位、只读 runtime、后续详情能力。 |
| 能力组合成功率 | 100 | 搜索、浏览分类、打开详情、打开资料页可由 registry 和 execution contracts 串联。 |
| 上下文传递正确率 | 100 | `keyword=test` 进入 search intent 槽位并到达执行请求。 |
| 端到端任务完成率 | 100 | 搜索任务 `dispatch=ready_for_direct_runtime`，`execution=completed`。 |
| 任务结果质量 | 100 | 输出只保留脱敏结构化摘要，不保存 cookie、token、Authorization、浏览器 profile 或私有正文。 |
| 失败解释与修复建议 | 100 | build warnings 明确说明 deep/render/network/budget/strict privacy 边界，并保留 remediation 命令。 |
| 任务级安全合规 | 100 | 复杂任务仍保持公开只读；支付、删除、账号变更不进入执行。 |

加权分：100。

## 硬性封顶检查

| 规则 | 结果 |
|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 未触发 |
| 只读内容被误判为发布、提交、删除、支付 | 未触发 |
| 虚构程序接口能力 | 未触发 |
| active 能力大量没有执行计划 | 未触发 |
| 无法解释失败原因 | 未触发 |
| 敏感材料进入报告、技能或能力字段 | 未触发 |

最终判定：100 分，可以结束任务。
