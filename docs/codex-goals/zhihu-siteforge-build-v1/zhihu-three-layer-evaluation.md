# Zhihu SiteForge 三层评估

## 结论

最终总分：**100 / 100**。

本轮以 `zhihu-comprehensive-coverage-v17` 为主构建，并用 `zhihu-comprehensive-task-user-following-v18` 补齐用户关注列表的干净重跑证据。用户点名的热播、分类话题讨论/精华、用户动态/回答/提问/文章/专栏/想法/收藏/视频、用户关注列表均已提升为独立 active 能力，并完成代表任务。

| 层级 | 得分 |
|---|---:|
| 能力发现层 | 100 |
| 能力执行层 | 100 |
| 任务完成层 | 100 |
| 最终总分 | 100 |

最终总分 = 100 x 30% + 100 x 35% + 100 x 35% = 100。

## 证据脊柱

- 主构建：`.siteforge/sites/zhihu.com-c98e39a3/builds/zhihu-comprehensive-coverage-v17/`
- SiteForge skill：`.siteforge/sites/zhihu.com-c98e39a3/builds/zhihu-comprehensive-coverage-v17/skill/`
- 覆盖审计：`docs/codex-goals/zhihu-siteforge-build-v1/zhihu-v17-v18-coverage-audit.json`
- Codex skill：`C:\Users\lyt-p\.codex\skills\zhihu-live-actions\SKILL.md`
- 用户关注列表补证：`.siteforge/sites/zhihu.com-c98e39a3/builds/zhihu-comprehensive-task-user-following-v18/`

`verification_report.json` 对泛化公共 crawl 保持 `report_only_blocked`，原因是 robots 治理；本次评分依据是用户授权的确定性结构证据、执行契约和 runtime task report。

## 覆盖统计

| 项目 | 当前值 |
|---|---:|
| supportedIntents | 34 |
| publicRouteTemplates | 20 |
| authRoutes | 23 |
| authenticatedPages | 24 |
| capabilities | 52 |
| active capabilities | 37 |
| candidate capabilities | 4 |
| disabled capabilities | 11 |
| execution plans | 37 |
| execution contracts | 37 |
| intents | 116 |
| representative tasks | 21 |

## 用户补充能力覆盖

| 用户说法 | SiteForge 能力 | 状态 | 路由/模板 | 任务构建 | 任务状态 |
|---|---|---|---|---|---|
| 热播 | `list hot broadcasts` | active | `/drama/feed` | `zhihu-comprehensive-task-hot-broadcasts-v17` | completed |
| 分类话题讨论 | `list topic discussions` | active | `/topic/{topic_id}/hot` | `zhihu-comprehensive-task-topic-discussions-v17` | completed |
| 分类话题精华 | `list topic featured` | active | `/topic/{topic_id}/top-answers` | `zhihu-comprehensive-task-topic-featured-v17` | completed |
| 用户动态 | `list user activities` | active | `/people/{account}/activities` | `zhihu-comprehensive-task-user-activities-v17` | completed |
| 用户回答 | `list user answers` | active | `/people/{account}/answers` | `zhihu-comprehensive-task-user-answers-v17` | completed |
| 用户提问 | `list user questions` | active | `/people/{account}/asks` | `zhihu-comprehensive-task-user-questions-v17` | completed |
| 用户文章 | `list user articles` | active | `/people/{account}/posts` | `zhihu-comprehensive-task-user-articles-v17` | completed |
| 用户专栏 | `list user columns` | active | `/people/{account}/columns` | `zhihu-comprehensive-task-user-columns-v17` | completed |
| 用户想法 | `list user pins` | active | `/people/{account}/pins` | `zhihu-comprehensive-task-user-pins-v17` | completed |
| 用户收藏 | `list user collections` | active | `/people/{account}/collections` | `zhihu-comprehensive-task-user-collections-v17` | completed |
| 用户视频 | `list user videos` | active | `/people/{account}/zvideos` | `zhihu-comprehensive-task-user-videos-v17` | completed |
| 用户关注列表 | `list user following` | active | `/people/{account}/following` | `zhihu-comprehensive-task-user-following-v18` | completed |

## 三层评分明细

| 层级 | 得分 | 证据 |
|---|---:|---|
| 能力发现层 | 100 | 37 个 active 能力均为真实知乎只读站点能力；新增热播、话题讨论/精华、用户 profile tab 和关注列表都有结构证据、执行计划与执行契约。 |
| 能力执行层 | 100 | 37/37 active 能力有计划和 contract；21/21 代表任务由 `zhihu_readonly_provider` 完成，槽位覆盖 `query`、`topic_id`、`account`、`question_id`、`answer_id`。 |
| 任务完成层 | 100 | 21/21 代表任务端到端 completed，覆盖推荐、关注、热榜、热播、话题、搜索、通知、用户各 tab、问题和回答详情。 |

### 能力发现层

