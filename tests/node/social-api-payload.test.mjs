import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecoveryRunbook,
  buildSocialActionPlan,
  parseSocialActionArgs,
  parseSocialApiPayload,
  parseSocialRelationApiPayload,
  runSocialAction,
  selectSocialApiSeed,
  socialArchiveItemKey,
} from '../../src/sites/known-sites/social/actions/router.mjs';
import { safePlanForArtifact } from '../../src/sites/known-sites/social/actions/artifacts.mjs';
import { normalizeSessionRunManifest } from '../../src/domain/sessions/contracts.mjs';

test('X API parser extracts legacy adaptive search tweets', () => {
  const parsed = parseSocialApiPayload('x', {
    globalObjects: {
      tweets: {
        '1001': {
          id_str: '1001',
          full_text: 'Legacy adaptive search result',
          created_at: 'Thu May 28 14:00:00 +0000 2026',
          user: {
            screen_name: 'siteforge',
          },
        },
      },
    },
  });

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, '1001');
  assert.equal(parsed.items[0].url, 'https://x.com/siteforge/status/1001');
  assert.equal(parsed.items[0].author.handle, 'siteforge');
  assert.equal(parsed.items[0].timestamp, '2026-05-28T14:00:00.000Z');
});

test('X relation API parser repairs UTF-8 mojibake in user labels', () => {
  const parsed = parseSocialRelationApiPayload('x', {
    users: [{
      id_str: '1889977189090967552',
      screen_name: 'fisunianeko',
      name: 'MiaMiku\u9983\u5bdb',
      description: 'profile\u9983\u5bdb',
      followers_count: 20,
      friends_count: 53,
    }],
    next_cursor_str: '0',
  });

  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0].displayName, 'MiaMiku\u{1F308}');
  assert.equal(parsed.users[0].label, 'MiaMiku\u{1F308}');
  assert.equal(parsed.users[0].bio, 'profile\u{1F308}');
});

test('X relation parser extracts legacy list users and cursor', () => {
  const parsed = parseSocialRelationApiPayload('x', {
    users: [
      {
        id_str: '42',
        screen_name: 'SiteForgeUser',
        name: 'SiteForge User',
        description: 'legacy relation fixture',
        followers_count: 7,
        friends_count: 3,
        verified: true,
      },
    ],
    next_cursor_str: '12345',
  });

  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0].handle, 'SiteForgeUser');
  assert.equal(parsed.users[0].id, '42');
  assert.equal(parsed.users[0].followers, 7);
  assert.equal(parsed.users[0].following, 3);
  assert.equal(parsed.users[0].verified, true);
  assert.equal(parsed.nextCursor, '12345');
});

test('X relation parser extracts GraphQL timeline users and cursor', () => {
  const parsed = parseSocialRelationApiPayload('x', {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [
                  {
                    entryId: 'user-42',
                    content: {
                      itemContent: {
                        user_results: {
                          result: {
                            rest_id: '42',
                            legacy: {
                              screen_name: 'GraphUser',
                              name: 'Graph User',
                              description: 'graphql relation fixture',
                              followers_count: 10,
                              friends_count: 4,
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'cursor-bottom-1',
                    content: {
                      cursorType: 'Bottom',
                      value: 'bottom-cursor',
                    },
                  },
                ],
              }],
            },
          },
        },
      },
    },
  });

  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0].handle, 'GraphUser');
  assert.equal(parsed.users[0].id, '42');
  assert.equal(parsed.users[0].followers, 10);
  assert.equal(parsed.users[0].following, 4);
  assert.equal(parsed.nextCursor, 'bottom-cursor');
});

