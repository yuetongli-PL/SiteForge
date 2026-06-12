# Reddit Live Catalog

生成时间: 2026-06-09T09:48:26.098Z

## 结论

- Active programmatic API family: 3
- Active programmatic bucket surface: 18
- Active site fallback: 24
- Candidate: 4
- Disabled mutation/risk: 17
- 三层总分: 99.45 / 100
- 100 分复核: 公开 feed 正文 contentText 已解决；OAuth JSON/API replay 仍 blocked，登录态 saved/history 只能安全执行结构归档；因此不能声称总分 100。

## Active / Candidate / Disabled

| 状态 | ID | 名称 | 原因/范围 |
| --- | --- | --- | --- |
| active API | reddit-public-search-atom-feed | search public Atom feed surfaces | surfaces=8; endpoints=4 |
| active API | reddit-public-subreddit-atom-feed | subreddit public Atom feed surfaces | surfaces=6; endpoints=5 |
| active API | reddit-public-user-atom-feed | redditor public Atom feed surfaces | surfaces=4; endpoints=3 |
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

## Task Templates

| 任务 | 输入 | 说明 | 执行命令 |
| --- | --- | --- | --- |
| subreddit-full-archive | subreddit | 归档一个 subreddit 的公开 feed、hot/new/rising、站内搜索和 about/profile 摘要，并保存 feed 提供的 sanitized contentText。 | node scripts/reddit-research-task-runner.mjs --task subreddit-full-archive --subreddit <subreddit> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |
| keyword-trend | query | 围绕关键词收集公开搜索结果正文，并从结果中派生社区、作者和趋势分析字段。 | node scripts/reddit-research-task-runner.mjs --task keyword-trend --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |
| redditor-profile | account | 为一个公开 redditor 构建 profile、submitted、comments 和公开 activity 正文画像。 | node scripts/reddit-research-task-runner.mjs --task redditor-profile --account <account> --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |
| community-discovery | query | 从公开搜索 feed 中发现相关社区、作者和候选关系，不虚构 subreddit search API。 | node scripts/reddit-research-task-runner.mjs --task community-discovery --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |
| event-timeline | query | 用 latest 和 relevance 搜索 bucket 重建公开事件时间线。 | node scripts/reddit-research-task-runner.mjs --task event-timeline --query "<query>" --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |
| saved-history-archive | none | 登录态 saved/subscribed 归档：优先受控 OAuth saved/subreddits GET candidate；缺 token、权限、未验证或缺少 --allow-private-content 时立即 fallback 到结构归档。私有正文仅在显式授权和字段白名单下保存 sanitized item，raw private body 不采集、不持久化。 | node scripts/reddit-research-task-runner.mjs --task saved-history-archive --collection-mode api-first --out-dir .siteforge/reddit-research-tasks/<run-id> --execute --resume --json |

## Evidence

- Public feed replay: docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-public-feed-replay-report.json
- Public JSON/OAuth replay: docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-public-json-replay-report.json
- Runner: scripts/reddit-research-task-runner.mjs
- Tests: tests/node/reddit-research-task-runner.test.mjs
