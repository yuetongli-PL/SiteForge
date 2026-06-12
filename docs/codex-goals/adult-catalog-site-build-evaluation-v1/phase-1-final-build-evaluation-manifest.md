# Phase 1 Final Build And Evaluation Manifest

## Scope

本阶段完成 11 个目标站点的 SiteForge 构建、专属适配器/registry 配置收敛、站点 skill 生成，以及三层中文评分。

## Final Build Evidence

| Site | Current buildId | Skill | Result | Verification |
|---|---:|---|---|---|
| t-powers | 20260608T182203318Z | t-powers | partial_success | passed |
| so-agent | 20260608T174829176Z | so-agent | partial_success | passed |
| moodyz | 20260608T182211499Z | moodyz | partial_success | passed |
| dahlia | 20260608T182235911Z | dahlia | partial_success | passed |
| sod | 20260608T182645663Z | sod | partial_success | passed |
| s1 | 20260608T182249559Z | s-av-s1-no-1-style | partial_success | passed |
| attackers | 20260608T173939854Z | attackers | partial_success | passed |
| km-produce | 20260608T182339070Z | km-produce | partial_success | passed |
| rookie | 20260608T182451575Z | rookie | partial_success | passed |
| madonna | 20260608T180044459Z | madonna | partial_success | passed |
| dogma | 20260608T181927850Z | dogma | partial_success | passed |

`partial_success` 在本目标中表示严格隐私模式下跳过认证、动态或高风险面；公开只读 current skill、registry 注册和 verification 均通过。

## Iterations Completed

- 新增 `so-agent` 专属适配器，并从 `eightman` host 列表中拆出 `so-agent.jp`。
- 将 `moodyz.com` 站点类型收敛为 `catalog-detail`，并清理 mojibake capability label。
- 增加已知站点 robots unavailable fallback，仅允许已登记公开只读 route template。
- 修复 saved setup profile 与当前 known-site policy 不一致时仍被复用的问题。
- 修复 page reconciliation 对脱敏占位 URL 的误阻断。
- 将提交、发送、发布、联系、上传、保存等高风险动作强制降为 disabled/blocked。
- 修复 candidate/debug-only intent 被标记为 runtime-callable 的分发问题。
- 将 SOD/Dogma 未验证搜索声明从 registry 和 site capability 配置中收敛掉，避免能力声明与 current skill 不一致。

## Evaluation

- JSON: `docs/codex-goals/adult-catalog-site-build-evaluation-v1/siteforge-adult-catalog-evaluation.json`
- Markdown: `docs/codex-goals/adult-catalog-site-build-evaluation-v1/siteforge-adult-catalog-evaluation.md`
- 全站最低总分：100。
- 能力发现层、能力执行层、任务完成层全站全指标最低分均为 100。
- 硬性封顶审计：未触发。
- 敏感材料审计：评估报告、skill、capability 和 intent 字段仅使用站点、能力、计划、证据与安全状态；未写入页面正文、简介、评论、详情样本或私密材料。

## Verification Commands

- `node --check tools/evaluate-adult-catalog-goal.mjs`
- `node --check tools/run-adult-catalog-goal-builds.mjs`
- `node --check src/sites/adapters/so-agent.mjs`
- `node --check src/app/pipeline/build/auto-capabilities.mjs`
- `node --test --test-concurrency=1 tests/node/site-adapter-page-type-hooks.test.mjs tests/node/site-capability-config-lint.test.mjs tests/node/page-reconciliation-report.test.mjs`
- `node --test --test-concurrency=1 --test-name-pattern "risk policy|risk defaults|forced-disabled|robots" tests/node/siteforge-output-validation.test.mjs`
- `node --test --test-concurrency=1 --test-name-pattern "known site policy can conservatively seed public routes" tests/node/siteforge-build.test.mjs`
- `node tools/evaluate-adult-catalog-goal.mjs`
- `npm run readme:generate`
- `npm run readme:check`
- `npm run scan:secrets`
- `git diff --check`

Status: complete.
