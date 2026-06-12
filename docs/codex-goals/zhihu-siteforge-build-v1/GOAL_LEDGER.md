# Zhihu SiteForge Build Goal Ledger

## 目标

对 `https://www.zhihu.com/` 执行 SiteForge 构建：先配置 `config/site-registry.json` 和 `config/site-capabilities.json`，按需要登录态的社交内容站处理，构建 Zhihu 专属适配器和只读 runtime provider，生成 Zhihu 站点 skill，并按能力发现层、能力执行层、任务完成层做中文评估。最终总分必须达到 100。

本轮追加目标：补齐用户点名的热播、每个分类话题下的讨论/精华、每个用户的动态/回答/提问/文章/专栏/想法/收藏/视频、用户关注列表，并解释这些能力是否已独立提升。

## 当前最终状态

- 状态：完成。
- 主构建：`.siteforge/sites/zhihu.com-c98e39a3/builds/zhihu-comprehensive-coverage-v17/`
- SiteForge skill：`.siteforge/sites/zhihu.com-c98e39a3/builds/zhihu-comprehensive-coverage-v17/skill/`
- 覆盖审计：`docs/codex-goals/zhihu-siteforge-build-v1/zhihu-v17-v18-coverage-audit.json`
- Codex skill：`C:\Users\lyt-p\.codex\skills\zhihu-live-actions\SKILL.md`
- 代表任务：21 个任务构建全部 `completed`，其中用户关注列表以 `zhihu-comprehensive-task-user-following-v18` 为最终证据。
- 最终评分：100。

## 覆盖模型

| 项目 | 当前值 |
|---|---:|
| authRoutes | 23 |
| authenticatedPages | 24 |
| supportedIntents | 34 |
| publicRouteTemplates | 20 |
| capabilities | 52 total, 37 active, 4 candidate, 11 disabled |
| executionPlans | 37 |
| executionContracts | 37 |
| intents | 116 |
| representativeTasks | 21 |

## 用户点名能力状态

| 用户说法 | SiteForge 能力 | 路由/模板 | 状态 |
|---|---|---|---|
| 热播 | `list hot broadcasts` | `/drama/feed` | active + completed |
| 分类话题讨论 | `list topic discussions` | `/topic/{topic_id}/hot` | active + completed |
| 分类话题精华 | `list topic featured` | `/topic/{topic_id}/top-answers` | active + completed |
| 用户动态 | `list user activities` | `/people/{account}/activities` | active + completed |
| 用户回答 | `list user answers` | `/people/{account}/answers` | active + completed |
| 用户提问 | `list user questions` | `/people/{account}/asks` | active + completed |
| 用户文章 | `list user articles` | `/people/{account}/posts` | active + completed |
| 用户专栏 | `list user columns` | `/people/{account}/columns` | active + completed |
| 用户想法 | `list user pins` | `/people/{account}/pins` | active + completed |
| 用户收藏 | `list user collections` | `/people/{account}/collections` | active + completed |
| 用户视频 | `list user videos` | `/people/{account}/zvideos` | active + completed |
| 用户关注列表 | `list user following` | `/people/{account}/following` | active + completed |

## 关键实现

- `config/site-registry.json` / `config/site-capabilities.json` 增加热播、话题讨论/精华、用户 profile tab 和关注列表的 seed、route template、capability id。
- `src/sites/adapters/zhihu.mjs` 识别 Zhihu 话题页、媒体页、作者列表页和热播入口。
- `src/app/pipeline/build/auto-capabilities.mjs`、`pipeline.mjs`、`execution-governance.mjs` 生成新增 active 能力、slot、计划、contract 和 provider 绑定。
- `src/app/runtime/providers/zhihu-readonly-provider.mjs` 通过 `zhihu_readonly_provider` 执行受控只读 GET，并输出脱敏摘要。
- `tools/run-zhihu-comprehensive-goal.mjs` 可复现 v17 主构建和 21 个代表任务；支持过滤重跑单个任务。

