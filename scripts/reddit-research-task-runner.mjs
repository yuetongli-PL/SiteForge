#!/usr/bin/env node
// @ts-check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_BUILD_DIR = path.join('.siteforge', 'sites', 'reddit.com-14830d0f', 'builds', '20260609T021031180Z');
const DEFAULT_EVIDENCE_DIR = path.join('docs', 'codex-goals', 'reddit-siteforge-build-v1', 'evidence');
const DEFAULT_OUT_ROOT = path.join('.siteforge', 'reddit-research-tasks');
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MAX_PUBLIC_CONTENT_TEXT_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const CURL_COMMAND = process.platform === 'win32' ? 'curl.exe' : 'curl';
const PUBLIC_FEED_USER_AGENT = 'SiteForgeRedditReplay/1.0 (read-only evidence; contact: local-codex)';
const PRIVATE_CONTENT_FIELD_WHITELIST = Object.freeze([
  'id',
  'kind',
  'itemType',
  'title',
  'name',
  'username',
  'author',
  'subreddit',
  'community',
  'textPreview',
  'publicDescriptionPreview',
  'permalink',
  'url',
  'profileUrl',
  'createdUtc',
  'score',
  'commentCount',
  'subscribers',
  'over18',
]);

const TASKS = Object.freeze({
  'subreddit-full-archive': Object.freeze({
    id: 'subreddit-full-archive',
    label: 'Subreddit archive and profile',
    required: ['subreddit'],
    targetParam: 'subreddit',
  }),
  'keyword-trend': Object.freeze({
    id: 'keyword-trend',
    label: 'Keyword search and trend analysis',
    required: ['query'],
    targetParam: 'query',
  }),
  'redditor-profile': Object.freeze({
    id: 'redditor-profile',
    label: 'Redditor profile and content portrait',
    required: ['account'],
    targetParam: 'account',
  }),
  'community-discovery': Object.freeze({
    id: 'community-discovery',
    label: 'Community discovery and relationship list',
    required: ['query'],
    targetParam: 'query',
  }),
  'event-timeline': Object.freeze({
    id: 'event-timeline',
    label: 'Event timeline reconstruction',
    required: ['query'],
    targetParam: 'query',
  }),
  'saved-history-archive': Object.freeze({
    id: 'saved-history-archive',
    label: 'Authenticated saved/history structure archive',
    required: [],
    targetParam: 'account',
    privateBoundary: true,
  }),
});

const TASK_ALIASES = Object.freeze({
  archive: 'subreddit-full-archive',
  'subreddit-archive': 'subreddit-full-archive',
  'subreddit-full-archive': 'subreddit-full-archive',
  trend: 'keyword-trend',
  'keyword-trend': 'keyword-trend',
  search: 'keyword-trend',
  profile: 'redditor-profile',
  'user-profile': 'redditor-profile',
  'redditor-profile': 'redditor-profile',
  discovery: 'community-discovery',
  'community-discovery': 'community-discovery',
  timeline: 'event-timeline',
  'event-timeline': 'event-timeline',
  saved: 'saved-history-archive',
  history: 'saved-history-archive',
  'saved-history-archive': 'saved-history-archive',
});

function usage() {
  return `Usage:
  node scripts/reddit-research-task-runner.mjs --task <task> [options]

Tasks:
  subreddit-full-archive  Archive subreddit hot/new/rising/search/about surfaces.
  keyword-trend           Search Reddit by keyword and produce trend-ready items.
  redditor-profile        Profile a redditor through public/API and verified site fallback.
  community-discovery     Search communities and related account/community surfaces.
  event-timeline          Build query/time buckets for event reconstruction.
  saved-history-archive   Governed authenticated saved/history route structure archive.

Options:
  --request <natural language request>
  --subreddit <name>
  --account <username>
  --query <value>
  --from YYYY-MM-DD
  --to YYYY-MM-DD
  --execute
  --resume
  --refresh-report
  --collection-mode api-first|api|site
  --out-dir <path>
  --build-dir <path>
  --evidence-dir <path>
  --max-items <n>
  --max-content-chars <n>
  --max-buckets-per-run <n>
  --timeout <ms>
  --allow-private-content
  --download-media
  --json
`;
}

function splitCsv(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function normalizeTask(value) {
  const key = String(value ?? '').trim().toLowerCase();
  const normalized = TASK_ALIASES[key];
  if (!normalized) {
    throw new Error(`Unsupported Reddit task ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function normalizeSubreddit(value) {
  return String(value ?? '').trim().replace(/^r\//iu, '').replace(/^\/?r\//iu, '');
}

function normalizeAccount(value) {
  return String(value ?? '').trim().replace(/^u\//iu, '').replace(/^\/?user\//iu, '');
}

function extractQuotedValue(text) {
  const quoted = String(text ?? '').match(/["']([^"']{2,180})["']/u);
  return quoted?.[1]?.trim() ?? null;
}

function firstMatch(text, regex) {
  const match = String(text ?? '').match(regex);
  return match?.[1]?.trim() ?? null;
}

function cleanRequestQuery(text) {
  const cleaned = String(text ?? '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/(?:^|[\s(])\/?r\/[A-Za-z0-9_][A-Za-z0-9_]{1,20}\b/giu, ' ')
    .replace(/(?:^|[\s(])(?:\/?u\/|\/?user\/)[A-Za-z0-9_-]{1,30}\b/giu, ' ')
    .replace(/\b(?:reddit|subreddit|redditor|please|help|build|make|create|analyze|analysis|archive|profile|portrait|timeline|trend|search|discover|community|communities|event|keyword|topic|report|for|about|around|with|the|a|an|of|full|all|public|content|posts|comments|history|saved)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned || String(text ?? '').trim();
}

export function inferRedditRequest(request) {
  const raw = String(request ?? '').trim();
  if (!raw) {
    return {
      task: null,
      subreddit: null,
      account: null,
      query: null,
      confidence: 0,
      signals: ['empty_request'],
    };
  }
  const normalized = raw.toLowerCase();
  const subreddit = firstMatch(raw, /(?:^|[\s(])\/?r\/([A-Za-z0-9_][A-Za-z0-9_]{1,20})\b/iu);
  const account = firstMatch(raw, /(?:^|[\s(])(?:\/?u\/|\/?user\/)([A-Za-z0-9_-]{1,30})\b/iu);
  const quoted = extractQuotedValue(raw);
  const signals = [];
  const has = (...patterns) => patterns.some((pattern) => pattern.test(normalized));

  let task = null;
  if (has(/\bsaved\b/u, /\bhistory\b/u, /\bbookmarks?\b/u, /\u6536\u85cf/u, /\u5386\u53f2/u)) {
    task = 'saved-history-archive';
    signals.push('saved_or_history_request');
  } else if (account || has(/\bprofile\b/u, /\bportrait\b/u, /\bredditor\b/u, /\buser\b/u, /\bauthor\b/u, /\baccount\b/u, /\u753b\u50cf/u, /\u7528\u6237/u, /\u4f5c\u8005/u, /\u8d26\u53f7/u)) {
    task = 'redditor-profile';
    signals.push(account ? 'account_reference' : 'profile_keyword');
  } else if (has(/\btimeline\b/u, /\bevent\b/u, /\bchronolog/u, /\u65f6\u95f4\u7ebf/u, /\u4e8b\u4ef6/u)) {
    task = 'event-timeline';
    signals.push('timeline_keyword');
  } else if (has(/\bdiscover/u, /\brelated\b/u, /\brelationship\b/u, /\bcommunities\b/u, /\bcommunity\b/u, /\u53d1\u73b0/u, /\u5173\u7cfb/u, /\u793e\u533a/u, /\u5217\u8868/u)) {
    task = 'community-discovery';
    signals.push('community_discovery_keyword');
  } else if (subreddit || has(/\barchive\b/u, /\bsubreddit\b/u, /\bfull\b/u, /\ball\b/u, /\u5f52\u6863/u, /\u5168\u91cf/u)) {
    task = 'subreddit-full-archive';
    signals.push(subreddit ? 'subreddit_reference' : 'archive_keyword');
  } else {
    task = 'keyword-trend';
    signals.push('default_keyword_trend');
  }

  const query = quoted ?? (
    task === 'subreddit-full-archive' && subreddit ? subreddit
      : task === 'redditor-profile' && account ? account
        : cleanRequestQuery(raw)
  );
  return {
    task,
    subreddit: subreddit ? normalizeSubreddit(subreddit) : null,
    account: account ? normalizeAccount(account) : null,
    query,
    confidence: signals.includes('default_keyword_trend') ? 0.65 : 0.9,
    signals,
  };
}

function applyRequestInference(options) {
  if (!options.request) {
    return options;
  }
  const inference = inferRedditRequest(options.request);
  const nextOptions = {
    ...options,
    plannerInference: inference,
  };
  if (!nextOptions.task && inference.task) {
    nextOptions.task = inference.task;
  }
  if (!nextOptions.subreddit && inference.subreddit) {
    nextOptions.subreddit = inference.subreddit;
  }
  if (!nextOptions.account && inference.account) {
    nextOptions.account = inference.account;
  }
  if (!nextOptions.query && inference.query) {
    nextOptions.query = inference.query;
  }
  return nextOptions;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    task: null,
    request: null,
    subreddit: null,
    account: null,
    query: null,
    from: null,
    to: null,
    collectionMode: null,
    execute: false,
    resume: false,
    refreshReport: false,
    outDir: null,
    buildDir: DEFAULT_BUILD_DIR,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    maxItems: DEFAULT_MAX_ITEMS,
    maxContentChars: DEFAULT_MAX_PUBLIC_CONTENT_TEXT_CHARS,
    maxBucketsPerRun: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    allowPrivateContent: false,
    downloadMedia: false,
    dryRun: false,
    now: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--task':
      case '--task-type':
        options.task = normalizeTask(next);
        index += 1;
        break;
      case '--request':
      case '--intent':
        options.request = next;
        index += 1;
        break;
      case '--subreddit':
      case '--community':
        options.subreddit = normalizeSubreddit(next);
        index += 1;
        break;
      case '--account':
      case '--author':
      case '--user':
      case '--username':
        options.account = normalizeAccount(next);
        index += 1;
        break;
      case '--query':
      case '--keyword':
      case '--topic':
        options.query = next;
        index += 1;
        break;
      case '--from':
        options.from = next;
        index += 1;
        break;
      case '--to':
        options.to = next;
        index += 1;
        break;
      case '--collection-mode':
        options.collectionMode = next;
        index += 1;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--refresh-report':
        options.refreshReport = true;
        options.execute = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        options.execute = false;
        break;
      case '--out-dir':
        options.outDir = next;
        index += 1;
        break;
      case '--build-dir':
        options.buildDir = next;
        index += 1;
        break;
      case '--evidence-dir':
        options.evidenceDir = next;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = positiveInteger(next, '--max-items');
        index += 1;
        break;
      case '--max-content-chars':
        options.maxContentChars = positiveInteger(next, '--max-content-chars');
        index += 1;
        break;
      case '--max-buckets-per-run':
        options.maxBucketsPerRun = positiveInteger(next, '--max-buckets-per-run');
        index += 1;
        break;
      case '--timeout':
      case '--timeout-ms':
        options.timeoutMs = positiveInteger(next, '--timeout');
        index += 1;
        break;
      case '--allow-private-content':
        options.allowPrivateContent = true;
        break;
      case '--no-allow-private-content':
        options.allowPrivateContent = false;
        break;
      case '--download-media':
        options.downloadMedia = true;
        break;
      case '--no-download-media':
        options.downloadMedia = false;
        break;
      case '--now':
        options.now = next;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unsupported option ${arg}.`);
        }
        break;
    }
  }
  const inferredOptions = applyRequestInference(options);
  if (!inferredOptions.task && !inferredOptions.help) {
    throw new Error('Missing --task or a recognizable --request.');
  }
  return inferredOptions;
}