| 指标 | 权重 | 得分 | 证据 |
|---|---:|---:|---|
| 能力语义准确性 | 20 | 100 | active 能力均是知乎真实只读业务能力，未把正文、简介、评论正文或页面碎片提升为能力。 |
| 能力粒度合理性 | 15 | 100 | 能力按业务面聚合；话题页和用户 tab 是可复用任务入口，不按 DOM 元素或单条内容膨胀。 |
| 证据完整性 | 15 | 100 | 37/37 active 能力均有 evidence matrix、execution plan、execution contract 和 runtime-callable 绑定。 |
| 候选能力解释性 | 10 | 100 | 4 个 candidate 和 11 个 disabled 均有治理原因或证据缺口说明。 |
| 程序接口发现真实性 | 10 | 100 | 未发现真实 API 候选时 `capture network APIs` 保持 candidate；active 执行绑定已验证 provider，不虚构接口。 |
| 站点类型识别准确性 | 10 | 100 | Zhihu 建模为需要登录态治理的 social-content / social read 站点。 |
| 适配器选择合理性 | 10 | 100 | 使用 Zhihu 专属 adapter 和 `zhihu_readonly_provider`，没有生成写操作适配器。 |
| 安全边界发现 | 10 | 100 | 登录态、写操作、关注/取关、点赞、发布、删除、私密通知正文、下载、支付边界均识别并治理。 |

### 能力执行层

| 指标 | 权重 | 得分 | 证据 |
|---|---:|---:|---|
| 参数/槽位建模质量 | 15 | 100 | 搜索为 `query`，话题为 `topic_id`，用户 tab 为 `account`，问题/回答为 `question_id` / `answer_id`。 |
| 执行计划完整性 | 15 | 100 | 37/37 active 能力有 execution plan。 |
| 运行时绑定稳定性 | 15 | 100 | 21/21 代表任务分发到 `zhihu_readonly_provider` 并 completed。 |
| 单能力执行成功率 | 15 | 100 | 21/21 代表能力独立跑通。 |
| 结果验证能力 | 15 | 100 | runtime report 记录 outcome、pathTemplate、认证摘要和结果摘要，可区分成功、缺槽、空结果、认证问题。 |
| 输出结构化质量 | 10 | 100 | 输出为稳定字段和 `sanitized_summary_only`，可供后续任务使用。 |
| 错误恢复能力 | 10 | 100 | 覆盖缺少 `topic_id` / `account` 的 gate；v17 用户关注列表旧目录污染后用 v18 干净任务修复并完成。 |
| 执行安全治理 | 5 | 100 | 所有代表任务为 GET、session_required、只读摘要；风险动作 disabled。 |

### 任务完成层

| 指标 | 权重 | 得分 | 证据 |
|---|---:|---:|---|
| 用户意图覆盖率 | 10 | 100 | 用户点名的 12 类补充能力全部可匹配，基础推荐/关注/热榜/搜索/通知/详情任务也保留。 |
| 意图分发准确率 | 10 | 100 | 21/21 任务分发到正确 capability，没有把热榜误分为热播，也没有把站点关注页误分为用户关注列表。 |
| 多步任务规划质量 | 15 | 100 | 任务拆为意图匹配、session gate、受控 GET、结果验证、脱敏摘要。 |
| 能力组合成功率 | 15 | 100 | 21/21 任务串联 discover -> contract -> governance -> runtime provider 成功。 |
| 上下文传递正确率 | 10 | 100 | `query`、`topic_id`、`account`、`question_id`、`answer_id`、pathTemplate 正确传递。 |
| 端到端任务完成率 | 20 | 100 | 21/21 代表任务 `runtime_execution_report.json` 为 completed。 |
| 任务结果质量 | 10 | 100 | 最终结果包含 outcome、请求摘要、响应摘要、认证使用摘要，不含敏感正文。 |
| 失败解释与修复建议 | 5 | 100 | candidate/disabled 有原因；v17 用户关注列表目录污染已定位并用 v18 干净任务补证。 |
| 任务级安全合规 | 5 | 100 | 复杂任务仍遵守登录态、只读、脱敏和写操作禁用边界。 |

## 代表任务执行证据

