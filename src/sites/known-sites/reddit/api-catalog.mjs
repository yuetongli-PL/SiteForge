// @ts-check

import { createHash } from 'node:crypto';
import path from 'node:path';

import { ensureDir, readTextFile, writeTextFile } from '../../../infra/io.mjs';
import {
  assertNoForbiddenPatterns,
  prepareRedactedArtifactJsonWithAudit,
} from '../../../domain/sessions/security-guard.mjs';

export const REDDIT_DEV_API_URL = 'https://www.reddit.com/dev/api/';
export const REDDIT_OAUTH_API_BASE_URL = 'https://oauth.reddit.com';
export const REDDIT_TOKEN_ENV_VARS = Object.freeze([
  'SITEFORGE_REDDIT_BEARER_TOKEN',
  'REDDIT_BEARER_TOKEN',
]);
export const REDDIT_USER_AGENT_ENV_VARS = Object.freeze([
  'SITEFORGE_REDDIT_USER_AGENT',
  'REDDIT_USER_AGENT',
]);
export const REDDIT_OAUTH_READ_RUNTIME_MODE = 'reddit_oauth_read_runtime';
const REDDIT_SITE_ROOT_URL = 'https://www.reddit.com/';
const REDDIT_AWARDS_HELP_URL = 'https://support.reddithelp.com/hc/en-us/articles/26465598697876-What-are-awards-and-how-do-I-use-them';
const REDDIT_AUTHORIZED_SOURCE_OPERATION_CHUNK_SIZE = 40;
const REDDIT_CONTEXTUAL_BROWSER_ROUTE_BOUNDARIES = Object.freeze({
  '/awards': Object.freeze({
    disposition: 'migrated_contextual_awards_entry',
    reasonCode: 'reddit-awards-contextual-post-comment-flow',
    referenceUrl: REDDIT_AWARDS_HELP_URL,
    remediation: 'Use the current post/comment award icon flow; retain /framedGild and disabled gold API controls as the modeled award surface.',
  }),
});

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&#32;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&#x2F;/giu, '/')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/gu, ' '));
}

function cleanEndpointPath(rawHeading) {
  const value = String(rawHeading ?? '')
    .replace(/<span class="method">[\s\S]*?<\/span>/iu, '')
    .replace(/<span class="oauth-scope-list">[\s\S]*?<\/span>/giu, '')
    .replace(/<a[^>]*>\s*<span class="api-badge rss-support">[\s\S]*?<\/span>\s*<\/a>/giu, '')
    .replace(/<em class="placeholder">([\s\S]*?)<\/em>/giu, ':$1')
    .replace(/\[\/r\/:subreddit\]/giu, '[/r/:subreddit]');
  return stripTags(value)
    .replace(/\s+\/\s+/gu, '/')
    .replace(/\s+/gu, '')
    .replace(/\[:/gu, '[')
    .replace(/\]/gu, ']')
    .trim();
}

function extractSection(htmlBefore) {
  const matches = [...String(htmlBefore ?? '').matchAll(/<h2 id="section_[^"]+">([\s\S]*?)<\/h2>/giu)];
  return matches.length ? stripTags(matches[matches.length - 1][1]).toLowerCase() : 'unknown';
}

function stableOperationId(method, pathTemplate) {
  return `reddit-api-${String(method).toLowerCase()}-${createHash('sha1').update(`${method} ${pathTemplate}`).digest('hex').slice(0, 10)}`;
}

function slugify(value, fallback = 'item') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return slug || fallback;
}

function replacePathParameters(value) {
  return String(value ?? '').replace(/:([A-Za-z_][A-Za-z0-9_]*)/gu, '{$1}');
}

function oauthEndpointTemplates(pathTemplate) {
  const template = String(pathTemplate ?? '').trim();
  if (template.startsWith('[/r/:subreddit]')) {
    const rest = template.slice('[/r/:subreddit]'.length) || '/';
    return [
      `${REDDIT_OAUTH_API_BASE_URL}${replacePathParameters(rest)}`,
      `${REDDIT_OAUTH_API_BASE_URL}/r/{subreddit}${replacePathParameters(rest)}`,
    ];
  }
  const normalized = template.replace(/\[:/gu, '{').replace(/\]/gu, '}');
  return [`${REDDIT_OAUTH_API_BASE_URL}${replacePathParameters(normalized.startsWith('/') ? normalized : `/${normalized}`)}`];
}

function riskFor(method, pathTemplate, scopes) {
  const methodUpper = String(method ?? '').toUpperCase();
  const text = `${pathTemplate} ${(scopes ?? []).join(' ')}`.toLowerCase();
  if (methodUpper === 'GET' || methodUpper === 'HEAD') {
    if (/message|inbox|sent|unread|prefs|friends|blocked|saved|upvoted|downvoted|hidden|mine|me\b|modmail|moderator|about\/(?:log|spam|reports|modqueue|unmoderated|banned|muted)/u.test(text)) {
      return 'read_authenticated_or_moderator_limited';
    }
    return 'read_template_oauth_or_public';
  }
  if (/delete|remove|ban|unban|mute|unmute|block|friend|unfriend|approve|distinguish|lock|unlock|submit|compose|comment|vote|save|unsave|subscribe|follow|upload|edit|hide|report|sticky|wiki\/edit/u.test(text)) {
    return 'state_changing_or_moderation_write_disabled';
  }
  return 'state_changing_disabled';
}

function executionStatus(method) {
  return String(method ?? '').toUpperCase() === 'GET'
    ? 'template_ready_needs_oauth_token_and_user_agent'
    : 'template_recorded_write_disabled_by_default';
}

function parseParameters(block, pathTemplate) {
  const params = [];
  const optionalSubreddit = String(pathTemplate ?? '').startsWith('[/r/:subreddit]');
  for (const match of String(pathTemplate ?? '').matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const name = match[1];
    params.push({
      name,
      location: 'path',
      required: !(optionalSubreddit && name === 'subreddit'),
    });
  }
  const tableMatch = String(block ?? '').match(/<table class="parameters">([\s\S]*?)<\/table>/iu);
  if (!tableMatch) {
    return params;
  }
  const rowRe = /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/giu;
  let row;
  while ((row = rowRe.exec(tableMatch[1]))) {
    const name = stripTags(row[1]);
    if (!name || params.some((param) => param.name === name)) {
      continue;
    }
    params.push({
      name,
      location: 'query_or_body',
      required: false,
    });
  }
  return params.slice(0, 80);
}