function stableSlug(value, fallback = 'run') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return slug || fallback;
}

function defaultOutDir(options) {
  const task = TASKS[options.task];
  const target = options[task.targetParam] ?? options.query ?? options.subreddit ?? options.account ?? 'reddit';
  return path.join(DEFAULT_OUT_ROOT, `${options.task}-${stableSlug(target)}`);
}

function taskTarget(options) {
  const task = TASKS[options.task];
  return options[task.targetParam] ?? options.query ?? options.subreddit ?? options.account ?? 'reddit';
}

function normalizeCollectionMode(options) {
  const mode = String(options.collectionMode ?? '').trim().toLowerCase();
  if (!mode) {
    return 'api-first';
  }
  if (!['api-first', 'api', 'site'].includes(mode)) {
    throw new Error(`Unsupported collection mode ${JSON.stringify(options.collectionMode)}.`);
  }
  return mode;
}

function apiCommand({ pathTemplate, pathParams = {}, query = {}, templateIndex = 0 }) {
  const args = [
    'src/entrypoints/sites/reddit-action.mjs',
    'api-read',
    '--source',
    path.join(DEFAULT_EVIDENCE_DIR, 'reddit_dev_api.html'),
    '--path',
    pathTemplate,
    '--method',
    'GET',
    '--template-index',
    String(templateIndex),
    '--execute',
    '--json',
  ];
  for (const [name, value] of Object.entries(pathParams)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      args.push('--param', `${name}=${value}`);
    }
  }
  for (const [name, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      args.push('--query', `${name}=${value}`);
    }
  }
  return ['node', ...args];
}

function publicFeedCommand(feedUrl) {
  return [
    CURL_COMMAND,
    '--http1.1',
    '-L',
    '-sS',
    '-A',
    PUBLIC_FEED_USER_AGENT,
    '-H',
    'Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    '-w',
    '\nSITEFORGE_HTTP_STATUS:%{http_code}\n',
    feedUrl,
  ];
}

function publicFeed({
  feedUrl,
  pathParams = {},
  feedKind = 'atom',
  includeFeedProfile = false,
  profileOnly = false,
  profileKind = null,
}) {
  return {
    kind: 'api',
    provider: 'reddit_public_atom_feed',
    verified: true,
    status: 'replay_verified_adapter_bound_runtime_tested',
    command: publicFeedCommand(feedUrl),
    operation: {
      method: 'GET',
      url: feedUrl,
      feedKind,
      pathParams,
      includeFeedProfile,
      profileOnly,
      profileKind,
    },
    savedMaterial: 'sanitized_public_feed_fields_with_contentText',
    rawFeedPersisted: false,
    activationEvidence: [
      'docs/codex-goals/reddit-siteforge-build-v1/evidence/reddit-public-feed-replay-report.json',
      'tests/node/reddit-research-task-runner.test.mjs',
    ],
  };
}

function redditSearchFeedUrl(query, extra = {}) {
  const params = new URLSearchParams();
  params.set('q', String(query ?? ''));
  for (const [name, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      params.set(name, String(value));
    }
  }
  return `https://www.reddit.com/search.rss?${params.toString()}`;
}

function subredditFeedUrl(subreddit, surface = '') {
  const subredditSlug = encodeURIComponent(subreddit);
  const normalizedSurface = String(surface ?? '').replace(/^\/+|\/+$/gu, '');
  return normalizedSurface
    ? `https://www.reddit.com/r/${subredditSlug}/${normalizedSurface}/.rss`
    : `https://www.reddit.com/r/${subredditSlug}/.rss`;
}

function subredditSearchFeedUrl(subreddit, query) {
  const subredditSlug = encodeURIComponent(subreddit);
  const params = new URLSearchParams();
  params.set('q', String(query ?? subreddit));
  params.set('restrict_sr', '1');
  return `https://www.reddit.com/r/${subredditSlug}/search/.rss?${params.toString()}`;
}

function userFeedUrl(account, surface = '') {
  const accountSlug = encodeURIComponent(account);
  const normalizedSurface = String(surface ?? '').replace(/^\/+|\/+$/gu, '');
  return normalizedSurface
    ? `https://www.reddit.com/user/${accountSlug}/${normalizedSurface}/.rss`
    : `https://www.reddit.com/user/${accountSlug}/.rss`;
}

function siteFallback(routeTemplates, reasonCode = 'api_unavailable_use_verified_browser_bridge') {
  return {
    kind: 'site',
    provider: 'browser_bridge_verified_structure',
    routeTemplates,
    command: null,
    reasonCode,
    savedMaterial: 'sanitized_structure_summary_only',
  };
}

