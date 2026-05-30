// @ts-check

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { buildSessionRepairPlanCommand } from '../src/domain/sessions/repair-command.mjs';
import { readCliValue as readValue } from '../src/infra/cli/internal-options.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_RUNS_ROOT = path.join(REPO_ROOT, 'runs');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'runs', 'social-live-report');
const execFileAsync = promisify(execFile);

const EXPECTED_SURFACES_BY_SITE = Object.freeze({
  x: Object.freeze([
    'account-info',
    'profile-content:posts',
    'profile-content:replies',
    'profile-content:media',
    'profile-content:highlights',
    'profile-following',
    'profile-followers',
    'followed-users',
    'followed-posts-by-date',
    'search',
    'read-route:root',
    'read-route:profile-likes',
    'read-route:profile-lists',
    'read-route:account-about',
    'read-route:account-accessibility',
    'read-route:account-articles',
    'read-route:account-photo',
    'read-route:account-communities',
    'read-route:account-communities-explore',
    'read-route:audio-space',
    'read-route:status-analytics',
    'read-route:status-detail',
    'read-route:status-likes',
    'read-route:status-photo',
    'read-route:status-quotes',
    'read-route:status-retweets',
    'read-route:followers-you-follow',
    'read-route:verified-followers',
    'read-route:home',
    'read-route:explore',
    'read-route:explore-for-you',
    'read-route:explore-news',
    'read-route:explore-trending',
    'read-route:notifications',
    'read-route:notification-mentions',
    'read-route:notification-verified',
    'read-route:search-empty',
    'read-route:search-top',
    'read-route:articles',
    'read-route:bookmarks',
    'read-route:chat',
    'read-route:communities',
    'read-route:community-about',
    'read-route:community-detail',
    'read-route:community-members',
    'read-route:community-members-search',
    'read-route:community-search',
    'read-route:compose-post',
    'read-route:connect-people',
    'read-route:creator-studio',
    'read-route:grok',
    'read-route:jobs',
    'read-route:news-stories-home',
    'read-route:keyboard-shortcuts',
    'read-route:lists',
    'read-route:list-detail',
    'read-route:list-followers',
    'read-route:list-members',
    'read-route:messages',
    'read-route:premium-sign-up',
    'read-route:settings',
    'read-route:settings-account',
    'read-route:settings-account-id-verification',
    'read-route:settings-account-login',
    'read-route:settings-account-login-verification',
    'read-route:settings-account-passkey',
    'read-route:settings-accessibility',
    'read-route:settings-security',
    'read-route:settings-privacy-and-safety',
    'read-route:settings-profile',
    'read-route:settings-accessibility-display-languages',
    'read-route:settings-additional-resources',
    'read-route:settings-about',
    'read-route:settings-about-your-account',
    'read-route:settings-ads-preferences',
    'read-route:settings-audience-and-tagging',
    'read-route:settings-autoplay',
    'read-route:settings-blocked-all',
    'read-route:settings-connected-accounts',
    'read-route:settings-content-you-see',
    'read-route:settings-contacts',
    'read-route:settings-contacts-dashboard',
    'read-route:settings-data',
    'read-route:settings-data-sharing-with-business-partners',
    'read-route:settings-deactivate',
    'read-route:settings-delegate',
    'read-route:settings-delegate-groups',
    'read-route:settings-delegate-members',
    'read-route:settings-direct-messages',
    'read-route:settings-display',
    'read-route:settings-download-your-data',
    'read-route:settings-email-notifications',
    'read-route:settings-explore',
    'read-route:settings-explore-location',
    'read-route:settings-grok-settings',
    'read-route:settings-languages',
    'read-route:settings-location-information',
    'read-route:settings-manage-subscriptions',
    'read-route:settings-monetization',
    'read-route:settings-mute-and-block',
    'read-route:settings-muted-all',
    'read-route:settings-muted-keywords',
    'read-route:settings-notifications',
    'read-route:settings-notifications-advanced-filters',
    'read-route:settings-notifications-email',
    'read-route:settings-notifications-filters',
    'read-route:settings-notifications-preferences',
    'read-route:settings-notifications-push',
    'read-route:settings-off-twitter-activity',
    'read-route:settings-push-notifications',
    'read-route:settings-search',
    'read-route:settings-spaces',
    'read-route:settings-your-twitter-data',
    'read-route:settings-your-twitter-data-account',
    'read-route:settings-your-tweets',
    'read-route:settings-security-and-account-access',
    'read-route:internal-status',
  ]),
});

const TARGET_OPERATIONS_BY_SURFACE = Object.freeze({
  x: Object.freeze({
    'account-info': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'avatar_content', 'hashflags.json']),
    'profile-content:posts': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'DelegatedAccountListQuery', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations', 'UserTweets', 'UsersByRestIds', 'hashflags.json', 'list.json', 'useSubscriptionProductDetailsQuery']),
    'profile-content:replies': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations', 'UserTweetsAndReplies', 'UsersByRestIds', 'hashflags.json', 'useSubscriptionProductDetailsQuery']),
    'profile-content:media': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations', 'UserMedia', 'UsersByRestIds', 'hashflags.json', 'list.json', 'useSubscriptionProductDetailsQuery']),
    'profile-content:highlights': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'ProfileSpotlightsQuery', 'SidebarUserRecommendations', 'UserByScreenName', 'UserHighlightsTweets', 'UsersByRestIds', 'hashflags.json', 'list.json', 'useSubscriptionProductDetailsQuery']),
    'profile-following': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'Following', 'hashflags.json', 'list.json', 'useFetchProductSubscriptionsQuery']),
    'profile-followers': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'Followers', 'UserByScreenName', 'hashflags.json', 'list.json', 'useFetchProductSubscriptionsQuery', 'useSubscriptionProductDetailsQuery']),
    'followed-users': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'Following', 'hashflags.json', 'list.json', 'useFetchProductSubscriptionsQuery']),
    'followed-posts-by-date': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SearchTimeline', 'SidebarUserRecommendations', 'UsersByRestIds', 'hashflags.json', 'useFetchProductSubscriptionsQuery', 'useSubscriptionProductDetailsQuery']),
    search: Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SearchTimeline', 'SidebarUserRecommendations', 'UsersByRestIds', 'hashflags.json', 'useFetchProductSubscriptionsQuery', 'useSubscriptionProductDetailsQuery']),
    'read-route:root': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'HomeTimeline', 'hashflags.json', 'useFetchProductSubscriptionsQuery', 'useSubscriptionProductDetailsQuery']),
    'read-route:profile-likes': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserTweets', 'UserByScreenName', 'hashflags.json', 'list.json']),
    'read-route:profile-lists': Object.freeze(['CombinedLists', 'CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserByScreenName', 'hashflags.json']),
    'read-route:account-about': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserByScreenName', 'hashflags.json', 'list.json']),
    'read-route:account-accessibility': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserByScreenName', 'hashflags.json', 'list.json']),
    'read-route:account-articles': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserTweets', 'hashflags.json', 'list.json']),
    'read-route:audio-space': Object.freeze(['AudioSpaceById', 'CreatorStudioTabBarItemQuery', 'DataSaverMode', 'hashflags.json']),
    'read-route:status-analytics': Object.freeze(['TweetDetail']),
    'read-route:status-detail': Object.freeze(['TweetDetail', 'TweetResultByRestId', 'UsersByRestIds']),
    'read-route:status-likes': Object.freeze(['TweetDetail', 'TweetResultByRestId']),
    'read-route:status-photo': Object.freeze(['TweetDetail']),
    'read-route:status-quotes': Object.freeze(['SearchTimeline', 'SidebarUserRecommendations']),
    'read-route:status-retweets': Object.freeze(['Retweeters', 'SidebarUserRecommendations']),
    'read-route:followers-you-follow': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'FollowersYouKnow', 'SidebarUserRecommendations', 'UserByScreenName', 'hashflags.json', 'list.json']),
    'read-route:verified-followers': Object.freeze(['BlueVerifiedFollowers', 'CreatorStudioTabBarItemQuery', 'DataSaverMode', 'SidebarUserRecommendations', 'UserByScreenName', 'hashflags.json', 'list.json']),
    'read-route:home': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'HomeTimeline', 'PinnedTimelines', 'SidebarUserRecommendations', 'hashflags.json', 'fleetline']),
    'read-route:explore': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'ExplorePage', 'ExploreSidebar', 'SidebarUserRecommendations', 'hashflags.json']),
    'read-route:explore-for-you': Object.freeze(['ExplorePage']),
    'read-route:explore-news': Object.freeze(['ExplorePage', 'GenericTimelineById']),
    'read-route:explore-trending': Object.freeze(['ExplorePage', 'GenericTimelineById']),
    'read-route:notifications': Object.freeze(['NotificationsTimeline', 'PinnedTimelines', 'badge_count.json']),
    'read-route:notification-mentions': Object.freeze(['NotificationsTimeline', 'badge_count.json']),
    'read-route:search-top': Object.freeze(['ProfileSpotlightsQuery', 'SearchTimeline']),
    'read-route:bookmarks': Object.freeze(['Bookmarks']),
    'read-route:communities': Object.freeze([
      'CarouselQuery',
      'CommunitiesCreateButtonQuery',
      'CommunitiesExploreTimeline',
      'CommunitiesFetchOneQuery',
      'CommunitiesRankedTimeline',
      'TopicCarouselQuery',
    ]),
    'read-route:community-about': Object.freeze(['CommunityAboutTimeline', 'CommunityQuery']),
    'read-route:community-detail': Object.freeze(['CommunityQuery', 'CommunityTweetsTimeline']),
    'read-route:community-members': Object.freeze(['CommunityInviteButtonQuery', 'membersSliceTimeline_Query']),
    'read-route:community-members-search': Object.freeze(['membersSliceTimeline_Query']),
    'read-route:community-search': Object.freeze([]),
    'read-route:compose-post': Object.freeze(['getAltTextPromptPreference']),
    'read-route:connect-people': Object.freeze(['ConnectTabTimeline']),
    'read-route:grok': Object.freeze(['GrokHome']),
    'read-route:jobs': Object.freeze([]),
    'read-route:list-detail': Object.freeze(['ListByRestId', 'ListLatestTweetsTimeline', 'UserByRestId']),
    'read-route:list-followers': Object.freeze([]),
    'read-route:list-members': Object.freeze([]),
    'read-route:news-stories-home': Object.freeze(['NotificationsTimeline', 'fleetline', 'useRelayDelegateDataPendingQuery']),
    'read-route:premium-sign-up': Object.freeze(['PremiumContentQuery', 'useFetchProductSubscriptionsQuery', 'useSubscriptionProductDetailsQuery']),
    'read-route:settings-account': Object.freeze(['CreatorStudioTabBarItemQuery', 'DataSaverMode', 'PinnedTimelines', 'getAltTextPromptPreference', 'hashflags.json', 'settings.json']),
    'read-route:settings-account-id-verification': Object.freeze(['settings.json']),
    'read-route:settings-account-login': Object.freeze(['settings.json']),
    'read-route:settings-account-login-verification': Object.freeze(['settings.json']),
    'read-route:settings-account-passkey': Object.freeze(['settings.json']),
    'read-route:settings-accessibility': Object.freeze(['getAltTextPromptPreference', 'settings.json']),
    'read-route:settings-about-your-account': Object.freeze(['settings.json']),
    'read-route:settings-ads-preferences': Object.freeze(['settings.json']),
    'read-route:settings-audience-and-tagging': Object.freeze(['settings.json']),
    'read-route:settings-autoplay': Object.freeze(['settings.json']),
    'read-route:settings-blocked-all': Object.freeze(['settings.json']),
    'read-route:settings-connected-accounts': Object.freeze(['settings.json']),
    'read-route:settings-content-you-see': Object.freeze(['settings.json']),
    'read-route:settings-contacts': Object.freeze(['settings.json']),
    'read-route:settings-contacts-dashboard': Object.freeze(['settings.json']),
    'read-route:settings-data': Object.freeze(['settings.json']),
    'read-route:settings-data-sharing-with-business-partners': Object.freeze(['settings.json']),
    'read-route:settings-deactivate': Object.freeze(['settings.json']),
    'read-route:settings-delegate': Object.freeze(['DelegateQuery', 'settings.json']),
    'read-route:settings-delegate-groups': Object.freeze(['DelegateQuery', 'settings.json']),
    'read-route:settings-delegate-members': Object.freeze(['DelegateQuery', 'settings.json']),
    'read-route:settings-direct-messages': Object.freeze(['settings.json']),
    'read-route:settings-display': Object.freeze(['PremiumContentQuery', 'useDirectCallSetupQuery', 'xChatDmSettingsQuery']),
    'read-route:settings-download-your-data': Object.freeze(['settings.json']),
    'read-route:settings-email-notifications': Object.freeze(['ViewerEmailSettings', 'settings.json']),
    'read-route:settings-explore': Object.freeze(['get_explore_settings.json', 'ExplorePage']),
    'read-route:settings-explore-location': Object.freeze(['explore_locations_with_auto_complete.json', 'ExplorePage']),
    'read-route:settings-grok-settings': Object.freeze(['settings.json']),
    'read-route:settings-languages': Object.freeze(['SupportedLanguages', 'UnifiedLanguagePivotMenuLanguagesQuery', 'settings.json']),
    'read-route:settings-location-information': Object.freeze(['settings.json']),
    'read-route:settings-manage-subscriptions': Object.freeze(['settings.json']),
    'read-route:settings-monetization': Object.freeze(['settings.json']),
    'read-route:settings-mute-and-block': Object.freeze(['settings.json']),
    'read-route:settings-muted-all': Object.freeze(['settings.json']),
    'read-route:settings-muted-keywords': Object.freeze(['settings.json']),
    'read-route:settings-notifications': Object.freeze(['settings.json']),
    'read-route:settings-notifications-advanced-filters': Object.freeze(['advanced_filters.json', 'settings.json']),
    'read-route:settings-notifications-email': Object.freeze(['ViewerEmailSettings', 'settings.json']),
    'read-route:settings-notifications-filters': Object.freeze(['settings.json']),
    'read-route:settings-notifications-preferences': Object.freeze(['settings.json']),
    'read-route:settings-notifications-push': Object.freeze(['settings.json']),
    'read-route:settings-off-twitter-activity': Object.freeze(['settings.json']),
    'read-route:settings-profile': Object.freeze(['avatar_content', 'getAltTextPromptPreference', 'settings.json']),
    'read-route:settings-push-notifications': Object.freeze(['settings.json']),
    'read-route:settings-spaces': Object.freeze(['settings.json']),
    'read-route:settings-your-tweets': Object.freeze(['settings.json']),
    'read-route:internal-status': Object.freeze(['TweetDetail']),
  }),
});

const OBSERVED_API_OPERATION_CLASSES = Object.freeze({
  'advanced_filters.json': 'support-read',
  AudioSpaceById: 'support-read',
  AuthenticatePeriscope: 'auth-replay-blocked',
  avatar_content: 'support-read',
  'badge_count.json': 'support-read',
  CarouselQuery: 'support-read',
  CommunityQuery: 'support-read',
  CommunityTweetsTimeline: 'support-read',
  CommunityAboutTimeline: 'support-read',
  CommunityInviteButtonQuery: 'support-read',
  CommunitiesCreateButtonQuery: 'support-read',
  CommunitiesFetchOneQuery: 'support-read',
  CreatorStudioTabBarItemQuery: 'support-read',
  DataSaverMode: 'support-read',
  DelegateQuery: 'support-read',
  DelegatedAccountListQuery: 'support-read',
  ExploreSidebar: 'support-read',
  FetchDraftTweets: 'content-write-risk',
  FetchScheduledTweets: 'content-write-risk',
  fleetline: 'support-read',
  GenerateXChatTokenMutation: 'side-effect-risk',
  getAltTextPromptPreference: 'support-read',
  GrokHome: 'support-read',
  'hashflags.json': 'support-read',
  HomeTimeline: 'support-read',
  isEligibleForVoButtonUpsellQuery: 'commerce-support-read',
  'list.json': 'support-read',
  ListByRestId: 'support-read',
  ListLatestTweetsTimeline: 'support-read',
  'log.json': 'telemetry-or-ad',
  membersSliceTimeline_Query: 'support-read',
  NotificationsTimeline: 'support-read',
  p2: 'support-read',
  PinnedTimelines: 'support-read',
  PremiumContentQuery: 'commerce-support-read',
  'prerolls.json': 'telemetry-or-ad',
  ProfileSpotlightsQuery: 'support-read',
  PutClientEducationFlag: 'side-effect-risk',
  QuickPromoteEligibility: 'commerce-support-read',
  'settings.json': 'support-read',
  SearchTimeline: 'support-read',
  SidebarUserRecommendations: 'support-read',
  SmartTagAttachmentQuery: 'support-read',
  TopicCarouselQuery: 'support-read',
  update_subscriptions: 'side-effect-risk',
  UnifiedLanguagePivotMenuLanguagesQuery: 'support-read',
  SupportedLanguages: 'support-read',
  useDirectCallSetupQuery: 'support-read',
  UserByRestId: 'support-read',
  useFetchProductSubscriptionsQuery: 'commerce-support-read',
  usePremiumPaywallOnLoadMutation: 'side-effect-risk',
  useRelayDelegateDataPendingQuery: 'support-read',
  useSubscriptionProductDetailsQuery: 'commerce-support-read',
  UserByScreenName: 'support-read',
  UsersByRestIds: 'support-read',
  ViewerEmailSettings: 'support-read',
  xChatDmSettingsQuery: 'support-read',
});

const API_COVERAGE_EXPANSION_CANDIDATES_BY_SITE = Object.freeze({
  x: Object.freeze({
    AudioSpaceById: Object.freeze({
      candidateCapability: 'audio.space.inspect',
      candidateIntent: 'inspect_audio_space',
      candidateSurface: 'read-route:audio-space',
      routeTemplate: '/i/spaces/:spaceId',
      reason: 'Audio space detail API was observed but is not yet a planned target surface.',
      nextEvidence: 'Replay a concrete /i/spaces/:spaceId sample and verify the AudioSpaceById response shape.',
    }),
    avatar_content: Object.freeze({
      candidateCapability: 'media.avatar-content.inspect',
      candidateIntent: 'inspect_avatar_content',
      candidateSurface: 'profile-avatar-content',
      routeTemplate: null,
      reason: 'Avatar content API was observed as support read traffic outside target API coverage.',
      nextEvidence: 'Capture the avatar/media surface that triggers avatar_content and classify its user-visible controls.',
    }),
    'badge_count.json': Object.freeze({
      candidateCapability: 'notifications.badge.inspect',
      candidateIntent: 'inspect_notification_badge_counts',
      candidateSurface: 'notifications.badge',
      routeTemplate: null,
      reason: 'Notification badge count API was observed but is not modeled as its own coverage surface.',
      nextEvidence: 'Capture an authenticated navigation/header badge sample and tie badge_count.json to notification state.',
    }),
    CarouselQuery: Object.freeze({
      candidateCapability: 'communities.carousel.inspect',
      candidateIntent: 'inspect_community_carousel',
      candidateSurface: 'communities.carousel',
      routeTemplate: '/communities',
      reason: 'Community carousel API was observed under communities support traffic.',
      nextEvidence: 'Split the communities carousel into an explicit read surface with item counts and route samples.',
    }),
    CommunitiesCreateButtonQuery: Object.freeze({
      candidateCapability: 'communities.create-eligibility.inspect',
      candidateIntent: 'inspect_community_create_eligibility',
      candidateSurface: 'communities.create-eligibility',
      routeTemplate: '/communities',
      reason: 'Create button eligibility API was observed as read-only support for community creation controls.',
      nextEvidence: 'Capture the communities create button state and verify no mutation is executed.',
    }),
    CommunitiesFetchOneQuery: Object.freeze({
      candidateCapability: 'communities.detail.inspect',
      candidateIntent: 'inspect_community_detail',
      candidateSurface: 'communities.detail',
      routeTemplate: '/i/communities/:communityId',
      reason: 'Single community fetch API indicates a detail surface beyond the aggregate communities routes.',
      nextEvidence: 'Replay a concrete community detail route and verify CommunitiesFetchOneQuery coverage.',
    }),
    CreatorStudioTabBarItemQuery: Object.freeze({
      candidateCapability: 'creator-studio.tabbar.inspect',
      candidateIntent: 'inspect_creator_studio_tabbar',
      candidateSurface: 'creator-studio.tabbar',
      routeTemplate: null,
      reason: 'Creator Studio tab metadata API was observed but is not a planned target surface.',
      nextEvidence: 'Find the route or account-menu entry that triggers CreatorStudioTabBarItemQuery.',
    }),
    DataSaverMode: Object.freeze({
      candidateCapability: 'settings.data-saver.inspect',
      candidateIntent: 'inspect_data_saver_mode',
      candidateSurface: 'settings.data-saver',
      routeTemplate: null,
      reason: 'Data saver setting API was observed outside explicit settings target operations.',
      nextEvidence: 'Capture the settings path that reads DataSaverMode and verify the visible control state.',
    }),
    DelegatedAccountListQuery: Object.freeze({
      candidateCapability: 'account.delegated-accounts.inspect',
      candidateIntent: 'inspect_delegated_accounts',
      candidateSurface: 'account.delegated-accounts',
      routeTemplate: null,
      reason: 'Delegated account list API was observed but has no explicit account-switching coverage surface.',
      nextEvidence: 'Inspect the account switcher/delegated account entry point and classify its read-only state.',
    }),
    ExploreSidebar: Object.freeze({
      candidateCapability: 'explore.sidebar.inspect',
      candidateIntent: 'inspect_explore_sidebar',
      candidateSurface: 'explore.sidebar',
      routeTemplate: '/explore',
      reason: 'Explore sidebar API was observed separately from primary explore timeline operations.',
      nextEvidence: 'Capture explore sidebar cards and link routes as a distinct support surface.',
    }),
    fleetline: Object.freeze({
      candidateCapability: 'timeline.fleetline.inspect',
      candidateIntent: 'inspect_fleetline',
      candidateSurface: 'timeline.fleetline',
      routeTemplate: '/home',
      reason: 'Fleetline API was observed in timeline support traffic outside target timeline operations.',
      nextEvidence: 'Capture the home timeline header strip that triggers fleetline and classify its controls.',
    }),
    getAltTextPromptPreference: Object.freeze({
      candidateCapability: 'media.alt-text-preference.inspect',
      candidateIntent: 'inspect_alt_text_prompt_preference',
      candidateSurface: 'media.alt-text-preference',
      routeTemplate: null,
      reason: 'Alt-text prompt preference API was observed as media accessibility support.',
      nextEvidence: 'Capture the media composer/settings path that reads getAltTextPromptPreference without posting.',
    }),
    'hashflags.json': Object.freeze({
      candidateCapability: 'metadata.hashflags.inspect',
      candidateIntent: 'inspect_hashflag_metadata',
      candidateSurface: 'metadata.hashflags',
      routeTemplate: null,
      reason: 'Hashflag metadata API was observed as support read traffic.',
      nextEvidence: 'Capture the route or timeline state that triggers hashflags.json and classify it as metadata support.',
    }),
    'list.json': Object.freeze({
      candidateCapability: 'lists.metadata.inspect',
      candidateIntent: 'inspect_list_metadata',
      candidateSurface: 'lists.metadata',
      routeTemplate: '/i/lists/:listId',
      reason: 'List metadata API was observed outside explicit list target operations.',
      nextEvidence: 'Replay a concrete list route and tie list.json to list identity metadata.',
    }),
    PinnedTimelines: Object.freeze({
      candidateCapability: 'timeline.pinned.inspect',
      candidateIntent: 'inspect_pinned_timelines',
      candidateSurface: 'timeline.pinned',
      routeTemplate: '/home',
      reason: 'Pinned timelines API was observed as timeline navigation support.',
      nextEvidence: 'Capture home timeline navigation and verify PinnedTimelines response coverage.',
    }),
    ProfileSpotlightsQuery: Object.freeze({
      candidateCapability: 'profile.spotlights.inspect',
      candidateIntent: 'inspect_profile_spotlights',
      candidateSurface: 'profile.spotlights',
      routeTemplate: '/:account',
      reason: 'Profile spotlight API was observed on profile routes but is not an explicit target surface.',
      nextEvidence: 'Split profile spotlight cards into an explicit profile support surface with API samples.',
    }),
    SidebarUserRecommendations: Object.freeze({
      candidateCapability: 'recommendations.sidebar.inspect',
      candidateIntent: 'inspect_sidebar_user_recommendations',
      candidateSurface: 'recommendations.sidebar',
      routeTemplate: null,
      reason: 'Sidebar recommendation API was observed outside planned target operations.',
      nextEvidence: 'Capture the sidebar recommendation panel and classify follow controls as blocked mutations.',
    }),
    TopicCarouselQuery: Object.freeze({
      candidateCapability: 'communities.topic-carousel.inspect',
      candidateIntent: 'inspect_community_topic_carousel',
      candidateSurface: 'communities.topic-carousel',
      routeTemplate: '/communities',
      reason: 'Community topic carousel API was observed under communities support traffic.',
      nextEvidence: 'Split community topic carousel items into a read surface with topic route samples.',
    }),
    useFetchProductSubscriptionsQuery: Object.freeze({
      candidateCapability: 'commerce.subscription-products.inspect',
      candidateIntent: 'inspect_subscription_products',
      candidateSurface: 'commerce.subscription-products',
      routeTemplate: null,
      reason: 'Subscription product list API was observed as commerce support read traffic.',
      nextEvidence: 'Capture the product subscription entry point and keep purchase controls mutation-blocked.',
    }),
    useSubscriptionProductDetailsQuery: Object.freeze({
      candidateCapability: 'commerce.subscription-products.inspect',
      candidateIntent: 'inspect_subscription_product_details',
      candidateSurface: 'commerce.subscription-product-detail',
      routeTemplate: null,
      reason: 'Subscription product detail API was observed as commerce support read traffic.',
      nextEvidence: 'Capture the product detail panel and keep purchase controls mutation-blocked.',
    }),
    UserByRestId: Object.freeze({
      candidateCapability: 'identity.user-lookup.inspect',
      candidateIntent: 'inspect_user_lookup_by_rest_id',
      candidateSurface: 'identity.user-lookup',
      routeTemplate: null,
      reason: 'User lookup API was observed as identity support outside target user timelines.',
      nextEvidence: 'Tie UserByRestId samples to the route or component that requests identity lookup.',
    }),
    UserByScreenName: Object.freeze({
      candidateCapability: 'identity.user-lookup.inspect',
      candidateIntent: 'inspect_user_lookup_by_screen_name',
      candidateSurface: 'identity.user-lookup',
      routeTemplate: null,
      reason: 'Screen-name lookup API was observed as identity support outside target user timelines.',
      nextEvidence: 'Tie UserByScreenName samples to the route or component that requests identity lookup.',
    }),
    UsersByRestIds: Object.freeze({
      candidateCapability: 'identity.user-lookup.inspect',
      candidateIntent: 'inspect_users_lookup_by_rest_ids',
      candidateSurface: 'identity.user-lookup',
      routeTemplate: null,
      reason: 'Bulk user lookup API was observed as identity support outside target user timelines.',
      nextEvidence: 'Tie UsersByRestIds samples to the route or component that requests bulk identity lookup.',
    }),
  }),
});