test('X relation parser ignores users mentioned inside relation user metadata', () => {
  const parsed = parseSocialRelationApiPayload('x', {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [
                  {
                    entryId: 'user-42',
                    content: {
                      itemContent: {
                        itemType: 'TimelineUser',
                        user_results: {
                          result: {
                            rest_id: '42',
                            legacy: {
                              screen_name: 'ActualFollow',
                              name: 'Actual Follow',
                              description: 'works with @MentionedOnly',
                              entities: {
                                description: {
                                  user_mentions: [{
                                    screen_name: 'MentionedOnly',
                                    user_results: {
                                      result: {
                                        rest_id: '99',
                                        legacy: {
                                          screen_name: 'MentionedOnly',
                                          name: 'Mentioned Only',
                                        },
                                      },
                                    },
                                  }],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'cursor-bottom-1',
                    content: {
                      cursorType: 'Bottom',
                      value: 'bottom-cursor',
                    },
                  },
                ],
              }],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(parsed.users.map((user) => user.handle), ['ActualFollow']);
  assert.equal(parsed.nextCursor, 'bottom-cursor');
});

test('X relation parser preserves unavailable relation user placeholders', () => {
  const parsed = parseSocialRelationApiPayload('x', {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [
                  {
                    entryId: 'user-1720997030007300096',
                    content: {
                      itemContent: {
                        itemType: 'TimelineUser',
                        user_results: {
                          result: {
                            __typename: 'UserUnavailable',
                            message: 'User unavailable',
                            reason: 'Unavailable',
                          },
                        },
                      },
                    },
                  },
                  {
                    entryId: 'cursor-bottom-1',
                    content: {
                      cursorType: 'Bottom',
                      value: 'bottom-cursor',
                    },
                  },
                ],
              }],
            },
          },
        },
      },
    },
  });

  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0].handle, null);
  assert.equal(parsed.users[0].id, '1720997030007300096');
  assert.equal(parsed.users[0].url, 'https://x.com/i/user/1720997030007300096');
  assert.equal(parsed.users[0].unavailable, true);
  assert.equal(parsed.users[0].source, 'api-relation-unavailable');
  assert.equal(parsed.nextCursor, 'bottom-cursor');
});

test('X API parser normalizes NoteTweet ids and timestamps from media timelines', () => {
  const parsed = parseSocialApiPayload('x', {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [{
                entries: [{
                  entryId: 'tweet-2053939702047346689',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'NoteTweet',
                          id: 'Tm90ZVR3ZWV0OjIwNTM5Mzk3MDIwNDczNDY2ODk=',
                          text: 'Long-form media update',
                        },
                      },
                    },
                  },
                }],
              }],
            },
          },
        },
      },
    },
  });

  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].id, '2053939702047346689');
  assert.equal(parsed.items[0].url, 'https://x.com/i/status/2053939702047346689');
  assert.equal(parsed.items[0].timestamp, '2026-05-11T20:45:59.979Z');
});

test('X profile likes read-route selects the Likes API seed', () => {
  const plan = {
    siteKey: 'x',
    action: 'read-route',
    routeName: 'profile-likes',
    routePath: '/{account}/likes',
  };
  const home = {
    response: {
      url: 'https://x.com/i/api/graphql/home-id/HomeTimeline?variables=%7B%7D',
      status: 200,
    },
    parsed: {
      nextCursor: 'home-cursor',
      items: [{ id: 'home-1', text: 'home timeline item' }],
    },
  };
  const likes = {
    response: {
      url: 'https://x.com/i/api/graphql/likes-id/Likes?variables=%7B%7D',
      status: 200,
    },
    parsed: {
      nextCursor: 'likes-cursor',
      items: [{ id: 'liked-1', text: 'liked item' }],
    },
  };

  const seed = selectSocialApiSeed([home, likes], { siteKey: 'x' }, plan);

  assert.equal(seed, likes);
});

test('X profile likes read-route ignores HomeTimeline when Likes seed is absent', () => {
  const plan = {
    siteKey: 'x',
    action: 'read-route',
    routeName: 'profile-likes',
    routePath: '/{account}/likes',
  };
  const seed = selectSocialApiSeed([{
    response: {
      url: 'https://x.com/i/api/graphql/home-id/HomeTimeline?variables=%7B%7D',
      status: 200,
    },
    parsed: {
      nextCursor: 'home-cursor',
      items: [{ id: 'home-1', text: 'home timeline item' }],
    },
  }], { siteKey: 'x' }, plan);

  assert.equal(seed, null);
});