function bucket(id, label, api, fallback, analysisRole = 'collection', extras = {}) {
  return {
    id,
    label,
    analysisRole,
    privateContentCandidate: extras.privateContentCandidate === true,
    privateContentGovernance: extras.privateContentCandidate === true ? {
      explicitAuthorizationRequired: true,
      allowFlag: '--allow-private-content',
      persistedFields: PRIVATE_CONTENT_FIELD_WHITELIST,
      rawPrivateBodyPersisted: false,
      authMaterialPersisted: false,
    } : null,
    activeProgrammatic: extras.activeProgrammatic ?? null,
    primary: api ? {
      kind: 'api',
      verified: false,
      status: 'candidate_until_replay_verified',
      command: apiCommand(api),
      operation: {
        method: 'GET',
        pathTemplate: api.pathTemplate,
        pathParams: api.pathParams ?? {},
        query: api.query ?? {},
      },
      activationRequirement: 'replay_verified_adapter_bound_runtime_tested',
    } : null,
    fallback,
    noStallPolicy: {
      apiLocalFailureFallback: 'immediate_verified_site_fallback',
      sameSurfaceCooldown: 'do_not_wait',
    },
  };
}

function buildBuckets(options) {
  const maxItems = options.maxItems;
  const queryLimit = { limit: maxItems };
  switch (options.task) {
    case 'subreddit-full-archive': {
      const subreddit = options.subreddit;
      const subredditSlug = encodeURIComponent(subreddit);
      return [
        bucket('subreddit-public-feed', 'Subreddit public Atom feed', null, siteFallback([`/r/${subreddit}/`, `/r/${subreddit}/new`]), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditFeedUrl(subreddit),
            pathParams: { subreddit },
          }),
        }),
        bucket('subreddit-hot', 'Subreddit hot listing', {
          pathTemplate: '[/r/:subreddit]/hot',
          pathParams: { subreddit },
          query: queryLimit,
          templateIndex: 1,
        }, siteFallback([`/r/${subreddit}/`, `/r/${subreddit}/hot`]), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditFeedUrl(subreddit, 'hot'),
            pathParams: { subreddit, surface: 'hot' },
          }),
        }),
        bucket('subreddit-new', 'Subreddit new listing', {
          pathTemplate: '[/r/:subreddit]/new',
          pathParams: { subreddit },
          query: queryLimit,
          templateIndex: 1,
        }, siteFallback([`/r/${subreddit}/new`, `/r/${subreddit}/`]), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditFeedUrl(subreddit, 'new'),
            pathParams: { subreddit, surface: 'new' },
          }),
        }),
        bucket('subreddit-rising', 'Subreddit rising listing', {
          pathTemplate: '[/r/:subreddit]/rising',
          pathParams: { subreddit },
          query: queryLimit,
          templateIndex: 1,
        }, siteFallback([`/r/${subreddit}/rising`, `/r/${subreddit}/`]), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditFeedUrl(subreddit, 'rising'),
            pathParams: { subreddit, surface: 'rising' },
          }),
        }),
        bucket('subreddit-search', 'Subreddit scoped search', {
          pathTemplate: '[/r/:subreddit]/search',
          pathParams: { subreddit },
          query: { q: options.query ?? subreddit, restrict_sr: 1, limit: maxItems },
          templateIndex: 1,
        }, siteFallback([`/r/${subreddit}/search`, '/search']), 'search', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditSearchFeedUrl(subreddit, options.query ?? subreddit),
            pathParams: { subreddit, query: options.query ?? subreddit },
          }),
        }),
        bucket('subreddit-about', 'Subreddit about profile', {
          pathTemplate: '/r/:subreddit/about',
          pathParams: { subreddit },
        }, siteFallback([`/r/${subreddit}/about`, `/r/${subreddit}/`]), 'profile', {
          activeProgrammatic: publicFeed({
            feedUrl: subredditFeedUrl(subreddit),
            pathParams: { subreddit },
            includeFeedProfile: true,
            profileOnly: true,
            profileKind: 'subreddit',
          }),
        }),
      ];
    }
    case 'keyword-trend':
      return [
        bucket('search-posts', 'Global Reddit post search', {
          pathTemplate: '[/r/:subreddit]/search',
          pathParams: {},
          query: { q: options.query, type: 'link', sort: 'new', limit: maxItems },
          templateIndex: 0,
        }, siteFallback(['/search', '/']), 'search', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'new' }),
            pathParams: { query: options.query },
          }),
        }),
        bucket('search-communities', 'Communities mentioned by keyword search results', {
          pathTemplate: '/subreddits/search',
          query: { q: options.query, limit: maxItems },
        }, siteFallback(['/subreddits', '/search']), 'communities', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'relevance' }),
            pathParams: { query: options.query, derivedEntity: 'communities' },
          }),
        }),
        bucket('search-users', 'Authors found by keyword search results', {
          pathTemplate: '/users/search',
          query: { q: options.query, limit: maxItems },
        }, siteFallback(['/search']), 'accounts', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'new' }),
            pathParams: { query: options.query, derivedEntity: 'authors' },
          }),
        }),
      ];
    case 'redditor-profile':
      return [
        bucket('user-public-feed', 'Redditor public Atom feed', null, siteFallback([`/user/${options.account}/`, `/user/${options.account}/comments`]), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: userFeedUrl(options.account),
            pathParams: { username: options.account },
          }),
        }),
        bucket('user-about', 'Redditor about profile', {
          pathTemplate: '/user/:username/about',
          pathParams: { username: options.account },
        }, siteFallback([`/user/${options.account}/`, '/search']), 'profile', {
          activeProgrammatic: publicFeed({
            feedUrl: userFeedUrl(options.account),
            pathParams: { username: options.account },
            includeFeedProfile: true,
            profileOnly: true,
            profileKind: 'redditor',
          }),
        }),
        bucket('user-submitted', 'Redditor submitted posts', {
          pathTemplate: '/user/:username/:where',
          pathParams: { username: options.account, where: 'submitted' },
          query: queryLimit,
        }, siteFallback([`/user/${options.account}/`, '/search']), 'posts', {
          activeProgrammatic: publicFeed({
            feedUrl: userFeedUrl(options.account, 'submitted'),
            pathParams: { username: options.account, where: 'submitted' },
          }),
        }),
        bucket('user-comments', 'Redditor comments', {
          pathTemplate: '/user/:username/:where',
          pathParams: { username: options.account, where: 'comments' },
          query: queryLimit,
        }, siteFallback([`/user/${options.account}/comments`, `/user/${options.account}/`]), 'comments', {
          activeProgrammatic: publicFeed({
            feedUrl: userFeedUrl(options.account, 'comments'),
            pathParams: { username: options.account, where: 'comments' },
          }),
        }),
      ];
    case 'community-discovery':
      return [
        bucket('community-search', 'Find communities by query', {
          pathTemplate: '/subreddits/search',
          query: { q: options.query, limit: maxItems },
        }, siteFallback(['/subreddits', '/search']), 'communities', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'relevance' }),
            pathParams: { query: options.query },
          }),
        }),
        bucket('community-users-search', 'Find redditors by query', {
          pathTemplate: '/users/search',
          query: { q: options.query, limit: maxItems },
        }, siteFallback(['/search']), 'accounts', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'new' }),
            pathParams: { query: options.query },
          }),
        }),
        bucket('community-recommend', 'Recommend related communities', {
          pathTemplate: '/api/recommend/sr/:srnames',
          pathParams: { srnames: options.query },
          query: { omit: '' },
        }, siteFallback(['/subreddits', '/']), 'relations', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'relevance' }),
            pathParams: { query: options.query },
          }),
        }),
      ];
    case 'event-timeline':
      return [
        bucket('event-search-new', 'Event latest mentions', {
          pathTemplate: '[/r/:subreddit]/search',
          query: { q: options.query, sort: 'new', t: 'all', limit: maxItems },
          templateIndex: 0,
        }, siteFallback(['/search', '/']), 'timeline', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'new', t: 'all' }),
            pathParams: { query: options.query },
          }),
        }),
        bucket('event-search-relevance', 'Event relevance search', {
          pathTemplate: '[/r/:subreddit]/search',
          query: { q: options.query, sort: 'relevance', t: 'all', limit: maxItems },
          templateIndex: 0,
        }, siteFallback(['/search', '/']), 'timeline', {
          activeProgrammatic: publicFeed({
            feedUrl: redditSearchFeedUrl(options.query, { sort: 'relevance', t: 'all' }),
            pathParams: { query: options.query },
          }),
        }),
      ];
    case 'saved-history-archive':
      return [
        bucket('saved-route-structure', 'Authenticated saved content candidate with structure fallback', {
          pathTemplate: '/user/:username/:where',
          pathParams: { username: options.account ?? 'me', where: 'saved' },
          query: queryLimit,
        }, siteFallback(['/user/me/saved', '/subreddits/mine'], 'private_api_disabled_use_verified_browser_structure'), 'library', {
          privateContentCandidate: true,
        }),
        bucket('subscribed-communities', 'Subscribed communities route structure', {
          pathTemplate: '/subreddits/mine/:where',
          pathParams: { where: 'subscriber' },
          query: queryLimit,
        }, siteFallback(['/subreddits/mine', '/subreddits']), 'relations', {
          privateContentCandidate: true,
        }),
      ];
    default:
      throw new Error(`Unsupported Reddit task ${options.task}.`);
  }
}

