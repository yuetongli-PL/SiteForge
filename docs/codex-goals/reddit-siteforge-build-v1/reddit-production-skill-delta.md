# Reddit 生产型 Skill 差异与能力报告

生成时间: 2026-06-09T09:48:26.098Z

## 新 Skill 与候选 Skill 的能力差异

| 维度 | 候选 skill | 生产型 skill | 当前证据状态 |
| --- | --- | --- | --- |
| 能力粒度 | 只读结构摘要/能力清单 | 6 个高层任务模板，面向归档、趋势、画像、发现、时间线、登录态结构归档 | 已实现 |
| 程序接口 | OAuth/API 发现但未 active | 3 个公开 Atom feed API family，18 个 bucket surface 已 runtime tested | 公开任务已 active；OAuth JSON/API 仍 candidate |
| 执行策略 | 页面 fallback 为主 | API-first + verified site fallback；失败不等待 cooldown | 已实现 |
| Artifact | route summary 为主 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md；公开 item 含 contentText/contentTextLength/contentTextTruncated | 已实现 |
| 失败解释 | 粗略失败 | 区分 planner/api_auth/api/rate_limit/permission/selector/site_policy/network_security/empty feed | 已实现 |
| 安全边界 | 只读边界 | mutation/pay/account/private raw body 默认 blocked；公开正文只保存 sanitized text；私有 saved/history 需要 --allow-private-content 且只写白名单字段；不持久化 cookie/token/auth header/browser profile/raw feed/raw HTML | 已实现 |

核心结论: Reddit skill 已从结构摘要升级为可执行、可恢复、可产出公开 item-level JSONL 和 sanitized contentText 的生产型只读 skill；但不能确认总分 100，因为 OAuth JSON/API replay 和私有 saved/history 内容采集仍无可安全验证执行证据。

## 新增或改造的任务模板

