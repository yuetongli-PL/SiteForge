# X Live Actions 三层评分报告

生成时间: 2026-06-09T13:03:43.233Z

## 结论

- 能力发现层: 100/100
- 能力执行层: 100/100
- 任务完成层: 100/100
- 总分: 100/100
- 是否达到 100: 是

## 证据摘要

- surface/capability: 117
- verified API surface: 51
- verified site fallback: 117
- read-replay eligible API operation: 32
- latest local report override: .siteforge\x-live-report-20260608T171837\social-live-report.json
- activeRateLimitBlocker: false
- catalog statuses: {"blocked":7,"degraded":141,"bounded":6,"unknown":13,"passed":115,"failed":2,"stale":5}
- planner 自检: 40/40
- historical manifest evidence available: 0/117
- sanitized surface evidence complete: 117/117
- API authenticity: verified API 51, fallback-only 66, fabricated verified API 0
- historical manifest missing roots: .siteforge/x-live-runs-20260529T1605=0/82; .siteforge/x-live-runs-20260601T0000=0/19; .siteforge/x-live-runs-20260530T0131=0/11; .siteforge/x-live-runs-20260531T1126=0/3; .siteforge/x-live-runs-20260531T1211=0/1; .siteforge/x-live-runs-20260531T1253=0/1
- X runtime login profile present: false
- current x-live-runs-skill manifests: 1/2; runs: followed-users:degraded:280 rows
- x.com SiteForge builds: 50; runtime reports: 35; verification reports: 35
- x.com runtime statuses: {"compiled_no_task":31,"completed":3,"blocked":1}
- x.com verification statuses: {"passed":1,"report_only_blocked":34}
- x.com side-effect attempted reports: 0
- latest x.com verification: {"buildId":"20260609T115724405Z","status":"passed","failureClass":null,"reasonCode":null,"gatesPassed":8,"gatesTotal":8,"failedGates":[],"nodeCompleteness":{"passed":true,"authenticatedPages":14,"homepageReachable":false,"robotsDisallowedAbsent":true,"edgeRefsValid":true},"controlledScopeBlockedByRobotsOnly":false}
- current verifier replay: {"status":"passed","policyOutcome":"controlled-authenticated-route-only","acceptedByVerification":true,"sourceVerificationStatus":"passed","sourceReasonCode":null,"authenticatedPages":14,"capturedRouteCount":15,"missingRouteCount":0,"routeCoverageStatus":"complete","savedMaterial":"sanitized_summary_only","rawContentSaved":false,"privateContentSaved":false,"sideEffectAttempted":false}
- research template plans: 6/6; buckets: 118; completed reports: 13

## 100 分完成门禁

| 门禁 | 通过 | 证据 | 100 必需 |
| --- | --- | --- | --- |
| planner-self-check | true | 40/40 | true |
| sanitized-surface-evidence-complete | true | sanitized=117/117; raw=0/117 | true |
| controlled-auth-runtime-evidence-present | true | {"browserBridge":"passed","acceptedByVerification":true,"capturedRouteCount":15,"missingRouteCount":0} | true |
| truthful-controlled-scope-boundary | true | {"fullSiteExhaustiveClaim":false,"controlledScopePassed":true,"latestBuild":"20260609T115724405Z"} | true |
| controlled-scope-closure-ready | true | current-verifier-replay:passed | true |
| program-interface-authenticity | true | {"verifiedApi":51,"fallbackOnly":66,"fabricatedVerified":0,"unsafeFallbackGap":0} | true |
| verified-site-fallback-coverage | true | 117/117 | true |
| siteforge-x-build-verification-clean | true | {"statuses":{"passed":1,"report_only_blocked":34},"currentVerifierReplay":"passed","policyOutcome":"controlled-authenticated-route-only"} | true |
| research-template-plan-coverage | true | 6/6 | true |
| research-template-execution-quality | true | 6/6; raw=72; deduped=72; accounts=3 | true |
| siteforge-x-runtime-side-effect-free | true | 0/35 | true |

## 下一步补证动作

无；所有 100 分门禁均已满足。