function buildLayout(outDir) {
  return {
    outDir,
    planPath: path.join(outDir, 'task-plan.json'),
    statePath: path.join(outDir, 'task-state.json'),
    summaryPath: path.join(outDir, 'task-summary.json'),
    reportPath: path.join(outDir, 'task-report.md'),
    rawItemsPath: path.join(outDir, 'raw-items.jsonl'),
    dedupedItemsPath: path.join(outDir, 'deduped-items.jsonl'),
    itemsPath: path.join(outDir, 'items.jsonl'),
    communitiesPath: path.join(outDir, 'communities.jsonl'),
    accountsPath: path.join(outDir, 'accounts.jsonl'),
    authorsPath: path.join(outDir, 'authors.jsonl'),
    cacheIndexPath: path.join(outDir, 'cache-index.json'),
    cacheIndexJsonlPath: path.join(outDir, 'cache-index.jsonl'),
    mediaAssetsPath: path.join(outDir, 'media-assets.json'),
    mediaAssetsJsonlPath: path.join(outDir, 'media-assets.jsonl'),
    archiveDir: path.join(outDir, 'archive'),
  };
}

export function buildTaskPlan(options) {
  const task = TASKS[options.task];
  if (!task) {
    throw new Error(`Unsupported Reddit task ${options.task}.`);
  }
  const missingParameters = task.required.filter((name) => !String(options[name] ?? '').trim());
  const outDir = options.outDir ?? defaultOutDir(options);
  const collectionMode = normalizeCollectionMode(options);
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    artifactFamily: 'reddit-production-research-task-plan',
    siteKey: 'reddit',
    generatedAt: options.now ? `${options.now}T00:00:00.000Z` : new Date().toISOString(),
    task: {
      id: task.id,
      label: task.label,
      target: taskTarget(options),
      requiredParameters: task.required,
      missingParameters,
      collectionMode,
      noStallPolicy: {
        apiFirstFallback: 'verified_site_fallback_without_cooldown',
        sameSurfaceCooldown: 'do_not_wait',
        resume: 'reuse_task_state_before_live_retry',
      },
    },
    inputs: {
      request: options.request ?? null,
      subreddit: options.subreddit,
      account: options.account,
      query: options.query,
      from: options.from,
      to: options.to,
      maxItems: options.maxItems,
      maxContentChars: options.maxContentChars,
      allowPrivateContent: options.allowPrivateContent,
      downloadMedia: options.downloadMedia,
    },
    planner: {
      mode: options.request ? 'natural_language_request' : 'explicit_task',
      request: options.request ?? null,
      inference: options.plannerInference ?? null,
      dispatchTarget: task.id,
      dispatchConfidence: options.plannerInference?.confidence ?? 1,
    },
    evidence: {
      buildDir: options.buildDir,
      evidenceDir: options.evidenceDir,
      apiRuntimeIndex: path.join(options.evidenceDir, 'reddit_oauth_api_runtime_plan_index.json'),
      apiReadBatchReport: path.join(options.evidenceDir, 'reddit_api_read_batch_report.json'),
      browserBridgeRouteQueue: path.join(options.evidenceDir, 'reddit_browser_bridge_route_queue.json'),
      authStateReport: path.join(options.buildDir, 'auth_state_report.json'),
      authenticatedCrawl: path.join(options.buildDir, 'crawl_authenticated.json'),
    },
    layout: buildLayout(outDir),
    buckets: buildBuckets(options),
    outputContract: {
      requiredArtifacts: [
        'task-plan.json',
        'task-state.json',
        'task-summary.json',
        'task-report.md',
        'raw-items.jsonl',
        'deduped-items.jsonl',
        'items.jsonl',
        'communities.jsonl',
        'accounts.jsonl',
        'authors.jsonl',
        'cache-index.json',
        'cache-index.jsonl',
        'media-assets.json',
        'media-assets.jsonl',
        'archive/*.md',
      ],
      rawPrivateBodyPersisted: false,
      rawFeedPersisted: false,
      contentHtmlPersisted: false,
      publicFeedContentText: {
        persisted: true,
        field: 'contentText',
        sourceElements: ['content', 'summary', 'description', 'subtitle'],
        maxChars: options.maxContentChars,
        truncationField: 'contentTextTruncated',
      },
      privateContentGovernance: {
        explicitAuthorizationRequired: true,
        allowFlag: '--allow-private-content',
        allowPrivateContent: options.allowPrivateContent === true,
        persistedFields: PRIVATE_CONTENT_FIELD_WHITELIST,
        rawPrivateBodyPersisted: false,
        privateContentPersistedWithoutAuthorization: false,
      },
      cookieMaterialPersisted: false,
      authHeaderPersisted: false,
      browserProfilePersisted: false,
    },
    safety: {
      mutationActionsDefault: 'blocked',
      blockedActions: ['post', 'reply', 'comment', 'vote', 'save', 'hide', 'report', 'follow', 'message', 'delete', 'payment', 'account_settings'],
      mediaDownloads: options.downloadMedia ? 'inventory_only_until_user_explicit_url_download_policy' : 'disabled',
    },
  };
  return plan;
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJsonlIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  await fs.writeFile(filePath, text, 'utf8');
}

function defaultState(plan) {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactFamily: 'reddit-production-research-task-state',
    taskId: plan.task.id,
    status: 'planned',
    generatedAt: plan.generatedAt,
    updatedAt: plan.generatedAt,
    completedBucketIds: [],
    failedBucketIds: [],
    bucketResults: [],
    resume: {
      supported: true,
      statePath: plan.layout.statePath,
      strategy: 'skip_completed_buckets_and_reuse_existing_jsonl_artifacts',
    },
  };
}

function parseCommandJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      // Fall through to line-oriented parsing for tools that emit logs before JSON.
    }
  }
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // Keep looking for the JSON line.
    }
  }
  return null;
}

export function executeCommand(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS, cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      stderr += `\nrunner-timeout-ms=${timeoutMs}`;
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr: error?.message ?? String(error) });
    });
  });
}

function apiFailureLayer(reasonCode, exitCode = 0) {
  const reason = String(reasonCode ?? '').toLowerCase();
  if (/oauth|user_agent|credential|bearer/u.test(reason)) {
    return {
      layer: 'api_auth',
      reasonCode: reasonCode ?? 'reddit_oauth_inputs_missing',
      remediation: 'Provide SITEFORGE_REDDIT_BEARER_TOKEN and SITEFORGE_REDDIT_USER_AGENT, then resume the same task.',
    };
  }
  if (/429|rate/u.test(reason)) {
    return {
      layer: 'rate_limit',
      reasonCode,
      remediation: 'Do not wait on the same API surface; resume with verified site fallback or a different bucket.',
    };
  }
  if (/403|permission/u.test(reason)) {
    return {
      layer: 'permission',
      reasonCode,
      remediation: 'Verify OAuth scopes or use a public/site fallback surface.',
    };
  }
  if (exitCode !== 0) {
    return {
      layer: 'api',
      reasonCode: reasonCode ?? 'api_command_failed',
      remediation: 'Inspect command stderr and resume; the runner will reuse completed buckets.',
    };
  }
  return {
    layer: 'api',
    reasonCode: reasonCode ?? 'api_no_items',
    remediation: 'Use verified site fallback or provide parameters for a more specific API template.',
  };
}