const SURFACE_DETAILS_BY_SITE = Object.freeze({
  x: Object.freeze({
    'account-info': Object.freeze({
      routeTemplate: '/:account',
      capability: 'profile.identity.read',
      intent: 'inspect_account_profile',
    }),
    'profile-content:posts': Object.freeze({
      routeTemplate: '/:account',
      capability: 'timeline.posts.archive',
      intent: 'archive_profile_posts',
    }),
    'profile-content:replies': Object.freeze({
      routeTemplate: '/:account/with_replies',
      capability: 'timeline.replies.archive',
      intent: 'archive_profile_replies',
    }),
    'profile-content:media': Object.freeze({
      routeTemplate: '/:account/media',
      capability: 'timeline.media.archive',
      intent: 'archive_profile_media',
    }),
    'profile-content:highlights': Object.freeze({
      routeTemplate: '/:account/highlights',
      capability: 'timeline.highlights.archive',
      intent: 'archive_profile_highlights',
    }),
    'profile-following': Object.freeze({
      routeTemplate: '/:account/following',
      capability: 'relation.following.archive',
      intent: 'archive_following_accounts',
    }),
    'profile-followers': Object.freeze({
      routeTemplate: '/:account/followers',
      capability: 'relation.followers.archive',
      intent: 'archive_follower_accounts',
    }),
    'followed-users': Object.freeze({
      routeTemplate: '/:current_account/following',
      capability: 'relation.current-following.archive',
      intent: 'archive_current_followed_accounts',
    }),
    'followed-posts-by-date': Object.freeze({
      routeTemplate: '/search?q=filter:follows&src=typed_query&f=live',
      capability: 'search.followed-posts.archive',
      intent: 'archive_followed_posts_by_date',
    }),
    search: Object.freeze({
      routeTemplate: '/search?q=:query&src=typed_query&f=live',
      capability: 'search.live.archive',
      intent: 'archive_search_results',
    }),
    'read-route:root': Object.freeze({
      routeTemplate: '/',
      capability: 'app.root.inspect',
      intent: 'inspect_root_redirect',
    }),
    'read-route:profile-likes': Object.freeze({
      routeTemplate: '/:account/likes',
      capability: 'timeline.likes.inspect',
      intent: 'inspect_profile_likes',
    }),
    'read-route:profile-lists': Object.freeze({
      routeTemplate: '/:account/lists',
      capability: 'profile.lists.inspect',
      intent: 'inspect_profile_lists',
    }),
    'read-route:account-about': Object.freeze({
      routeTemplate: '/:account/about',
      capability: 'dynamic.account-about.inspect',
      intent: 'inspect_account_about_route',
    }),
    'read-route:account-accessibility': Object.freeze({
      routeTemplate: '/:account/accessibility',
      capability: 'dynamic.account-accessibility.inspect',
      intent: 'inspect_account_accessibility_route',
    }),
    'read-route:account-articles': Object.freeze({
      routeTemplate: '/:account/articles',
      capability: 'dynamic.account-articles.inspect',
      intent: 'inspect_account_articles_route',
    }),
    'read-route:account-photo': Object.freeze({
      routeTemplate: '/:account/photo',
      capability: 'dynamic.account-photo.inspect',
      intent: 'inspect_account_photo_route',
    }),
    'read-route:account-communities': Object.freeze({
      routeTemplate: '/:account/communities',
      capability: 'dynamic.account-communities.inspect',
      intent: 'inspect_account_communities_route',
    }),
    'read-route:account-communities-explore': Object.freeze({
      routeTemplate: '/:account/communities/explore',
      capability: 'dynamic.account-communities-explore.inspect',
      intent: 'inspect_account_communities_explore_route',
    }),
    'read-route:audio-space': Object.freeze({
      routeTemplate: '/i/spaces/:id',
      capability: 'audio.space.inspect',
      intent: 'inspect_audio_space',
    }),
    'read-route:status-analytics': Object.freeze({
      routeTemplate: '/:account/status/:id/analytics',
      capability: 'risk-reviewed.status-analytics.inspect',
      intent: 'inspect_status_analytics',
    }),
    'read-route:status-detail': Object.freeze({
      routeTemplate: '/:account/status/:id',
      capability: 'content.status.inspect',
      intent: 'inspect_status_detail',
    }),
    'read-route:status-likes': Object.freeze({
      routeTemplate: '/:account/status/:id/likes',
      capability: 'engagement.status-likes.inspect',
      intent: 'inspect_status_likes',
    }),
    'read-route:status-photo': Object.freeze({
      routeTemplate: '/:account/status/:id/photo/:id',
      capability: 'media.status-photo.inspect',
      intent: 'inspect_status_photo',
    }),
    'read-route:status-quotes': Object.freeze({
      routeTemplate: '/:account/status/:id/quotes',
      capability: 'engagement.status-quotes.inspect',
      intent: 'inspect_status_quotes',
    }),
    'read-route:status-retweets': Object.freeze({
      routeTemplate: '/:account/status/:id/retweets',
      capability: 'engagement.status-retweets.inspect',
      intent: 'inspect_status_retweets',
    }),
    'read-route:followers-you-follow': Object.freeze({
      routeTemplate: '/:account/followers_you_follow',
      capability: 'relation.followers-you-follow.inspect',
      intent: 'inspect_followers_you_follow',
    }),
    'read-route:verified-followers': Object.freeze({
      routeTemplate: '/:account/verified_followers',
      capability: 'relation.verified-followers.inspect',
      intent: 'inspect_verified_followers',
    }),
    'read-route:home': Object.freeze({
      routeTemplate: '/home',
      capability: 'app.home.inspect',
      intent: 'inspect_home_timeline',
    }),
    'read-route:explore': Object.freeze({
      routeTemplate: '/explore',
      capability: 'app.explore.inspect',
      intent: 'inspect_explore_surface',
    }),
    'read-route:explore-for-you': Object.freeze({
      routeTemplate: '/explore/tabs/for-you',
      capability: 'app.explore-for-you.inspect',
      intent: 'inspect_for_you_explore_surface',
    }),
    'read-route:explore-news': Object.freeze({
      routeTemplate: '/explore/tabs/news',
      capability: 'app.explore-news.inspect',
      intent: 'inspect_news_explore_surface',
    }),
    'read-route:explore-trending': Object.freeze({
      routeTemplate: '/explore/tabs/trending',
      capability: 'app.explore-trending.inspect',
      intent: 'inspect_trending_explore_surface',
    }),
    'read-route:notifications': Object.freeze({
      routeTemplate: '/notifications',
      capability: 'app.notifications.inspect',
      intent: 'inspect_notifications',
    }),
    'read-route:notification-mentions': Object.freeze({
      routeTemplate: '/notifications/mentions',
      capability: 'app.notification-mentions.inspect',
      intent: 'inspect_notification_mentions',
    }),
    'read-route:notification-verified': Object.freeze({
      routeTemplate: '/notifications/verified',
      capability: 'app.notification-verified.inspect',
      intent: 'inspect_verified_notifications',
    }),
    'read-route:search-empty': Object.freeze({
      routeTemplate: '/search',
      capability: 'search.surface.inspect',
      intent: 'inspect_search_surface',
    }),
    'read-route:search-top': Object.freeze({
      routeTemplate: '/search?q=:query&src=typed_query',
      capability: 'search.top.inspect',
      intent: 'inspect_search_top_results',
    }),
    'read-route:bookmarks': Object.freeze({
      routeTemplate: '/i/bookmarks',
      capability: 'app.bookmarks.inspect',
      intent: 'inspect_bookmarks',
    }),
    'read-route:chat': Object.freeze({
      routeTemplate: '/i/chat',
      capability: 'risk-reviewed.chat.inspect',
      intent: 'inspect_chat_surface',
    }),
    'read-route:articles': Object.freeze({
      routeTemplate: '/i/articles',
      capability: 'app.articles.inspect',
      intent: 'inspect_articles_surface',
    }),
    'read-route:communities': Object.freeze({
      routeTemplate: '/i/communities',
      capability: 'app.communities.inspect',
      intent: 'inspect_communities_surface',
    }),
    'read-route:community-about': Object.freeze({
      routeTemplate: '/i/communities/:communityId/about',
      capability: 'communities.about.inspect',
      intent: 'inspect_community_about',
    }),
    'read-route:community-detail': Object.freeze({
      routeTemplate: '/i/communities/:communityId',
      capability: 'communities.detail.inspect',
      intent: 'inspect_community_detail',
    }),
    'read-route:community-members': Object.freeze({
      routeTemplate: '/i/communities/:communityId/members',
      capability: 'communities.members.inspect',
      intent: 'inspect_community_members',
    }),
    'read-route:community-members-search': Object.freeze({
      routeTemplate: '/i/communities/:communityId/members/search',
      capability: 'communities.members-search.inspect',
      intent: 'inspect_community_members_search',
    }),
    'read-route:community-search': Object.freeze({
      routeTemplate: '/i/communities/:communityId/search',
      capability: 'communities.search.inspect',
      intent: 'inspect_community_search',
    }),
    'read-route:compose-post': Object.freeze({
      routeTemplate: '/compose/post',
      capability: 'risk-reviewed.compose-surface.inspect',
      intent: 'inspect_compose_surface_without_submit',
    }),
    'read-route:connect-people': Object.freeze({
      routeTemplate: '/i/connect_people',
      capability: 'app.connect-people.inspect',
      intent: 'inspect_connect_people',
    }),
    'read-route:creator-studio': Object.freeze({
      routeTemplate: '/i/jf/creators/studio',
      capability: 'risk-reviewed.creator-studio.inspect',
      intent: 'inspect_creator_studio_surface',
    }),
    'read-route:grok': Object.freeze({
      routeTemplate: '/i/grok',
      capability: 'app.grok.inspect',
      intent: 'inspect_grok_surface',
    }),
    'read-route:jobs': Object.freeze({
      routeTemplate: '/jobs',
      capability: 'app.jobs.inspect',
      intent: 'inspect_jobs_surface',
    }),
    'read-route:news-stories-home': Object.freeze({
      routeTemplate: '/i/jf/stories/home',
      capability: 'app.news-stories.inspect',
      intent: 'inspect_news_stories_home_surface',
    }),
    'read-route:keyboard-shortcuts': Object.freeze({
      routeTemplate: '/i/keyboard_shortcuts',
      capability: 'app.keyboard-shortcuts.inspect',
      intent: 'inspect_keyboard_shortcuts_surface',
    }),
    'read-route:lists': Object.freeze({
      routeTemplate: '/i/lists',
      capability: 'app.lists.inspect',
      intent: 'inspect_lists_surface',
    }),
    'read-route:list-detail': Object.freeze({
      routeTemplate: '/i/lists/:listId',
      capability: 'lists.detail.inspect',
      intent: 'inspect_list_detail',
    }),
    'read-route:list-followers': Object.freeze({
      routeTemplate: '/i/lists/:listId/followers',
      capability: 'lists.followers.inspect',
      intent: 'inspect_list_followers',
    }),
    'read-route:list-members': Object.freeze({
      routeTemplate: '/i/lists/:listId/members',
      capability: 'lists.members.inspect',
      intent: 'inspect_list_members',
    }),
    'read-route:messages': Object.freeze({
      routeTemplate: '/messages',
      capability: 'risk-reviewed.messages.inspect',
      intent: 'inspect_messages_inbox_surface',
    }),
    'read-route:premium-sign-up': Object.freeze({
      routeTemplate: '/i/premium_sign_up',
      capability: 'commerce.premium-signup.inspect',
      intent: 'inspect_premium_signup',
    }),
    'read-route:settings': Object.freeze({
      routeTemplate: '/settings',
      capability: 'risk-reviewed.settings.inspect',
      intent: 'inspect_settings_surface',
    }),
    'read-route:settings-account': Object.freeze({
      routeTemplate: '/settings/account',
      capability: 'risk-reviewed.settings-account.inspect',
      intent: 'inspect_account_settings_surface',
    }),
    'read-route:settings-account-id-verification': Object.freeze({
      routeTemplate: '/settings/account/id_verification',
      capability: 'risk-reviewed.settings-account-id-verification.inspect',
      intent: 'inspect_account_id_verification_settings_surface',
    }),
    'read-route:settings-account-login': Object.freeze({
      routeTemplate: '/settings/account/login',
      capability: 'risk-reviewed.settings-account-login.inspect',
      intent: 'inspect_account_login_settings_surface',
    }),
    'read-route:settings-account-login-verification': Object.freeze({
      routeTemplate: '/settings/account/login_verification',
      capability: 'risk-reviewed.settings-account-login-verification.inspect',
      intent: 'inspect_account_login_verification_settings_surface',
    }),
    'read-route:settings-account-passkey': Object.freeze({
      routeTemplate: '/settings/account/passkey',
      capability: 'risk-reviewed.settings-account-passkey.inspect',
      intent: 'inspect_account_passkey_settings_surface',
    }),
    'read-route:settings-accessibility': Object.freeze({
      routeTemplate: '/settings/accessibility',
      capability: 'risk-reviewed.settings-accessibility.inspect',
      intent: 'inspect_accessibility_settings_surface',
    }),
    'read-route:settings-security': Object.freeze({
      routeTemplate: '/settings/security',
      capability: 'risk-reviewed.settings-security.inspect',
      intent: 'inspect_security_settings_surface',
    }),
    'read-route:settings-security-and-account-access': Object.freeze({
      routeTemplate: '/settings/security_and_account_access',
      capability: 'risk-reviewed.settings-security-account-access.inspect',
      intent: 'inspect_security_account_access_settings_surface',
    }),
    'read-route:settings-privacy-and-safety': Object.freeze({
      routeTemplate: '/settings/privacy_and_safety',
      capability: 'risk-reviewed.settings-privacy.inspect',
      intent: 'inspect_privacy_safety_settings_surface',
    }),
    'read-route:settings-profile': Object.freeze({
      routeTemplate: '/settings/profile',
      capability: 'risk-reviewed.settings-profile.inspect',
      intent: 'inspect_profile_settings_surface',
    }),
    'read-route:settings-accessibility-display-languages': Object.freeze({
      routeTemplate: '/settings/accessibility_display_and_languages',
      capability: 'risk-reviewed.settings-accessibility-display-languages.inspect',
      intent: 'inspect_accessibility_display_language_settings_surface',
    }),
    'read-route:settings-additional-resources': Object.freeze({
      routeTemplate: '/settings/additional_resources',
      capability: 'risk-reviewed.settings-additional-resources.inspect',
      intent: 'inspect_additional_resources_settings_surface',
    }),
    'read-route:settings-about': Object.freeze({
      routeTemplate: '/settings/about',
      capability: 'risk-reviewed.settings-about.inspect',
      intent: 'inspect_about_settings_surface',
    }),
    'read-route:settings-about-your-account': Object.freeze({
      routeTemplate: '/settings/about_your_account',
      capability: 'risk-reviewed.settings-about-your-account.inspect',
      intent: 'inspect_about_your_account_settings_surface',
    }),
    'read-route:settings-ads-preferences': Object.freeze({
      routeTemplate: '/settings/ads_preferences',
      capability: 'risk-reviewed.settings-ads-preferences.inspect',
      intent: 'inspect_ads_preferences_settings_surface',
    }),
    'read-route:settings-audience-and-tagging': Object.freeze({
      routeTemplate: '/settings/audience_and_tagging',
      capability: 'risk-reviewed.settings-audience-tagging.inspect',
      intent: 'inspect_audience_tagging_settings_surface',
    }),
    'read-route:settings-autoplay': Object.freeze({
      routeTemplate: '/settings/autoplay',
      capability: 'risk-reviewed.settings-autoplay.inspect',
      intent: 'inspect_autoplay_settings_surface',
    }),
    'read-route:settings-blocked-all': Object.freeze({
      routeTemplate: '/settings/blocked/all',
      capability: 'risk-reviewed.settings-blocked-all.inspect',
      intent: 'inspect_blocked_accounts_settings_surface',
    }),
    'read-route:settings-connected-accounts': Object.freeze({
      routeTemplate: '/settings/connected_accounts',
      capability: 'risk-reviewed.settings-connected-accounts.inspect',
      intent: 'inspect_connected_accounts_settings_surface',
    }),
    'read-route:settings-contacts': Object.freeze({
      routeTemplate: '/settings/contacts',
      capability: 'risk-reviewed.settings-contacts.inspect',
      intent: 'inspect_contacts_settings_surface',
    }),
    'read-route:settings-contacts-dashboard': Object.freeze({
      routeTemplate: '/settings/contacts_dashboard',
      capability: 'risk-reviewed.settings-contacts-dashboard.inspect',
      intent: 'inspect_contacts_dashboard_settings_surface',
    }),
    'read-route:settings-content-you-see': Object.freeze({
      routeTemplate: '/settings/content_you_see',
      capability: 'risk-reviewed.settings-content-you-see.inspect',
      intent: 'inspect_content_you_see_settings_surface',
    }),
    'read-route:settings-data': Object.freeze({
      routeTemplate: '/settings/data',
      capability: 'risk-reviewed.settings-data-index.inspect',
      intent: 'inspect_data_settings_surface',
    }),
    'read-route:settings-data-sharing-with-business-partners': Object.freeze({
      routeTemplate: '/settings/data_sharing_with_business_partners',
      capability: 'risk-reviewed.settings-business-data-sharing.inspect',
      intent: 'inspect_business_data_sharing_settings_surface',
    }),
    'read-route:settings-deactivate': Object.freeze({
      routeTemplate: '/settings/deactivate',
      capability: 'risk-reviewed.settings-deactivation.inspect',
      intent: 'inspect_account_deactivation_settings_surface',
    }),
    'read-route:settings-delegate': Object.freeze({
      routeTemplate: '/settings/delegate',
      capability: 'risk-reviewed.settings-delegate.inspect',
      intent: 'inspect_delegate_settings_surface',
    }),
    'read-route:settings-delegate-groups': Object.freeze({
      routeTemplate: '/settings/delegate/groups',
      capability: 'risk-reviewed.settings-delegate-groups.inspect',
      intent: 'inspect_delegate_groups_settings_surface',
    }),
    'read-route:settings-delegate-members': Object.freeze({
      routeTemplate: '/settings/delegate/members',
      capability: 'risk-reviewed.settings-delegate-members.inspect',
      intent: 'inspect_delegate_members_settings_surface',
    }),
    'read-route:settings-direct-messages': Object.freeze({
      routeTemplate: '/settings/direct_messages',
      capability: 'risk-reviewed.settings-direct-messages.inspect',
      intent: 'inspect_direct_messages_settings_surface',
    }),
    'read-route:settings-display': Object.freeze({
      routeTemplate: '/settings/display',
      capability: 'risk-reviewed.settings-display.inspect',
      intent: 'inspect_display_settings_surface',
    }),
    'read-route:settings-download-your-data': Object.freeze({
      routeTemplate: '/settings/download_your_data',
      capability: 'risk-reviewed.settings-download-data.inspect',
      intent: 'inspect_download_data_settings_surface',
    }),
    'read-route:settings-email-notifications': Object.freeze({
      routeTemplate: '/settings/email_notifications',
      capability: 'risk-reviewed.settings-email-notifications-legacy.inspect',
      intent: 'inspect_legacy_email_notification_settings_surface',
    }),
    'read-route:settings-explore': Object.freeze({
      routeTemplate: '/settings/explore',
      capability: 'risk-reviewed.settings-explore.inspect',
      intent: 'inspect_explore_settings_surface',
    }),
    'read-route:settings-explore-location': Object.freeze({
      routeTemplate: '/settings/explore/location',
      capability: 'risk-reviewed.settings-explore-location.inspect',
      intent: 'inspect_explore_location_settings_surface',
    }),
    'read-route:settings-grok-settings': Object.freeze({
      routeTemplate: '/settings/grok_settings',
      capability: 'risk-reviewed.settings-grok.inspect',
      intent: 'inspect_grok_settings_surface',
    }),
    'read-route:settings-languages': Object.freeze({
      routeTemplate: '/settings/languages',
      capability: 'risk-reviewed.settings-languages.inspect',
      intent: 'inspect_language_settings_surface',
    }),
    'read-route:settings-location-information': Object.freeze({
      routeTemplate: '/settings/location_information',
      capability: 'risk-reviewed.settings-location-information.inspect',
      intent: 'inspect_location_information_settings_surface',
    }),
    'read-route:settings-manage-subscriptions': Object.freeze({
      routeTemplate: '/settings/manage_subscriptions',
      capability: 'risk-reviewed.settings-manage-subscriptions.inspect',
      intent: 'inspect_manage_subscriptions_settings_surface',
    }),
    'read-route:settings-monetization': Object.freeze({
      routeTemplate: '/settings/monetization',
      capability: 'risk-reviewed.settings-monetization.inspect',
      intent: 'inspect_monetization_settings_surface',
    }),
    'read-route:settings-mute-and-block': Object.freeze({
      routeTemplate: '/settings/mute_and_block',
      capability: 'risk-reviewed.settings-mute-block.inspect',
      intent: 'inspect_mute_block_settings_surface',
    }),
    'read-route:settings-muted-all': Object.freeze({
      routeTemplate: '/settings/muted/all',
      capability: 'risk-reviewed.settings-muted-all.inspect',
      intent: 'inspect_muted_accounts_settings_surface',
    }),
    'read-route:settings-muted-keywords': Object.freeze({
      routeTemplate: '/settings/muted_keywords',
      capability: 'risk-reviewed.settings-muted-keywords.inspect',
      intent: 'inspect_muted_keywords_settings_surface',
    }),
    'read-route:settings-notifications': Object.freeze({
      routeTemplate: '/settings/notifications',
      capability: 'risk-reviewed.settings-notifications.inspect',
      intent: 'inspect_notification_settings_surface',
    }),
    'read-route:settings-notifications-advanced-filters': Object.freeze({
      routeTemplate: '/settings/notifications/advanced_filters',
      capability: 'risk-reviewed.settings-notification-advanced-filters.inspect',
      intent: 'inspect_notification_advanced_filter_settings_surface',
    }),
    'read-route:settings-notifications-email': Object.freeze({
      routeTemplate: '/settings/notifications/email_notifications',
      capability: 'risk-reviewed.settings-email-notifications.inspect',
      intent: 'inspect_email_notification_settings_surface',
    }),
    'read-route:settings-notifications-filters': Object.freeze({
      routeTemplate: '/settings/notifications/filters',
      capability: 'risk-reviewed.settings-notification-filters.inspect',
      intent: 'inspect_notification_filter_settings_surface',
    }),
    'read-route:settings-notifications-preferences': Object.freeze({
      routeTemplate: '/settings/notifications/preferences',
      capability: 'risk-reviewed.settings-notification-preferences.inspect',
      intent: 'inspect_notification_preference_settings_surface',
    }),
    'read-route:settings-notifications-push': Object.freeze({
      routeTemplate: '/settings/notifications/push_notifications',
      capability: 'risk-reviewed.settings-push-notifications.inspect',
      intent: 'inspect_push_notification_settings_surface',
    }),
    'read-route:settings-off-twitter-activity': Object.freeze({
      routeTemplate: '/settings/off_twitter_activity',
      capability: 'risk-reviewed.settings-off-twitter-activity.inspect',
      intent: 'inspect_off_twitter_activity_settings_surface',
    }),
    'read-route:settings-push-notifications': Object.freeze({
      routeTemplate: '/settings/push_notifications',
      capability: 'risk-reviewed.settings-push-notifications-legacy.inspect',
      intent: 'inspect_legacy_push_notification_settings_surface',
    }),
    'read-route:settings-search': Object.freeze({
      routeTemplate: '/settings/search',
      capability: 'risk-reviewed.settings-search.inspect',
      intent: 'inspect_settings_search_surface',
    }),
    'read-route:settings-spaces': Object.freeze({
      routeTemplate: '/settings/spaces',
      capability: 'risk-reviewed.settings-spaces.inspect',
      intent: 'inspect_spaces_settings_surface',
    }),
    'read-route:settings-your-twitter-data': Object.freeze({
      routeTemplate: '/settings/your_twitter_data',
      capability: 'risk-reviewed.settings-data.inspect',
      intent: 'inspect_account_data_settings_index_surface',
    }),
    'read-route:settings-your-twitter-data-account': Object.freeze({
      routeTemplate: '/settings/your_twitter_data/account',
      capability: 'risk-reviewed.settings-data-account.inspect',
      intent: 'inspect_account_data_settings_surface',
    }),
    'read-route:settings-your-tweets': Object.freeze({
      routeTemplate: '/settings/your_tweets',
      capability: 'risk-reviewed.settings-your-tweets.inspect',
      intent: 'inspect_your_tweets_settings_surface',
    }),
    'read-route:internal-status': Object.freeze({
      routeTemplate: '/i/status/:id',
      capability: 'content.internal-status.inspect',
      intent: 'inspect_internal_status_redirect',
    }),
  }),
});

const GOOD_COVERAGE_STATUSES = new Set(['bounded', 'complete', 'passed']);

export const HELP = `Usage:
  node scripts/social-live-report.mjs [--runs-root <dir>] [--out-dir <dir>] [options]

Aggregates the latest X/Instagram live manifests into JSON and Markdown.

Options:
  --runs-root <dir>                 Root to scan. Default: runs.
  --out-dir <dir>                   Report output dir. Default: runs/social-live-report.
  --site <x|instagram|all>          Site filter. Default: all.
  --limit <n>                       Max manifests per site. Default: 10.
  --no-write                        Print report JSON without writing files.
  --json                            Print report JSON without human progress.
  --quiet                           Suppress human progress.
  --progress <auto|interactive|plain>
  --force-tty                       Force interactive progress rendering.
  --no-tty                          Force plain progress rendering.
  -h, --help                        Show this help.
`;