test('social archive item key dedupes API ids against DOM status URLs', () => {
  const apiItem = {
    id: '2058522886177226950',
    url: 'https://x.com/LinZhi999/status/2058522886177226950',
    source: 'api-cursor',
  };
  const domItem = {
    url: 'https://x.com/LinZhi999/status/2058522886177226950',
    text: 'same post from DOM without id',
  };

  assert.equal(socialArchiveItemKey(apiItem), socialArchiveItemKey(domItem));
});

test('X search action requires authenticated session verification', () => {
  const plan = buildSocialActionPlan({
    site: 'x',
    action: 'search',
    query: 'siteforge',
  });

  assert.equal(plan.requiresAccount, false);
  assert.equal(plan.canRunWithoutAccount, true);
  assert.equal(plan.requiresAuth, true);
  assert.equal(plan.url, 'https://x.com/search?q=siteforge&src=typed_query&f=live');
});

test('X social action parser requires explicit flag for risk-reviewed read surface crawl', () => {
  const parsed = parseSocialActionArgs([
    'read-route',
    'home',
    '--crawl-read-surfaces',
    '--risk-reviewed-read-surfaces',
  ], { site: 'x' });

  assert.equal(parsed.crawlReadSurfaces, true);
  assert.equal(parsed.riskReviewedReadSurfaces, true);
});

