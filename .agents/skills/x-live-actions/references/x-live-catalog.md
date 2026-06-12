# X Live Catalog

Generated from .siteforge/x-live-report-20260531T1126/social-live-report.json at 2026-06-01T13:21:35.611Z.

## Summary

- totalRows: 289
- statuses: {"blocked":7,"degraded":141,"bounded":6,"unknown":13,"passed":115,"failed":2,"stale":5}
- sessionGates: {"passed":242,"blocked":1}
- latestFinishedAt: "2026-05-31T22:25:31.694Z"
- plannedSurfaceCount: 117
- coveredPlannedSurfaceCount: 117
- surfaceCount: 117
- capabilityCount: 117
- intentCount: 117
- discoveredCapabilityCount: 121
- discoveredIntentCount: 153
- observedApiOperationCount: 70
- apiReadReplayEligibleCount: 32
- fullSiteExhaustiveClaim: false
- controlledScopeClosureReady: false

## Boundaries

- activeRateLimitBlocker: true
- activeBlockedSurfaces: read-route:profile-lists
- nextEvidence: pause-and-retry-after-rate-limit-cooldown

## API Priority

- For the same natural-language intent, choose verified API execution first.
- If no verified API exists, the API command is unavailable, or the API run fails without a hard safety gate, fall back to the verified site capability command.
- Stop immediately on rate-limited, auth-blocked, mutation-risk, or hardStop outcomes; do not retry until the corresponding recovery condition is met.

## Read-Replay Eligible API Operations

AudioSpaceById, BlueVerifiedFollowers, Bookmarks, CarouselQuery, CommunitiesCreateButtonQuery, CommunitiesFetchOneQuery, CommunityQuery, CommunityTweetsTimeline, ConnectTabTimeline, CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, ExploreSidebar, GrokHome, HomeTimeline, NotificationsTimeline, PinnedTimelines, ProfileSpotlightsQuery, SidebarUserRecommendations, TweetDetail, UserByRestId, UserByScreenName, avatar_content, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, isEligibleForVoButtonUpsellQuery, list.json, settings.json, useDirectCallSetupQuery, xChatDmSettingsQuery

## Verified Surfaces

