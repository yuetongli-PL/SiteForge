# 起点 SiteForge 构建 Goal Ledger

## 目标

对 `https://www.qidian.com/` 执行 SiteForge 无登录态构建，使用 `config/site-registry.json` 中的 `qidian` 配置，生成起点专属 site skill，并按能力发现层、能力执行层、任务完成层做中文评估，最终总分达到 100。

## 边界

- 认证边界：`--auth none`，不使用登录态、cookie、浏览器 profile 或用户会话材料。
- 数据边界：`--privacy strict`，只保留脱敏结构摘要，不保存章节正文、页面正文、私有内容或原始网络 payload。
- API 边界：起点 `qidian_yuew_sign` 类接口需要浏览器桥接签名上下文；无登录态构建中只能作为已解释 candidate/debug-only 证据，不能虚构为 active API 能力。
- 代码边界：仅修正 qidian skillId、章节内容站点能力去重、page reconciliation 诊断型挑战信号覆盖、candidate 原因显式化，以及 public rendered 目标选择的代表性排序。

## 迭代记录

| 迭代 | Build | 结果 | 处理 |
|---|---|---|---|
| 1 | `20260608T164705610Z` | `skill_id=structure-ref-id`，通用公开能力和小说能力重复，API candidate 正确未激活 | 调整已知站点 skillId 优先级；补章节内容语义去重 |
| 2 | `20260608T165945025Z` | `skill_id=qidian`，能力去重收敛；page reconciliation 因静态 shell 诊断阻断 promotion | 区分明确挑战页和 diagnostics-only probe；完整公开结构闭环时降级为通过 |
| 3 | `20260608T170946878Z` | `verification=passed`、`registry=registered`；API candidate 原因仍不够直读 | 给 `capture network APIs` 写入顶层 `activationBlockedReason` |
| 4 | `20260608T171256467Z` | `verification=passed`、`registry=registered`、`current/skill.yaml` 更新；但 `browse book rankings` 仍是 candidate | 评分结论撤销；将“浏览图书榜单”纳入任务完成分母 |
| 5 | `20260608T174302387Z` | `browse book rankings` 变为 active，`runtimeCallable=true`，三层评分重新达到 100 | 修复 rendered 目标排序，优先覆盖榜单动态页 |

## 最终证据

- 最终 build：`.siteforge/sites/qidian.com-f17050c4/builds/20260608T174302387Z/`
- 当前 skill：`.siteforge/sites/qidian.com-f17050c4/current/skill.yaml`
- 关键状态：`skillId=qidian`、`verificationStatus=passed`、`registryStatus=registered`、`currentUpdated=true`
- 能力：10 个能力，9 个 active，1 个 candidate/debug-only；active 能力均有 execution plan。
- 榜单能力：`browse book rankings` 已 active，`planCallable=true`、`runtimeCallable=true`，observed evidence 包含 `public_rendered_structure_present`，`missingEvidence=[]`。
- API：16 个 qidian API candidate 被 adapter 接受，但 0 个激活；原因是 `authenticated_browser_bridge_unavailable`，符合无登录态边界。
- Page reconciliation：`passed`，`missingCategoryLinks=0`，`coveredDiagnosticChallengeSignals=20`，`reasonCodes=[]`。

## 验收命令

```powershell
node --test tests\node\page-reconciliation-report.test.mjs
node --test --test-name-pattern "prefers known chapter site key" tests\node\siteforge-build.test.mjs
node --test tests\node\qidian-site-adapter.test.mjs tests\node\api-discovery.test.mjs
node --test --test-name-pattern "compiles a local HTTP simple-shop site end-to-end|compiles a local HTTP Tencent News site with robots filtering" tests\node\siteforge-build.test.mjs
node --test --test-name-pattern "public rendered targets prioritize qidian ranking" tests\node\siteforge-build.test.mjs
node src\entrypoints\cli\index.mjs build https://www.qidian.com/ --auto --auth none --privacy strict --report both --progress plain --max-depth 2 --max-pages 20 --max-seeds 40 --network --render-js --headless --json --quiet
```