function parseUriVariants(block) {
  const match = String(block ?? '').match(/<ul class="uri-variants">([\s\S]*?)<\/ul>/iu);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/<li[^>]*>[\s\S]*?&rarr;\s*([\s\S]*?)<\/li>/giu)]
    .map((item) => stripTags(item[1]).replace(/\s+/gu, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function scopeCounts(operations) {
  const counts = {};
  for (const operation of operations) {
    for (const scope of operation.oauthScopes) {
      counts[scope] = (counts[scope] ?? 0) + 1;
    }
  }
  return counts;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRedditRoutePath(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  if (/^https?:\/\//iu.test(text)) {
    try {
      const parsed = new URL(text);
      return normalizeRedditRoutePath(parsed.pathname || '/');
    } catch {
      return null;
    }
  }
  const pathOnly = text.split(/[?#]/u)[0].trim();
  if (!pathOnly.startsWith('/') || pathOnly.startsWith('//')) {
    return null;
  }
  const normalized = pathOnly === '/' ? '/' : pathOnly.replace(/\/+$/u, '');
  return normalized || '/';
}

function redditBrowserRouteBoundaryDisposition(route) {
  const routePath = normalizeRedditRoutePath(route);
  const disposition = routePath ? REDDIT_CONTEXTUAL_BROWSER_ROUTE_BOUNDARIES[routePath] : null;
  return disposition ? {
    targetRoute: routePath,
    ...disposition,
    liveRequired: false,
  } : null;
}

function redditBrowserBoundaryDispositionsFromCumulativeReport(report = /** @type {any} */ ({})) {
  const supplied = [
    ...asArray(report.liveBoundaryRoutes),
    ...asArray(report.boundaryDispositionRoutes),
  ];
  const inferred = asArray(report.missingRoutes)
    .map((route) => {
      const disposition = redditBrowserRouteBoundaryDisposition(
        route?.targetRoute ?? route?.route ?? route?.routeTemplate,
      );
      if (!disposition || (Number(route?.attempts ?? 0) || 0) <= 0) {
        return null;
      }
      return {
        ...disposition,
        attempts: Number(route.attempts ?? 0) || 0,
        lastStatus: route.lastStatus ?? null,
        lastReasonCode: route.lastReasonCode ?? null,
        statuses: route.statuses ?? {},
        reasonCodes: route.reasonCodes ?? {},
        lastSource: route.lastSource ?? null,
      };
    })
    .filter(Boolean);
  return Array.from(new Map([...supplied, ...inferred]
    .map((route) => {
      const targetRoute = normalizeRedditRoutePath(route?.targetRoute ?? route?.route);
      if (!targetRoute) {
        return null;
      }
      const known = redditBrowserRouteBoundaryDisposition(targetRoute);
      return /** @type {[string, any]} */ ([targetRoute, {
        ...(known ?? {}),
        ...route,
        targetRoute,
        liveRequired: false,
      }]);
    })
    .filter((entry) => entry !== null)).values());
}

function redditSurfaceForm(name, label, {
  method = 'GET',
  action = null,
  inputs = [],
  semanticKind = 'search',
  safety = 'read_only',
} = /** @type {any} */ ({})) {
  return {
    name,
    label,
    method,
    action,
    semanticKind,
    safety,
    inputs: inputs.map((input) => ({ name: input, valuePersisted: false })),
    bodyPersisted: false,
    savedMaterial: 'sanitized_summary_only',
  };
}

function redditSurfaceControl(name, label, {
  kind = 'button',
  routeTemplate = null,
  semanticKind = 'navigation',
  safety = 'read_only',
  disabled = false,
} = /** @type {any} */ ({})) {
  return {
    kind,
    name,
    label,
    routeTemplate,
    semanticKind,
    safety,
    disabled,
    valuePersisted: false,
    savedMaterial: 'sanitized_summary_only',
  };
}

function redditSurfaceInteractions(page) {
  const forms = [];
  const controls = [];
  const addSortControls = (prefix = '') => {
    for (const sort of ['hot', 'new', 'top', 'rising']) {
      controls.push(redditSurfaceControl(`${sort}_sort`, `${sort} sort`, {
        routeTemplate: `${prefix}/${sort}`.replace(/^\/\//u, '/'),
        semanticKind: 'ranking',
      }));
    }
  };
  switch (page.id) {
    case 'reddit-home-feed':
      addSortControls('');
      controls.push(redditSurfaceControl('open_community', 'open community', { routeTemplate: '/r/:subreddit', semanticKind: 'navigation' }));
      break;
    case 'reddit-search-results':
      forms.push(redditSurfaceForm('reddit_search', 'search Reddit', { action: '/search', inputs: ['q', 'type', 'sort', 't'] }));
      for (const type of ['link', 'sr', 'user']) {
        controls.push(redditSurfaceControl(`search_${type}_tab`, `search ${type} tab`, { routeTemplate: `/search/?type=${type}`, semanticKind: 'search_filter' }));
      }
      break;
    case 'reddit-community-feed':
      forms.push(redditSurfaceForm('community_search', 'search community', { action: '/r/:subreddit/search', inputs: ['q', 'restrict_sr', 'sort', 't'] }));
      addSortControls('/r/:subreddit');
      controls.push(redditSurfaceControl('join_community_disabled', 'join community', { routeTemplate: '/api/subscribe', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-post-detail':
    case 'reddit-shortlink-post-detail':
      forms.push(redditSurfaceForm('comment_reply_disabled', 'reply to comment', { method: 'POST', action: '/api/comment', inputs: ['thing_id', 'text'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      for (const [name, routeTemplate] of [
        ['upvote_disabled', '/api/vote'],
        ['downvote_disabled', '/api/vote'],
        ['save_disabled', '/api/save'],
        ['hide_disabled', '/api/hide'],
        ['report_disabled', '/api/report'],
        ['award_disabled', '/api/v1/gold/gild/:thing'],
        ['share_link', '/r/:subreddit/comments/:article'],
      ]) {
        controls.push(redditSurfaceControl(name, name.replace(/_/gu, ' '), {
          routeTemplate,
          semanticKind: name === 'share_link' ? 'share' : 'write_disabled',
          safety: name === 'share_link' ? 'read_only' : 'state_changing_disabled',
          disabled: name !== 'share_link',
        }));
      }
      break;
    case 'reddit-community-directory':
      forms.push(redditSurfaceForm('community_directory_search', 'search communities', { action: '/subreddits/search', inputs: ['q'] }));
      controls.push(redditSurfaceControl('subscribe_disabled', 'subscribe', { routeTemplate: '/api/subscribe', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-user-profile':
      controls.push(redditSurfaceControl('follow_user_disabled', 'follow user', { routeTemplate: '/api/friend', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      controls.push(redditSurfaceControl('block_user_disabled', 'block user', { routeTemplate: '/api/block_user', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-account-library':
      for (const name of ['unsave_disabled', 'unhide_disabled', 'clear_vote_disabled']) {
        controls.push(redditSurfaceControl(name, name.replace(/_/gu, ' '), { routeTemplate: '/api/save', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      }
      break;
    case 'reddit-inbox':
      forms.push(redditSurfaceForm('message_compose_disabled', 'compose message', { method: 'POST', action: '/api/compose', inputs: ['to', 'subject', 'text'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      controls.push(redditSurfaceControl('mark_read_disabled', 'mark read', { routeTemplate: '/api/read_message', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-chat-and-modmail':
      forms.push(redditSurfaceForm('chat_reply_disabled', 'chat reply', { method: 'POST', action: '/chat', inputs: ['channel', 'text'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      controls.push(redditSurfaceControl('archive_modmail_disabled', 'archive modmail', { routeTemplate: '/mod/:subreddit/mail', semanticKind: 'moderation_write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-settings':
      forms.push(redditSurfaceForm('settings_update_disabled', 'update settings', { method: 'POST', action: '/settings', inputs: ['setting_name', 'enabled'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      for (const name of ['privacy_toggle_disabled', 'email_toggle_disabled', 'profile_visibility_toggle_disabled']) {
        controls.push(redditSurfaceControl(name, name.replace(/_/gu, ' '), { routeTemplate: '/settings', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      }
      break;
    case 'reddit-submit-entry':
      forms.push(redditSurfaceForm('submit_post_disabled', 'submit post', { method: 'POST', action: '/api/submit', inputs: ['sr', 'title', 'kind', 'url', 'text'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      controls.push(redditSurfaceControl('choose_post_type_disabled', 'choose post type', { routeTemplate: '/submit', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-moderation-surfaces':
      forms.push(redditSurfaceForm('moderation_filter', 'filter moderation queue', { action: '/r/:subreddit/about/modqueue', inputs: ['state', 'sort'] }));
      for (const [name, routeTemplate] of [
        ['approve_disabled', '/api/approve'],
        ['remove_disabled', '/api/remove'],
        ['spam_disabled', '/api/remove'],
        ['ban_user_disabled', '/api/friend'],
        ['flair_disabled', '/api/flair'],
      ]) {
        controls.push(redditSurfaceControl(name, name.replace(/_/gu, ' '), { routeTemplate, semanticKind: 'moderation_write_disabled', safety: 'state_changing_disabled', disabled: true }));
      }
      break;
    case 'reddit-wiki-page':
      forms.push(redditSurfaceForm('wiki_edit_disabled', 'edit wiki page', { method: 'POST', action: '/api/wiki/edit', inputs: ['page', 'content', 'reason'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      controls.push(redditSurfaceControl('wiki_history', 'wiki history', { routeTemplate: '/r/:subreddit/wiki/revisions/:page', semanticKind: 'history' }));
      controls.push(redditSurfaceControl('wiki_settings_disabled', 'wiki settings', { routeTemplate: '/r/:subreddit/wiki/settings/:page', semanticKind: 'moderation_write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-live-thread':
      forms.push(redditSurfaceForm('live_update_disabled', 'post live update', { method: 'POST', action: '/api/live/:thread/update', inputs: ['body'], semanticKind: 'write_disabled', safety: 'state_changing_disabled' }));
      controls.push(redditSurfaceControl('live_embed', 'live embed', { routeTemplate: '/live/:thread/embed', semanticKind: 'embed' }));
      break;
    case 'reddit-poll-and-prediction-surfaces':
      controls.push(redditSurfaceControl('poll_vote_disabled', 'poll vote', { routeTemplate: '/poll/:id', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      controls.push(redditSurfaceControl('prediction_vote_disabled', 'prediction vote', { routeTemplate: '/r/:subreddit/predictions/:predictionId', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-awards-gilding-summary':
      controls.push(redditSurfaceControl('gild_disabled', 'gild content', { routeTemplate: '/api/v1/gold/gild/:thing', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      controls.push(redditSurfaceControl('give_award_disabled', 'give award', { routeTemplate: '/api/v1/gold/give/:username', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-auth-entry':
      forms.push(redditSurfaceForm('login_disabled', 'login', { method: 'POST', action: '/login', inputs: ['username', 'password'], semanticKind: 'auth_entry_disabled', safety: 'auth_required' }));
      controls.push(redditSurfaceControl('open_register', 'open register', { routeTemplate: '/register', semanticKind: 'auth_navigation' }));
      controls.push(redditSurfaceControl('open_password_reset', 'open password reset', { routeTemplate: '/password', semanticKind: 'auth_navigation' }));
      break;
    case 'reddit-custom-feed-multireddit':
      forms.push(redditSurfaceForm('custom_feed_search', 'search custom feeds', { action: '/user/:username/m/:multipath', inputs: ['q'] }));
      controls.push(redditSurfaceControl('follow_custom_feed_disabled', 'follow custom feed', { routeTemplate: '/api/multi/subscribe', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      controls.push(redditSurfaceControl('edit_custom_feed_disabled', 'edit custom feed', { routeTemplate: '/api/multi/:multipath', semanticKind: 'write_disabled', safety: 'state_changing_disabled', disabled: true }));
      break;
    case 'reddit-domain-and-duplicates':
      forms.push(redditSurfaceForm('domain_search', 'search domain', { action: '/domain/:domain/search', inputs: ['q', 'sort', 't'] }));
      controls.push(redditSurfaceControl('open_duplicate_discussion', 'open duplicate discussion', { routeTemplate: '/duplicates/:article', semanticKind: 'content' }));
      break;
    case 'reddit-moderation-settings':
      forms.push(redditSurfaceForm('post_requirements_disabled', 'post requirements', { method: 'POST', action: '/api/site_admin', inputs: ['subreddit', 'requirements'], semanticKind: 'moderation_write_disabled', safety: 'state_changing_disabled' }));
      for (const [name, routeTemplate] of [
        ['edit_flair_disabled', '/r/:subreddit/about/flair'],
        ['edit_emoji_disabled', '/r/:subreddit/about/emojis'],
        ['edit_removal_reason_disabled', '/r/:subreddit/about/removal'],
        ['edit_community_appearance_disabled', '/r/:subreddit/about/communityappearance'],
      ]) {
        controls.push(redditSurfaceControl(name, name.replace(/_/gu, ' '), { routeTemplate, semanticKind: 'moderation_write_disabled', safety: 'state_changing_disabled', disabled: true }));
      }
      break;
    default:
      break;
  }
  return {
    ...page,
    forms: [...asArray(page.forms), ...forms],
    controls: [...asArray(page.controls), ...controls],
  };
}

function redditSurfaceStructurePages() {
  return [
    {
      id: 'reddit-home-feed',
      url: '/',
      title: 'Reddit home feed',
      pageType: 'home_feed',
      routeTemplate: '/',
      visibleItemCount: 25,
      listPresent: true,
      routeTemplates: ['/', '/best', '/hot', '/new', '/rising', '/top', '/r/all', '/r/popular', '/r/random', '/r/mod', '/domain/:domain', '/r/:subreddit', '/search'],
      links: [
        { href: '/', label: 'Home feed', semanticKind: 'feed', routeTemplate: '/' },
        { href: '/best', label: 'Best posts', semanticKind: 'ranking', routeTemplate: '/best' },
        { href: '/hot', label: 'Hot posts', semanticKind: 'ranking', routeTemplate: '/hot' },
        { href: '/new', label: 'New posts', semanticKind: 'feed', routeTemplate: '/new' },
        { href: '/rising', label: 'Rising posts', semanticKind: 'ranking', routeTemplate: '/rising' },
        { href: '/top', label: 'Top posts', semanticKind: 'ranking', routeTemplate: '/top' },
        { href: '/r/all', label: 'All communities feed', semanticKind: 'feed', routeTemplate: '/r/all' },
        { href: '/r/popular', label: 'Popular communities feed', semanticKind: 'feed', routeTemplate: '/r/popular' },
        { href: '/r/random', label: 'Random community entry', semanticKind: 'navigation', routeTemplate: '/r/random' },
        { href: '/r/mod', label: 'Moderator communities feed', semanticKind: 'moderation_read', routeTemplate: '/r/mod' },
        { href: '/domain/example.com', label: 'Domain listing', semanticKind: 'domain_listing', routeTemplate: '/domain/:domain' },
        { href: '/search/?q=siteforge', label: 'Search Reddit', semanticKind: 'search', routeTemplate: '/search' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'post_feed',
          labelSummary: 'home feed post list',
          visibleItemCount: 25,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article'],
        },
        {
          nodeType: 'component',
          structureType: 'global_navigation',
          labelSummary: 'home ranking and search navigation',
          visibleItemCount: 12,
          listPresent: true,
          routeTemplates: ['/', '/best', '/hot', '/new', '/rising', '/top', '/r/all', '/r/popular', '/r/random', '/r/mod', '/domain/:domain', '/search'],
        },
      ],
    },
    {
      id: 'reddit-search-results',
      url: '/search/?q=siteforge',
      title: 'Reddit search results',
      pageType: 'search_results',
      routeTemplate: '/search',
      visibleItemCount: 20,
      listPresent: true,
      routeTemplates: ['/search', '/search/?type=link', '/search/?type=sr', '/search/?type=user', '/r/:subreddit', '/r/:subreddit/comments/:article', '/user/:username'],
      links: [
        { href: '/search/?q=siteforge', label: 'Search results', semanticKind: 'search', routeTemplate: '/search' },
        { href: '/search/?q=siteforge&type=link', label: 'Search posts', semanticKind: 'search', routeTemplate: '/search/?type=link' },
        { href: '/search/?q=siteforge&type=sr', label: 'Search communities', semanticKind: 'search', routeTemplate: '/search/?type=sr' },
        { href: '/search/?q=siteforge&type=user', label: 'Search redditors', semanticKind: 'search', routeTemplate: '/search/?type=user' },
        { href: '/r/siteforge', label: 'Community result', semanticKind: 'category', routeTemplate: '/r/:subreddit' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'search_result_list',
          labelSummary: 'post community and profile results',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article', '/r/:subreddit', '/user/:username', '/search/?type=link', '/search/?type=sr', '/search/?type=user'],
        },
      ],
    },
    {
      id: 'reddit-community-feed',
      url: '/r/siteforge',
      title: 'Reddit community feed',
      pageType: 'community_feed',
      routeTemplate: '/r/:subreddit',
      visibleItemCount: 25,
      listPresent: true,
      routeTemplates: ['/r/:subreddit', '/r/:subreddit/comments/:article', '/r/:subreddit/search', '/r/:subreddit/wiki/:page', '/r/:subreddit/rising', '/r/:subreddit/controversial', '/r/:subreddit/gilded', '/r/:subreddit/duplicates/:article', '/r/:subreddit/about/flair', '/r/:subreddit/about/postrequirements', '/r/:subreddit/about/communityappearance', '/r/:subreddit/collection/:collectionId'],
      links: [
        { href: '/r/siteforge/hot', label: 'Community hot posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/hot' },
        { href: '/r/siteforge/new', label: 'Community new posts', semanticKind: 'feed', routeTemplate: '/r/:subreddit/new' },
        { href: '/r/siteforge/top', label: 'Community top posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/top' },
        { href: '/r/siteforge/rising', label: 'Community rising posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/rising' },
        { href: '/r/siteforge/controversial', label: 'Community controversial posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/controversial' },
        { href: '/r/siteforge/gilded', label: 'Community gilded posts', semanticKind: 'feed', routeTemplate: '/r/:subreddit/gilded' },
        { href: '/r/siteforge/duplicates/example', label: 'Community duplicate discussions', semanticKind: 'content', routeTemplate: '/r/:subreddit/duplicates/:article' },
        { href: '/r/siteforge/about/postrequirements', label: 'Community post requirements', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/postrequirements' },
        { href: '/r/siteforge/search?q=siteforge', label: 'Search community', semanticKind: 'search', routeTemplate: '/r/:subreddit/search' },
        { href: '/r/siteforge/collection/example', label: 'Community collection', semanticKind: 'collection', routeTemplate: '/r/:subreddit/collection/:collectionId' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'community_post_list',
          labelSummary: 'community feed post list',
          visibleItemCount: 25,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article'],
        },
        {
          nodeType: 'component',
          structureType: 'community_navigation',
          labelSummary: 'community sort and search tabs',
          visibleItemCount: 10,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/hot', '/r/:subreddit/new', '/r/:subreddit/top', '/r/:subreddit/rising', '/r/:subreddit/controversial', '/r/:subreddit/gilded', '/r/:subreddit/duplicates/:article', '/r/:subreddit/search', '/r/:subreddit/about/postrequirements', '/r/:subreddit/collection/:collectionId'],
        },
      ],
    },
    {
      id: 'reddit-post-detail',
      url: '/r/siteforge/comments/example',
      title: 'Reddit post detail',
      pageType: 'post_detail',
      routeTemplate: '/r/:subreddit/comments/:article',
      visibleItemCount: 35,
      listPresent: true,
      routeTemplates: ['/r/:subreddit/comments/:article', '/r/:subreddit/comments/:article/:title', '/r/:subreddit/comments/:article/:title/:comment', '/duplicates/:article', '/r/:subreddit/duplicates/:article', '/user/:username', '/r/:subreddit'],
      links: [
        { href: '/r/siteforge', label: 'Post community', semanticKind: 'category', routeTemplate: '/r/:subreddit' },
        { href: '/user/reddit', label: 'Post author', semanticKind: 'profile', routeTemplate: '/user/:username' },
        { href: '/r/siteforge/comments/example/title/comment', label: 'Comment permalink', semanticKind: 'comment_permalink', routeTemplate: '/r/:subreddit/comments/:article/:title/:comment' },
        { href: '/duplicates/example', label: 'Duplicate discussions', semanticKind: 'content', routeTemplate: '/duplicates/:article' },
      ],
      structureItems: [
        {
          nodeType: 'content',
          structureType: 'post_body_summary',
          labelSummary: 'post title body and metadata',
          visibleItemCount: 1,
          listPresent: false,
          routeTemplates: ['/r/:subreddit/comments/:article', '/r/:subreddit/comments/:article/:title', '/duplicates/:article', '/r/:subreddit/duplicates/:article'],
        },
        {
          nodeType: 'component',
          structureType: 'comment_tree',
          labelSummary: 'comment list and reply structure',
          visibleItemCount: 35,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article', '/r/:subreddit/comments/:article/:title/:comment'],
        },
        {
          nodeType: 'operation',
          structureType: 'post_interaction_controls_disabled_summary',
          labelSummary: 'vote save share reply award report controls; no write action',
          visibleItemCount: 7,
          listPresent: true,
          routeTemplates: ['/api/vote', '/api/save', '/api/hide', '/api/report', '/api/comment', '/api/submit', '/api/store_visits'],
        },
      ],
    },
    {
      id: 'reddit-shortlink-post-detail',
      url: '/comments/example',
      title: 'Reddit top-level post shortcut',
      pageType: 'post_detail',
      routeTemplate: '/comments/:article',
      visibleItemCount: 35,
      listPresent: true,
      routeTemplates: ['/comments/:article', '/by_id/:thing', '/r/:subreddit/comments/:article', '/user/:username', '/r/:subreddit'],
      links: [
        { href: '/comments/example', label: 'Top-level post shortcut', semanticKind: 'content', routeTemplate: '/comments/:article' },
        { href: '/by_id/t3_example', label: 'Thing id shortcut', semanticKind: 'content', routeTemplate: '/by_id/:thing' },
        { href: '/user/reddit', label: 'Shortcut post author', semanticKind: 'profile', routeTemplate: '/user/:username' },
      ],
      structureItems: [
        {
          nodeType: 'content',
          structureType: 'post_shortlink_body_summary',
          labelSummary: 'shortcut post title body and metadata',
          visibleItemCount: 1,
          listPresent: false,
          routeTemplates: ['/comments/:article', '/by_id/:thing'],
        },
        {
          nodeType: 'component',
          structureType: 'shortcut_comment_tree',
          labelSummary: 'shortcut comment list and reply structure',
          visibleItemCount: 35,
          listPresent: true,
          routeTemplates: ['/comments/:article', '/by_id/:thing'],
        },
      ],
    },
    {
      id: 'reddit-media-gallery-post',
      url: '/gallery/example',
      title: 'Reddit media and gallery post surfaces',
      pageType: 'media_post_summary',
      routeTemplate: '/gallery/:id',
      visibleItemCount: 12,
      listPresent: true,
      routeTemplates: ['/gallery/:id', '/r/:subreddit/comments/:article/:title', '/r/:subreddit/comments/:article', '/media?url=:mediaUrl'],
      links: [
        { href: '/gallery/example', label: 'Gallery post', semanticKind: 'media', routeTemplate: '/gallery/:id' },
        { href: '/r/siteforge/comments/example/title', label: 'Media post detail', semanticKind: 'content', routeTemplate: '/r/:subreddit/comments/:article/:title' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'media_gallery_summary',
          labelSummary: 'image gallery and video embed structure only',
          visibleItemCount: 12,
          listPresent: true,
          routeTemplates: ['/gallery/:id', '/r/:subreddit/comments/:article/:title', '/media?url=:mediaUrl'],
        },
      ],
    },
    {
      id: 'reddit-poll-and-prediction-surfaces',
      url: '/poll/example',
      title: 'Reddit poll and prediction surfaces',
      pageType: 'poll_prediction_summary',
      routeTemplate: '/poll/:id',
      visibleItemCount: 10,
      listPresent: true,
      routeTemplates: ['/poll/:id', '/r/:subreddit/predictions', '/r/:subreddit/predictions/:predictionId'],
      links: [
        { href: '/poll/example', label: 'Poll detail', semanticKind: 'poll_read', routeTemplate: '/poll/:id' },
        { href: '/r/siteforge/predictions', label: 'Community predictions', semanticKind: 'prediction_read', routeTemplate: '/r/:subreddit/predictions' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'poll_prediction_option_summary',
          labelSummary: 'poll options and prediction list structure only',
          visibleItemCount: 10,
          listPresent: true,
          routeTemplates: ['/poll/:id', '/r/:subreddit/predictions', '/r/:subreddit/predictions/:predictionId'],
        },
      ],
    },
    {
      id: 'reddit-awards-gilding-summary',
      url: '/awards',
      title: 'Reddit awards and gilding summary',
      pageType: 'write_entry_disabled_summary',
      routeTemplate: '/awards',
      visibleItemCount: 8,
      listPresent: true,
      routeTemplates: ['/awards', '/framedGild', '/api/v1/gold/gild/:thing', '/api/v1/gold/give/:username'],
      links: [
        { href: '/awards', label: 'Awards catalog', semanticKind: 'authenticated_read', routeTemplate: '/awards' },
        { href: '/framedGild', label: 'Gilding entry', semanticKind: 'write_entry_disabled', routeTemplate: '/framedGild' },
      ],
      structureItems: [
        {
          nodeType: 'operation',
          structureType: 'award_gilding_disabled_summary',
          labelSummary: 'award and gilding controls; no purchase or mutation action',
          visibleItemCount: 8,
          listPresent: true,
          routeTemplates: ['/awards', '/framedGild', '/api/v1/gold/gild/:thing', '/api/v1/gold/give/:username'],
        },
      ],
    },
    {
      id: 'reddit-community-directory',
      url: '/subreddits',
      title: 'Reddit community directory',
      pageType: 'community_directory',
      routeTemplate: '/subreddits',
      visibleItemCount: 25,
      listPresent: true,
      routeTemplates: ['/subreddits', '/subreddits/search', '/subreddits/mine/subscriber', '/r/:subreddit'],
      links: [
        { href: '/subreddits', label: 'Community directory', semanticKind: 'category_directory', routeTemplate: '/subreddits' },
        { href: '/subreddits/search?q=siteforge', label: 'Search communities', semanticKind: 'search', routeTemplate: '/subreddits/search' },
        { href: '/subreddits/mine/subscriber', label: 'Subscribed communities', semanticKind: 'authenticated_read', routeTemplate: '/subreddits/mine/subscriber' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'community_directory_list',
          labelSummary: 'community directory and subscription list structure',
          visibleItemCount: 25,
          listPresent: true,
          routeTemplates: ['/subreddits', '/subreddits/search', '/subreddits/mine/subscriber', '/r/:subreddit'],
        },
      ],
    },
    {
      id: 'reddit-auth-entry',
      url: '/login',
      title: 'Reddit authentication entry surfaces',
      pageType: 'auth_entry_disabled_summary',
      routeTemplate: '/login',
      visibleItemCount: 4,
      listPresent: true,
      routeTemplates: ['/login', '/register', '/password', '/account-activity'],
      links: [
        { href: '/login', label: 'Login entry', semanticKind: 'auth_navigation', routeTemplate: '/login' },
        { href: '/register', label: 'Register entry', semanticKind: 'auth_navigation', routeTemplate: '/register' },
        { href: '/password', label: 'Password reset entry', semanticKind: 'auth_navigation', routeTemplate: '/password' },
        { href: '/account-activity', label: 'Account activity entry', semanticKind: 'authenticated_read', routeTemplate: '/account-activity' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'auth_navigation_summary',
          labelSummary: 'login register password reset and account activity routes',
          visibleItemCount: 4,
          listPresent: true,
          routeTemplates: ['/login', '/register', '/password', '/account-activity'],
        },
      ],
    },
    {
      id: 'reddit-user-profile',
      url: '/user/reddit',
      title: 'Reddit user profile',
      pageType: 'user_profile',
      routeTemplate: '/user/:username',
      visibleItemCount: 20,
      listPresent: true,
      routeTemplates: ['/user/:username', '/user/:username/overview', '/user/:username/posts', '/user/:username/comments', '/user/:username/submitted', '/user/:username/gilded', '/user/:username/followers', '/user/:username/saved', '/user/:username/hidden', '/user/:username/upvoted', '/user/:username/downvoted', '/r/:subreddit/comments/:article'],
      links: [
        { href: '/user/reddit/overview', label: 'User overview', semanticKind: 'profile_feed', routeTemplate: '/user/:username/overview' },
        { href: '/user/reddit/posts', label: 'User posts', semanticKind: 'profile_feed', routeTemplate: '/user/:username/posts' },
        { href: '/user/reddit/comments', label: 'User comments', semanticKind: 'profile_feed', routeTemplate: '/user/:username/comments' },
        { href: '/user/reddit/submitted', label: 'User submitted posts', semanticKind: 'profile_feed', routeTemplate: '/user/:username/submitted' },
        { href: '/user/reddit/gilded', label: 'User gilded content', semanticKind: 'profile_feed', routeTemplate: '/user/:username/gilded' },
        { href: '/user/reddit/saved', label: 'User saved content', semanticKind: 'authenticated_read', routeTemplate: '/user/:username/saved' },
        { href: '/user/reddit/hidden', label: 'User hidden content', semanticKind: 'authenticated_read', routeTemplate: '/user/:username/hidden' },
        { href: '/user/reddit/upvoted', label: 'User upvoted content', semanticKind: 'authenticated_read', routeTemplate: '/user/:username/upvoted' },
        { href: '/user/reddit/downvoted', label: 'User downvoted content', semanticKind: 'authenticated_read', routeTemplate: '/user/:username/downvoted' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'profile_activity_list',
          labelSummary: 'profile posts and comments',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/user/:username/overview', '/user/:username/posts', '/user/:username/comments', '/user/:username/submitted', '/user/:username/saved', '/user/:username/hidden', '/user/:username/upvoted', '/user/:username/downvoted', '/r/:subreddit/comments/:article'],
        },
      ],
    },
    {
      id: 'reddit-account-library',
      url: '/user/me/saved',
      title: 'Reddit authenticated account library',
      pageType: 'authenticated_account_library_summary',
      routeTemplate: '/user/me/:library',
      visibleItemCount: 24,
      listPresent: true,
      routeTemplates: ['/user/me/saved', '/user/me/hidden', '/user/me/upvoted', '/user/me/downvoted', '/user/me/gilded', '/user/:username/saved', '/user/:username/hidden', '/user/:username/upvoted', '/user/:username/downvoted'],
      links: [
        { href: '/user/me/saved', label: 'Saved posts', semanticKind: 'authenticated_read', routeTemplate: '/user/me/saved' },
        { href: '/user/me/hidden', label: 'Hidden posts', semanticKind: 'authenticated_read', routeTemplate: '/user/me/hidden' },
        { href: '/user/me/upvoted', label: 'Upvoted posts', semanticKind: 'authenticated_read', routeTemplate: '/user/me/upvoted' },
        { href: '/user/me/downvoted', label: 'Downvoted posts', semanticKind: 'authenticated_read', routeTemplate: '/user/me/downvoted' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'account_library_list_summary',
          labelSummary: 'saved hidden voted and gilded account lists',
          visibleItemCount: 24,
          listPresent: true,
          routeTemplates: ['/user/me/saved', '/user/me/hidden', '/user/me/upvoted', '/user/me/downvoted', '/user/me/gilded'],
        },
      ],
    },
    {
      id: 'reddit-custom-feed-multireddit',
      url: '/user/reddit/m/siteforge',
      title: 'Reddit custom feed and multireddit surfaces',
      pageType: 'custom_feed_summary',
      routeTemplate: '/user/:username/m/:multipath',
      visibleItemCount: 18,
      listPresent: true,
      routeTemplates: ['/user/:username/m/:multipath', '/me/m/:multipath', '/r/:multipath', '/user/:username/m/:multipath/search'],
      links: [
        { href: '/user/reddit/m/siteforge', label: 'Custom feed', semanticKind: 'custom_feed_read', routeTemplate: '/user/:username/m/:multipath' },
        { href: '/me/m/siteforge', label: 'My custom feed', semanticKind: 'authenticated_read', routeTemplate: '/me/m/:multipath' },
        { href: '/r/siteforge+codex', label: 'Multi-community listing', semanticKind: 'feed', routeTemplate: '/r/:multipath' },
        { href: '/user/reddit/m/siteforge/search?q=siteforge', label: 'Search custom feed', semanticKind: 'search', routeTemplate: '/user/:username/m/:multipath/search' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'custom_feed_post_list',
          labelSummary: 'custom feed and multireddit post list structure',
          visibleItemCount: 18,
          listPresent: true,
          routeTemplates: ['/user/:username/m/:multipath', '/me/m/:multipath', '/r/:multipath', '/user/:username/m/:multipath/search'],
        },
      ],
    },
    {
      id: 'reddit-inbox',
      url: '/message/inbox',
      title: 'Reddit inbox',
      pageType: 'authenticated_inbox_summary',
      routeTemplate: '/message/inbox',
      visibleItemCount: 20,
      listPresent: true,
      routeTemplates: ['/message/inbox', '/message/sent', '/message/unread', '/message/comments', '/message/selfreply', '/message/mentions', '/message/compose', '/message/messages/:messageId'],
      links: [
        { href: '/message/inbox', label: 'Inbox', semanticKind: 'authenticated_read', routeTemplate: '/message/inbox' },
        { href: '/message/sent', label: 'Sent messages', semanticKind: 'authenticated_read', routeTemplate: '/message/sent' },
        { href: '/message/unread', label: 'Unread messages', semanticKind: 'authenticated_read', routeTemplate: '/message/unread' },
        { href: '/message/comments', label: 'Comment replies', semanticKind: 'authenticated_read', routeTemplate: '/message/comments' },
        { href: '/message/selfreply', label: 'Post replies', semanticKind: 'authenticated_read', routeTemplate: '/message/selfreply' },
        { href: '/message/mentions', label: 'Mentions', semanticKind: 'authenticated_read', routeTemplate: '/message/mentions' },
        { href: '/message/compose', label: 'Compose message entry', semanticKind: 'write_entry_disabled', routeTemplate: '/message/compose' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'private_message_list_summary',
          labelSummary: 'message list structure only',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/message/inbox', '/message/sent', '/message/unread', '/message/comments', '/message/selfreply', '/message/mentions', '/message/messages/:messageId'],
        },
      ],
    },
    {
      id: 'reddit-domain-and-duplicates',
      url: '/domain/example.com',
      title: 'Reddit domain and duplicate discussion surfaces',
      pageType: 'domain_duplicates_summary',
      routeTemplate: '/domain/:domain',
      visibleItemCount: 18,
      listPresent: true,
      routeTemplates: ['/domain/:domain', '/domain/:domain/new', '/domain/:domain/top', '/domain/:domain/search', '/duplicates/:article', '/r/:subreddit/duplicates/:article'],
      links: [
        { href: '/domain/example.com', label: 'Domain listing', semanticKind: 'domain_listing', routeTemplate: '/domain/:domain' },
        { href: '/domain/example.com/new', label: 'Domain new listing', semanticKind: 'feed', routeTemplate: '/domain/:domain/new' },
        { href: '/domain/example.com/top', label: 'Domain top listing', semanticKind: 'ranking', routeTemplate: '/domain/:domain/top' },
        { href: '/domain/example.com/search?q=siteforge', label: 'Search domain', semanticKind: 'search', routeTemplate: '/domain/:domain/search' },
        { href: '/duplicates/example', label: 'Duplicate discussions', semanticKind: 'content', routeTemplate: '/duplicates/:article' },
        { href: '/r/siteforge/duplicates/example', label: 'Community duplicate discussions', semanticKind: 'content', routeTemplate: '/r/:subreddit/duplicates/:article' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'domain_post_list',
          labelSummary: 'domain listing search and duplicate discussion routes',
          visibleItemCount: 18,
          listPresent: true,
          routeTemplates: ['/domain/:domain', '/domain/:domain/new', '/domain/:domain/top', '/domain/:domain/search', '/duplicates/:article', '/r/:subreddit/duplicates/:article'],
        },
      ],
    },
    {
      id: 'reddit-chat-and-modmail',
      url: '/chat',
      title: 'Reddit chat and modmail summaries',
      pageType: 'authenticated_communication_summary',
      routeTemplate: '/chat',
      visibleItemCount: 16,
      listPresent: true,
      routeTemplates: ['/chat', '/chat/channel/:channel', '/message/moderator', '/mod/:subreddit/mail', '/mod/:subreddit/mail/all', '/mod/:subreddit/mail/new', '/r/:subreddit/about/modmail'],
      links: [
        { href: '/chat', label: 'Chat list', semanticKind: 'authenticated_read', routeTemplate: '/chat' },
        { href: '/message/moderator', label: 'Moderator mail', semanticKind: 'moderation_read', routeTemplate: '/message/moderator' },
        { href: '/mod/siteforge/mail/all', label: 'Modmail all', semanticKind: 'moderation_read', routeTemplate: '/mod/:subreddit/mail/all' },
        { href: '/mod/siteforge/mail/new', label: 'Modmail new', semanticKind: 'moderation_read', routeTemplate: '/mod/:subreddit/mail/new' },
        { href: '/r/siteforge/about/modmail', label: 'Community modmail', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/modmail' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'chat_modmail_list_summary',
          labelSummary: 'chat channel and modmail thread list structure only',
          visibleItemCount: 16,
          listPresent: true,
          routeTemplates: ['/chat', '/chat/channel/:channel', '/message/moderator', '/mod/:subreddit/mail', '/mod/:subreddit/mail/all', '/mod/:subreddit/mail/new', '/r/:subreddit/about/modmail'],
        },
      ],
    },
    {
      id: 'reddit-notifications',
      url: '/notifications',
      title: 'Reddit notifications',
      pageType: 'authenticated_notifications_summary',
      routeTemplate: '/notifications',
      visibleItemCount: 20,
      listPresent: true,
      routeTemplates: ['/notifications', '/message/inbox', '/r/:subreddit/comments/:article'],
      links: [
        { href: '/notifications', label: 'Notifications', semanticKind: 'authenticated_read', routeTemplate: '/notifications' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'notification_list_summary',
          labelSummary: 'notification list structure only',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/notifications', '/r/:subreddit/comments/:article'],
        },
      ],
    },
    {
      id: 'reddit-settings',
      url: '/settings',
      title: 'Reddit settings',
      pageType: 'authenticated_settings_summary',
      routeTemplate: '/settings',
      visibleItemCount: 8,
      listPresent: true,
      routeTemplates: ['/settings', '/settings/account', '/settings/privacy', '/settings/profile', '/settings/feed', '/settings/notifications', '/settings/emails', '/settings/messaging', '/prefs'],
      links: [
        { href: '/settings/account', label: 'Account settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/account' },
        { href: '/settings/privacy', label: 'Privacy settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/privacy' },
        { href: '/settings/profile', label: 'Profile settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/profile' },
        { href: '/settings/feed', label: 'Feed settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/feed' },
        { href: '/settings/notifications', label: 'Notification settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/notifications' },
        { href: '/settings/emails', label: 'Email settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/emails' },
        { href: '/settings/messaging', label: 'Messaging settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/messaging' },
        { href: '/prefs', label: 'Classic preferences', semanticKind: 'authenticated_settings', routeTemplate: '/prefs' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'settings_navigation_summary',
          labelSummary: 'settings tabs and sections',
          visibleItemCount: 8,
          listPresent: true,
          routeTemplates: ['/settings/account', '/settings/privacy', '/settings/profile', '/settings/feed', '/settings/notifications', '/settings/emails', '/settings/messaging', '/prefs'],
        },
      ],
    },
    {
      id: 'reddit-submit-entry',
      url: '/submit',
      title: 'Reddit submit entry',
      pageType: 'write_entry_disabled_summary',
      routeTemplate: '/submit',
      visibleItemCount: 3,
      listPresent: true,
      routeTemplates: ['/submit', '/submit?type=text', '/submit?type=link', '/r/:subreddit/submit', '/r/:subreddit/submit?type=text', '/r/:subreddit/submit?type=link'],
      links: [
        { href: '/submit', label: 'Create post entry', semanticKind: 'write_entry_disabled', routeTemplate: '/submit' },
        { href: '/submit?type=link', label: 'Create link post entry', semanticKind: 'write_entry_disabled', routeTemplate: '/submit?type=link' },
        { href: '/r/siteforge/submit', label: 'Community create post entry', semanticKind: 'write_entry_disabled', routeTemplate: '/r/:subreddit/submit' },
      ],
      structureItems: [
        {
          nodeType: 'operation',
          structureType: 'submit_form_disabled_summary',
          labelSummary: 'post creation form structure only; no submit action',
          visibleItemCount: 3,
          listPresent: true,
          routeTemplates: ['/submit', '/submit?type=text', '/submit?type=link', '/r/:subreddit/submit', '/r/:subreddit/submit?type=text', '/r/:subreddit/submit?type=link'],
        },
      ],
    },
    {
      id: 'reddit-moderation-surfaces',
      url: '/r/siteforge/about/modqueue',
      title: 'Reddit moderation surfaces',
      pageType: 'moderation_summary',
      routeTemplate: '/r/:subreddit/about/:moderation_surface',
      visibleItemCount: 8,
      listPresent: true,
      routeTemplates: [
        '/r/:subreddit/about',
        '/r/:subreddit/about/rules',
        '/r/:subreddit/about/modqueue',
        '/r/:subreddit/about/reports',
        '/r/:subreddit/about/spam',
        '/r/:subreddit/about/log',
        '/r/:subreddit/about/unmoderated',
        '/r/:subreddit/about/edited',
        '/r/:subreddit/about/modmail',
        '/r/:subreddit/about/edit',
        '/r/:subreddit/about/banned',
        '/r/:subreddit/about/muted',
        '/r/:subreddit/about/contributors',
        '/r/:subreddit/about/wikibanned',
        '/r/:subreddit/about/wikicontributors',
        '/r/:subreddit/about/traffic',
        '/r/:subreddit/about/scheduledposts',
        '/r/:subreddit/about/sticky',
        '/r/:subreddit/about/flair',
        '/r/:subreddit/about/emojis',
        '/r/:subreddit/about/postrequirements',
        '/r/:subreddit/about/removal',
        '/r/:subreddit/about/communityappearance',
        '/r/:subreddit/about/wiki',
        '/r/:subreddit/wiki/settings/:page',
      ],
      links: [
        { href: '/r/siteforge/about', label: 'Community about', semanticKind: 'community_metadata_read', routeTemplate: '/r/:subreddit/about' },
        { href: '/r/siteforge/about/rules', label: 'Community rules', semanticKind: 'community_metadata_read', routeTemplate: '/r/:subreddit/about/rules' },
        { href: '/r/siteforge/about/modqueue', label: 'Moderation queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/modqueue' },
        { href: '/r/siteforge/about/reports', label: 'Reports', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/reports' },
        { href: '/r/siteforge/about/spam', label: 'Spam queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/spam' },
        { href: '/r/siteforge/about/log', label: 'Moderation log', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/log' },
        { href: '/r/siteforge/about/unmoderated', label: 'Unmoderated queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/unmoderated' },
        { href: '/r/siteforge/about/edited', label: 'Edited queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/edited' },
        { href: '/r/siteforge/about/banned', label: 'Banned users', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/banned' },
        { href: '/r/siteforge/about/muted', label: 'Muted users', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/muted' },
        { href: '/r/siteforge/about/contributors', label: 'Approved contributors', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/contributors' },
        { href: '/r/siteforge/about/traffic', label: 'Traffic stats', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/traffic' },
        { href: '/r/siteforge/about/scheduledposts', label: 'Scheduled posts', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/scheduledposts' },
        { href: '/r/siteforge/about/flair', label: 'Post flair settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/flair' },
        { href: '/r/siteforge/about/emojis', label: 'Community emoji settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/emojis' },
        { href: '/r/siteforge/about/postrequirements', label: 'Post requirements settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/postrequirements' },
        { href: '/r/siteforge/about/removal', label: 'Removal reasons', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/removal' },
        { href: '/r/siteforge/about/communityappearance', label: 'Community appearance', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/communityappearance' },
        { href: '/r/siteforge/wiki/settings/index', label: 'Wiki page settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/wiki/settings/:page' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'moderation_queue_summary',
          labelSummary: 'moderation queue list structure only',
          visibleItemCount: 8,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/about', '/r/:subreddit/about/rules', '/r/:subreddit/about/modqueue', '/r/:subreddit/about/reports', '/r/:subreddit/about/spam', '/r/:subreddit/about/log', '/r/:subreddit/about/unmoderated', '/r/:subreddit/about/edited', '/r/:subreddit/about/modmail', '/r/:subreddit/about/edit', '/r/:subreddit/about/banned', '/r/:subreddit/about/muted', '/r/:subreddit/about/contributors', '/r/:subreddit/about/wikibanned', '/r/:subreddit/about/wikicontributors', '/r/:subreddit/about/traffic', '/r/:subreddit/about/scheduledposts', '/r/:subreddit/about/sticky', '/r/:subreddit/about/flair', '/r/:subreddit/about/emojis', '/r/:subreddit/about/postrequirements', '/r/:subreddit/about/removal', '/r/:subreddit/about/communityappearance', '/r/:subreddit/about/wiki', '/r/:subreddit/wiki/settings/:page'],
        },
      ],
    },
    {
      id: 'reddit-moderation-settings',
      url: '/r/siteforge/about/postrequirements',
      title: 'Reddit moderation settings surfaces',
      pageType: 'moderation_settings_summary',
      routeTemplate: '/r/:subreddit/about/postrequirements',
      visibleItemCount: 10,
      listPresent: true,
      routeTemplates: ['/r/:subreddit/about/flair', '/r/:subreddit/about/emojis', '/r/:subreddit/about/postrequirements', '/r/:subreddit/about/removal', '/r/:subreddit/about/communityappearance', '/r/:subreddit/about/wiki', '/r/:subreddit/wiki/settings/:page'],
      links: [
        { href: '/r/siteforge/about/flair', label: 'Post flair settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/flair' },
        { href: '/r/siteforge/about/emojis', label: 'Community emoji settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/emojis' },
        { href: '/r/siteforge/about/postrequirements', label: 'Post requirements', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/postrequirements' },
        { href: '/r/siteforge/about/removal', label: 'Removal reasons', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/removal' },
        { href: '/r/siteforge/about/communityappearance', label: 'Community appearance', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/communityappearance' },
        { href: '/r/siteforge/wiki/settings/index', label: 'Wiki settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/wiki/settings/:page' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'moderation_settings_navigation',
          labelSummary: 'moderation settings routes for flair emoji post requirements removal reasons appearance and wiki',
          visibleItemCount: 10,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/about/flair', '/r/:subreddit/about/emojis', '/r/:subreddit/about/postrequirements', '/r/:subreddit/about/removal', '/r/:subreddit/about/communityappearance', '/r/:subreddit/about/wiki', '/r/:subreddit/wiki/settings/:page'],
        },
      ],
    },
    {
      id: 'reddit-wiki-page',
      url: '/r/siteforge/wiki/index',
      title: 'Reddit wiki page',
      pageType: 'wiki_page',
      routeTemplate: '/r/:subreddit/wiki/:page',
      visibleItemCount: 12,
      listPresent: true,
      routeTemplates: ['/r/:subreddit/wiki/:page', '/r/:subreddit/wiki/pages', '/r/:subreddit/wiki/revisions/:page', '/r/:subreddit/wiki/edit/:page', '/r/:subreddit/wiki/settings/:page', '/wiki/:page'],
      links: [
        { href: '/r/siteforge/wiki/index', label: 'Community wiki page', semanticKind: 'wiki_read', routeTemplate: '/r/:subreddit/wiki/:page' },
        { href: '/r/siteforge/wiki/pages', label: 'Community wiki pages', semanticKind: 'wiki_read', routeTemplate: '/r/:subreddit/wiki/pages' },
        { href: '/r/siteforge/wiki/edit/index', label: 'Community wiki edit entry', semanticKind: 'write_entry_disabled', routeTemplate: '/r/:subreddit/wiki/edit/:page' },
        { href: '/r/siteforge/wiki/settings/index', label: 'Community wiki settings', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/wiki/settings/:page' },
        { href: '/wiki/reddiquette', label: 'Site wiki page', semanticKind: 'wiki_read', routeTemplate: '/wiki/:page' },
      ],
      structureItems: [
        {
          nodeType: 'content',
          structureType: 'wiki_content_summary',
          labelSummary: 'wiki content and revision navigation',
          visibleItemCount: 12,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/wiki/:page', '/r/:subreddit/wiki/pages', '/r/:subreddit/wiki/revisions/:page', '/r/:subreddit/wiki/edit/:page', '/r/:subreddit/wiki/settings/:page', '/wiki/:page'],
        },
      ],
    },
    {
      id: 'reddit-live-thread',
      url: '/live/example',
      title: 'Reddit live thread',
      pageType: 'live_thread_summary',
      routeTemplate: '/live/:thread',
      visibleItemCount: 30,
      listPresent: true,
      routeTemplates: ['/live/:thread', '/live/:thread/updates/:updateId', '/live/:thread/about'],
      links: [
        { href: '/live/example', label: 'Live thread', semanticKind: 'live_thread', routeTemplate: '/live/:thread' },
        { href: '/live/example/about', label: 'Live thread about', semanticKind: 'live_thread_metadata', routeTemplate: '/live/:thread/about' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'live_thread_update_list',
          labelSummary: 'live thread update stream structure only',
          visibleItemCount: 30,
          listPresent: true,
          routeTemplates: ['/live/:thread', '/live/:thread/updates/:updateId'],
        },
      ],
    },
  ];
}

function redditApiOperationStructurePage(operation, index = 0) {
  const operationSlug = slugify(`${operation?.method ?? 'GET'} ${operation?.pathTemplate ?? index}`, `operation-${index + 1}`);
  const readOnly = operation?.method === 'GET';
  const operationId = String(operation?.id ?? operationSlug);
  const routeTemplate = `/dev/api/operation/${operationId}`;
  const operationPathTemplates = uniqueSorted([operation?.pathTemplate, ...asArray(operation?.uriVariants)]);
  return {
    id: `reddit-api-operation-${operationId}`,
    url: routeTemplate,
    title: `${operation?.method ?? 'GET'} ${operation?.pathTemplate ?? ''}`.trim(),
    pageType: readOnly ? 'official_api_read_operation' : 'official_api_write_operation_disabled',
    routeTemplate,
    visibleItemCount: Math.max(1, asArray(operation?.parameters).length + asArray(operation?.oauthEndpointTemplates).length),
    listPresent: asArray(operation?.parameters).length > 0,
    routeTemplates: readOnly
      ? uniqueSorted([routeTemplate, ...operationPathTemplates])
      : [routeTemplate],
    disabledOperationPathTemplates: readOnly ? [] : operationPathTemplates,
    links: [
      {
        href: routeTemplate,
        label: `${operation?.method ?? 'GET'} ${operation?.pathTemplate ?? ''}`.trim(),
        semanticKind: readOnly ? 'api_read' : 'api_write_disabled',
        routeTemplate: readOnly ? (operation?.pathTemplate ?? routeTemplate) : routeTemplate,
        disabledOperationPathTemplate: readOnly ? undefined : (operation?.pathTemplate ?? null),
      },
    ],
    structureItems: [
      {
        nodeType: 'operation',
        structureType: readOnly ? 'official_api_read_template' : 'official_api_write_template_disabled',
        labelSummary: `${operation?.method ?? 'GET'} ${operation?.pathTemplate ?? ''}`.trim(),
        visibleItemCount: Math.max(1, asArray(operation?.parameters).length),
        listPresent: asArray(operation?.parameters).length > 0,
        routeTemplates: readOnly ? operationPathTemplates : [],
        disabledOperationPathTemplates: readOnly ? [] : operationPathTemplates,
      },
      {
        nodeType: 'runtime',
        structureType: readOnly ? 'oauth_read_runtime_plan' : 'state_changing_operation_disabled',
        labelSummary: readOnly
          ? 'read-only OAuth API runtime plan available with operator supplied credentials'
          : 'state-changing operation recorded for coverage and disabled by default',
        visibleItemCount: asArray(operation?.oauthScopes).length,
        listPresent: asArray(operation?.oauthScopes).length > 0,
        routeTemplates: readOnly ? [operation?.pathTemplate].filter(Boolean) : [],
        disabledOperationPathTemplates: readOnly ? [] : [operation?.pathTemplate].filter(Boolean),
      },
    ],
  };
}

export function buildRedditAuthorizedSourceConfig(catalog, {
  generatedAt = new Date().toISOString(),
  rootUrl = REDDIT_SITE_ROOT_URL,
  operationChunkSize = REDDIT_AUTHORIZED_SOURCE_OPERATION_CHUNK_SIZE,
} = /** @type {any} */ ({})) {
  const operations = asArray(catalog?.operations);
  const surfacePages = redditSurfaceStructurePages().map((page) => redditSurfaceInteractions(page));
  const surfaceFormCount = surfacePages.reduce((sum, page) => sum + asArray(page.forms).length, 0);
  const surfaceControlCount = surfacePages.reduce((sum, page) => sum + asArray(page.controls).length, 0);
  const sources = [{
    id: 'reddit-site-surface-authorized-summary',
    kind: 'structure-summary',
    url: '/',
    accessBasis: 'siteforge_reddit_sanitized_surface_model',
    permissionScope: 'sanitized_summary_only',
    allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
    structurePages: surfacePages,
  }];
  const chunkSize = Math.max(1, Math.min(40, Number(operationChunkSize) || REDDIT_AUTHORIZED_SOURCE_OPERATION_CHUNK_SIZE));
  for (let index = 0; index < operations.length; index += chunkSize) {
    const chunk = operations.slice(index, index + chunkSize);
    sources.push({
      id: `reddit-official-api-operations-${Math.floor(index / chunkSize) + 1}`,
      kind: 'structure-summary',
      url: '/dev/api/',
      accessBasis: 'reddit_official_api_docs_sanitized_structure',
      permissionScope: 'sanitized_summary_only',
      allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'structure_hash'],
      structurePages: chunk.map((operation, operationIndex) => redditApiOperationStructurePage(operation, index + operationIndex)),
    });
  }
  const siteforgeLocalConfig = {
    sites: [{
      url: rootUrl,
      build: {
        renderJs: false,
        maxDepth: 1,
        maxPages: Math.max(1, surfacePages.length + operations.length),
        maxSeeds: 1,
        maxSitemaps: 1,
      },
      authorizedSources: sources,
      auth: {
        mode: 'none',
        authRoutes: [],
        publicRevisitRoutes: [],
      },
    }],
  };
  const payload = {
    schemaVersion: 1,
    artifactFamily: 'reddit-authorized-source-local-config',
    generatedAt,
    sourceReferences: catalog?.sourceReferences ?? [REDDIT_DEV_API_URL],
    summary: {
      sources: sources.length,
      structurePages: surfacePages.length + operations.length,
      siteSurfacePages: surfacePages.length,
      siteSurfaceForms: surfaceFormCount,
      siteSurfaceControls: surfaceControlCount,
      officialApiOperationPages: operations.length,
      readOperationPages: operations.filter((operation) => operation.method === 'GET').length,
      writeOperationPagesDisabled: operations.filter((operation) => operation.method !== 'GET').length,
      genericCrawlAllowed: false,
      cookiePersisted: false,
      tokenPersisted: false,
      rawHtmlPersisted: false,
      browserProfilePersisted: false,
    },
    siteforgeLocalConfig,
  };
  assertNoForbiddenPatterns(payload);
  return payload;
}

export function buildRedditAuthorizedSourceManifest(config) {
  const sources = asArray(config?.siteforgeLocalConfig?.sites?.[0]?.authorizedSources);
  const pages = sources.flatMap((source) => asArray(source.structurePages).map((page) => ({
    ...page,
    sourceId: source.id ?? null,
    accessBasis: source.accessBasis ?? null,
    permissionScope: source.permissionScope ?? null,
  })));
  const manifest = {
    schemaVersion: 1,
    artifactFamily: 'siteforge-authorized-source-manifest',
    generatedAt: config?.generatedAt ?? new Date().toISOString(),
    sourceReferences: config?.sourceReferences ?? [REDDIT_DEV_API_URL],
    sources: sources.map((source) => ({
      id: source.id ?? null,
      kind: source.kind ?? null,
      url: source.url ?? null,
      accessBasis: source.accessBasis ?? null,
      permissionScope: source.permissionScope ?? null,
      pageCount: asArray(source.structurePages).length,
    })),
    pages,
  };
  assertNoForbiddenPatterns(manifest);
  return manifest;
}

function redditConcreteRoute(value) {
  const text = String(value ?? '').trim();
  if (!text || /[<>"'{}]|\b(?:authorization|bearer|cookie|token|secret|password=|session)\b/iu.test(text)) {
    return null;
  }
  if (/^https?:\/\//iu.test(text)) {
    try {
      const parsed = new URL(text);
      if (!/(\.|^)reddit\.com$/iu.test(parsed.hostname)) {
        return null;
      }
      parsed.username = '';
      parsed.password = '';
      parsed.hash = '';
      parsed.search = '';
      return parsed.pathname || '/';
    } catch {
      return null;
    }
  }
  if (!text.startsWith('/') || text.startsWith('//')) {
    return null;
  }
  return text.split('#')[0].slice(0, 240);
}

function redditRouteQueueAccessClass(candidate = /** @type {any} */ ({})) {
  const routeText = `${candidate.route ?? ''} ${candidate.routeTemplate ?? ''}`.toLowerCase();
  const semanticText = String(candidate.semanticKind ?? '').toLowerCase();
  const pageTypeText = String(candidate.pageType ?? '').toLowerCase();
  const safetyText = String(candidate.safety ?? '').toLowerCase();
  if (
    candidate.disabled === true
    || safetyText.includes('state_changing')
    || semanticText.includes('write_disabled')
    || semanticText.includes('moderation_write_disabled')
  ) {
    return 'write_disabled';
  }
  if (/^\/(?:api|dev\/api)\//u.test(routeText.trim()) || / \/(?:api|dev\/api)\//u.test(routeText)) {
    return 'api_disabled';
  }
  if (redditBrowserRouteBoundaryDisposition(candidate.route ?? candidate.routeTemplate)) {
    return 'browser_boundary';
  }
  if (/\/(?:mod\/|r\/[^/]+\/about\/(?:modqueue|reports|spam|log|unmoderated|edited|modmail|edit|banned|muted|contributors|wikibanned|wikicontributors|traffic|scheduledposts|sticky|flair|emojis|postrequirements|removal|communityappearance|wiki)|r\/[^/]+\/wiki\/settings)/u.test(routeText)) {
    return 'moderator_limited';
  }
  if (/\/(?:message|settings|notifications|chat|account-activity|prefs|awards)\b|\/user\/me\b|\/me\/m\//u.test(routeText)) {
    return 'auth_private';
  }
  if (semanticText.includes('authenticated') || pageTypeText.includes('authenticated')) {
    return 'auth_private';
  }
  if (/^\/(?:login|register|password)\b/u.test(String(candidate.route ?? candidate.routeTemplate ?? '').toLowerCase())) {
    return 'auth_entry';
  }
  return 'public';
}

function redditBrowserBridgeEligible(accessClass) {
  return !['write_disabled', 'api_disabled', 'browser_boundary'].includes(accessClass);
}

function collectRedditRouteQueueCandidates(authorizedSourceManifest = null) {
  const candidates = [];
  const addCandidate = (candidate) => {
    const route = redditConcreteRoute(candidate.route ?? candidate.href ?? candidate.url);
    const routeTemplate = String(candidate.routeTemplate ?? candidate.routePattern ?? route ?? '').trim().slice(0, 240) || null;
    if (!route && !routeTemplate) {
      return;
    }
    const base = {
      route,
      routeTemplate,
      sourceId: candidate.sourceId ?? null,
      pageId: candidate.pageId ?? null,
      sourceKind: candidate.sourceKind ?? null,
      pageType: candidate.pageType ?? null,
      semanticKind: candidate.semanticKind ?? null,
      safety: candidate.safety ?? 'read_only',
      disabled: candidate.disabled === true,
      valuePersisted: false,
      cookiePersisted: false,
      browserProfilePersisted: false,
    };
    const accessClass = redditRouteQueueAccessClass(base);
    candidates.push({
      ...base,
      accessClass,
      browserBridgeEligible: redditBrowserBridgeEligible(accessClass),
    });
  };

  for (const page of asArray(authorizedSourceManifest?.pages)) {
    addCandidate({
      route: page.url,
      routeTemplate: page.routeTemplate,
      sourceId: page.sourceId,
      sourceKind: 'page',
      pageId: page.id,
      pageType: page.pageType,
      semanticKind: page.pageType,
    });
    for (const routeTemplate of asArray(page.routeTemplates)) {
      addCandidate({
        routeTemplate,
        sourceId: page.sourceId,
        sourceKind: 'page_route_template',
        pageId: page.id,
        pageType: page.pageType,
        semanticKind: page.pageType,
      });
    }
    for (const link of asArray(page.links)) {
      addCandidate({
        route: link.href,
        routeTemplate: link.routeTemplate,
        sourceId: page.sourceId,
        sourceKind: 'link',
        pageId: page.id,
        pageType: page.pageType,
        semanticKind: link.semanticKind,
      });
    }
    for (const form of asArray(page.forms)) {
      addCandidate({
        route: form.action,
        routeTemplate: form.action,
        sourceId: page.sourceId,
        sourceKind: 'form',
        pageId: page.id,
        pageType: page.pageType,
        semanticKind: form.semanticKind,
        safety: form.safety,
        disabled: form.safety === 'state_changing_disabled',
      });
    }
    for (const control of asArray(page.controls)) {
      addCandidate({
        route: control.routeTemplate,
        routeTemplate: control.routeTemplate,
        sourceId: page.sourceId,
        sourceKind: 'control',
        pageId: page.id,
        pageType: page.pageType,
        semanticKind: control.semanticKind,
        safety: control.safety,
        disabled: control.disabled,
      });
    }
  }

  return Array.from(new Map(candidates.map((candidate) => [
    `${candidate.route ?? ''}\u0000${candidate.routeTemplate ?? ''}\u0000${candidate.sourceKind ?? ''}\u0000${candidate.accessClass}`,
    candidate,
  ])).values())
    .sort((left, right) => `${left.accessClass} ${left.routeTemplate ?? ''} ${left.route ?? ''}`.localeCompare(`${right.accessClass} ${right.routeTemplate ?? ''} ${right.route ?? ''}`));
}

export function buildRedditBrowserBridgeRouteQueue({
  authorizedSourceManifest = null,
  limit = null,
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const candidates = collectRedditRouteQueueCandidates(authorizedSourceManifest);
  const selectedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : null;
  const routes = selectedLimit ? candidates.slice(0, selectedLimit) : candidates;
  const accessClassCounts = countBy(candidates, (candidate) => candidate.accessClass);
  const report = {
    schemaVersion: 1,
    artifactFamily: 'reddit-browser-bridge-route-queue',
    generatedAt,
    sourceReferences: authorizedSourceManifest?.sourceReferences ?? [REDDIT_DEV_API_URL],
    mode: 'sanitized_authorized_source_route_queue',
    summary: {
      totalCandidateRoutes: candidates.length,
      selectedRoutes: routes.length,
      uniqueRouteTemplates: uniqueSorted(candidates.map((candidate) => candidate.routeTemplate)).length,
      concreteRouteCount: candidates.filter((candidate) => candidate.route).length,
      routeTemplateOnlyCount: candidates.filter((candidate) => !candidate.route && candidate.routeTemplate).length,
      browserBridgeEligibleRoutes: candidates.filter((candidate) => candidate.browserBridgeEligible).length,
      publicCandidateRoutes: accessClassCounts.public ?? 0,
      authPrivateCandidateRoutes: accessClassCounts.auth_private ?? 0,
      authEntryCandidateRoutes: accessClassCounts.auth_entry ?? 0,
      moderatorLimitedCandidateRoutes: accessClassCounts.moderator_limited ?? 0,
      browserBoundaryCandidateRoutes: accessClassCounts.browser_boundary ?? 0,
      writeDisabledCandidateRoutes: accessClassCounts.write_disabled ?? 0,
      apiDisabledRoutes: accessClassCounts.api_disabled ?? 0,
      cookiePersisted: false,
      tokenPersisted: false,
      rawHtmlPersisted: false,
      browserProfilePersisted: false,
    },
    accessClassCounts,
    routeQueue: routes,
    executionBoundary: {
      cookieRequiredAtRuntime: true,
      cookiePersisted: false,
      browserProfilePersisted: false,
      writesDisabled: true,
      apiExecutionHandledByOauthRuntime: true,
      browserBridgeEligibleAccessClasses: ['public', 'auth_private', 'auth_entry', 'moderator_limited'],
    },
  };
  assertNoForbiddenPatterns(report);
  return report;
}

export function parseRedditOfficialApiCatalog(html, {
  generatedAt = new Date().toISOString(),
  sourceUrl = REDDIT_DEV_API_URL,
} = /** @type {any} */ ({})) {
  const sourceHtml = String(html ?? '');
  const operations = [];
  const endpointRe = /<div class="endpoint" id="([^"]+)">([\s\S]*?)(?=<div class="endpoint" id="|<h2 id="section_|<\/body>)/giu;
  let match;
  while ((match = endpointRe.exec(sourceHtml))) {
    const [, anchorId, block] = match;
    const heading = block.match(/<h3>([\s\S]*?)<\/h3>/iu)?.[1] ?? '';
    const method = (heading.match(/<span class="method">\s*([A-Z]+)(?:&nbsp;|\s)*<\/span>/iu)?.[1] ?? '').toUpperCase();
    if (!method) {
      continue;
    }
    const pathTemplate = cleanEndpointPath(heading);
    const oauthScopes = [...heading.matchAll(/<span class="api-badge oauth-scope">([\s\S]*?)<\/span>/giu)]
      .map((scope) => stripTags(scope[1]))
      .filter(Boolean);
    const endpointTemplates = oauthEndpointTemplates(pathTemplate);
    const safety = riskFor(method, pathTemplate, oauthScopes);
    operations.push({
      id: stableOperationId(method, pathTemplate),
      anchorId,
      method,
      pathTemplate,
      oauthEndpointTemplate: endpointTemplates[0],
      oauthEndpointTemplates: endpointTemplates,
      section: extractSection(sourceHtml.slice(0, match.index)),
      oauthScopes: oauthScopes.length ? oauthScopes : ['any'],
      parameters: parseParameters(block, pathTemplate),
      uriVariants: parseUriVariants(block),
      pathTemplateHasOptionalSubreddit: pathTemplate.startsWith('[/r/:subreddit]'),
      listing: /href="#listings"|id="listings"/iu.test(block),
      supportsRss: /api-badge rss-support/iu.test(heading),
      safety,
      executionStatus: executionStatus(method),
      siteforgeApiRequestCandidate: {
        kind: 'api_request',
        method,
        endpointTemplate: endpointTemplates[0],
        endpointTemplates,
        authBoundary: 'oauth_bearer_token_required',
        runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
        responseMaterial: 'sanitized_summary_only',
        autoExecute: false,
        requiresConfirmation: method !== 'GET',
        blockedReason: method === 'GET'
          ? 'oauth_token_and_user_agent_required'
          : 'write_method_disabled_by_default',
      },
    });
  }

  const getTemplates = operations.filter((operation) => operation.method === 'GET');
  return {
    schemaVersion: 1,
    artifactFamily: 'reddit-official-api-catalog',
    generatedAt,
    sourceReferences: [sourceUrl],
    sourceFetch: {
      sourceUrl,
      htmlSha256: createHash('sha256').update(sourceHtml).digest('hex'),
      rawHtmlPersistedInArtifact: false,
      oauthScopeSource: 'oauth-scope badges embedded in official endpoint headings',
    },
    collectionMode: 'official_docs_sanitized_structure_only',
    cookieUsed: false,
    cookiePersisted: false,
    operationCount: operations.length,
    methodCounts: countBy(operations, (operation) => operation.method),
    sectionCounts: countBy(operations, (operation) => operation.section),
    oauthScopeCounts: scopeCounts(operations),
    safetyCounts: countBy(operations, (operation) => operation.safety),
    templateExpansionSummary: {
      optionalSubredditOperations: operations.filter((operation) => operation.pathTemplateHasOptionalSubreddit).length,
      oauthEndpointTemplateCount: operations.reduce((sum, operation) => sum + operation.oauthEndpointTemplates.length, 0),
      uriVariantCount: operations.reduce((sum, operation) => sum + operation.uriVariants.length, 0),
    },
    executableSummary: {
      getTemplates: getTemplates.length,
      siteActionReadRuntimeTemplates: getTemplates.length,
      runtimeReadyApiRequestPlans: getTemplates.length,
      writeTemplatesRecordedDisabled: operations.length - getTemplates.length,
      registeredInCurrentSiteForgeRuntime: 0,
      requiredNextStepForExecution: 'Use reddit-action api-read with an operator-supplied Reddit OAuth bearer token and descriptive User-Agent for read-only API execution.',
    },
    operations,
  };
}

export async function fetchRedditOfficialApiHtml({
  fetchImpl = globalThis.fetch,
  sourceUrl = REDDIT_DEV_API_URL,
  userAgent = 'SiteForgeRedditApiCatalog/0.1',
} = /** @type {any} */ ({})) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required to load Reddit API docs');
  }
  const response = await fetchImpl(sourceUrl, {
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Reddit API docs fetch failed with HTTP ${response.status}`);
    // @ts-ignore
    error.status = response.status;
    // @ts-ignore
    error.bodySummary = {
      textLength: body.length,
      challengeLike: /blocked by network security|login|developer token|captcha/iu.test(body),
    };
    throw error;
  }
  return body;
}

export async function loadRedditOfficialApiCatalog({
  html = null,
  sourcePath = null,
  fetchImpl = globalThis.fetch,
  sourceUrl = REDDIT_DEV_API_URL,
  userAgent = 'SiteForgeRedditApiCatalog/0.1',
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const sourceHtml = html !== null && html !== undefined
    ? String(html)
    : sourcePath
      ? await readTextFile(path.resolve(String(sourcePath)))
      : await fetchRedditOfficialApiHtml({ fetchImpl, sourceUrl, userAgent });
  return parseRedditOfficialApiCatalog(sourceHtml, { generatedAt, sourceUrl });
}

export function findRedditApiOperation(catalog, {
  id = null,
  anchorId = null,
  method = null,
  pathTemplate = null,
} = /** @type {any} */ ({})) {
  const operations = Array.isArray(catalog?.operations) ? catalog.operations : [];
  const wantedId = String(id ?? '').trim();
  const wantedAnchor = String(anchorId ?? '').trim();
  const wantedMethod = String(method ?? '').trim().toUpperCase();
  const wantedPath = String(pathTemplate ?? '').trim();
  return operations.find((operation) => (
    (wantedId && operation.id === wantedId)
    || (wantedAnchor && operation.anchorId === wantedAnchor)
    || (wantedPath && operation.pathTemplate === wantedPath && (!wantedMethod || operation.method === wantedMethod))
  )) ?? null;
}

export function buildRedditApiEndpointUrl(operation, {
  pathParams = /** @type {any} */ ({}),
  query = /** @type {any} */ ({}),
  templateIndex = 0,
} = /** @type {any} */ ({})) {
  const templates = Array.isArray(operation?.oauthEndpointTemplates) && operation.oauthEndpointTemplates.length
    ? operation.oauthEndpointTemplates
    : [operation?.oauthEndpointTemplate].filter(Boolean);
  const template = templates[Math.max(0, Math.min(Number(templateIndex) || 0, templates.length - 1))];
  if (!template) {
    throw new Error('Reddit API operation has no OAuth endpoint template');
  }
  let endpoint = template;
  for (const param of operation.parameters ?? []) {
    if (param.location !== 'path') {
      continue;
    }
    const value = pathParams[param.name];
    if ((value === null || value === undefined || String(value).trim() === '') && param.required) {
      throw new Error(`Missing required Reddit API path parameter ${param.name}`);
    }
    endpoint = endpoint.replace(new RegExp(`\\{${param.name}\\}`, 'gu'), encodeURIComponent(String(value ?? '')));
  }
  if (/\{[A-Za-z_][A-Za-z0-9_]*\}/u.test(endpoint)) {
    throw new Error('Reddit API endpoint still contains unresolved path parameters');
  }
  const parsed = new URL(endpoint);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || String(value).trim() === '') {
      continue;
    }
    parsed.searchParams.set(key, String(value));
  }
  return parsed.toString();
}

export function buildRedditApiRequestPlan(operation, {
  pathParams = /** @type {any} */ ({}),
  query = /** @type {any} */ ({}),
  templateIndex = 0,
} = /** @type {any} */ ({})) {
  const method = String(operation?.method ?? '').toUpperCase();
  const endpoint = method === 'GET'
    ? buildRedditApiEndpointUrl(operation, { pathParams, query, templateIndex })
    : operation?.oauthEndpointTemplate ?? null;
  const plan = {
    schemaVersion: 1,
    artifactFamily: 'reddit-api-request-plan',
    operationId: operation?.id ?? null,
    anchorId: operation?.anchorId ?? null,
    method,
    pathTemplate: operation?.pathTemplate ?? null,
    endpoint,
    oauthScopes: operation?.oauthScopes ?? [],
    safety: operation?.safety ?? null,
    mode: method === 'GET' ? 'read_only' : 'write_disabled',
    executable: method === 'GET',
    blockedReason: method === 'GET' ? null : 'write_method_disabled_by_default',
    authBoundary: 'oauth_bearer_token_required',
    responseMaterial: 'sanitized_summary_only',
    persistResponseBody: false,
    persistAuthorization: false,
    persistCookies: false,
  };
  assertNoForbiddenPatterns(plan);
  return plan;
}

function requiredPathParameters(operation) {
  return asArray(operation?.parameters)
    .filter((param) => param?.location === 'path' && param.required !== false)
    .map((param) => param.name)
    .filter(Boolean)
    .sort();
}

function buildReadRuntimePlan(operation, {
  endpoint = buildRedditApiEndpointUrl(operation),
  missingPathParameters = [],
} = /** @type {any} */ ({})) {
  return {
    id: `reddit-runtime-plan:${operation.id}`,
    operationId: operation.id,
    anchorId: operation.anchorId,
    capabilityId: `reddit-api:${operation.id}`,
    method: 'GET',
    mode: 'limited_read',
    autoExecute: false,
    requiresConfirmation: false,
    limitedOutputOnly: true,
    responseMaterial: 'sanitized_summary_only',
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    authBoundary: 'oauth_bearer_token_required',
    tokenEnvVars: REDDIT_TOKEN_ENV_VARS,
    userAgentEnvVars: REDDIT_USER_AGENT_ENV_VARS,
    runtimePathParameters: missingPathParameters,
    steps: [{
      kind: 'api_request',
      method: 'GET',
      endpoint,
      endpointTemplate: endpoint,
      runtimePathParameters: missingPathParameters,
      requiresRuntimeParams: missingPathParameters.length > 0,
      authBoundary: 'oauth_bearer_token_required',
      mode: 'limited_read',
      autoExecute: false,
      requiresConfirmation: false,
      responseMaterial: 'sanitized_summary_only',
      runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
      tokenEnvVars: REDDIT_TOKEN_ENV_VARS,
      userAgentEnvVars: REDDIT_USER_AGENT_ENV_VARS,
      persistResponseBody: false,
      persistAuthorization: false,
      persistCookies: false,
    }],
  };
}

export function buildRedditRuntimePlanIndex(catalog, {
  generatedAt = new Date().toISOString(),
  registeredRuntimePlanCount = 0,
} = /** @type {any} */ ({})) {
  const operations = asArray(catalog?.operations);
  const readOperations = operations.filter((operation) => operation.method === 'GET');
  const plans = readOperations.map((operation) => {
    const missingPathParameters = requiredPathParameters(operation);
    const executionPlan = buildReadRuntimePlan(operation, {
      endpoint: missingPathParameters.length > 0
        ? operation.oauthEndpointTemplates[0]
        : buildRedditApiEndpointUrl(operation),
      missingPathParameters,
    });
    return {
      operationId: operation.id,
      anchorId: operation.anchorId,
      method: operation.method,
      pathTemplate: operation.pathTemplate,
      endpoint: executionPlan.steps[0].endpoint,
      endpointTemplates: operation.oauthEndpointTemplates,
      oauthScopes: operation.oauthScopes,
      runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
      authBoundary: 'oauth_bearer_token_required',
      responseMaterial: 'sanitized_summary_only',
      status: missingPathParameters.length > 0
        ? 'runtime_plan_ready_requires_path_parameters'
        : 'runtime_plan_ready',
      missingPathParameters,
      executionPlan,
    };
  });
  const index = {
    schemaVersion: 1,
    artifactFamily: 'reddit-oauth-api-runtime-plan-index',
    generatedAt,
    sourceReferences: catalog?.sourceReferences ?? [REDDIT_DEV_API_URL],
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    authBoundary: 'oauth_bearer_token_required',
    tokenEnvVars: REDDIT_TOKEN_ENV_VARS,
    userAgentEnvVars: REDDIT_USER_AGENT_ENV_VARS,
    responseMaterial: 'sanitized_summary_only',
    persistResponseBody: false,
    persistAuthorization: false,
    persistCookies: false,
    summary: {
      readTemplateCount: readOperations.length,
      concreteRuntimePlanCount: plans.filter((plan) => plan.status === 'runtime_plan_ready').length,
      parameterizedRuntimeTemplateCount: plans.filter((plan) => plan.status === 'runtime_plan_ready_requires_path_parameters').length,
      writeTemplatesDisabled: operations.filter((operation) => operation.method !== 'GET').length,
      registeredInCurrentSiteForgeRuntime: Math.max(0, Number(registeredRuntimePlanCount) || 0),
    },
    plans,
  };
  assertNoForbiddenPatterns(index);
  return index;
}

function safeHeaderValue(headers, name) {
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === wanted) {
      return Array.isArray(value) ? value.join(', ') : String(value ?? '');
    }
  }
  return null;
}

function summarizeBody(body) {
  const text = String(body ?? '');
  if (!text.trim()) {
    return { kind: 'empty', textLength: 0 };
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const sample = parsed.find((item) => item && typeof item === 'object' && !Array.isArray(item)) ?? null;
      return {
        kind: 'json_array',
        itemCount: parsed.length,
        sampleKeys: sample ? Object.keys(sample).slice(0, 24).sort() : [],
      };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        kind: 'json_object',
        keys: Object.keys(parsed).slice(0, 40).sort(),
      };
    }
    return { kind: typeof parsed, textLength: text.length };
  } catch {
    return { kind: 'text', textLength: text.length };
  }
}

export function resolveRedditCredentialEnv(env = process.env) {
  const tokenEnv = REDDIT_TOKEN_ENV_VARS.find((name) => String(env[name] ?? '').trim()) ?? null;
  const userAgentEnv = REDDIT_USER_AGENT_ENV_VARS.find((name) => String(env[name] ?? '').trim()) ?? null;
  return {
    tokenEnv,
    token: tokenEnv ? String(env[tokenEnv]).trim() : null,
    userAgentEnv,
    userAgent: userAgentEnv ? String(env[userAgentEnv]).trim() : null,
  };
}

export async function executeRedditApiReadPlan(plan, {
  fetchImpl = globalThis.fetch,
  bearerToken = null,
  userAgent = null,
} = /** @type {any} */ ({})) {
  if (plan?.method !== 'GET' || plan?.executable !== true) {
    return {
      status: 'blocked',
      reasonCode: plan?.blockedReason ?? 'read_only_get_plan_required',
      responseMaterial: 'sanitized_summary_only',
    };
  }
  if (!bearerToken) {
    return {
      status: 'blocked',
      reasonCode: 'reddit_oauth_bearer_token_required',
      responseMaterial: 'sanitized_summary_only',
    };
  }
  if (!userAgent) {
    return {
      status: 'blocked',
      reasonCode: 'reddit_user_agent_required',
      responseMaterial: 'sanitized_summary_only',
    };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required for Reddit API execution');
  }
  const response = await fetchImpl(plan.endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${bearerToken}`,
      'user-agent': userAgent,
      accept: 'application/json',
    },
  });
  const body = await response.text();
  const headers = typeof response.headers?.entries === 'function'
    ? Object.fromEntries(response.headers.entries())
    : {};
  const result = {
    status: response.ok ? 'success' : 'blocked',
    reasonCode: response.ok ? null : `reddit_api_http_${response.status}`,
    operationId: plan.operationId,
    method: plan.method,
    endpoint: plan.endpoint,
    httpStatus: response.status,
    contentType: safeHeaderValue(headers, 'content-type'),
    responseMaterial: 'sanitized_summary_only',
    bodySummary: summarizeBody(body),
    bodyPersisted: false,
    authorizationPersisted: false,
    cookieMaterialPersisted: false,
  };
  assertNoForbiddenPatterns(result);
  return result;
}

const REDDIT_PUBLIC_RUNTIME_PARAMETER_SEEDS = Object.freeze({
  article: 'example',
  conversation_id: 'example',
  location: 'modqueue',
  multipath: 'user/reddit/m/siteforge',
  names: 't3_example',
  page: 'index',
  sort: 'hot',
  srname: 'siteforge',
  srnames: 'siteforge',
  subreddit: 'siteforge',
  thread: 'example',
  update_id: 'example',
  username: 'reddit',
  where: 'subscriber',
});

const REDDIT_PLACEHOLDER_RUNTIME_PARAMETERS = new Set([
  'article',
  'conversation_id',
  'names',
  'thread',
  'update_id',
]);

function endpointSeedPrivacyBoundary(name, pathTemplate) {
  const text = `${name} ${pathTemplate ?? ''}`.toLowerCase();
  if (/message|prefs|mine|saved|hidden|upvoted|downvoted|friends|blocked|\/me\b/u.test(text)) {
    return 'auth_private';
  }
  if (/moderator|modmail|about\/(?:log|spam|reports|modqueue|unmoderated|edited|banned|muted|wikibanned|wikicontributors|wikibanned)|\/about\/(?:edit|traffic|settings)/u.test(text)) {
    return 'moderator_limited';
  }
  if (REDDIT_PLACEHOLDER_RUNTIME_PARAMETERS.has(String(name))) {
    return 'unknown';
  }
  return 'public_read';
}

function endpointSeedPolicy(name, pathTemplate, source) {
  if (source === 'operator_supplied') {
    return 'operator_supplied_runtime_param';
  }
  if (REDDIT_PLACEHOLDER_RUNTIME_PARAMETERS.has(String(name))) {
    return 'placeholder_resolution_only';
  }
  const template = String(pathTemplate ?? '');
  if (name === 'where' || name === 'page' || name === 'location' || name === 'sort') {
    return 'endpoint_specific_synthetic_seed';
  }
  if (template.startsWith('[/r/:subreddit]')) {
    return 'optional_subreddit_global_variant_seed';
  }
  return 'parameter_name_default_seed';
}

function endpointVariantStatus(pathTemplate) {
  return String(pathTemplate ?? '').startsWith('[/r/:subreddit]')
    ? 'global_variant_selected'
    : 'single_endpoint_template';
}

function runtimeParameterSeedValue(name, pathTemplate, parameterSeeds = {}) {
  if (Object.hasOwn(parameterSeeds, name)) {
    return {
      value: parameterSeeds[name],
      source: 'operator_supplied',
      sourceStatus: 'operator_supplied',
      seedConfidence: 'operator_asserted',
      seedPrivacyBoundary: endpointSeedPrivacyBoundary(name, pathTemplate),
      endpointSeedPolicy: endpointSeedPolicy(name, pathTemplate, 'operator_supplied'),
    };
  }
  let value;
  let source = null;
  if (name === 'where') {
    const template = String(pathTemplate ?? '');
    if (template.startsWith('/prefs/')) value = 'messaging';
    if (template.startsWith('/message/')) value = 'inbox';
    if (template.startsWith('/subreddits/mine/')) value = 'subscriber';
    if (template.startsWith('/subreddits/')) value = 'popular';
    if (template.startsWith('/users/')) value = 'popular';
    if (template.includes('/about/')) value = 'moderators';
    if (template.startsWith('/user/')) value = 'submitted';
    if (value !== undefined) {
      source = 'synthetic_public_seed';
    }
  }
  if (value === undefined && Object.hasOwn(REDDIT_PUBLIC_RUNTIME_PARAMETER_SEEDS, name)) {
    value = REDDIT_PUBLIC_RUNTIME_PARAMETER_SEEDS[name];
    source = 'synthetic_public_seed';
  }
  const missing = value === undefined || value === null || String(value).trim() === '';
  const placeholder = REDDIT_PLACEHOLDER_RUNTIME_PARAMETERS.has(String(name));
  return {
    value,
    source,
    sourceStatus: missing ? 'missing' : (placeholder ? 'placeholder_only' : source),
    seedConfidence: missing ? 'missing' : (placeholder ? 'synthetic_placeholder' : 'synthetic_likely'),
    seedPrivacyBoundary: endpointSeedPrivacyBoundary(name, pathTemplate),
    endpointSeedPolicy: missing ? 'missing_runtime_param' : endpointSeedPolicy(name, pathTemplate, source),
  };
}

function sanitizedBatchExecutionResult(execution = {}) {
  return {
    status: execution.status ?? null,
    reasonCode: execution.reasonCode ?? null,
    httpStatus: execution.httpStatus ?? null,
    contentType: execution.contentType ?? null,
    responseMaterial: execution.responseMaterial ?? 'sanitized_summary_only',
    bodySummary: execution.bodySummary ?? null,
    bodyPersisted: execution.bodyPersisted === true,
    authorizationPersisted: execution.authorizationPersisted === true,
    cookieMaterialPersisted: execution.cookieMaterialPersisted === true,
  };
}

function batchStatusFromResults(results, { execute = false, credentials = {} } = /** @type {any} */ ({})) {
  if (!results.length) {
    return 'not_selected';
  }
  const hasCredentialBlockedResult = results.some((result) => (
    result.execution?.status === 'blocked'
    && (
      result.execution?.reasonCode === 'reddit_oauth_bearer_token_required'
      || result.execution?.reasonCode === 'reddit_user_agent_required'
    )
  ));
  if (!credentials.token || !credentials.userAgent) {
    if (hasCredentialBlockedResult) {
      return 'blocked_oauth_or_user_agent_missing';
    }
    if (results.every((result) => result.execution?.status === 'planned')) {
      return 'planned_not_executed';
    }
  }
  if (results.every((result) => result.execution?.status === 'planned')) {
    return 'planned_not_executed';
  }
  if (!execute && !results.some((result) => ['blocked', 'success'].includes(String(result.execution?.status ?? '')))) {
    return 'planned_not_executed';
  }
  if ((!credentials.token || !credentials.userAgent) && hasCredentialBlockedResult) {
    return 'blocked_oauth_or_user_agent_missing';
  }
  if (results.some((result) => result.execution?.status === 'success')) {
    return results.every((result) => result.execution?.status === 'success') ? 'executed_success' : 'executed_partial';
  }
  if (results.some((result) => result.execution?.status === 'blocked')) {
    return 'executed_blocked';
  }
  return 'executed_unknown';
}

const REDDIT_API_BATCH_MODES = new Set([
  'plan',
  'execute-concrete',
  'preflight-parameterized',
  'execute-parameterized',
  'execute-all',
]);

function normalizeRedditApiBatchMode({ batchMode = null, execute = false, includeParameterized = false } = /** @type {any} */ ({})) {
  const mode = String(batchMode ?? '').trim().toLowerCase();
  if (mode) {
    if (!REDDIT_API_BATCH_MODES.has(mode)) {
      throw new Error(`Unsupported Reddit API batch mode ${JSON.stringify(batchMode)}.`);
    }
    return mode;
  }
  if (execute) {
    return 'execute-concrete';
  }
  if (includeParameterized) {
    return 'preflight-parameterized';
  }
  return 'plan';
}

function shouldSelectRedditApiBatchPlan(plan, batchMode, includeParameterized) {
  const parameterized = asArray(plan?.missingPathParameters).length > 0;
  if (!parameterized) {
    return batchMode !== 'execute-parameterized';
  }
  return includeParameterized === true
    || batchMode === 'preflight-parameterized'
    || batchMode === 'execute-parameterized'
    || batchMode === 'execute-all';
}

function shouldExecuteRedditApiBatchPlan(plan, batchMode) {
  const parameterized = asArray(plan?.missingPathParameters).length > 0;
  if (parameterized) {
    return batchMode === 'execute-parameterized' || batchMode === 'execute-all';
  }
  return batchMode === 'execute-concrete' || batchMode === 'execute-all';
}

function batchResultCounts(results) {
  const blockedResults = results.filter((result) => result.execution?.status === 'blocked');
  const successResults = results.filter((result) => result.execution?.status === 'success');
  const networkAttemptResults = results.filter((result) => (
    result.execution?.httpStatus !== null
    && result.execution?.httpStatus !== undefined
    && Number.isFinite(Number(result.execution.httpStatus))
  ));
  return {
    selected: results.length,
    planned: results.filter((result) => result.execution?.status === 'planned').length,
    executed: networkAttemptResults.length,
    success: successResults.length,
    blocked: blockedResults.length,
    missingCredentialBlocked: blockedResults.filter((result) => (
      result.execution?.reasonCode === 'reddit_oauth_bearer_token_required'
      || result.execution?.reasonCode === 'reddit_user_agent_required'
    )).length,
    parameterSeedMissing: results.filter((result) => result.parameterSeedStatus === 'missing').length,
  };
}

export async function buildRedditApiReadBatchReport(catalog, {
  runtimeIndex = null,
  fetchImpl = globalThis.fetch,
  env = process.env,
  execute = false,
  includeParameterized = false,
  batchMode = null,
  limit = null,
  parameterSeeds = /** @type {any} */ ({}),
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const index = runtimeIndex ?? buildRedditRuntimePlanIndex(catalog);
  const operations = new Map(asArray(catalog?.operations).map((operation) => [operation.id, operation]));
  const credentials = resolveRedditCredentialEnv(env);
  const normalizedBatchMode = normalizeRedditApiBatchMode({ batchMode, execute, includeParameterized });
  const cleanParameterSeeds = Object.fromEntries(Object.entries(parameterSeeds ?? {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''));
  const maxPlans = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : Infinity;
  const eligiblePlans = asArray(index?.plans)
    .filter((plan) => [
      'runtime_plan_ready',
      'runtime_plan_ready_requires_path_parameters',
    ].includes(String(plan?.status ?? '')) && shouldSelectRedditApiBatchPlan(plan, normalizedBatchMode, includeParameterized))
    .slice(0, maxPlans);
  const results = [];
  for (const plan of eligiblePlans) {
    const operation = operations.get(plan.operationId);
    const parameterNames = asArray(plan.missingPathParameters);
    const resolvedSeeds = Object.fromEntries(parameterNames.map((name) => [name, runtimeParameterSeedValue(name, plan.pathTemplate, cleanParameterSeeds)]));
    const missingSeedNames = parameterNames.filter((name) => (
      resolvedSeeds[name]?.value === null
      || resolvedSeeds[name]?.value === undefined
      || String(resolvedSeeds[name]?.value).trim() === ''
    ));
    const base = {
      operationId: plan.operationId,
      anchorId: plan.anchorId,
      method: plan.method,
      pathTemplate: plan.pathTemplate,
      runtimeMode: plan.runtimeMode,
      status: plan.status,
      parameterized: parameterNames.length > 0,
      parameterNames,
      parameterSeedStatus: parameterNames.length === 0 ? 'not_required' : (missingSeedNames.length > 0 ? 'missing' : 'provided'),
      missingSeedNames,
      providedParameterNames: parameterNames.filter((name) => !missingSeedNames.includes(name)),
      parameterSeedSources: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name]?.source ?? null])),
      parameterSeedSourceStatus: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name]?.sourceStatus ?? null])),
      seedConfidence: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name]?.seedConfidence ?? null])),
      seedPrivacyBoundary: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name]?.seedPrivacyBoundary ?? null])),
      endpointSeedPolicy: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name]?.endpointSeedPolicy ?? null])),
      endpointVariantStatus: endpointVariantStatus(plan.pathTemplate),
      selectedEndpointTemplateIndex: 0,
      resolvedEndpointHost: 'oauth.reddit.com',
      resolvedPathTemplate: plan.pathTemplate,
      runtimeParamValuePersisted: false,
      seedValuePersisted: false,
      parameterBindingsSummary: parameterNames.map((name) => ({
        name,
        source: resolvedSeeds[name]?.source ?? null,
        sourceStatus: resolvedSeeds[name]?.sourceStatus ?? null,
        seedConfidence: resolvedSeeds[name]?.seedConfidence ?? null,
        seedPrivacyBoundary: resolvedSeeds[name]?.seedPrivacyBoundary ?? null,
        endpointSeedPolicy: resolvedSeeds[name]?.endpointSeedPolicy ?? null,
        valuePersisted: false,
      })),
      endpointTemplate: plan.endpoint,
      responseMaterial: 'sanitized_summary_only',
    };
    if (!operation) {
      results.push({
        ...base,
        execution: {
          status: 'blocked',
          reasonCode: 'reddit_operation_missing_for_runtime_plan',
          responseMaterial: 'sanitized_summary_only',
        },
      });
      continue;
    }
    if (missingSeedNames.length > 0) {
      results.push({
        ...base,
        execution: {
          status: 'blocked',
          reasonCode: 'reddit_runtime_path_parameters_required',
          responseMaterial: 'sanitized_summary_only',
        },
      });
      continue;
    }
    let requestPlan;
    try {
      requestPlan = buildRedditApiRequestPlan(operation, {
        pathParams: Object.fromEntries(parameterNames.map((name) => [name, resolvedSeeds[name].value])),
      });
    } catch (error) {
      results.push({
        ...base,
        execution: {
          status: 'blocked',
          reasonCode: 'reddit_batch_plan_resolution_failed',
          errorSummary: error?.message ?? String(error),
          responseMaterial: 'sanitized_summary_only',
        },
      });
      continue;
    }
    const shouldExecutePlan = shouldExecuteRedditApiBatchPlan(plan, normalizedBatchMode);
    if (!shouldExecutePlan) {
      results.push({
        ...base,
        execution: {
          status: 'planned',
          reasonCode: parameterNames.length > 0 && execute === true
            ? 'reddit_parameterized_execution_requires_explicit_batch_mode'
            : (credentials.token && credentials.userAgent ? 'execute_flag_required' : 'reddit_oauth_or_user_agent_required'),
          responseMaterial: 'sanitized_summary_only',
        },
      });
      continue;
    }
    const execution = await executeRedditApiReadPlan(requestPlan, {
      fetchImpl,
      bearerToken: credentials.token,
      userAgent: credentials.userAgent,
    });
    results.push({
      ...base,
      execution: sanitizedBatchExecutionResult(execution),
    });
  }
  const concreteResults = results.filter((result) => !result.parameterized);
  const parameterizedResults = results.filter((result) => result.parameterized);
  const totalCounts = batchResultCounts(results);
  const concreteCounts = batchResultCounts(concreteResults);
  const parameterizedCounts = batchResultCounts(parameterizedResults);
  const parameterizedBindings = parameterizedResults.flatMap((result) => asArray(result.parameterBindingsSummary));
  const parameterizedPlanOnlyResults = parameterizedResults.filter((result) => (
    asArray(result.parameterBindingsSummary).some((binding) => ['missing', 'placeholder_only'].includes(String(binding.sourceStatus ?? '')))
  ));
  const parameterizedLiveExecutableResults = parameterizedResults.filter((result) => (
    result.parameterSeedStatus === 'provided'
    && !asArray(result.parameterBindingsSummary).some((binding) => ['missing', 'placeholder_only'].includes(String(binding.sourceStatus ?? '')))
  ));
  const report = {
    schemaVersion: 1,
    artifactFamily: 'reddit-api-read-batch-report',
    generatedAt,
    sourceReferences: catalog?.sourceReferences ?? [REDDIT_DEV_API_URL],
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    mode: normalizedBatchMode,
    legacyExecuteFlag: execute === true,
    responseMaterial: 'sanitized_summary_only',
    persistResponseBody: false,
    persistAuthorization: false,
    persistCookies: false,
    credentialSource: {
      tokenEnv: credentials.tokenEnv,
      userAgentEnv: credentials.userAgentEnv,
      tokenProvided: Boolean(credentials.token),
      userAgentProvided: Boolean(credentials.userAgent),
      tokenPersisted: false,
      userAgentPersisted: false,
    },
    parameterSeedSummary: {
      includeParameterized: includeParameterized === true,
      providedParameterNames: uniqueSorted(results.flatMap((result) => result.providedParameterNames)),
      customParameterNames: Object.keys(cleanParameterSeeds).sort(),
      sourceStatusValues: uniqueSorted(results.flatMap((result) => Object.values(result.parameterSeedSourceStatus ?? {}))),
      seedConfidenceValues: uniqueSorted(results.flatMap((result) => Object.values(result.seedConfidence ?? {}))),
      seedPrivacyBoundaryValues: uniqueSorted(results.flatMap((result) => Object.values(result.seedPrivacyBoundary ?? {}))),
      endpointSeedPolicyValues: uniqueSorted(results.flatMap((result) => Object.values(result.endpointSeedPolicy ?? {}))),
      valuesPersisted: false,
    },
    summary: {
      totalRuntimePlans: asArray(index?.plans).length,
      concreteRuntimePlanCount: Number(index?.summary?.concreteRuntimePlanCount ?? 0) || 0,
      parameterizedRuntimeTemplateCount: Number(index?.summary?.parameterizedRuntimeTemplateCount ?? 0) || 0,
      selectedPlanCount: results.length,
      selectedConcretePlanCount: concreteResults.length,
      selectedParameterizedPlanCount: parameterizedResults.length,
      plannedCount: totalCounts.planned,
      executedCount: totalCounts.executed,
      successCount: totalCounts.success,
      blockedCount: totalCounts.blocked,
      missingCredentialBlockedCount: totalCounts.missingCredentialBlocked,
      parameterSeedMissingCount: totalCounts.parameterSeedMissing,
      concretePlannedCount: concreteCounts.planned,
      concreteExecutedCount: concreteCounts.executed,
      concreteSuccessCount: concreteCounts.success,
      concreteBlockedCount: concreteCounts.blocked,
      concreteMissingCredentialBlockedCount: concreteCounts.missingCredentialBlocked,
      parameterizedPlannedCount: parameterizedCounts.planned,
      parameterizedExecutedCount: parameterizedCounts.executed,
      parameterizedSuccessCount: parameterizedCounts.success,
      parameterizedBlockedCount: parameterizedCounts.blocked,
      parameterizedMissingCredentialBlockedCount: parameterizedCounts.missingCredentialBlocked,
      parameterizedSeedMissingCount: parameterizedCounts.parameterSeedMissing,
      parameterizedSeedSourceStatusCounts: countBy(parameterizedBindings, (binding) => binding.sourceStatus ?? 'unknown'),
      parameterizedSeedConfidenceCounts: countBy(parameterizedBindings, (binding) => binding.seedConfidence ?? 'unknown'),
      parameterizedPrivacyBoundaryCounts: countBy(parameterizedBindings, (binding) => binding.seedPrivacyBoundary ?? 'unknown'),
      parameterizedPlaceholderOnlyCount: parameterizedBindings.filter((binding) => binding.sourceStatus === 'placeholder_only').length,
      parameterizedPlanOnlyCount: parameterizedPlanOnlyResults.length,
      parameterizedLiveExecutableCount: parameterizedLiveExecutableResults.length,
    },
    status: {
      batchMode: normalizedBatchMode,
      apiBatchReadExecution: batchStatusFromResults(results, { execute, credentials }),
      concreteBatchReadExecution: batchStatusFromResults(concreteResults, { execute, credentials }),
      parameterizedBatchReadExecution: includeParameterized === true
        ? batchStatusFromResults(parameterizedResults, { execute, credentials })
        : 'not_selected',
      oauthCredentialInput: credentials.token && credentials.userAgent ? 'provided' : 'missing',
      parameterizedTemplateCoverage: includeParameterized === true && parameterizedResults.length > 0
        ? (parameterizedCounts.parameterSeedMissing > 0 ? 'missing_runtime_parameter_seeds' : 'seeded_for_plan_resolution')
        : 'not_selected',
      writeAndMutationActions: 'not_selected_disabled_by_default',
    },
    results,
  };
  assertNoForbiddenPatterns(report);
  return report;
}

function operationCoverageStatus(operation) {
  return operation?.method === 'GET'
    ? 'site_action_read_template_ready_needs_oauth'
    : 'write_or_state_change_disabled_by_default';
}

function operationCoverageMode(operation) {
  return operation?.method === 'GET' ? 'read_only_oauth_api' : 'record_only_write_disabled';
}

function summarizeAuthorizedSourceManifest(manifest = /** @type {any} */ ({})) {
  const pages = asArray(manifest?.pages);
  const links = [];
  const forms = [];
  const controls = [];
  const routeTemplates = [];
  for (const page of pages) {
    if (page?.routeTemplate) {
      routeTemplates.push(page.routeTemplate);
    }
    for (const routeTemplate of asArray(page?.routeTemplates)) {
      routeTemplates.push(routeTemplate);
    }
    for (const link of asArray(page?.links)) {
      const href = link?.normalizedHref ?? link?.href;
      if (href) {
        links.push({
          href,
          label: link?.label ?? null,
          semanticKind: link?.semanticKind ?? null,
          routeTemplate: link?.routeTemplate ?? null,
          sourcePage: page?.routeTemplate ?? page?.routePath ?? null,
        });
      }
      if (link?.routeTemplate) {
        routeTemplates.push(link.routeTemplate);
      }
    }
    for (const form of asArray(page?.forms)) {
      const action = form?.action ?? null;
      forms.push({
        action,
        method: String(form?.method ?? 'GET').toUpperCase(),
        label: form?.label ?? null,
        inputNames: asArray(form?.inputs).map((input) => input?.name).filter(Boolean).sort(),
        sourcePage: page?.routeTemplate ?? page?.routePath ?? null,
      });
      if (action) {
        try {
          routeTemplates.push(new URL(action).pathname);
        } catch {
          // Keep malformed synthetic actions out of route-template summaries.
        }
      }
    }
    for (const control of asArray(page?.controls)) {
      controls.push({
        kind: control?.kind ?? null,
        label: control?.label ?? null,
        name: control?.name ?? null,
        sourcePage: page?.routeTemplate ?? page?.routePath ?? null,
      });
    }
  }
  const uniqueLinks = Array.from(new Map(links.map((link) => [link.href, link])).values())
    .sort((left, right) => String(left.href).localeCompare(String(right.href)));
  const uniqueForms = Array.from(new Map(forms.map((form) => [
    `${form.method} ${form.action ?? ''} ${form.inputNames.join(',')}`,
    form,
  ])).values())
    .sort((left, right) => `${left.method} ${left.action ?? ''}`.localeCompare(`${right.method} ${right.action ?? ''}`));
  const uniqueControls = Array.from(new Map(controls.map((control) => [
    `${control.kind ?? ''} ${control.name ?? ''} ${control.label ?? ''}`,
    control,
  ])).values())
    .sort((left, right) => `${left.kind ?? ''} ${left.name ?? ''}`.localeCompare(`${right.kind ?? ''} ${right.name ?? ''}`));

  return {
    sourcePresent: pages.length > 0,
    pageCount: pages.length,
    pageTypes: countBy(pages, (page) => page?.pageType ?? 'unknown'),
    uniqueLinkCount: uniqueLinks.length,
    uniqueFormCount: uniqueForms.length,
    uniqueControlCount: uniqueControls.length,
    uniqueRouteTemplateCount: uniqueSorted(routeTemplates).length,
    routeTemplates: uniqueSorted(routeTemplates),
    links: uniqueLinks,
    forms: uniqueForms,
    controls: uniqueControls,
  };
}

export function buildRedditCoverageAudit(catalog, {
  authorizedSourceManifest = null,
  buildReport = null,
  robots = /** @type {any} */ ({}),
  registeredRuntimePlanCount = null,
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const operations = asArray(catalog?.operations);
  const readOperations = operations.filter((operation) => operation.method === 'GET');
  const writeOperations = operations.filter((operation) => operation.method !== 'GET');
  const sourceSummary = summarizeAuthorizedSourceManifest(authorizedSourceManifest);
  const registeredApiRequestPlans = Number(registeredRuntimePlanCount ?? catalog?.executableSummary?.registeredInCurrentSiteForgeRuntime ?? 0);
  const oauthRuntimeStatus = registeredApiRequestPlans > 0
    ? (registeredApiRequestPlans >= readOperations.length ? 'registered' : 'registered_partial_runtime_templates_remaining')
    : (readOperations.length > 0 ? 'runtime_ready_needs_registry_binding' : 'missing');
  const disallowAll = robots?.disallowAllForGenericUserAgent === true;
  const audit = {
    schemaVersion: 1,
    artifactFamily: 'reddit-link-function-api-coverage-audit',
    generatedAt,
    sourceReferences: catalog?.sourceReferences ?? [REDDIT_DEV_API_URL],
    collectionMode: 'official_docs_sanitized_structure_plus_optional_siteforge_artifacts',
    cookieUsed: false,
    cookiePersisted: false,
    rawHtmlPersisted: false,
    summary: {
      apiOperations: operations.length,
      apiMethodCounts: catalog?.methodCounts ?? {},
      oauthEndpointTemplates: catalog?.templateExpansionSummary?.oauthEndpointTemplateCount ?? 0,
      apiReadTemplatesExecutableWithOauth: readOperations.length,
      runtimeReadyApiRequestPlans: Number(catalog?.executableSummary?.runtimeReadyApiRequestPlans ?? readOperations.length),
      apiWriteTemplatesDisabled: writeOperations.length,
      registeredApiRequestPlans,
      authorizedSourcePages: sourceSummary.pageCount,
      authorizedSourceUniqueLinks: sourceSummary.uniqueLinkCount,
      authorizedSourceRouteTemplates: sourceSummary.uniqueRouteTemplateCount,
      authorizedSourceForms: sourceSummary.uniqueFormCount,
      authorizedSourceControls: sourceSummary.uniqueControlCount,
      buildGraphNodeCount: Number(buildReport?.counts?.nodes_total ?? buildReport?.discovered_nodes_summary?.total ?? 0) || null,
      buildActionableElementCount: Number(buildReport?.counts?.actionable_elements ?? buildReport?.discovered_nodes_summary?.actionable_elements ?? 0) || null,
      buildCapabilityCount: Number(buildReport?.counts?.capabilities_total ?? buildReport?.capability_summary?.total ?? 0) || null,
      buildIntentCount: Number(buildReport?.counts?.intents_total ?? buildReport?.capability_summary?.intents_total ?? 0) || null,
    },
    status: {
      genericLiveCrawl: disallowAll ? 'blocked_by_robots' : 'not_verified_in_this_audit',
      cookieBrowserBridgeCrawl: 'not_used_for_coverage_audit',
      officialApiCatalog: operations.length > 0 ? 'covered_from_official_docs' : 'missing',
      siteActionApiReadRuntime: readOperations.length > 0 ? 'template_ready_needs_oauth' : 'missing',
      siteforgeOauthApiRequestRuntime: oauthRuntimeStatus,
      siteforgeGenericApiRequestRuntime: registeredApiRequestPlans > 0 ? oauthRuntimeStatus : 'not_registered',
      writeAndMutationActions: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
    },
    requirementAudit: [
      {
        requirement: 'Enumerate official Reddit API endpoints',
        status: operations.length > 0 ? 'covered_from_official_docs' : 'missing',
        evidenceCount: operations.length,
        evidence: 'Reddit /dev/api endpoint blocks parsed into sanitized operation records.',
      },
      {
        requirement: 'Identify executable read API templates',
        status: readOperations.length > 0 ? 'template_ready_needs_oauth' : 'missing',
        evidenceCount: readOperations.length,
        evidence: 'GET operations are convertible to oauth.reddit.com request plans and require operator-supplied OAuth bearer token plus User-Agent.',
      },
      {
        requirement: 'Keep write/state-changing functions non-auto-executable',
        status: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
        evidenceCount: writeOperations.length,
        evidence: 'Non-GET operations are retained for coverage but marked write_disabled by default.',
      },
      {
        requirement: 'Enumerate Reddit link and route surfaces from authorized structure',
        status: sourceSummary.sourcePresent ? 'covered_from_authorized_source_manifest' : 'missing_authorized_source_manifest',
        evidenceCount: sourceSummary.uniqueRouteTemplateCount,
        evidence: 'Optional SiteForge authorized_source_manifest route/link/form/control summaries.',
      },
      {
        requirement: 'Generic live crawl all reddit.com links',
        status: disallowAll ? 'blocked_by_robots' : 'not_verified_in_this_audit',
        evidenceCount: disallowAll ? 1 : 0,
        evidence: disallowAll ? 'Current robots policy disallows generic User-agent * crawl of /.' : 'No current robots evidence was supplied to this audit.',
      },
      {
        requirement: 'Register executable api_request plans in generic SiteForge runtime',
        status: registeredApiRequestPlans > 0 ? oauthRuntimeStatus : 'not_registered',
        evidenceCount: registeredApiRequestPlans,
        evidence: registeredApiRequestPlans > 0
          ? 'Catalog reports registered api_request runtime plans.'
          : 'Read templates are exposed through reddit-action, but generic api_request runtime registration is still zero.',
      },
      {
        requirement: 'Expose Reddit OAuth read templates through api_request runtime boundary',
        status: oauthRuntimeStatus,
        evidenceCount: registeredApiRequestPlans || readOperations.length,
        evidence: registeredApiRequestPlans > 0
          ? 'Reddit OAuth GET templates are registered; parameterized endpoints require explicit runtime path parameters before execution.'
          : 'GET templates can use the reddit_oauth_read_runtime boundary once a registry execution plan binds the oauth.reddit.com endpoint.',
      },
    ],
    apiOperationCoverage: operations.map((operation) => ({
      id: operation.id,
      anchorId: operation.anchorId,
      method: operation.method,
      pathTemplate: operation.pathTemplate,
      section: operation.section,
      oauthScopes: operation.oauthScopes,
      endpointTemplates: operation.oauthEndpointTemplates,
      safety: operation.safety,
      coverageStatus: operationCoverageStatus(operation),
      executionMode: operationCoverageMode(operation),
      blockedReason: operation.method === 'GET' ? 'oauth_token_and_user_agent_required' : 'write_method_disabled_by_default',
    })),
    authorizedSourceCoverage: {
      pageTypes: sourceSummary.pageTypes,
      routeTemplates: sourceSummary.routeTemplates,
      links: sourceSummary.links,
      forms: sourceSummary.forms,
      controls: sourceSummary.controls,
    },
  };
  assertNoForbiddenPatterns(audit);
  return audit;
}

function summarizeRedditBuildReport(report = /** @type {any} */ ({})) {
  if (!report) {
    return null;
  }
  const userReport = report.user && typeof report.user === 'object' ? report.user : report;
  const coverage = userReport.coverage ?? report.coverage ?? userReport.summary?.coverage ?? report.summary?.coverage ?? {};
  const counts = userReport.counts ?? report.counts ?? {};
  const summary = userReport.summary ?? report.summary ?? {};
  const authSummary = userReport.auth_summary ?? report.auth_summary ?? summary.auth ?? {};
  const authStateReport = userReport.authStateReport ?? report.authStateReport ?? {};
  const browserBridge = authSummary.browserBridge ?? coverage.browserBridge ?? authStateReport.browserBridge ?? {};
  return {
    status: userReport.status ?? userReport.result_status ?? userReport.resultStatus ?? null,
    resultStatus: userReport.result_status ?? userReport.resultStatus ?? null,
    reasonCode: userReport.reasonCode ?? userReport.reason_code ?? summary.verificationReasonCode ?? null,
    reason: userReport.reason ?? null,
    authMethod: userReport.authMethod ?? authSummary.authMethod ?? coverage.authMethod ?? authStateReport.authMethod ?? null,
    authVerificationStatus: userReport.authVerificationStatus ?? authSummary.authVerificationStatus ?? coverage.authVerificationStatus ?? authStateReport.authVerificationStatus ?? null,
    blockingSignals: uniqueSorted([
      ...asArray(userReport.blockingSignals),
      ...asArray(authSummary.blockingSignals),
      ...asArray(authStateReport.blockingSignals),
    ]),
    positiveSignals: uniqueSorted([
      ...asArray(userReport.positiveSignals),
      ...asArray(authSummary.positiveSignals),
      ...asArray(authStateReport.positiveSignals),
    ]),
    cookieInput: authSummary.cookieInput ?? authStateReport.cookieInput ?? null,
    graph: {
      nodes: Number(counts.nodes_total ?? summary.nodes ?? 0) || 0,
      actionableElements: Number(counts.actionable_elements ?? summary.affordances ?? 0) || 0,
      capabilities: Number(counts.capabilities_total ?? summary.activeCapabilities ?? summary.capabilities?.active ?? 0) || 0,
      intents: Number(counts.intents_total ?? summary.intents ?? 0) || 0,
    },
    coverage: {
      publicPages: Number(coverage.public?.pages ?? 0) || 0,
      authorizedSourcePages: Number(coverage.authorizedSource?.pages ?? 0) || 0,
      authorizedSourceNodes: Number(coverage.authorizedSource?.nodes ?? 0) || 0,
      authorizedSourceCapabilities: Number(coverage.authorizedSource?.capabilities ?? 0) || 0,
      authenticatedPages: Number(coverage.authenticated?.pages ?? 0) || 0,
      overlayPagesRevisited: Number(coverage.overlay?.pagesRevisited ?? 0) || 0,
      browserBridgeUsed: browserBridge.used === true,
      browserBridgePageCount: Number(browserBridge.pageCount ?? 0) || 0,
      browserBridgeRouteCount: Number(browserBridge.routeCount ?? 0) || 0,
      browserBridgeCapturedRouteCount: Number(browserBridge.capturedRouteCount ?? 0) || 0,
      browserBridgeMissingRouteCount: Number(browserBridge.missingRouteCount ?? 0) || 0,
      browserBridgeRouteCoverageStatus: browserBridge.routeCoverageStatus ?? null,
      providers: coverage.providers ?? null,
      runtime: coverage.runtime ?? null,
    },
    privacy: {
      rawMaterialPersisted: report.privacy_summary?.rawMaterialPersisted ?? report.authStateReport?.rawMaterialPersisted ?? false,
      cookieMaterialPersisted: report.privacy_summary?.cookieMaterialPersisted ?? report.authStateReport?.cookieMaterialPersisted ?? false,
      browserProfilePersisted: report.privacy_summary?.browserProfilePersisted ?? report.authStateReport?.browserProfilePersisted ?? false,
    },
  };
}

function redditBrowserBuildStatus(build = null) {
  if (!build) {
    return null;
  }
  const authStatus = String(build.authVerificationStatus ?? build.reasonCode ?? build.status ?? '').trim();
  const signals = new Set(build.blockingSignals ?? []);
  const robotsBlocked = build.reasonCode === 'robots-disallowed'
    || signals.has('robots-disallowed')
    || signals.has('browser-bridge-robots-disallowed')
    || signals.has('browser-bridge-all-routes-robots-disallowed');
  if (['browser_verified', 'browser_verified_partial'].includes(authStatus)) {
    return Number(build.coverage?.browserBridgeMissingRouteCount ?? 0) > 0
      ? 'partial_capture'
      : 'captured';
  }
  if (authStatus === 'browser_blocked' && robotsBlocked) {
    return 'blocked_by_robots';
  }
  if (authStatus === 'browser_blocked') {
    return 'blocked';
  }
  if (authStatus === 'cookie_blocked' && robotsBlocked) {
    return 'blocked_by_robots';
  }
  if (authStatus === 'cookie_blocked' || build.reasonCode === 'cookie_blocked') {
    return 'blocked_cookie_not_verified';
  }
  return build.status ?? 'attempted';
}

function summarizeRedditSessionManifest(manifest = /** @type {any} */ ({})) {
  if (!manifest) {
    return null;
  }
  return {
    siteKey: manifest.siteKey ?? null,
    host: manifest.host ?? null,
    purpose: manifest.purpose ?? null,
    status: manifest.status ?? manifest.healthStatus ?? null,
    reason: manifest.reason ?? manifest.health?.reason ?? null,
    authStatus: manifest.health?.authStatus ?? manifest.authStatus ?? null,
    riskCauseCode: manifest.health?.riskCauseCode ?? manifest.riskCauseCode ?? null,
    riskSignals: asArray(manifest.health?.riskSignals ?? manifest.riskSignals),
    sessionRequirement: manifest.plan?.sessionRequirement ?? null,
    profilePathPresent: manifest.plan?.profilePathPresent === true,
    browserProfileRootPresent: manifest.plan?.browserProfileRootPresent === true,
    userDataDirPresent: manifest.plan?.userDataDirPresent === true,
    repairPlan: {
      action: manifest.repairPlan?.action ?? manifest.health?.repairPlan?.action ?? null,
      command: manifest.repairPlan?.command ?? manifest.health?.repairPlan?.command ?? null,
      requiresApproval: manifest.repairPlan?.requiresApproval === true || manifest.health?.repairPlan?.requiresApproval === true,
    },
  };
}

function summarizeRedditDoctorReport(report = /** @type {any} */ ({})) {
  if (!report) {
    return null;
  }
  return {
    profileStatus: report.profile?.status ?? null,
    crawlerStatus: report.crawler?.status ?? null,
    captureStatus: report.capture?.status ?? null,
    captureError: report.capture?.error?.message ?? null,
    adapterRecommendation: report.adapterRecommendation ?? null,
    sessionProvider: report.sessionProvider ?? null,
    sessionReuseWorked: report.sessionReuseWorked === true,
    sessionHealthStatus: report.sessionHealth?.status ?? report.sessionHealth?.healthStatus ?? null,
    sessionHealthReason: report.sessionHealth?.reason ?? null,
    authSession: {
      loginStateDetected: report.authSession?.loginStateDetected === true,
      identityConfirmed: report.authSession?.identityConfirmed === true,
      identitySource: report.authSession?.identitySource ?? null,
      currentUrl: report.authSession?.currentUrl ?? null,
      riskCauseCode: report.authSession?.riskCauseCode ?? null,
      profileQuarantined: report.authSession?.profileQuarantined === true,
    },
    warnings: asArray(report.warnings),
    missingFields: asArray(report.missingFields),
    nextActions: asArray(report.nextActions),
  };
}

function summarizeRedditRegistry(registry = /** @type {any} */ ({})) {
  const oauthSkill = asArray(registry?.skills).find((skill) => skill?.skillId === 'reddit-oauth-api-runtime');
  return {
    skillCount: asArray(registry?.skills).length,
    registeredApiRequestPlans: countRedditRegisteredRuntimePlans(registry),
    oauthSkill: oauthSkill ? {
      skillId: oauthSkill.skillId,
      verificationStatus: oauthSkill.verificationStatus ?? null,
      runtimeModes: asArray(oauthSkill.runtimeModes),
      runtimeSummary: oauthSkill.runtimeSummary ?? null,
      intentCount: asArray(oauthSkill.intents).length,
    } : null,
  };
}

function summarizeRedditApiReadBatchReport(report = /** @type {any} */ ({})) {
  if (!report) {
    return null;
  }
  const summary = report.summary ?? {};
  const credentialSource = report.credentialSource ?? {};
  const selectedConcretePlanCount = Number(summary.selectedConcretePlanCount ?? 0) || 0;
  const selectedParameterizedPlanCount = Number(summary.selectedParameterizedPlanCount ?? 0) || 0;
  const legacyConcreteOnly = selectedParameterizedPlanCount === 0;
  return {
    mode: report.mode ?? null,
    batchMode: report.status?.batchMode ?? report.mode ?? null,
    status: report.status?.apiBatchReadExecution ?? null,
    concreteStatus: report.status?.concreteBatchReadExecution ?? report.status?.apiBatchReadExecution ?? null,
    parameterizedStatus: report.status?.parameterizedBatchReadExecution ?? null,
    oauthCredentialInput: report.status?.oauthCredentialInput ?? null,
    parameterizedTemplateCoverage: report.status?.parameterizedTemplateCoverage ?? null,
    selectedPlanCount: Number(summary.selectedPlanCount ?? 0) || 0,
    selectedConcretePlanCount,
    selectedParameterizedPlanCount,
    plannedCount: Number(summary.plannedCount ?? 0) || 0,
    executedCount: Number(summary.executedCount ?? 0) || 0,
    successCount: Number(summary.successCount ?? 0) || 0,
    blockedCount: Number(summary.blockedCount ?? 0) || 0,
    missingCredentialBlockedCount: Number(summary.missingCredentialBlockedCount ?? 0) || 0,
    parameterSeedMissingCount: Number(summary.parameterSeedMissingCount ?? 0) || 0,
    concretePlannedCount: Number(summary.concretePlannedCount ?? (legacyConcreteOnly ? summary.plannedCount : 0)) || 0,
    concreteExecutedCount: Number(summary.concreteExecutedCount ?? (legacyConcreteOnly ? summary.executedCount : 0)) || 0,
    concreteSuccessCount: Number(summary.concreteSuccessCount ?? (legacyConcreteOnly ? summary.successCount : 0)) || 0,
    concreteBlockedCount: Number(summary.concreteBlockedCount ?? (legacyConcreteOnly ? summary.blockedCount : 0)) || 0,
    concreteMissingCredentialBlockedCount: Number(summary.concreteMissingCredentialBlockedCount ?? (legacyConcreteOnly ? summary.missingCredentialBlockedCount : 0)) || 0,
    parameterizedPlannedCount: Number(summary.parameterizedPlannedCount ?? 0) || 0,
    parameterizedExecutedCount: Number(summary.parameterizedExecutedCount ?? 0) || 0,
    parameterizedSuccessCount: Number(summary.parameterizedSuccessCount ?? 0) || 0,
    parameterizedBlockedCount: Number(summary.parameterizedBlockedCount ?? 0) || 0,
    parameterizedMissingCredentialBlockedCount: Number(summary.parameterizedMissingCredentialBlockedCount ?? 0) || 0,
    parameterizedSeedMissingCount: Number(summary.parameterizedSeedMissingCount ?? summary.parameterSeedMissingCount ?? 0) || 0,
    parameterizedSeedSourceStatusCounts: summary.parameterizedSeedSourceStatusCounts ?? {},
    parameterizedSeedConfidenceCounts: summary.parameterizedSeedConfidenceCounts ?? {},
    parameterizedPrivacyBoundaryCounts: summary.parameterizedPrivacyBoundaryCounts ?? {},
    parameterizedPlaceholderOnlyCount: Number(summary.parameterizedPlaceholderOnlyCount ?? 0) || 0,
    parameterizedPlanOnlyCount: Number(summary.parameterizedPlanOnlyCount ?? 0) || 0,
    parameterizedLiveExecutableCount: Number(summary.parameterizedLiveExecutableCount ?? 0) || 0,
    tokenProvided: credentialSource.tokenProvided === true,
    userAgentProvided: credentialSource.userAgentProvided === true,
    tokenPersisted: credentialSource.tokenPersisted === true,
    userAgentPersisted: credentialSource.userAgentPersisted === true,
    responseBodyPersisted: asArray(report.results).some((result) => result.execution?.bodyPersisted === true),
    authorizationPersisted: asArray(report.results).some((result) => result.execution?.authorizationPersisted === true),
    cookieMaterialPersisted: asArray(report.results).some((result) => result.execution?.cookieMaterialPersisted === true),
  };
}

function summarizeRedditBrowserBridgeRouteQueueReport(report = /** @type {any} */ ({})) {
  if (!report) {
    return null;
  }
  const summary = report.summary ?? {};
  return {
    totalCandidateRoutes: Number(summary.totalCandidateRoutes ?? 0) || 0,
    selectedRoutes: Number(summary.selectedRoutes ?? 0) || 0,
    uniqueRouteTemplates: Number(summary.uniqueRouteTemplates ?? 0) || 0,
    concreteRouteCount: Number(summary.concreteRouteCount ?? 0) || 0,
    routeTemplateOnlyCount: Number(summary.routeTemplateOnlyCount ?? 0) || 0,
    browserBridgeEligibleRoutes: Number(summary.browserBridgeEligibleRoutes ?? 0) || 0,
    publicCandidateRoutes: Number(summary.publicCandidateRoutes ?? 0) || 0,
    authPrivateCandidateRoutes: Number(summary.authPrivateCandidateRoutes ?? 0) || 0,
    authEntryCandidateRoutes: Number(summary.authEntryCandidateRoutes ?? 0) || 0,
    moderatorLimitedCandidateRoutes: Number(summary.moderatorLimitedCandidateRoutes ?? 0) || 0,
    browserBoundaryCandidateRoutes: Number(summary.browserBoundaryCandidateRoutes ?? 0) || 0,
    writeDisabledCandidateRoutes: Number(summary.writeDisabledCandidateRoutes ?? 0) || 0,
    apiDisabledRoutes: Number(summary.apiDisabledRoutes ?? 0) || 0,
    cookiePersisted: summary.cookiePersisted === true,
    tokenPersisted: summary.tokenPersisted === true,
    rawHtmlPersisted: summary.rawHtmlPersisted === true,
    browserProfilePersisted: summary.browserProfilePersisted === true,
  };
}

function summarizeRedditBrowserBridgeCumulativeReport(report = /** @type {any} */ ({})) {
  if (!report) {
    return null;
  }
  const summary = report.summary ?? {};
  const capturedUniqueRoutes = Number(summary.capturedUniqueRoutes ?? 0) || 0;
  const missingUniqueRoutes = Number(summary.missingUniqueRoutes ?? 0) || 0;
  const liveBoundaryRoutes = redditBrowserBoundaryDispositionsFromCumulativeReport(report);
  const liveBoundaryRouteCount = Math.min(missingUniqueRoutes, liveBoundaryRoutes.length);
  const liveRequiredMissingRoutes = Math.max(0, missingUniqueRoutes - liveBoundaryRouteCount);
  return {
    status: capturedUniqueRoutes > 0
      ? (liveRequiredMissingRoutes > 0 ? 'partial_captured' : (liveBoundaryRouteCount > 0 ? 'captured_with_boundary_disposition' : 'captured'))
      : (liveRequiredMissingRoutes > 0 ? 'blocked' : 'not_attempted'),
    sourceBuildAttempts: asArray(report.sourceBuilds).length,
    selectedUniqueRoutes: Number(summary.selectedUniqueRoutes ?? 0) || 0,
    attemptedUniqueRoutes: Number(summary.attemptedUniqueRoutes ?? 0) || 0,
    capturedUniqueRoutes,
    missingUniqueRoutes,
    rawMissingUniqueRoutes: missingUniqueRoutes,
    liveRequiredMissingRoutes,
    liveBoundaryRouteCount,
    liveBoundaryRoutes,
    eligibleQueueEntries: Number(summary.eligibleQueueEntries ?? 0) || 0,
    eligibleUniqueRoutes: Number(summary.eligibleUniqueRoutes ?? 0) || 0,
    remainingEligibleUniqueRoutes: Number(summary.remainingEligibleUniqueRoutes ?? 0) || 0,
    remainingEligibleByKind: summary.remainingEligibleByKind ?? {},
    remainingUncoveredTemplateRoutes: Number(summary.remainingLiteralTemplateKeysUncovered ?? 0) || 0,
    templateResidualsCovered: Number(summary.remainingLiteralTemplateKeysCoveredByConcreteRoutes ?? 0) || 0,
    missingByReason: report.missingByReason ?? {},
    latestAttempt: report.latestAttempt ?? null,
    latestSuccessfulBuild: report.latestSuccessfulBuild ?? null,
    localCookieDetected: summary.localCookieDetected === true,
    localCookiePairCount: Number(summary.localCookiePairCount ?? 0) || 0,
    cookiePersisted: summary.cookiePersisted === true,
    browserProfilePersisted: summary.browserProfilePersisted === true,
  };
}

export function buildRedditComprehensiveCoverageReport(catalog, {
  coverageAudit = null,
  runtimeIndex = null,
  apiReadBatchReport = null,
  browserBridgeRouteQueueReport = null,
  browserBridgeCumulativeReport = null,
  browserBridgeCumulativeReportPath = null,
  registry = null,
  authorizedSourceManifest = null,
  cookieBuildReport = null,
  browserBuildReport = null,
  publicBuildReport = null,
  authorizedSourceBuildReport = null,
  sessionManifest = null,
  doctorReport = null,
  robots = /** @type {any} */ ({}),
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const operations = asArray(catalog?.operations);
  const readOperations = operations.filter((operation) => operation.method === 'GET');
  const writeOperations = operations.filter((operation) => operation.method !== 'GET');
  const sourceSummary = summarizeAuthorizedSourceManifest(authorizedSourceManifest);
  const registrySummary = summarizeRedditRegistry(registry);
  const cookieBuild = summarizeRedditBuildReport(cookieBuildReport);
  const browserBuild = summarizeRedditBuildReport(browserBuildReport);
  const publicBuild = summarizeRedditBuildReport(publicBuildReport);
  const authorizedSourceBuild = summarizeRedditBuildReport(authorizedSourceBuildReport);
  const session = summarizeRedditSessionManifest(sessionManifest);
  const doctor = summarizeRedditDoctorReport(doctorReport);
  const apiBatch = summarizeRedditApiReadBatchReport(apiReadBatchReport);
  const routeQueue = summarizeRedditBrowserBridgeRouteQueueReport(browserBridgeRouteQueueReport);
  const browserCumulative = summarizeRedditBrowserBridgeCumulativeReport(browserBridgeCumulativeReport);
  const runtimeSummary = runtimeIndex?.summary ?? {};
  const registeredPlans = Math.max(
    Number(registrySummary.registeredApiRequestPlans ?? 0) || 0,
    Number(coverageAudit?.summary?.registeredApiRequestPlans ?? 0) || 0,
    Number(runtimeSummary.registeredInCurrentSiteForgeRuntime ?? 0) || 0,
    Number(runtimeSummary.registeredApiRequestPlans ?? 0) || 0,
  );
  const authorizedSourcePages = Math.max(
    Number(sourceSummary.pageCount ?? 0) || 0,
    Number(publicBuild?.coverage?.authorizedSourcePages ?? 0) || 0,
    Number(authorizedSourceBuild?.coverage?.authorizedSourcePages ?? 0) || 0,
    Number(coverageAudit?.summary?.authorizedSourcePages ?? 0) || 0,
  );
  const authorizedSourceRouteTemplates = Math.max(
    Number(sourceSummary.uniqueRouteTemplateCount ?? 0) || 0,
    Number(coverageAudit?.summary?.authorizedSourceRouteTemplates ?? 0) || 0,
  );
  const authorizedSourceLinks = Math.max(
    Number(sourceSummary.uniqueLinkCount ?? 0) || 0,
    Number(coverageAudit?.summary?.authorizedSourceUniqueLinks ?? 0) || 0,
  );
  const authorizedSourceForms = Math.max(
    Number(sourceSummary.uniqueFormCount ?? 0) || 0,
    Number(coverageAudit?.summary?.authorizedSourceForms ?? 0) || 0,
  );
  const authorizedSourceControls = Math.max(
    Number(sourceSummary.uniqueControlCount ?? 0) || 0,
    Number(coverageAudit?.summary?.authorizedSourceControls ?? 0) || 0,
  );
  const coverageAuditBuildCounts = {
    nodes: Number(coverageAudit?.summary?.buildGraphNodeCount ?? 0) || 0,
    actionableElements: Number(coverageAudit?.summary?.buildActionableElementCount ?? 0) || 0,
    capabilities: Number(coverageAudit?.summary?.buildCapabilityCount ?? 0) || 0,
    intents: Number(coverageAudit?.summary?.buildIntentCount ?? 0) || 0,
  };
  const authorizedSourceBuildCounts = {
    nodes: authorizedSourceBuild ? authorizedSourceBuild.graph.nodes : coverageAuditBuildCounts.nodes,
    capabilities: authorizedSourceBuild ? authorizedSourceBuild.graph.capabilities : coverageAuditBuildCounts.capabilities,
    intents: authorizedSourceBuild ? authorizedSourceBuild.graph.intents : coverageAuditBuildCounts.intents,
  };
  const effectiveRuntimeSummary = {
    ...runtimeSummary,
    registeredInCurrentSiteForgeRuntime: registeredPlans,
    registrationEvidence: registeredPlans > 0 ? 'registry' : 'runtime_index',
  };
  const effectiveAuthorizedSource = {
    pageCount: authorizedSourcePages,
    uniqueLinkCount: authorizedSourceLinks,
    uniqueRouteTemplateCount: authorizedSourceRouteTemplates,
    uniqueFormCount: authorizedSourceForms,
    uniqueControlCount: authorizedSourceControls,
    sources: {
      manifest: sourceSummary.sourcePresent ? {
        pageCount: sourceSummary.pageCount,
        uniqueLinkCount: sourceSummary.uniqueLinkCount,
        uniqueRouteTemplateCount: sourceSummary.uniqueRouteTemplateCount,
        uniqueFormCount: sourceSummary.uniqueFormCount,
        uniqueControlCount: sourceSummary.uniqueControlCount,
      } : null,
      publicBuild: publicBuild ? {
        pageCount: publicBuild.coverage.authorizedSourcePages,
        nodeCount: publicBuild.coverage.authorizedSourceNodes,
        capabilityCount: publicBuild.coverage.authorizedSourceCapabilities,
      } : null,
      authorizedSourceBuild: authorizedSourceBuild ? {
        pageCount: authorizedSourceBuild.coverage.authorizedSourcePages,
        nodeCount: authorizedSourceBuild.coverage.authorizedSourceNodes,
        capabilityCount: authorizedSourceBuild.coverage.authorizedSourceCapabilities,
      } : null,
      coverageAudit: coverageAudit?.summary ? {
        pageCount: Number(coverageAudit.summary.authorizedSourcePages ?? 0) || 0,
        uniqueLinkCount: Number(coverageAudit.summary.authorizedSourceUniqueLinks ?? 0) || 0,
        uniqueRouteTemplateCount: Number(coverageAudit.summary.authorizedSourceRouteTemplates ?? 0) || 0,
        uniqueFormCount: Number(coverageAudit.summary.authorizedSourceForms ?? 0) || 0,
        uniqueControlCount: Number(coverageAudit.summary.authorizedSourceControls ?? 0) || 0,
        nodeCount: coverageAuditBuildCounts.nodes,
        actionableElementCount: coverageAuditBuildCounts.actionableElements,
        capabilityCount: coverageAuditBuildCounts.capabilities,
        intentCount: coverageAuditBuildCounts.intents,
      } : null,
    },
  };
  const fullSiteLiveBlockers = [];
  if (robots?.disallowAllForGenericUserAgent === true || coverageAudit?.status?.genericLiveCrawl === 'blocked_by_robots') {
    fullSiteLiveBlockers.push({
      id: 'reddit-generic-live-robots',
      layer: 'generic_live_crawl',
      status: 'blocked',
      reasonCode: 'robots-disallowed',
      remediation: 'Use Reddit official APIs, documented feeds, or sanitized authorized-source summaries; do not retry generic crawling while robots disallows the scope.',
    });
  }
  if (cookieBuild && redditBrowserBuildStatus(cookieBuild) !== 'captured' && redditBrowserBuildStatus(cookieBuild) !== 'partial_capture') {
    fullSiteLiveBlockers.push({
      id: 'reddit-cookie-crawl-auth-boundary',
      layer: 'cookie_crawl',
      status: 'blocked',
      reasonCode: cookieBuild.reasonCode ?? cookieBuild.authVerificationStatus ?? 'cookie_or_browser_auth_blocked',
      remediation: 'Refresh or replace the user-authorized browser/cookie session, then verify through SiteForge Browser Bridge without persisting cookie material.',
    });
  }
  if (browserBuild && redditBrowserBuildStatus(browserBuild) !== 'captured' && redditBrowserBuildStatus(browserBuild) !== 'partial_capture') {
    fullSiteLiveBlockers.push({
      id: 'reddit-browser-bridge-route-capture',
      layer: 'browser_bridge',
      status: 'blocked',
      reasonCode: browserBuild.authVerificationStatus ?? browserBuild.reasonCode ?? 'browser_bridge_blocked',
      attemptedRoutes: browserBuild.coverage.browserBridgeRouteCount,
      capturedRoutes: browserBuild.coverage.browserBridgeCapturedRouteCount,
      missingRoutes: browserBuild.coverage.browserBridgeMissingRouteCount,
      remediation: 'A verified default-browser bridge session is required before authenticated route capture can produce live evidence.',
    });
  }
  if (browserCumulative && browserCumulative.liveRequiredMissingRoutes > 0) {
    fullSiteLiveBlockers.push({
      id: 'reddit-browser-bridge-partial-route-coverage',
      layer: 'browser_bridge',
      status: 'partial_captured',
      reasonCode: 'browser-bridge-route-gaps-remain',
      attemptedRoutes: browserCumulative.attemptedUniqueRoutes,
      capturedRoutes: browserCumulative.capturedUniqueRoutes,
      missingRoutes: browserCumulative.liveRequiredMissingRoutes,
      rawMissingRoutes: browserCumulative.rawMissingUniqueRoutes,
      boundaryDispositionRoutes: browserCumulative.liveBoundaryRouteCount,
      missingByReason: browserCumulative.missingByReason,
      remediation: 'Retry only the remaining Browser Bridge challenge/login-wall routes after browser challenge resolution.',
    });
  }
  const fullSiteLiveBoundaries = browserCumulative?.liveBoundaryRoutes?.length
    ? browserCumulative.liveBoundaryRoutes.map((route) => ({
      id: `reddit-browser-bridge-boundary-${slugify(route.targetRoute, 'route')}`,
      layer: 'browser_bridge',
      status: 'boundary_disposition',
      reasonCode: route.reasonCode,
      targetRoute: route.targetRoute,
      disposition: route.disposition,
      referenceUrl: route.referenceUrl,
      remediation: route.remediation,
    }))
    : [];
  if (apiBatch && apiBatch.successCount === 0 && apiBatch.blockedCount > 0) {
    fullSiteLiveBlockers.push({
      id: 'reddit-oauth-api-credential-boundary',
      layer: 'reddit_oauth_api_runtime',
      status: 'blocked',
      reasonCode: apiBatch.oauthCredentialInput === 'missing' ? 'reddit_oauth_token_and_user_agent_required' : (apiBatch.status ?? 'reddit_api_execution_blocked'),
      selectedPlans: apiBatch.selectedPlanCount,
      blockedPlans: apiBatch.blockedCount,
      remediation: 'Provide operator-owned Reddit OAuth credential and descriptive User-Agent at runtime to execute read-only API plans.',
    });
  }
  const browserBridgeLiveCapturedRoutes = browserCumulative
    ? browserCumulative.capturedUniqueRoutes
    : (browserBuild?.coverage?.browserBridgeCapturedRouteCount ?? 0)
      + (cookieBuild?.coverage?.browserBridgeCapturedRouteCount ?? 0);
  const browserBridgeLiveAttemptedRoutes = browserCumulative
    ? browserCumulative.attemptedUniqueRoutes
    : (browserBuild?.coverage?.browserBridgeRouteCount ?? 0);
  const browserBridgeLiveMissingRoutes = browserCumulative
    ? browserCumulative.liveRequiredMissingRoutes
    : (browserBuild?.coverage?.browserBridgeMissingRouteCount ?? 0);
  const browserBridgeRawMissingRoutes = browserCumulative
    ? browserCumulative.rawMissingUniqueRoutes
    : browserBridgeLiveMissingRoutes;
  const fullSiteLiveSuccessCount = (apiBatch?.successCount ?? 0) + browserBridgeLiveCapturedRoutes;
  const fullSiteLiveResolvedRouteCount = fullSiteLiveSuccessCount + (browserCumulative?.liveBoundaryRouteCount ?? 0);
  const fullSiteLiveReadiness = fullSiteLiveSuccessCount > 0
    ? 'partial_live_evidence'
    : (fullSiteLiveBlockers.length > 0 ? 'blocked_external_access_boundary' : 'not_attempted');
  const fullSiteLiveNextSteps = [
    fullSiteLiveBlockers.some((blocker) => blocker.layer === 'generic_live_crawl') ? {
      id: 'do-not-retry-generic-reddit-crawl',
      status: 'blocked_by_robots',
      action: 'Use official APIs, feeds, or sanitized authorized-source summaries instead of generic crawling while the current robots policy disallows the scope.',
    } : null,
    apiBatch && apiBatch.successCount === 0 && apiBatch.blockedCount > 0 ? {
      id: 'execute-reddit-oauth-read-batch',
      status: apiBatch.oauthCredentialInput === 'missing' ? 'available_after_oauth_credential_and_user_agent' : 'ready_to_retry_read_only_api_batch',
      action: 'Run reddit-action api-read-batch in execute-all mode for read-only OAuth API plans.',
      selectedPlans: apiBatch.selectedPlanCount,
      blockedPlans: apiBatch.blockedCount,
      requiredInputs: apiBatch.oauthCredentialInput === 'missing' ? ['reddit_oauth_credential', 'descriptive_user_agent'] : [],
    } : null,
    routeQueue ? {
      id: 'retry-browser-bridge-eligible-route-batch',
      status: browserCumulative?.liveRequiredMissingRoutes > 0
        ? 'challenge_retry_boundary'
        : browserCumulative?.liveBoundaryRouteCount > 0
          ? 'boundary_disposition_recorded'
        : browserBuild && ['captured', 'partial_capture'].includes(redditBrowserBuildStatus(browserBuild))
        ? 'ready_for_missing_route_retry'
        : 'available_after_verified_browser_bridge_session_and_robots_allowed_routes',
      action: browserCumulative?.liveBoundaryRouteCount > 0 && browserCumulative?.liveRequiredMissingRoutes === 0
        ? 'No Browser Bridge live-required route gaps remain; the remaining raw gap is recorded as a contextual Reddit route boundary.'
        : 'Use only Browser Bridge eligible route-queue entries; write/API-disabled routes remain excluded from browser route capture.',
      eligibleRoutes: routeQueue.browserBridgeEligibleRoutes,
      authPrivateRoutes: routeQueue.authPrivateCandidateRoutes,
      moderatorLimitedRoutes: routeQueue.moderatorLimitedCandidateRoutes,
      boundaryDispositionRoutes: browserCumulative?.liveBoundaryRouteCount ?? 0,
    } : null,
  ].filter(Boolean);
  const report = {
    schemaVersion: 1,
    artifactFamily: 'reddit-comprehensive-execution-coverage-report',
    generatedAt,
    sourceReferences: catalog?.sourceReferences ?? [REDDIT_DEV_API_URL],
    objective: 'Collect Reddit links, functions, intents, and executable API plans through SiteForge-governed routes.',
    summary: {
      officialApiOperations: operations.length,
      apiMethodCounts: catalog?.methodCounts ?? {},
      oauthEndpointTemplates: catalog?.templateExpansionSummary?.oauthEndpointTemplateCount ?? 0,
      readApiTemplates: readOperations.length,
      writeApiTemplatesDisabled: writeOperations.length,
      runtimeReadyApiRequestPlans: Number(catalog?.executableSummary?.runtimeReadyApiRequestPlans ?? readOperations.length),
      registeredApiRequestPlans: registeredPlans,
      concreteRuntimePlans: Number(runtimeSummary.concreteRuntimePlanCount ?? 0) || 0,
      parameterizedRuntimeTemplates: Number(runtimeSummary.parameterizedRuntimeTemplateCount ?? 0) || 0,
      apiBatchReportPresent: apiBatch ? 1 : 0,
      apiBatchMode: apiBatch?.batchMode ?? null,
      apiBatchTotalPlans: apiBatch?.selectedPlanCount ?? 0,
      apiBatchTotalAttempted: apiBatch?.executedCount ?? 0,
      apiBatchTotalSucceeded: apiBatch?.successCount ?? 0,
      apiBatchTotalBlocked: apiBatch?.blockedCount ?? 0,
      apiConcreteGetBatchPlans: apiBatch?.selectedConcretePlanCount ?? 0,
      apiConcreteGetBatchAttempted: apiBatch?.concreteExecutedCount ?? 0,
      apiConcreteGetBatchSucceeded: apiBatch?.concreteSuccessCount ?? 0,
      apiConcreteGetBatchBlocked: apiBatch?.concreteBlockedCount ?? 0,
      apiConcreteGetBatchBlockedByCredential: apiBatch?.concreteMissingCredentialBlockedCount ?? 0,
      apiParameterizedGetBatchPlans: apiBatch?.selectedParameterizedPlanCount ?? 0,
      apiParameterizedGetBatchSeededForResolution: Math.max(0, (apiBatch?.selectedParameterizedPlanCount ?? 0) - (apiBatch?.parameterizedSeedMissingCount ?? 0)),
      apiParameterizedGetBatchAttempted: apiBatch?.parameterizedExecutedCount ?? 0,
      apiParameterizedGetBatchSucceeded: apiBatch?.parameterizedSuccessCount ?? 0,
      apiParameterizedGetBatchBlocked: apiBatch?.parameterizedBlockedCount ?? 0,
      apiParameterizedGetBatchBlockedByCredential: apiBatch?.parameterizedMissingCredentialBlockedCount ?? 0,
      apiParameterizedGetBatchSeedMissing: apiBatch?.parameterizedSeedMissingCount ?? 0,
      apiParameterizedGetBatchPlaceholderOnly: apiBatch?.parameterizedPlaceholderOnlyCount ?? 0,
      apiParameterizedGetBatchPlanOnly: apiBatch?.parameterizedPlanOnlyCount ?? 0,
      apiParameterizedGetBatchLiveExecutable: apiBatch?.parameterizedLiveExecutableCount ?? 0,
      apiParameterizedGetTemplatesPendingParams: Math.max(0, Number(runtimeSummary.parameterizedRuntimeTemplateCount ?? 0) - (apiBatch?.selectedParameterizedPlanCount ?? 0)),
      apiBatchTokenPersisted: apiBatch?.tokenPersisted === true,
      apiBatchAuthMaterialPersisted: apiBatch?.authorizationPersisted === true,
      apiBatchCookieMaterialPersisted: apiBatch?.cookieMaterialPersisted === true,
      apiBatchBodyPersisted: apiBatch?.responseBodyPersisted === true,
      authorizedSourcePages,
      authorizedSourceRouteTemplates,
      authorizedSourceLinks,
      authorizedSourceForms,
      authorizedSourceControls,
      publicOnlyBuildCapabilities: publicBuild?.graph?.capabilities ?? 0,
      publicOnlyBuildIntents: publicBuild?.graph?.intents ?? 0,
      authorizedSourceBuildCapabilities: authorizedSourceBuildCounts.capabilities,
      authorizedSourceBuildIntents: authorizedSourceBuildCounts.intents,
      authorizedSourceBuildNodes: authorizedSourceBuildCounts.nodes,
      cookieBuildStatus: cookieBuild?.status ?? null,
      browserBridgeBuildStatus: browserBuild?.status ?? null,
      browserBridgeRouteCount: browserBridgeLiveAttemptedRoutes,
      browserBridgeCapturedRouteCount: browserBridgeLiveCapturedRoutes,
      browserBridgeMissingRouteCount: browserBridgeLiveMissingRoutes,
      browserBridgeRawMissingRouteCount: browserBridgeRawMissingRoutes,
      browserBridgeBoundaryDispositionRouteCount: browserCumulative?.liveBoundaryRouteCount ?? 0,
      browserBridgeLiveRequiredMissingRouteCount: browserBridgeLiveMissingRoutes,
      browserBridgeRouteQueueCandidates: routeQueue?.totalCandidateRoutes ?? 0,
      browserBridgeRouteQueueEligible: routeQueue?.browserBridgeEligibleRoutes ?? 0,
      browserBridgeRouteQueueAuthPrivate: routeQueue?.authPrivateCandidateRoutes ?? 0,
      browserBridgeRouteQueueModeratorLimited: routeQueue?.moderatorLimitedCandidateRoutes ?? 0,
      browserBridgeRouteQueueBoundary: routeQueue?.browserBoundaryCandidateRoutes ?? 0,
      browserBridgeRouteQueueWriteDisabled: routeQueue?.writeDisabledCandidateRoutes ?? 0,
      browserBridgeRouteQueueApiDisabled: routeQueue?.apiDisabledRoutes ?? 0,
      sessionHealthStatus: session?.status ?? null,
      siteDoctorCaptureStatus: doctor?.captureStatus ?? null,
      fullSiteLiveSuccessCount,
      fullSiteLiveResolvedRouteCount,
      fullSiteLiveBlockerCount: fullSiteLiveBlockers.length,
    },
    status: {
      genericLiveCrawl: robots?.disallowAllForGenericUserAgent === true ? 'blocked_by_robots' : (coverageAudit?.status?.genericLiveCrawl ?? 'not_verified'),
      cookieCrawl: cookieBuild?.reasonCode === 'cookie_blocked'
        ? 'blocked_cookie_not_verified'
        : (redditBrowserBuildStatus(cookieBuild) ?? (cookieBuild?.status ?? 'not_run')),
      browserBridgeAuthenticatedRoute: browserCumulative?.status
        ?? redditBrowserBuildStatus(browserBuild)
        ?? (doctor?.sessionHealthStatus === 'manual-required' || session?.status === 'manual-required'
        ? 'manual_profile_required'
        : (doctor?.sessionReuseWorked ? 'session_probe_available_capture_runtime_removed' : 'not_available')),
      browserBridgeRouteQueue: routeQueue ? 'present' : 'missing',
      siteDoctor: doctor?.captureStatus === 'fail' ? 'profile_and_crawler_passed_capture_runtime_removed' : (doctor?.captureStatus ?? 'not_run'),
      officialApiCatalog: operations.length > 0 ? 'covered_from_official_docs' : 'missing',
      oauthReadRuntime: registeredPlans >= readOperations.length ? 'registered' : 'partial_or_not_registered',
      apiBatchReport: apiBatch ? 'present' : 'missing',
      apiConcreteGetBatch: apiBatch?.concreteStatus ?? apiBatch?.status ?? 'not_run_no_batch_report',
      apiBatchCredentialBoundary: apiBatch
        ? (apiBatch.tokenProvided && apiBatch.userAgentProvided
          ? 'ready'
          : (!apiBatch.tokenProvided && !apiBatch.userAgentProvided
            ? 'missing_token_and_user_agent'
            : (!apiBatch.tokenProvided ? 'missing_token' : 'missing_user_agent')))
        : 'unknown',
      apiParameterizedGetBatch: apiBatch
        ? (apiBatch.selectedParameterizedPlanCount > 0 ? (apiBatch.parameterizedTemplateCoverage ?? 'selected') : 'pending_runtime_params')
        : 'pending_runtime_params',
      apiParameterizedGetExecution: apiBatch
        ? (apiBatch.selectedParameterizedPlanCount > 0 ? (apiBatch.parameterizedStatus ?? 'not_run_no_batch_report') : 'not_selected')
        : 'not_run_no_batch_report',
      authorizedSourceBuild: authorizedSourceBuild
        ? (authorizedSourceBuild.status === 'partial_success' ? 'partial_success' : authorizedSourceBuild.status)
        : (coverageAuditBuildCounts.capabilities > 0 || coverageAuditBuildCounts.intents > 0 ? 'covered_from_coverage_audit' : 'not_run'),
      writeAndMutationActions: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
      fullSiteLiveReadiness,
      fullSiteAllLinksAndFunctions: 'not_complete',
    },
    requirementAudit: [
      {
        requirement: 'Run Reddit through X-style session health and site-doctor mode',
        status: doctor ? 'attempted' : 'missing',
        evidenceCount: doctor ? 1 : 0,
        evidence: doctor
          ? `profile status ${doctor.profileStatus}; crawler status ${doctor.crawlerStatus}; capture status ${doctor.captureStatus}; session health status ${session?.status ?? 'unknown'}`
          : 'No Reddit site-doctor report supplied.',
      },
      {
        requirement: 'Enumerate Browser Bridge route queue from Reddit authorized structure',
        status: routeQueue ? 'covered_from_route_queue' : 'missing',
        evidenceCount: routeQueue?.totalCandidateRoutes ?? 0,
        evidence: routeQueue
          ? `candidate routes ${routeQueue.totalCandidateRoutes}; eligible ${routeQueue.browserBridgeEligibleRoutes}; auth private ${routeQueue.authPrivateCandidateRoutes}; moderator limited ${routeQueue.moderatorLimitedCandidateRoutes}; boundary ${routeQueue.browserBoundaryCandidateRoutes}; write disabled ${routeQueue.writeDisabledCandidateRoutes}; api disabled ${routeQueue.apiDisabledRoutes}`
          : 'No Browser Bridge route queue report supplied.',
      },
      {
        requirement: 'Use configured Reddit cookie / Browser Bridge path',
        status: browserCumulative?.status
          ?? redditBrowserBuildStatus(browserBuild)
          ?? (cookieBuild?.reasonCode === 'cookie_blocked' ? 'blocked_cookie_not_verified' : 'not_verified'),
        evidenceCount: (cookieBuild ? 1 : 0) + (browserBuild ? 1 : 0) + (browserCumulative ? 1 : 0),
        evidence: browserCumulative
          ? `cumulative Browser Bridge attempts ${browserCumulative.sourceBuildAttempts}; attempted ${browserCumulative.attemptedUniqueRoutes}; captured ${browserCumulative.capturedUniqueRoutes}; missing ${browserCumulative.liveRequiredMissingRoutes}; uncovered templates ${browserCumulative.remainingUncoveredTemplateRoutes}; raw missing ${browserCumulative.rawMissingUniqueRoutes}; boundary dispositions ${browserCumulative.liveBoundaryRouteCount}`
          : browserBuild
          ? `browser build status ${browserBuild.status}; auth ${browserBuild.authVerificationStatus}; reason ${browserBuild.reasonCode}; routes ${browserBuild.coverage.browserBridgeRouteCount}; captured ${browserBuild.coverage.browserBridgeCapturedRouteCount}; missing ${browserBuild.coverage.browserBridgeMissingRouteCount}`
          : cookieBuild
            ? `cookie build status ${cookieBuild.status}; reason ${cookieBuild.reasonCode}; browser bridge used ${cookieBuild.coverage.browserBridgeUsed}`
            : 'No cookie or Browser Bridge build report supplied.',
      },
      {
        requirement: 'Enumerate Reddit official API operations',
        status: operations.length > 0 ? 'covered_from_official_docs' : 'missing',
        evidenceCount: operations.length,
        evidence: 'Reddit /dev/api operation blocks parsed into sanitized records.',
      },
      {
        requirement: 'Register executable read API plans',
        status: registeredPlans >= readOperations.length ? 'registered' : 'partial_or_not_registered',
        evidenceCount: registeredPlans,
        evidence: 'OAuth GET plans are registered through reddit_oauth_read_runtime; tokens and User-Agent are runtime inputs only.',
      },
      {
        requirement: 'Preflight Reddit OAuth concrete GET batch',
        status: apiBatch ? (apiBatch.concreteStatus ?? apiBatch.status) : 'not_run_no_batch_report',
        evidenceCount: apiBatch?.selectedConcretePlanCount ?? (Number(runtimeSummary.concreteRuntimePlanCount ?? 0) || 0),
        evidence: apiBatch
          ? `selected concrete GET plans ${apiBatch.selectedConcretePlanCount}; attempted ${apiBatch.concreteExecutedCount}; blocked ${apiBatch.concreteBlockedCount}; missing credential blocks ${apiBatch.concreteMissingCredentialBlockedCount}`
          : `${Number(runtimeSummary.concreteRuntimePlanCount ?? 0) || 0} concrete GET plans require OAuth bearer token and User-Agent; no API batch report supplied.`,
      },
      {
        requirement: 'Resolve Reddit parameterized GET templates',
        status: apiBatch?.selectedParameterizedPlanCount > 0 ? apiBatch.parameterizedTemplateCoverage : 'pending_runtime_params',
        evidenceCount: Number(runtimeSummary.parameterizedRuntimeTemplateCount ?? 0) || 0,
        evidence: apiBatch
          ? `parameterized templates selected ${apiBatch.selectedParameterizedPlanCount}; attempted ${apiBatch.parameterizedExecutedCount}; blocked ${apiBatch.parameterizedBlockedCount}; missing seed count ${apiBatch.parameterizedSeedMissingCount}; plan-only ${apiBatch.parameterizedPlanOnlyCount}; live executable after credentials ${apiBatch.parameterizedLiveExecutableCount}`
          : `${Number(runtimeSummary.parameterizedRuntimeTemplateCount ?? 0) || 0} parameterized templates require explicit runtime path parameters before live execution.`,
      },
      {
        requirement: 'Keep Reddit API batch sanitized',
        status: apiBatch && !apiBatch.tokenPersisted && !apiBatch.authorizationPersisted && !apiBatch.cookieMaterialPersisted && !apiBatch.responseBodyPersisted
          ? 'passed'
          : (apiBatch ? 'failed' : 'not_run_no_batch_report'),
        evidenceCount: apiBatch ? 1 : 0,
        evidence: apiBatch
          ? `token persisted ${apiBatch.tokenPersisted}; authorization persisted ${apiBatch.authorizationPersisted}; cookies persisted ${apiBatch.cookieMaterialPersisted}; response body persisted ${apiBatch.responseBodyPersisted}`
          : 'No API batch report supplied.',
      },
      {
        requirement: 'Keep write/state-changing Reddit functions non-auto-executable',
        status: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
        evidenceCount: writeOperations.length,
        evidence: 'Non-GET official API operations are retained for coverage but disabled by default.',
      },
      {
        requirement: 'Enumerate Reddit links/functions/intents from authorized structure',
        status: (authorizedSourcePages || authorizedSourceLinks || publicBuild?.graph?.capabilities) ? 'covered_from_authorized_source_summary' : 'missing',
        evidenceCount: authorizedSourceLinks || authorizedSourceBuildCounts.capabilities || publicBuild?.graph?.capabilities || 0,
        evidence: `authorized pages ${authorizedSourcePages}; authorized links ${authorizedSourceLinks}; authorized forms ${authorizedSourceForms}; authorized controls ${authorizedSourceControls}; authorized-source build capabilities ${authorizedSourceBuildCounts.capabilities}; authorized-source build intents ${authorizedSourceBuildCounts.intents}; public build capabilities ${publicBuild?.graph?.capabilities ?? 0}; public build intents ${publicBuild?.graph?.intents ?? 0}`,
      },
      {
        requirement: 'Resolve full-site live crawl access blockers',
        status: fullSiteLiveReadiness,
        evidenceCount: fullSiteLiveBlockers.length,
        evidence: fullSiteLiveBlockers.length
          ? fullSiteLiveBlockers.map((blocker) => `${blocker.layer}:${blocker.reasonCode}`).join('; ')
          : 'No full-site live blockers were supplied to this report.',
      },
      {
        requirement: 'Full live crawl of all reddit.com links and functions',
        status: 'not_complete',
        evidenceCount: (robots?.disallowAllForGenericUserAgent === true ? 1 : 0)
          + (apiBatch?.concreteBlockedCount ? 1 : 0)
          + (apiBatch?.selectedParameterizedPlanCount ? 1 : 0)
          + (browserCumulative?.liveRequiredMissingRoutes ? 1 : 0),
        evidence: [
          robots?.disallowAllForGenericUserAgent === true ? 'Current robots evidence disallows generic live crawl of /.' : null,
          apiBatch ? `concrete GET selected ${apiBatch.selectedConcretePlanCount}; attempted ${apiBatch.concreteExecutedCount}; blocked ${apiBatch.concreteBlockedCount}` : null,
          apiBatch ? `parameterized GET selected ${apiBatch.selectedParameterizedPlanCount}; execution status ${apiBatch.parameterizedStatus ?? 'not_run'}` : null,
          browserCumulative ? `Browser Bridge cumulative captured ${browserCumulative.capturedUniqueRoutes}; missing ${browserCumulative.liveRequiredMissingRoutes}; uncovered templates ${browserCumulative.remainingUncoveredTemplateRoutes}; raw missing ${browserCumulative.rawMissingUniqueRoutes}; boundary dispositions ${browserCumulative.liveBoundaryRouteCount}` : null,
        ].filter(Boolean).join(' ') || 'No complete live crawl evidence supplied.',
      },
    ],
    evidence: {
      coverageAuditSummary: coverageAudit?.summary ?? null,
      runtimeIndexSummary: runtimeIndex?.summary ?? null,
      apiReadBatch: apiBatch,
      browserBridgeRouteQueue: routeQueue,
      fullSiteLive: {
        successCount: fullSiteLiveSuccessCount,
        resolvedRouteCount: fullSiteLiveResolvedRouteCount,
        readiness: fullSiteLiveReadiness,
        blockers: fullSiteLiveBlockers,
        boundaries: fullSiteLiveBoundaries,
        nextSteps: fullSiteLiveNextSteps,
        browserBridge: browserCumulative ? {
          status: browserCumulative.status,
          attemptedUniqueRoutes: browserCumulative.attemptedUniqueRoutes,
          capturedUniqueRoutes: browserCumulative.capturedUniqueRoutes,
          missingUniqueRoutes: browserCumulative.liveRequiredMissingRoutes,
          rawMissingUniqueRoutes: browserCumulative.rawMissingUniqueRoutes,
          boundaryDispositionRouteCount: browserCumulative.liveBoundaryRouteCount,
          boundaryDispositionRoutes: browserCumulative.liveBoundaryRoutes,
          remainingEligibleUniqueRoutes: browserCumulative.remainingEligibleUniqueRoutes,
          remainingUncoveredTemplateRoutes: browserCumulative.remainingUncoveredTemplateRoutes,
          remainingEligibleByKind: browserCumulative.remainingEligibleByKind,
          missingByReason: browserCumulative.missingByReason,
          latestAttempt: browserCumulative.latestAttempt,
          cumulativeReportPath: browserBridgeCumulativeReportPath,
        } : null,
      },
      effectiveRuntimeSummary,
      registry: registrySummary,
      cookieBuild,
      browserBuild,
      publicBuild,
      authorizedSourceBuild,
      session,
      siteDoctor: doctor,
      effectiveAuthorizedSource,
      authorizedSource: sourceSummary.sourcePresent ? {
        pageCount: sourceSummary.pageCount,
        uniqueLinkCount: sourceSummary.uniqueLinkCount,
        uniqueRouteTemplateCount: sourceSummary.uniqueRouteTemplateCount,
        uniqueFormCount: sourceSummary.uniqueFormCount,
        uniqueControlCount: sourceSummary.uniqueControlCount,
        pageTypes: sourceSummary.pageTypes,
      } : null,
    },
  };
  assertNoForbiddenPatterns(report);
  return report;
}

export function buildRedditLiveReadinessReport({
  apiReadBatchReport = null,
  browserBridgeRouteQueueReport = null,
  browserBridgeCumulativeReport = null,
  cookieBuildReport = null,
  browserBuildReport = null,
  coverageAudit = null,
  robots = /** @type {any} */ ({}),
  env = process.env,
  commandContext = /** @type {any} */ ({}),
  generatedAt = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  const credentials = resolveRedditCredentialEnv(env);
  const apiBatch = summarizeRedditApiReadBatchReport(apiReadBatchReport);
  const routeQueue = summarizeRedditBrowserBridgeRouteQueueReport(browserBridgeRouteQueueReport);
  const browserCumulative = summarizeRedditBrowserBridgeCumulativeReport(browserBridgeCumulativeReport);
  const cookieBuild = summarizeRedditBuildReport(cookieBuildReport);
  const browserBuild = summarizeRedditBuildReport(browserBuildReport);
  const genericRobotsBlocked = robots?.disallowAllForGenericUserAgent === true
    || coverageAudit?.status?.genericLiveCrawl === 'blocked_by_robots';
  const browserStatus = redditBrowserBuildStatus(browserBuild);
  const cookieStatus = redditBrowserBuildStatus(cookieBuild);
  const oauthInputsReady = Boolean(credentials.token && credentials.userAgent);
  const selectedApiPlans = apiBatch?.selectedPlanCount ?? 0;
  const apiCanExecute = oauthInputsReady && selectedApiPlans > 0;
  const browserBridgeCapturedRouteCount = browserCumulative
    ? browserCumulative.capturedUniqueRoutes
    : (browserBuild?.coverage?.browserBridgeCapturedRouteCount ?? 0);
  const browserBridgeMissingRouteCount = browserCumulative
    ? browserCumulative.liveRequiredMissingRoutes
    : (browserBuild?.coverage?.browserBridgeMissingRouteCount ?? 0);
  const browserBridgeRawMissingRouteCount = browserCumulative
    ? browserCumulative.rawMissingUniqueRoutes
    : browserBridgeMissingRouteCount;
  const browserCaptured = browserCumulative
    ? browserCumulative.capturedUniqueRoutes > 0
    : ['captured', 'partial_capture'].includes(String(browserStatus ?? ''));
  const browserCanRetry = browserCaptured && browserBridgeMissingRouteCount > 0;
  const browserBoundaryOnly = browserCaptured
    && browserBridgeMissingRouteCount === 0
    && (browserCumulative?.liveBoundaryRouteCount ?? 0) > 0;
  const liveSuccessCount = (apiBatch?.successCount ?? 0)
    + browserBridgeCapturedRouteCount
    + (browserCumulative ? 0 : (cookieBuild?.coverage?.browserBridgeCapturedRouteCount ?? 0));
  const blockers = [];
  if (genericRobotsBlocked) {
    blockers.push({
      id: 'reddit-generic-live-robots',
      layer: 'generic_live_crawl',
      status: 'blocked',
      reasonCode: 'robots-disallowed',
      operatorActionRequired: false,
      remediation: 'Use official APIs, feeds, or sanitized authorized-source summaries instead of generic crawling while current robots policy disallows the scope.',
    });
  }
  if (!oauthInputsReady) {
    blockers.push({
      id: 'reddit-oauth-inputs-missing',
      layer: 'reddit_oauth_api_runtime',
      status: 'blocked',
      reasonCode: !credentials.token && !credentials.userAgent
        ? 'reddit_oauth_credential_and_user_agent_required'
        : (!credentials.token ? 'reddit_oauth_credential_required' : 'reddit_user_agent_required'),
      operatorActionRequired: true,
      remediation: 'Provide a runtime Reddit OAuth credential and descriptive User-Agent, then run the read-only API batch.',
    });
  }
  if (browserBuild && !browserCaptured) {
    blockers.push({
      id: 'reddit-browser-bridge-not-verified',
      layer: 'browser_bridge',
      status: 'blocked',
      reasonCode: browserBuild.authVerificationStatus ?? browserBuild.reasonCode ?? 'browser_bridge_not_verified',
      operatorActionRequired: true,
      attemptedRoutes: browserBuild.coverage.browserBridgeRouteCount,
      capturedRoutes: browserBuild.coverage.browserBridgeCapturedRouteCount,
      missingRoutes: browserBuild.coverage.browserBridgeMissingRouteCount,
      remediation: 'Verify a default-browser bridge session and retry only Browser Bridge eligible route-queue entries.',
    });
  }
  if (browserCumulative && browserCumulative.liveRequiredMissingRoutes > 0) {
    blockers.push({
      id: 'reddit-browser-bridge-partial-route-coverage',
      layer: 'browser_bridge',
      status: 'partial_captured',
      reasonCode: 'browser-bridge-route-gaps-remain',
      operatorActionRequired: true,
      attemptedRoutes: browserCumulative.attemptedUniqueRoutes,
      capturedRoutes: browserCumulative.capturedUniqueRoutes,
      missingRoutes: browserCumulative.liveRequiredMissingRoutes,
      rawMissingRoutes: browserCumulative.rawMissingUniqueRoutes,
      boundaryDispositionRoutes: browserCumulative.liveBoundaryRouteCount,
      missingByReason: browserCumulative.missingByReason,
      templateResidualsCovered: browserCumulative.templateResidualsCovered,
      templateResidualsUncovered: browserCumulative.remainingUncoveredTemplateRoutes,
      latestAttempt: browserCumulative.latestAttempt,
      remediation: 'Route-family residuals are covered by concrete captures; remaining live gaps are challenge/login-wall routes.',
    });
  }
  if (cookieBuild && !['captured', 'partial_capture'].includes(String(cookieStatus ?? ''))) {
    blockers.push({
      id: 'reddit-cookie-crawl-not-verified',
      layer: 'cookie_crawl',
      status: 'blocked',
      reasonCode: cookieBuild.reasonCode ?? cookieBuild.authVerificationStatus ?? 'cookie_crawl_not_verified',
      operatorActionRequired: true,
      remediation: 'Refresh user-authorized cookie/browser session material through SiteForge without persisting cookie values.',
    });
  }
  const readiness = liveSuccessCount > 0
    ? 'partial_live_evidence'
    : blockers.length > 0 ? 'blocked_external_access_boundary' : 'ready_for_live_execution';
  const readOnlyApiBatchArgs = [
    'src/entrypoints/sites/reddit-action.mjs',
    'api-read-batch',
    commandContext.sourcePath ? '--source' : null,
    commandContext.sourcePath ?? null,
    commandContext.runtimeIndexPath ? '--runtime-index' : null,
    commandContext.runtimeIndexPath ?? null,
    commandContext.outDir ? '--out-dir' : null,
    commandContext.outDir ?? null,
    '--batch-mode',
    'execute-all',
    '--include-parameterized',
    selectedApiPlans > 0 ? '--limit' : null,
    selectedApiPlans > 0 ? String(selectedApiPlans) : null,
    '--json',
  ].filter(Boolean);
  const readOnlyApiBatchCommand = selectedApiPlans > 0 ? `node ${readOnlyApiBatchArgs.join(' ')}` : null;
  const readOnlyApiBatchCommandArgs = selectedApiPlans > 0 ? ['node', ...readOnlyApiBatchArgs] : null;
  const browserBridgeRouteQueueArgs = [
    'src/entrypoints/sites/reddit-action.mjs',
    'browser-bridge-route-queue',
    commandContext.manifestPath ? '--manifest' : null,
    commandContext.manifestPath ?? null,
    commandContext.outDir ? '--out-dir' : null,
    commandContext.outDir ?? null,
    '--json',
  ].filter(Boolean);
  const report = {
    schemaVersion: 1,
    artifactFamily: 'reddit-live-readiness-report',
    generatedAt,
    credentialSource: {
      tokenEnv: credentials.tokenEnv,
      userAgentEnv: credentials.userAgentEnv,
      tokenProvided: Boolean(credentials.token),
      userAgentProvided: Boolean(credentials.userAgent),
      tokenPersisted: false,
      userAgentPersisted: false,
    },
    summary: {
      liveSuccessCount,
      blockerCount: blockers.length,
      selectedApiPlans,
      apiPlansBlocked: apiBatch?.blockedCount ?? 0,
      apiPlansSucceeded: apiBatch?.successCount ?? 0,
      browserBridgeEligibleRoutes: routeQueue?.browserBridgeEligibleRoutes ?? 0,
      browserBridgeCapturedRoutes: browserBridgeCapturedRouteCount,
      browserBridgeMissingRoutes: browserBridgeMissingRouteCount,
      browserBridgeRawMissingRoutes: browserBridgeRawMissingRouteCount,
      browserBridgeBoundaryDispositionRoutes: browserCumulative?.liveBoundaryRouteCount ?? 0,
      browserBridgeLiveRequiredMissingRoutes: browserBridgeMissingRouteCount,
      canExecuteOauthReadBatch: apiCanExecute,
      canRetryBrowserBridgeRoutes: browserCanRetry,
      cookiePersisted: false,
      tokenPersisted: false,
      rawHtmlPersisted: false,
      browserStatePersisted: false,
      ...(browserCumulative ? {
        browserBridgeRemainingEligibleRoutes: browserCumulative.remainingEligibleUniqueRoutes,
        browserBridgeRemainingEligibleByKind: browserCumulative.remainingEligibleByKind,
        browserBridgeRemainingUncoveredTemplateRoutes: browserCumulative.remainingUncoveredTemplateRoutes,
        browserBridgeBoundaryDispositionDetails: browserCumulative.liveBoundaryRoutes,
      } : {}),
    },
    status: {
      fullSiteLiveReadiness: readiness,
      genericLiveCrawl: genericRobotsBlocked ? 'blocked_by_robots' : 'not_blocked_by_supplied_robots_evidence',
      oauthReadBatch: apiCanExecute
        ? 'ready_to_execute_read_only_api_batch'
        : (!oauthInputsReady ? 'blocked_missing_oauth_input' : (selectedApiPlans > 0 ? 'waiting_for_execute' : 'missing_api_batch_plan')),
      browserBridgeRoutes: browserCanRetry
        ? (browserCumulative ? 'challenge_retry_boundary' : 'ready_for_missing_route_retry')
        : (browserCumulative?.status ?? browserStatus ?? (routeQueue ? 'waiting_for_verified_browser_bridge_session' : 'missing_route_queue')),
      cookieCrawl: cookieStatus ?? 'not_verified',
      writeAndMutationActions: 'recorded_disabled_by_default',
    },
    commands: {
      readOnlyApiBatch: apiCanExecute ? readOnlyApiBatchCommand : null,
      readOnlyApiBatchArgs: apiCanExecute ? readOnlyApiBatchCommandArgs : null,
      readOnlyApiBatchAfterOauth: !apiCanExecute && selectedApiPlans > 0 ? readOnlyApiBatchCommand : null,
      readOnlyApiBatchAfterOauthArgs: !apiCanExecute && selectedApiPlans > 0 ? readOnlyApiBatchCommandArgs : null,
      browserBridgeRouteQueue: routeQueue ? `node ${browserBridgeRouteQueueArgs.join(' ')}` : null,
      browserBridgeRouteQueueArgs: routeQueue ? ['node', ...browserBridgeRouteQueueArgs] : null,
      cumulativeBrowserBridgeLiveReport: commandContext.browserCumulativeReportPath ?? null,
    },
    blockers,
    boundaries: browserCumulative?.liveBoundaryRoutes?.length
      ? browserCumulative.liveBoundaryRoutes.map((route) => ({
        id: `reddit-browser-bridge-boundary-${slugify(route.targetRoute, 'route')}`,
        layer: 'browser_bridge',
        status: 'boundary_disposition',
        reasonCode: route.reasonCode,
        targetRoute: route.targetRoute,
        disposition: route.disposition,
        referenceUrl: route.referenceUrl,
        remediation: route.remediation,
      }))
      : [],
    nextSteps: [
      genericRobotsBlocked ? {
        id: 'avoid-generic-crawl',
        status: 'blocked_by_robots',
        action: 'Do not repeat generic Reddit crawling while supplied robots evidence disallows the scope.',
      } : null,
      apiCanExecute ? {
        id: 'execute-oauth-read-batch',
        status: 'ready',
        action: 'Execute read-only Reddit OAuth API batch with runtime credential inputs.',
      } : {
        id: 'provide-oauth-inputs',
        status: oauthInputsReady ? 'not_needed' : 'required',
        action: 'Provide Reddit OAuth credential and descriptive User-Agent as runtime environment inputs.',
      },
      browserCanRetry ? {
        id: browserCumulative ? 'continue-browser-bridge-route-queue' : 'retry-browser-bridge-missing-routes',
        status: browserCumulative ? 'challenge_retry_boundary' : 'ready',
        action: browserCumulative
          ? 'Route-family residuals are covered by concrete captures; further live progress requires challenge/login-wall resolution or OAuth API credentials.'
          : 'Retry missing Browser Bridge eligible routes from the route queue.',
        ...(browserCumulative ? {
          attemptedUniqueRoutes: browserCumulative.attemptedUniqueRoutes,
          capturedUniqueRoutes: browserCumulative.capturedUniqueRoutes,
          missingUniqueRoutes: browserCumulative.liveRequiredMissingRoutes,
          rawMissingUniqueRoutes: browserCumulative.rawMissingUniqueRoutes,
          boundaryDispositionRoutes: browserCumulative.liveBoundaryRouteCount,
          remainingEligibleUniqueRoutes: browserCumulative.remainingEligibleUniqueRoutes,
          remainingUncoveredTemplateRoutes: browserCumulative.remainingUncoveredTemplateRoutes,
          latestAttempt: browserCumulative.latestAttempt,
        } : {}),
      } : browserBoundaryOnly ? {
        id: 'browser-bridge-boundary-disposition',
        status: 'recorded',
        action: 'No Browser Bridge live-required route gaps remain; the remaining raw route gap is a contextual Reddit route boundary.',
        attemptedUniqueRoutes: browserCumulative.attemptedUniqueRoutes,
        capturedUniqueRoutes: browserCumulative.capturedUniqueRoutes,
        rawMissingUniqueRoutes: browserCumulative.rawMissingUniqueRoutes,
        boundaryDispositionRoutes: browserCumulative.liveBoundaryRouteCount,
        boundaryDispositionDetails: browserCumulative.liveBoundaryRoutes,
      } : {
        id: 'verify-browser-bridge-session',
        status: routeQueue ? 'required_before_route_retry' : 'missing_route_queue',
        action: 'Verify Browser Bridge session and robots-allowed route access before retrying authenticated routes.',
      },
    ].filter(Boolean),
  };
  assertNoForbiddenPatterns(report);
  return report;
}

export async function loadRedditJsonArtifact(filePath) {
  if (!filePath) {
    return null;
  }
  return JSON.parse(await readTextFile(path.resolve(String(filePath))));
}

export function countRedditRegisteredRuntimePlans(registry = /** @type {any} */ ({})) {
  let count = 0;
  for (const skill of asArray(registry?.skills)) {
    for (const intent of asArray(skill?.intents)) {
      if (intent?.runtimeMode === REDDIT_OAUTH_READ_RUNTIME_MODE && intent?.executionPlanId) {
        count += 1;
      }
    }
  }
  return count;
}

function runtimeSkillIntentForPlan(plan, { skillId }) {
  const pathSlug = slugify(plan.pathTemplate ?? plan.operationId);
  const slots = asArray(plan.missingPathParameters).map((name) => ({
    name,
    required: true,
    source: 'runtimeParams',
  }));
  return {
    id: `intent:reddit-oauth:${pathSlug}`,
    intentId: `intent:reddit-oauth:${pathSlug}`,
    skillId,
    name: `read Reddit API ${plan.pathTemplate}`,
    description: `Read Reddit OAuth API endpoint ${plan.pathTemplate}.`,
    capabilityId: `capability:reddit-oauth:${pathSlug}`,
    capabilityName: `read Reddit API ${plan.pathTemplate}`,
    capabilityAction: 'view',
    executionPlanId: `plan:reddit-oauth:${pathSlug}`,
    canonicalUtterance: `read Reddit API ${plan.pathTemplate}`,
    utteranceExamples: [
      `read Reddit API ${plan.pathTemplate}`,
      `call Reddit API ${plan.pathTemplate}`,
      `get Reddit API ${plan.pathTemplate}`,
    ],
    negativeExamples: [
      'submit a Reddit post',
      'delete Reddit content',
      'change Reddit account settings',
    ],
    slots,
    safetyLevel: 'read_only',
    invocationScore: 1,
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    promotionClass: REDDIT_OAUTH_READ_RUNTIME_MODE,
    requiresFreshBridgeEvidence: false,
    genericHttpRuntimeAllowed: false,
  };
}

function runtimeSkillCapabilityForPlan(plan, { skillId, siteId }) {
  const pathSlug = slugify(plan.pathTemplate ?? plan.operationId);
  const capabilityId = `capability:reddit-oauth:${pathSlug}`;
  const executionPlanId = `plan:reddit-oauth:${pathSlug}`;
  const executionPlan = {
    ...plan.executionPlan,
    id: executionPlanId,
    capabilityId,
    steps: asArray(plan.executionPlan?.steps).map((step) => ({
      ...step,
      runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
      authBoundary: 'oauth_bearer_token_required',
      persistResponseBody: false,
      persistAuthorization: false,
      persistCookies: false,
    })),
  };
  const inputs = asArray(plan.missingPathParameters).map((name) => ({
    name,
    type: 'string',
    required: true,
    source: 'runtimeParams',
  }));
  return {
    id: capabilityId,
    siteId,
    skillId,
    name: `read Reddit API ${plan.pathTemplate}`,
    description: `Read Reddit OAuth API endpoint ${plan.pathTemplate}.`,
    action: 'view',
    object: `Reddit API ${plan.pathTemplate}`,
    userValue: `Read sanitized summary from Reddit API ${plan.pathTemplate}.`,
    inputs,
    outputs: [{ name: 'sanitized_response_summary', type: 'object' }],
    safetyLevel: 'read_only',
    status: 'active',
    evidenceStatus: 'verified',
    evidence: [{
      type: 'official_docs',
      source: REDDIT_DEV_API_URL,
      operationId: plan.operationId,
      anchorId: plan.anchorId,
      savedMaterial: 'sanitized_summary_only',
    }],
    confidence: 0.9,
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    promotionClass: REDDIT_OAUTH_READ_RUNTIME_MODE,
    requiresFreshBridgeEvidence: false,
    genericHttpRuntimeAllowed: false,
    apiAdapter: {
      runtime: REDDIT_OAUTH_READ_RUNTIME_MODE,
      authBoundary: 'oauth_bearer_token_required',
      responsePolicy: 'sanitized_summary_only',
      requiresFreshBridgeEvidence: false,
      genericHttpRuntimeAllowed: false,
      tokenEnvVars: REDDIT_TOKEN_ENV_VARS,
      userAgentEnvVars: REDDIT_USER_AGENT_ENV_VARS,
    },
    executionPlan,
  };
}

export function buildRedditRuntimeSkillPackage(index, {
  siteId = 'reddit.com-14830d0f',
  skillId = 'reddit-oauth-api-runtime',
  limit = null,
} = /** @type {any} */ ({})) {
  const readyPlans = asArray(index?.plans)
    .filter((plan) => [
      'runtime_plan_ready',
      'runtime_plan_ready_requires_path_parameters',
    ].includes(String(plan?.status ?? '')) && plan?.executionPlan)
    .slice(0, limit === null || limit === undefined ? undefined : Math.max(0, Number(limit) || 0));
  const capabilities = readyPlans.map((plan) => runtimeSkillCapabilityForPlan(plan, { skillId, siteId }));
  const executionPlans = capabilities.map((capability) => capability.executionPlan);
  const intents = readyPlans.map((plan) => runtimeSkillIntentForPlan(plan, { skillId }));
  return {
    schemaVersion: 1,
    artifactFamily: 'reddit-oauth-api-runtime-skill-package',
    generatedAt: new Date().toISOString(),
    siteId,
    skillId,
    runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
    summary: {
      registeredPlanCount: readyPlans.length,
      sourceReadTemplateCount: index?.summary?.readTemplateCount ?? readyPlans.length,
      parameterizedRuntimeTemplateCount: index?.summary?.parameterizedRuntimeTemplateCount ?? 0,
      writeTemplatesDisabled: index?.summary?.writeTemplatesDisabled ?? 0,
    },
    capabilitiesPayload: {
      schemaVersion: 1,
      siteId,
      skillId,
      capabilities,
      summary: {
        total: capabilities.length,
        active: capabilities.length,
      },
    },
    executionPlansPayload: {
      schemaVersion: 1,
      siteId,
      skillId,
      executionPlans,
    },
    intentsPayload: {
      schemaVersion: 1,
      siteId,
      skillId,
      intents,
      summary: {
        total: intents.length,
        callable: intents.length,
      },
    },
    registryRecord: {
      skillId,
      siteId,
      domains: ['oauth.reddit.com', 'reddit.com', 'www.reddit.com'],
      runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
      runtimeModes: [REDDIT_OAUTH_READ_RUNTIME_MODE],
      promotionClass: REDDIT_OAUTH_READ_RUNTIME_MODE,
      requiresFreshBridgeEvidence: false,
      genericHttpRuntimeAllowed: false,
      runtimeRequirements: {
        authMethod: 'oauth_bearer',
        allowedMethods: ['GET'],
        tokenEnvVars: REDDIT_TOKEN_ENV_VARS,
        userAgentEnvVars: REDDIT_USER_AGENT_ENV_VARS,
        tokenPersisted: false,
        cookieMaterialAllowed: false,
        savedMaterial: 'sanitized_summary_only',
      },
      runtimeSummary: {
        redditOauthReadIntents: intents.length,
        genericHttpReadIntents: 0,
        browserBridgeRequiredIntents: 0,
        runtimeIneligibleIntents: 0,
      },
      intents: intents.map((intent) => ({
        intentId: intent.intentId,
        name: intent.name,
        capabilityId: intent.capabilityId,
        capabilityName: intent.capabilityName,
        capabilityAction: intent.capabilityAction,
        executionPlanId: intent.executionPlanId,
        runtimeBindingId: null,
        canonicalUtterance: intent.canonicalUtterance,
        utteranceExamples: intent.utteranceExamples,
        slots: intent.slots,
        safetyLevel: intent.safetyLevel,
        invocationScore: intent.invocationScore,
        runtimeMode: REDDIT_OAUTH_READ_RUNTIME_MODE,
        promotionClass: REDDIT_OAUTH_READ_RUNTIME_MODE,
        requiresFreshBridgeEvidence: false,
        genericHttpRuntimeAllowed: false,
      })),
      verificationStatus: 'passed',
    },
  };
}

export async function writeRedditRuntimeSkillRegistration({
  index,
  siteDir,
  registryPath = null,
  skillDir = null,
  siteId = 'reddit.com-14830d0f',
  skillId = 'reddit-oauth-api-runtime',
  limit = null,
} = /** @type {any} */ ({})) {
  const root = path.resolve(String(siteDir ?? ''));
  if (!siteDir || !root) {
    throw new Error('siteDir is required for Reddit runtime registration');
  }
  const resolvedRegistryPath = path.resolve(String(registryPath ?? path.join(root, 'registry.json')));
  const resolvedSkillDir = path.resolve(String(skillDir ?? path.join(root, 'reddit-oauth-api-runtime')));
  const normalizedRoot = `${root}${path.sep}`;
  for (const target of [resolvedRegistryPath, resolvedSkillDir]) {
    if (target !== root && !target.startsWith(normalizedRoot)) {
      throw new Error('Reddit runtime registration targets must stay inside the SiteForge site directory');
    }
  }

  const packagePayload = buildRedditRuntimeSkillPackage(index, { siteId, skillId, limit });
  let registry = null;
  try {
    registry = await loadRedditJsonArtifact(resolvedRegistryPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  registry ??= {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    skills: [],
  };
  const skillDirRelative = path.relative(process.cwd(), resolvedSkillDir).replace(/\\/gu, '/');
  const artifactDirRelative = path.relative(process.cwd(), resolvedSkillDir).replace(/\\/gu, '/');
  const registryRecord = {
    ...packagePayload.registryRecord,
    skillDir: skillDirRelative,
    artifactDir: artifactDirRelative,
  };
  const nextRegistry = {
    ...registry,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    skills: [
      ...asArray(registry.skills).filter((entry) => entry?.skillId !== skillId),
      registryRecord,
    ].sort((left, right) => String(left.skillId).localeCompare(String(right.skillId), 'en')),
  };
  assertNoForbiddenPatterns(packagePayload);
  assertNoForbiddenPatterns(nextRegistry);

  await ensureDir(resolvedSkillDir);
  await writeTextFile(path.join(resolvedSkillDir, 'capabilities.json'), JSON.stringify(packagePayload.capabilitiesPayload, null, 2));
  await writeTextFile(path.join(resolvedSkillDir, 'execution_plans.json'), JSON.stringify(packagePayload.executionPlansPayload, null, 2));
  await writeTextFile(path.join(resolvedSkillDir, 'intents.json'), JSON.stringify(packagePayload.intentsPayload, null, 2));
  await writeTextFile(resolvedRegistryPath, JSON.stringify(nextRegistry, null, 2));
  return {
    siteDir: root,
    registryPath: resolvedRegistryPath,
    skillDir: resolvedSkillDir,
    skillId,
    registeredPlanCount: packagePayload.summary.registeredPlanCount,
    registeredRuntimePlanCount: countRedditRegisteredRuntimePlans(nextRegistry),
  };
}

export async function writeRedditApiCatalogArtifacts(catalog, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_api_catalog.json');
  const auditPath = path.join(root, 'reddit_api_catalog.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_api_catalog.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(catalog);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditApiCatalogMarkdown(catalog));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditApiPlanArtifact(plan, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const filePath = path.join(root, 'reddit_api_request_plan.json');
  const auditPath = path.join(root, 'reddit_api_request_plan.redaction-audit.json');
  const prepared = prepareRedactedArtifactJsonWithAudit(plan);
  await writeTextFile(filePath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  return { filePath, auditPath };
}

export async function writeRedditCoverageAuditArtifacts(audit, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_link_function_api_coverage_audit.json');
  const auditPath = path.join(root, 'reddit_link_function_api_coverage_audit.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_link_function_api_coverage_audit.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(audit);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditCoverageAuditMarkdown(audit));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditRuntimePlanIndexArtifacts(index, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_oauth_api_runtime_plan_index.json');
  const auditPath = path.join(root, 'reddit_oauth_api_runtime_plan_index.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_oauth_api_runtime_plan_index.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(index);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditRuntimePlanIndexMarkdown(index));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditApiReadBatchReportArtifacts(report, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_api_read_batch_report.json');
  const auditPath = path.join(root, 'reddit_api_read_batch_report.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_api_read_batch_report.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(report);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditApiReadBatchReportMarkdown(report));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditAuthorizedSourceConfigArtifacts(config, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_authorized_source_config.json');
  const auditPath = path.join(root, 'reddit_authorized_source_config.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_authorized_source_config.md');
  const localConfigPath = path.join(root, 'siteforge.local.json');
  const manifestPath = path.join(root, 'authorized_source_manifest.json');
  const manifestAuditPath = path.join(root, 'authorized_source_manifest.redaction-audit.json');
  const prepared = prepareRedactedArtifactJsonWithAudit(config);
  const localPrepared = prepareRedactedArtifactJsonWithAudit(config.siteforgeLocalConfig);
  const manifestPrepared = prepareRedactedArtifactJsonWithAudit(buildRedditAuthorizedSourceManifest(config));
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditAuthorizedSourceConfigMarkdown(config));
  await writeTextFile(localConfigPath, localPrepared.json);
  await writeTextFile(manifestPath, manifestPrepared.json);
  await writeTextFile(manifestAuditPath, manifestPrepared.auditJson);
  return { jsonPath, auditPath, markdownPath, localConfigPath, manifestPath, manifestAuditPath };
}

export async function writeRedditBrowserBridgeRouteQueueArtifacts(report, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_browser_bridge_route_queue.json');
  const auditPath = path.join(root, 'reddit_browser_bridge_route_queue.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_browser_bridge_route_queue.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(report);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditBrowserBridgeRouteQueueMarkdown(report));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditLiveReadinessReportArtifacts(report, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_live_readiness_report.json');
  const auditPath = path.join(root, 'reddit_live_readiness_report.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_live_readiness_report.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(report);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditLiveReadinessReportMarkdown(report));
  return { jsonPath, auditPath, markdownPath };
}

export async function writeRedditComprehensiveCoverageReportArtifacts(report, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_comprehensive_execution_coverage_report.json');
  const auditPath = path.join(root, 'reddit_comprehensive_execution_coverage_report.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_comprehensive_execution_coverage_report.md');
  const prepared = prepareRedactedArtifactJsonWithAudit(report);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditComprehensiveCoverageReportMarkdown(report));
  return { jsonPath, auditPath, markdownPath };
}

export function renderRedditLiveReadinessReportMarkdown(report) {
  return [
    '# Reddit Live Readiness Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Summary:',
    `- Live successes: ${report.summary.liveSuccessCount}`,
    `- Blockers: ${report.summary.blockerCount}`,
    `- Selected API plans: ${report.summary.selectedApiPlans}`,
    `- API plans blocked: ${report.summary.apiPlansBlocked}`,
    `- API plans succeeded: ${report.summary.apiPlansSucceeded}`,
    `- Browser Bridge eligible routes: ${report.summary.browserBridgeEligibleRoutes}`,
    `- Browser Bridge captured routes: ${report.summary.browserBridgeCapturedRoutes}`,
    `- Browser Bridge missing routes: ${report.summary.browserBridgeMissingRoutes}`,
    `- Browser Bridge raw missing routes: ${report.summary.browserBridgeRawMissingRoutes ?? report.summary.browserBridgeMissingRoutes}`,
    `- Browser Bridge boundary dispositions: ${report.summary.browserBridgeBoundaryDispositionRoutes ?? 0}`,
    `- Can execute OAuth read batch: ${report.summary.canExecuteOauthReadBatch}`,
    `- Can retry Browser Bridge routes: ${report.summary.canRetryBrowserBridgeRoutes}`,
    '',
    'Status:',
    ...Object.entries(report.status ?? {}).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Blockers:',
    ...asArray(report.blockers).map((blocker) => `- ${blocker.layer}: ${blocker.reasonCode}; ${blocker.remediation ?? ''}`),
    '',
    'Boundary dispositions:',
    ...asArray(report.boundaries).map((boundary) => `- ${boundary.targetRoute}: ${boundary.reasonCode}; ${boundary.remediation ?? ''}`),
    '',
    'Next steps:',
    ...asArray(report.nextSteps).map((step) => `- ${step.id}: ${step.status}; ${step.action}`),
    '',
    'Commands:',
    `- readOnlyApiBatch: ${report.commands?.readOnlyApiBatch ?? 'blocked_until_oauth_inputs'}`,
    `- readOnlyApiBatchAfterOauth: ${report.commands?.readOnlyApiBatchAfterOauth ?? 'not_available'}`,
    `- browserBridgeRouteQueue: ${report.commands?.browserBridgeRouteQueue ?? 'not_available'}`,
    '',
    'Execution boundary:',
    '- This report stores only readiness booleans, counts, route classes, and public command templates.',
    '- Runtime credentials, cookies, browser state, raw HTML, and response bodies are not persisted.',
    '- Write and mutation actions remain recorded but disabled by default.',
    '',
  ].join('\n');
}

export function renderRedditBrowserBridgeRouteQueueMarkdown(report) {
  return [
    '# Reddit Browser Bridge Route Queue',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Summary:',
    `- Candidate routes: ${report.summary.totalCandidateRoutes}`,
    `- Selected routes: ${report.summary.selectedRoutes}`,
    `- Concrete routes: ${report.summary.concreteRouteCount}`,
    `- Route-template-only entries: ${report.summary.routeTemplateOnlyCount}`,
    `- Browser Bridge eligible routes: ${report.summary.browserBridgeEligibleRoutes}`,
    `- Public routes: ${report.summary.publicCandidateRoutes}`,
    `- Auth/private routes: ${report.summary.authPrivateCandidateRoutes}`,
    `- Auth entry routes: ${report.summary.authEntryCandidateRoutes}`,
    `- Moderator-limited routes: ${report.summary.moderatorLimitedCandidateRoutes}`,
    `- Browser boundary routes: ${report.summary.browserBoundaryCandidateRoutes ?? 0}`,
    `- Write-disabled routes: ${report.summary.writeDisabledCandidateRoutes}`,
    `- API-disabled routes: ${report.summary.apiDisabledRoutes}`,
    '',
    'Execution boundary:',
    '- The queue is derived from sanitized authorized route/link/form/control summaries.',
    '- Browser Bridge may use operator-authorized cookies at runtime, but cookies and browser profile data are not persisted.',
    '- Write and mutation routes are retained for coverage and disabled by default.',
    '- Official API reads remain on the Reddit OAuth runtime boundary.',
    '',
  ].join('\n');
}

export function renderRedditAuthorizedSourceConfigMarkdown(config) {
  return [
    '# Reddit Authorized Source Config',
    '',
    `Generated: ${config.generatedAt}`,
    '',
    'Summary:',
    `- Sources: ${config.summary.sources}`,
    `- Structure pages: ${config.summary.structurePages}`,
    `- Site surface pages: ${config.summary.siteSurfacePages}`,
    `- Site surface forms: ${config.summary.siteSurfaceForms}`,
    `- Site surface controls: ${config.summary.siteSurfaceControls}`,
    `- Official API operation pages: ${config.summary.officialApiOperationPages}`,
    `- Read operation pages: ${config.summary.readOperationPages}`,
    `- Disabled write operation pages: ${config.summary.writeOperationPagesDisabled}`,
    '',
    'Execution boundary:',
    '- This is a sanitized authorized-source structure input for SiteForge build.',
    '- It does not permit generic crawling when robots disallows the target.',
    '- It does not persist cookies, authorization material, raw HTML, raw DOM, or browser profile data.',
    '',
  ].join('\n');
}

export function renderRedditApiCatalogMarkdown(catalog) {
  const scopes = Object.entries(catalog.oauthScopeCounts ?? {})
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 20)
    .map(([scope, count]) => `- ${scope}: ${count}`)
    .join('\n');
  return [
    '# Reddit Official API Catalog',
    '',
    `Operations: ${catalog.operationCount}`,
    `OAuth endpoint templates: ${catalog.templateExpansionSummary?.oauthEndpointTemplateCount ?? 0}`,
    `GET templates: ${catalog.executableSummary?.getTemplates ?? 0}`,
    `Site action read runtime templates: ${catalog.executableSummary?.siteActionReadRuntimeTemplates ?? 0}`,
    `Runtime-ready api_request plans: ${catalog.executableSummary?.runtimeReadyApiRequestPlans ?? 0}`,
    `Write templates disabled: ${catalog.executableSummary?.writeTemplatesRecordedDisabled ?? 0}`,
    '',
    'Method counts:',
    ...Object.entries(catalog.methodCounts ?? {}).sort().map(([method, count]) => `- ${method}: ${count}`),
    '',
    'Top OAuth scopes:',
    scopes,
    '',
    'Execution boundary:',
    '- GET operations require an operator-supplied Reddit OAuth bearer token and descriptive User-Agent.',
    '- Non-GET operations are recorded as disabled templates and are not auto-executed.',
    '',
  ].join('\n');
}

export function renderRedditCoverageAuditMarkdown(audit) {
  return [
    '# Reddit Link / Function / API Coverage Audit',
    '',
    `Generated: ${audit.generatedAt}`,
    '',
    `Official API operations: ${audit.summary.apiOperations}`,
    `OAuth endpoint templates: ${audit.summary.oauthEndpointTemplates}`,
    `Read templates executable with OAuth: ${audit.summary.apiReadTemplatesExecutableWithOauth}`,
    `Runtime-ready api_request plans: ${audit.summary.runtimeReadyApiRequestPlans}`,
    `Write templates disabled: ${audit.summary.apiWriteTemplatesDisabled}`,
    `Authorized source route templates: ${audit.summary.authorizedSourceRouteTemplates}`,
    `Authorized source links: ${audit.summary.authorizedSourceUniqueLinks}`,
    `Authorized source forms: ${audit.summary.authorizedSourceForms}`,
    `Build graph nodes: ${audit.summary.buildGraphNodeCount ?? 'n/a'}`,
    `Build capabilities: ${audit.summary.buildCapabilityCount ?? 'n/a'}`,
    `Build intents: ${audit.summary.buildIntentCount ?? 'n/a'}`,
    `Registered generic api_request plans: ${audit.summary.registeredApiRequestPlans}`,
    '',
    'Status:',
    ...Object.entries(audit.status ?? {}).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Requirement audit:',
    ...asArray(audit.requirementAudit).map((item) => `- ${item.requirement}: ${item.status}; evidence=${item.evidenceCount}`),
    '',
  ].join('\n');
}

export function renderRedditRuntimePlanIndexMarkdown(index) {
  return [
    '# Reddit OAuth API Runtime Plan Index',
    '',
    `Generated: ${index.generatedAt}`,
    '',
    `Read templates: ${index.summary?.readTemplateCount ?? 0}`,
    `Concrete runtime plans: ${index.summary?.concreteRuntimePlanCount ?? 0}`,
    `Parameterized runtime templates: ${index.summary?.parameterizedRuntimeTemplateCount ?? 0}`,
    `Write templates disabled: ${index.summary?.writeTemplatesDisabled ?? 0}`,
    `Runtime mode: ${index.runtimeMode}`,
    '',
    'Execution boundary:',
    '- Runtime plans require an operator-supplied Reddit OAuth bearer token and descriptive User-Agent.',
    '- Response bodies are summarized only; authorization, cookies, and response bodies are not persisted.',
    '- Parameterized templates must be bound to explicit path parameters before execution.',
    '',
  ].join('\n');
}

export function renderRedditApiReadBatchReportMarkdown(report) {
  return [
    '# Reddit API Read Batch Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Summary:',
    `- Mode: ${report.mode}`,
    `- Selected plans: ${report.summary.selectedPlanCount}`,
    `- Selected concrete plans: ${report.summary.selectedConcretePlanCount}`,
    `- Selected parameterized plans: ${report.summary.selectedParameterizedPlanCount}`,
    `- Executed plans: ${report.summary.executedCount}`,
    `- Successes: ${report.summary.successCount}`,
    `- Blocked: ${report.summary.blockedCount}`,
    `- Missing credential blocks: ${report.summary.missingCredentialBlockedCount}`,
    `- Concrete attempted: ${report.summary.concreteExecutedCount}`,
    `- Concrete succeeded: ${report.summary.concreteSuccessCount}`,
    `- Concrete blocked: ${report.summary.concreteBlockedCount}`,
    `- Parameterized attempted: ${report.summary.parameterizedExecutedCount}`,
    `- Parameterized succeeded: ${report.summary.parameterizedSuccessCount}`,
    `- Parameterized blocked: ${report.summary.parameterizedBlockedCount}`,
    `- Parameterized seed missing: ${report.summary.parameterizedSeedMissingCount}`,
    `- Parameterized placeholder-only bindings: ${report.summary.parameterizedPlaceholderOnlyCount}`,
    `- Parameterized plan-only templates: ${report.summary.parameterizedPlanOnlyCount}`,
    `- Parameterized live-executable templates after credentials: ${report.summary.parameterizedLiveExecutableCount}`,
    '',
    'Status:',
    ...Object.entries(report.status ?? {}).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Execution boundary:',
    '- Only GET Reddit OAuth API runtime plans are selected.',
    '- OAuth bearer token and User-Agent are runtime inputs only and are not persisted.',
    '- Response bodies are summarized only; raw response bodies, cookies, and authorization are not persisted.',
    '- Parameter values are used only for endpoint resolution and are not persisted in this report.',
    '',
  ].join('\n');
}

export function renderRedditComprehensiveCoverageReportMarkdown(report) {
  return [
    '# Reddit Comprehensive Execution Coverage Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Summary:',
    `- Official API operations: ${report.summary.officialApiOperations}`,
    `- OAuth endpoint templates: ${report.summary.oauthEndpointTemplates}`,
    `- Read API templates: ${report.summary.readApiTemplates}`,
    `- Registered API request plans: ${report.summary.registeredApiRequestPlans}`,
    `- Concrete runtime plans: ${report.summary.concreteRuntimePlans}`,
    `- Parameterized runtime templates: ${report.summary.parameterizedRuntimeTemplates}`,
    `- API batch report present: ${report.summary.apiBatchReportPresent}`,
    `- API batch selected concrete plans: ${report.summary.apiConcreteGetBatchPlans}`,
    `- API batch selected parameterized plans: ${report.summary.apiParameterizedGetBatchPlans}`,
    `- API concrete batch attempted: ${report.summary.apiConcreteGetBatchAttempted}`,
    `- API concrete batch succeeded: ${report.summary.apiConcreteGetBatchSucceeded}`,
    `- API concrete batch blocked: ${report.summary.apiConcreteGetBatchBlocked}`,
    `- API parameterized batch attempted: ${report.summary.apiParameterizedGetBatchAttempted}`,
    `- API parameterized batch succeeded: ${report.summary.apiParameterizedGetBatchSucceeded}`,
    `- API parameterized batch blocked: ${report.summary.apiParameterizedGetBatchBlocked}`,
    `- API parameterized batch plan-only: ${report.summary.apiParameterizedGetBatchPlanOnly}`,
    `- API parameterized batch live-executable after credentials: ${report.summary.apiParameterizedGetBatchLiveExecutable}`,
    `- Disabled write/API mutation templates: ${report.summary.writeApiTemplatesDisabled}`,
    `- Authorized source pages: ${report.summary.authorizedSourcePages}`,
    `- Authorized source links: ${report.summary.authorizedSourceLinks}`,
    `- Authorized source route templates: ${report.summary.authorizedSourceRouteTemplates}`,
    `- Authorized source forms: ${report.summary.authorizedSourceForms}`,
    `- Authorized source controls: ${report.summary.authorizedSourceControls}`,
    `- Public-only build capabilities: ${report.summary.publicOnlyBuildCapabilities}`,
    `- Public-only build intents: ${report.summary.publicOnlyBuildIntents}`,
    `- Authorized-source build capabilities: ${report.summary.authorizedSourceBuildCapabilities}`,
    `- Authorized-source build intents: ${report.summary.authorizedSourceBuildIntents}`,
    `- Authorized-source build nodes: ${report.summary.authorizedSourceBuildNodes}`,
    `- Full-site live successes: ${report.summary.fullSiteLiveSuccessCount ?? 0}`,
    `- Full-site resolved routes: ${report.summary.fullSiteLiveResolvedRouteCount ?? report.summary.fullSiteLiveSuccessCount ?? 0}`,
    `- Full-site live blockers: ${report.summary.fullSiteLiveBlockerCount ?? 0}`,
    `- Browser Bridge route-queue candidates: ${report.summary.browserBridgeRouteQueueCandidates ?? 0}`,
    `- Browser Bridge route-queue eligible: ${report.summary.browserBridgeRouteQueueEligible ?? 0}`,
    `- Browser Bridge raw missing routes: ${report.summary.browserBridgeRawMissingRouteCount ?? report.summary.browserBridgeMissingRouteCount ?? 0}`,
    `- Browser Bridge live-required missing routes: ${report.summary.browserBridgeLiveRequiredMissingRouteCount ?? report.summary.browserBridgeMissingRouteCount ?? 0}`,
    `- Browser Bridge boundary dispositions: ${report.summary.browserBridgeBoundaryDispositionRouteCount ?? 0}`,
    '',
    'Status:',
    ...Object.entries(report.status ?? {}).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Full-site live blockers:',
    ...asArray(report.evidence?.fullSiteLive?.blockers).map((blocker) => `- ${blocker.layer}: ${blocker.reasonCode}; ${blocker.remediation ?? ''}`),
    '',
    'Full-site live boundary dispositions:',
    ...asArray(report.evidence?.fullSiteLive?.boundaries).map((boundary) => `- ${boundary.targetRoute}: ${boundary.reasonCode}; ${boundary.remediation ?? ''}`),
    '',
    'Next live steps:',
    ...asArray(report.evidence?.fullSiteLive?.nextSteps).map((step) => `- ${step.id}: ${step.status}; ${step.action}`),
    '',
    'Requirement audit:',
    ...asArray(report.requirementAudit).map((item) => `- ${item.requirement}: ${item.status}; evidence=${item.evidenceCount}; ${item.evidence}`),
    '',
    'Execution boundary:',
    '- Full generic live crawl remains incomplete unless current robots and access controls allow it.',
    '- Cookie and Browser Bridge evidence is reported separately from official OAuth API runtime evidence.',
    '- Reddit OAuth GET execution requires runtime OAuth credential, descriptive User-Agent, and explicit path parameters for parameterized templates.',
    '- State-changing Reddit APIs remain recorded but disabled by default.',
    '',
  ].join('\n');
}
