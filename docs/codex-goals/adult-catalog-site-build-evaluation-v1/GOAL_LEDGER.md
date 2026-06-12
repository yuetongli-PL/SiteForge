# Adult Catalog Site Build Evaluation V1

## Goal

对 11 个指定站点执行 SiteForge 构建，要求：

- `config/site-registry.json` 与 `config/site-capabilities.json` 覆盖每个站点。
- 每个站点使用专属 SiteAdapter，不回退为 generic adapter。
- 每个站点生成 SiteForge build skill 产物。
- 按能力发现层、能力执行层、任务完成层进行中文评估。
- 只有所有站点总分达到 100，且无硬性封顶或敏感材料问题，才能标记完成。

## Target Sites

| Site | Requested URL | Expected Site Type | Required Adapter |
|---|---|---|---|
| t-powers | `https://www.t-powers.co.jp/` | catalog-detail | `t-powers` |
| so-agent | `http://so-agent.jp/` | catalog-detail | `so-agent` |
| moodyz | `https://moodyz.com/top` | catalog-detail | `moodyz` |
| dahlia | `https://dahlia-av.jp/` | catalog-detail | `dahlia` |
| sod | `https://www.sod.co.jp/` | catalog-detail | `sod` |
| s1 | `https://s1s1s1.com/top` | catalog-detail | `s1` |
| attackers | `https://attackers.net/top` | catalog-detail | `attackers` |
| km-produce | `https://www.km-produce.com/` | catalog-detail | `km-produce` |
| rookie | `https://rookie-av.jp/top` | catalog-detail | `rookie` |
| madonna | `https://madonna-av.com/top` | catalog-detail | `madonna` |
| dogma | `http://www.dogma.co.jp/` | catalog-detail | `dogma` |

## Evaluation Layers

| Layer | Weight |
|---|---:|
| 能力发现层 | 30 |
| 能力执行层 | 35 |
| 任务完成层 | 35 |

The evaluation implementation must preserve Chinese metric names and produce per-site layer scores plus final weighted score.

## Hard Caps

| Condition | Cap |
|---|---:|
| 正文、简介、评论、章节内容被提升为能力 | 60 |
| 只读内容被误判为发布、提交、删除、支付 | 65 |
| 虚构程序接口能力 | 70 |
| active 能力大量没有执行计划 | 75 |
| 无法解释失败原因 | 80 |
| 敏感材料进入报告、技能或能力字段 | 不合格 |

## Current Findings

- Existing worktree already contains SiteForge changes and generated adapters for 10 of 11 target sites.
- `so-agent.jp` is not yet present in registry, capabilities, resolver, or adapter files.
- `src/sites/adapters/moodyz.mjs` contains mojibake labels and must be repaired before final scoring.
- Existing generated outputs under `.siteforge/` are historical and must not be treated as evidence for this goal unless rebuilt during this run.

## Completion Evidence

Completion requires:

- Fresh build artifact path for each target site.
- Fresh generated `skill.yaml` for each target site.
- Registry/capability lint passing.
- Adapter contract coverage passing.
- Chinese evaluation report with all three layer scores equal to 100 for every target.
- Redaction/sensitive-material audit passing.
- Final targeted tests and syntax checks passing.

## Final Status

Status: complete.

- Final manifest: `docs/codex-goals/adult-catalog-site-build-evaluation-v1/phase-1-final-build-evaluation-manifest.md`
- Final evaluation JSON: `docs/codex-goals/adult-catalog-site-build-evaluation-v1/siteforge-adult-catalog-evaluation.json`
- Final evaluation Markdown: `docs/codex-goals/adult-catalog-site-build-evaluation-v1/siteforge-adult-catalog-evaluation.md`
- 全站最低总分：100。
- 硬性封顶审计：未触发。