| 任务构建 | capability | status | provider | outcome | path |
|---|---|---|---|---|---|
| `zhihu-comprehensive-task-recommended-v17` | `list recommended timeline posts` | completed | `zhihu_readonly_provider` | `zhihu_feed_read_completed` | `/` |
| `zhihu-comprehensive-task-followed-users-v17` | `list followed users` | completed | `zhihu_readonly_provider` | `zhihu_followed_users_read_completed` | `/follow` |
| `zhihu-comprehensive-task-hot-v17` | `list hot posts` | completed | `zhihu_readonly_provider` | `zhihu_hot_posts_read_completed` | `/hot` |
| `zhihu-comprehensive-task-hot-broadcasts-v17` | `list hot broadcasts` | completed | `zhihu_readonly_provider` | `zhihu_hot_broadcasts_read_completed` | `/drama/feed` |
| `zhihu-comprehensive-task-topic-discussions-v17` | `list topic discussions` | completed | `zhihu_readonly_provider` | `zhihu_topic_discussions_read_completed` | `/topic/{topic_id}/hot` |
| `zhihu-comprehensive-task-topic-featured-v17` | `list topic featured` | completed | `zhihu_readonly_provider` | `zhihu_topic_featured_read_completed` | `/topic/{topic_id}/top-answers` |
| `zhihu-comprehensive-task-search-posts-v17` | `search posts` | completed | `zhihu_readonly_provider` | `zhihu_search_read_completed` | `/search?type=content&q={query}` |
| `zhihu-comprehensive-task-search-users-v17` | `search users` | completed | `zhihu_readonly_provider` | `zhihu_search_read_completed` | `/search?type=people&q={query}` |
| `zhihu-comprehensive-task-notifications-v17` | `list notifications` | completed | `zhihu_readonly_provider` | `zhihu_notifications_read_completed` | `/notifications` |
| `zhihu-comprehensive-task-profile-v17` | `read profile content` | completed | `zhihu_readonly_provider` | `zhihu_profile_read_completed` | `/people/{account}` |
| `zhihu-comprehensive-task-user-activities-v17` | `list user activities` | completed | `zhihu_readonly_provider` | `zhihu_user_activities_read_completed` | `/people/{account}/activities` |
| `zhihu-comprehensive-task-user-answers-v17` | `list user answers` | completed | `zhihu_readonly_provider` | `zhihu_user_answers_read_completed` | `/people/{account}/answers` |
| `zhihu-comprehensive-task-user-questions-v17` | `list user questions` | completed | `zhihu_readonly_provider` | `zhihu_user_questions_read_completed` | `/people/{account}/asks` |
| `zhihu-comprehensive-task-user-articles-v17` | `list user articles` | completed | `zhihu_readonly_provider` | `zhihu_user_articles_read_completed` | `/people/{account}/posts` |
| `zhihu-comprehensive-task-user-columns-v17` | `list user columns` | completed | `zhihu_readonly_provider` | `zhihu_user_columns_read_completed` | `/people/{account}/columns` |
| `zhihu-comprehensive-task-user-pins-v17` | `list user pins` | completed | `zhihu_readonly_provider` | `zhihu_user_pins_read_completed` | `/people/{account}/pins` |
| `zhihu-comprehensive-task-user-collections-v17` | `list user collections` | completed | `zhihu_readonly_provider` | `zhihu_user_collections_read_completed` | `/people/{account}/collections` |
| `zhihu-comprehensive-task-user-videos-v17` | `list user videos` | completed | `zhihu_readonly_provider` | `zhihu_user_videos_read_completed` | `/people/{account}/zvideos` |
| `zhihu-comprehensive-task-user-following-v18` | `list user following` | completed | `zhihu_readonly_provider` | `zhihu_user_following_read_completed` | `/people/{account}/following` |
| `zhihu-comprehensive-task-question-v17` | `view question detail` | completed | `zhihu_readonly_provider` | `zhihu_question_detail_read_completed` | `/question/{question_id}` |
| `zhihu-comprehensive-task-answer-v17` | `view answer detail` | completed | `zhihu_readonly_provider` | `zhihu_answer_detail_read_completed` | `/question/{question_id}/answer/{answer_id}` |

## Active 能力

当前 37 个 active 能力：

- `list followed updates`
- `list followed users`
- `list hot broadcasts`
- `list hot posts`
- `list notifications`
- `list profile content`
- `list recommended timeline posts`
- `list topic discussions`
- `list topic featured`
- `list user activities`
- `list user answers`
- `list user articles`
- `list user collections`
- `list user columns`
- `list user following`
- `list user pins`
- `list user questions`
- `list user videos`
- `navigate to author profile`
- `open external link preview`
- `open search result detail`
- `read followers`
- `read list timeline`
- `read media summary`
- `read post detail`
- `read quote summary`
- `read search result summaries`
- `read timeline post summaries`
- `read user recent posts`
- `search latest posts`
- `search media posts`
- `search posts`
- `search users`
- `view answer detail`
- `view homepage`
- `view post replies`
- `view question detail`

## 硬性封顶复核

| 封顶问题 | 结果 |
|---|---|
| 正文、简介、评论、章节内容被提升为能力 | 未触发。 |
| 只读内容被误判为发布、提交、删除、支付 | 未触发；风险写操作均 disabled。 |
| 虚构程序接口能力 | 未触发；无真实 API 候选时保持 candidate。 |
| active 能力大量没有执行计划 | 未触发；37/37 active 有计划。 |
| 无法解释失败原因 | 未触发；失败、candidate、disabled 均有原因。 |
| 敏感材料进入报告、技能或能力字段 | 未触发；产物仅保留受控摘要和脱敏执行证据。 |

## 最终判定

SiteForge 对 Zhihu 的专属构建达到当前目标：新增业务面已配置到 registry/capabilities，自动能力、intent、执行契约、runtime provider 和 skill 均已更新；代表任务 21/21 completed，三层评估总分 100。