export function parseArgs(argv) {
  const options = {
    runsRoot: DEFAULT_RUNS_ROOT,
    outDir: DEFAULT_OUT_DIR,
    site: 'all',
    limit: '10',
    write: true,
    json: false,
    quiet: false,
    progressMode: undefined,
    forceTty: false,
    noTty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--progress=')) {
      options.progressMode = token.slice('--progress='.length);
      continue;
    }
    switch (token) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--no-write':
        options.write = false;
        break;
      case '--json':
        options.write = false;
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--force-tty':
        options.forceTty = true;
        break;
      case '--no-tty':
        options.noTty = true;
        break;
      case '--progress': {
        const { value, nextIndex } = readValue(argv, index, token);
        options.progressMode = value;
        index = nextIndex;
        break;
      }
      case '--runs-root':
      case '--out-dir':
      case '--site':
      case '--limit': {
        const { value, nextIndex } = readValue(argv, index, token);
        const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
        options[key] = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }
  if (!['x', 'instagram', 'all'].includes(String(options.site))) throw new Error(`Invalid --site: ${options.site}`);
  const limit = Number(options.limit);
  if (!Number.isFinite(limit) || limit < 1) throw new Error(`Invalid --limit: ${options.limit}`);
  return options;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findManifestFiles(root) {
  const resolved = path.resolve(root);
  if (!await pathExists(resolved)) return [];
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'manifest.json') {
        const info = await stat(full);
        files.push({ path: full, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(resolved);
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files;
}

async function findStateFiles(root) {
  const resolved = path.resolve(root);
  if (!await pathExists(resolved)) return [];
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'state.json') {
        const info = await stat(full);
        files.push({ path: full, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(resolved);
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files;
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

function normalizeSite(value) {
  const text = String(value ?? '').toLowerCase();
  if (text === 'twitter') return 'x';
  if (text === 'ig') return 'instagram';
  return text;
}

function normalizeArtifactVerdict(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'blocked-risk') {
    return 'blocked';
  }
  if ([
    'bounded',
    'blocked',
    'complete',
    'degraded',
    'failed',
    'incomplete',
    'passed',
    'running',
    'skipped',
    'stale',
    'unknown',
  ].includes(status)) {
    return status;
  }
  return 'unknown';
}

function cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

const INVENTORY_SAFE_ROUTE_SEGMENTS = new Set([
  'articles',
  'account',
  'accessibility',
  'accessibility_display_and_languages',
  'additional_resources',
  'about',
  'about_your_account',
  'advanced_filters',
  'analytics',
  'ads_preferences',
  'audience_and_tagging',
  'autoplay',
  'bookmarks',
  'chat',
  'compose',
  'communities',
  'connected_accounts',
  'content_you_see',
  'connect_people',
  'contacts',
  'creators',
  'data',
  'data_sharing_with_business_partners',
  'data_usage',
  'deactivate',
  'delegate',
  'direct_messages',
  'discoverability_and_contacts',
  'display',
  'download_your_data',
  'email_notifications',
  'filters',
  'explore',
  'for-you',
  'followers',
  'followers_you_follow',
  'following',
  'groups',
  'grok_settings',
  'grok',
  'highlights',
  'home',
  'i',
  'jf',
  'jobs',
  'keyboard_shortcuts',
  'languages',
  'likes',
  'login',
  'lists',
  'location',
  'location_information',
  'media',
  'members',
  'mentions',
  'messages',
  'mute_and_block',
  'notifications',
  'off_twitter_activity',
  'photo',
  'post',
  'premium_sign_up',
  'preferences',
  'privacy_and_safety',
  'push_notifications',
  'quotes',
  'retweets',
  'search',
  'security',
  'settings',
  'signup',
  'spaces',
  'status',
  'studio',
  'stories',
  'tabs',
  'verified',
  'verified_followers',
  'with_replies',
  'your_tweets',
  'your_twitter_data',
]);

const INVENTORY_SAFE_CONTROL_LABELS = new Set([
  'back',
  'bookmark',
  'close',
  'follow',
  'like',
  'login',
  'menu',
  'messages',
  'next',
  'notifications',
  'post',
  'profile',
  'reply',
  'repost',
  'retry',
  'search',
  'share',
  'skip',
  'translation',
]);

const INVENTORY_SAFE_FUNCTION_KINDS = new Set([
  'account.settings',
  'account.notifications-toggle',
  'auth.login',
  'commerce.premium-signup',
  'content.expand',
  'content.news-story-card',
  'content.translation-info',
  'content.translation-toggle',
  'compose.content-disclosure',
  'compose.gif',
  'compose.grok-image',
  'compose.location',
  'compose.poll',
  'compose.post',
  'compose.reply',
  'compose.reply-permissions',
  'compose.schedule',
  'engagement.bookmark-toggle',
  'engagement.like-toggle',
  'engagement.repost-toggle',
  'interactive.disabled-control',
  'interactive.unclassified-control',
  'media.viewer-control',
  'menu.open',
  'navigation.app-section',
  'navigation.back',
  'navigation.close',
  'navigation.content-detail',
  'navigation.link',
  'navigation.profile',
  'navigation.profile-tab',
  'navigation.skip',
  'navigation.tab',
  'navigation.unknown',
  'relation.follow-toggle',
  'search.input-or-filter',
  'search.results',
  'share.menu',
  'surface.display-node',
]);

const INVENTORY_SAFE_FUNCTION_INTENTS = new Set([
  'authenticate_session',
  'create_post',
  'create_reply',
  'add_post_gif',
  'add_post_location',
  'add_post_poll',
  'close_current_panel',
  'configure_content_disclosure',
  'configure_reply_permissions',
  'generate_post_image',
  'inspect_account_settings',
  'inspect_available_options',
  'inspect_content_detail',
  'inspect_media_viewer',
  'inspect_news_story_card',
  'inspect_premium_signup',
  'inspect_profile_surface',
  'inspect_search_results',
  'inspect_translation_info',
  'inspect_unclassified_interactive_control',
  'inspect_unknown_route',
  'mutate_bookmark_state',
  'mutate_follow_state',
  'mutate_like_state',
  'mutate_account_notification_state',
  'mutate_repost_state',
  'navigate_read_surface',
  'observe_disabled_interactive_control',
  'expand_content_text',
  'observe_surface_structure',
  'open_share_options',
  'refine_search_results',
  'schedule_post',
  'skip_to_content',
  'switch_read_surface',
  'toggle_content_translation',
]);

const INVENTORY_SAFE_EXECUTION_CLASSES = new Set([
  'auth-blocked',
  'mutation-blocked',
  'observed-only',
  'read-media-probe',
  'read-menu-probe',
  'read-navigation-probe',
  'read-search-probe',
  'read-tab-probe',
  'risk-reviewed-read-navigation',
  'side-effect-risk-blocked',
  'unknown-risk-blocked',
]);

const INVENTORY_SAFE_MUTATION_RISKS = new Set([
  'account-auth',
  'account-write-risk',
  'content-write',
  'engagement-write',
  'none',
  'notification-write',
  'private-content-risk',
  'purchase-risk',
  'relationship-write',
  'unknown-interaction-risk',
]);

const FUNCTION_KIND_DEFAULT_INTENTS = Object.freeze({
  'account.settings': 'inspect_account_settings',
  'account.notifications-toggle': 'mutate_account_notification_state',
  'auth.login': 'authenticate_session',
  'commerce.premium-signup': 'inspect_premium_signup',
  'content.expand': 'expand_content_text',
  'content.news-story-card': 'inspect_news_story_card',
  'content.translation-info': 'inspect_translation_info',
  'content.translation-toggle': 'toggle_content_translation',
  'compose.content-disclosure': 'configure_content_disclosure',
  'compose.gif': 'add_post_gif',
  'compose.grok-image': 'generate_post_image',
  'compose.location': 'add_post_location',
  'compose.poll': 'add_post_poll',
  'compose.post': 'create_post',
  'compose.reply': 'create_reply',
  'compose.reply-permissions': 'configure_reply_permissions',
  'compose.schedule': 'schedule_post',
  'engagement.bookmark-toggle': 'mutate_bookmark_state',
  'engagement.like-toggle': 'mutate_like_state',
  'engagement.repost-toggle': 'mutate_repost_state',
  'interactive.disabled-control': 'observe_disabled_interactive_control',
  'interactive.unclassified-control': 'inspect_unclassified_interactive_control',
  'media.viewer-control': 'inspect_media_viewer',
  'menu.open': 'inspect_available_options',
  'navigation.app-section': 'navigate_read_surface',
  'navigation.back': 'navigate_read_surface',
  'navigation.close': 'close_current_panel',
  'navigation.content-detail': 'inspect_content_detail',
  'navigation.link': 'navigate_read_surface',
  'navigation.profile': 'inspect_profile_surface',
  'navigation.profile-tab': 'switch_read_surface',
  'navigation.skip': 'skip_to_content',
  'navigation.tab': 'switch_read_surface',
  'navigation.unknown': 'inspect_unknown_route',
  'relation.follow-toggle': 'mutate_follow_state',
  'search.input-or-filter': 'refine_search_results',
  'search.results': 'inspect_search_results',
  'share.menu': 'open_share_options',
  'surface.display-node': 'observe_surface_structure',
});

function safeInventoryToken(value) {
  const text = cleanString(value);
  if (!text) return null;
  let token = text.toLowerCase().replace(/\d{4,}/gu, ':id');
  if (/^useravatar-container-[a-z0-9_:-]+$/u.test(token)) {
    token = 'useravatar-container-:account';
  }
  if (token.length > 80 || !/^[a-z0-9:_/-]+$/u.test(token)) return null;
  if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(token)) return null;
  return token;
}

function safeInventoryLabelKind(value) {
  const token = safeInventoryToken(value);
  return token && INVENTORY_SAFE_CONTROL_LABELS.has(token) ? token : null;
}

function safeInventoryDescriptor(value, allowedValues) {
  const text = cleanString(value);
  if (!text) return null;
  const token = text.toLowerCase();
  return allowedValues.has(token) ? token : null;
}

function isSafeStructureRouteSegment(segments = [], index = 0, segment = '') {
  const lower = String(segment ?? '').toLowerCase();
  if (index === 0 || !/^[a-z][a-z0-9_]{1,63}$/u.test(lower)) return false;
  if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(lower)) return false;
  const root = String(segments[0] ?? '').toLowerCase();
  return root === 'settings' || root === 'notifications';
}

function safeInventoryRouteTemplate(value) {
  const raw = cleanString(value);
  if (!raw || !raw.startsWith('/')) return null;
  if (/(?:auth|bearer|cookie|ct0|password|secret|session|token)/iu.test(raw)) return null;
  const [rawPath, rawQuery = ''] = raw.split('?');
  if (rawPath === '/compose/:segment') {
    return '/compose/post';
  }
  const rawSegments = rawPath.split('/').filter(Boolean);
  const segments = rawSegments.map((segment, index) => {
    const lower = segment.toLowerCase();
    if (/^:[a-z0-9_-]+$/u.test(lower)) return lower;
    if (/^\d+$/u.test(lower)) return ':id';
    if (INVENTORY_SAFE_ROUTE_SEGMENTS.has(lower) || isSafeStructureRouteSegment(rawSegments, index, lower)) return lower;
    return index === 0 ? ':account' : ':segment';
  });
  const pathTemplate = segments.length ? `/${segments.join('/')}` : '/';
  if (!rawQuery || pathTemplate !== '/search') {
    return pathTemplate;
  }
  const params = [];
  for (const part of rawQuery.split('&')) {
    const [rawKey] = part.split('=');
    const key = safeInventoryToken(rawKey);
    if (key === 'q') params.push('q=:query');
    if (key === 'src') params.push('src=:src');
    if (key === 'f') params.push('f=:filter');
  }
  return params.length ? `${pathTemplate}?${params.join('&')}` : pathTemplate;
}

function classifyInventoryControlFunction(control = {}) {
  const role = String(control.role ?? '').toLowerCase();
  const testId = String(control.testId ?? '').toLowerCase();
  const labelKind = String(control.labelKind ?? '').toLowerCase();
  const routeTemplate = String(control.routeTemplate ?? '').toLowerCase();
  const ancestorTestId = String(control.ancestorTestId ?? '').toLowerCase();
  const descendantTestId = String(control.descendantTestId ?? '').toLowerCase();
  const descendantLabelKind = String(control.descendantLabelKind ?? '').toLowerCase();
  const iconSignature = String(control.iconSignature ?? '').toLowerCase();
  const surfaceRouteTemplate = String(control.surfaceRouteTemplate ?? '').toLowerCase();
  const key = `${role} ${testId} ${labelKind} ${routeTemplate} ${ancestorTestId} ${descendantTestId} ${descendantLabelKind} ${iconSignature}`;
  const has = (...tokens) => tokens.some((token) => key.includes(token));
  if (control.disabled === true && ['button', 'link', 'menuitem'].includes(role)) {
    return { functionKind: 'interactive.disabled-control', intent: 'observe_disabled_interactive_control', executionClass: 'observed-only', mutationRisk: 'none' };
  }
  if (has('login', 'sign-in')) {
    return { functionKind: 'auth.login', intent: 'authenticate_session', executionClass: 'auth-blocked', mutationRisk: 'account-auth' };
  }
  if (has('follow', 'unfollow')) {
    return { functionKind: 'relation.follow-toggle', intent: 'mutate_follow_state', executionClass: 'mutation-blocked', mutationRisk: 'relationship-write' };
  }
  if (has('like')) {
    return { functionKind: 'engagement.like-toggle', intent: 'mutate_like_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
  }
  if (has('retweet', 'repost')) {
    return { functionKind: 'engagement.repost-toggle', intent: 'mutate_repost_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
  }
  if (has('reply')) {
    return { functionKind: 'compose.reply', intent: 'create_reply', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('bookmark')) {
    return { functionKind: 'engagement.bookmark-toggle', intent: 'mutate_bookmark_state', executionClass: 'mutation-blocked', mutationRisk: 'engagement-write' };
  }
  if (has('tweetbutton', 'newtweet', 'compose') || labelKind === 'post') {
    return { functionKind: 'compose.post', intent: 'create_post', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('contentdisclosurebutton')) {
    return { functionKind: 'compose.content-disclosure', intent: 'configure_content_disclosure', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('createpollbutton')) {
    return { functionKind: 'compose.poll', intent: 'add_post_poll', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('gifsearchbutton')) {
    return { functionKind: 'compose.gif', intent: 'add_post_gif', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('geobutton')) {
    return { functionKind: 'compose.location', intent: 'add_post_location', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('grokimggen')) {
    return { functionKind: 'compose.grok-image', intent: 'generate_post_image', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (has('scheduleoption')) {
    return { functionKind: 'compose.schedule', intent: 'schedule_post', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-296-mcszmllvlcllllzm') {
    return { functionKind: 'compose.reply-permissions', intent: 'configure_reply_permissions', executionClass: 'mutation-blocked', mutationRisk: 'content-write' };
  }
  if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-999-mhlclclvlclclhlc') {
    return { functionKind: 'content.translation-info', intent: 'inspect_translation_info', executionClass: 'read-menu-probe', mutationRisk: 'none' };
  }
  if (labelKind === 'translation') {
    return { functionKind: 'content.translation-toggle', intent: 'toggle_content_translation', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (ancestorTestId === 'tweet' && iconSignature === '0-0-24-24-1-199-mllvhvllzmlchcvh') {
    return { functionKind: 'share.menu', intent: 'open_share_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
  }
  if (ancestorTestId === 'primarycolumn' && iconSignature === '0-0-24-24-1-253-mvhvhvhvhvhvhzmh') {
    return { functionKind: 'account.notifications-toggle', intent: 'mutate_account_notification_state', executionClass: 'mutation-blocked', mutationRisk: 'notification-write' };
  }
  if (has('tweet-text-show-more-link', 'show-more')) {
    return { functionKind: 'content.expand', intent: 'expand_content_text', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (has('app-bar-back') || labelKind === 'back') {
    return { functionKind: 'navigation.back', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (has('app-bar-close') || labelKind === 'close') {
    return { functionKind: 'navigation.close', intent: 'close_current_panel', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (labelKind === 'skip') {
    return { functionKind: 'navigation.skip', intent: 'skip_to_content', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (has('chat-drawer', 'grokdrawer', 'accountswitcher')) {
    return { functionKind: 'menu.open', intent: 'inspect_available_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
  }
  if (has('share')) {
    return { functionKind: 'share.menu', intent: 'open_share_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
  }
  if (has('searchbox', 'searchfiltersadvancedsearch') || role === 'search' || role === 'combobox' || role === 'input' || labelKind === 'search') {
    return { functionKind: 'search.input-or-filter', intent: 'refine_search_results', executionClass: 'read-search-probe', mutationRisk: 'none' };
  }
  if (role === 'tab' || has('tab') || /\/(?:with_replies|media|highlights|following|followers|search)(?:[/?]|$)/u.test(routeTemplate)) {
    return { functionKind: 'navigation.tab', intent: 'switch_read_surface', executionClass: 'read-tab-probe', mutationRisk: 'none' };
  }
  if (has('pilllabel')) {
    return { functionKind: 'navigation.tab', intent: 'switch_read_surface', executionClass: 'read-tab-probe', mutationRisk: 'none' };
  }
  if (has('menu', 'overflow', 'caret', 'useractions')) {
    return { functionKind: 'menu.open', intent: 'inspect_available_options', executionClass: 'read-menu-probe', mutationRisk: 'none' };
  }
  if (has('video', 'player', 'scrollsnap', 'photo', 'media')) {
    return { functionKind: 'media.viewer-control', intent: 'inspect_media_viewer', executionClass: 'read-media-probe', mutationRisk: 'none' };
  }
  if (
    surfaceRouteTemplate.startsWith('/settings')
    && role === 'button'
    && !testId
    && !labelKind
    && !routeTemplate
    && !ancestorTestId
    && !descendantTestId
    && !descendantLabelKind
    && !iconSignature
  ) {
    return { functionKind: 'account.settings', intent: 'inspect_account_settings', executionClass: 'side-effect-risk-blocked', mutationRisk: 'account-write-risk' };
  }
  if (routeTemplate) {
    return { functionKind: 'navigation.link', intent: 'navigate_read_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (has('usercell', 'useravatar-container-:account')) {
    return { functionKind: 'navigation.profile', intent: 'inspect_profile_surface', executionClass: 'read-navigation-probe', mutationRisk: 'none' };
  }
  if (['button', 'link', 'menuitem'].includes(role)) {
    return { functionKind: 'interactive.unclassified-control', intent: 'inspect_unclassified_interactive_control', executionClass: 'unknown-risk-blocked', mutationRisk: 'unknown-interaction-risk' };
  }
  return { functionKind: 'surface.display-node', intent: 'observe_surface_structure', executionClass: 'observed-only', mutationRisk: 'none' };
}

function normalizeInventoryControlFunction(raw = {}, fallbackControl = {}) {
  const fallback = classifyInventoryControlFunction(fallbackControl);
  const rawFunctionKind = safeInventoryDescriptor(raw?.functionKind, INVENTORY_SAFE_FUNCTION_KINDS);
  const preferFallback = rawFunctionKind === 'interactive.unclassified-control'
    && fallback.functionKind
    && fallback.functionKind !== rawFunctionKind;
  return {
    functionKind: preferFallback ? fallback.functionKind : rawFunctionKind ?? fallback.functionKind,
    intent: preferFallback ? fallback.intent : safeInventoryDescriptor(raw?.intent, INVENTORY_SAFE_FUNCTION_INTENTS) ?? fallback.intent,
    executionClass: preferFallback ? fallback.executionClass : safeInventoryDescriptor(raw?.executionClass, INVENTORY_SAFE_EXECUTION_CLASSES) ?? fallback.executionClass,
    mutationRisk: preferFallback ? fallback.mutationRisk : safeInventoryDescriptor(raw?.mutationRisk, INVENTORY_SAFE_MUTATION_RISKS) ?? fallback.mutationRisk,
  };
}

function summarizeInventoryControlFunctions(controls = [], limit = 80) {
  const counts = new Map();
  const samples = new Map();
  for (const control of controls) {
    const fn = normalizeInventoryControlFunction(control, control);
    const key = `${fn.executionClass}:${fn.functionKind}:${fn.intent}:${fn.mutationRisk}`;
    counts.set(key, (counts.get(key) ?? 0) + numberOrZero(control.count ?? 1));
    if (!samples.has(key)) {
      samples.set(key, fn);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({
      ...samples.get(key),
      count,
    }));
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function surfaceIdFromPlan(plan = {}) {
  const action = cleanString(plan?.action);
  if (!action) return null;
  if (action === 'profile-content') {
    return `${action}:${cleanString(plan?.contentType) ?? 'posts'}`;
  }
  if (action === 'read-route') {
    return `${action}:${cleanString(plan?.routeName) ?? cleanString(plan?.routePath) ?? 'unknown'}`;
  }
  return action;
}

function expectedTargetOperations(site, surface) {
  return TARGET_OPERATIONS_BY_SURFACE[site]?.[surface] ?? [];
}

function surfaceDetail(site, surface) {
  return SURFACE_DETAILS_BY_SITE[site]?.[surface] ?? {};
}

function captureSummaryFromManifest(manifest = {}, site, surface) {
  const capture = manifest?.archive?.capture ?? manifest?.apiSummary ?? null;
  const samples = Array.isArray(capture?.samples) ? capture.samples : [];
  const operations = dedupeStrings([
    ...(Array.isArray(capture?.operations) ? capture.operations : []),
    ...samples.map((sample) => sample?.operationName),
  ]);
  const productiveOperations = dedupeStrings(samples
    .filter((sample) => numberOrZero(sample?.itemCount) > 0 || numberOrZero(sample?.userCount) > 0)
    .map((sample) => sample?.operationName));
  const expectedOperations = expectedTargetOperations(site, surface);
  const targetOperations = expectedOperations.length
    ? operations.filter((operation) => expectedOperations.includes(operation))
    : productiveOperations;
  return {
    operations,
    targetOperations,
    requestCount: capture?.requestCount ?? null,
    responseCount: capture?.responseCount ?? null,
    parsedResponseCount: capture?.parsedResponseCount ?? null,
  };
}

function targetOperationsFromSurfaceEvidence(site, surface, {
  capture = {},
  controlProbe = {},
  readCrawl = {},
} = {}) {
  const captureEvidence = /** @type {any} */ (capture);
  const controlProbeEvidence = /** @type {any} */ (controlProbe);
  const readCrawlEvidence = /** @type {any} */ (readCrawl);
  const expectedOperations = expectedTargetOperations(site, surface);
  if (!expectedOperations.length) {
    return captureEvidence.targetOperations ?? [];
  }
  const evidenceOperations = dedupeStrings([
    ...(captureEvidence.operations ?? []),
    ...(controlProbeEvidence.apiOperations ?? []),
    ...(controlProbeEvidence.apiReadLikeOperations ?? []),
    ...(readCrawlEvidence.apiOperations ?? []),
    ...(readCrawlEvidence.apiReadLikeOperations ?? []),
  ]);
  return evidenceOperations.filter((operation) => expectedOperations.includes(operation));
}

function inventorySummaryFromManifest(manifest = {}) {
  const inventory = manifest?.surfaceInventory && typeof manifest.surfaceInventory === 'object'
    ? manifest.surfaceInventory
    : null;
  if (!inventory) {
    return {
      observed: false,
      finishedAt: manifest?.finishedAt ?? manifest?.generatedAt ?? null,
      urlRouteTemplate: null,
      linkCount: 0,
      controlCount: 0,
      formCount: 0,
      linkRoutes: [],
      controls: [],
      controlFunctions: [],
      anonymousControls: [],
      forms: [],
    };
  }
  const linkRoutes = Array.isArray(inventory.linkRoutes) ? inventory.linkRoutes : [];
  const controls = Array.isArray(inventory.controls) ? inventory.controls : [];
  const forms = Array.isArray(inventory.forms) ? inventory.forms : [];
  const anonymousControls = Array.isArray(inventory.anonymousControls) ? inventory.anonymousControls : [];
  const urlRouteTemplate = safeInventoryRouteTemplate(inventory.urlRouteTemplate);
  const normalizedControls = controls.map((entry) => {
    const control = {
      role: safeInventoryToken(entry?.role),
      testId: safeInventoryToken(entry?.testId),
      labelKind: safeInventoryLabelKind(entry?.labelKind ?? entry?.labelKey),
      ancestorTestId: safeInventoryToken(entry?.ancestorTestId),
      descendantTestId: safeInventoryToken(entry?.descendantTestId),
      descendantLabelKind: safeInventoryLabelKind(entry?.descendantLabelKind),
      iconSignature: safeInventoryToken(entry?.iconSignature),
      routeTemplate: safeInventoryRouteTemplate(entry?.routeTemplate),
      surfaceRouteTemplate: urlRouteTemplate,
      disabled: entry?.disabled === true,
      count: numberOrZero(entry?.count),
    };
    return {
      ...control,
      ...normalizeInventoryControlFunction(entry, control),
    };
  }).filter((entry) => entry.role || entry.testId || entry.labelKind || entry.routeTemplate);
  return {
    observed: true,
    finishedAt: manifest?.finishedAt ?? manifest?.generatedAt ?? null,
    urlRouteTemplate,
    linkCount: numberOrZero(inventory.linkCount),
    controlCount: numberOrZero(inventory.controlCount),
    formCount: numberOrZero(inventory.formCount),
    linkRoutes: linkRoutes.map((entry) => ({
      kind: safeInventoryToken(entry?.kind),
      routeTemplate: safeInventoryRouteTemplate(entry?.routeTemplate),
      count: numberOrZero(entry?.count),
    })).filter((entry) => entry.kind || entry.routeTemplate),
    controls: normalizedControls,
    controlFunctions: summarizeInventoryControlFunctions(normalizedControls),
    anonymousControls: anonymousControls.map((entry) => ({
      role: safeInventoryToken(entry?.role),
      type: safeInventoryToken(entry?.type),
      disabled: entry?.disabled === true,
      closestRole: safeInventoryToken(entry?.closestRole),
      inArticle: entry?.inArticle === true,
      inDialog: entry?.inDialog === true,
      inForm: entry?.inForm === true,
      closestLinkKind: safeInventoryToken(entry?.closestLinkKind),
      closestLinkRouteTemplate: safeInventoryRouteTemplate(entry?.closestLinkRouteTemplate),
      svgCount: numberOrZero(entry?.svgCount),
      imageCount: numberOrZero(entry?.imageCount),
      childElementCount: numberOrZero(entry?.childElementCount),
      count: numberOrZero(entry?.count),
    })).filter((entry) => (
      entry.role
      || entry.type
      || entry.closestRole
      || entry.closestLinkKind
      || entry.closestLinkRouteTemplate
      || entry.svgCount
      || entry.imageCount
      || entry.childElementCount
      || entry.count
    )),
    forms: forms.map((entry) => ({
      role: safeInventoryToken(entry?.role),
      inputCount: numberOrZero(entry?.inputCount),
      buttonCount: numberOrZero(entry?.buttonCount),
      actionRouteTemplate: safeInventoryRouteTemplate(entry?.actionRouteTemplate),
    })),
  };
}

function safeProbeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return ['passed', 'failed', 'skipped'].includes(status) ? status : null;
}

function controlProbeSummaryFromManifest(manifest = {}) {
  const probe = manifest?.controlProbe && typeof manifest.controlProbe === 'object'
    ? manifest.controlProbe
    : null;
  if (!probe) {
    return {
      observed: false,
      requested: false,
      candidateCount: 0,
      selectedCount: 0,
      executedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      mutationBlockedCount: 0,
      functionKinds: [],
      executionClasses: [],
      mutationBlockedFunctionKinds: [],
      apiOperations: [],
      probes: [],
    };
  }
  const probes = (Array.isArray(probe.probes) ? probe.probes : []).map((entry) => {
    const normalized = normalizeInventoryControlFunction(entry, entry);
    return {
      status: safeProbeStatus(entry?.status) ?? 'skipped',
      action: safeInventoryToken(entry?.action),
      functionKind: normalized.functionKind,
      intent: normalized.intent,
      executionClass: normalized.executionClass,
      mutationRisk: normalized.mutationRisk,
      routeTemplate: safeInventoryRouteTemplate(entry?.routeTemplate),
      controlKey: safeInventoryToken(entry?.controlKey),
      changedRoute: entry?.changedRoute === true,
      openedDialog: entry?.openedDialog === true,
      openedMenu: entry?.openedMenu === true,
    };
  });
  const mutationBlockedFunctions = (Array.isArray(probe.mutationBlockedFunctions) ? probe.mutationBlockedFunctions : [])
    .map((entry) => normalizeInventoryControlFunction(entry, entry))
    .filter((entry) => entry.executionClass === 'mutation-blocked');
  const apiOperations = dedupeStrings(Array.isArray(probe.api?.operations) ? probe.api.operations : []);
  const sideEffectPattern = /(?:mutation|update|subscribe|subscription|authenticate|log(?:\.json)?)/iu;
  const apiSideEffectRiskOperations = dedupeStrings([
    ...(Array.isArray(probe.api?.sideEffectRiskOperations) ? probe.api.sideEffectRiskOperations : []),
    ...apiOperations.filter((operation) => sideEffectPattern.test(operation)),
  ]);
  const apiReadLikeOperations = dedupeStrings([
    ...(Array.isArray(probe.api?.readLikeOperations) ? probe.api.readLikeOperations : []),
    ...apiOperations.filter((operation) => !sideEffectPattern.test(operation)),
  ]);
  return {
    observed: true,
    requested: probe.requested === true,
    candidateCount: numberOrZero(probe.candidateCount),
    selectedCount: numberOrZero(probe.selectedCount),
    executedCount: numberOrZero(probe.executedCount),
    skippedCount: numberOrZero(probe.skippedCount),
    failedCount: numberOrZero(probe.failedCount),
    mutationBlockedCount: numberOrZero(probe.mutationBlockedCount),
    functionKinds: dedupeStrings(probes.map((entry) => entry.functionKind)),
    executionClasses: dedupeStrings(probes.map((entry) => entry.executionClass)),
    mutationBlockedFunctionKinds: dedupeStrings(mutationBlockedFunctions.map((entry) => entry.functionKind)),
    apiResponseCount: numberOrZero(probe.api?.responseCount),
    apiOperations,
    apiReadLikeOperations,
    apiSideEffectRiskOperations,
    probes,
  };
}

function emptyReadCrawlSummary() {
  return {
    observed: false,
    requested: false,
    maxPages: 0,
    maxDepth: 0,
    visitedCount: 0,
    queuedCount: 0,
    pendingQueueCount: 0,
    exhausted: false,
    discoveredRouteTemplateCount: 0,
    discoveredRouteTemplates: [],
    functionKinds: [],
    executionClasses: [],
    blockedRouteCount: 0,
    blockedFunctions: [],
    apiResponseCount: 0,
    apiOperations: [],
    apiReadLikeOperations: [],
    apiSideEffectRiskOperations: [],
    apiOperationRisk: [],
    apiOperationRiskSummary: {
      total: 0,
      readLikeCount: 0,
      replayBlockedCount: 0,
      sideEffectRiskCount: 0,
    },
    routeTemplateReplaySummary: {
      total: 0,
      visitedRouteTemplateCount: 0,
      redirectedRouteTemplateCount: 0,
      candidateOnlyRouteTemplateCount: 0,
      blockedRouteTemplateCount: 0,
      allExhausted: false,
    },
    routeTemplateReplayCoverage: [],
    routeSamples: [],
    pages: [],
  };
}

function normalizeReadCrawlFunction(entry = {}) {
  const normalized = normalizeInventoryControlFunction(entry, entry);
  return {
    routeTemplate: safeInventoryRouteTemplate(entry?.routeTemplate),
    functionKind: normalized.functionKind,
    intent: normalized.intent,
    executionClass: normalized.executionClass,
    mutationRisk: normalized.mutationRisk,
    count: numberOrZero(entry?.count ?? 1),
  };
}

function safeReadCrawlPageStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return ['degraded', 'failed', 'passed'].includes(status) ? status : 'failed';
}

function safeRouteSample(sample = {}) {
  const routeTemplate = safeInventoryRouteTemplate(sample?.routeTemplate);
  if (!routeTemplate) return null;
  const safeShapeToken = (value) => safeInventoryToken(value);
  const safeValueClass = (value) => {
    const text = cleanString(value);
    if (!text) return null;
    const token = text.toLowerCase();
    if (token === 'handle-or-token') return 'handle-like';
    return safeInventoryToken(value);
  };
  return {
    routeTemplate,
    pathDepth: numberOrZero(sample?.pathDepth),
    dynamicSegmentCount: numberOrZero(sample?.dynamicSegmentCount),
    segmentShapes: (Array.isArray(sample?.segmentShapes) ? sample.segmentShapes : [])
      .map((entry) => ({
        kind: safeShapeToken(entry?.kind),
        value: entry?.kind === 'static' ? safeShapeToken(entry?.value) : null,
        valueLength: numberOrZero(entry?.valueLength),
        valueClass: safeValueClass(entry?.valueClass),
      }))
      .filter((entry) => entry.kind),
    queryKeys: dedupeStrings((Array.isArray(sample?.queryKeys) ? sample.queryKeys : [])
      .map(safeShapeToken)
      .filter(Boolean)),
    queryValueShapes: (Array.isArray(sample?.queryValueShapes) ? sample.queryValueShapes : [])
      .map((entry) => ({
        key: safeShapeToken(entry?.key),
        valueLength: numberOrZero(entry?.valueLength),
        tokenCount: numberOrZero(entry?.tokenCount),
        valueClass: safeValueClass(entry?.valueClass),
      }))
      .filter((entry) => entry.key),
  };
}

function dedupeRouteSamples(samples = []) {
  const seen = new Set();
  const result = [];
  for (const sample of samples) {
    const normalized = safeRouteSample(sample);
    if (!normalized) continue;
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function classifyApiOperationRisk(operation) {
  const text = cleanString(operation);
  if (!text) return null;
  const operationClass = OBSERVED_API_OPERATION_CLASSES[text];
  if (operationClass === 'auth-replay-blocked') {
    return {
      operation: text,
      riskClass: 'auth-session-risk',
      replayDisposition: 'replay-blocked',
      reason: 'authentication/session operation class',
    };
  }
  if (operationClass === 'telemetry-or-ad') {
    return {
      operation: text,
      riskClass: 'telemetry-write-risk',
      replayDisposition: 'replay-blocked',
      reason: 'telemetry/ad operation class',
    };
  }
  if (operationClass === 'side-effect-risk') {
    return {
      operation: text,
      riskClass: 'side-effect-risk',
      replayDisposition: 'replay-blocked',
      reason: 'side-effect operation class',
    };
  }
  if (operationClass === 'content-write-risk') {
    return {
      operation: text,
      riskClass: 'content-write-risk',
      replayDisposition: 'replay-blocked',
      reason: 'content write-risk operation class',
    };
  }
  if (/log\.json$/iu.test(text) || /^log\.json$/iu.test(text)) {
    return {
      operation: text,
      riskClass: 'telemetry-write-risk',
      replayDisposition: 'replay-blocked',
      reason: 'telemetry/log endpoint',
    };
  }
  if (/(?:^|[._/-])auth(?:enticate|entication)?|authenticate/iu.test(text)) {
    return {
      operation: text,
      riskClass: 'auth-session-risk',
      replayDisposition: 'replay-blocked',
      reason: 'authentication/session operation',
    };
  }
  if (/(?:mutation|update|subscribe|subscription)/iu.test(text)) {
    return {
      operation: text,
      riskClass: 'possible-write-risk',
      replayDisposition: 'replay-blocked',
      reason: 'write-like operation name',
    };
  }
  return {
    operation: text,
    riskClass: 'read-like',
    replayDisposition: 'read-replay-eligible',
    reason: null,
  };
}

function summarizeApiOperationRisk(entries = []) {
  return {
    total: entries.length,
    readLikeCount: entries.filter((entry) => entry.riskClass === 'read-like').length,
    replayBlockedCount: entries.filter((entry) => entry.replayDisposition === 'replay-blocked').length,
    sideEffectRiskCount: entries.filter((entry) => entry.riskClass !== 'read-like').length,
  };
}

function buildApiOperationRisk(api = {}) {
  const operations = dedupeStrings([
    ...(Array.isArray(api.operations) ? api.operations : []),
    ...(Array.isArray(api.readLikeOperations) ? api.readLikeOperations : []),
    ...(Array.isArray(api.sideEffectRiskOperations) ? api.sideEffectRiskOperations : []),
  ]);
  const apiOperationRisk = operations
    .map(classifyApiOperationRisk)
    .filter(Boolean);
  return {
    apiOperationRisk,
    apiOperationRiskSummary: summarizeApiOperationRisk(apiOperationRisk),
    apiReadLikeOperations: dedupeStrings([
      ...(Array.isArray(api.readLikeOperations) ? api.readLikeOperations : []),
      ...apiOperationRisk
        .filter((entry) => entry.riskClass === 'read-like')
        .map((entry) => entry.operation),
    ]),
    apiSideEffectRiskOperations: dedupeStrings([
      ...(Array.isArray(api.sideEffectRiskOperations) ? api.sideEffectRiskOperations : []),
      ...apiOperationRisk
        .filter((entry) => entry.riskClass !== 'read-like')
        .map((entry) => entry.operation),
    ]),
  };
}

function replayDispositionForRouteAudit(entry = {}) {
  if (Array.isArray(entry.redirectedToRouteTemplates) && entry.redirectedToRouteTemplates.length > 0) return 'redirected-route';
  if (numberOrZero(entry.observedAsPageCount) > 0) return 'visited-route';
  if (numberOrZero(entry.blockedFunctionCount) > 0) return 'blocked-risk';
  if (numberOrZero(entry.observedAsCandidateCount) > 0) return 'candidate-only';
  return 'unknown';
}

function routeAuditDispositionRank(value) {
  return {
    'blocked-risk': 3,
    'redirected-route': 2,
    'visited-route': 2,
    'candidate-only': 1,
    unknown: 0,
  }[String(value ?? '')] ?? 0;
}

function summarizeRouteTemplateReplayCoverage(routeTemplateReplayCoverage = [], allExhausted = false) {
  return {
    total: routeTemplateReplayCoverage.length,
    visitedRouteTemplateCount: routeTemplateReplayCoverage
      .filter((entry) => numberOrZero(entry.observedAsPageCount) > 0)
      .length,
    redirectedRouteTemplateCount: routeTemplateReplayCoverage
      .filter((entry) => entry.replayDisposition === 'redirected-route')
      .length,
    candidateOnlyRouteTemplateCount: routeTemplateReplayCoverage
      .filter((entry) => entry.replayDisposition === 'candidate-only')
      .length,
    blockedRouteTemplateCount: routeTemplateReplayCoverage
      .filter((entry) => entry.replayDisposition === 'blocked-risk')
      .length,
    allExhausted: allExhausted === true,
  };
}

function routeTemplateReplayCoverageFromReadCrawl(pages = [], blockedFunctions = []) {
  const byRoute = new Map();
  const ensure = (routeTemplate) => {
    const safeRoute = safeInventoryRouteTemplate(routeTemplate);
    if (!safeRoute) return null;
    if (!byRoute.has(safeRoute)) {
      byRoute.set(safeRoute, {
        routeTemplate: safeRoute,
        observedAsPageCount: 0,
        observedAsCandidateCount: 0,
        blockedFunctionCount: 0,
        surfaceCount: 1,
        pageStatuses: [],
        functionKinds: [],
        intents: [],
        executionClasses: [],
        mutationRisks: [],
        blockedFunctionKinds: [],
        blockedIntents: [],
        blockedExecutionClasses: [],
        blockedMutationRisks: [],
        redirectedToRouteTemplates: [],
        routeSamples: [],
      });
    }
    return byRoute.get(safeRoute);
  };
  for (const page of pages) {
    const route = ensure(page.routeTemplate);
    if (route) {
      route.observedAsPageCount += 1;
      route.pageStatuses = dedupeStrings([...route.pageStatuses, page.status]);
      route.functionKinds = dedupeStrings([...route.functionKinds, ...(page.functionKinds ?? [])]);
      route.executionClasses = dedupeStrings([...route.executionClasses, ...(page.executionClasses ?? [])]);
      route.routeSamples = dedupeRouteSamples([...route.routeSamples, page.routeSample]);
    }
    const requestedRoute = ensure(page.requestedRouteTemplate);
    if (requestedRoute && page.routeTemplate && requestedRoute.routeTemplate !== page.routeTemplate) {
      requestedRoute.redirectedToRouteTemplates = dedupeStrings([
        ...requestedRoute.redirectedToRouteTemplates,
        page.routeTemplate,
      ]);
      requestedRoute.pageStatuses = dedupeStrings([...requestedRoute.pageStatuses, page.status]);
      requestedRoute.functionKinds = dedupeStrings([...requestedRoute.functionKinds, ...(page.functionKinds ?? [])]);
      requestedRoute.executionClasses = dedupeStrings([...requestedRoute.executionClasses, ...(page.executionClasses ?? [])]);
    }
    for (const routeTemplate of page.readRouteTemplates ?? []) {
      const candidate = ensure(routeTemplate);
      if (!candidate) continue;
      candidate.observedAsCandidateCount += 1;
      candidate.functionKinds = dedupeStrings([...candidate.functionKinds, ...(page.functionKinds ?? [])]);
      candidate.executionClasses = dedupeStrings([...candidate.executionClasses, ...(page.executionClasses ?? [])]);
    }
    for (const sample of page.readRouteSamples ?? []) {
      const sampledRoute = ensure(sample?.routeTemplate);
      if (!sampledRoute) continue;
      sampledRoute.routeSamples = dedupeRouteSamples([...sampledRoute.routeSamples, sample]);
    }
  }
  for (const blocked of blockedFunctions) {
    const route = ensure(blocked.routeTemplate);
    if (!route) continue;
    route.blockedFunctionCount += numberOrZero(blocked.count ?? 1);
    route.functionKinds = dedupeStrings([...route.functionKinds, blocked.functionKind]);
    route.intents = dedupeStrings([...route.intents, blocked.intent]);
    route.executionClasses = dedupeStrings([...route.executionClasses, blocked.executionClass]);
    route.mutationRisks = dedupeStrings([...route.mutationRisks, blocked.mutationRisk]);
    route.blockedFunctionKinds = dedupeStrings([...route.blockedFunctionKinds, blocked.functionKind]);
    route.blockedIntents = dedupeStrings([...route.blockedIntents, blocked.intent]);
    route.blockedExecutionClasses = dedupeStrings([...route.blockedExecutionClasses, blocked.executionClass]);
    route.blockedMutationRisks = dedupeStrings([...route.blockedMutationRisks, blocked.mutationRisk]);
  }
  return [...byRoute.values()]
    .map((entry) => ({
      routeTemplate: entry.routeTemplate,
      observedAsPageCount: entry.observedAsPageCount,
      observedAsCandidateCount: entry.observedAsCandidateCount,
      blockedFunctionCount: entry.blockedFunctionCount,
      surfaceCount: entry.surfaceCount,
      pageStatuses: entry.pageStatuses,
      functionKinds: entry.functionKinds,
      intents: entry.intents,
      executionClasses: entry.executionClasses,
      mutationRisks: entry.mutationRisks,
      blockedFunctionKinds: entry.blockedFunctionKinds,
      blockedIntents: entry.blockedIntents,
      blockedExecutionClasses: entry.blockedExecutionClasses,
      blockedMutationRisks: entry.blockedMutationRisks,
      redirectedToRouteTemplates: entry.redirectedToRouteTemplates,
      routeSamples: entry.routeSamples,
      replayDisposition: replayDispositionForRouteAudit(entry),
    }))
    .sort((left, right) => (
      routeAuditDispositionRank(right.replayDisposition) - routeAuditDispositionRank(left.replayDisposition)
      || left.routeTemplate.localeCompare(right.routeTemplate)
    ));
}

function readCrawlSummaryFromManifest(manifest = {}) {
  const crawl = manifest?.readCrawl && typeof manifest.readCrawl === 'object'
    ? manifest.readCrawl
    : null;
  if (!crawl) {
    return emptyReadCrawlSummary();
  }
  const pages = (Array.isArray(crawl.pages) ? crawl.pages : []).map((page) => {
    const functionKinds = dedupeStrings((Array.isArray(page?.functionKinds) ? page.functionKinds : [])
      .map((value) => safeInventoryDescriptor(value, INVENTORY_SAFE_FUNCTION_KINDS))
      .filter(Boolean));
    const executionClasses = dedupeStrings((Array.isArray(page?.executionClasses) ? page.executionClasses : [])
      .map((value) => safeInventoryDescriptor(value, INVENTORY_SAFE_EXECUTION_CLASSES))
      .filter(Boolean));
    return {
      depth: numberOrZero(page?.depth),
      requestedRouteTemplate: safeInventoryRouteTemplate(page?.requestedRouteTemplate),
      routeTemplate: safeInventoryRouteTemplate(page?.routeTemplate),
      routeSample: safeRouteSample(page?.routeSample),
      status: safeReadCrawlPageStatus(page?.status),
      reason: safeInventoryToken(page?.reason),
      sourceRouteTemplate: safeInventoryRouteTemplate(page?.sourceRouteTemplate),
      linkCount: numberOrZero(page?.linkCount),
      controlCount: numberOrZero(page?.controlCount),
      candidateCount: numberOrZero(page?.candidateCount),
      readCandidateCount: numberOrZero(page?.readCandidateCount),
      blockedCandidateCount: numberOrZero(page?.blockedCandidateCount),
      readRouteTemplates: dedupeStrings((Array.isArray(page?.readRouteTemplates) ? page.readRouteTemplates : [])
        .map(safeInventoryRouteTemplate)
        .filter(Boolean)),
      readRouteSamples: dedupeRouteSamples(Array.isArray(page?.readRouteSamples) ? page.readRouteSamples : []),
      functionKinds,
      executionClasses,
    };
  });
  const blockedFunctions = (Array.isArray(crawl.blockedFunctions ?? crawl.blockedRoutes) ? (crawl.blockedFunctions ?? crawl.blockedRoutes) : [])
    .map(normalizeReadCrawlFunction)
    .filter((entry) => entry.routeTemplate || entry.functionKind || entry.executionClass);
  const apiOperations = dedupeStrings(Array.isArray(crawl.api?.operations) ? crawl.api.operations : []);
  const {
    apiOperationRisk,
    apiOperationRiskSummary,
    apiReadLikeOperations,
    apiSideEffectRiskOperations,
  } = buildApiOperationRisk(crawl.api);
  const discoveredRouteTemplates = dedupeStrings([
    ...(Array.isArray(crawl.discoveredRouteTemplates) ? crawl.discoveredRouteTemplates : []),
    ...pages.map((page) => page.routeTemplate),
    ...pages.flatMap((page) => page.readRouteTemplates),
  ].map(safeInventoryRouteTemplate).filter(Boolean));
  const functionKinds = dedupeStrings([
    ...(Array.isArray(crawl.functionKinds) ? crawl.functionKinds : []),
    ...pages.flatMap((page) => page.functionKinds),
    ...blockedFunctions.map((entry) => entry.functionKind),
  ].map((value) => safeInventoryDescriptor(value, INVENTORY_SAFE_FUNCTION_KINDS)).filter(Boolean));
  const executionClasses = dedupeStrings([
    ...(Array.isArray(crawl.executionClasses) ? crawl.executionClasses : []),
    ...pages.flatMap((page) => page.executionClasses),
    ...blockedFunctions.map((entry) => entry.executionClass),
  ].map((value) => safeInventoryDescriptor(value, INVENTORY_SAFE_EXECUTION_CLASSES)).filter(Boolean));
  const routeTemplateReplayCoverage = routeTemplateReplayCoverageFromReadCrawl(pages, blockedFunctions);
  const routeTemplateReplaySummary = summarizeRouteTemplateReplayCoverage(
    routeTemplateReplayCoverage,
    crawl.exhausted === true && numberOrZero(crawl.pendingQueueCount) === 0,
  );
  const routeSamples = dedupeRouteSamples([
    ...pages.map((page) => page.routeSample),
    ...pages.flatMap((page) => page.readRouteSamples ?? []),
  ]);
  return {
    observed: true,
    requested: crawl.requested === true,
    maxPages: numberOrZero(crawl.maxPages),
    maxDepth: numberOrZero(crawl.maxDepth),
    visitedCount: numberOrZero(crawl.visitedCount),
    queuedCount: numberOrZero(crawl.queuedCount),
    pendingQueueCount: numberOrZero(crawl.pendingQueueCount),
    exhausted: crawl.exhausted === true,
    discoveredRouteTemplateCount: discoveredRouteTemplates.length,
    discoveredRouteTemplates,
    functionKinds,
    executionClasses,
    blockedRouteCount: numberOrZero(crawl.blockedRouteCount ?? blockedFunctions.length),
    blockedFunctions,
    apiResponseCount: numberOrZero(crawl.api?.responseCount),
    apiOperations,
    apiReadLikeOperations,
    apiSideEffectRiskOperations,
    apiOperationRisk,
    apiOperationRiskSummary,
    routeTemplateReplaySummary,
    routeTemplateReplayCoverage,
    routeSamples,
    pages,
  };
}

function coverageFieldsFromManifest(manifest = {}) {
  const site = normalizeSite(manifest?.site ?? manifest?.options?.site ?? manifest?.siteKey);
  const plan = manifest?.plan && typeof manifest.plan === 'object' ? manifest.plan : {};
  const surface = surfaceIdFromPlan(plan);
  if (!surface) return {};
  const completeness = manifest?.completeness && typeof manifest.completeness === 'object'
    ? manifest.completeness
    : {};
  const capture = captureSummaryFromManifest(manifest, site, surface);
  const inventory = inventorySummaryFromManifest(manifest);
  const controlProbe = controlProbeSummaryFromManifest(manifest);
  const readCrawl = readCrawlSummaryFromManifest(manifest);
  const targetOperations = targetOperationsFromSurfaceEvidence(site, surface, {
    capture,
    controlProbe,
    readCrawl,
  });
  const detail = surfaceDetail(site, surface);
  return {
    surface,
    action: cleanString(plan.action),
    contentType: cleanString(plan.contentType),
    routeTemplate: detail.routeTemplate ?? null,
    capability: detail.capability ?? null,
    intent: detail.intent ?? null,
    accountProvided: Boolean(cleanString(plan.account)),
    queryProvided: Boolean(cleanString(plan.query)),
    dateProvided: Boolean(cleanString(plan.date)),
    apiPages: numberOrZero(completeness.apiPages ?? manifest?.archive?.pages),
    itemCount: numberOrZero(completeness.itemCount ?? completeness.dedupedItemCount),
    userCount: numberOrZero(completeness.userCount),
    mediaCount: numberOrZero(completeness.mediaCount),
    operations: capture.operations,
    targetOperations,
    apiRequestCount: capture.requestCount,
    apiResponseCount: capture.responseCount,
    parsedApiResponseCount: capture.parsedResponseCount,
    surfaceInventory: inventory,
    controlProbe,
    readCrawl,
  };
}

function coverageFieldsFromState(state = {}) {
  const site = normalizeSite(state?.siteKey ?? state?.plan?.siteKey);
  const plan = state?.plan && typeof state.plan === 'object' ? state.plan : {};
  const surface = surfaceIdFromPlan(plan);
  if (!surface) return {};
  const detail = surfaceDetail(site, surface);
  return {
    surface,
    action: cleanString(plan.action),
    contentType: cleanString(plan.contentType),
    routeTemplate: detail.routeTemplate ?? null,
    capability: detail.capability ?? null,
    intent: detail.intent ?? null,
    accountProvided: Boolean(cleanString(plan.account)),
    queryProvided: Boolean(cleanString(plan.query)),
    dateProvided: Boolean(cleanString(plan.date)),
    apiPages: 0,
    itemCount: 0,
    userCount: 0,
    mediaCount: 0,
    operations: [],
    targetOperations: [],
    apiRequestCount: null,
    apiResponseCount: null,
    parsedApiResponseCount: null,
    surfaceInventory: {
      observed: false,
      urlRouteTemplate: null,
      linkCount: 0,
      controlCount: 0,
      formCount: 0,
      linkRoutes: [],
      controls: [],
      controlFunctions: [],
      forms: [],
    },
    controlProbe: {
      observed: false,
      requested: false,
      candidateCount: 0,
      selectedCount: 0,
      executedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      mutationBlockedCount: 0,
      functionKinds: [],
      executionClasses: [],
      mutationBlockedFunctionKinds: [],
      apiOperations: [],
      apiReadLikeOperations: [],
      apiSideEffectRiskOperations: [],
      probes: [],
    },
    readCrawl: emptyReadCrawlSummary(),
  };
}

function normalizeSessionGate(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const status = String(value.status ?? '').trim().toLowerCase();
  const reason = String(value.reason ?? '').trim();
  return {
    ok: value.ok === true,
    status: ['passed', 'blocked', 'unknown'].includes(status) ? status : 'unknown',
    reason: reason || null,
    provider: value.provider ?? null,
    healthManifest: value.healthManifest ?? null,
  };
}

function sessionGateFromSummary(summary = {}, manifest = {}) {
  return normalizeSessionGate(summary?.sessionGate ?? manifest?.sessionGate);
}

function resultRowsFromManifest(manifest, manifestPath, mtimeMs) {
  const rows = [];
  if (Array.isArray(manifest?.results)) {
    for (const result of manifest.results) {
      const artifactSummary = result.artifactSummary ?? {};
      rows.push({
        site: normalizeSite(result.site ?? manifest?.options?.site),
        id: result.id ?? manifest.runId ?? path.basename(path.dirname(manifestPath)),
        category: result.category ?? null,
        status: normalizeArtifactVerdict(artifactSummary.verdict),
        reason: artifactSummary.reason ?? result.reason ?? null,
        commandStatus: result.status ?? null,
        manifestPath,
        artifactManifestPath: artifactSummary.manifestPath ?? null,
        sessionGate: sessionGateFromSummary(artifactSummary),
        runId: manifest.runId ?? null,
        finishedAt: result.finishedAt ?? manifest.finishedAt ?? manifest.startedAt ?? new Date(mtimeMs).toISOString(),
      });
    }
  } else {
    const coverageFields = coverageFieldsFromManifest(manifest);
    rows.push({
      site: normalizeSite(manifest?.site ?? manifest?.options?.site ?? manifest?.siteKey),
      id: manifest?.id ?? manifest?.runId ?? path.basename(path.dirname(manifestPath)),
      category: manifest?.category ?? null,
      status: normalizeArtifactVerdict(manifest?.artifactSummary?.verdict ?? manifest?.outcome?.verdict ?? manifest?.outcome?.status ?? manifest?.completeness?.status ?? manifest?.status),
      reason: manifest?.outcome?.reason ?? manifest?.reason ?? manifest?.archive?.reason ?? null,
      commandStatus: null,
      manifestPath,
      artifactManifestPath: manifestPath,
      sessionGate: sessionGateFromSummary(manifest),
      runId: manifest?.runId ?? null,
      finishedAt: manifest?.finishedAt ?? manifest?.startedAt ?? manifest?.generatedAt ?? new Date(mtimeMs).toISOString(),
      ...coverageFields,
    });
  }
  return rows;
}

function normalizePathForMatch(value) {
  return path.resolve(String(value ?? '')).toLowerCase();
}

async function readActiveProcessCommandLines() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }',
      ], { timeout: 5_000, windowsHide: true });
      return stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    }
    const { stdout } = await execFileAsync('ps', ['-eo', 'command='], { timeout: 5_000 });
    return stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasActiveRunProcess(runDir, commandLines = []) {
  const normalizedRunDir = normalizePathForMatch(runDir);
  return commandLines.some((line) => line.toLowerCase().includes(normalizedRunDir));
}

function resultRowFromState(state, statePath, mtimeMs, activeCommandLines = []) {
  const runDir = state?.artifacts?.runDir ?? path.dirname(statePath);
  const rawStatus = String(state?.status ?? 'unknown');
  const runningState = ['started', 'running'].includes(rawStatus);
  const active = runningState && hasActiveRunProcess(runDir, activeCommandLines);
  return {
    site: normalizeSite(state?.siteKey ?? state?.plan?.siteKey),
    id: state?.plan?.action ?? path.basename(path.dirname(statePath)),
    category: 'state-only',
    status: runningState ? (active ? 'running' : 'stale') : rawStatus,
    reason: runningState ? (active ? 'process-active' : 'process-missing') : (state?.error ?? state?.archive?.reason ?? null),
    commandStatus: rawStatus,
    manifestPath: statePath,
    artifactManifestPath: null,
    runId: state?.runId ?? path.basename(path.dirname(statePath)),
    finishedAt: state?.completedAt ?? state?.updatedAt ?? state?.startedAt ?? new Date(mtimeMs).toISOString(),
    ...coverageFieldsFromState(state),
  };
}

function summarize(rows) {
  const bySite = {};
  for (const row of rows) {
    const site = row.site || 'unknown';
    bySite[site] ??= { total: 0, statuses: {}, sessionGates: {}, latestFinishedAt: null };
    bySite[site].total += 1;
    bySite[site].statuses[row.status] = (bySite[site].statuses[row.status] ?? 0) + 1;
    if (row.sessionGate?.status) {
      bySite[site].sessionGates[row.sessionGate.status] = (bySite[site].sessionGates[row.sessionGate.status] ?? 0) + 1;
    }
    if (!bySite[site].latestFinishedAt || String(row.finishedAt) > bySite[site].latestFinishedAt) {
      bySite[site].latestFinishedAt = row.finishedAt;
    }
  }
  return bySite;
}

function surfaceSortIndex(site, surface) {
  const expected = EXPECTED_SURFACES_BY_SITE[site] ?? [];
  const index = expected.indexOf(surface);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

const COVERAGE_STATUS_RANK = Object.freeze({
  passed: 5,
  complete: 5,
  bounded: 4,
  degraded: 3,
  incomplete: 2,
  blocked: 1,
  failed: 1,
  running: 0,
  skipped: 0,
  stale: 0,
  unknown: 0,
});

function coverageStatusRank(status) {
  return COVERAGE_STATUS_RANK[String(status ?? '')] ?? 0;
}

function rowEvidenceRank(row = {}) {
  return [
    coverageStatusRank(row.status),
    numberOrZero(row.apiPages) > 0 ? 3 : numberOrZero(row.apiResponseCount) > 0 ? 2 : numberOrZero(row.parsedApiResponseCount) > 0 ? 1 : 0,
    numberOrZero(row.itemCount) + numberOrZero(row.userCount) + numberOrZero(row.mediaCount) > 0 ? 1 : 0,
    String(row.finishedAt ?? ''),
  ];
}

function compareSurfaceEvidenceRows(left = {}, right = {}) {
  if (!right) return 1;
  const leftRank = rowEvidenceRank(left);
  const rightRank = rowEvidenceRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] === rightRank[index]) continue;
    return leftRank[index] > rightRank[index] ? 1 : -1;
  }
  return 0;
}

function maxNumber(values) {
  return values.reduce((max, value) => Math.max(max, numberOrZero(value)), 0);
}

function minPositiveNumber(values) {
  const numbers = values.map(numberOrZero).filter((value) => value > 0);
  return numbers.length ? Math.min(...numbers) : 0;
}

function mergeCountedEntriesByMax(entries, selector, keyFn, mapper, limit = 80) {
  const counts = new Map();
  const samples = new Map();
  for (const entryGroup of entries) {
    for (const entry of selector(entryGroup) ?? []) {
      const key = keyFn(entry);
      if (!key) continue;
      counts.set(key, Math.max(counts.get(key) ?? 0, numberOrZero(entry.count ?? 1)));
      if (!samples.has(key)) {
        samples.set(key, mapper(entry));
      }
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({
      ...samples.get(key),
      count,
    }));
}

function isUnknownRiskInventoryControl(control = {}) {
  return normalizeInventoryControlFunction(control, control).executionClass === 'unknown-risk-blocked';
}

function inventoryControlMergeKey(entry = {}) {
  return [
    entry.role || 'control',
    entry.testId || '',
    entry.labelKind || '',
    entry.routeTemplate || '',
    entry.descendantTestId || '',
    entry.descendantLabelKind || '',
    entry.ancestorTestId || '',
    entry.iconSignature || '',
    entry.disabled ? 'disabled' : 'enabled',
    entry.functionKind || '',
  ].join(':');
}

function mergeSurfaceInventory(rows) {
  const inventories = rows
    .map((row) => row.surfaceInventory)
    .filter((inventory) => inventory && typeof inventory === 'object');
  const observedInventories = inventories.filter((inventory) => inventory.observed === true);
  const latestObserved = observedInventories
    .sort((left, right) => String(right.finishedAt ?? '').localeCompare(String(left.finishedAt ?? '')))[0] ?? null;
  if (!observedInventories.length) {
    return {
      observed: false,
      finishedAt: null,
      urlRouteTemplate: null,
      linkCount: 0,
      controlCount: 0,
      formCount: 0,
      linkRoutes: [],
      controls: [],
      controlFunctions: [],
      anonymousControls: [],
      forms: [],
    };
  }
  const latestControlInventories = latestObserved ? [latestObserved] : observedInventories;
  const controls = mergeCountedEntriesByMax(
    [
      ...observedInventories.map((inventory) => ({
        ...inventory,
        controls: (inventory.controls ?? []).filter((entry) => !isUnknownRiskInventoryControl(entry)),
      })),
      ...latestControlInventories.map((inventory) => ({
        ...inventory,
        controls: (inventory.controls ?? []).filter((entry) => isUnknownRiskInventoryControl(entry)),
      })),
    ],
    (inventory) => inventory.controls ?? [],
    inventoryControlMergeKey,
    (entry) => ({
      role: entry.role,
      testId: entry.testId,
      labelKind: entry.labelKind,
      ancestorTestId: entry.ancestorTestId,
      descendantTestId: entry.descendantTestId,
      descendantLabelKind: entry.descendantLabelKind,
      iconSignature: entry.iconSignature,
      routeTemplate: entry.routeTemplate,
      disabled: entry.disabled === true,
      functionKind: entry.functionKind,
      intent: entry.intent,
      executionClass: entry.executionClass,
      mutationRisk: entry.mutationRisk,
    }),
  );
  const forms = mergeCountedEntriesByMax(
    latestControlInventories,
    (inventory) => inventory.forms ?? [],
    (entry) => `${entry.role}:${entry.actionRouteTemplate}:${entry.inputCount}:${entry.buttonCount}`,
    (entry) => ({
      role: entry.role,
      inputCount: numberOrZero(entry.inputCount),
      buttonCount: numberOrZero(entry.buttonCount),
      actionRouteTemplate: entry.actionRouteTemplate,
    }),
    20,
  ).map(({ count, ...entry }) => entry);
  return {
    observed: true,
    finishedAt: latestObserved?.finishedAt ?? null,
    urlRouteTemplate: latestObserved?.urlRouteTemplate ?? observedInventories.find((entry) => entry.urlRouteTemplate)?.urlRouteTemplate ?? null,
    linkCount: maxNumber(observedInventories.map((entry) => entry.linkCount)),
    controlCount: maxNumber(observedInventories.map((entry) => entry.controlCount)),
    formCount: maxNumber(observedInventories.map((entry) => entry.formCount)),
    linkRoutes: mergeCountedEntriesByMax(
      observedInventories,
      (inventory) => inventory.linkRoutes ?? [],
      (entry) => `${entry.kind}:${entry.routeTemplate}`,
      (entry) => ({
        kind: entry.kind,
        routeTemplate: entry.routeTemplate,
      }),
    ),
    controls,
    controlFunctions: summarizeInventoryControlFunctions(controls),
    anonymousControls: mergeCountedEntriesByMax(
      latestControlInventories,
      (inventory) => inventory.anonymousControls ?? [],
      (entry) => [
        entry.role,
        entry.type,
        entry.disabled ? 'disabled' : 'enabled',
        entry.closestRole,
        entry.inArticle ? 'article' : 'no-article',
        entry.inDialog ? 'dialog' : 'no-dialog',
        entry.inForm ? 'form' : 'no-form',
        entry.closestLinkKind,
        entry.closestLinkRouteTemplate,
        `svg:${numberOrZero(entry.svgCount)}`,
        `img:${numberOrZero(entry.imageCount)}`,
        `children:${numberOrZero(entry.childElementCount)}`,
      ].join(':'),
      (entry) => ({
        role: entry.role,
        type: entry.type,
        disabled: entry.disabled === true,
        closestRole: entry.closestRole,
        inArticle: entry.inArticle === true,
        inDialog: entry.inDialog === true,
        inForm: entry.inForm === true,
        closestLinkKind: entry.closestLinkKind,
        closestLinkRouteTemplate: entry.closestLinkRouteTemplate,
        svgCount: numberOrZero(entry.svgCount),
        imageCount: numberOrZero(entry.imageCount),
        childElementCount: numberOrZero(entry.childElementCount),
      }),
      40,
    ),
    forms,
  };
}

function emptyControlProbeSummary() {
  return {
    observed: false,
    requested: false,
    candidateCount: 0,
    selectedCount: 0,
    executedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    mutationBlockedCount: 0,
    functionKinds: [],
    executionClasses: [],
    mutationBlockedFunctionKinds: [],
    apiResponseCount: 0,
    apiOperations: [],
    apiReadLikeOperations: [],
    apiSideEffectRiskOperations: [],
    probes: [],
  };
}

function mergeControlProbe(rows) {
  const probes = rows
    .map((row) => row.controlProbe)
    .filter((probe) => probe && typeof probe === 'object' && probe.observed === true);
  if (!probes.length) {
    return emptyControlProbeSummary();
  }
  return {
    observed: true,
    requested: probes.some((probe) => probe.requested === true),
    candidateCount: maxNumber(probes.map((probe) => probe.candidateCount)),
    selectedCount: maxNumber(probes.map((probe) => probe.selectedCount)),
    executedCount: maxNumber(probes.map((probe) => probe.executedCount)),
    skippedCount: maxNumber(probes.map((probe) => probe.skippedCount)),
    failedCount: maxNumber(probes.map((probe) => probe.failedCount)),
    mutationBlockedCount: maxNumber(probes.map((probe) => probe.mutationBlockedCount)),
    functionKinds: dedupeStrings(probes.flatMap((probe) => probe.functionKinds ?? [])),
    executionClasses: dedupeStrings(probes.flatMap((probe) => probe.executionClasses ?? [])),
    mutationBlockedFunctionKinds: dedupeStrings(probes.flatMap((probe) => probe.mutationBlockedFunctionKinds ?? [])),
    apiResponseCount: probes.reduce((sum, probe) => sum + numberOrZero(probe.apiResponseCount), 0),
    apiOperations: dedupeStrings(probes.flatMap((probe) => probe.apiOperations ?? [])),
    apiReadLikeOperations: dedupeStrings(probes.flatMap((probe) => probe.apiReadLikeOperations ?? [])),
    apiSideEffectRiskOperations: dedupeStrings(probes.flatMap((probe) => probe.apiSideEffectRiskOperations ?? [])),
    probes: probes.flatMap((probe) => probe.probes ?? []).slice(0, 40),
  };
}

function mergeApiOperationRiskEntries(groups) {
  const byOperation = new Map();
  for (const group of groups) {
    const entries = Array.isArray(group?.apiOperationRisk) && group.apiOperationRisk.length
      ? group.apiOperationRisk
      : (group?.apiOperations ?? []).map(classifyApiOperationRisk).filter(Boolean);
    for (const entry of entries) {
      const operation = cleanString(entry?.operation);
      if (!operation) continue;
      const normalized = classifyApiOperationRisk(operation) ?? entry;
      const existing = byOperation.get(operation);
      if (
        !existing
        || (normalized.replayDisposition === 'replay-blocked' && existing.replayDisposition !== 'replay-blocked')
      ) {
        byOperation.set(operation, normalized);
      }
    }
  }
  return [...byOperation.values()].sort((left, right) => left.operation.localeCompare(right.operation));
}

function mergeRouteTemplateReplayCoverage(groups, { countMode = 'sum' } = {}) {
  const byRoute = new Map();
  const combineNumber = (left, right) => (countMode === 'max'
    ? Math.max(numberOrZero(left), numberOrZero(right))
    : numberOrZero(left) + numberOrZero(right));
  for (const group of groups) {
    for (const entry of group?.routeTemplateReplayCoverage ?? []) {
      const routeTemplate = safeInventoryRouteTemplate(entry?.routeTemplate);
      if (!routeTemplate) continue;
      if (!byRoute.has(routeTemplate)) {
        byRoute.set(routeTemplate, {
          routeTemplate,
          observedAsPageCount: 0,
          observedAsCandidateCount: 0,
          blockedFunctionCount: 0,
          surfaceCount: 0,
          pageStatuses: [],
          functionKinds: [],
          intents: [],
          executionClasses: [],
          mutationRisks: [],
          blockedFunctionKinds: [],
          blockedIntents: [],
          blockedExecutionClasses: [],
          blockedMutationRisks: [],
          redirectedToRouteTemplates: [],
          routeSamples: [],
          replayDisposition: 'unknown',
        });
      }
      const current = byRoute.get(routeTemplate);
      current.observedAsPageCount = combineNumber(current.observedAsPageCount, entry.observedAsPageCount);
      current.observedAsCandidateCount = combineNumber(current.observedAsCandidateCount, entry.observedAsCandidateCount);
      current.blockedFunctionCount = combineNumber(current.blockedFunctionCount, entry.blockedFunctionCount);
      current.surfaceCount = combineNumber(current.surfaceCount, entry.surfaceCount);
      current.pageStatuses = dedupeStrings([...current.pageStatuses, ...(entry.pageStatuses ?? [])]);
      current.functionKinds = dedupeStrings([...current.functionKinds, ...(entry.functionKinds ?? [])]);
      current.intents = dedupeStrings([...current.intents, ...(entry.intents ?? [])]);
      current.executionClasses = dedupeStrings([...current.executionClasses, ...(entry.executionClasses ?? [])]);
      current.mutationRisks = dedupeStrings([...current.mutationRisks, ...(entry.mutationRisks ?? [])]);
      current.blockedFunctionKinds = dedupeStrings([...current.blockedFunctionKinds, ...(entry.blockedFunctionKinds ?? [])]);
      current.blockedIntents = dedupeStrings([...current.blockedIntents, ...(entry.blockedIntents ?? [])]);
      current.blockedExecutionClasses = dedupeStrings([...current.blockedExecutionClasses, ...(entry.blockedExecutionClasses ?? [])]);
      current.blockedMutationRisks = dedupeStrings([...current.blockedMutationRisks, ...(entry.blockedMutationRisks ?? [])]);
      current.redirectedToRouteTemplates = dedupeStrings([
        ...current.redirectedToRouteTemplates,
        ...(entry.redirectedToRouteTemplates ?? []),
      ]);
      current.routeSamples = dedupeRouteSamples([
        ...current.routeSamples,
        ...(entry.routeSamples ?? []),
      ]);
      const candidateDisposition = replayDispositionForRouteAudit(current);
      const providedDisposition = String(entry.replayDisposition ?? '');
      current.replayDisposition = routeAuditDispositionRank(providedDisposition) > routeAuditDispositionRank(candidateDisposition)
        ? providedDisposition
        : candidateDisposition;
    }
  }
  return [...byRoute.values()].sort((left, right) => (
    routeAuditDispositionRank(right.replayDisposition) - routeAuditDispositionRank(left.replayDisposition)
    || left.routeTemplate.localeCompare(right.routeTemplate)
  ));
}

function selectAuthoritativeReadCrawlsForRouteCoverage(crawls = []) {
  const observedCrawls = crawls.filter((crawl) => crawl && typeof crawl === 'object');
  if (!observedCrawls.length) return [];
  const exhaustedCrawls = observedCrawls.filter((crawl) => crawl.exhausted === true);
  const pool = exhaustedCrawls.length ? exhaustedCrawls : observedCrawls;
  const maxDepth = maxNumber(pool.map((crawl) => crawl.maxDepth));
  return pool.filter((crawl) => numberOrZero(crawl.maxDepth) === maxDepth);
}

function readCrawlHasRequestedRouteTemplateEvidence(crawl = {}) {
  return Array.isArray(crawl?.pages)
    && crawl.pages.some((page) => safeInventoryRouteTemplate(page?.requestedRouteTemplate));
}

function candidateOnlyRouteHasClosedDynamicBoundary(entry = {}) {
  if (entry?.replayDisposition !== 'candidate-only') return false;
  const routeTemplate = safeInventoryRouteTemplate(entry.routeTemplate);
  if (!routeTemplate) return false;
  const family = routeFamilyForTemplate(routeTemplate);
  const shape = routeTemplateShape(routeTemplate);
  const routeSamples = Array.isArray(entry.routeSamples) ? entry.routeSamples : [];
  return family?.familyKind === 'account-dynamic-route'
    && shape.genericSegmentCount >= 5
    && routeSamples.length > 0;
}

function buildCrossSurfaceCoveredCandidateRoutes(surfaceRows = [], siteReplayCoverage = []) {
  const siteDispositionByRoute = new Map(
    siteReplayCoverage.map((entry) => [entry.routeTemplate, entry.replayDisposition]),
  );
  const counts = new Map();
  const surfaces = new Map();
  for (const row of surfaceRows) {
    for (const entry of row.readCrawl?.routeTemplateReplayCoverage ?? []) {
      if (entry?.replayDisposition !== 'candidate-only') continue;
      const routeTemplate = safeInventoryRouteTemplate(entry.routeTemplate);
      if (!routeTemplate) continue;
      const siteDisposition = siteDispositionByRoute.get(routeTemplate) ?? 'candidate-only';
      if (siteDisposition === 'candidate-only') continue;
      counts.set(routeTemplate, (counts.get(routeTemplate) ?? 0) + 1);
      if (!surfaces.has(routeTemplate)) {
        surfaces.set(routeTemplate, new Set());
      }
      surfaces.get(routeTemplate).add(row.surface);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 80)
    .map(([routeTemplate, count]) => ({
      routeTemplate,
      coveredByDisposition: siteDispositionByRoute.get(routeTemplate) ?? 'unknown',
      surfaceCount: surfaces.get(routeTemplate)?.size ?? 0,
      count,
      surfaces: [...(surfaces.get(routeTemplate) ?? [])].sort(),
    }));
}

function buildBlockedRiskRouteBoundaries(routeTemplateReplayCoverage = []) {
  return routeTemplateReplayCoverage
    .filter((entry) => entry.replayDisposition === 'blocked-risk')
    .map((entry) => ({
      routeTemplate: entry.routeTemplate,
      blockedFunctionCount: numberOrZero(entry.blockedFunctionCount),
      surfaceCount: numberOrZero(entry.surfaceCount),
      functionKinds: dedupeStrings(entry.blockedFunctionKinds?.length ? entry.blockedFunctionKinds : entry.functionKinds ?? []),
      intents: dedupeStrings(entry.blockedIntents?.length ? entry.blockedIntents : entry.intents ?? []),
      executionClasses: dedupeStrings(entry.blockedExecutionClasses?.length ? entry.blockedExecutionClasses : entry.executionClasses ?? []),
      mutationRisks: dedupeStrings(entry.blockedMutationRisks?.length ? entry.blockedMutationRisks : entry.mutationRisks ?? []),
      routeSampleCount: Array.isArray(entry.routeSamples) ? entry.routeSamples.length : 0,
    }))
    .sort((left, right) => (
      right.blockedFunctionCount - left.blockedFunctionCount
      || left.routeTemplate.localeCompare(right.routeTemplate)
    ));
}

function buildReadCrawlClosure({
  expectedSurfaceCount = 0,
  coveredPlannedSurfaceCount = null,
  surfaceRows = [],
  crawlRows = [],
  routeTemplateReplaySummary = {},
  routeTemplateReplayCoverage = [],
  apiOperationRiskSummary = {},
} = {}) {
  const replaySummary = /** @type {any} */ (routeTemplateReplaySummary);
  const apiRiskSummary = /** @type {any} */ (apiOperationRiskSummary);
  const readCrawlRows = surfaceRows.filter((row) => row.readCrawl?.observed === true);
  const surfacesWithRequestedRouteTemplateEvidence = readCrawlRows
    .filter((row) => readCrawlHasRequestedRouteTemplateEvidence(row.readCrawl))
    .length;
  const surfacesWithPendingReadQueue = readCrawlRows
    .filter((row) => numberOrZero(row.readCrawl?.pendingQueueCount) > 0)
    .map((row) => row.surface);
  const sampledSpecificRoutes = routeTemplateReplayCoverage
    .filter((entry) => ['visited-route', 'redirected-route'].includes(entry.replayDisposition))
    .filter((entry) => Array.isArray(entry.routeSamples) && entry.routeSamples.length > 0)
    .map((entry) => entry.routeTemplate);
  const plannedRouteTemplates = new Set(
    surfaceRows
      .map((row) => safeInventoryRouteTemplate(row.routeTemplate))
      .filter(Boolean),
  );
  plannedRouteTemplates.add('/compose/post');
  const siteCandidateOnlyRoutes = routeTemplateReplayCoverage
    .filter((entry) => entry.replayDisposition === 'candidate-only')
    .filter((entry) => !plannedRouteTemplates.has(entry.routeTemplate))
    .filter((entry) => !candidateOnlyRouteHasClosedDynamicBoundary(entry))
    .filter((entry) => !sampledSpecificRoutes.some((sampledRoute) => routeTemplateSpecificityCover(entry.routeTemplate, sampledRoute)))
    .map((entry) => entry.routeTemplate);
  const crossSurfaceCoveredCandidateRoutes = buildCrossSurfaceCoveredCandidateRoutes(surfaceRows, routeTemplateReplayCoverage);
  const apiTotal = numberOrZero(apiRiskSummary.total);
  const apiClassifiedCount = numberOrZero(apiRiskSummary.readLikeCount)
    + numberOrZero(apiRiskSummary.sideEffectRiskCount);
  const coveredAllPlannedSurfaces = expectedSurfaceCount > 0
    ? coveredPlannedSurfaceCount === expectedSurfaceCount
    : surfaceRows.length > 0;
  const allReadCrawlSurfacesHaveRequestedRouteTemplateEvidence = readCrawlRows.length > 0
    && surfacesWithRequestedRouteTemplateEvidence === readCrawlRows.length;
  const siteReadQueueExhausted = replaySummary.allExhausted === true
    && surfacesWithPendingReadQueue.length === 0;
  const noUnresolvedCandidateOnlyRoutes = siteCandidateOnlyRoutes.length === 0;
  const apiReplayRiskClassified = apiTotal === 0 || apiClassifiedCount === apiTotal;
  const blockedRiskRoutes = buildBlockedRiskRouteBoundaries(routeTemplateReplayCoverage);
  const blockedRiskRoutesClassified = blockedRiskRoutes.every((entry) => (
    entry.functionKinds.length > 0
    && entry.executionClasses.length > 0
    && entry.mutationRisks.length > 0
  ));
  return {
    scope: 'planned-surface-read-crawl',
    fullSiteExhaustiveClaim: false,
    plannedSurfaceCount: expectedSurfaceCount || null,
    coveredPlannedSurfaceCount,
    readCrawlSurfaceCount: readCrawlRows.length,
    surfacesWithRequestedRouteTemplateEvidence,
    allReadCrawlSurfacesHaveRequestedRouteTemplateEvidence,
    surfacesWithPendingReadQueue,
    siteReadQueueExhausted,
    unresolvedCandidateOnlyRouteCount: siteCandidateOnlyRoutes.length,
    unresolvedCandidateOnlyRoutes: siteCandidateOnlyRoutes,
    crossSurfaceCoveredCandidateRouteCount: crossSurfaceCoveredCandidateRoutes.length,
    crossSurfaceCoveredCandidateRoutes,
    blockedRouteCount: numberOrZero(replaySummary.blockedRouteTemplateCount),
    blockedRiskRoutes,
    blockedRiskRoutesClassified,
    apiOperationCount: apiTotal,
    apiReplayBlockedCount: numberOrZero(apiRiskSummary.replayBlockedCount),
    apiReplayRiskClassified,
    controlledScopeClosureReady: coveredAllPlannedSurfaces
      && allReadCrawlSurfacesHaveRequestedRouteTemplateEvidence
      && siteReadQueueExhausted
      && noUnresolvedCandidateOnlyRoutes
      && apiReplayRiskClassified,
  };
}

const AUTH_SESSION_BLOCKER_REASON_RE = /(?:login-required|session-health|auth|manual-required)/iu;

function timeValue(value) {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

function isSessionAuthBlocker(row = {}) {
  const reasonText = [
    row.reason,
    row.sessionGate?.reason,
  ].filter(Boolean).join(' ');
  return row.sessionGate?.status === 'blocked'
    || (row.status === 'blocked' && AUTH_SESSION_BLOCKER_REASON_RE.test(reasonText));
}

function isSessionAuthPass(row = {}) {
  return row.sessionGate?.status === 'passed'
    || (/session-health/u.test(String(row.id ?? '')) && row.status === 'passed');
}

function latestByFinishedAt(rows = []) {
  return rows
    .map((row) => ({ row, ms: timeValue(row.finishedAt) }))
    .filter((entry) => entry.ms !== null)
    .sort((left, right) => right.ms - left.ms)[0]?.row ?? null;
}

function compactAuthBoundaryRow(row = null) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    surface: row.surface ?? null,
    status: row.status ?? null,
    reason: row.sessionGate?.reason ?? row.reason ?? null,
    sessionGateStatus: row.sessionGate?.status ?? null,
    finishedAt: row.finishedAt ?? null,
    manifestPath: row.manifestPath ?? null,
  };
}

function buildSessionAuthBoundary(rows = []) {
  const blockers = rows.filter(isSessionAuthBlocker);
  const passes = rows.filter(isSessionAuthPass);
  const latestBlocker = latestByFinishedAt(blockers);
  const latestPass = latestByFinishedAt(passes);
  const latestBlockedAt = timeValue(latestBlocker?.finishedAt);
  const latestPassedAt = timeValue(latestPass?.finishedAt);
  const activeAuthBlocker = latestBlockedAt !== null
    && (latestPassedAt === null || latestBlockedAt >= latestPassedAt);
  return {
    scope: 'session-auth-boundary',
    activeAuthBlocker,
    blockedRunCount: blockers.length,
    blockedSurfaceCount: dedupeStrings(blockers.map((row) => row.surface)).length,
    blockedSurfaces: dedupeStrings(blockers.map((row) => row.surface)),
    reasonCounts: countValues(blockers.map((row) => row.sessionGate?.reason ?? row.reason ?? 'session-blocked')),
    latestBlockedAt: latestBlocker?.finishedAt ?? null,
    latestPassedAt: latestPass?.finishedAt ?? null,
    latestBlocker: compactAuthBoundaryRow(latestBlocker),
  };
}

function buildFullSiteBoundary({
  expectedSurfaceCount = 0,
  coveredPlannedSurfaceCount = null,
  missingExpectedSurfaces = [],
  discovery = {},
  readCrawlClosure = {},
  readCrawlFrontier = {},
  apiOperationRiskSummary = {},
  dynamicSeedCoverage = {},
  dynamicSeedExpansion = {},
  sessionAuthBoundary = {},
  inventoryRouteCoverage = {},
} = {}) {
  const discovered = /** @type {any} */ (discovery);
  const closure = /** @type {any} */ (readCrawlClosure);
  const frontier = /** @type {any} */ (readCrawlFrontier);
  const dynamicFamilies = frontier.dynamicRouteFamilies ?? {};
  const dynamicSeeds = /** @type {any} */ (dynamicSeedCoverage);
  const dynamicExpansion = /** @type {any} */ (dynamicSeedExpansion);
  const apiRisk = /** @type {any} */ (apiOperationRiskSummary);
  const sessionAuth = /** @type {any} */ (sessionAuthBoundary);
  const inventoryRoutes = /** @type {any} */ (inventoryRouteCoverage);
  const missingExpectedSurfaceCount = Array.isArray(missingExpectedSurfaces)
    ? missingExpectedSurfaces.length
    : 0;
  const pendingReadQueueSurfaceCount = Array.isArray(closure.surfacesWithPendingReadQueue)
    ? closure.surfacesWithPendingReadQueue.length
    : 0;
  const readCrawlControlledReady = closure.controlledScopeClosureReady === true;
  const activeAuthBlocker = sessionAuth.activeAuthBlocker === true;
  const inventoryRouteUncoveredCount = numberOrZero(inventoryRoutes.uncoveredCount);
  const controlledScopeClosureReady = readCrawlControlledReady
    && !activeAuthBlocker
    && inventoryRouteUncoveredCount === 0;
  return {
    scope: 'controlled-plan-vs-open-site',
    fullSiteExhaustiveClaim: false,
    controlledScopeClosureReady,
    plannedSurfaceCount: expectedSurfaceCount || null,
    coveredPlannedSurfaceCount,
    missingExpectedSurfaceCount,
    pendingReadQueueSurfaceCount,
    pendingReadQueueSurfaces: Array.isArray(closure.surfacesWithPendingReadQueue)
      ? closure.surfacesWithPendingReadQueue
      : [],
    activeAuthBlocker,
    authBlockedRunCount: numberOrZero(sessionAuth.blockedRunCount),
    authBlockedSurfaceCount: numberOrZero(sessionAuth.blockedSurfaceCount),
    authBlockedSurfaces: Array.isArray(sessionAuth.blockedSurfaces) ? sessionAuth.blockedSurfaces : [],
    authBlockerReasons: Array.isArray(sessionAuth.reasonCounts) ? sessionAuth.reasonCounts : [],
    latestAuthBlockedAt: sessionAuth.latestBlockedAt ?? null,
    latestAuthPassedAt: sessionAuth.latestPassedAt ?? null,
    latestAuthBlocker: sessionAuth.latestBlocker ?? null,
    inventoryRouteCount: numberOrZero(inventoryRoutes.total),
    inventoryRouteCoveredCount: numberOrZero(inventoryRoutes.coveredCount),
    inventoryRouteUncoveredCount,
    inventoryRouteBlockedCount: numberOrZero(inventoryRoutes.blockedCount),
    inventoryRouteCandidateOnlyCount: numberOrZero(inventoryRoutes.candidateOnlyCount),
    inventoryUncoveredRoutes: Array.isArray(inventoryRoutes.uncoveredRoutes) ? inventoryRoutes.uncoveredRoutes : [],
    unresolvedCandidateOnlyRouteCount: numberOrZero(closure.unresolvedCandidateOnlyRouteCount),
    frontierGapCount: numberOrZero(frontier.gapCount),
    plannedCapabilityCount: numberOrZero(discovered.plannedCapabilityCount),
    discoveredCapabilityCount: numberOrZero(discovered.discoveredCapabilityCount),
    plannedIntentCount: numberOrZero(discovered.plannedIntentCount),
    discoveredIntentCount: numberOrZero(discovered.discoveredIntentCount),
    discoveredFunctionKindCount: numberOrZero(discovered.discoveredFunctionKindCount),
    readExecutableFunctionKindCount: Array.isArray(discovered.readExecutableFunctionKinds)
      ? discovered.readExecutableFunctionKinds.length
      : 0,
    blockedFunctionKindCount: Array.isArray(discovered.blockedFunctionKinds)
      ? discovered.blockedFunctionKinds.length
      : 0,
    observedApiOperationCount: numberOrZero(discovered.observedApiOperationCount),
    targetApiOperationCount: numberOrZero(discovered.targetApiOperationCount),
    readReplayEligibleApiOperationCount: numberOrZero(discovered.apiReadReplayEligibleCount),
    replayBlockedApiOperationCount: numberOrZero(discovered.apiReplayBlockedCount),
    apiOperationRiskCount: numberOrZero(apiRisk.total),
    sideEffectRiskApiOperationCount: numberOrZero(apiRisk.sideEffectRiskCount),
    dynamicRouteFamilyCount: numberOrZero(dynamicFamilies.familyCount ?? discovered.dynamicRouteFamilyCount),
    dynamicRouteFamilyRouteTemplateCount: numberOrZero(
      dynamicFamilies.routeTemplateCount ?? discovered.dynamicRouteFamilyRouteTemplateCount,
    ),
    dynamicRouteParameterizedFamilyCount: numberOrZero(
      dynamicFamilies.parameterizedReplayFamilyCount ?? discovered.dynamicRouteParameterizedFamilyCount,
    ),
    dynamicRouteParameterizedTemplateCount: numberOrZero(
      dynamicFamilies.parameterizedReplayRouteTemplateCount ?? discovered.dynamicRouteParameterizedTemplateCount,
    ),
    dynamicRouteSampleCount: numberOrZero(dynamicFamilies.sampleCount ?? discovered.dynamicRouteSampleCount),
    dynamicRouteSamplelessTemplateCount: numberOrZero(
      dynamicFamilies.samplelessRouteTemplateCount ?? discovered.dynamicRouteSamplelessTemplateCount,
    ),
    dynamicSeedRunCount: numberOrZero(dynamicSeeds.seedRunCount),
    dynamicSeedFamilyCount: numberOrZero(dynamicSeeds.familyCount),
    dynamicSeedRouteTemplateCount: numberOrZero(dynamicSeeds.routeTemplateCount),
    dynamicSeedSurfaceCount: numberOrZero(dynamicSeeds.surfaceCount),
    dynamicSeedExpansionCandidateCount: numberOrZero(dynamicExpansion.candidateCount),
    dynamicSeedExpansionFamilyCount: numberOrZero(dynamicExpansion.familyCount),
    dynamicSeedExpansionRouteTemplateCount: numberOrZero(dynamicExpansion.routeTemplateCount),
    dynamicSeedExpansionRequiresUserApproval: dynamicExpansion.userApprovalRequired === true,
    finiteExhaustiveReason: 'x-has-open-ended-user-content-and-parameterized-route-families',
    nextEvidence: activeAuthBlocker
      ? 'restore-authentication-then-close-pending-planned-surface-queues'
      : !readCrawlControlledReady
      ? 'close-pending-planned-surface-queues-and-frontier-gaps'
      : inventoryRouteUncoveredCount > 0
      ? 'cover-uncovered-inventory-routes'
      : controlledScopeClosureReady
      ? 'expand-specific-dynamic-route-families-with-user-approved-seeds'
      : 'close-pending-planned-surface-queues-and-frontier-gaps',
  };
}

function frontierExpansionStatus(entry = {}) {
  if (entry.replayDisposition === 'blocked-risk') return 'blocked-risk';
  if (entry.replayDisposition === 'candidate-only') return 'unresolved-candidate';
  if (entry.replayDisposition === 'redirected-route') return 'redirected-covered';
  if (entry.replayDisposition === 'visited-route') return 'visited-covered';
  return 'unknown';
}

function routeFamilyForTemplate(routeTemplate) {
  const route = String(routeTemplate ?? '');
  if (!route) return null;
  if (route === '/') {
    return {
      familyKind: 'app-root-redirect',
      capability: 'dynamic.app-root.inspect',
      intent: 'inspect_app_root_redirect',
    };
  }
  if (/^\/:account\/status\/:id(?:\/|$)/u.test(route)) {
    return {
      familyKind: 'status-dynamic-route',
      capability: 'dynamic.status.inspect',
      intent: 'inspect_dynamic_status_route',
    };
  }
  if (/^\/:account$/u.test(route)) {
    return {
      familyKind: 'account-dynamic-route',
      capability: 'dynamic.account-route.inspect',
      intent: 'inspect_dynamic_account_route',
    };
  }
  if (/^\/i\/status\/:id$/u.test(route)) {
    return {
      familyKind: 'internal-status-route',
      capability: 'content.internal-status.inspect',
      intent: 'inspect_internal_status_redirect',
    };
  }
  if (/^\/:account\/communities$/u.test(route)) {
    return {
      familyKind: 'account-communities-route',
      capability: 'dynamic.account-communities.inspect',
      intent: 'inspect_account_communities_route',
    };
  }
  if (/^\/:account\/articles$/u.test(route)) {
    return {
      familyKind: 'account-articles-route',
      capability: 'dynamic.account-articles.inspect',
      intent: 'inspect_account_articles_route',
    };
  }
  if (/^\/:account\/about$/u.test(route)) {
    return {
      familyKind: 'account-about-route',
      capability: 'dynamic.account-about.inspect',
      intent: 'inspect_account_about_route',
    };
  }
  if (/^\/:account\/accessibility$/u.test(route)) {
    return {
      familyKind: 'account-accessibility-route',
      capability: 'dynamic.account-accessibility.inspect',
      intent: 'inspect_account_accessibility_route',
    };
  }
  if (/^\/:account\/photo$/u.test(route)) {
    return {
      familyKind: 'account-photo-route',
      capability: 'dynamic.account-photo.inspect',
      intent: 'inspect_account_photo_route',
    };
  }
  if (/^\/:account\/(?!status\/).+/u.test(route)) {
    return {
      familyKind: 'account-dynamic-route',
      capability: 'dynamic.account-route.inspect',
      intent: 'inspect_dynamic_account_route',
    };
  }
  if (/^\/i\/:segment\/creators\/:segment$/u.test(route)) {
    return {
      familyKind: 'internal-creator-route',
      capability: 'dynamic.internal-creator.inspect',
      intent: 'inspect_internal_creator_route',
    };
  }
  if (/^\/i\/:segment(?:\/:segment)?$/u.test(route)) {
    return {
      familyKind: 'internal-app-route',
      capability: 'dynamic.internal-app.inspect',
      intent: 'inspect_dynamic_internal_app_route',
    };
  }
  if (/^\/explore\/tabs\/:segment$/u.test(route)) {
    return {
      familyKind: 'explore-tab-route',
      capability: 'dynamic.explore-tab.inspect',
      intent: 'inspect_dynamic_explore_tab',
    };
  }
  if (/^\/notifications\/:segment$/u.test(route)) {
    return {
      familyKind: 'notifications-subroute',
      capability: 'dynamic.notifications-subroute.inspect',
      intent: 'inspect_notifications_subroute',
    };
  }
  return {
    familyKind: 'other-dynamic-route',
    capability: 'dynamic.route.inspect',
    intent: 'inspect_dynamic_route',
  };
}

function routeTemplateShape(routeTemplate) {
  const text = String(routeTemplate ?? '');
  const [pathTemplate, queryTemplate = ''] = text.split('?', 2);
  const segments = pathTemplate.split('/').filter(Boolean);
  const dynamicSegments = segments.filter((segment) => segment.startsWith(':'));
  return {
    routeTemplate: text,
    depth: segments.length,
    dynamicSegmentCount: dynamicSegments.length,
    accountSegmentCount: dynamicSegments.filter((segment) => segment === ':account').length,
    idSegmentCount: dynamicSegments.filter((segment) => segment === ':id').length,
    genericSegmentCount: dynamicSegments.filter((segment) => segment === ':segment').length,
    staticSegmentCount: segments.length - dynamicSegments.length,
    hasQueryTemplate: Boolean(queryTemplate),
  };
}

function routeTemplateSpecificityCover(genericRoute, sampledRoute) {
  const generic = safeInventoryRouteTemplate(genericRoute);
  const sampled = safeInventoryRouteTemplate(sampledRoute);
  if (!generic || !sampled || generic === sampled) return false;
  const [genericPath, genericQuery = ''] = generic.split('?', 2);
  const [sampledPath, sampledQuery = ''] = sampled.split('?', 2);
  if (genericPath === '/search' && sampledPath === '/search' && !genericQuery && sampledQuery) {
    return true;
  }
  if (genericQuery !== sampledQuery) return false;
  const genericSegments = genericPath.split('/').filter(Boolean);
  const sampledSegments = sampledPath.split('/').filter(Boolean);
  if (genericSegments.length !== sampledSegments.length) return false;
  let narrowed = false;
  for (let index = 0; index < genericSegments.length; index += 1) {
    const genericSegment = genericSegments[index];
    const sampledSegment = sampledSegments[index];
    if (genericSegment === sampledSegment) continue;
    if (/^:[a-z0-9_-]+$/u.test(genericSegment) && /^:[a-z0-9_-]+$/u.test(sampledSegment)) {
      if (genericSegment === ':account' || sampledSegment === ':account') {
        return false;
      }
      narrowed = true;
      continue;
    }
    if (genericSegment === ':segment' && INVENTORY_SAFE_ROUTE_SEGMENTS.has(sampledSegment)) {
      narrowed = true;
      continue;
    }
    return false;
  }
  return narrowed;
}

function routeTemplatePath(routeTemplate) {
  const route = safeInventoryRouteTemplate(routeTemplate);
  if (!route) return null;
  const [pathTemplate] = route.split('?', 2);
  if (!pathTemplate) return null;
  return pathTemplate === '/' ? '/' : pathTemplate.replace(/\/+$/u, '');
}

function routeTemplateHasChildPath(parentRouteTemplate, childRouteTemplate) {
  const parentPath = routeTemplatePath(parentRouteTemplate);
  const childPath = routeTemplatePath(childRouteTemplate);
  if (!parentPath || !childPath || parentPath === '/' || parentPath === childPath) {
    return false;
  }
  return childPath.startsWith(`${parentPath}/`);
}

function routeTemplateIsSafeStructureFamily(routeTemplate) {
  const route = safeInventoryRouteTemplate(routeTemplate);
  if (!route) return false;
  return /^\/(?:settings|notifications)(?:\/|$)/u.test(route)
    && route.split('/').some((segment) => segment === ':segment');
}

function buildInventoryRouteCoverage({ inventoryLinkRoutes = [], plannedRouteTemplates = [], routeTemplateReplayCoverage = [] } = {}) {
  const plannedSet = new Set(dedupeStrings(plannedRouteTemplates.map(safeInventoryRouteTemplate)));
  const plannedRoutes = [...plannedSet];
  const replayByRoute = new Map(routeTemplateReplayCoverage.map((entry) => [entry.routeTemplate, entry]));
  const coveredReplayRoutes = routeTemplateReplayCoverage.filter((entry) => (
    ['visited-route', 'redirected-route'].includes(entry.replayDisposition)
  ));
  const routes = inventoryLinkRoutes.map((entry) => {
    const routeTemplate = safeInventoryRouteTemplate(entry.routeTemplate);
    if (!routeTemplate) return null;
    const replay = replayByRoute.get(routeTemplate);
    const sampledPlannedRoute = plannedRoutes.find((plannedRoute) => routeTemplateSpecificityCover(routeTemplate, plannedRoute));
    const sampledReplayRoute = coveredReplayRoutes.find((replayRoute) => routeTemplateSpecificityCover(routeTemplate, replayRoute.routeTemplate));
    let coverageStatus = 'uncovered';
    let coveredBy = null;
    if (plannedSet.has(routeTemplate)) {
      coverageStatus = 'covered';
      coveredBy = 'planned-route-template';
    } else if (sampledPlannedRoute) {
      coverageStatus = 'covered';
      coveredBy = 'sampled-planned-route-template';
    } else if (sampledReplayRoute) {
      coverageStatus = 'covered';
      coveredBy = sampledReplayRoute.replayDisposition;
    } else if (['visited-route', 'redirected-route'].includes(replay?.replayDisposition)) {
      coverageStatus = 'covered';
      coveredBy = replay.replayDisposition;
    } else if (replay?.replayDisposition === 'blocked-risk') {
      coverageStatus = 'blocked';
      coveredBy = 'blocked-risk';
    } else if (replay?.replayDisposition === 'candidate-only') {
      coverageStatus = 'candidate-only';
      coveredBy = 'candidate-only';
    }
    return {
      kind: entry.kind,
      routeTemplate,
      count: numberOrZero(entry.count),
      coverageStatus,
      coveredBy,
      replayDisposition: replay?.replayDisposition ?? null,
      sampledRouteTemplate: sampledPlannedRoute ?? sampledReplayRoute?.routeTemplate ?? null,
      functionKinds: replay?.functionKinds ?? [],
      executionClasses: replay?.executionClasses ?? [],
    };
  }).filter(Boolean);
  const uncoveredRoutes = routes.filter((entry) => entry.coverageStatus === 'uncovered');
  const blockedRoutes = routes.filter((entry) => entry.coverageStatus === 'blocked');
  const candidateOnlyRoutes = routes.filter((entry) => entry.coverageStatus === 'candidate-only');
  return {
    total: routes.length,
    coveredCount: routes.filter((entry) => entry.coverageStatus === 'covered').length,
    blockedCount: blockedRoutes.length,
    candidateOnlyCount: candidateOnlyRoutes.length,
    uncoveredCount: uncoveredRoutes.length,
    uncoveredRoutes: uncoveredRoutes.map((entry) => entry.routeTemplate),
    blockedRoutes: blockedRoutes.map((entry) => entry.routeTemplate),
    candidateOnlyRoutes: candidateOnlyRoutes.map((entry) => entry.routeTemplate),
    routes,
  };
}

function refineInventoryControlsByIcon(controls = []) {
  const iconClassifications = new Map();
  for (const control of controls) {
    const iconSignature = safeInventoryToken(control.iconSignature);
    if (!iconSignature || control.functionKind === 'interactive.unclassified-control') continue;
    if (!control.functionKind || !control.intent || !control.executionClass || !control.mutationRisk) continue;
    if (!iconClassifications.has(iconSignature)) {
      iconClassifications.set(iconSignature, {
        functionKind: control.functionKind,
        intent: control.intent,
        executionClass: control.executionClass,
        mutationRisk: control.mutationRisk,
      });
    }
  }
  return controls.map((control) => {
    const iconSignature = safeInventoryToken(control.iconSignature);
    if (!iconSignature || control.functionKind !== 'interactive.unclassified-control') {
      return control;
    }
    const matched = iconClassifications.get(iconSignature);
    return matched ? { ...control, ...matched } : control;
  });
}

function buildChildApiCoverageRows(surfaceRows = []) {
  return surfaceRows
    .filter((parent) => (
      numberOrZero(parent.apiPages) === 0
      && numberOrZero(parent.apiResponseCount) === 0
      && routeTemplatePath(parent.routeTemplate) !== '/'
    ))
    .map((parent) => {
      const childRows = surfaceRows.filter((child) => (
        child.surface !== parent.surface
        && (numberOrZero(child.apiPages) > 0 || numberOrZero(child.apiResponseCount) > 0)
        && routeTemplateHasChildPath(parent.routeTemplate, child.routeTemplate)
      ));
      if (!childRows.length) return null;
      return {
        surface: parent.surface,
        routeTemplate: parent.routeTemplate,
        childSurfaceCount: childRows.length,
        childSurfaces: childRows.map((child) => child.surface),
        childRouteTemplates: dedupeStrings(childRows.map((child) => child.routeTemplate)),
        childOperations: dedupeStrings(childRows.flatMap((child) => child.operations)),
        childApiPages: childRows.reduce((sum, child) => sum + numberOrZero(child.apiPages), 0),
        childApiResponses: childRows.reduce((sum, child) => sum + numberOrZero(child.apiResponseCount), 0),
        childItems: childRows.reduce((sum, child) => sum + numberOrZero(child.itemCount), 0),
        childUsers: childRows.reduce((sum, child) => sum + numberOrZero(child.userCount), 0),
        childMedia: childRows.reduce((sum, child) => sum + numberOrZero(child.mediaCount), 0),
      };
    })
    .filter(Boolean);
}

function frontierGapForRoute(entry = {}) {
  const routeTemplate = safeInventoryRouteTemplate(entry.routeTemplate);
  if (!routeTemplate) return null;
  const expansionStatus = String(entry.expansionStatus ?? '');
  const routeSamples = Array.isArray(entry.routeSamples) ? entry.routeSamples : [];
  if (entry.sampleCoverageStatus === 'sampled-specific-covered') {
    return null;
  }
  if (expansionStatus === 'blocked-risk') {
    return {
      routeTemplate,
      gapKind: 'blocked-risk',
      expansionStatus,
      replayDisposition: entry.replayDisposition,
      reason: 'side-effect-or-account-risk',
      nextEvidence: 'manual-review-or-explicit-user-approved-risk-run',
      blockedFunctionCount: numberOrZero(entry.blockedFunctionCount),
      functionKinds: entry.functionKinds ?? [],
      executionClasses: entry.executionClasses ?? [],
      routeShape: routeTemplateShape(routeTemplate),
    };
  }
  if (expansionStatus === 'unresolved-candidate') {
    if (candidateOnlyRouteHasClosedDynamicBoundary(entry)) {
      return null;
    }
    return {
      routeTemplate,
      gapKind: 'candidate-only',
      expansionStatus,
      replayDisposition: entry.replayDisposition,
      reason: 'observed-as-link-but-not-visited',
      nextEvidence: 'read-route-crawl-replay',
      observedAsCandidateCount: numberOrZero(entry.observedAsCandidateCount),
      functionKinds: entry.functionKinds ?? [],
      executionClasses: entry.executionClasses ?? [],
      routeShape: routeTemplateShape(routeTemplate),
    };
  }
  if (['visited-covered', 'redirected-covered'].includes(expansionStatus) && routeSamples.length === 0) {
    return {
      routeTemplate,
      gapKind: 'sampleless-safe-visited',
      expansionStatus,
      replayDisposition: entry.replayDisposition,
      reason: 'visited-before-route-sample-capture-or-sample-not-derivable',
      nextEvidence: 'rerun-source-surface-with-route-sample-capture',
      observedAsPageCount: numberOrZero(entry.observedAsPageCount),
      observedAsCandidateCount: numberOrZero(entry.observedAsCandidateCount),
      functionKinds: entry.functionKinds ?? [],
      executionClasses: entry.executionClasses ?? [],
      routeShape: routeTemplateShape(routeTemplate),
    };
  }
  return null;
}

function frontierDecisionForRoute(entry = {}) {
  const routeTemplate = safeInventoryRouteTemplate(entry.routeTemplate);
  if (!routeTemplate) return null;
  const expansionStatus = String(entry.expansionStatus ?? '');
  const routeSamples = Array.isArray(entry.routeSamples) ? entry.routeSamples : [];
  const family = routeFamilyForTemplate(routeTemplate);
  const base = {
    routeTemplate,
    expansionStatus,
    replayDisposition: entry.replayDisposition,
    evidenceStatus: expansionStatus,
    surfaceCount: numberOrZero(entry.surfaceCount),
    observedAsPageCount: numberOrZero(entry.observedAsPageCount),
    observedAsCandidateCount: numberOrZero(entry.observedAsCandidateCount),
    blockedFunctionCount: numberOrZero(entry.blockedFunctionCount),
    routeSampleCount: routeSamples.length,
    sampleCoverageStatus: entry.sampleCoverageStatus ?? null,
    sampledSpecificRouteTemplates: entry.sampledSpecificRouteTemplates ?? [],
    familyKind: family?.familyKind ?? null,
    capability: family?.capability ?? null,
    intent: family?.intent ?? null,
    routeShape: routeTemplateShape(routeTemplate),
  };
  if (entry.sampleCoverageStatus === 'sampled-specific-covered') {
    return {
      ...base,
      decisionKind: 'covered-by-specific-route-template',
      upgradeAction: 'do-not-promote',
      evidenceStatus: 'specific-route-sampled',
      reason: 'more-specific-route-template-sample-already-covers-this-generic-template',
      nextEvidence: null,
    };
  }
  if (expansionStatus === 'blocked-risk') {
    return {
      ...base,
      decisionKind: 'risk-blocked',
      upgradeAction: 'manual-review-required',
      reason: 'side-effect-or-account-risk',
      nextEvidence: 'manual-review-or-explicit-user-approved-risk-run',
    };
  }
  if (expansionStatus === 'unresolved-candidate') {
    if (candidateOnlyRouteHasClosedDynamicBoundary(entry)) {
      return {
        ...base,
        decisionKind: 'dynamic-family-parameterized',
        upgradeAction: 'keep-dynamic-family',
        evidenceStatus: 'sampled-candidate-dynamic-family',
        reason: 'sampled-dynamic-route-template-represents-an-open-family-not-a-finite-planned-surface',
        nextEvidence: null,
      };
    }
    return {
      ...base,
      decisionKind: 'needs-read-route-replay',
      upgradeAction: 'defer-until-visited',
      reason: 'observed-as-link-but-not-visited',
      nextEvidence: 'read-route-crawl-replay',
    };
  }
  if (['visited-covered', 'redirected-covered'].includes(expansionStatus)) {
    if (family && base.routeShape.dynamicSegmentCount > 0) {
      return {
        ...base,
        decisionKind: 'dynamic-family-parameterized',
        upgradeAction: 'keep-dynamic-family',
        reason: 'parameterized-route-template-represents-an-open-family-not-a-stable-planned-surface',
        nextEvidence: null,
      };
    }
    return {
      ...base,
      decisionKind: 'stable-frontier-surface',
      upgradeAction: 'promote-to-planned-surface',
      reason: 'concrete-safe-visited-route-can-become-a-planned-surface',
      nextEvidence: 'planned-surface-mapping',
    };
  }
  return {
    ...base,
    decisionKind: 'unclassified-frontier-route',
    upgradeAction: 'needs-triage',
    reason: 'unknown-replay-disposition',
    nextEvidence: 'route-template-replay-audit',
  };
}

function summarizeFrontierDecisions(decisions = [], routeCount = 0, gaps = []) {
  const byDecisionKind = {};
  const byUpgradeAction = {};
  for (const decision of decisions) {
    byDecisionKind[decision.decisionKind] = (byDecisionKind[decision.decisionKind] ?? 0) + 1;
    byUpgradeAction[decision.upgradeAction] = (byUpgradeAction[decision.upgradeAction] ?? 0) + 1;
  }
  const unclassifiedRouteTemplateCount = Math.max(
    0,
    routeCount - decisions.filter((entry) => entry.decisionKind !== 'unclassified-frontier-route').length,
  );
  const plannedSurfaceUpgradeCandidates = decisions
    .filter((entry) => entry.upgradeAction === 'promote-to-planned-surface')
    .map((entry) => entry.routeTemplate);
  return {
    scope: 'outside-planned-frontier-route-decisions',
    routeTemplateCount: routeCount,
    decisionCount: decisions.length,
    classifiedRouteTemplateCount: routeCount - unclassifiedRouteTemplateCount,
    unclassifiedRouteTemplateCount,
    allFrontierRoutesClassified: routeCount > 0 && unclassifiedRouteTemplateCount === 0 && decisions.length === routeCount,
    readyForControlledScopeClosure: routeCount > 0 && unclassifiedRouteTemplateCount === 0 && gaps.length === 0,
    plannedSurfaceUpgradeCandidateCount: plannedSurfaceUpgradeCandidates.length,
    plannedSurfaceUpgradeCandidates,
    byDecisionKind: Object.entries(byDecisionKind)
      .map(([decisionKind, count]) => ({ decisionKind, count }))
      .sort((left, right) => right.count - left.count || left.decisionKind.localeCompare(right.decisionKind)),
    byUpgradeAction: Object.entries(byUpgradeAction)
      .map(([upgradeAction, count]) => ({ upgradeAction, count }))
      .sort((left, right) => right.count - left.count || left.upgradeAction.localeCompare(right.upgradeAction)),
  };
}

function buildDynamicRouteFamilySummary(frontierRoutes = []) {
  const safeRoutes = frontierRoutes.filter((entry) => (
    (
      ['visited-covered', 'redirected-covered'].includes(entry.expansionStatus)
      || candidateOnlyRouteHasClosedDynamicBoundary(entry)
    )
    && entry.sampleCoverageStatus !== 'sampled-specific-covered'
  ));
  const byFamily = new Map();
  for (const route of safeRoutes) {
    const family = routeFamilyForTemplate(route.routeTemplate);
    if (!family) continue;
    if (!byFamily.has(family.familyKind)) {
      byFamily.set(family.familyKind, {
        familyKind: family.familyKind,
        capability: family.capability,
        intent: family.intent,
        routeTemplates: [],
        routeTemplateCount: 0,
        surfaceCount: 0,
        observedAsPageCount: 0,
        observedAsCandidateCount: 0,
        functionKinds: [],
        executionClasses: [],
        routeShapes: [],
        routeSamples: [],
        routeSampleCount: 0,
        sampleCoveredRouteTemplates: [],
        parameterizedReplayRequired: false,
      });
    }
    const current = byFamily.get(family.familyKind);
    current.routeTemplates = dedupeStrings([...current.routeTemplates, route.routeTemplate]);
    current.routeTemplateCount = current.routeTemplates.length;
    current.surfaceCount += numberOrZero(route.surfaceCount);
    current.observedAsPageCount += numberOrZero(route.observedAsPageCount);
    current.observedAsCandidateCount += numberOrZero(route.observedAsCandidateCount);
    current.functionKinds = dedupeStrings([...current.functionKinds, ...(route.functionKinds ?? [])]);
    current.executionClasses = dedupeStrings([...current.executionClasses, ...(route.executionClasses ?? [])]);
    current.routeShapes = current.routeTemplates.map(routeTemplateShape);
    current.routeSamples = dedupeRouteSamples([
      ...current.routeSamples,
      ...(route.routeSamples ?? []),
    ]);
    current.routeSampleCount = current.routeSamples.length;
    if (route.sampleCoverageStatus === 'sampled-specific-covered') {
      current.sampleCoveredRouteTemplates = dedupeStrings([
        ...(current.sampleCoveredRouteTemplates ?? []),
        route.routeTemplate,
      ]);
    }
    current.parameterizedReplayRequired = current.routeShapes.some((shape) => shape.dynamicSegmentCount > 0);
  }
  const families = [...byFamily.values()].map((entry) => {
    const sampledRouteTemplates = new Set(entry.routeSamples.map((sample) => sample.routeTemplate));
    const sampleCoveredRouteTemplates = new Set(entry.sampleCoveredRouteTemplates ?? []);
    const routeSamplelessRouteTemplates = entry.routeTemplates
      .filter((routeTemplate) => !sampledRouteTemplates.has(routeTemplate) && !sampleCoveredRouteTemplates.has(routeTemplate));
    const routeTemplateBoundaries = entry.routeTemplates.map((routeTemplate) => {
      const routeSamples = entry.routeSamples.filter((sample) => sample.routeTemplate === routeTemplate);
      const sampleStatus = sampleCoveredRouteTemplates.has(routeTemplate)
        ? 'covered-by-specific-route-template'
        : sampledRouteTemplates.has(routeTemplate)
          ? 'sampled-parameterized-template'
          : 'sampleless-parameterized-template';
      return {
        routeTemplate,
        familyKind: entry.familyKind,
        capability: entry.capability,
        intent: entry.intent,
        routeShape: routeTemplateShape(routeTemplate),
        sampleStatus,
        routeSampleCount: routeSamples.length,
        sampledSpecificRouteTemplates: sampleCoveredRouteTemplates.has(routeTemplate)
          ? [routeTemplate]
          : [],
        closureDisposition: 'keep-parameterized-family',
        plannedSurfacePromotionRequired: false,
        reason: 'dynamic-route-template-represents-open-user-content-or-app-identifier-space',
        nextEvidence: sampleStatus === 'sampleless-parameterized-template'
          ? 'rerun-source-surface-with-route-sample-capture'
          : null,
      };
    });
    const routeSampledRouteTemplateCount = entry.routeTemplates.length - routeSamplelessRouteTemplates.length;
    const parameterizedCoverageBoundary = {
      scope: 'parameterized-route-family-boundary',
      familyKind: entry.familyKind,
      routeTemplateCount: entry.routeTemplates.length,
      routeSampledRouteTemplateCount,
      routeSamplelessRouteTemplateCount: routeSamplelessRouteTemplates.length,
      readyForControlledScopeClosure: routeSamplelessRouteTemplates.length === 0,
      closureDisposition: 'keep-parameterized-family',
      plannedSurfacePromotionRequired: false,
      reason: 'dynamic-route-templates-are-open-families-not-finite-stable-planned-surfaces',
      nextEvidence: routeSamplelessRouteTemplates.length > 0
        ? 'rerun-source-surface-with-route-sample-capture'
        : null,
    };
    return {
      ...entry,
      routeSampledRouteTemplateCount,
      routeSamplelessRouteTemplateCount: routeSamplelessRouteTemplates.length,
      routeSamplelessRouteTemplates,
      parameterizedCoverageBoundary,
      routeTemplateBoundaries,
    };
  }).sort((left, right) => (
    right.routeTemplateCount - left.routeTemplateCount
    || right.observedAsCandidateCount - left.observedAsCandidateCount
    || left.familyKind.localeCompare(right.familyKind)
  ));
  return {
    scope: 'safe-visited-frontier-route-families',
    familyCount: families.length,
    routeTemplateCount: safeRoutes.length,
    parameterizedReplayFamilyCount: families.filter((entry) => entry.parameterizedReplayRequired).length,
    parameterizedReplayRouteTemplateCount: families
      .filter((entry) => entry.parameterizedReplayRequired)
      .reduce((sum, entry) => sum + numberOrZero(entry.routeTemplateCount), 0),
    sampleCount: families.reduce((sum, entry) => sum + numberOrZero(entry.routeSampleCount), 0),
    samplelessRouteTemplateCount: families
      .reduce((sum, entry) => sum + numberOrZero(entry.routeSamplelessRouteTemplateCount), 0),
    samplelessRouteTemplates: dedupeStrings(families.flatMap((entry) => entry.routeSamplelessRouteTemplates ?? [])),
    parameterizedCoverageBoundary: {
      scope: 'parameterized-route-family-boundary-summary',
      familyCount: families.length,
      routeTemplateCount: safeRoutes.length,
      routeSampledRouteTemplateCount: families
        .reduce((sum, entry) => sum + numberOrZero(entry.routeSampledRouteTemplateCount), 0),
      routeSamplelessRouteTemplateCount: families
        .reduce((sum, entry) => sum + numberOrZero(entry.routeSamplelessRouteTemplateCount), 0),
      readyForControlledScopeClosure: families.every((entry) => numberOrZero(entry.routeSamplelessRouteTemplateCount) === 0),
      closureDisposition: 'keep-parameterized-families',
      plannedSurfacePromotionRequired: false,
      reason: 'dynamic-route-templates-are-open-families-not-finite-stable-planned-surfaces',
      nextEvidence: families.some((entry) => numberOrZero(entry.routeSamplelessRouteTemplateCount) > 0)
        ? 'rerun-source-surfaces-with-route-sample-capture'
        : null,
    },
    capabilities: dedupeStrings(families.map((entry) => entry.capability)),
    intents: dedupeStrings(families.map((entry) => entry.intent)),
    families,
  };
}

function isDynamicSeedRouteTemplate(routeTemplate) {
  return /(?:^|[/?&=]):[a-z][\w-]*/iu.test(String(routeTemplate ?? ''));
}

function countValues(values = []) {
  const counts = new Map();
  for (const value of values) {
    const text = cleanString(value) ?? 'unknown';
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

function buildDynamicSeedInstanceCoverage(rows = []) {
  const seedRunsByKey = new Map();
  for (const row of rows) {
    const routeTemplate = safeInventoryRouteTemplate(row.routeTemplate);
    if (!routeTemplate || !isDynamicSeedRouteTemplate(routeTemplate)) continue;
    const family = routeFamilyForTemplate(routeTemplate);
    if (!family) continue;
    const key = [
      row.site,
      row.surface,
      routeTemplate,
      row.id,
      row.finishedAt,
      row.manifestPath,
    ].map((part) => String(part ?? '')).join(':');
    if (seedRunsByKey.has(key)) continue;
    seedRunsByKey.set(key, {
      site: row.site ?? null,
      surface: row.surface ?? null,
      status: row.status ?? 'unknown',
      routeTemplate,
      familyKind: family.familyKind,
      capability: family.capability,
      intent: family.intent,
      finishedAt: row.finishedAt ?? null,
    });
  }
  const seedRuns = [...seedRunsByKey.values()];
  const familiesByKind = new Map();
  for (const run of seedRuns) {
    if (!familiesByKind.has(run.familyKind)) {
      familiesByKind.set(run.familyKind, {
        familyKind: run.familyKind,
        capability: run.capability,
        intent: run.intent,
        seedRunCount: 0,
        surfaceCount: 0,
        routeTemplateCount: 0,
        routeTemplates: [],
        routeShapes: [],
        statuses: [],
        latestFinishedAt: null,
      });
    }
    const current = familiesByKind.get(run.familyKind);
    current.seedRunCount += 1;
    current.routeTemplates = dedupeStrings([...current.routeTemplates, run.routeTemplate]);
    current.routeTemplateCount = current.routeTemplates.length;
    current.surfaceCount = dedupeStrings([
      ...(current.surfaces ?? []),
      run.surface,
    ]).length;
    current.surfaces = dedupeStrings([
      ...(current.surfaces ?? []),
      run.surface,
    ]);
    current.statuses = countValues([
      ...current.statuses.flatMap((entry) => Array(entry.count).fill(entry.value)),
      run.status,
    ]);
    current.routeShapes = current.routeTemplates.map(routeTemplateShape);
    if (!current.latestFinishedAt || String(run.finishedAt ?? '') > current.latestFinishedAt) {
      current.latestFinishedAt = run.finishedAt ?? null;
    }
  }
  const families = [...familiesByKind.values()]
    .map((entry) => {
      const { surfaces: _surfaces, ...publicEntry } = entry;
      return publicEntry;
    })
    .sort((left, right) => (
      right.seedRunCount - left.seedRunCount
      || right.routeTemplateCount - left.routeTemplateCount
      || left.familyKind.localeCompare(right.familyKind)
    ));
  const routeTemplates = dedupeStrings(seedRuns.map((run) => run.routeTemplate));
  return {
    scope: 'executed-dynamic-seed-instances',
    seedRunCount: seedRuns.length,
    familyCount: families.length,
    routeTemplateCount: routeTemplates.length,
    surfaceCount: dedupeStrings(seedRuns.map((run) => run.surface)).length,
    routeTemplates,
    statuses: countValues(seedRuns.map((run) => run.status)),
    latestFinishedAt: seedRuns
      .map((run) => run.finishedAt)
      .filter(Boolean)
      .sort((left, right) => String(right).localeCompare(String(left)))[0] ?? null,
    families,
  };
}

function routeTemplateParameters(routeTemplate) {
  const route = safeInventoryRouteTemplate(routeTemplate);
  if (!route) return [];
  return dedupeStrings((route.match(/:[a-z][\w-]*/giu) ?? []).map((token) => token.slice(1)));
}

function buildDynamicSeedExpansion({ surfaceRows = [], dynamicSeedCoverage = {}, readCrawlFrontier = {} } = {}) {
  const dynamicSeeds = /** @type {any} */ (dynamicSeedCoverage);
  const frontier = /** @type {any} */ (readCrawlFrontier);
  const seededRouteTemplates = new Set(Array.isArray(dynamicSeeds.routeTemplates)
    ? dynamicSeeds.routeTemplates
    : []);
  const frontierBoundaries = new Map(
    (frontier.dynamicRouteFamilies?.families ?? [])
      .flatMap((family) => family.routeTemplateBoundaries ?? [])
      .map((entry) => [entry.routeTemplate, entry]),
  );
  const byRoute = new Map();
  for (const row of surfaceRows) {
    const routeTemplate = safeInventoryRouteTemplate(row.routeTemplate);
    if (!routeTemplate || !isDynamicSeedRouteTemplate(routeTemplate)) continue;
    const family = routeFamilyForTemplate(routeTemplate);
    if (!family) continue;
    if (!byRoute.has(routeTemplate)) {
      const frontierBoundary = frontierBoundaries.get(routeTemplate) ?? null;
      byRoute.set(routeTemplate, {
        routeTemplate,
        familyKind: family.familyKind,
        capability: family.capability,
        intent: family.intent,
        parameters: routeTemplateParameters(routeTemplate),
        surfaces: [],
        surfaceCount: 0,
        targetOperations: [],
        statuses: [],
        latestFinishedAt: null,
        seedEvidenceStatus: seededRouteTemplates.has(routeTemplate)
          ? 'executed-dynamic-seed'
          : 'planned-dynamic-surface',
        frontierSampleStatus: frontierBoundary?.sampleStatus ?? null,
        userApprovalRequired: true,
        nextEvidence: 'provide-user-approved-concrete-seed-values-for-this-route-family',
      });
    }
    const current = byRoute.get(routeTemplate);
    current.surfaces = dedupeStrings([...current.surfaces, row.surface]);
    current.surfaceCount = current.surfaces.length;
    current.targetOperations = dedupeStrings([...current.targetOperations, ...(row.targetOperations ?? [])]);
    current.statuses = countValues([
      ...current.statuses.flatMap((entry) => Array(entry.count).fill(entry.value)),
      row.status,
    ]);
    if (!current.latestFinishedAt || String(row.finishedAt ?? '') > current.latestFinishedAt) {
      current.latestFinishedAt = row.finishedAt ?? null;
    }
  }
  const candidates = [...byRoute.values()].sort((left, right) => (
    left.familyKind.localeCompare(right.familyKind)
    || left.routeTemplate.localeCompare(right.routeTemplate)
  ));
  const families = [...new Set(candidates.map((entry) => entry.familyKind))]
    .sort()
    .map((familyKind) => {
      const familyCandidates = candidates.filter((entry) => entry.familyKind === familyKind);
      return {
        familyKind,
        candidateCount: familyCandidates.length,
        routeTemplateCount: familyCandidates.length,
        routeTemplates: familyCandidates.map((entry) => entry.routeTemplate),
        parameters: dedupeStrings(familyCandidates.flatMap((entry) => entry.parameters)),
      };
    });
  return {
    scope: 'specific-dynamic-route-family-seed-expansion',
    userApprovalRequired: candidates.length > 0,
    candidateCount: candidates.length,
    familyCount: families.length,
    routeTemplateCount: candidates.length,
    routeTemplates: candidates.map((entry) => entry.routeTemplate),
    nextEvidence: candidates.length > 0
      ? 'provide-user-approved-concrete-seed-values-for-specific-dynamic-route-families'
      : null,
    families,
    candidates,
  };
}

function buildReadCrawlFrontier(surfaceRows = [], routeTemplateReplayCoverage = []) {
  const plannedRouteTemplates = new Set(
    surfaceRows
      .map((row) => safeInventoryRouteTemplate(row.routeTemplate))
      .filter(Boolean),
  );
  plannedRouteTemplates.add('/compose/post');
  const frontierRoutes = routeTemplateReplayCoverage
    .filter((entry) => entry?.routeTemplate && !plannedRouteTemplates.has(entry.routeTemplate))
    .map((entry) => ({
      routeTemplate: entry.routeTemplate,
      replayDisposition: entry.replayDisposition,
      expansionStatus: frontierExpansionStatus(entry),
      surfaceCount: numberOrZero(entry.surfaceCount),
      observedAsPageCount: numberOrZero(entry.observedAsPageCount),
      observedAsCandidateCount: numberOrZero(entry.observedAsCandidateCount),
      blockedFunctionCount: numberOrZero(entry.blockedFunctionCount),
      functionKinds: entry.functionKinds ?? [],
      executionClasses: entry.executionClasses ?? [],
      redirectedToRouteTemplates: entry.redirectedToRouteTemplates ?? [],
      routeSamples: entry.routeSamples ?? [],
      sampleCoverageStatus: null,
      sampledSpecificRouteTemplates: [],
    }));
  const sampledSpecificRoutes = routeTemplateReplayCoverage
    .filter((entry) => ['visited-route', 'redirected-route'].includes(entry.replayDisposition))
    .filter((entry) => (entry.routeSamples ?? []).length > 0)
    .map((entry) => entry.routeTemplate);
  for (const route of frontierRoutes) {
    const allowSpecificCoverageWithSamples = routeTemplateIsSafeStructureFamily(route.routeTemplate);
    if (route.expansionStatus === 'unresolved-candidate') {
      const coveredBy = sampledSpecificRoutes.filter((sampledRoute) => routeTemplateSpecificityCover(route.routeTemplate, sampledRoute));
      if (coveredBy.length) {
        route.sampleCoverageStatus = 'sampled-specific-covered';
        route.sampledSpecificRouteTemplates = coveredBy;
      }
    }
    if (
      ['visited-covered', 'redirected-covered'].includes(route.expansionStatus)
      && (allowSpecificCoverageWithSamples || (route.routeSamples ?? []).length === 0)
    ) {
      const coveredBy = sampledSpecificRoutes.filter((sampledRoute) => routeTemplateSpecificityCover(route.routeTemplate, sampledRoute));
      if (coveredBy.length) {
        route.sampleCoverageStatus = 'sampled-specific-covered';
        route.sampledSpecificRouteTemplates = coveredBy;
      }
    }
  }
  const safeVisitedFrontierRoutes = frontierRoutes
    .filter((entry) => ['visited-covered', 'redirected-covered'].includes(entry.expansionStatus))
    .map((entry) => entry.routeTemplate);
  const routeSampledFrontierRoutes = frontierRoutes
    .filter((entry) => ['visited-covered', 'redirected-covered'].includes(entry.expansionStatus))
    .filter((entry) => (entry.routeSamples ?? []).length > 0)
    .map((entry) => entry.routeTemplate);
  const routeSamplelessFrontierRoutes = frontierRoutes
    .filter((entry) => ['visited-covered', 'redirected-covered'].includes(entry.expansionStatus))
    .filter((entry) => (entry.routeSamples ?? []).length === 0)
    .filter((entry) => entry.sampleCoverageStatus !== 'sampled-specific-covered')
    .map((entry) => entry.routeTemplate);
  const blockedFrontierRoutes = frontierRoutes
    .filter((entry) => entry.expansionStatus === 'blocked-risk')
    .map((entry) => entry.routeTemplate);
  const unresolvedFrontierRoutes = frontierRoutes
    .filter((entry) => entry.expansionStatus === 'unresolved-candidate')
    .filter((entry) => entry.sampleCoverageStatus !== 'sampled-specific-covered')
    .map((entry) => entry.routeTemplate);
  const frontierFunctionKinds = dedupeStrings(frontierRoutes.flatMap((entry) => entry.functionKinds));
  const blockedFrontierFunctionKinds = dedupeStrings(
    frontierRoutes
      .filter((entry) => entry.expansionStatus === 'blocked-risk')
      .flatMap((entry) => entry.functionKinds),
  );
  const dynamicRouteFamilies = buildDynamicRouteFamilySummary(frontierRoutes);
  const gaps = frontierRoutes
    .map(frontierGapForRoute)
    .filter(Boolean);
  const frontierDecisions = frontierRoutes
    .map(frontierDecisionForRoute)
    .filter(Boolean);
  const decisionSummary = summarizeFrontierDecisions(frontierDecisions, frontierRoutes.length, gaps);
  return {
    scope: 'outside-planned-surface-route-templates',
    plannedRouteTemplateCount: plannedRouteTemplates.size,
    plannedRouteTemplates: [...plannedRouteTemplates].sort(),
    routeTemplateCount: frontierRoutes.length,
    safeVisitedRouteCount: safeVisitedFrontierRoutes.length,
    safeVisitedRoutes: safeVisitedFrontierRoutes,
    routeSampledRouteCount: routeSampledFrontierRoutes.length,
    routeSampledRoutes: routeSampledFrontierRoutes,
    routeSamplelessRouteCount: routeSamplelessFrontierRoutes.length,
    routeSamplelessRoutes: routeSamplelessFrontierRoutes,
    blockedRouteCount: blockedFrontierRoutes.length,
    blockedRoutes: blockedFrontierRoutes,
    unresolvedRouteCount: unresolvedFrontierRoutes.length,
    unresolvedRoutes: unresolvedFrontierRoutes,
    functionKinds: frontierFunctionKinds,
    blockedFunctionKinds: blockedFrontierFunctionKinds,
    gapCount: gaps.length,
    gaps,
    dynamicRouteFamilies,
    decisionSummary,
    decisions: frontierDecisions.slice(0, 120),
    routes: frontierRoutes.slice(0, 120),
  };
}

function normalizeDiscoveredFunctionEntry(entry = {}) {
  const functionKind = safeInventoryDescriptor(entry.functionKind, INVENTORY_SAFE_FUNCTION_KINDS);
  if (!functionKind) return null;
  const intent = safeInventoryDescriptor(entry.intent, INVENTORY_SAFE_FUNCTION_INTENTS)
    ?? FUNCTION_KIND_DEFAULT_INTENTS[functionKind]
    ?? null;
  return {
    functionKind,
    intent,
    executionClass: safeInventoryDescriptor(entry.executionClass, INVENTORY_SAFE_EXECUTION_CLASSES),
    mutationRisk: safeInventoryDescriptor(entry.mutationRisk, INVENTORY_SAFE_MUTATION_RISKS),
  };
}

function classifyObservedApiOperations(operations = [], targetOperations = []) {
  const targetSet = new Set(targetOperations);
  const entries = operations.map((operation) => {
    const operationClass = targetSet.has(operation)
      ? 'target-functional'
      : OBSERVED_API_OPERATION_CLASSES[operation] ?? 'unclassified-observed';
    return {
      operation,
      operationClass,
    };
  });
  const byClass = new Map();
  for (const entry of entries) {
    const list = byClass.get(entry.operationClass) ?? [];
    list.push(entry.operation);
    byClass.set(entry.operationClass, list);
  }
  const classCounts = [...byClass.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([operationClass, values]) => ({
      operationClass,
      count: values.length,
    }));
  const operationsForClass = (operationClass) => byClass.get(operationClass) ?? [];
  return {
    entries,
    classCounts,
    targetFunctional: operationsForClass('target-functional'),
    supportRead: operationsForClass('support-read'),
    commerceSupportRead: operationsForClass('commerce-support-read'),
    telemetryOrAd: operationsForClass('telemetry-or-ad'),
    sideEffectRisk: operationsForClass('side-effect-risk'),
    contentWriteRisk: operationsForClass('content-write-risk'),
    authReplayBlocked: operationsForClass('auth-replay-blocked'),
    unclassifiedObserved: operationsForClass('unclassified-observed'),
  };
}

function summarizeCoverageExpansionCandidateClasses(candidates = []) {
  const counts = new Map();
  for (const candidate of candidates) {
    if (!candidate.operationClass) continue;
    counts.set(candidate.operationClass, (counts.get(candidate.operationClass) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([operationClass, count]) => ({ operationClass, count }));
}

function operationObservedOnSurface(row = {}, operation) {
  return (row.operations ?? []).includes(operation)
    || (row.controlProbe?.apiOperations ?? []).includes(operation)
    || (row.controlProbe?.apiReadLikeOperations ?? []).includes(operation)
    || (row.controlProbe?.apiSideEffectRiskOperations ?? []).includes(operation)
    || (row.readCrawl?.apiOperations ?? []).includes(operation)
    || (row.readCrawl?.apiReadLikeOperations ?? []).includes(operation)
    || (row.readCrawl?.apiSideEffectRiskOperations ?? []).includes(operation);
}

function buildCoverageExpansionCandidates({
  site = null,
  operations = [],
  targetOperations = [],
  apiOperationDiscovery = null,
  surfaceRows = [],
} = {}) {
  const candidateDetails = API_COVERAGE_EXPANSION_CANDIDATES_BY_SITE[site] ?? {};
  const targetSet = new Set(targetOperations);
  const operationClassByName = new Map((apiOperationDiscovery?.entries ?? []).map((entry) => [
    entry.operation,
    entry.operationClass,
  ]));
  return operations
    .filter((operation) => !targetSet.has(operation))
    .map((operation) => {
      const details = candidateDetails[operation];
      if (!details) return null;
      const evidenceSurfaces = dedupeStrings(
        surfaceRows
          .filter((row) => operationObservedOnSurface(row, operation))
          .map((row) => row.surface),
      );
      return {
        operation,
        operationClass: operationClassByName.get(operation) ?? OBSERVED_API_OPERATION_CLASSES[operation] ?? 'unclassified-observed',
        ...details,
        evidenceSurfaceCount: evidenceSurfaces.length,
        evidenceSurfaces: evidenceSurfaces.slice(0, 12),
      };
    })
    .filter(Boolean);
}

function buildDiscoverySummary({
  site = null,
  capabilities = [],
  intents = [],
  inventoryControlFunctions = [],
  probeRows = [],
  crawlRows = [],
  operations = [],
  targetOperations = [],
  apiOperationRisk = [],
  frontier = null,
  surfaceRows = [],
} = {}) {
  const functionEntries = [
    ...inventoryControlFunctions,
    ...probeRows.flatMap((probe) => probe.probes ?? []),
    ...crawlRows.flatMap((crawl) => crawl.blockedFunctions ?? []),
    ...crawlRows.flatMap((crawl) => (crawl.functionKinds ?? []).map((functionKind) => ({ functionKind }))),
    ...(frontier?.routes ?? []).flatMap((route) => (route.functionKinds ?? []).map((functionKind) => ({
      functionKind,
      executionClass: route.executionClasses?.[0] ?? null,
    }))),
  ].map(normalizeDiscoveredFunctionEntry).filter(Boolean);
  const readExecutionClasses = new Set([
    'read-media-probe',
    'read-menu-probe',
    'read-navigation-probe',
    'read-search-probe',
    'read-tab-probe',
  ]);
  const blockedExecutionClasses = new Set([
    'auth-blocked',
    'mutation-blocked',
    'side-effect-risk-blocked',
    'unknown-risk-blocked',
  ]);
  const readLikeApiOperations = dedupeStrings(
    apiOperationRisk
      .filter((entry) => entry.riskClass === 'read-like')
      .map((entry) => entry.operation),
  );
  const replayBlockedApiOperations = dedupeStrings(
    apiOperationRisk
      .filter((entry) => entry.replayDisposition === 'replay-blocked')
      .map((entry) => entry.operation),
  );
  const apiOperationDiscovery = classifyObservedApiOperations(operations, targetOperations);
  const coverageExpansionCandidates = buildCoverageExpansionCandidates({
    site,
    operations,
    targetOperations,
    apiOperationDiscovery,
    surfaceRows,
  });
  const dynamicRouteFamilyCapabilities = frontier?.dynamicRouteFamilies?.capabilities ?? [];
  const dynamicRouteFamilyIntents = frontier?.dynamicRouteFamilies?.intents ?? [];
  return {
    plannedCapabilityCount: capabilities.length,
    plannedCapabilities: capabilities,
    discoveredCapabilityCount: dedupeStrings([
      ...capabilities,
      ...dynamicRouteFamilyCapabilities,
    ]).length,
    discoveredCapabilities: dedupeStrings([
      ...capabilities,
      ...dynamicRouteFamilyCapabilities,
    ]),
    plannedIntentCount: intents.length,
    plannedIntents: intents,
    dynamicRouteFamilyCount: frontier?.dynamicRouteFamilies?.familyCount ?? 0,
    dynamicRouteFamilyRouteTemplateCount: frontier?.dynamicRouteFamilies?.routeTemplateCount ?? 0,
    dynamicRouteParameterizedFamilyCount: frontier?.dynamicRouteFamilies?.parameterizedReplayFamilyCount ?? 0,
    dynamicRouteParameterizedTemplateCount: frontier?.dynamicRouteFamilies?.parameterizedReplayRouteTemplateCount ?? 0,
    dynamicRouteSampleCount: frontier?.dynamicRouteFamilies?.sampleCount ?? 0,
    dynamicRouteSamplelessTemplateCount: frontier?.dynamicRouteFamilies?.samplelessRouteTemplateCount ?? 0,
    dynamicRouteFamilyCapabilities,
    dynamicRouteFamilyIntents,
    discoveredFunctionKindCount: dedupeStrings(functionEntries.map((entry) => entry.functionKind)).length,
    discoveredFunctionKinds: dedupeStrings(functionEntries.map((entry) => entry.functionKind)),
    discoveredIntentCount: dedupeStrings([
      ...intents,
      ...dynamicRouteFamilyIntents,
      ...functionEntries.map((entry) => entry.intent),
    ]).length,
    discoveredIntents: dedupeStrings([
      ...intents,
      ...dynamicRouteFamilyIntents,
      ...functionEntries.map((entry) => entry.intent),
    ]),
    executionClasses: dedupeStrings(functionEntries.map((entry) => entry.executionClass)),
    mutationRisks: dedupeStrings(functionEntries.map((entry) => entry.mutationRisk)),
    readExecutableFunctionKinds: dedupeStrings(
      functionEntries
        .filter((entry) => readExecutionClasses.has(entry.executionClass))
        .map((entry) => entry.functionKind),
    ),
    blockedFunctionKinds: dedupeStrings([
      ...functionEntries
        .filter((entry) => blockedExecutionClasses.has(entry.executionClass))
        .map((entry) => entry.functionKind),
      ...(frontier?.blockedFunctionKinds ?? []),
    ]),
    observedOnlyFunctionKinds: dedupeStrings(
      functionEntries
        .filter((entry) => entry.executionClass === 'observed-only')
        .map((entry) => entry.functionKind),
    ),
    observedApiOperationCount: operations.length,
    observedApiOperations: operations,
    targetApiOperationCount: targetOperations.length,
    targetApiOperations: targetOperations,
    observedNonTargetApiOperationCount: operations.length - targetOperations.length,
    observedNonTargetApiOperations: operations.filter((operation) => !targetOperations.includes(operation)),
    observedApiOperationClasses: apiOperationDiscovery.entries,
    observedApiOperationClassCounts: apiOperationDiscovery.classCounts,
    supportReadApiOperationCount: apiOperationDiscovery.supportRead.length,
    supportReadApiOperations: apiOperationDiscovery.supportRead,
    commerceSupportReadApiOperationCount: apiOperationDiscovery.commerceSupportRead.length,
    commerceSupportReadApiOperations: apiOperationDiscovery.commerceSupportRead,
    telemetryOrAdApiOperationCount: apiOperationDiscovery.telemetryOrAd.length,
    telemetryOrAdApiOperations: apiOperationDiscovery.telemetryOrAd,
    sideEffectRiskObservedApiOperationCount: apiOperationDiscovery.sideEffectRisk.length,
    sideEffectRiskObservedApiOperations: apiOperationDiscovery.sideEffectRisk,
    contentWriteRiskObservedApiOperationCount: apiOperationDiscovery.contentWriteRisk.length,
    contentWriteRiskObservedApiOperations: apiOperationDiscovery.contentWriteRisk,
    authReplayBlockedObservedApiOperationCount: apiOperationDiscovery.authReplayBlocked.length,
    authReplayBlockedObservedApiOperations: apiOperationDiscovery.authReplayBlocked,
    unclassifiedObservedApiOperationCount: apiOperationDiscovery.unclassifiedObserved.length,
    unclassifiedObservedApiOperations: apiOperationDiscovery.unclassifiedObserved,
    coverageExpansionCandidateCount: coverageExpansionCandidates.length,
    coverageExpansionCandidates,
    coverageExpansionCandidateOperationClasses: summarizeCoverageExpansionCandidateClasses(coverageExpansionCandidates),
    apiOperationCount: apiOperationRisk.length,
    apiReadReplayEligibleCount: readLikeApiOperations.length,
    apiReadReplayEligibleOperations: readLikeApiOperations,
    apiReplayBlockedCount: replayBlockedApiOperations.length,
    apiReplayBlockedOperations: replayBlockedApiOperations,
  };
}

function mergeReadCrawl(rows) {
  const crawls = rows
    .map((row) => row.readCrawl)
    .filter((crawl) => crawl && typeof crawl === 'object' && crawl.observed === true);
  if (!crawls.length) {
    return emptyReadCrawlSummary();
  }
  const routeCoverageCrawls = selectAuthoritativeReadCrawlsForRouteCoverage(crawls);
  const apiOperationRisk = mergeApiOperationRiskEntries(crawls);
  const routeTemplateReplayCoverage = mergeRouteTemplateReplayCoverage(routeCoverageCrawls, { countMode: 'max' });
  return {
    observed: true,
    requested: crawls.some((crawl) => crawl.requested === true),
    maxPages: maxNumber(crawls.map((crawl) => crawl.maxPages)),
    maxDepth: maxNumber(crawls.map((crawl) => crawl.maxDepth)),
    visitedCount: maxNumber(crawls.map((crawl) => crawl.visitedCount)),
    queuedCount: maxNumber(crawls.map((crawl) => crawl.queuedCount)),
    pendingQueueCount: crawls.some((crawl) => crawl.exhausted === true)
      ? 0
      : minPositiveNumber(crawls.map((crawl) => crawl.pendingQueueCount)),
    exhausted: crawls.some((crawl) => crawl.exhausted === true),
    discoveredRouteTemplateCount: dedupeStrings(routeCoverageCrawls.flatMap((crawl) => crawl.discoveredRouteTemplates ?? [])).length,
    discoveredRouteTemplates: dedupeStrings(routeCoverageCrawls.flatMap((crawl) => crawl.discoveredRouteTemplates ?? [])),
    functionKinds: dedupeStrings(routeCoverageCrawls.flatMap((crawl) => crawl.functionKinds ?? [])),
    executionClasses: dedupeStrings(routeCoverageCrawls.flatMap((crawl) => crawl.executionClasses ?? [])),
    blockedRouteCount: maxNumber(routeCoverageCrawls.map((crawl) => crawl.blockedRouteCount)),
    blockedFunctions: mergeCountedEntriesByMax(
      routeCoverageCrawls,
      (crawl) => crawl.blockedFunctions ?? [],
      (entry) => `${entry.executionClass}:${entry.functionKind}:${entry.intent}:${entry.mutationRisk}:${entry.routeTemplate}`,
      (entry) => ({
        routeTemplate: entry.routeTemplate,
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      }),
    ),
    apiResponseCount: crawls.reduce((sum, crawl) => sum + numberOrZero(crawl.apiResponseCount), 0),
    apiOperations: dedupeStrings(crawls.flatMap((crawl) => crawl.apiOperations ?? [])),
    apiReadLikeOperations: dedupeStrings(crawls.flatMap((crawl) => crawl.apiReadLikeOperations ?? [])),
    apiSideEffectRiskOperations: dedupeStrings(crawls.flatMap((crawl) => crawl.apiSideEffectRiskOperations ?? [])),
    apiOperationRisk,
    apiOperationRiskSummary: summarizeApiOperationRisk(apiOperationRisk),
    routeTemplateReplaySummary: summarizeRouteTemplateReplayCoverage(
      routeTemplateReplayCoverage,
      crawls.some((crawl) => crawl.routeTemplateReplaySummary?.allExhausted === true || crawl.exhausted === true),
    ),
    routeTemplateReplayCoverage,
    routeSamples: dedupeRouteSamples(routeCoverageCrawls.flatMap((crawl) => crawl.routeSamples ?? [])),
    pages: routeCoverageCrawls.flatMap((crawl) => crawl.pages ?? []).slice(0, 80),
  };
}

function mergeSurfaceEvidenceRows(rows) {
  const latest = rows.reduce((selected, row) => (
    !selected || String(row.finishedAt ?? '') > String(selected.finishedAt ?? '') ? row : selected
  ), null);
  const best = rows.reduce((selected, row) => (
    compareSurfaceEvidenceRows(row, selected) > 0 ? row : selected
  ), null);
  return {
    ...latest,
    status: best?.status ?? latest?.status,
    reason: best?.reason ?? latest?.reason ?? null,
    latestStatus: latest?.status ?? null,
    latestReason: latest?.reason ?? null,
    accountProvided: rows.some((row) => row.accountProvided === true),
    queryProvided: rows.some((row) => row.queryProvided === true),
    dateProvided: rows.some((row) => row.dateProvided === true),
    apiPages: maxNumber(rows.map((row) => row.apiPages)),
    itemCount: maxNumber(rows.map((row) => row.itemCount)),
    userCount: maxNumber(rows.map((row) => row.userCount)),
    mediaCount: maxNumber(rows.map((row) => row.mediaCount)),
    apiRequestCount: maxNumber(rows.map((row) => row.apiRequestCount)),
    apiResponseCount: maxNumber(rows.map((row) => row.apiResponseCount)),
    parsedApiResponseCount: maxNumber(rows.map((row) => row.parsedApiResponseCount)),
    operations: dedupeStrings(rows.flatMap((row) => row.operations ?? [])),
    targetOperations: dedupeStrings(rows.flatMap((row) => row.targetOperations ?? [])),
    surfaceInventory: mergeSurfaceInventory(rows),
    controlProbe: mergeControlProbe(rows),
    readCrawl: mergeReadCrawl(rows),
    evidenceRunCount: rows.length,
    evidenceManifestPaths: dedupeStrings(rows.map((row) => row.manifestPath)).slice(0, 12),
  };
}

function latestSurfaceRows(rows) {
  const bySurface = new Map();
  for (const row of rows) {
    if (!row.site || !row.surface) continue;
    const key = `${row.site}:${row.surface}`;
    bySurface.set(key, [...(bySurface.get(key) ?? []), row]);
  }
  return [...bySurface.values()].map((surfaceRows) => mergeSurfaceEvidenceRows(surfaceRows)).sort((left, right) => {
    const siteOrder = String(left.site).localeCompare(String(right.site));
    if (siteOrder !== 0) return siteOrder;
    const leftIndex = surfaceSortIndex(left.site, left.surface);
    const rightIndex = surfaceSortIndex(right.site, right.surface);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return String(left.surface).localeCompare(String(right.surface));
  });
}

function compactSurfaceRow(row) {
  const inventory = row.surfaceInventory && typeof row.surfaceInventory === 'object'
    ? row.surfaceInventory
    : {
      observed: false,
      urlRouteTemplate: null,
      linkCount: 0,
      controlCount: 0,
      formCount: 0,
      linkRoutes: [],
      controls: [],
      controlFunctions: [],
      anonymousControls: [],
      forms: [],
    };
  return {
    surface: row.surface,
    status: row.status,
    reason: row.reason ?? null,
    latestStatus: row.latestStatus ?? null,
    latestReason: row.latestReason ?? null,
    action: row.action ?? null,
    contentType: row.contentType ?? null,
    routeTemplate: row.routeTemplate ?? null,
    capability: row.capability ?? null,
    intent: row.intent ?? null,
    accountProvided: row.accountProvided === true,
    queryProvided: row.queryProvided === true,
    dateProvided: row.dateProvided === true,
    apiPages: numberOrZero(row.apiPages),
    apiRequestCount: numberOrZero(row.apiRequestCount),
    apiResponseCount: numberOrZero(row.apiResponseCount),
    parsedApiResponseCount: numberOrZero(row.parsedApiResponseCount),
    itemCount: numberOrZero(row.itemCount),
    userCount: numberOrZero(row.userCount),
    mediaCount: numberOrZero(row.mediaCount),
    targetOperations: Array.isArray(row.targetOperations) ? row.targetOperations : [],
    operations: Array.isArray(row.operations) ? row.operations : [],
    surfaceInventory: inventory,
    controlProbe: row.controlProbe && typeof row.controlProbe === 'object'
      ? row.controlProbe
      : emptyControlProbeSummary(),
    readCrawl: row.readCrawl && typeof row.readCrawl === 'object'
      ? row.readCrawl
      : emptyReadCrawlSummary(),
    evidenceRunCount: numberOrZero(row.evidenceRunCount),
    evidenceManifestPaths: Array.isArray(row.evidenceManifestPaths) ? row.evidenceManifestPaths : [],
    finishedAt: row.finishedAt ?? null,
    manifestPath: row.manifestPath ?? null,
  };
}

function mergeCountedEntries(rows, selector, keyFn, mapper, limit = 80) {
  const counts = new Map();
  const samples = new Map();
  for (const row of rows) {
    for (const entry of selector(row) ?? []) {
      const key = keyFn(entry);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + numberOrZero(entry.count ?? 1));
      if (!samples.has(key)) {
        samples.set(key, mapper(entry));
      }
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key, count]) => ({
      ...samples.get(key),
      count,
    }));
}

function observedApiOperationsForSurfaceRow(row = {}) {
  return dedupeStrings([
    ...(row.operations ?? []),
    ...(row.controlProbe?.apiOperations ?? []),
    ...(row.controlProbe?.apiReadLikeOperations ?? []),
    ...(row.controlProbe?.apiSideEffectRiskOperations ?? []),
    ...(row.readCrawl?.apiOperations ?? []),
    ...(row.readCrawl?.apiReadLikeOperations ?? []),
    ...(row.readCrawl?.apiSideEffectRiskOperations ?? []),
    ...(row.readCrawl?.apiOperationRisk ?? []).map((entry) => entry?.operation),
  ]);
}

function buildCoverage(rows) {
  const rawRowsBySite = {};
  for (const row of rows) {
    const site = row.site || 'unknown';
    rawRowsBySite[site] ??= [];
    rawRowsBySite[site].push(row);
  }
  const bySite = {};
  for (const row of latestSurfaceRows(rows)) {
    const site = row.site || 'unknown';
    bySite[site] ??= [];
    bySite[site].push(compactSurfaceRow(row));
  }

  const coverage = {};
  for (const [site, surfaceRows] of Object.entries(bySite)) {
    const rawSiteRows = rawRowsBySite[site] ?? [];
    const expectedSurfaces = EXPECTED_SURFACES_BY_SITE[site] ?? [];
    const coveredSurfaces = new Set(surfaceRows.map((row) => row.surface));
    const missingExpectedSurfaces = expectedSurfaces.filter((surface) => !coveredSurfaces.has(surface));
    const boundedOrPassed = surfaceRows.filter((row) => GOOD_COVERAGE_STATUSES.has(row.status)).length;
    const operations = dedupeStrings(surfaceRows.flatMap((row) => observedApiOperationsForSurfaceRow(row)));
    const targetOperations = dedupeStrings(surfaceRows.flatMap((row) => row.targetOperations));
    const apiOperationOnlyRows = surfaceRows.filter((row) => (
      numberOrZero(row.apiResponseCount) > 0
      && numberOrZero(row.apiPages) === 0
    ));
    const apiOperationOnlyOperations = dedupeStrings(apiOperationOnlyRows.flatMap((row) => row.operations));
    const apiCoveredByChildSurfaces = buildChildApiCoverageRows(surfaceRows);
    const routeTemplates = dedupeStrings(surfaceRows.map((row) => row.routeTemplate));
    const capabilities = dedupeStrings(surfaceRows.map((row) => row.capability));
    const intents = dedupeStrings(surfaceRows.map((row) => row.intent));
    const inventoryLinkRoutes = mergeCountedEntries(
      surfaceRows,
      (row) => row.surfaceInventory?.linkRoutes ?? [],
      (entry) => `${entry.kind}:${entry.routeTemplate}`,
      (entry) => ({
        kind: entry.kind,
        routeTemplate: entry.routeTemplate,
      }),
    );
    const refinedInventoryControls = refineInventoryControlsByIcon(
      surfaceRows.flatMap((row) => (row.surfaceInventory?.controls ?? []).map((entry) => ({
        ...entry,
        surface: row.surface,
        surfaceRouteTemplate: row.routeTemplate,
      }))),
    );
    const inventoryControls = mergeCountedEntries(
      refinedInventoryControls,
      (entry) => [entry],
      inventoryControlMergeKey,
      (entry) => ({
        role: entry.role,
        testId: entry.testId,
        labelKind: entry.labelKind,
        ancestorTestId: entry.ancestorTestId,
        descendantTestId: entry.descendantTestId,
        descendantLabelKind: entry.descendantLabelKind,
        iconSignature: entry.iconSignature,
        routeTemplate: entry.routeTemplate,
        disabled: entry.disabled === true,
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      }),
    );
    const inventoryControlFunctions = mergeCountedEntries(
      refinedInventoryControls,
      (entry) => [entry],
      (entry) => `${entry.executionClass}:${entry.functionKind}:${entry.intent}:${entry.mutationRisk}`,
      (entry) => ({
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
      }),
    );
    const inventoryAnonymousControls = mergeCountedEntries(
      surfaceRows,
      (row) => row.surfaceInventory?.anonymousControls ?? [],
      (entry) => [
        entry.role,
        entry.type,
        entry.disabled ? 'disabled' : 'enabled',
        entry.closestRole,
        entry.inArticle ? 'article' : 'no-article',
        entry.inDialog ? 'dialog' : 'no-dialog',
        entry.inForm ? 'form' : 'no-form',
        entry.closestLinkKind,
        entry.closestLinkRouteTemplate,
        `svg:${numberOrZero(entry.svgCount)}`,
        `img:${numberOrZero(entry.imageCount)}`,
        `children:${numberOrZero(entry.childElementCount)}`,
      ].join(':'),
      (entry) => ({
        role: entry.role,
        type: entry.type,
        disabled: entry.disabled === true,
        closestRole: entry.closestRole,
        inArticle: entry.inArticle === true,
        inDialog: entry.inDialog === true,
        inForm: entry.inForm === true,
        closestLinkKind: entry.closestLinkKind,
        closestLinkRouteTemplate: entry.closestLinkRouteTemplate,
        svgCount: numberOrZero(entry.svgCount),
        imageCount: numberOrZero(entry.imageCount),
        childElementCount: numberOrZero(entry.childElementCount),
      }),
      40,
    );
    const anonymousControlsBySurface = mergeCountedEntries(
      surfaceRows,
      (row) => (row.surfaceInventory?.anonymousControls ?? []).map((entry) => ({
        ...entry,
        surface: row.surface,
        surfaceRouteTemplate: row.routeTemplate,
      })),
      (entry) => [
        entry.surface,
        entry.surfaceRouteTemplate,
        entry.role,
        entry.type,
        entry.disabled ? 'disabled' : 'enabled',
        entry.closestRole,
        entry.inArticle ? 'article' : 'no-article',
        entry.inDialog ? 'dialog' : 'no-dialog',
        entry.inForm ? 'form' : 'no-form',
        entry.closestLinkKind,
        entry.closestLinkRouteTemplate,
        `svg:${numberOrZero(entry.svgCount)}`,
        `img:${numberOrZero(entry.imageCount)}`,
        `children:${numberOrZero(entry.childElementCount)}`,
      ].join(':'),
      (entry) => ({
        surface: entry.surface,
        surfaceRouteTemplate: entry.surfaceRouteTemplate,
        role: entry.role,
        type: entry.type,
        disabled: entry.disabled === true,
        closestRole: entry.closestRole,
        inArticle: entry.inArticle === true,
        inDialog: entry.inDialog === true,
        inForm: entry.inForm === true,
        closestLinkKind: entry.closestLinkKind,
        closestLinkRouteTemplate: entry.closestLinkRouteTemplate,
        svgCount: numberOrZero(entry.svgCount),
        imageCount: numberOrZero(entry.imageCount),
        childElementCount: numberOrZero(entry.childElementCount),
        reason: 'anonymous-control-without-stable-label-testid-or-route',
        nextEvidence: 'capture-label-testid-route-or-icon-signature-before-probing',
      }),
      120,
    );
    const unknownRiskBlockedControls = mergeCountedEntries(
      refinedInventoryControls.filter((entry) => entry.executionClass === 'unknown-risk-blocked'),
      (entry) => [entry],
      (entry) => [
        entry.surface,
        entry.surfaceRouteTemplate,
        entry.role,
        entry.testId,
        entry.labelKind,
        entry.ancestorTestId,
        entry.descendantTestId,
        entry.descendantLabelKind,
        entry.iconSignature,
        entry.routeTemplate,
      ].join(':'),
      (entry) => ({
        surface: entry.surface,
        surfaceRouteTemplate: entry.surfaceRouteTemplate,
        role: entry.role,
        testId: entry.testId,
        labelKind: entry.labelKind,
        ancestorTestId: entry.ancestorTestId,
        descendantTestId: entry.descendantTestId,
        descendantLabelKind: entry.descendantLabelKind,
        iconSignature: entry.iconSignature,
        routeTemplate: entry.routeTemplate,
        functionKind: entry.functionKind,
        intent: entry.intent,
        executionClass: entry.executionClass,
        mutationRisk: entry.mutationRisk,
        reason: 'unlabeled-control-without-safe-function-classification',
        nextEvidence: 'capture-label-or-repeatable-testid-before-probing',
      }),
      80,
    );
    const unknownRiskBlockedControlCount = refinedInventoryControls
      .filter((entry) => entry.executionClass === 'unknown-risk-blocked')
      .reduce((sum, entry) => sum + numberOrZero(entry.count ?? 1), 0);
    const anonymousControlCount = surfaceRows
      .flatMap((row) => row.surfaceInventory?.anonymousControls ?? [])
      .reduce((sum, entry) => sum + numberOrZero(entry.count ?? 1), 0);
    const inventoryRouteTemplates = dedupeStrings(inventoryLinkRoutes.map((entry) => entry.routeTemplate));
    const inventoryControlKeys = dedupeStrings(inventoryControls.map((entry) => (
      entry.testId || entry.labelKind || entry.routeTemplate || entry.descendantTestId || entry.descendantLabelKind || entry.ancestorTestId || entry.iconSignature || entry.role
    )));
    const inventoryFunctionKinds = dedupeStrings(inventoryControlFunctions.map((entry) => entry.functionKind));
    const inventoryExecutionClasses = dedupeStrings(inventoryControlFunctions.map((entry) => entry.executionClass));
    const inventoryMutationRisks = dedupeStrings(inventoryControlFunctions.map((entry) => entry.mutationRisk));
    const probeRows = surfaceRows.map((row) => row.controlProbe).filter((probe) => probe?.observed === true);
    const probeFunctionKinds = dedupeStrings(probeRows.flatMap((probe) => probe.functionKinds ?? []));
    const probeExecutionClasses = dedupeStrings(probeRows.flatMap((probe) => probe.executionClasses ?? []));
    const probeApiOperations = dedupeStrings(probeRows.flatMap((probe) => probe.apiOperations ?? []));
    const probeApiReadLikeOperations = dedupeStrings(probeRows.flatMap((probe) => probe.apiReadLikeOperations ?? []));
    const probeApiSideEffectRiskOperations = dedupeStrings(probeRows.flatMap((probe) => probe.apiSideEffectRiskOperations ?? []));
    const crawlRows = surfaceRows.map((row) => row.readCrawl).filter((crawl) => crawl?.observed === true);
    const crawlRouteTemplates = dedupeStrings(crawlRows.flatMap((crawl) => crawl.discoveredRouteTemplates ?? []));
    const crawlFunctionKinds = dedupeStrings(crawlRows.flatMap((crawl) => crawl.functionKinds ?? []));
    const crawlExecutionClasses = dedupeStrings(crawlRows.flatMap((crawl) => crawl.executionClasses ?? []));
    const crawlApiOperations = dedupeStrings(crawlRows.flatMap((crawl) => crawl.apiOperations ?? []));
    const crawlApiReadLikeOperations = dedupeStrings(crawlRows.flatMap((crawl) => crawl.apiReadLikeOperations ?? []));
    const crawlApiSideEffectRiskOperations = dedupeStrings(crawlRows.flatMap((crawl) => crawl.apiSideEffectRiskOperations ?? []));
    const crawlApiOperationRisk = mergeApiOperationRiskEntries(crawlRows);
    const crawlRouteTemplateReplayCoverage = mergeRouteTemplateReplayCoverage(crawlRows, { countMode: 'sum' });
    const crawlRouteTemplateReplaySummary = summarizeRouteTemplateReplayCoverage(
      crawlRouteTemplateReplayCoverage,
      crawlRows.length > 0 && crawlRows.every((crawl) => crawl.routeTemplateReplaySummary?.allExhausted === true || crawl.exhausted === true),
    );
    const crawlApiOperationRiskSummary = summarizeApiOperationRisk(crawlApiOperationRisk);
    const dynamicSeedCoverage = buildDynamicSeedInstanceCoverage(rawSiteRows);
    const sessionAuthBoundary = buildSessionAuthBoundary(rawSiteRows);
    const coveredPlannedSurfaceCount = expectedSurfaces.length
      ? expectedSurfaces.filter((surface) => coveredSurfaces.has(surface)).length
      : null;
    const crawlClosure = buildReadCrawlClosure({
      expectedSurfaceCount: expectedSurfaces.length,
      coveredPlannedSurfaceCount,
      surfaceRows,
      crawlRows,
      routeTemplateReplaySummary: crawlRouteTemplateReplaySummary,
      routeTemplateReplayCoverage: crawlRouteTemplateReplayCoverage,
      apiOperationRiskSummary: crawlApiOperationRiskSummary,
    });
    const crawlFrontier = buildReadCrawlFrontier(surfaceRows, crawlRouteTemplateReplayCoverage);
    const dynamicSeedExpansion = buildDynamicSeedExpansion({
      surfaceRows,
      dynamicSeedCoverage,
      readCrawlFrontier: crawlFrontier,
    });
    const inventoryRouteCoverage = buildInventoryRouteCoverage({
      inventoryLinkRoutes,
      plannedRouteTemplates: [
        ...routeTemplates,
        ...(crawlFrontier.plannedRouteTemplates ?? []),
      ],
      routeTemplateReplayCoverage: crawlRouteTemplateReplayCoverage,
    });
    const discovery = buildDiscoverySummary({
      site,
      capabilities,
      intents,
      inventoryControlFunctions,
      probeRows,
      crawlRows,
      operations,
      targetOperations,
      apiOperationRisk: crawlApiOperationRisk,
      frontier: crawlFrontier,
      surfaceRows,
    });
    const fullSiteBoundary = buildFullSiteBoundary({
      expectedSurfaceCount: expectedSurfaces.length,
      coveredPlannedSurfaceCount,
      missingExpectedSurfaces,
      discovery,
      readCrawlClosure: crawlClosure,
      readCrawlFrontier: crawlFrontier,
      apiOperationRiskSummary: crawlApiOperationRiskSummary,
      dynamicSeedCoverage,
      dynamicSeedExpansion,
      sessionAuthBoundary,
      inventoryRouteCoverage,
    });
    coverage[site] = {
      plannedSurfaceCount: expectedSurfaces.length || null,
      coveredPlannedSurfaceCount,
      missingExpectedSurfaces,
      surfaceCount: surfaceRows.length,
      boundedOrPassed,
      degradedBlockedOrIncomplete: surfaceRows.length - boundedOrPassed,
      surfacesWithApiPages: surfaceRows.filter((row) => numberOrZero(row.apiPages) > 0).length,
      surfacesWithApiResponses: surfaceRows.filter((row) => numberOrZero(row.apiResponseCount) > 0).length,
      surfacesWithApiOperationOnly: apiOperationOnlyRows.length,
      apiOperationOnlyOperations,
      surfacesWithChildApiCoverage: apiCoveredByChildSurfaces.length,
      apiCoveredByChildSurfaces,
      surfacesWithTargetOperations: surfaceRows.filter((row) => row.targetOperations.length > 0).length,
      surfacesWithInventory: surfaceRows.filter((row) => row.surfaceInventory?.observed === true).length,
      surfacesWithoutInventory: surfaceRows
        .filter((row) => row.surfaceInventory?.observed !== true)
        .map((row) => row.surface),
      surfacesWithControlProbe: surfaceRows.filter((row) => row.controlProbe?.observed === true).length,
      surfacesWithReadCrawl: surfaceRows.filter((row) => row.readCrawl?.observed === true).length,
      totalApiPages: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.apiPages), 0),
      totalItems: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.itemCount), 0),
      totalUsers: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.userCount), 0),
      totalMedia: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.mediaCount), 0),
      routeTemplateCount: routeTemplates.length,
      routeTemplates,
      capabilityCount: capabilities.length,
      capabilities,
      intentCount: intents.length,
      intents,
      discovery,
      fullSiteBoundary,
      dynamicSeedCoverage,
      dynamicSeedExpansion,
      sessionAuthBoundary,
      inventory: {
        totalLinks: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.surfaceInventory?.linkCount), 0),
        totalControls: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.surfaceInventory?.controlCount), 0),
        totalForms: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.surfaceInventory?.formCount), 0),
        routeTemplateCount: inventoryRouteTemplates.length,
        routeTemplates: inventoryRouteTemplates,
        linkRoutes: inventoryLinkRoutes,
        controlKindCount: inventoryControlKeys.length,
        controlKeys: inventoryControlKeys,
        controls: inventoryControls,
        functionKindCount: inventoryFunctionKinds.length,
        functionKinds: inventoryFunctionKinds,
        executionClasses: inventoryExecutionClasses,
        mutationRisks: inventoryMutationRisks,
        mutationBlockedFunctionCount: inventoryControlFunctions.filter((entry) => entry.executionClass === 'mutation-blocked').length,
        unknownRiskBlockedFunctionCount: inventoryControlFunctions.filter((entry) => entry.executionClass === 'unknown-risk-blocked').length,
        unknownRiskBlockedControlCount,
        unknownRiskBlockedControls,
        routeCoverage: inventoryRouteCoverage,
        anonymousControlCount,
        anonymousControls: inventoryAnonymousControls,
        anonymousControlsBySurface,
        controlFunctions: inventoryControlFunctions,
      },
      controlProbe: {
        surfaceCount: probeRows.length,
        candidateCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.candidateCount), 0),
        selectedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.selectedCount), 0),
        executedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.executedCount), 0),
        skippedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.skippedCount), 0),
        failedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.failedCount), 0),
        mutationBlockedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.mutationBlockedCount), 0),
        functionKinds: probeFunctionKinds,
        executionClasses: probeExecutionClasses,
        apiResponseCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.controlProbe?.apiResponseCount), 0),
        apiOperations: probeApiOperations,
        apiReadLikeOperations: probeApiReadLikeOperations,
        apiSideEffectRiskOperations: probeApiSideEffectRiskOperations,
      },
      readCrawl: {
        surfaceCount: crawlRows.length,
        visitedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.readCrawl?.visitedCount), 0),
        queuedCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.readCrawl?.queuedCount), 0),
        pendingQueueCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.readCrawl?.pendingQueueCount), 0),
        discoveredRouteTemplateCount: crawlRouteTemplates.length,
        discoveredRouteTemplates: crawlRouteTemplates,
        functionKinds: crawlFunctionKinds,
        executionClasses: crawlExecutionClasses,
        blockedRouteCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.readCrawl?.blockedRouteCount), 0),
        blockedFunctions: mergeCountedEntries(
          surfaceRows,
          (row) => row.readCrawl?.blockedFunctions ?? [],
          (entry) => `${entry.executionClass}:${entry.functionKind}:${entry.intent}:${entry.mutationRisk}:${entry.routeTemplate}`,
          (entry) => ({
            routeTemplate: entry.routeTemplate,
            functionKind: entry.functionKind,
            intent: entry.intent,
            executionClass: entry.executionClass,
            mutationRisk: entry.mutationRisk,
          }),
        ),
        apiResponseCount: surfaceRows.reduce((sum, row) => sum + numberOrZero(row.readCrawl?.apiResponseCount), 0),
        apiOperations: crawlApiOperations,
        apiReadLikeOperations: crawlApiReadLikeOperations,
        apiSideEffectRiskOperations: crawlApiSideEffectRiskOperations,
        apiOperationRisk: crawlApiOperationRisk,
        apiOperationRiskSummary: crawlApiOperationRiskSummary,
        routeTemplateReplaySummary: crawlRouteTemplateReplaySummary,
        routeTemplateReplayCoverage: crawlRouteTemplateReplayCoverage,
        closure: crawlClosure,
        frontier: crawlFrontier,
      },
      uniqueOperationCount: operations.length,
      uniqueOperations: operations,
      targetOperations,
      surfaceRows,
    };
  }
  return coverage;
}

