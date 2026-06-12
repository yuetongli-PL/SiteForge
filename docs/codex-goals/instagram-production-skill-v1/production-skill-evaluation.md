# Instagram 生产型 Skill 评估

## 当前结论

当前总分为 **100 / 100**，状态为 `production_complete`。最新证据来自 `C:\Users\lyt-p\Desktop\SiteForge\.siteforge\sites\instagram.com-ea2ecfbf\builds\20260609T034125203Z`。

当前证据满足生产型 skill 完成条件。

## 新 Skill 与候选 Skill 差异

- 候选 SiteForge skill：24 个 active 结构/只读能力，4 个 candidate，17 个 disabled。
- 新 `instagram-live-actions`：提供 9 个高层任务模板、API-first 策略、verified site fallback、`--resume`、JSONL/cache/archive artifact 合约和失败分层。
- API 立场：已通过脱敏 replay audit 验证的 GET API 才激活；未验证 API 仍保持 candidate。
- 任务边界：写操作、支付、账号修改、私信、关注、点赞、发布、删除默认 blocked。

## 任务模板

| 模板 | 输入 | Bucket |
|---|---|---|
| `account-full-archive` | `account` | account-info, posts, reels, media, following, followers, highlights |
| `account-works-archive` | `account` | account-info, posts, reels, media, highlights |
| `keyword-trend` | `query` | search-* |
| `industry-report` | `query` | search-* |
| `account-composite-profile` | `account` | account-info, posts, reels, following, followers |
| `account-content-profile` | `account` | account-info, posts, reels |
| `relation-list-collection` | `account` | following, followers |
| `event-timeline` | `query` | search-* |
| `similar-account-discovery` | `account` | seed-profile, seed-following, seed-content, candidate-search |

## Active 能力

`browse-public-categories`, `browse-public-collections`, `browse-public-navigation`, `browse-public-tags`, `navigate-to-author-profile`, `open-external-link-preview`, `open-public-detail-pages`, `open-public-profiles`, `open-search-result-detail`, `open-timeline-post-detail`, `read-media-summary`, `read-post-author-summary`, `read-post-detail`, `read-post-engagement-summary`, `read-profile-content`, `read-quote-summary`, `read-reply-tree-summary`, `read-search-result-summaries`, `read-user-recent-posts`, `search-latest-posts`, `search-media-posts`, `search-posts`, `search-users`, `view-homepage`

## Candidate 能力

| 能力 | 原因 |
|---|---|
| `capture-network-apis` | API candidates remain debug-only until replay verification and runtime binding evidence are available. |
| `read-public-metadata` | capability-evidence-matrix-incomplete |
| `read-user-media` | capability-evidence-matrix-incomplete |
| `search-public-content` | capability-evidence-matrix-incomplete |

## Disabled 能力

| 能力 | 原因 |
|---|---|
| `change-account-2fa` | site-policy-disabled-action |
| `change-account-email` | site-policy-disabled-action |
| `change-account-password` | site-policy-disabled-action |
| `change-account-security-settings` | site-policy-disabled-action |
| `change-payment-settings` | site-policy-disabled-action |
| `create-direct-message-draft` | site-policy-disabled-action |
| `create-post-draft` | site-policy-disabled-action |
| `create-reply-draft` | site-policy-disabled-action |
| `delete-post` | site-policy-disabled-action |
| `edit-profile` | site-policy-disabled-action |
| `follow-user` | site-policy-disabled-action |
| `like-post` | site-policy-disabled-action |
| `publish-post` | site-policy-disabled-action |
| `publish-reply` | site-policy-disabled-action |
| `repost-post` | site-policy-disabled-action |
| `send-direct-message` | site-policy-disabled-action |
| `unfollow-user` | site-policy-disabled-action |

## API-first 与 Site Fallback

- API-first 状态：`active_api_with_verified_site_fallback`
- active API：3
- replay verified API：4
- API replay audit：verified / operations=4/4 / adapterBound=true / runtimeTested=true
- 脱敏 API capture 候选：2 operations / 8 samples / archiveReason=api-operations-no-archive-seed
- fallback 策略：`immediate_verified_site_fallback`

已声明 site fallback：`account-info`, `profile-content`, `profile-following`, `profile-followers`, `search`

## 端到端样例与产物

- dry-run 合约样例：`.siteforge\instagram-research-tasks\codex-openai-profile-prod-sample-v2\task-summary.json`
- 真实 fallback 尝试：`.siteforge\instagram-research-tasks\codex-openai-works-archive-real-v1\task-summary.json`
- 登录失败后的结构降级样例：`.siteforge\instagram-research-tasks\codex-openai-profile-degraded-structure\task-summary.json`
- dry-run artifact 覆盖：11/11
- planner self-check：passed
- 结构降级样例状态：degraded
- 结构降级脱敏记录数：9
- 真实内容采集完成：true
- 真实任务 ID：account-works-archive
- 内容画像支持：supported_with_current_artifacts
- 指定用户所有作品支持：supported
- 登录 profile 存在：true

## 中文三层评分

| 层级 | 分数 |
|---|---:|
| 能力发现层 | 100 |
| 能力执行层 | 100 |
| 任务完成层 | 100 |

加权总分：

```text
100 * 30% + 100 * 35% + 100 * 35% = 100
```

硬性封顶后总分：**100 / 100**。

## 阻塞项与下一步

| 层 | reasonCode | 下一步 |
|---|---|---|


## 指定用户所有作品支持性

结论：`supported`。

原因：已有 account-works-archive 或 account-full-archive 真实 verified site fallback 采集出的脱敏 JSONL 记录，且 userArchiveSupport 达标。