- inspect_account_profile | profile.identity.read | account-info | API=none | site=verified | blocked=false | status=passed/passed
- archive_profile_posts | timeline.posts.archive | profile-content:posts | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, ProfileSpotlightsQuery, SidebarUserRecommendations, UserByScreenName, avatar_content, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=passed/degraded
- archive_profile_replies | timeline.replies.archive | profile-content:replies | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, avatar_content, badge_count.json, fleetline, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=passed/degraded
- archive_profile_media | timeline.media.archive | profile-content:media | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, ProfileSpotlightsQuery, SidebarUserRecommendations, avatar_content, badge_count.json, fleetline, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- archive_profile_highlights | timeline.highlights.archive | profile-content:highlights | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, avatar_content, badge_count.json, fleetline, hashflags.json | site=verified | blocked=false | status=passed/degraded
- archive_following_accounts | relation.following.archive | profile-following | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=passed/passed
- archive_follower_accounts | relation.followers.archive | profile-followers | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=bounded/bounded
- archive_current_followed_accounts | relation.current-following.archive | followed-users | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=bounded/bounded
- archive_followed_posts_by_date | search.followed-posts.archive | followed-posts-by-date | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json | site=verified | blocked=false | status=bounded/bounded
- archive_search_results | search.live.archive | search | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=passed/degraded
- inspect_root_redirect | app.root.inspect | read-route:root | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json | site=verified | blocked=false | status=passed/degraded
- inspect_profile_likes | timeline.likes.inspect | read-route:profile-likes | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, UserByScreenName, avatar_content, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=degraded/degraded
- inspect_profile_lists | profile.lists.inspect | read-route:profile-lists | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, SidebarUserRecommendations, UserByScreenName, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=true | status=degraded/blocked
- inspect_account_about_route | dynamic.account-about.inspect | read-route:account-about | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_account_accessibility_route | dynamic.account-accessibility.inspect | read-route:account-accessibility | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_account_articles_route | dynamic.account-articles.inspect | read-route:account-articles | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, avatar_content, badge_count.json, fleetline, hashflags.json, list.json | site=verified | blocked=false | status=degraded/degraded
- inspect_account_photo_route | dynamic.account-photo.inspect | read-route:account-photo | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, UserByScreenName, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_account_communities_route | dynamic.account-communities.inspect | read-route:account-communities | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, UserByScreenName, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_account_communities_explore_route | dynamic.account-communities-explore.inspect | read-route:account-communities-explore | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, UserByScreenName, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_audio_space | audio.space.inspect | read-route:audio-space | API=AudioSpaceById, CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json | site=verified | blocked=true | status=degraded/unknown
- inspect_status_analytics | risk-reviewed.status-analytics.inspect | read-route:status-analytics | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json | site=verified | blocked=false | status=degraded/degraded
- inspect_status_detail | content.status.inspect | read-route:status-detail | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, TweetDetail, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_status_likes | engagement.status-likes.inspect | read-route:status-likes | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, TweetDetail, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=passed/passed
- inspect_status_photo | media.status-photo.inspect | read-route:status-photo | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, TweetDetail, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_status_quotes | engagement.status-quotes.inspect | read-route:status-quotes | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_status_retweets | engagement.status-retweets.inspect | read-route:status-retweets | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=passed/passed
- inspect_followers_you_follow | relation.followers-you-follow.inspect | read-route:followers-you-follow | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_verified_followers | relation.verified-followers.inspect | read-route:verified-followers | API=BlueVerifiedFollowers, CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, list.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_home_timeline | app.home.inspect | read-route:home | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, settings.json | site=verified | blocked=false | status=passed/degraded
- inspect_explore_surface | app.explore.inspect | read-route:explore | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_for_you_explore_surface | app.explore-for-you.inspect | read-route:explore-for-you | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_news_explore_surface | app.explore-news.inspect | read-route:explore-news | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_trending_explore_surface | app.explore-trending.inspect | read-route:explore-trending | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_notifications | app.notifications.inspect | read-route:notifications | API=none | site=verified | blocked=false | status=passed/passed
- inspect_notification_mentions | app.notification-mentions.inspect | read-route:notification-mentions | API=none | site=verified | blocked=false | status=passed/passed
- inspect_verified_notifications | app.notification-verified.inspect | read-route:notification-verified | API=none | site=verified | blocked=false | status=passed/passed
- inspect_search_surface | search.surface.inspect | read-route:search-empty | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExplorePage, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_search_top_results | search.top.inspect | read-route:search-top | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_articles_surface | app.articles.inspect | read-route:articles | API=CreatorStudioTabBarItemQuery, DataSaverMode, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_bookmarks | app.bookmarks.inspect | read-route:bookmarks | API=Bookmarks, CreatorStudioTabBarItemQuery, DataSaverMode, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_chat_surface | risk-reviewed.chat.inspect | read-route:chat | API=none | site=verified | blocked=false | status=passed/passed
- inspect_communities_surface | app.communities.inspect | read-route:communities | API=CarouselQuery, CommunitiesCreateButtonQuery, CommunitiesFetchOneQuery, CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline | site=verified | blocked=false | status=degraded/degraded
- inspect_community_about | communities.about.inspect | read-route:community-about | API=CommunitiesFetchOneQuery, CommunityQuery, CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_community_detail | communities.detail.inspect | read-route:community-detail | API=CommunitiesFetchOneQuery, CommunityQuery, CommunityTweetsTimeline, CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_community_members | communities.members.inspect | read-route:community-members | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json | site=verified | blocked=false | status=degraded/degraded
- inspect_community_members_search | communities.members-search.inspect | read-route:community-members-search | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_community_search | communities.search.inspect | read-route:community-search | API=none | site=verified | blocked=false | status=degraded/degraded
- inspect_compose_surface_without_submit | risk-reviewed.compose-surface.inspect | read-route:compose-post | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, badge_count.json, fleetline, getAltTextPromptPreference | site=verified | blocked=false | status=degraded/degraded
- inspect_connect_people | app.connect-people.inspect | read-route:connect-people | API=ConnectTabTimeline, CreatorStudioTabBarItemQuery, DataSaverMode, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_creator_studio_surface | risk-reviewed.creator-studio.inspect | read-route:creator-studio | API=CreatorStudioTabBarItemQuery, DataSaverMode, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_grok_surface | app.grok.inspect | read-route:grok | API=none | site=verified | blocked=false | status=degraded/degraded
- inspect_jobs_surface | app.jobs.inspect | read-route:jobs | API=CreatorStudioTabBarItemQuery, DataSaverMode, badge_count.json, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_news_stories_home_surface | app.news-stories.inspect | read-route:news-stories-home | API=CreatorStudioTabBarItemQuery, DataSaverMode, badge_count.json, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_keyboard_shortcuts_surface | app.keyboard-shortcuts.inspect | read-route:keyboard-shortcuts | API=none | site=verified | blocked=false | status=passed/passed
- inspect_lists_surface | app.lists.inspect | read-route:lists | API=none | site=verified | blocked=false | status=degraded/degraded
- inspect_list_detail | lists.detail.inspect | read-route:list-detail | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, badge_count.json, fleetline, hashflags.json | site=verified | blocked=false | status=degraded/degraded
- inspect_list_followers | lists.followers.inspect | read-route:list-followers | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json | site=verified | blocked=false | status=degraded/degraded
- inspect_list_members | lists.members.inspect | read-route:list-members | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json | site=verified | blocked=false | status=degraded/degraded
- inspect_messages_inbox_surface | risk-reviewed.messages.inspect | read-route:messages | API=none | site=verified | blocked=false | status=passed/passed
- inspect_premium_signup | commerce.premium-signup.inspect | read-route:premium-sign-up | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, HomeTimeline, PinnedTimelines, SidebarUserRecommendations, badge_count.json, fleetline, getAltTextPromptPreference, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
- inspect_settings_surface | risk-reviewed.settings.inspect | read-route:settings | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_settings_surface | risk-reviewed.settings-account.inspect | read-route:settings-account | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_id_verification_settings_surface | risk-reviewed.settings-account-id-verification.inspect | read-route:settings-account-id-verification | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_login_settings_surface | risk-reviewed.settings-account-login.inspect | read-route:settings-account-login | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_login_verification_settings_surface | risk-reviewed.settings-account-login-verification.inspect | read-route:settings-account-login-verification | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_passkey_settings_surface | risk-reviewed.settings-account-passkey.inspect | read-route:settings-account-passkey | API=none | site=verified | blocked=false | status=passed/passed
- inspect_accessibility_settings_surface | risk-reviewed.settings-accessibility.inspect | read-route:settings-accessibility | API=none | site=verified | blocked=false | status=passed/passed
- inspect_security_settings_surface | risk-reviewed.settings-security.inspect | read-route:settings-security | API=none | site=verified | blocked=false | status=passed/passed
- inspect_privacy_safety_settings_surface | risk-reviewed.settings-privacy.inspect | read-route:settings-privacy-and-safety | API=none | site=verified | blocked=false | status=passed/passed
- inspect_profile_settings_surface | risk-reviewed.settings-profile.inspect | read-route:settings-profile | API=none | site=verified | blocked=false | status=passed/passed
- inspect_accessibility_display_language_settings_surface | risk-reviewed.settings-accessibility-display-languages.inspect | read-route:settings-accessibility-display-languages | API=none | site=verified | blocked=false | status=passed/passed
- inspect_additional_resources_settings_surface | risk-reviewed.settings-additional-resources.inspect | read-route:settings-additional-resources | API=none | site=verified | blocked=false | status=passed/passed
- inspect_about_settings_surface | risk-reviewed.settings-about.inspect | read-route:settings-about | API=none | site=verified | blocked=false | status=passed/passed
- inspect_about_your_account_settings_surface | risk-reviewed.settings-about-your-account.inspect | read-route:settings-about-your-account | API=none | site=verified | blocked=false | status=passed/passed
- inspect_ads_preferences_settings_surface | risk-reviewed.settings-ads-preferences.inspect | read-route:settings-ads-preferences | API=none | site=verified | blocked=false | status=passed/passed
- inspect_audience_tagging_settings_surface | risk-reviewed.settings-audience-tagging.inspect | read-route:settings-audience-and-tagging | API=none | site=verified | blocked=false | status=passed/passed
- inspect_autoplay_settings_surface | risk-reviewed.settings-autoplay.inspect | read-route:settings-autoplay | API=none | site=verified | blocked=false | status=passed/passed
- inspect_blocked_accounts_settings_surface | risk-reviewed.settings-blocked-all.inspect | read-route:settings-blocked-all | API=none | site=verified | blocked=false | status=passed/passed
- inspect_connected_accounts_settings_surface | risk-reviewed.settings-connected-accounts.inspect | read-route:settings-connected-accounts | API=none | site=verified | blocked=false | status=passed/passed
- inspect_content_you_see_settings_surface | risk-reviewed.settings-content-you-see.inspect | read-route:settings-content-you-see | API=none | site=verified | blocked=false | status=passed/passed
- inspect_contacts_settings_surface | risk-reviewed.settings-contacts.inspect | read-route:settings-contacts | API=none | site=verified | blocked=false | status=passed/passed
- inspect_contacts_dashboard_settings_surface | risk-reviewed.settings-contacts-dashboard.inspect | read-route:settings-contacts-dashboard | API=none | site=verified | blocked=false | status=passed/passed
- inspect_data_settings_surface | risk-reviewed.settings-data-index.inspect | read-route:settings-data | API=none | site=verified | blocked=false | status=passed/passed
- inspect_business_data_sharing_settings_surface | risk-reviewed.settings-business-data-sharing.inspect | read-route:settings-data-sharing-with-business-partners | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_deactivation_settings_surface | risk-reviewed.settings-deactivation.inspect | read-route:settings-deactivate | API=none | site=verified | blocked=false | status=passed/passed
- inspect_delegate_settings_surface | risk-reviewed.settings-delegate.inspect | read-route:settings-delegate | API=none | site=verified | blocked=false | status=passed/passed
- inspect_delegate_groups_settings_surface | risk-reviewed.settings-delegate-groups.inspect | read-route:settings-delegate-groups | API=none | site=verified | blocked=false | status=passed/passed
- inspect_delegate_members_settings_surface | risk-reviewed.settings-delegate-members.inspect | read-route:settings-delegate-members | API=none | site=verified | blocked=false | status=passed/passed
- inspect_direct_messages_settings_surface | risk-reviewed.settings-direct-messages.inspect | read-route:settings-direct-messages | API=none | site=verified | blocked=false | status=passed/passed
- inspect_display_settings_surface | risk-reviewed.settings-display.inspect | read-route:settings-display | API=none | site=verified | blocked=false | status=passed/passed
- inspect_download_data_settings_surface | risk-reviewed.settings-download-data.inspect | read-route:settings-download-your-data | API=none | site=verified | blocked=false | status=passed/passed
- inspect_legacy_email_notification_settings_surface | risk-reviewed.settings-email-notifications-legacy.inspect | read-route:settings-email-notifications | API=none | site=verified | blocked=false | status=passed/passed
- inspect_explore_settings_surface | risk-reviewed.settings-explore.inspect | read-route:settings-explore | API=none | site=verified | blocked=false | status=passed/passed
- inspect_explore_location_settings_surface | risk-reviewed.settings-explore-location.inspect | read-route:settings-explore-location | API=none | site=verified | blocked=false | status=passed/passed
- inspect_grok_settings_surface | risk-reviewed.settings-grok.inspect | read-route:settings-grok-settings | API=none | site=verified | blocked=false | status=passed/passed
- inspect_language_settings_surface | risk-reviewed.settings-languages.inspect | read-route:settings-languages | API=none | site=verified | blocked=false | status=passed/passed
- inspect_location_information_settings_surface | risk-reviewed.settings-location-information.inspect | read-route:settings-location-information | API=none | site=verified | blocked=false | status=passed/passed
- inspect_manage_subscriptions_settings_surface | risk-reviewed.settings-manage-subscriptions.inspect | read-route:settings-manage-subscriptions | API=none | site=verified | blocked=false | status=passed/passed
- inspect_monetization_settings_surface | risk-reviewed.settings-monetization.inspect | read-route:settings-monetization | API=none | site=verified | blocked=false | status=passed/passed
- inspect_mute_block_settings_surface | risk-reviewed.settings-mute-block.inspect | read-route:settings-mute-and-block | API=none | site=verified | blocked=false | status=passed/passed
- inspect_muted_accounts_settings_surface | risk-reviewed.settings-muted-all.inspect | read-route:settings-muted-all | API=none | site=verified | blocked=false | status=passed/passed
- inspect_muted_keywords_settings_surface | risk-reviewed.settings-muted-keywords.inspect | read-route:settings-muted-keywords | API=none | site=verified | blocked=false | status=passed/passed
- inspect_notification_settings_surface | risk-reviewed.settings-notifications.inspect | read-route:settings-notifications | API=none | site=verified | blocked=false | status=passed/passed
- inspect_notification_advanced_filter_settings_surface | risk-reviewed.settings-notification-advanced-filters.inspect | read-route:settings-notifications-advanced-filters | API=none | site=verified | blocked=false | status=passed/passed
- inspect_email_notification_settings_surface | risk-reviewed.settings-email-notifications.inspect | read-route:settings-notifications-email | API=none | site=verified | blocked=false | status=passed/passed
- inspect_notification_filter_settings_surface | risk-reviewed.settings-notification-filters.inspect | read-route:settings-notifications-filters | API=none | site=verified | blocked=false | status=passed/passed
- inspect_notification_preference_settings_surface | risk-reviewed.settings-notification-preferences.inspect | read-route:settings-notifications-preferences | API=none | site=verified | blocked=false | status=passed/passed
- inspect_push_notification_settings_surface | risk-reviewed.settings-push-notifications.inspect | read-route:settings-notifications-push | API=none | site=verified | blocked=false | status=passed/passed
- inspect_off_twitter_activity_settings_surface | risk-reviewed.settings-off-twitter-activity.inspect | read-route:settings-off-twitter-activity | API=none | site=verified | blocked=false | status=passed/passed
- inspect_legacy_push_notification_settings_surface | risk-reviewed.settings-push-notifications-legacy.inspect | read-route:settings-push-notifications | API=none | site=verified | blocked=false | status=passed/passed
- inspect_settings_search_surface | risk-reviewed.settings-search.inspect | read-route:settings-search | API=none | site=verified | blocked=false | status=passed/passed
- inspect_spaces_settings_surface | risk-reviewed.settings-spaces.inspect | read-route:settings-spaces | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_data_settings_index_surface | risk-reviewed.settings-data.inspect | read-route:settings-your-twitter-data | API=none | site=verified | blocked=false | status=passed/passed
- inspect_account_data_settings_surface | risk-reviewed.settings-data-account.inspect | read-route:settings-your-twitter-data-account | API=none | site=verified | blocked=false | status=passed/passed
- inspect_your_tweets_settings_surface | risk-reviewed.settings-your-tweets.inspect | read-route:settings-your-tweets | API=none | site=verified | blocked=false | status=passed/passed
- inspect_security_account_access_settings_surface | risk-reviewed.settings-security-account-access.inspect | read-route:settings-security-and-account-access | API=none | site=verified | blocked=false | status=passed/passed
- inspect_internal_status_redirect | content.internal-status.inspect | read-route:internal-status | API=CreatorStudioTabBarItemQuery, DataSaverMode, ExploreSidebar, PinnedTimelines, TweetDetail, badge_count.json, fleetline, hashflags.json, settings.json | site=verified | blocked=false | status=degraded/degraded