| 任务 | 输入 | 说明 | 执行命令 | Resume | Artifact 合约 |
| --- | --- | --- | --- | --- | --- |
| subreddit-full-archive | subreddit | 归档一个 subreddit 的公开 feed、hot/new/rising、站内搜索和 about/profile 摘要，并保存 feed 提供的 sanitized contentText。 | node scripts/reddit-research-task-runner.mjs --task subreddit-full-archive --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |
| keyword-trend | query | 围绕关键词收集公开搜索结果正文，并从结果中派生社区、作者和趋势分析字段。 | node scripts/reddit-research-task-runner.mjs --task keyword-trend --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |
| redditor-profile | account | 为一个公开 redditor 构建 profile、submitted、comments 和公开 activity 正文画像。 | node scripts/reddit-research-task-runner.mjs --task redditor-profile --account <account> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |
| community-discovery | query | 从公开搜索 feed 中发现相关社区、作者和候选关系，不虚构 subreddit search API。 | node scripts/reddit-research-task-runner.mjs --task community-discovery --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |
| event-timeline | query | 用 latest 和 relevance 搜索 bucket 重建公开事件时间线。 | node scripts/reddit-research-task-runner.mjs --task event-timeline --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |
| saved-history-archive | none | 登录态 saved/subscribed 归档：优先受控 OAuth saved/subreddits GET candidate；缺 token、权限、未验证或缺少 --allow-private-content 时立即 fallback 到结构归档。私有正文仅在显式授权和字段白名单下保存 sanitized item，raw private body 不采集、不持久化。 | node scripts/reddit-research-task-runner.mjs --task saved-history-archive --collection-mode api-first --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json | 复用 task-state.json，跳过已完成 bucket，失败 bucket 记录 layer/reason/remediation 后可恢复。 | task-plan.json, task-state.json, task-summary.json, task-report.md, raw-items.jsonl, deduped-items.jsonl, items.jsonl, communities.jsonl, accounts.jsonl, authors.jsonl, cache-index.json, cache-index.jsonl, media-assets.json, media-assets.jsonl, archive/*.md |

## Active / Candidate / Disabled 能力清单

| 状态 | ID | 名称 | 原因 |
| --- | --- | --- | --- |
| active API/programmatic | reddit-public-search-atom-feed | search public Atom feed surfaces | 公开 Atom/RSS feed 已由 task runner replay verified、adapter bound、runtime tested；保存 sanitized contentText 与结构字段，不保存 raw feed 或 HTML。 |
| active API/programmatic | reddit-public-subreddit-atom-feed | subreddit public Atom feed surfaces | 公开 Atom/RSS feed 已由 task runner replay verified、adapter bound、runtime tested；保存 sanitized contentText 与结构字段，不保存 raw feed 或 HTML。 |
| active API/programmatic | reddit-public-user-atom-feed | redditor public Atom feed surfaces | 公开 Atom/RSS feed 已由 task runner replay verified、adapter bound、runtime tested；保存 sanitized contentText 与结构字段，不保存 raw feed 或 HTML。 |
| active site fallback | capability:reddit.com-14830d0f:list-notifications | list notifications | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:list-recommended-timeline-posts | list recommended timeline posts | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:navigate-to-author-profile | navigate to author profile | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:open-authenticated-configured-routes | open authenticated configured routes | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:open-authenticated-overlay-routes | open authenticated overlay routes | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:open-external-link-preview | open external link preview | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:open-search-result-detail | open search result detail | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:open-timeline-post-detail | open timeline post detail | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-post-author-summary | read post author summary | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-post-detail | read post detail | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-post-engagement-summary | read post engagement summary | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-profile-content | read profile content | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-quote-summary | read quote summary | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-reply-tree-summary | read reply tree summary | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-search-result-summaries | read search result summaries | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-timeline-post-summaries | read timeline post summaries | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-user-media | read user media | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-user-recent-posts | read user recent posts | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:read-user-replies | read user replies | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:search-latest-posts | search latest posts | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:search-media-posts | search media posts | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:search-posts | search posts | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:search-users | search users | active governed read-only site fallback capability |
| active site fallback | capability:reddit.com-14830d0f:view-homepage | view homepage | active governed read-only site fallback capability |
| candidate | reddit-oauth-get-read-templates | Reddit OAuth GET read templates | 官方 OAuth GET/API 模板已发现并被专属适配器接受，但当前网络/OAuth replay 返回 Reddit network security block，不能标记 active。 |
| candidate | reddit-private-saved-history-content | private saved/history content archive | 登录态 route 结构已验证；runner 已有 --allow-private-content 显式授权门禁和最小字段白名单，但当前缺 OAuth/runtime replay proof，保持 candidate 边界。 |
| candidate | capability:reddit.com-14830d0f:capture-network-apis | capture network APIs | API candidates remain debug-only until replay verification and runtime binding evidence are available. |
| candidate | capability:reddit.com-14830d0f:read-media-summary | read media summary | not-selected-by-setup |
| disabled | capability:reddit.com-14830d0f:change-account-2fa | change account 2fa | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:change-account-email | change account email | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:change-account-password | change account password | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:change-account-security-settings | change account security settings | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:change-payment-settings | change payment settings | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:create-direct-message-draft | create direct message draft | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:create-post-draft | create post draft | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:create-reply-draft | create reply draft | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:delete-post | delete post | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:edit-profile | edit profile | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:follow-user | follow user | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:like-post | like post | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:publish-post | publish post | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:publish-reply | publish reply | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:repost-post | repost post | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:send-direct-message | send direct message | site-policy-disabled-action |
| disabled | capability:reddit.com-14830d0f:unfollow-user | unfollow user | site-policy-disabled-action |

## API-first 与 Site Fallback 策略

1. 同一意图优先使用 replay verified / adapter bound / runtime tested 的公开 Atom feed。
2. OAuth GET/API 模板保持 candidate；只有从允许网络和运行时凭证 replay 成功后才可提升 active。
3. feed/OAuth 缺凭证、HTTP 403、rate limit、permission、空结果或本地执行失败时，立即切换 verified Browser Bridge fallback，不等待 cooldown。
4. Active public feed 输出保存 sanitized contentText；saved/history OAuth candidate 只有在 `--allow-private-content` 和白名单治理下才允许 sanitized private item-level 输出。
5. Fallback 只保存 sanitized structure summary，不得把 descriptor-only 结构摘要描述为完整内容采集。
6. 写操作、支付、账号修改、私信、关注、点赞、发布、删除和 raw private body 默认 disabled/blocked。

## 端到端任务样例及产物路径

| 样例 | 任务 | 状态 | Bucket | API bucket | Fallback bucket | Descriptor-only | deduped items | 产物目录 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 自然语言 keyword-trend | keyword-trend | completed | 3/3 | 3 | 0 | 0 | 28 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-nl-task-sample |
| subreddit 全量归档 | subreddit-full-archive | completed | 6/6 | 6 | 0 | 0 | 126 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-feed-task-sample |
| redditor 画像 | redditor-profile | completed | 4/4 | 4 | 0 | 0 | 76 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-redditor-task-sample |
| community discovery | community-discovery | completed | 3/3 | 3 | 0 | 0 | 26 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-community-task-sample |
| event timeline | event-timeline | completed | 2/2 | 2 | 0 | 0 | 18 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-timeline-task-sample |
| saved/history 登录态结构归档 | saved-history-archive | completed | 2/2 | 0 | 2 | 7 | 7 | docs\codex-goals\reddit-siteforge-build-v1\evidence\reddit-production-saved-history-task-sample |

## 中文三层评分

- 能力发现层: 99.8
- 能力执行层: 99.6
- 任务完成层: 99
- 总分: 99.45

详细评分见 `docs\codex-goals\reddit-siteforge-build-v1\reddit-production-three-layer-evaluation.md`。

## 未达 100 的阻塞项和迭代计划

1. OAuth JSON/API replay verified count remains 0
   - 证据: reddit-public-json-replay-report.json 显示 reddit-network-security-blocked，公共 JSON 与 oauth.reddit.com 样例均为 HTTP 403 text/html。
   - 下一步: 从允许访问 Reddit JSON/OAuth API 的网络或提供运行时 OAuth inputs 后重新 replay；只提升 replay verified / adapter bound / runtime tested 的 GET 操作。
2. 登录态 saved/history 内容采集未开放
   - 证据: 公开 feed 样例已保存 sanitized contentText；runner 已实现 --allow-private-content 白名单门禁；auth crawl 与 saved-history 当前样例仍只保存 sanitized structure summary；raw private body/private content persisted=false。
   - 下一步: 如需私有 saved/history item-level archive，需要运行时 OAuth token/User-Agent、用户明确授权 --allow-private-content、最小字段白名单、redaction contract 和单独 runtime proof。