function sessionRepairPlanForRow(row = {}) {
  if (row.sessionGate?.status !== 'blocked' || !row.site) {
    return null;
  }
  return buildSessionRepairPlanCommand({
    site: row.site,
    reason: row.sessionGate.reason,
  });
}

function addSessionRepairPlans(rows = []) {
  return rows.map((row) => {
    const sessionRepairPlan = sessionRepairPlanForRow(row);
    return sessionRepairPlan ? { ...row, sessionRepairPlan } : row;
  });
}

export async function buildReport(options) {
  const files = await findManifestFiles(options.runsRoot);
  const rows = [];
  const manifestDirs = new Set(files.map((file) => normalizePathForMatch(path.dirname(file.path))));
  for (const file of files) {
    try {
      rows.push(...resultRowsFromManifest(await readJson(file.path), file.path, file.mtimeMs));
    } catch {
      // Skip malformed or unrelated manifests.
    }
  }
  const activeCommandLines = Array.isArray(options.activeProcessCommandLines)
    ? options.activeProcessCommandLines
    : await readActiveProcessCommandLines();
  for (const file of await findStateFiles(options.runsRoot)) {
    if (manifestDirs.has(normalizePathForMatch(path.dirname(file.path)))) {
      continue;
    }
    try {
      rows.push(resultRowFromState(await readJson(file.path), file.path, file.mtimeMs, activeCommandLines));
    } catch {
      // Skip malformed or unrelated state files.
    }
  }
  const siteFiltered = rows
    .filter((row) => row.site === 'x' || row.site === 'instagram')
    .filter((row) => options.site === 'all' || row.site === options.site);
  const limited = [];
  for (const site of ['x', 'instagram']) {
    if (options.site !== 'all' && options.site !== site) continue;
    limited.push(...siteFiltered.filter((row) => row.site === site).slice(0, Number(options.limit)));
  }
  const rowsWithRepairPlans = addSessionRepairPlans(limited);
  return {
    generatedAt: new Date().toISOString(),
    runsRoot: path.resolve(options.runsRoot),
    totalRows: rowsWithRepairPlans.length,
    summary: summarize(rowsWithRepairPlans),
    coverage: buildCoverage(siteFiltered),
    rows: rowsWithRepairPlans,
  };
}