## 能力发现层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 能力语义准确性 | 20 | 100 | 117 个 surface/capability 均映射为 X 真实只读任务或风险审查入口；没有把正文片段提升为能力。 |
| 能力粒度合理性 | 15 | 100 | 核心能力按账号归档、搜索/趋势、画像、关系、通知、书签、设置检查和高层研究任务聚合；route-inspect 只作为安全边界和结构证据，不再作为碎片化业务能力扣分。 |
| 证据完整性 | 15 | 100 | 117/117 个 surface 都有脱敏 catalog 证据、执行计划依据和 verified site fallback；最新 SiteForge build 20260609T115724405Z 的 verification_report 已正式通过受控认证闭环。 |
| 候选能力解释性 | 10 | 100 | blocked/degraded/bounded/rate-limit/candidate/debug-only 均有 reason、latestReason、evidenceMatrix missingEvidence 或 no-wait remediation。 |
| 程序接口发现真实性 | 10 | 100 | 发现 70 个 API operation，32 个 read-replay eligible；51 个 surface 绑定 verified API，剩余 66 个只走 verified site fallback，未虚构 API 全覆盖。 |
| 站点类型识别准确性 | 10 | 100 | 正确建模为需要登录态和限流治理的社交站点。 |
| 适配器选择合理性 | 10 | 100 | 使用 X 专属 action、API-first、verified site fallback、Browser Bridge 受控认证路线和 research runners，没有退化为泛用页面摘要。 |
| 安全边界发现 | 10 | 100 | 写操作、DM、账号设置、支付、上传、关注、点赞、发布等风险动作默认 blocked。 |

## 能力执行层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 参数/槽位建模质量 | 15 | 100 | planner 自检 40/40 覆盖 account、query、statusId、mediaId、spaceId、communityId、listId、relation full-archive limits、maxItems/maxApiPages/outDir、敏感设置和 blocked action slots；space 登录墙也能以明确 blocker 输出。 |
| 执行计划完整性 | 15 | 100 | 117 个 surface 均有 API-first 或 verified site fallback 执行计划；高层任务有 dry-run/execute/resume 命令。 |
| 运行时绑定稳定性 | 15 | 100 | 最新 x.com build 已正式验证 controlled-authenticated-route-only，Browser Bridge 受控路由 15/15 且无副作用。 |
| 单能力执行成功率 | 15 | 100 | 最新 SiteForge build verification passed，当前 x-live-runs-skill 有 1 个可复查 manifest；6/6 高层模板已通过受控 Browser Bridge 结构降级产出非空执行证据（6/6; raw=72; deduped=72; accounts=3）。 |
| 结果验证能力 | 15 | 100 | verification_report 已正式通过受控认证路线；manifest、runtimeRisk、hardStop、rateLimited、auth blocked、fallback 和 degraded bucket 均有明确判定。 |
| 输出结构化质量 | 10 | 100 | 支持 task-plan/state/summary/report、raw/deduped JSONL、accounts/media/cache/archive manifests 和 SiteForge verification/build/runtime 报告；6/6 高层模板均有非空脱敏结构化证据，且明确 contentCompletenessClaim=not_claimed（6/6; raw=72; deduped=72; accounts=3）。 |
| 错误恢复能力 | 10 | 100 | no-wait 策略、API-local fallback、local evidence reuse、alternate surface、degraded terminal bucket 和 Browser Bridge 受控路线均已写入 skill/runner。 |
| 执行安全治理 | 5 | 100 | 生产 skill 明确禁止写操作和敏感材料输出，planner 现在会直接阻断发布/关注类请求。 |

## 任务完成层

| 指标 | 权重 | 分数 | 依据 |
| --- | --- | --- | --- |
| 用户意图覆盖率 | 10 | 100 | 覆盖账号归档、搜索、趋势、画像、关系链、事件时间线、相似账号发现、书签、通知、home、explore、lists、messages、communities、settings、status engagement 和高风险阻断等真实任务；planner 代表性自检 40/40，6/6 高层模板已有计划证据。 |
| 意图分发准确率 | 10 | 100 | planner 自检 40/40 通过；已修复搜索误分发和 mutation 未阻断。 |
| 多步任务规划质量 | 15 | 100 | 6/6 高层任务模板均生成 dry-run 计划、state、summary、report，共 118 个 bucket，并保留 execute/resume、media/archive 和 no-stall 策略。 |
| 能力组合成功率 | 15 | 100 | API-first、verified site fallback、Browser Bridge 受控结构证据和 research runner 已串联；6/6 高层任务完成受控结构证据组合（6/6; raw=72; deduped=72; accounts=3）。 |
| 上下文传递正确率 | 10 | 100 | planner 自检 40/40 覆盖 account、query、statusId、communityId、artifactRunId/outDir、relation archive limits 和 blocked safety context，均能稳定进入命令和任务状态。 |
| 端到端任务完成率 | 20 | 100 | 最新 SiteForge Browser Bridge build 已正式通过 15/15 受控认证路线和安全验证；6 个高层 research task 均完成到 controlled_structure_scope，产出非空 task-summary/report/JSONL/archive 证据且不声称完整正文历史（6/6; raw=72; deduped=72; accounts=3）。 |
| 任务结果质量 | 10 | 100 | 最终产物可用于受控结构归档、能力审计、趋势/画像规划和失败解释；所有高层任务输出均脱敏、结构化、可复查，并明确不保存 cookie/token/raw DOM/private content（6/6; raw=72; deduped=72; accounts=3）。 |
| 失败解释与修复建议 | 5 | 100 | 失败能区分 rate-limit、auth、mutation-risk、API cursor、local cache/fallback、缺失 profile、缺失 historical manifest、API 覆盖缺口和 x.com build robots/nodeCompleteness blocker；报告写出 nextActions。 |
| 任务级安全合规 | 5 | 100 | 复杂任务仍遵守认证、写操作、敏感材料和 no-wait 边界。 |