test('X read-route action accepts only supported read-only app routes', () => {
  const parsed = parseSocialActionArgs(['read-route', '/i/bookmarks'], { site: 'x' });
  const plan = buildSocialActionPlan(parsed);

  assert.equal(plan.action, 'read-route');
  assert.equal(plan.account, null);
  assert.equal(plan.routePath, '/i/bookmarks');
  assert.equal(plan.routeName, 'bookmarks');
  assert.equal(plan.url, 'https://x.com/i/bookmarks');
  assert.equal(plan.requiresAuth, true);
  assert.equal(plan.canRunWithoutAccount, true);
  assert.equal(plan.capability, 'app.bookmarks.inspect');
  assert.equal(plan.intent, 'inspect_bookmarks');
  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: '/compose/post' }),
    /requires --risk-reviewed-read-surfaces/u,
  );

  const composePost = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: '/compose/post',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(composePost.routePath, '/compose/post');
  assert.equal(composePost.routeName, 'compose-post');
  assert.equal(composePost.capability, 'risk-reviewed.compose-surface.inspect');

  const settingsAutoplay = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-autoplay',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAutoplay.routePath, '/settings/autoplay');
  assert.equal(settingsAutoplay.routeName, 'settings-autoplay');
  assert.equal(settingsAutoplay.intent, 'inspect_autoplay_settings_surface');

  const delegateMembers = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-delegate-members',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(delegateMembers.routePath, '/settings/delegate/members');
  assert.equal(delegateMembers.routeName, 'settings-delegate-members');
  assert.equal(delegateMembers.capability, 'risk-reviewed.settings-delegate-members.inspect');

  const settingsYourTweets = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-your-tweets',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsYourTweets.routePath, '/settings/your_tweets');
  assert.equal(settingsYourTweets.routeName, 'settings-your-tweets');
  assert.equal(settingsYourTweets.intent, 'inspect_your_tweets_settings_surface');

  const verifiedFollowers = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    account: 'openai',
    route: 'verified-followers',
  });
  assert.equal(verifiedFollowers.routePath, '/{account}/verified_followers');
  assert.equal(verifiedFollowers.routeName, 'verified-followers');
  assert.equal(verifiedFollowers.url, 'https://x.com/openai/verified_followers');
  assert.equal(verifiedFollowers.capability, 'relation.verified-followers.inspect');

  const statusAnalytics = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    account: 'openai',
    statusId: '2060428604727771421',
    route: 'status-analytics',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(statusAnalytics.routePath, '/{account}/status/{statusId}/analytics');
  assert.equal(statusAnalytics.routeName, 'status-analytics');
  assert.equal(statusAnalytics.url, 'https://x.com/openai/status/2060428604727771421/analytics');
  assert.equal(statusAnalytics.intent, 'inspect_status_analytics');
  assert.equal(
    safePlanForArtifact(statusAnalytics).url,
    'https://x.com/:account/status/:id/analytics',
  );

  assert.throws(
    () => buildSocialActionPlan({
      site: 'x',
      action: 'read-route',
      route: 'https://x.com/openai/status/2060428604727771421/analytics',
    }),
    /risk-reviewed-read-surfaces/,
  );

  const accountCommunitiesExplore = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    account: 'openai',
    route: 'account-communities-explore',
  });
  assert.equal(accountCommunitiesExplore.routePath, '/{account}/communities/explore');
  assert.equal(accountCommunitiesExplore.routeName, 'account-communities-explore');
  assert.equal(accountCommunitiesExplore.url, 'https://x.com/openai/communities/explore');
  assert.equal(accountCommunitiesExplore.capability, 'dynamic.account-communities-explore.inspect');

  const parsedAccountCommunities = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/openai/communities',
  });
  assert.equal(parsedAccountCommunities.routePath, '/{account}/communities');
  assert.equal(parsedAccountCommunities.account, 'openai');
  assert.equal(parsedAccountCommunities.routeName, 'account-communities');

  const audioSpace = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/spaces/1OyKALLDpNrxb',
  });
  assert.equal(audioSpace.routePath, '/i/spaces/{spaceId}');
  assert.equal(audioSpace.spaceId, '1OyKALLDpNrxb');
  assert.equal(audioSpace.routeName, 'audio-space');
  assert.equal(audioSpace.url, 'https://x.com/i/spaces/1OyKALLDpNrxb');
  assert.equal(audioSpace.capability, 'audio.space.inspect');
  assert.equal(safePlanForArtifact(audioSpace).spaceId, ':id');

  const communityDetail = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/communities/1493446837214187523',
  });
  assert.equal(communityDetail.routePath, '/i/communities/{communityId}');
  assert.equal(communityDetail.communityId, '1493446837214187523');
  assert.equal(communityDetail.routeName, 'community-detail');
  assert.equal(communityDetail.url, 'https://x.com/i/communities/1493446837214187523');
  assert.equal(communityDetail.capability, 'communities.detail.inspect');
  assert.equal(safePlanForArtifact(communityDetail).communityId, ':id');

  const communityAbout = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'community-about',
    communityId: '1493446837214187523',
  });
  assert.equal(communityAbout.routePath, '/i/communities/{communityId}/about');
  assert.equal(communityAbout.communityId, '1493446837214187523');
  assert.equal(communityAbout.routeName, 'community-about');
  assert.equal(communityAbout.url, 'https://x.com/i/communities/1493446837214187523/about');
  assert.equal(communityAbout.intent, 'inspect_community_about');

  const communityMembers = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/communities/1493446837214187523/members',
  });
  assert.equal(communityMembers.routePath, '/i/communities/{communityId}/members');
  assert.equal(communityMembers.communityId, '1493446837214187523');
  assert.equal(communityMembers.routeName, 'community-members');
  assert.equal(communityMembers.url, 'https://x.com/i/communities/1493446837214187523/members');
  assert.equal(communityMembers.capability, 'communities.members.inspect');

  const communityMembersSearch = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/communities/1493446837214187523/members/search',
  });
  assert.equal(communityMembersSearch.routePath, '/i/communities/{communityId}/members/search');
  assert.equal(communityMembersSearch.communityId, '1493446837214187523');
  assert.equal(communityMembersSearch.routeName, 'community-members-search');
  assert.equal(communityMembersSearch.url, 'https://x.com/i/communities/1493446837214187523/members/search');
  assert.equal(communityMembersSearch.capability, 'communities.members-search.inspect');

  const communitySearch = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'community-search',
    communityId: '1493446837214187523',
  });
  assert.equal(communitySearch.routePath, '/i/communities/{communityId}/search');
  assert.equal(communitySearch.communityId, '1493446837214187523');
  assert.equal(communitySearch.routeName, 'community-search');
  assert.equal(communitySearch.url, 'https://x.com/i/communities/1493446837214187523/search');
  assert.equal(communitySearch.intent, 'inspect_community_search');

  const listDetail = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'list-detail',
    listId: '84839422',
  });
  assert.equal(listDetail.routePath, '/i/lists/{listId}');
  assert.equal(listDetail.listId, '84839422');
  assert.equal(listDetail.routeName, 'list-detail');
  assert.equal(listDetail.url, 'https://x.com/i/lists/84839422');
  assert.equal(listDetail.intent, 'inspect_list_detail');
  assert.equal(safePlanForArtifact(listDetail).listId, ':id');

  const listMembers = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/lists/84839422/members',
  });
  assert.equal(listMembers.routePath, '/i/lists/{listId}/members');
  assert.equal(listMembers.listId, '84839422');
  assert.equal(listMembers.routeName, 'list-members');
  assert.equal(listMembers.url, 'https://x.com/i/lists/84839422/members');
  assert.equal(listMembers.capability, 'lists.members.inspect');

  const listFollowers = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'list-followers',
    listId: '84839422',
  });
  assert.equal(listFollowers.routePath, '/i/lists/{listId}/followers');
  assert.equal(listFollowers.listId, '84839422');
  assert.equal(listFollowers.routeName, 'list-followers');
  assert.equal(listFollowers.url, 'https://x.com/i/lists/84839422/followers');
  assert.equal(listFollowers.intent, 'inspect_list_followers');

  const accountArticles = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    account: 'openai',
    route: 'account-articles',
  });
  assert.equal(accountArticles.routePath, '/{account}/articles');
  assert.equal(accountArticles.routeName, 'account-articles');
  assert.equal(accountArticles.url, 'https://x.com/openai/articles');
  assert.equal(accountArticles.capability, 'dynamic.account-articles.inspect');

  const accountPhoto = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/openai/photo',
  });
  assert.equal(accountPhoto.routePath, '/{account}/photo');
  assert.equal(accountPhoto.account, 'openai');
  assert.equal(accountPhoto.routeName, 'account-photo');
  assert.equal(accountPhoto.capability, 'dynamic.account-photo.inspect');

  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'settings-explore' }),
    /requires --risk-reviewed-read-surfaces/u,
  );

  const settings = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settings.routePath, '/settings');
  assert.equal(settings.routeName, 'settings');
  assert.equal(settings.url, 'https://x.com/settings');
  assert.equal(settings.capability, 'risk-reviewed.settings.inspect');

  const settingsAccountLogin = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-account-login',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAccountLogin.routePath, '/settings/account/login');
  assert.equal(settingsAccountLogin.routeName, 'settings-account-login');
  assert.equal(settingsAccountLogin.capability, 'risk-reviewed.settings-account-login.inspect');

  const settingsSecurity = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-security',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsSecurity.routePath, '/settings/security');
  assert.equal(settingsSecurity.routeName, 'settings-security');
  assert.equal(settingsSecurity.capability, 'risk-reviewed.settings-security.inspect');

  const settingsSecurityAccountAccess = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-security-and-account-access',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsSecurityAccountAccess.routePath, '/settings/security_and_account_access');
  assert.equal(settingsSecurityAccountAccess.routeName, 'settings-security-and-account-access');
  assert.equal(settingsSecurityAccountAccess.capability, 'risk-reviewed.settings-security-account-access.inspect');

  const settingsAccountPasskey = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-account-passkey',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAccountPasskey.routePath, '/settings/account/passkey');
  assert.equal(settingsAccountPasskey.routeName, 'settings-account-passkey');
  assert.equal(settingsAccountPasskey.intent, 'inspect_account_passkey_settings_surface');

  const settingsMutedKeywords = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: '/settings/muted_keywords',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsMutedKeywords.routePath, '/settings/muted_keywords');
  assert.equal(settingsMutedKeywords.routeName, 'settings-muted-keywords');
  assert.equal(settingsMutedKeywords.capability, 'risk-reviewed.settings-muted-keywords.inspect');

  const settingsContactsDashboard = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-contacts-dashboard',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsContactsDashboard.routePath, '/settings/contacts_dashboard');
  assert.equal(settingsContactsDashboard.routeName, 'settings-contacts-dashboard');
  assert.equal(settingsContactsDashboard.intent, 'inspect_contacts_dashboard_settings_surface');

  const settingsPrivacy = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-privacy-and-safety',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsPrivacy.routePath, '/settings/privacy_and_safety');
  assert.equal(settingsPrivacy.routeName, 'settings-privacy-and-safety');
  assert.equal(settingsPrivacy.capability, 'risk-reviewed.settings-privacy.inspect');

  const settingsProfile = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-profile',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsProfile.routePath, '/settings/profile');
  assert.equal(settingsProfile.routeName, 'settings-profile');
  assert.equal(settingsProfile.capability, 'risk-reviewed.settings-profile.inspect');

  const settingsAccessibility = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-accessibility-display-languages',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAccessibility.routePath, '/settings/accessibility_display_and_languages');
  assert.equal(settingsAccessibility.routeName, 'settings-accessibility-display-languages');
  assert.equal(settingsAccessibility.capability, 'risk-reviewed.settings-accessibility-display-languages.inspect');

  const settingsAdditionalResources = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-additional-resources',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAdditionalResources.routePath, '/settings/additional_resources');
  assert.equal(settingsAdditionalResources.routeName, 'settings-additional-resources');
  assert.equal(settingsAdditionalResources.capability, 'risk-reviewed.settings-additional-resources.inspect');

  const settingsAbout = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-about',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsAbout.routePath, '/settings/about');
  assert.equal(settingsAbout.routeName, 'settings-about');
  assert.equal(settingsAbout.capability, 'risk-reviewed.settings-about.inspect');

  const settingsExplore = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-explore',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsExplore.routePath, '/settings/explore');
  assert.equal(settingsExplore.routeName, 'settings-explore');
  assert.equal(settingsExplore.url, 'https://x.com/settings/explore');
  assert.equal(settingsExplore.capability, 'risk-reviewed.settings-explore.inspect');

  const settingsExploreLocation = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-explore-location',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsExploreLocation.routePath, '/settings/explore/location');
  assert.equal(settingsExploreLocation.routeName, 'settings-explore-location');
  assert.equal(settingsExploreLocation.url, 'https://x.com/settings/explore/location');
  assert.equal(settingsExploreLocation.capability, 'risk-reviewed.settings-explore-location.inspect');

  const settingsManageSubscriptions = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-manage-subscriptions',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsManageSubscriptions.routePath, '/settings/manage_subscriptions');
  assert.equal(settingsManageSubscriptions.routeName, 'settings-manage-subscriptions');
  assert.equal(settingsManageSubscriptions.capability, 'risk-reviewed.settings-manage-subscriptions.inspect');

  const settingsMonetization = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-monetization',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsMonetization.routePath, '/settings/monetization');
  assert.equal(settingsMonetization.routeName, 'settings-monetization');
  assert.equal(settingsMonetization.capability, 'risk-reviewed.settings-monetization.inspect');

  const settingsNotificationsEmail = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-notifications-email',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsNotificationsEmail.routePath, '/settings/notifications/email_notifications');
  assert.equal(settingsNotificationsEmail.routeName, 'settings-notifications-email');
  assert.equal(settingsNotificationsEmail.capability, 'risk-reviewed.settings-email-notifications.inspect');

  const settingsNotificationsPush = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-notifications-push',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsNotificationsPush.routePath, '/settings/notifications/push_notifications');
  assert.equal(settingsNotificationsPush.routeName, 'settings-notifications-push');
  assert.equal(settingsNotificationsPush.capability, 'risk-reviewed.settings-push-notifications.inspect');

  const settingsSearch = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-search',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsSearch.routePath, '/settings/search');
  assert.equal(settingsSearch.routeName, 'settings-search');
  assert.equal(settingsSearch.capability, 'risk-reviewed.settings-search.inspect');

  const settingsData = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-your-twitter-data',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsData.routePath, '/settings/your_twitter_data');
  assert.equal(settingsData.routeName, 'settings-your-twitter-data');
  assert.equal(settingsData.capability, 'risk-reviewed.settings-data.inspect');

  const settingsDataAccount = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'settings-your-twitter-data-account',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(settingsDataAccount.routePath, '/settings/your_twitter_data/account');
  assert.equal(settingsDataAccount.routeName, 'settings-your-twitter-data-account');
  assert.equal(settingsDataAccount.capability, 'risk-reviewed.settings-data-account.inspect');

  const premiumSignUp = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'premium-sign-up',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(premiumSignUp.routePath, '/i/premium_sign_up');
  assert.equal(premiumSignUp.routeName, 'premium-sign-up');
  assert.equal(premiumSignUp.capability, 'commerce.premium-signup.inspect');

  const creatorStudio = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'creator-studio',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(creatorStudio.routePath, '/i/jf/creators/studio');
  assert.equal(creatorStudio.routeName, 'creator-studio');
  assert.equal(creatorStudio.capability, 'risk-reviewed.creator-studio.inspect');

  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'chat' }),
    /requires --risk-reviewed-read-surfaces/u,
  );
  const chat = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'chat',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(chat.routePath, '/i/chat');
  assert.equal(chat.routeName, 'chat');
  assert.equal(chat.capability, 'risk-reviewed.chat.inspect');

  const keyboardShortcuts = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'keyboard-shortcuts',
  });
  assert.equal(keyboardShortcuts.routePath, '/i/keyboard_shortcuts');
  assert.equal(keyboardShortcuts.routeName, 'keyboard-shortcuts');
  assert.equal(keyboardShortcuts.capability, 'app.keyboard-shortcuts.inspect');

  const jobs = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'jobs',
  });
  assert.equal(jobs.routePath, '/jobs');
  assert.equal(jobs.routeName, 'jobs');
  assert.equal(jobs.url, 'https://x.com/jobs');
  assert.equal(jobs.capability, 'app.jobs.inspect');

  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'messages' }),
    /requires --risk-reviewed-read-surfaces/u,
  );
  const messages = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'messages',
    riskReviewedReadSurfaces: true,
  });
  assert.equal(messages.routePath, '/messages');
  assert.equal(messages.routeName, 'messages');
  assert.equal(messages.url, 'https://x.com/messages');
  assert.equal(messages.capability, 'risk-reviewed.messages.inspect');

  const notificationVerified = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'notification-verified',
  });
  assert.equal(notificationVerified.routePath, '/notifications/verified');
  assert.equal(notificationVerified.routeName, 'notification-verified');
  assert.equal(notificationVerified.capability, 'app.notification-verified.inspect');

  const searchEmpty = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'search',
  });
  assert.equal(searchEmpty.routePath, '/search');
  assert.equal(searchEmpty.routeName, 'search-empty');
  assert.equal(searchEmpty.url, 'https://x.com/search');

  const searchTop = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'search-top',
    query: 'siteforge',
  });
  assert.equal(searchTop.routePath, '/search?q=:query&src=typed_query');
  assert.equal(searchTop.url, 'https://x.com/search?q=siteforge&src=typed_query');

  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'followers-you-follow' }),
    /requires --account/u,
  );
  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'search-top' }),
    /requires --query/u,
  );

  const statusDetail = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'status-detail',
    account: 'openai',
    statusId: '1234567890',
  });
  assert.equal(statusDetail.routePath, '/{account}/status/{statusId}');
  assert.equal(statusDetail.routeName, 'status-detail');
  assert.equal(statusDetail.url, 'https://x.com/openai/status/1234567890');
  assert.equal(statusDetail.capability, 'content.status.inspect');

  const internalStatus = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/i/status/1234567890',
  });
  assert.equal(internalStatus.routePath, '/i/status/{statusId}');
  assert.equal(internalStatus.statusId, '1234567890');
  assert.equal(internalStatus.routeName, 'internal-status');
  assert.equal(internalStatus.url, 'https://x.com/i/status/1234567890');
  assert.equal(internalStatus.capability, 'content.internal-status.inspect');

  const statusPhoto = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'https://x.com/openai/status/1234567890/photo/1',
  });
  assert.equal(statusPhoto.routePath, '/{account}/status/{statusId}/photo/{mediaId}');
  assert.equal(statusPhoto.account, 'openai');
  assert.equal(statusPhoto.statusId, '1234567890');
  assert.equal(statusPhoto.mediaId, '1');
  assert.equal(statusPhoto.routeName, 'status-photo');

  assert.throws(
    () => buildSocialActionPlan({ site: 'x', action: 'read-route', route: 'status-detail', account: 'openai' }),
    /requires --status-id/u,
  );
  assert.throws(
    () => buildSocialActionPlan({
      site: 'x',
      action: 'read-route',
      route: 'status-photo',
      account: 'openai',
      statusId: '1234567890',
    }),
    /requires --media-id/u,
  );
});

