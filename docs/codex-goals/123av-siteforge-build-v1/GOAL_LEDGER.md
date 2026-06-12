# 123av SiteForge Build V1

## 目标

对 `https://123av.com/zh/dm9` 执行 SiteForge 构建，要求：

- 先配置 `config/site-registry.json` 与 `config/site-capabilities.json`。
- 使用 `123av` 专属 SiteAdapter，不回退到 generic adapter。
- 生成站点 build skill 产物。
- 按能力发现层、能力执行层、任务完成层做中文评估。
- 最终总分必须达到 100，且不得触发硬性封顶或不合格条件。

## 站点标注

| 字段 | 值 |
|---|---|
| Requested URL | `https://123av.com/zh/dm9` |
| Host | `123av.com` |
| Site Key | `123av` |
| Adapter | `123av` |
| Expected Type | `catalog-detail` |
| Access Mode | public read-only |

## 能力边界

允许：

- 打开公开目录页。
- 打开公开影片详情页模板。
- 打开演员索引或演员页模板。
- 使用公开搜索入口。
- 打开公开合规/帮助类页面。

禁止：

- 登录、cookie、凭据、会话复用。
- 下载、媒体解析、播放资源解析、上传。
- 发布、提交、删除、支付、账号变更、私信。
- 把影片标题、简介、评论、正文、推荐语、缩略图文本或页面碎片提升为能力。
- 在报告、skill 或能力字段中复制敏感页面材料。
- 声明未观察且未由适配器验证的程序接口能力。

## 三层评估

| 层级 | 权重 | 完成门槛 |
|---|---:|---|
| 能力发现层 | 30 | 100 |
| 能力执行层 | 35 | 100 |
| 任务完成层 | 35 | 100 |

最终总分：

```text
总分 =
能力发现层分 × 30%
+ 能力执行层分 × 35%
+ 任务完成层分 × 35%
```

## 硬性封顶

| 问题 | 总分封顶 |
|---|---:|
| 正文、简介、评论、章节内容被提升为能力 | 60 |
| 只读内容被误判为发布、提交、删除、支付 | 65 |
| 虚构程序接口能力 | 70 |
| active 能力大量没有执行计划 | 75 |
| 无法解释失败原因 | 80 |
| 敏感材料进入报告、技能或能力字段 | 不合格 |

## 完成证据

完成必须包含：

- `config/site-registry.json` 中存在 `123av.com`。
- `config/site-capabilities.json` 中存在 `123av.com`。
- `src/sites/adapters/123av.mjs` 专属适配器存在并通过契约测试。
- `src/sites/adapters/resolver.mjs` 可解析 `123av.com` 到 `123av`。
- Fresh SiteForge build artifact path。
- Fresh generated `skill.yaml` path。
- 中文三层评估报告，总分 100。
- `node --check`、目标 Node tests、README 生成/检查、secret scan、diff check 通过。

## 状态

- Phase 0: complete.
- Implementation: complete.
- Build/evaluation: complete.
- Final score: 100.
- Latest build: `.siteforge/sites/123av.com-a26d204b/builds/20260608T174124059Z`.
- Evaluation report: `docs/codex-goals/123av-siteforge-build-v1/evaluation-report.md`.