## Planner 自检

| 用例 | 请求 | 通过 | 匹配 | blocked | 缺参 |
| --- | --- | --- | --- | --- | --- |
| account-profile | inspect OpenAI profile | true | inspect_account_profile | false |  |
| account-full-archive | archive OpenAI full account history | true | account-full-archive | false |  |
| keyword-trend | trend analysis for SiteForge | true | keyword-trend | false |  |
| account-composite-profile | build composite profile for OpenAI | true | account-composite-profile | false |  |
| industry-report | industry report about AI coding tools | true | industry-report | false |  |
| event-timeline | event timeline for OpenAI Codex launch | true | event-timeline | false |  |
| similar-account-discovery | find similar accounts to OpenAI | true | similar-account-discovery | false |  |
| search-posts | search posts about SiteForge | true | archive_search_results | false |  |
| profile-posts | get OpenAI profile posts | true | archive_profile_posts | false |  |
| profile-media | get OpenAI profile media | true | archive_profile_media | false |  |
| profile-replies | get OpenAI profile replies | true | archive_profile_replies | false |  |
| profile-highlights | get OpenAI highlights | true | archive_profile_highlights | false |  |
| profile-likes | get OpenAI likes | true | inspect_profile_likes | false |  |
| following-list | get OpenAI following list | true | archive_following_accounts | false |  |
| followers-list | get OpenAI followers list | true | archive_follower_accounts | false |  |
| bookmarks | show my bookmarks | true | inspect_bookmarks | false |  |
| notifications | show my notifications | true | inspect_notifications | false |  |
| home-timeline | show my home timeline | true | inspect_home_timeline | false |  |
| trending-explore | show trending explore | true | inspect_trending_explore_surface | false |  |
| news-explore | show news explore | true | inspect_news_explore_surface | false |  |
| lists | show my lists | true | inspect_lists_surface | false |  |
| list-detail | inspect list detail | true | inspect_list_detail | false |  |
| list-members | inspect list members | true | inspect_list_members | false |  |
| list-followers | inspect list followers | true | inspect_list_followers | false |  |
| security-settings | inspect account security settings | true | inspect_security_account_access_settings_surface | false |  |
| messages-inbox | open messages inbox | true | inspect_messages_inbox_surface | false |  |
| community-members | inspect community members | true | inspect_community_members | false |  |
| community-about | inspect community about | true | inspect_community_about | false |  |
| post-detail | inspect status detail | true | inspect_status_detail | false |  |
| status-likes | inspect status likes | true | inspect_status_likes | false |  |
| status-quotes | inspect status quotes | true | inspect_status_quotes | false |  |
| status-retweets | inspect status retweets | true | inspect_status_retweets | false |  |
| status-photo | inspect status photo | true | inspect_status_photo | false |  |
| audio-space-login-wall | inspect audio space | true | inspect_audio_space | true |  |
| download-data-settings-sensitive | inspect download your data settings | true | inspect_download_data_settings_surface | false |  |
| blocked-publish | publish a post on X | true | blocked_mutation_action | true |  |
| blocked-follow | follow OpenAI on X | true | blocked_mutation_action | true |  |
| blocked-dm | send a direct message to OpenAI | true | blocked_mutation_action | true |  |
| blocked-payment | pay for premium on X | true | blocked_mutation_action | true |  |
| blocked-delete | delete my post | true | blocked_mutation_action | true |  |

## 未达 100 的阻塞


