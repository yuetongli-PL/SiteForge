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
const REDDIT_AUTHORIZED_SOURCE_OPERATION_CHUNK_SIZE = 40;

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
      routeTemplates: ['/', '/best', '/hot', '/new', '/top', '/r/:subreddit', '/search'],
      links: [
        { href: '/', label: 'Home feed', semanticKind: 'feed', routeTemplate: '/' },
        { href: '/best', label: 'Best posts', semanticKind: 'ranking', routeTemplate: '/best' },
        { href: '/hot', label: 'Hot posts', semanticKind: 'ranking', routeTemplate: '/hot' },
        { href: '/new', label: 'New posts', semanticKind: 'feed', routeTemplate: '/new' },
        { href: '/top', label: 'Top posts', semanticKind: 'ranking', routeTemplate: '/top' },
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
          visibleItemCount: 6,
          listPresent: true,
          routeTemplates: ['/', '/best', '/hot', '/new', '/top', '/search'],
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
      routeTemplates: ['/search', '/r/:subreddit', '/r/:subreddit/comments/:article', '/user/:username'],
      links: [
        { href: '/search/?q=siteforge', label: 'Search results', semanticKind: 'search', routeTemplate: '/search' },
        { href: '/r/siteforge', label: 'Community result', semanticKind: 'category', routeTemplate: '/r/:subreddit' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'search_result_list',
          labelSummary: 'post community and profile results',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article', '/r/:subreddit', '/user/:username'],
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
      routeTemplates: ['/r/:subreddit', '/r/:subreddit/comments/:article', '/r/:subreddit/search', '/r/:subreddit/wiki/:page'],
      links: [
        { href: '/r/siteforge/hot', label: 'Community hot posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/hot' },
        { href: '/r/siteforge/new', label: 'Community new posts', semanticKind: 'feed', routeTemplate: '/r/:subreddit/new' },
        { href: '/r/siteforge/top', label: 'Community top posts', semanticKind: 'ranking', routeTemplate: '/r/:subreddit/top' },
        { href: '/r/siteforge/search?q=siteforge', label: 'Search community', semanticKind: 'search', routeTemplate: '/r/:subreddit/search' },
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
          visibleItemCount: 4,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/hot', '/r/:subreddit/new', '/r/:subreddit/top', '/r/:subreddit/search'],
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
      routeTemplates: ['/r/:subreddit/comments/:article', '/user/:username', '/r/:subreddit'],
      links: [
        { href: '/r/siteforge', label: 'Post community', semanticKind: 'category', routeTemplate: '/r/:subreddit' },
        { href: '/user/reddit', label: 'Post author', semanticKind: 'profile', routeTemplate: '/user/:username' },
      ],
      structureItems: [
        {
          nodeType: 'content',
          structureType: 'post_body_summary',
          labelSummary: 'post title body and metadata',
          visibleItemCount: 1,
          listPresent: false,
          routeTemplates: ['/r/:subreddit/comments/:article'],
        },
        {
          nodeType: 'component',
          structureType: 'comment_tree',
          labelSummary: 'comment list and reply structure',
          visibleItemCount: 35,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article'],
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
      routeTemplates: ['/user/:username', '/user/:username/posts', '/user/:username/comments', '/r/:subreddit/comments/:article'],
      links: [
        { href: '/user/reddit/posts', label: 'User posts', semanticKind: 'profile_feed', routeTemplate: '/user/:username/posts' },
        { href: '/user/reddit/comments', label: 'User comments', semanticKind: 'profile_feed', routeTemplate: '/user/:username/comments' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'profile_activity_list',
          labelSummary: 'profile posts and comments',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/comments/:article'],
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
      routeTemplates: ['/message/inbox', '/message/sent', '/message/unread'],
      links: [
        { href: '/message/inbox', label: 'Inbox', semanticKind: 'authenticated_read', routeTemplate: '/message/inbox' },
        { href: '/message/sent', label: 'Sent messages', semanticKind: 'authenticated_read', routeTemplate: '/message/sent' },
        { href: '/message/unread', label: 'Unread messages', semanticKind: 'authenticated_read', routeTemplate: '/message/unread' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'private_message_list_summary',
          labelSummary: 'message list structure only',
          visibleItemCount: 20,
          listPresent: true,
          routeTemplates: ['/message/inbox', '/message/sent', '/message/unread'],
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
      routeTemplates: ['/settings', '/settings/account', '/settings/privacy', '/settings/profile', '/prefs'],
      links: [
        { href: '/settings/account', label: 'Account settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/account' },
        { href: '/settings/privacy', label: 'Privacy settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/privacy' },
        { href: '/settings/profile', label: 'Profile settings', semanticKind: 'authenticated_settings', routeTemplate: '/settings/profile' },
        { href: '/prefs', label: 'Classic preferences', semanticKind: 'authenticated_settings', routeTemplate: '/prefs' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'settings_navigation_summary',
          labelSummary: 'settings tabs and sections',
          visibleItemCount: 8,
          listPresent: true,
          routeTemplates: ['/settings/account', '/settings/privacy', '/settings/profile', '/prefs'],
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
      routeTemplates: ['/submit', '/r/:subreddit/submit'],
      links: [
        { href: '/submit', label: 'Create post entry', semanticKind: 'write_entry_disabled', routeTemplate: '/submit' },
        { href: '/r/siteforge/submit', label: 'Community create post entry', semanticKind: 'write_entry_disabled', routeTemplate: '/r/:subreddit/submit' },
      ],
      structureItems: [
        {
          nodeType: 'operation',
          structureType: 'submit_form_disabled_summary',
          labelSummary: 'post creation form structure only; no submit action',
          visibleItemCount: 3,
          listPresent: true,
          routeTemplates: ['/submit', '/r/:subreddit/submit'],
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
        '/r/:subreddit/about/modqueue',
        '/r/:subreddit/about/reports',
        '/r/:subreddit/about/spam',
        '/r/:subreddit/about/log',
      ],
      links: [
        { href: '/r/siteforge/about/modqueue', label: 'Moderation queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/modqueue' },
        { href: '/r/siteforge/about/reports', label: 'Reports', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/reports' },
        { href: '/r/siteforge/about/spam', label: 'Spam queue', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/spam' },
        { href: '/r/siteforge/about/log', label: 'Moderation log', semanticKind: 'moderation_read', routeTemplate: '/r/:subreddit/about/log' },
      ],
      structureItems: [
        {
          nodeType: 'component',
          structureType: 'moderation_queue_summary',
          labelSummary: 'moderation queue list structure only',
          visibleItemCount: 8,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/about/modqueue', '/r/:subreddit/about/reports', '/r/:subreddit/about/spam', '/r/:subreddit/about/log'],
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
      routeTemplates: ['/r/:subreddit/wiki/:page', '/r/:subreddit/wiki/pages', '/r/:subreddit/wiki/revisions/:page'],
      links: [
        { href: '/r/siteforge/wiki/index', label: 'Community wiki page', semanticKind: 'wiki_read', routeTemplate: '/r/:subreddit/wiki/:page' },
        { href: '/r/siteforge/wiki/pages', label: 'Community wiki pages', semanticKind: 'wiki_read', routeTemplate: '/r/:subreddit/wiki/pages' },
      ],
      structureItems: [
        {
          nodeType: 'content',
          structureType: 'wiki_content_summary',
          labelSummary: 'wiki content and revision navigation',
          visibleItemCount: 12,
          listPresent: true,
          routeTemplates: ['/r/:subreddit/wiki/:page', '/r/:subreddit/wiki/pages', '/r/:subreddit/wiki/revisions/:page'],
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
  const surfacePages = redditSurfaceStructurePages();
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
  const coverage = report.coverage ?? report.summary?.coverage ?? {};
  const counts = report.counts ?? {};
  const summary = report.summary ?? {};
  const browserBridge = coverage.browserBridge ?? report.authStateReport?.browserBridge ?? {};
  return {
    status: report.status ?? report.result_status ?? report.resultStatus ?? null,
    resultStatus: report.result_status ?? report.resultStatus ?? null,
    reasonCode: report.reasonCode ?? report.reason_code ?? summary.verificationReasonCode ?? null,
    reason: report.reason ?? null,
    authMethod: report.authMethod ?? summary.auth?.authMethod ?? coverage.authMethod ?? report.authStateReport?.authMethod ?? null,
    authVerificationStatus: report.authVerificationStatus ?? summary.auth?.authVerificationStatus ?? coverage.authVerificationStatus ?? report.authStateReport?.authVerificationStatus ?? null,
    blockingSignals: asArray(report.blockingSignals ?? report.authStateReport?.blockingSignals),
    positiveSignals: asArray(report.positiveSignals ?? report.authStateReport?.positiveSignals),
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
  if (['browser_verified', 'browser_verified_partial'].includes(authStatus)) {
    return Number(build.coverage?.browserBridgeMissingRouteCount ?? 0) > 0
      ? 'partial_capture'
      : 'captured';
  }
  if (
    authStatus === 'browser_blocked'
    && (signals.has('robots-disallowed')
      || signals.has('browser-bridge-robots-disallowed')
      || signals.has('browser-bridge-all-routes-robots-disallowed'))
  ) {
    return 'blocked_by_robots';
  }
  if (authStatus === 'browser_blocked') {
    return 'blocked';
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

export function buildRedditComprehensiveCoverageReport(catalog, {
  coverageAudit = null,
  runtimeIndex = null,
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
  const runtimeSummary = runtimeIndex?.summary ?? {};
  const registeredPlans = Math.max(
    Number(registrySummary.registeredApiRequestPlans ?? 0) || 0,
    Number(coverageAudit?.summary?.registeredApiRequestPlans ?? 0) || 0,
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
      } : null,
    },
  };
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
      authorizedSourcePages,
      authorizedSourceRouteTemplates,
      authorizedSourceLinks,
      authorizedSourceForms,
      authorizedSourceControls,
      publicOnlyBuildCapabilities: publicBuild?.graph?.capabilities ?? 0,
      publicOnlyBuildIntents: publicBuild?.graph?.intents ?? 0,
      authorizedSourceBuildCapabilities: authorizedSourceBuild?.graph?.capabilities ?? 0,
      authorizedSourceBuildIntents: authorizedSourceBuild?.graph?.intents ?? 0,
      authorizedSourceBuildNodes: authorizedSourceBuild?.graph?.nodes ?? 0,
      cookieBuildStatus: cookieBuild?.status ?? null,
      browserBridgeBuildStatus: browserBuild?.status ?? null,
      browserBridgeRouteCount: browserBuild?.coverage?.browserBridgeRouteCount ?? 0,
      browserBridgeCapturedRouteCount: browserBuild?.coverage?.browserBridgeCapturedRouteCount ?? 0,
      browserBridgeMissingRouteCount: browserBuild?.coverage?.browserBridgeMissingRouteCount ?? 0,
      sessionHealthStatus: session?.status ?? null,
      siteDoctorCaptureStatus: doctor?.captureStatus ?? null,
    },
    status: {
      genericLiveCrawl: robots?.disallowAllForGenericUserAgent === true ? 'blocked_by_robots' : (coverageAudit?.status?.genericLiveCrawl ?? 'not_verified'),
      cookieCrawl: cookieBuild?.reasonCode === 'cookie_blocked' ? 'blocked_cookie_not_verified' : (cookieBuild?.status ?? 'not_run'),
      browserBridgeAuthenticatedRoute: redditBrowserBuildStatus(browserBuild)
        ?? (doctor?.sessionHealthStatus === 'manual-required' || session?.status === 'manual-required'
        ? 'manual_profile_required'
        : (doctor?.sessionReuseWorked ? 'session_probe_available_capture_runtime_removed' : 'not_available')),
      siteDoctor: doctor?.captureStatus === 'fail' ? 'profile_and_crawler_passed_capture_runtime_removed' : (doctor?.captureStatus ?? 'not_run'),
      officialApiCatalog: operations.length > 0 ? 'covered_from_official_docs' : 'missing',
      oauthReadRuntime: registeredPlans >= readOperations.length ? 'registered' : 'partial_or_not_registered',
      authorizedSourceBuild: authorizedSourceBuild
        ? (authorizedSourceBuild.status === 'partial_success' ? 'partial_success' : authorizedSourceBuild.status)
        : 'not_run',
      writeAndMutationActions: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
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
        requirement: 'Use configured Reddit cookie / Browser Bridge path',
        status: redditBrowserBuildStatus(browserBuild)
          ?? (cookieBuild?.reasonCode === 'cookie_blocked' ? 'blocked_cookie_not_verified' : 'not_verified'),
        evidenceCount: (cookieBuild ? 1 : 0) + (browserBuild ? 1 : 0),
        evidence: browserBuild
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
        requirement: 'Keep write/state-changing Reddit functions non-auto-executable',
        status: writeOperations.length > 0 ? 'recorded_disabled_by_default' : 'none_detected',
        evidenceCount: writeOperations.length,
        evidence: 'Non-GET official API operations are retained for coverage but disabled by default.',
      },
      {
        requirement: 'Enumerate Reddit links/functions/intents from authorized structure',
        status: (authorizedSourcePages || authorizedSourceLinks || publicBuild?.graph?.capabilities) ? 'covered_from_authorized_source_summary' : 'missing',
        evidenceCount: authorizedSourceLinks || authorizedSourceBuild?.graph?.capabilities || publicBuild?.graph?.capabilities || 0,
        evidence: `authorized pages ${authorizedSourcePages}; authorized links ${authorizedSourceLinks}; authorized-source build capabilities ${authorizedSourceBuild?.graph?.capabilities ?? 0}; authorized-source build intents ${authorizedSourceBuild?.graph?.intents ?? 0}; public build capabilities ${publicBuild?.graph?.capabilities ?? 0}; public build intents ${publicBuild?.graph?.intents ?? 0}`,
      },
      {
        requirement: 'Full live crawl of all reddit.com links and functions',
        status: 'not_complete',
        evidenceCount: robots?.disallowAllForGenericUserAgent === true ? 1 : 0,
        evidence: robots?.disallowAllForGenericUserAgent === true
          ? 'Current robots evidence disallows generic live crawl of /.'
          : 'No complete live crawl evidence supplied.',
      },
    ],
    evidence: {
      coverageAuditSummary: coverageAudit?.summary ?? null,
      runtimeIndexSummary: runtimeIndex?.summary ?? null,
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

export async function writeRedditAuthorizedSourceConfigArtifacts(config, outDir) {
  const root = path.resolve(String(outDir));
  await ensureDir(root);
  const jsonPath = path.join(root, 'reddit_authorized_source_config.json');
  const auditPath = path.join(root, 'reddit_authorized_source_config.redaction-audit.json');
  const markdownPath = path.join(root, 'reddit_authorized_source_config.md');
  const localConfigPath = path.join(root, 'siteforge.local.json');
  const prepared = prepareRedactedArtifactJsonWithAudit(config);
  const localPrepared = prepareRedactedArtifactJsonWithAudit(config.siteforgeLocalConfig);
  await writeTextFile(jsonPath, prepared.json);
  await writeTextFile(auditPath, prepared.auditJson);
  await writeTextFile(markdownPath, renderRedditAuthorizedSourceConfigMarkdown(config));
  await writeTextFile(localConfigPath, localPrepared.json);
  return { jsonPath, auditPath, markdownPath, localConfigPath };
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
    '',
    'Status:',
    ...Object.entries(report.status ?? {}).map(([key, value]) => `- ${key}: ${value}`),
    '',
    'Requirement audit:',
    ...asArray(report.requirementAudit).map((item) => `- ${item.requirement}: ${item.status}; evidence=${item.evidenceCount}; ${item.evidence}`),
    '',
    'Execution boundary:',
    '- Full generic live crawl remains incomplete unless current robots and access controls allow it.',
    '- Cookie and Browser Bridge evidence is reported separately from official OAuth API runtime evidence.',
    '- Reddit OAuth GET execution requires runtime bearer token, descriptive User-Agent, and explicit path parameters for parameterized templates.',
    '- State-changing Reddit APIs remain recorded but disabled by default.',
    '',
  ].join('\n');
}