function routeMatches(page, routeTemplates) {
  const candidates = [
    page?.routeTemplate,
    page?.routePath,
    page?.normalizedUrl,
    page?.url,
  ].filter(Boolean).map((value) => String(value).toLowerCase().replace(/\/+$/u, '') || '/');
  return routeTemplates.some((template) => {
    const normalized = String(template ?? '').toLowerCase().replace(/\/+$/u, '') || '/';
    return candidates.some((candidate) => (
      candidate === normalized
      || candidate.includes(normalized)
      || normalized.includes(candidate)
    ));
  });
}

async function collectSiteFallbackItems(bucket, plan) {
  const crawl = await readJsonIfExists(path.join(plan.evidence.buildDir, 'crawl_authenticated.json'), {});
  const auth = await readJsonIfExists(path.join(plan.evidence.buildDir, 'auth_state_report.json'), {});
  const pages = Array.isArray(crawl.authenticatedPages) ? crawl.authenticatedPages : [];
  const routeTemplates = bucket.fallback?.routeTemplates ?? [];
  const matches = pages.filter((page) => routeMatches(page, routeTemplates));
  const selected = matches.length ? matches : pages.filter((page) => page.collection?.status === 'success').slice(0, 2);
  const items = selected.map((page) => ({
    id: `site-route:${createHash('sha1').update(`${bucket.id}:${page.routeTemplate ?? page.url}`).digest('hex').slice(0, 12)}`,
    itemType: 'verified_site_route_summary',
    bucketId: bucket.id,
    source: 'browser_bridge_verified_structure',
    routeTemplate: page.routeTemplate ?? null,
    routePath: page.routePath ?? null,
    url: page.normalizedUrl ?? page.url ?? null,
    pageType: page.pageType ?? null,
    visibleItemCount: Number.isFinite(Number(page.visibleItemCount)) ? Number(page.visibleItemCount) : null,
    listPresent: page.listPresent === true,
    emptyStatePresent: page.emptyStatePresent === true,
    evidenceStatus: page.evidenceStatus ?? null,
    evidenceLevel: page.evidenceLevel ?? null,
    riskLevel: page.riskLevel ?? null,
    structureHash: page.structureHash ?? null,
    savedMaterial: 'sanitized_structure_summary_only',
    rawContentPersisted: false,
    privateContentPersisted: false,
    authMaterialPersisted: false,
  }));
  return {
    status: items.length ? 'captured_with_warning' : 'blocked',
    reasonCode: items.length ? bucket.fallback?.reasonCode : 'verified_site_fallback_route_missing',
    failureLayer: items.length ? 'site_fallback_degraded_structure_only' : 'selector_or_route',
    remediation: items.length
      ? 'Use OAuth API replay for item-level content; this fallback preserves route structure only.'
      : 'Refresh Browser Bridge route capture for the requested subreddit/account/search route, then resume.',
    authVerified: auth.verified === true,
    routeCount: auth.browserBridge?.routeCount ?? null,
    capturedRouteCount: auth.browserBridge?.capturedRouteCount ?? null,
    items,
  };
}

function whitelistedPrivateApiItem(item, bucketId) {
  const row = {};
  for (const field of PRIVATE_CONTENT_FIELD_WHITELIST) {
    if (item?.[field] !== undefined) {
      row[field] = item[field];
    }
  }
  return {
    ...row,
    bucketId,
    source: item?.source ?? 'reddit_oauth_api',
    privateContentPersisted: true,
    privateContentAuthorization: 'explicit_allow_private_content',
    privateContentFields: PRIVATE_CONTENT_FIELD_WHITELIST.filter((field) => row[field] !== undefined),
    rawBodyPersisted: false,
    rawPrivateBodyPersisted: false,
    authMaterialPersisted: false,
  };
}

function normalizeApiItems(items, bucketId, options = {}) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (options.privateContentCandidate) {
      return whitelistedPrivateApiItem(item, bucketId);
    }
    return {
      ...item,
      bucketId,
      source: item.source ?? 'reddit_oauth_api',
      rawBodyPersisted: false,
      rawPrivateBodyPersisted: false,
      authMaterialPersisted: false,
    };
  });
}

function splitCurlBodyAndStatus(stdout) {
  const text = String(stdout ?? '');
  const match = text.match(/\nSITEFORGE_HTTP_STATUS:(\d{3}|000)\s*$/u);
  if (!match) {
    return { body: text, httpStatus: null };
  }
  return {
    body: text.slice(0, match.index),
    httpStatus: match[1] === '000' ? 0 : Number(match[1]),
  };
}

function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function stripMarkup(value) {
  return decodeXmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function xmlElementText(xml, name) {
  const match = String(xml ?? '').match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'iu'));
  return match ? stripMarkup(match[1]) : null;
}

function xmlElementRaw(xml, name) {
  const match = String(xml ?? '').match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'iu'));
  return match?.[1] ?? null;
}