test('X read-route recovery command preserves explicit parameters and risk gate', () => {
  const plan = buildSocialActionPlan({
    site: 'x',
    action: 'read-route',
    route: 'status-analytics',
    account: 'openai',
    statusId: '1234567890',
    riskReviewedReadSurfaces: true,
  });
  const runbook = buildRecoveryRunbook({
    siteKey: 'x',
    plan,
    settings: {
      headless: false,
      maxItems: 3,
      timeoutMs: 120000,
      riskReviewedReadSurfaces: true,
    },
    outcome: {
      resumable: true,
    },
    result: {
      archive: {
        complete: false,
        reason: 'test-resume',
      },
    },
  }, {
    runDir: 'C:/tmp/siteforge-x-status-analytics',
    manifestPath: 'C:/tmp/siteforge-x-status-analytics/manifest.json',
  });
  const command = runbook.commands.find((entry) => entry.id === 'resume-archive')?.command ?? '';

  assert.match(command, /read-route/u);
  assert.match(command, /--route ["']?\/\{account\}\/status\/\{statusId\}\/analytics/u);
  assert.match(command, /--account ["']?openai/u);
  assert.match(command, /--status-id ["']?1234567890/u);
  assert.match(command, /--risk-reviewed-read-surfaces/u);
  assert.doesNotMatch(command, /read-route ["']?openai(?:["']?\s|$)/u);
});

test('X social action unified session health inspects reusable browser profile', async () => {
  /** @type {any} */
  let sessionRequest = null;
  /** @type {any} */
  let inspected = null;
  const result = await runSocialAction({
    site: 'x',
    action: 'account-info',
    account: 'openai',
    useUnifiedSessionHealth: true,
    dryRun: true,
  }, {
    runSessionTask: async (request, _options, runnerDeps) => {
      sessionRequest = request;
      const reusable = await runnerDeps.inspectReusableSiteSession(request.site, {
        host: request.host,
        profilePath: request.profilePath,
        browserProfileRoot: 'C:/profiles',
      });
      assert.equal(reusable.authAvailable, true);
      return {
        manifest: normalizeSessionRunManifest({
          plan: {
            siteKey: 'x',
            host: 'x.com',
            purpose: 'archive',
            sessionRequirement: 'required',
          },
          health: {
            status: 'ready',
            authStatus: 'authenticated',
            identityConfirmed: true,
          },
          artifacts: {
            manifest: 'runs/session/x/manifest.json',
            runDir: 'runs/session/x',
          },
        }),
      };
    },
    inspectReusableSiteSessionRuntime: async (inputUrl, settings, options) => {
      inspected = { inputUrl, settings, options };
      return {
        authAvailable: true,
        identityConfirmed: true,
        profileHealth: {
          exists: true,
          usableForCookies: true,
          profileLifecycle: 'healthy',
        },
        authConfig: {
          verificationUrl: 'https://x.com/home',
        },
        userDataDir: 'C:/profiles/x.com',
        reuseLoginState: true,
        sessionOptions: {
          authConfig: {
            verificationUrl: 'https://x.com/home',
          },
        },
      };
    },
    prepareSiteSessionGovernance: async () => ({
      policyDecision: { allowed: true },
    }),
  });

  assert.ok(sessionRequest);
  assert.ok(inspected);
  assert.equal(sessionRequest.sessionRequirement, 'required');
  assert.equal(inspected.inputUrl, 'https://x.com/home');
  assert.equal(inspected.settings.reuseLoginState, true);
  assert.match(inspected.options.profilePath, /profiles[\\/]+x\.com\.json/u);
  assert.equal(result.sessionProvider, 'unified-session-runner');
  assert.equal(result.sessionGate.status, 'passed');
  assert.equal(result.sessionHealth.healthStatus, 'ready');
});