function markdownReport(report) {
  const lines = ['# Social Live Matrix Report', '', `Generated: ${report.generatedAt}`, '', '## Summary', ''];
  for (const [site, summary] of Object.entries(report.summary)) {
    lines.push(`- ${site}: ${summary.total} row(s), latest ${summary.latestFinishedAt}, statuses ${JSON.stringify(summary.statuses)}, session gates ${JSON.stringify(summary.sessionGates)}`);
  }
  lines.push('', '## Coverage', '');
  for (const [site, coverage] of Object.entries(report.coverage ?? {})) {
    const planned = coverage.plannedSurfaceCount ?? 'n/a';
    const covered = coverage.coveredPlannedSurfaceCount ?? coverage.surfaceCount;
    lines.push(`- ${site}: planned ${covered}/${planned}, bounded/passed ${coverage.boundedOrPassed}, degraded/blocked/incomplete ${coverage.degradedBlockedOrIncomplete}, routes ${coverage.routeTemplateCount}, capabilities ${coverage.capabilityCount}, intents ${coverage.intentCount}, API archive surfaces ${coverage.surfacesWithApiPages}, API response surfaces ${coverage.surfacesWithApiResponses}, API operation-only surfaces ${coverage.surfacesWithApiOperationOnly}, target-operation surfaces ${coverage.surfacesWithTargetOperations}, inventory surfaces ${coverage.surfacesWithInventory}, items ${coverage.totalItems}, users ${coverage.totalUsers}, media ${coverage.totalMedia}`);
    if (coverage.missingExpectedSurfaces?.length) {
      lines.push(`  - missing: ${coverage.missingExpectedSurfaces.join(', ')}`);
    }
    if (coverage.surfacesWithoutInventory?.length) {
      lines.push(`  - missing inventory: ${coverage.surfacesWithoutInventory.join(', ')}`);
    }
    if (coverage.routeTemplates?.length) {
      lines.push(`  - routes: ${coverage.routeTemplates.join(', ')}`);
    }
    if (coverage.capabilities?.length) {
      lines.push(`  - capabilities: ${coverage.capabilities.join(', ')}`);
    }
    if (coverage.intents?.length) {
      lines.push(`  - intents: ${coverage.intents.join(', ')}`);
    }
    if (coverage.uniqueOperations?.length) {
      lines.push(`  - operations: ${coverage.uniqueOperations.join(', ')}`);
    }
    if (coverage.apiOperationOnlyOperations?.length) {
      lines.push(`  - operation-only APIs: ${coverage.apiOperationOnlyOperations.join(', ')}`);
    }
    if (coverage.apiCoveredByChildSurfaces?.length) {
      const childCoverage = coverage.apiCoveredByChildSurfaces
        .map((entry) => `${entry.surface} -> ${entry.childSurfaces.join(', ')}`)
        .join('; ');
      lines.push(`  - child API-covered surfaces: ${childCoverage}`);
    }
    if (coverage.discovery) {
      lines.push(`  - discovery: capabilities ${coverage.discovery.plannedCapabilityCount}, intents ${coverage.discovery.discoveredIntentCount}, functions ${coverage.discovery.discoveredFunctionKindCount}, read-executable functions ${coverage.discovery.readExecutableFunctionKinds.length}, blocked functions ${coverage.discovery.blockedFunctionKinds.length}, observed APIs ${coverage.discovery.observedApiOperationCount}, target APIs ${coverage.discovery.targetApiOperationCount}, read-like APIs ${coverage.discovery.apiReadReplayEligibleCount}, replay-blocked APIs ${coverage.discovery.apiReplayBlockedCount}`);
      if (coverage.discovery.observedApiOperationClassCounts?.length) {
        lines.push(`  - observed API classes: ${coverage.discovery.observedApiOperationClassCounts.map((entry) => `${entry.operationClass} ${entry.count}`).join(', ')}`);
      }
      if (coverage.discovery.unclassifiedObservedApiOperations?.length) {
        lines.push(`  - unclassified observed APIs: ${coverage.discovery.unclassifiedObservedApiOperations.join(', ')}`);
      }
      if (coverage.discovery.sideEffectRiskObservedApiOperations?.length) {
        lines.push(`  - side-effect-risk observed APIs: ${coverage.discovery.sideEffectRiskObservedApiOperations.join(', ')}`);
      }
      if (coverage.discovery.coverageExpansionCandidates?.length) {
        const candidates = coverage.discovery.coverageExpansionCandidates
          .map((entry) => `${entry.operation}->${entry.candidateCapability}`)
          .join(', ');
        lines.push(`  - coverage expansion candidates ${coverage.discovery.coverageExpansionCandidateCount}: ${candidates}`);
      }
      if (coverage.discovery.dynamicRouteFamilyCount) {
        lines.push(`  - dynamic route families: families ${coverage.discovery.dynamicRouteFamilyCount}, route templates ${coverage.discovery.dynamicRouteFamilyRouteTemplateCount}, parameterized families ${coverage.discovery.dynamicRouteParameterizedFamilyCount}, parameterized templates ${coverage.discovery.dynamicRouteParameterizedTemplateCount}, safe samples ${coverage.discovery.dynamicRouteSampleCount}, sampleless templates ${coverage.discovery.dynamicRouteSamplelessTemplateCount}`);
      }
    }
    if (coverage.dynamicSeedCoverage?.seedRunCount) {
      lines.push(`  - dynamic seed instances: runs ${coverage.dynamicSeedCoverage.seedRunCount}, families ${coverage.dynamicSeedCoverage.familyCount}, route templates ${coverage.dynamicSeedCoverage.routeTemplateCount}, surfaces ${coverage.dynamicSeedCoverage.surfaceCount}`);
      if (coverage.dynamicSeedCoverage.families?.length) {
        const seedFamilies = coverage.dynamicSeedCoverage.families
          .map((entry) => `${entry.familyKind} ${entry.seedRunCount}`)
          .join(', ');
        lines.push(`  - dynamic seed families: ${seedFamilies}`);
      }
    }
    if (coverage.dynamicSeedExpansion?.candidateCount) {
      lines.push(`  - dynamic seed expansion candidates: route templates ${coverage.dynamicSeedExpansion.routeTemplateCount}, families ${coverage.dynamicSeedExpansion.familyCount}, user approval required ${coverage.dynamicSeedExpansion.userApprovalRequired ? 'yes' : 'no'}`);
    }
    if (coverage.fullSiteBoundary) {
      const boundary = coverage.fullSiteBoundary;
      lines.push(`  - full-site boundary: full-site exhaustive claim ${boundary.fullSiteExhaustiveClaim ? 'yes' : 'no'}, controlled scope ready ${boundary.controlledScopeClosureReady ? 'yes' : 'no'}, planned surfaces ${boundary.coveredPlannedSurfaceCount}/${boundary.plannedSurfaceCount}, pending queues ${boundary.pendingReadQueueSurfaceCount}, unresolved candidates ${boundary.unresolvedCandidateOnlyRouteCount}, frontier gaps ${boundary.frontierGapCount}`);
      lines.push(`  - full-site evidence counts: capabilities ${boundary.discoveredCapabilityCount}/${boundary.plannedCapabilityCount}, intents ${boundary.discoveredIntentCount}/${boundary.plannedIntentCount}, functions read ${boundary.readExecutableFunctionKindCount}, blocked ${boundary.blockedFunctionKindCount}, APIs observed ${boundary.observedApiOperationCount}, target ${boundary.targetApiOperationCount}, read-like ${boundary.readReplayEligibleApiOperationCount}, replay-blocked ${boundary.replayBlockedApiOperationCount}, side-effect-risk ${boundary.sideEffectRiskApiOperationCount}`);
      if (boundary.dynamicRouteFamilyCount) {
        lines.push(`  - full-site dynamic boundary: families ${boundary.dynamicRouteFamilyCount}, route templates ${boundary.dynamicRouteFamilyRouteTemplateCount}, parameterized families ${boundary.dynamicRouteParameterizedFamilyCount}, parameterized templates ${boundary.dynamicRouteParameterizedTemplateCount}, samples ${boundary.dynamicRouteSampleCount}, sampleless templates ${boundary.dynamicRouteSamplelessTemplateCount}`);
      }
      if (boundary.dynamicSeedRunCount) {
        lines.push(`  - full-site dynamic seed evidence: runs ${boundary.dynamicSeedRunCount}, families ${boundary.dynamicSeedFamilyCount}, route templates ${boundary.dynamicSeedRouteTemplateCount}, surfaces ${boundary.dynamicSeedSurfaceCount}`);
      }
      if (boundary.dynamicSeedExpansionCandidateCount) {
        lines.push(`  - full-site dynamic seed expansion: candidates ${boundary.dynamicSeedExpansionCandidateCount}, families ${boundary.dynamicSeedExpansionFamilyCount}, route templates ${boundary.dynamicSeedExpansionRouteTemplateCount}, user approval required ${boundary.dynamicSeedExpansionRequiresUserApproval ? 'yes' : 'no'}`);
      }
      if (boundary.authBlockedRunCount || boundary.activeAuthBlocker) {
        const authReasons = (boundary.authBlockerReasons ?? [])
          .map((entry) => `${entry.value} ${entry.count}`)
          .join(', ');
        const authSurfaces = boundary.authBlockedSurfaces?.length
          ? `, surfaces ${boundary.authBlockedSurfaces.join(', ')}`
          : '';
        lines.push(`  - full-site auth boundary: active ${boundary.activeAuthBlocker ? 'yes' : 'no'}, blocked runs ${boundary.authBlockedRunCount}, blocked surfaces ${boundary.authBlockedSurfaceCount}${authSurfaces}${authReasons ? `, reasons ${authReasons}` : ''}`);
      }
      if (boundary.inventoryRouteCount) {
        lines.push(`  - full-site inventory routes: covered ${boundary.inventoryRouteCoveredCount}/${boundary.inventoryRouteCount}, uncovered ${boundary.inventoryRouteUncoveredCount}, blocked ${boundary.inventoryRouteBlockedCount}, candidate-only ${boundary.inventoryRouteCandidateOnlyCount}`);
        if (boundary.inventoryUncoveredRoutes?.length) {
          lines.push(`  - full-site uncovered inventory routes: ${boundary.inventoryUncoveredRoutes.join(', ')}`);
        }
      }
      lines.push(`  - full-site boundary reason: ${boundary.finiteExhaustiveReason}; next evidence ${boundary.nextEvidence}`);
    }
    if (coverage.inventory && (
      coverage.inventory.totalLinks > 0
      || coverage.inventory.totalControls > 0
      || coverage.inventory.totalForms > 0
    )) {
      lines.push(`  - live inventory: links ${coverage.inventory.totalLinks}, controls ${coverage.inventory.totalControls}, forms ${coverage.inventory.totalForms}, unknown-risk controls ${coverage.inventory.unknownRiskBlockedControlCount ?? 0}, anonymous controls ${coverage.inventory.anonymousControlCount ?? 0}`);
    }
    if (coverage.inventory?.routeTemplates?.length) {
      lines.push(`  - discovered routes: ${coverage.inventory.routeTemplates.join(', ')}`);
    }
    if (coverage.inventory?.controlKeys?.length) {
      lines.push(`  - discovered controls: ${coverage.inventory.controlKeys.join(', ')}`);
    }
    if (coverage.inventory?.functionKinds?.length) {
      lines.push(`  - discovered functions: ${coverage.inventory.functionKinds.join(', ')}`);
    }
    if (coverage.inventory?.executionClasses?.length) {
      lines.push(`  - execution classes: ${coverage.inventory.executionClasses.join(', ')}`);
    }
    if (coverage.inventory?.routeCoverage?.total) {
      const routeCoverage = coverage.inventory.routeCoverage;
      lines.push(`  - inventory route coverage: total ${routeCoverage.total}, covered ${routeCoverage.coveredCount}, blocked ${routeCoverage.blockedCount}, candidate-only ${routeCoverage.candidateOnlyCount}, uncovered ${routeCoverage.uncoveredCount}`);
      if (routeCoverage.uncoveredRoutes?.length) {
        lines.push(`  - uncovered inventory routes: ${routeCoverage.uncoveredRoutes.join(', ')}`);
      }
    }
    if (coverage.inventory?.anonymousControls?.length) {
      const anonymousSummary = coverage.inventory.anonymousControls
        .slice(0, 6)
        .map((entry) => `${entry.role || 'control'}${entry.inArticle ? '/article' : ''}${entry.inDialog ? '/dialog' : ''}: ${entry.count}`)
        .join(', ');
      lines.push(`  - anonymous interactive controls: ${anonymousSummary}`);
    }
    if (coverage.inventory?.anonymousControlsBySurface?.length) {
      const anonymousSurfaceSummary = coverage.inventory.anonymousControlsBySurface
        .slice(0, 6)
        .map((entry) => `${entry.surface}:${entry.role || 'control'}${entry.disabled ? '/disabled' : ''}${entry.inArticle ? '/article' : ''}${entry.svgCount ? `/svg${entry.svgCount}` : ''}${entry.imageCount ? `/img${entry.imageCount}` : ''}: ${entry.count}`)
        .join(', ');
      lines.push(`  - anonymous interactive controls by surface: ${anonymousSurfaceSummary}`);
    }
    if (coverage.inventory?.unknownRiskBlockedControls?.length) {
      const unknownSummary = coverage.inventory.unknownRiskBlockedControls
        .slice(0, 6)
        .map((entry) => `${entry.surface}:${entry.role || 'control'}${entry.iconSignature ? `/${entry.iconSignature}` : ''}: ${entry.count}`)
        .join(', ');
      lines.push(`  - unknown-risk interactive controls: ${unknownSummary}`);
    }
    if (coverage.controlProbe?.surfaceCount) {
      lines.push(`  - read probes: surfaces ${coverage.controlProbe.surfaceCount}, executed ${coverage.controlProbe.executedCount}/${coverage.controlProbe.selectedCount}, failed ${coverage.controlProbe.failedCount}, mutation-blocked ${coverage.controlProbe.mutationBlockedCount}`);
    }
    if (coverage.controlProbe?.apiOperations?.length) {
      lines.push(`  - read probe operations: ${coverage.controlProbe.apiOperations.join(', ')}`);
    }
    if (coverage.controlProbe?.apiSideEffectRiskOperations?.length) {
      lines.push(`  - read probe side-effect-risk operations: ${coverage.controlProbe.apiSideEffectRiskOperations.join(', ')}`);
    }
    if (coverage.readCrawl?.surfaceCount) {
      lines.push(`  - read crawl: surfaces ${coverage.readCrawl.surfaceCount}, visited ${coverage.readCrawl.visitedCount}, routes ${coverage.readCrawl.discoveredRouteTemplateCount}, blocked ${coverage.readCrawl.blockedRouteCount}`);
    }
    if (coverage.readCrawl?.discoveredRouteTemplates?.length) {
      lines.push(`  - read crawl routes: ${coverage.readCrawl.discoveredRouteTemplates.join(', ')}`);
    }
    if (coverage.readCrawl?.routeTemplateReplaySummary?.total) {
      const summary = coverage.readCrawl.routeTemplateReplaySummary;
      lines.push(`  - read crawl route replay audit: total ${summary.total}, visited ${summary.visitedRouteTemplateCount}, redirected ${summary.redirectedRouteTemplateCount}, candidate-only ${summary.candidateOnlyRouteTemplateCount}, blocked ${summary.blockedRouteTemplateCount}, exhausted ${summary.allExhausted ? 'yes' : 'no'}`);
    }
    if (coverage.readCrawl?.closure) {
      const closure = coverage.readCrawl.closure;
      lines.push(`  - read crawl closure: planned-surface scope ${closure.controlledScopeClosureReady ? 'ready' : 'not-ready'}, requested-template surfaces ${closure.surfacesWithRequestedRouteTemplateEvidence}/${closure.readCrawlSurfaceCount}, unresolved candidates ${closure.unresolvedCandidateOnlyRouteCount}, cross-surface covered candidates ${closure.crossSurfaceCoveredCandidateRouteCount}, full-site exhaustive claim ${closure.fullSiteExhaustiveClaim ? 'yes' : 'no'}`);
      if (closure.surfacesWithPendingReadQueue?.length) {
        lines.push(`  - read crawl pending surfaces: ${closure.surfacesWithPendingReadQueue.join(', ')}`);
      }
      if (closure.blockedRiskRoutes?.length) {
        const blockedSummary = closure.blockedRiskRoutes
          .slice(0, 6)
          .map((entry) => `${entry.routeTemplate}:${(entry.functionKinds ?? []).join('+') || 'classified-risk'}:${(entry.mutationRisks ?? []).join('+') || 'risk'}`)
          .join(', ');
        lines.push(`  - read crawl blocked-risk boundaries: classified ${closure.blockedRiskRoutesClassified ? 'yes' : 'no'}, ${blockedSummary}`);
      }
    }
    if (coverage.readCrawl?.frontier?.routeTemplateCount) {
      const frontier = coverage.readCrawl.frontier;
      lines.push(`  - read crawl frontier: outside planned routes ${frontier.routeTemplateCount}, safe visited ${frontier.safeVisitedRouteCount}, sampled ${frontier.routeSampledRouteCount}, sampleless ${frontier.routeSamplelessRouteCount}, blocked ${frontier.blockedRouteCount}, unresolved ${frontier.unresolvedRouteCount}`);
      if (frontier.routeSamplelessRoutes?.length) {
        lines.push(`  - read crawl sampleless frontier: ${frontier.routeSamplelessRoutes.join(', ')}`);
      }
      if (frontier.gaps?.length) {
        const gapSummary = frontier.gaps.reduce((counts, entry) => {
          counts[entry.gapKind] = (counts[entry.gapKind] ?? 0) + 1;
          return counts;
        }, {});
        lines.push(`  - read crawl frontier gaps: ${Object.entries(gapSummary).map(([kind, count]) => `${kind} ${count}`).join(', ')}`);
      }
      if (frontier.blockedRoutes?.length) {
        lines.push(`  - read crawl blocked frontier: ${frontier.blockedRoutes.join(', ')}`);
      }
      if (frontier.unresolvedRoutes?.length) {
        lines.push(`  - read crawl unresolved frontier: ${frontier.unresolvedRoutes.join(', ')}`);
      }
      if (frontier.decisionSummary?.decisionCount) {
        const summary = frontier.decisionSummary;
        const decisionKinds = summary.byDecisionKind
          ?.map((entry) => `${entry.decisionKind} ${entry.count}`)
          .join(', ');
        lines.push(`  - read crawl frontier decisions: classified ${summary.classifiedRouteTemplateCount}/${summary.routeTemplateCount}, promote candidates ${summary.plannedSurfaceUpgradeCandidateCount}, closure ready ${summary.readyForControlledScopeClosure ? 'yes' : 'no'}${decisionKinds ? ` (${decisionKinds})` : ''}`);
      }
      if (frontier.dynamicRouteFamilies?.families?.length) {
        lines.push(`  - read crawl dynamic route families: ${frontier.dynamicRouteFamilies.families.map((entry) => `${entry.familyKind}(${entry.routeTemplateCount})`).join(', ')}`);
      }
    }
    if (coverage.readCrawl?.apiOperations?.length) {
      lines.push(`  - read crawl operations: ${coverage.readCrawl.apiOperations.join(', ')}`);
    }
    if (coverage.readCrawl?.apiOperationRiskSummary?.total) {
      const summary = coverage.readCrawl.apiOperationRiskSummary;
      lines.push(`  - read crawl API replay risk: total ${summary.total}, read-like ${summary.readLikeCount}, replay-blocked ${summary.replayBlockedCount}, side-effect-risk ${summary.sideEffectRiskCount}`);
    }
    if (coverage.readCrawl?.apiSideEffectRiskOperations?.length) {
      lines.push(`  - read crawl side-effect-risk operations: ${coverage.readCrawl.apiSideEffectRiskOperations.join(', ')}`);
    }
  }
  lines.push('', '## Rows', '', '| Site | Surface | Route | Capability | Intent | Case | Status | Reason | API | Counts | Target Ops | Session Gate | Repair Plan | Finished | Manifest |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.rows) {
    const sessionGate = row.sessionGate
      ? `${row.sessionGate.status}${row.sessionGate.reason ? ` (${row.sessionGate.reason})` : ''}`
      : '';
    const counts = row.surface
      ? `items=${numberOrZero(row.itemCount)} users=${numberOrZero(row.userCount)} media=${numberOrZero(row.mediaCount)}`
      : '';
    lines.push(`| ${row.site} | ${row.surface ?? ''} | ${row.routeTemplate ?? ''} | ${row.capability ?? ''} | ${row.intent ?? ''} | ${row.id} | ${row.status} | ${row.reason ?? ''} | ${row.surface ? numberOrZero(row.apiPages) : ''} | ${counts} | ${Array.isArray(row.targetOperations) ? row.targetOperations.join(', ') : ''} | ${sessionGate} | ${row.sessionRepairPlan?.commandText ?? ''} | ${row.finishedAt ?? ''} | ${row.manifestPath} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(options, report) {
  if (!options.write) return null;
  await mkdir(path.resolve(options.outDir), { recursive: true });
  const jsonPath = path.join(path.resolve(options.outDir), 'social-live-report.json');
  const markdownPath = path.join(path.resolve(options.outDir), 'social-live-report.md');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, markdownReport(report), 'utf8');
  return { jsonPath, markdownPath };
}