function atomLink(entryXml) {
  const alternate = String(entryXml ?? '').match(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/iu);
  const anyLink = String(entryXml ?? '').match(/<link\b(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/iu);
  return decodeXmlEntities(alternate?.[1] ?? anyLink?.[1] ?? '').trim() || null;
}

function xmlAttribute(tag, name) {
  const match = String(tag ?? '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'iu'));
  return match ? decodeXmlEntities(match[1]).trim() : null;
}

function atomCategories(entryXml) {
  return [...String(entryXml ?? '').matchAll(/<category\b[^>]*>/giu)].map((match) => ({
    term: xmlAttribute(match[0], 'term'),
    label: xmlAttribute(match[0], 'label'),
  })).filter((category) => category.term || category.label);
}

function communityFromPermalink(permalink) {
  const match = String(permalink ?? '').match(/\/r\/([A-Za-z0-9_][A-Za-z0-9_]{1,20})(?:\/|$)/iu);
  return match?.[1] ?? null;
}

function communityFromCategories(categories, permalink) {
  const category = categories.find((item) => /^r\//iu.test(String(item.label ?? '')))
    ?? categories.find((item) => !/^u\//iu.test(String(item.label ?? item.term ?? '')));
  const raw = category?.label ?? category?.term ?? communityFromPermalink(permalink);
  return String(raw ?? '').replace(/^r\//iu, '').trim() || null;
}

function publicContentFields(xml, maxChars = DEFAULT_MAX_PUBLIC_CONTENT_TEXT_CHARS) {
  const sourceElements = ['content', 'summary', 'description', 'subtitle'];
  for (const sourceElement of sourceElements) {
    const raw = xmlElementRaw(xml, sourceElement);
    if (raw === null) {
      continue;
    }
    const text = stripMarkup(raw);
    if (!text) {
      continue;
    }
    const effectiveMaxChars = Math.max(0, Number.isFinite(Number(maxChars)) ? Number(maxChars) : DEFAULT_MAX_PUBLIC_CONTENT_TEXT_CHARS);
    const contentText = effectiveMaxChars === 0 ? '' : text.slice(0, effectiveMaxChars);
    return {
      contentText,
      contentTextLength: text.length,
      contentTextTruncated: contentText.length < text.length,
      contentSourceElement: sourceElement,
      contentPreview: contentText ? contentText.slice(0, 280) : null,
      contentHtmlPersisted: false,
      rawContentPersisted: false,
    };
  }
  return {
    contentText: null,
    contentTextLength: 0,
    contentTextTruncated: false,
    contentSourceElement: null,
    contentPreview: null,
    contentHtmlPersisted: false,
    rawContentPersisted: false,
  };
}

function feedItemType(bucketId, feed) {
  const pathParams = feed.operation.pathParams ?? {};
  if (pathParams.where === 'comments' || /comments/iu.test(String(bucketId ?? ''))) {
    return 'comment';
  }
  return 'post';
}

function feedWithoutItems(feedText) {
  return String(feedText ?? '')
    .replace(/<entry\b[\s\S]*?<\/entry>/giu, '')
    .replace(/<item\b[\s\S]*?<\/item>/giu, '');
}

function publicFeedProfileItem(feedText, bucketId, feed, maxContentChars) {
  if (!feed.operation.includeFeedProfile) {
    return null;
  }
  const profileXml = feedWithoutItems(feedText);
  const pathParams = feed.operation.pathParams ?? {};
  const profileKind = feed.operation.profileKind ?? pathParams.profileKind ?? 'feed';
  const title = xmlElementText(profileXml, 'title');
  const subtitle = xmlElementText(profileXml, 'subtitle') ?? xmlElementText(profileXml, 'description');
  const updatedAt = xmlElementText(profileXml, 'updated') ?? xmlElementText(profileXml, 'lastBuildDate') ?? null;
  const url = atomLink(profileXml) ?? feed.operation.url;
  const username = profileKind === 'redditor' ? (pathParams.username ?? null) : null;
  const community = profileKind === 'subreddit' ? (pathParams.subreddit ?? communityFromPermalink(url)) : null;
  const contentFields = publicContentFields(profileXml, maxContentChars);
  if (!title && !subtitle && !url && !username && !community) {
    return null;
  }
  return {
    id: `feed-profile:${createHash('sha1').update(`${bucketId}:${feed.operation.url}`).digest('hex').slice(0, 16)}`,
    externalId: feed.operation.url,
    itemType: profileKind === 'redditor' ? 'account' : profileKind === 'subreddit' ? 'community' : 'feed_profile_summary',
    bucketId,
    source: feed.provider,
    provider: feed.provider,
    title,
    name: community ? `r/${community}` : username ? `u/${username}` : title,
    username,
    community,
    communityUrl: community ? `https://www.reddit.com/r/${encodeURIComponent(String(community))}/` : null,
    profileKind,
    profileUrl: username ? `https://www.reddit.com/user/${encodeURIComponent(String(username))}/` : null,
    url,
    ...contentFields,
    contentPreview: contentFields.contentPreview ?? (subtitle ? subtitle.slice(0, 280) : null),
    updatedAt,
    pathParams,
    savedMaterial: feed.savedMaterial,
    rawFeedPersisted: false,
    rawBodyPersisted: false,
    authMaterialPersisted: false,
  };
}

function parsePublicFeedItems(feedText, bucketId, feed, options = {}) {
  const text = String(feedText ?? '');
  if (!/<(?:feed|rss)\b/iu.test(text)) {
    return [];
  }
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_PUBLIC_CONTENT_TEXT_CHARS;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const profileItem = publicFeedProfileItem(text, bucketId, feed, maxContentChars);
  if (feed.operation.profileOnly) {
    return profileItem ? [profileItem] : [];
  }
  const entryMatches = [...text.matchAll(/<entry\b[\s\S]*?<\/entry>/giu)].map((match) => match[0]);
  const itemMatches = entryMatches.length ? [] : [...text.matchAll(/<item\b[\s\S]*?<\/item>/giu)].map((match) => match[0]);
  const entryItems = [...entryMatches, ...itemMatches].slice(0, maxItems).map((entryXml, index) => {
    const sourceId = xmlElementText(entryXml, 'id') ?? xmlElementText(entryXml, 'guid') ?? atomLink(entryXml) ?? `${feed.operation.url}:${index}`;
    const author = xmlElementText(entryXml, 'name') ?? xmlElementText(entryXml, 'author') ?? null;
    const permalink = atomLink(entryXml);
    const categories = atomCategories(entryXml);
    const community = communityFromCategories(categories, permalink);
    const contentFields = publicContentFields(entryXml, maxContentChars);
    return {
      id: `feed:${createHash('sha1').update(`${bucketId}:${sourceId}`).digest('hex').slice(0, 16)}`,
      externalId: sourceId,
      itemType: feedItemType(bucketId, feed),
      bucketId,
      source: feed.provider,
      provider: feed.provider,
      title: xmlElementText(entryXml, 'title'),
      author,
      community,
      communityUrl: community ? `https://www.reddit.com/r/${encodeURIComponent(community)}/` : null,
      categories,
      publishedAt: xmlElementText(entryXml, 'published') ?? xmlElementText(entryXml, 'pubDate') ?? null,
      updatedAt: xmlElementText(entryXml, 'updated') ?? null,
      permalink,
      url: permalink,
      ...contentFields,
      pathParams: feed.operation.pathParams ?? {},
      savedMaterial: feed.savedMaterial,
      rawFeedPersisted: false,
      rawBodyPersisted: false,
      authMaterialPersisted: false,
    };
  }).filter((item) => item.title || item.permalink || item.externalId);
  return profileItem ? [profileItem, ...entryItems] : entryItems;
}

function publicFeedFailure(commandResult, httpStatus, items) {
  if (commandResult.exitCode !== 0) {
    return {
      layer: 'api',
      reasonCode: 'reddit_public_feed_fetch_failed',
      remediation: 'Use verified site fallback now; retry the public feed replay from a permitted network before relying on this feed.',
    };
  }
  if (httpStatus && httpStatus >= 400) {
    return {
      layer: httpStatus === 429 ? 'rate_limit' : 'permission',
      reasonCode: `reddit_public_feed_http_${httpStatus}`,
      remediation: 'Use verified site fallback now; retry after network or permission conditions change.',
    };
  }
  if (!items.length) {
    return {
      layer: 'api',
      reasonCode: 'reddit_public_feed_no_items',
      remediation: 'Use verified site fallback or provide a subreddit/user with public feed entries.',
    };
  }
  return null;
}

async function executePublicFeedBucket(bucket, options, deps) {
  const feed = bucket.activeProgrammatic;
  const [command, ...args] = feed.command;
  const commandResult = await (deps.executeCommand ?? executeCommand)(command, args, {
    timeoutMs: options.timeoutMs,
    cwd: process.cwd(),
    env: deps.env ?? process.env,
  });
  const { body, httpStatus } = splitCurlBodyAndStatus(commandResult.stdout);
  const items = parsePublicFeedItems(body, bucket.id, feed, {
    maxItems: options.maxItems,
    maxContentChars: options.maxContentChars,
  });
  const failure = publicFeedFailure(commandResult, httpStatus, items);
  if (!failure) {
    return {
      bucketId: bucket.id,
      status: 'completed',
      provider: 'api',
      api: {
        status: 'success',
        provider: feed.provider,
        reasonCode: null,
        httpStatus,
        itemCount: items.length,
        command: feed.command,
        itemMaterial: feed.savedMaterial,
      },
      items,
    };
  }
  return {
    bucketId: bucket.id,
    status: 'blocked',
    provider: 'api',
    api: {
      status: 'failed',
      provider: feed.provider,
      reasonCode: failure.reasonCode,
      httpStatus,
      exitCode: commandResult.exitCode,
      command: feed.command,
    },
    failure,
    items: [],
  };
}

async function executeBucket(bucket, plan, options, deps) {
  const collectionMode = plan.task.collectionMode;
  const shouldTryActiveProgrammatic = bucket.activeProgrammatic && collectionMode !== 'site';
  if (shouldTryActiveProgrammatic) {
    const feedResult = await executePublicFeedBucket(bucket, options, deps);
    if (feedResult.status === 'completed') {
      return feedResult;
    }
    if (collectionMode === 'api') {
      return feedResult;
    }
    const fallback = await collectSiteFallbackItems(bucket, plan);
    return {
      bucketId: bucket.id,
      status: fallback.status,
      provider: 'site_fallback',
      api: feedResult.api,
      fallback: {
        status: fallback.status,
        reasonCode: fallback.reasonCode,
        authVerified: fallback.authVerified,
        routeCount: fallback.routeCount,
        capturedRouteCount: fallback.capturedRouteCount,
      },
      failure: {
        layer: fallback.failureLayer,
        reasonCode: fallback.reasonCode,
        remediation: fallback.remediation,
        apiFailure: feedResult.failure,
      },
      items: fallback.items,
    };
  }
  const shouldTryApi = bucket.primary && collectionMode !== 'site';
  if (shouldTryApi) {
    const [command, ...args] = bucket.primary.command;
    const commandResult = await (deps.executeCommand ?? executeCommand)(command, args, {
      timeoutMs: options.timeoutMs,
      cwd: process.cwd(),
      env: deps.env ?? process.env,
    });
    const parsed = parseCommandJson(commandResult.stdout);
    const execution = parsed?.execution ?? null;
    const apiItems = normalizeApiItems(execution?.items, bucket.id, {
      privateContentCandidate: bucket.privateContentCandidate === true,
    });
    const privateContentAuthorizationMissing = bucket.privateContentCandidate === true
      && apiItems.length > 0
      && options.allowPrivateContent !== true;
    if (
      commandResult.exitCode === 0
      && parsed?.ok === true
      && execution?.status === 'success'
      && apiItems.length
      && !privateContentAuthorizationMissing
    ) {
      return {
        bucketId: bucket.id,
        status: 'completed',
        provider: 'api',
        api: {
          status: execution.status,
          reasonCode: execution.reasonCode ?? null,
          httpStatus: execution.httpStatus ?? null,
          itemCount: apiItems.length,
          command: bucket.primary.command,
          privateContentGovernance: bucket.privateContentGovernance,
        },
        items: apiItems,
      };
    }
    const failure = privateContentAuthorizationMissing ? {
      layer: 'safety',
      reasonCode: 'private_content_authorization_required',
      remediation: 'Re-run with --allow-private-content only after explicit user authorization, OAuth runtime inputs, and the private-content field whitelist are acceptable.',
    } : apiFailureLayer(execution?.reasonCode ?? parsed?.execution?.reasonCode, commandResult.exitCode);
    if (collectionMode === 'api') {
      return {
        bucketId: bucket.id,
        status: 'blocked',
        provider: 'api',
        api: {
          status: privateContentAuthorizationMissing ? 'blocked' : execution?.status ?? 'failed',
          reasonCode: privateContentAuthorizationMissing ? failure.reasonCode : execution?.reasonCode ?? failure.reasonCode,
          exitCode: commandResult.exitCode,
          command: bucket.primary.command,
          privateContentGovernance: bucket.privateContentGovernance,
        },
        failure,
        items: [],
      };
    }
    const fallback = await collectSiteFallbackItems(bucket, plan);
    return {
      bucketId: bucket.id,
      status: fallback.status,
      provider: 'site_fallback',
      api: {
        status: privateContentAuthorizationMissing ? 'blocked' : execution?.status ?? 'failed',
        reasonCode: privateContentAuthorizationMissing ? failure.reasonCode : execution?.reasonCode ?? failure.reasonCode,
        exitCode: commandResult.exitCode,
        command: bucket.primary.command,
        privateContentGovernance: bucket.privateContentGovernance,
      },
      fallback: {
        status: fallback.status,
        reasonCode: fallback.reasonCode,
        authVerified: fallback.authVerified,
        routeCount: fallback.routeCount,
        capturedRouteCount: fallback.capturedRouteCount,
      },
      failure: {
        layer: fallback.failureLayer,
        reasonCode: fallback.reasonCode,
        remediation: fallback.remediation,
        apiFailure: failure,
      },
      items: fallback.items,
    };
  }
  const fallback = await collectSiteFallbackItems(bucket, plan);
  return {
    bucketId: bucket.id,
    status: fallback.status,
    provider: 'site_fallback',
    fallback: {
      status: fallback.status,
      reasonCode: fallback.reasonCode,
      authVerified: fallback.authVerified,
      routeCount: fallback.routeCount,
      capturedRouteCount: fallback.capturedRouteCount,
    },
    failure: fallback.status === 'blocked' ? {
      layer: fallback.failureLayer,
      reasonCode: fallback.reasonCode,
      remediation: fallback.remediation,
    } : {
      layer: fallback.failureLayer,
      reasonCode: fallback.reasonCode,
      remediation: fallback.remediation,
    },
    items: fallback.items,
  };
}

function dedupeItems(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = item.id ?? item.permalink ?? item.url ?? JSON.stringify(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function accountRows(items) {
  const rows = [];
  for (const item of items) {
    if (item.itemType === 'account' && item.username) {
      rows.push({
        handle: item.username,
        sourceItemId: item.id,
        bucketId: item.bucketId,
        profileUrl: item.profileUrl ?? null,
      });
    }
    if (item.author) {
      rows.push({
        handle: item.author,
        sourceItemId: item.id,
        bucketId: item.bucketId,
        profileUrl: `https://www.reddit.com/user/${encodeURIComponent(String(item.author))}/`,
      });
    }
  }
  return dedupeItems(rows.map((row) => ({ id: `account:${row.handle}`, ...row })));
}

function communityRows(items) {
  const rows = [];
  for (const item of items) {
    if (item.community) {
      rows.push({
        id: `community:${String(item.community).toLowerCase()}`,
        name: item.community,
        label: `r/${item.community}`,
        sourceItemId: item.id,
        bucketId: item.bucketId,
        url: item.communityUrl ?? `https://www.reddit.com/r/${encodeURIComponent(String(item.community))}/`,
      });
    }
  }
  return dedupeItems(rows);
}

async function writeArchiveFiles(plan, state, items) {
  await fs.mkdir(plan.layout.archiveDir, { recursive: true });
  for (const result of state.bucketResults) {
    const bucketItems = items.filter((item) => item.bucketId === result.bucketId);
    const lines = [
      `# ${result.bucketId}`,
      '',
      `Status: ${result.status}`,
      `Provider: ${result.provider}`,
      `Failure layer: ${result.failure?.layer ?? 'none'}`,
      `Reason: ${result.failure?.reasonCode ?? result.api?.reasonCode ?? result.fallback?.reasonCode ?? 'none'}`,
      `Remediation: ${result.failure?.remediation ?? 'none'}`,
      '',
      `Item count: ${bucketItems.length}`,
      '',
      ...bucketItems.slice(0, 20).map((item) => `- ${item.itemType ?? 'item'} ${item.title ?? item.name ?? item.routeTemplate ?? item.id}`),
      '',
    ];
    await fs.writeFile(path.join(plan.layout.archiveDir, `${stableSlug(result.bucketId)}.md`), `${lines.join('\n')}\n`, 'utf8');
  }
}

function buildCacheIndex(plan, state, items, deduped) {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactFamily: 'reddit-production-cache-index',
    taskId: plan.task.id,
    target: plan.task.target,
    artifacts: {
      plan: plan.layout.planPath,
      state: plan.layout.statePath,
      summary: plan.layout.summaryPath,
      report: plan.layout.reportPath,
      rawItems: plan.layout.rawItemsPath,
      dedupedItems: plan.layout.dedupedItemsPath,
      items: plan.layout.itemsPath,
      communities: plan.layout.communitiesPath,
      accounts: plan.layout.accountsPath,
      authors: plan.layout.authorsPath,
      mediaAssets: plan.layout.mediaAssetsPath,
    },
    counts: {
      rawItems: items.length,
      dedupedItems: deduped.length,
      completedBuckets: state.completedBucketIds.length,
      failedBuckets: state.failedBucketIds.length,
    },
    privacy: plan.outputContract,
  };
}

function buildSummary(plan, state, items, deduped) {
  const completed = state.bucketResults.filter((result) => ['completed', 'captured_with_warning'].includes(result.status));
  const apiCompleted = state.bucketResults.filter((result) => result.provider === 'api' && result.status === 'completed');
  const fallbackCompleted = state.bucketResults.filter((result) => result.provider === 'site_fallback' && result.status === 'captured_with_warning');
  const blocked = state.bucketResults.filter((result) => result.status === 'blocked');
  const descriptorOnly = deduped.filter((item) => item.itemType === 'verified_site_route_summary').length;
  const status = (() => {
    if (!state.bucketResults.length) {
      return 'planned';
    }
    if (completed.length === plan.buckets.length && blocked.length === 0) {
      return 'completed';
    }
    if (completed.length > 0) {
      return 'partial_success';
    }
    return blocked.length ? 'blocked' : 'running';
  })();
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactFamily: 'reddit-production-research-task-summary',
    taskId: plan.task.id,
    target: plan.task.target,
    status,
    bucketCount: plan.buckets.length,
    completedBucketCount: completed.length,
    apiCompletedBucketCount: apiCompleted.length,
    siteFallbackBucketCount: fallbackCompleted.length,
    blockedBucketCount: blocked.length,
    rawItemCount: items.length,
    dedupedItemCount: deduped.length,
    descriptorOnlyItemCount: descriptorOnly,
    evidenceCompleteness: {
      score: plan.buckets.length ? Math.round((completed.length / plan.buckets.length) * 100) : 0,
      grade: completed.length === plan.buckets.length ? 'complete_or_degraded_complete' : 'incomplete',
      caveat: descriptorOnly ? 'Some buckets are verified site structure only until OAuth API replay succeeds.' : null,
    },
    quality: {
      zeroEvidenceBuckets: state.bucketResults.filter((result) => !result.items?.length).map((result) => result.bucketId),
      degradedBuckets: state.bucketResults.filter((result) => result.status === 'captured_with_warning').map((result) => result.bucketId),
      blockedBuckets: blocked.map((result) => ({
        bucketId: result.bucketId,
        layer: result.failure?.layer ?? null,
        reasonCode: result.failure?.reasonCode ?? null,
        remediation: result.failure?.remediation ?? null,
      })),
    },
    safety: {
      sideEffectAttempted: false,
      mutationActionsBlockedByDefault: true,
      cookieMaterialPersisted: false,
      authHeaderPersisted: false,
      browserProfilePersisted: false,
      rawPrivateBodyPersisted: false,
    },
    artifacts: plan.layout,
  };
}

function renderReport(summary, state) {
  const lines = [
    `# Reddit task report: ${summary.taskId}`,
    '',
    `Target: ${summary.target}`,
    `Status: ${summary.status}`,
    `Buckets: ${summary.completedBucketCount}/${summary.bucketCount}`,
    `API completed buckets: ${summary.apiCompletedBucketCount}`,
    `Site fallback buckets: ${summary.siteFallbackBucketCount}`,
    `Blocked buckets: ${summary.blockedBucketCount}`,
    `Raw items: ${summary.rawItemCount}`,
    `Deduped items: ${summary.dedupedItemCount}`,
    `Descriptor-only route summaries: ${summary.descriptorOnlyItemCount}`,
    '',
    '## Failure and recovery',
    '',
  ];
  if (!summary.quality.blockedBuckets.length && !summary.quality.degradedBuckets.length) {
    lines.push('- No blocked or degraded buckets.');
  } else {
    for (const result of state.bucketResults) {
      if (result.status !== 'completed') {
        lines.push(`- ${result.bucketId}: ${result.failure?.layer ?? 'unknown'} / ${result.failure?.reasonCode ?? 'unknown'}; ${result.failure?.remediation ?? 'resume after fixing inputs'}`);
      }
    }
  }
  lines.push('', '## Safety', '', '- No cookies, tokens, auth headers, browser profile, or raw private body are persisted.');
  return `${lines.join('\n')}\n`;
}

async function persistArtifacts(plan, state, items) {
  const deduped = dedupeItems(items);
  const accounts = accountRows(deduped);
  const communities = communityRows(deduped);
  const mediaAssets = {
    schemaVersion: SCHEMA_VERSION,
    artifactFamily: 'reddit-media-assets',
    status: plan.inputs.downloadMedia ? 'inventory_only_no_binary_download' : 'disabled',
    explicitUserRequestRequired: true,
    assets: [],
  };
  const cacheIndex = buildCacheIndex(plan, state, items, deduped);
  const summary = buildSummary(plan, state, items, deduped);
  await writeJson(plan.layout.planPath, plan);
  await writeJson(plan.layout.statePath, state);
  await writeJsonl(plan.layout.rawItemsPath, items);
  await writeJsonl(plan.layout.dedupedItemsPath, deduped);
  await writeJsonl(plan.layout.itemsPath, deduped);
  await writeJsonl(plan.layout.communitiesPath, communities);
  await writeJsonl(plan.layout.accountsPath, accounts);
  await writeJsonl(plan.layout.authorsPath, accounts);
  await writeJson(plan.layout.cacheIndexPath, cacheIndex);
  await writeJsonl(plan.layout.cacheIndexJsonlPath, [{
    id: `${plan.task.id}:${createHash('sha1').update(plan.task.target).digest('hex').slice(0, 12)}`,
    ...cacheIndex.counts,
    summaryPath: plan.layout.summaryPath,
  }]);
  await writeJson(plan.layout.mediaAssetsPath, mediaAssets);
  await writeJsonl(plan.layout.mediaAssetsJsonlPath, mediaAssets.assets);
  await writeArchiveFiles(plan, state, deduped);
  await writeJson(plan.layout.summaryPath, summary);
  await fs.writeFile(plan.layout.reportPath, renderReport(summary, state), 'utf8');
  return { summary, deduped, accounts, communities, cacheIndex };
}

function executableBucketIds(state) {
  return new Set([...(state.completedBucketIds ?? []), ...(state.failedBucketIds ?? [])]);
}

export async function runRedditResearchTask(options, deps = /** @type {any} */ ({})) {
  if (options.help) {
    return { help: usage() };
  }
  const plan = buildTaskPlan({
    ...options,
    outDir: options.outDir ?? defaultOutDir(options),
  });
  if (plan.task.missingParameters.length) {
    await fs.mkdir(plan.layout.outDir, { recursive: true });
    const state = {
      ...defaultState(plan),
      status: 'blocked',
      failedBucketIds: plan.buckets.map((bucketItem) => bucketItem.id),
      bucketResults: plan.buckets.map((bucketItem) => ({
        bucketId: bucketItem.id,
        status: 'blocked',
        provider: 'planner',
        failure: {
          layer: 'planner',
          reasonCode: 'missing_required_parameters',
          missingParameters: plan.task.missingParameters,
          remediation: `Provide ${plan.task.missingParameters.join(', ')} and resume.`,
        },
        items: [],
      })),
    };
    const persisted = await persistArtifacts(plan, state, []);
    return { ok: false, plan, state, summary: persisted.summary };
  }
  await fs.mkdir(plan.layout.outDir, { recursive: true });
  await writeJson(plan.layout.planPath, plan);
  let state = options.resume
    ? await readJsonIfExists(plan.layout.statePath, defaultState(plan))
    : defaultState(plan);
  let items = options.resume || options.refreshReport ? await readJsonlIfExists(plan.layout.rawItemsPath) : [];
  if (!options.execute || options.dryRun || options.refreshReport) {
    const persisted = await persistArtifacts(plan, state, items);
    return { ok: true, plan, state, summary: persisted.summary };
  }
  const done = executableBucketIds(state);
  const pending = plan.buckets.filter((bucketItem) => !done.has(bucketItem.id));
  const limit = options.maxBucketsPerRun === null || options.maxBucketsPerRun === undefined
    ? pending.length
    : options.maxBucketsPerRun === 0 ? pending.length : options.maxBucketsPerRun;
  for (const bucketItem of pending.slice(0, limit)) {
    const result = await executeBucket(bucketItem, plan, options, deps);
    state.bucketResults = [
      ...state.bucketResults.filter((existing) => existing.bucketId !== bucketItem.id),
      result,
    ];
    if (['completed', 'captured_with_warning'].includes(result.status)) {
      state.completedBucketIds = [...new Set([...state.completedBucketIds, bucketItem.id])];
      state.failedBucketIds = state.failedBucketIds.filter((id) => id !== bucketItem.id);
    } else {
      state.failedBucketIds = [...new Set([...state.failedBucketIds, bucketItem.id])];
    }
    items = [...items, ...(result.items ?? [])];
    state.status = state.failedBucketIds.length ? 'partial_success' : 'running';
    state.updatedAt = new Date().toISOString();
    await persistArtifacts(plan, state, items);
  }
  state.status = state.failedBucketIds.length
    ? (state.completedBucketIds.length ? 'partial_success' : 'blocked')
    : (state.completedBucketIds.length === plan.buckets.length ? 'completed' : 'running');
  state.updatedAt = new Date().toISOString();
  const persisted = await persistArtifacts(plan, state, items);
  return {
    ok: state.status !== 'blocked',
    plan,
    state,
    summary: persisted.summary,
  };
}

export async function runRedditResearchTaskCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return { help: usage() };
  }
  const result = await runRedditResearchTask(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      taskId: result.plan?.task?.id,
      status: result.summary?.status,
      artifacts: result.summary?.artifacts,
      summary: result.summary,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`Reddit task ${result.plan.task.id}: ${result.summary.status}\n`);
    process.stdout.write(`Report: ${result.summary.artifacts.reportPath}\n`);
  }
  if (result.ok !== true) {
    process.exitCode = 1;
  }
  return result;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runRedditResearchTaskCli(process.argv.slice(2)).catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