## 代表任务执行

| 任务 | 构建目录 | Runtime | Provider | Outcome |
|---|---|---|---|---|
| `list recommended timeline posts` | `zhihu-comprehensive-task-recommended-v17` | completed | `zhihu_readonly_provider` | `zhihu_feed_read_completed` |
| `list followed users` | `zhihu-comprehensive-task-followed-users-v17` | completed | `zhihu_readonly_provider` | `zhihu_followed_users_read_completed` |
| `list hot posts` | `zhihu-comprehensive-task-hot-v17` | completed | `zhihu_readonly_provider` | `zhihu_hot_posts_read_completed` |
| `list hot broadcasts` | `zhihu-comprehensive-task-hot-broadcasts-v17` | completed | `zhihu_readonly_provider` | `zhihu_hot_broadcasts_read_completed` |
| `list topic discussions` | `zhihu-comprehensive-task-topic-discussions-v17` | completed | `zhihu_readonly_provider` | `zhihu_topic_discussions_read_completed` |
| `list topic featured` | `zhihu-comprehensive-task-topic-featured-v17` | completed | `zhihu_readonly_provider` | `zhihu_topic_featured_read_completed` |
| `search posts` | `zhihu-comprehensive-task-search-posts-v17` | completed | `zhihu_readonly_provider` | `zhihu_search_read_completed` |
| `search users` | `zhihu-comprehensive-task-search-users-v17` | completed | `zhihu_readonly_provider` | `zhihu_search_read_completed` |
| `list notifications` | `zhihu-comprehensive-task-notifications-v17` | completed | `zhihu_readonly_provider` | `zhihu_notifications_read_completed` |
| `read profile content` | `zhihu-comprehensive-task-profile-v17` | completed | `zhihu_readonly_provider` | `zhihu_profile_read_completed` |
| `list user activities` | `zhihu-comprehensive-task-user-activities-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_activities_read_completed` |
| `list user answers` | `zhihu-comprehensive-task-user-answers-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_answers_read_completed` |
| `list user questions` | `zhihu-comprehensive-task-user-questions-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_questions_read_completed` |
| `list user articles` | `zhihu-comprehensive-task-user-articles-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_articles_read_completed` |
| `list user columns` | `zhihu-comprehensive-task-user-columns-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_columns_read_completed` |
| `list user pins` | `zhihu-comprehensive-task-user-pins-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_pins_read_completed` |
| `list user collections` | `zhihu-comprehensive-task-user-collections-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_collections_read_completed` |
| `list user videos` | `zhihu-comprehensive-task-user-videos-v17` | completed | `zhihu_readonly_provider` | `zhihu_user_videos_read_completed` |
| `list user following` | `zhihu-comprehensive-task-user-following-v18` | completed | `zhihu_readonly_provider` | `zhihu_user_following_read_completed` |
| `view question detail` | `zhihu-comprehensive-task-question-v17` | completed | `zhihu_readonly_provider` | `zhihu_question_detail_read_completed` |
| `view answer detail` | `zhihu-comprehensive-task-answer-v17` | completed | `zhihu_readonly_provider` | `zhihu_answer_detail_read_completed` |

## 安全边界

- 写操作、发布、回复、删除、关注/取关、点赞、转发、编辑资料均为 disabled。
- `read notification body` 因私密正文风险 disabled。
- `capture network APIs` 保持 candidate；未把未验证接口提升为 active。
- 输出产物只保留结构证据、受控路径、provider outcome 和脱敏摘要，不持久化会话材料或原始正文。

## 验证命令

- `node --test tests/node/capability-intent-mapping.test.mjs tests/node/site-capability-config-lint.test.mjs tests/node/known-site-policy.test.mjs tests/node/app-runtime-production-providers.test.mjs tests/node/siteforge-auto-capabilities.test.mjs`
- `npm run readme:generate`
- `npm run readme:check`
- 敏感材料扫描：对报告、skill 和关键 build 目录执行受控标记扫描，结果应为无命中。
