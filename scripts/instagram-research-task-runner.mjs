#!/usr/bin/env node
// @ts-check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const DEFAULT_OUT_ROOT = path.join('.siteforge', 'instagram-research-tasks');
const DEFAULT_RUNS_ROOT = path.join('.siteforge', 'instagram-live-runs-skill');
const DEFAULT_SITE_BUILD_ROOT = path.join('.siteforge', 'sites', 'instagram.com-ea2ecfbf', 'builds');
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_MAX_SCROLLS = 20;
const DEFAULT_SCROLL_WAIT_MS = 1000;
const DEFAULT_MEDIA_DOWNLOAD_TASKS = Object.freeze(new Set([
  'account-full-archive',
  'account-works-archive',
  'account-composite-profile',
  'account-content-profile',
]));
const VERIFIED_API_CAPABILITIES = Object.freeze([
  'instagram-api-profile-info',
  'instagram-api-profile-posts',
  'instagram-api-profile-relations',
]);
const VERIFIED_API_OPERATIONS = Object.freeze({
  profilePosts: 'instagram-feed-user',
  profileFollowing: 'instagram-friendships-following',
  profileFollowers: 'instagram-friendships-followers',
});

const TASKS = Object.freeze({
  'account-full-archive': Object.freeze({
    id: 'account-full-archive',
    label: 'Instagram account full sanitized archive',
    required: ['account'],
  }),
  'account-works-archive': Object.freeze({
    id: 'account-works-archive',
    label: 'Instagram account works sanitized archive',
    required: ['account'],
  }),
  'keyword-trend': Object.freeze({
    id: 'keyword-trend',
    label: 'Instagram keyword search and trend analysis',
    required: ['query'],
  }),
  'industry-report': Object.freeze({
    id: 'industry-report',
    label: 'Instagram topic or industry report',
    required: ['query'],
  }),
  'account-composite-profile': Object.freeze({
    id: 'account-composite-profile',
    label: 'Instagram account composite profile',
    required: ['account'],
  }),
  'account-content-profile': Object.freeze({
    id: 'account-content-profile',
    label: 'Instagram account content profile',
    required: ['account'],
  }),
  'relation-list-collection': Object.freeze({
    id: 'relation-list-collection',
    label: 'Instagram relation list collection',
    required: ['account'],
  }),
  'event-timeline': Object.freeze({
    id: 'event-timeline',
    label: 'Instagram event timeline report',
    required: ['query'],
  }),
  'similar-account-discovery': Object.freeze({
    id: 'similar-account-discovery',
    label: 'Instagram similar account discovery',
    required: ['account'],
  }),
});

const TASK_ALIASES = Object.freeze({
  archive: 'account-full-archive',
  'account-archive': 'account-full-archive',
  'account-full-archive': 'account-full-archive',
  'full-archive': 'account-full-archive',
  works: 'account-works-archive',
  'works-archive': 'account-works-archive',
  'account-works': 'account-works-archive',
  'account-works-archive': 'account-works-archive',
  trend: 'keyword-trend',
  'keyword-trend': 'keyword-trend',
  search: 'keyword-trend',
  report: 'industry-report',
  'topic-report': 'industry-report',
  'industry-report': 'industry-report',
  'weekly-report': 'industry-report',
  'monthly-report': 'industry-report',
  profile: 'account-composite-profile',
  'account-profile': 'account-composite-profile',
  'account-composite-profile': 'account-composite-profile',
  content: 'account-content-profile',
  'content-profile': 'account-content-profile',
  'account-content-profile': 'account-content-profile',
  relations: 'relation-list-collection',
  relation: 'relation-list-collection',
  'relation-list': 'relation-list-collection',
  'relation-list-collection': 'relation-list-collection',
  timeline: 'event-timeline',
  'event-timeline': 'event-timeline',
  similar: 'similar-account-discovery',
  'similar-accounts': 'similar-account-discovery',
  'similar-account-discovery': 'similar-account-discovery',
});

function usage() {
  return `Usage:
  node scripts/instagram-research-task-runner.mjs --task <task> [options]

Tasks:
  account-full-archive       Account posts/reels/media/profile/relation sanitized archive plan.
  account-works-archive      Account works/posts/reels/media/highlights sanitized archive plan.
  keyword-trend              Keyword search and trend evidence buckets.
  industry-report            Topic or industry report from search evidence buckets.
  account-composite-profile  Profile, content, media, and relation profile.
  account-content-profile    Profile plus content-only summary without relation lists.
  relation-list-collection   Followers/following list collection with safety boundaries.
  event-timeline             Search/date bucket timeline report.
  similar-account-discovery  Seed profile plus related account search buckets.

Options:
  --account <handle>         Required for account tasks.
  --query <value>            Required for query tasks.
  --from YYYY-MM-DD          Optional event/trend start date metadata.
  --to YYYY-MM-DD            Optional event/trend end date metadata.
  --execute                  Execute pending site fallback buckets.
  --resume                   Resume from existing task-state.json.
  --retry-failed             Requeue failed buckets before executing a resumed task.
  --refresh-report           Rewrite summary/report from existing state.
  --dry-run                  Plan only.
  --dry-run-actions          Execute fallback commands with instagram-action --dry-run.
  --download-media           Download discovered image/video binaries for media-capable buckets.
  --no-download-media        Disable media binary downloads even for account archive tasks.
  --use-build-summary-fallback
                             On login failure, reuse sanitized SiteForge structure summary as degraded evidence.
  --build-summary-path <path>
                             Optional crawl_authenticated.json path for structure fallback.
  --cookie-file <path>       User-provided Instagram login-state cookie file; used only for live child commands.
  --out-dir <path>           Default: .siteforge/instagram-research-tasks/<task-target>
  --runs-root <path>         Default: .siteforge/instagram-live-runs-skill
  --max-items <n>            Default: 100.
  --max-scrolls <n>          Default: 20.
  --scroll-wait-ms <n>       Default: 1000.
  --max-buckets-per-run <n>  0 means all pending buckets.
  --timeout <ms>             Command timeout. Default: 120000.
  --now <iso-date>           Stable date for tests.
  --json                     Print JSON result.
`;
}

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTask(value) {
  const token = String(value ?? '').trim().toLowerCase().replace(/_/gu, '-');
  return TASK_ALIASES[token] ?? token;
}

function normalizeAccount(value) {
  return String(value ?? '').trim().replace(/^@/u, '');
}

function parseInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    task: null,
    account: null,
    query: null,
    from: null,
    to: null,
    subjects: null,
    execute: false,
    resume: false,
    retryFailed: false,
    refreshReport: false,
    dryRun: false,
    dryRunActions: false,
    downloadMedia: null,
    useBuildSummaryFallback: false,
    buildSummaryPath: null,
    cookieFile: null,
    outDir: null,
    runsRoot: DEFAULT_RUNS_ROOT,
    statePath: null,
    maxItems: DEFAULT_MAX_ITEMS,
    maxScrolls: DEFAULT_MAX_SCROLLS,
    scrollWaitMs: DEFAULT_SCROLL_WAIT_MS,
    maxBucketsPerRun: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    now: null,
    help: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--task':
      case '--task-type':
        options.task = normalizeTask(next);
        index += 1;
        break;
      case '--account':
      case '--handle':
      case '--user':
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
      case '--subjects':
        options.subjects = splitCsv(next);
        index += 1;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--retry-failed':
      case '--retry-failed-buckets':
        options.retryFailed = true;
        break;
      case '--refresh-report':
        options.refreshReport = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--dry-run-actions':
        options.dryRunActions = true;
        break;
      case '--download-media':
        options.downloadMedia = true;
        break;
      case '--no-download-media':
        options.downloadMedia = false;
        break;
      case '--use-build-summary-fallback':
      case '--use-authorized-summary-fallback':
        options.useBuildSummaryFallback = true;
        break;
      case '--build-summary-path':
      case '--authorized-summary-path':
      case '--structure-summary-path':
        options.buildSummaryPath = next;
        index += 1;
        break;
      case '--cookie-file':
      case '--cookies-file':
        options.cookieFile = next;
        index += 1;
        break;
      case '--out-dir':
        options.outDir = next;
        index += 1;
        break;
      case '--runs-root':
        options.runsRoot = next;
        index += 1;
        break;
      case '--state-path':
        options.statePath = next;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = parseInteger(next, DEFAULT_MAX_ITEMS);
        index += 1;
        break;
      case '--max-scrolls':
        options.maxScrolls = parseInteger(next, DEFAULT_MAX_SCROLLS);
        index += 1;
        break;
      case '--scroll-wait-ms':
      case '--scroll-wait':
        options.scrollWaitMs = parseInteger(next, DEFAULT_SCROLL_WAIT_MS);
        index += 1;
        break;
      case '--max-buckets-per-run':
        options.maxBucketsPerRun = parseInteger(next, 0);
        index += 1;
        break;
      case '--timeout':
        options.timeoutMs = parseInteger(next, DEFAULT_TIMEOUT_MS);
        index += 1;
        break;
      case '--now':
        options.now = next;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        if (!options.task && !arg.startsWith('--')) {
          options.task = normalizeTask(arg);
        }
        break;
    }
  }
  if (!options.task && !options.help) {
    options.task = 'account-composite-profile';
  }
  return options;
}

function defaultDownloadMediaForTask(task) {
  return DEFAULT_MEDIA_DOWNLOAD_TASKS.has(String(task ?? ''));
}

function effectiveDownloadMedia(options) {
  if (options.downloadMedia === true) return true;
  if (options.downloadMedia === false) return false;
  return defaultDownloadMediaForTask(options.task);
}

function compactSlug(value, fallback = 'instagram-task') {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return slug || fallback;
}

function fingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 12);
}

function nowIso(options) {
  return options.now ? new Date(`${options.now}T00:00:00.000Z`).toISOString() : new Date().toISOString();
}

function subjectList(options) {
  if (options.subjects?.length) return options.subjects;
  const query = String(options.query ?? '').trim();
  return query
    .split(/\s*(?:,|;|\band\b|\bor\b|和|与|及)\s*/iu)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function validateOptions(options) {
  if (options.help) return [];
  const task = TASKS[options.task];
  if (!task) return [`unknown-task:${options.task}`];
  const missing = [];
  for (const field of task.required) {
    if (!options[field]) missing.push(field);
  }
  return missing.map((field) => `missing-${field}`);
}

function buildOutputLayout(task, options) {
  const target = options.account || options.query || task;
  const outDir = path.resolve(options.outDir || path.join(DEFAULT_OUT_ROOT, compactSlug(`${task}-${target}`)));
  const archiveDir = path.join(outDir, 'archive');
  return {
    outDir,
    archiveDir,
    statePath: path.resolve(options.statePath || path.join(outDir, 'task-state.json')),
    planPath: path.join(outDir, 'task-plan.json'),
    summaryPath: path.join(outDir, 'task-summary.json'),
    reportPath: path.join(outDir, 'task-report.md'),
    rawItemsPath: path.join(outDir, 'raw-items.jsonl'),
    dedupedItemsPath: path.join(outDir, 'deduped-items.jsonl'),
    accountsDir: path.join(outDir, 'accounts'),
    authorsDir: path.join(outDir, 'authors'),
    accountsPath: path.join(outDir, 'accounts', 'items.jsonl'),
    authorsPath: path.join(outDir, 'authors', 'items.jsonl'),
    cacheIndexPath: path.join(outDir, 'cache-index.json'),
    cacheIndexJsonlPath: path.join(outDir, 'cache-index.jsonl'),
    mediaAssetsPath: path.join(outDir, 'media-assets.json'),
    mediaAssetsJsonlPath: path.join(outDir, 'media-assets.jsonl'),
    archiveIndexPath: path.join(archiveDir, 'index.md'),
    archiveReportPath: path.join(archiveDir, 'task.md'),
  };
}

function verifiedApiOperationForBucket(action, extra = {}) {
  if (action === 'profile-following') return VERIFIED_API_OPERATIONS.profileFollowing;
  if (action === 'profile-followers') return VERIFIED_API_OPERATIONS.profileFollowers;
  if (action === 'profile-content' && String(extra.contentType ?? 'posts') === 'posts') {
    return VERIFIED_API_OPERATIONS.profilePosts;
  }
  return null;
}

function baseInstagramActionCommand(action, options, extra = {}) {
  const command = [
    'node',
    'src/entrypoints/sites/instagram-action.mjs',
    action,
    '--reuse-login-state',
    '--no-session-health-plan',
    '--no-headless',
    '--timeout',
    String(options.timeoutMs),
    '--out-dir',
    path.resolve(options.runsRoot),
    '--artifact-run-id',
    extra.artifactRunId,
    '--json',
    '--quiet',
    '--progress',
    'plain',
    '--no-tty',
  ];
  if (options.dryRunActions) command.push('--dry-run');
  if (options.resume && !options.retryFailed) command.push('--resume');
  if (options.downloadMedia && mediaDownloadSupportedForBucket(action, extra)) command.push('--download-media');
  if (extra.account) command.push('--account', extra.account);
  if (extra.query) command.push('--query', extra.query);
  if (extra.route) command.push('--route', extra.route);
  if (extra.contentType) command.push('--content-type', extra.contentType);
  if (extra.apiCursor === true) command.push('--api-cursor');
  if (extra.maxItems !== undefined) command.push('--max-items', String(extra.maxItems));
  if (extra.maxUsers !== undefined) command.push('--max-users', String(extra.maxUsers));
  command.push('--max-scrolls', String(options.maxScrolls));
  command.push('--scroll-wait', String(options.scrollWaitMs));
  return command;
}

function mediaDownloadSupportedForBucket(action, extra = {}) {
  if (action === 'search') return true;
  if (action !== 'profile-content') return false;
  return ['posts', 'reels', 'media', 'highlights'].includes(String(extra.contentType ?? ''));
}

function createBucket(id, label, action, options, extra = {}) {
  const artifactRunId = compactSlug(`instagram-${options.task}-${options.targetFingerprint}-${id}`);
  const apiOperation = verifiedApiOperationForBucket(action, extra);
  const siteFallbackCommand = baseInstagramActionCommand(action, options, {
    artifactRunId,
    maxItems: options.maxItems,
    maxUsers: options.maxItems,
    apiCursor: Boolean(apiOperation),
    ...extra,
  });
  return {
    id,
    label,
    action,
    account: extra.account ?? null,
    query: extra.query ?? null,
    route: extra.route ?? null,
    contentType: extra.contentType ?? null,
    apiFirst: {
      active: Boolean(apiOperation),
      verified: Boolean(apiOperation),
      command: apiOperation ? siteFallbackCommand : null,
      operationId: apiOperation,
      reasonCode: apiOperation ? null : 'no_replay_verified_instagram_api_for_bucket',
      fallbackPolicy: 'immediate_verified_site_fallback',
    },
    siteFallback: {
      verified: true,
      command: siteFallbackCommand,
      reasonCode: 'verified_site_action_fallback',
    },
    artifactRunId,
    status: 'pending',
    attempts: 0,
    failure: null,
  };
}

function buildAccountArchiveBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and public metadata', 'account-info', options, { account }),
    createBucket('posts', 'Profile post summaries', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('reels', 'Profile reel summaries', 'profile-content', options, { account, contentType: 'reels' }),
    createBucket('media', 'Profile media summaries', 'profile-content', options, { account, contentType: 'media' }),
    createBucket('following', 'Following relation list', 'profile-following', options, { account }),
    createBucket('followers', 'Follower relation list', 'profile-followers', options, { account }),
    createBucket('highlights', 'Profile highlight summaries', 'profile-content', options, { account, contentType: 'highlights' }),
  ];
}

function buildAccountWorksArchiveBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and public metadata', 'account-info', options, { account }),
    createBucket('posts', 'Profile post summaries', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('reels', 'Profile reel summaries', 'profile-content', options, { account, contentType: 'reels' }),
    createBucket('media', 'Profile media summaries', 'profile-content', options, { account, contentType: 'media' }),
    createBucket('highlights', 'Profile highlight summaries', 'profile-content', options, { account, contentType: 'highlights' }),
  ];
}

function buildTrendBuckets(options) {
  const subjects = subjectList(options);
  return subjects.map((subject, index) => createBucket(
    `search-${index + 1}`,
    `Search evidence for ${subject}`,
    'search',
    options,
    { query: subject },
  ));
}

function buildCompositeProfileBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and metadata', 'account-info', options, { account }),
    createBucket('posts', 'Recent profile posts', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('reels', 'Recent profile reels', 'profile-content', options, { account, contentType: 'reels' }),
    createBucket('following', 'Following relation sample', 'profile-following', options, { account }),
    createBucket('followers', 'Follower relation sample', 'profile-followers', options, { account }),
  ];
}

function buildContentProfileBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and metadata', 'account-info', options, { account }),
    createBucket('posts', 'Recent profile posts', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('reels', 'Recent profile reels', 'profile-content', options, { account, contentType: 'reels' }),
  ];
}

function buildRelationBuckets(options) {
  const account = options.account;
  return [
    createBucket('following', 'Following relation list', 'profile-following', options, { account }),
    createBucket('followers', 'Follower relation list', 'profile-followers', options, { account }),
  ];
}

function buildSimilarAccountBuckets(options) {
  const account = options.account;
  return [
    createBucket('seed-profile', 'Seed profile metadata', 'account-info', options, { account }),
    createBucket('seed-following', 'Seed following relations', 'profile-following', options, { account }),
    createBucket('seed-content', 'Seed profile content terms', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('candidate-search', `Related account search for ${account}`, 'search', options, { query: account }),
  ];
}

function buildTaskBuckets(options) {
  switch (options.task) {
    case 'account-full-archive':
      return buildAccountArchiveBuckets(options);
    case 'account-works-archive':
      return buildAccountWorksArchiveBuckets(options);
    case 'keyword-trend':
    case 'industry-report':
    case 'event-timeline':
      return buildTrendBuckets(options);
    case 'account-composite-profile':
      return buildCompositeProfileBuckets(options);
    case 'account-content-profile':
      return buildContentProfileBuckets(options);
    case 'relation-list-collection':
      return buildRelationBuckets(options);
    case 'similar-account-discovery':
      return buildSimilarAccountBuckets(options);
    default:
      return [];
  }
}

function artifactContract(layout) {
  return {
    requiredFiles: [
      'task-plan.json',
      'task-state.json',
      'task-summary.json',
      'task-report.md',
      'raw-items.jsonl',
      'deduped-items.jsonl',
      'accounts/items.jsonl',
      'authors/items.jsonl',
      'cache-index.json',
      'cache-index.jsonl',
      'media-assets.json',
      'media-assets.jsonl',
      'archive/index.md',
    ],
    optionalFiles: [
      'archive/task.md',
    ],
    paths: layout,
    materialPolicy: {
      savedMaterial: 'sanitized_summary_only',
      mediaMaterial: 'governed_image_video_binaries_when_download_media_enabled',
      forbidden: [
        'cookie',
        'token',
        'authorization_header',
        'browser_profile',
        'raw_private_body',
        'payment_or_account_mutation',
      ],
    },
  };
}

function buildTaskPlan(options) {
  const task = TASKS[options.task];
  const target = options.account || options.query || options.task;
  const downloadMedia = effectiveDownloadMedia(options);
  const nextOptions = {
    ...options,
    downloadMedia,
    targetFingerprint: fingerprint(`${options.task}:${target}`),
  };
  const layout = buildOutputLayout(options.task, nextOptions);
  return {
    schemaVersion: SCHEMA_VERSION,
    siteKey: 'instagram',
    generatedAt: nowIso(options),
    task: {
      id: task.id,
      label: task.label,
      target,
      account: options.account,
      query: options.query,
      from: options.from,
      to: options.to,
      defaults: {
        downloadMedia,
      },
      noStallPolicy: {
        apiUnavailable: 'immediate-site-fallback',
        sameSurfaceCooldown: 'do-not-wait-preserve-state',
        resume: 'reuse-task-state-before-live-retry',
      },
    },
    apiFirstPolicy: {
      status: 'active_api_with_verified_site_fallback',
      activeApiCapabilities: VERIFIED_API_CAPABILITIES,
      reasonCode: null,
      rule: 'Only replay verified, adapter bound, runtime tested API operations may become active.',
      fallback: 'verified_site_action',
    },
    safety: {
      mutationCapabilitiesDefault: 'blocked',
      downloadMediaDefault: defaultDownloadMediaForTask(task.id)
        ? 'enabled_for_account_content_archive_tasks'
        : 'disabled_unless_explicit_download_media',
      savedMaterial: 'sanitized_summary_only',
    },
    layout,
    artifactContract: artifactContract(layout),
    buckets: buildTaskBuckets(nextOptions),
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, value, 'utf8');
}

async function writeJsonl(filePath, rows) {
  await ensureDir(path.dirname(filePath));
  const text = rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
  await fs.writeFile(filePath, text, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonlIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function findLatestBuildSummaryPath() {
  try {
    const entries = await fs.readdir(DEFAULT_SITE_BUILD_ROOT, { withFileTypes: true });
    const buildIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const buildId of buildIds) {
      const candidate = path.join(DEFAULT_SITE_BUILD_ROOT, buildId, 'crawl_authenticated.json');
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try the next build.
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeRouteText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function bucketMatchesStructurePage(bucket, page) {
  const route = normalizeRouteText(page?.routeTemplate ?? page?.routePath ?? page?.url);
  const pageType = normalizeRouteText(page?.pageType ?? page?.pageKind);
  switch (bucket.action) {
    case 'account-info':
      return pageType === 'author-page' && route.includes('{account}') && !route.includes('/reels') && !route.includes('/tagged');
    case 'profile-content':
      if (bucket.contentType === 'reels') return route.includes('/reels') || route.includes('/reel/');
      if (bucket.contentType === 'highlights') return route.includes('/stories') || route.includes('highlight');
      return pageType === 'author-page' || pageType === 'content-detail-page';
    case 'profile-following':
      return pageType === 'author-list-page' && route.includes('/following');
    case 'profile-followers':
      return pageType === 'author-list-page' && route.includes('/followers');
    case 'search':
      return pageType === 'search-results-page' || route.includes('/explore/search');
    default:
      return false;
  }
}

function structurePageToItemRow(page, bucket, sourcePath, index) {
  const routeTemplate = page?.routeTemplate ?? page?.routePath ?? null;
  return {
    id: `instagram-structure:${bucket.id}:${fingerprint(`${routeTemplate}:${index}`)}`,
    siteKey: 'instagram',
    sourceKind: 'authorized_structure_summary',
    sourceArtifact: sourcePath,
    bucketId: bucket.id,
    action: bucket.action,
    account: bucket.account,
    query: bucket.query,
    url: page?.canonicalUrl ?? page?.normalizedUrl ?? page?.url ?? null,
    routeTemplate,
    pageType: page?.pageType ?? null,
    visibleItemCount: Number(page?.visibleItemCount ?? 0),
    listPresent: page?.listPresent === true,
    emptyStatePresent: page?.emptyStatePresent === true,
    structureHash: page?.structureHash ?? null,
    degradation: 'structure_summary_only',
    reasonCode: 'live_login_missing_reused_authorized_structure_summary',
    savedMaterial: 'sanitized_summary_only',
  };
}

async function collectBuildSummaryFallbackRows(bucket, state) {
  if (state.options?.useBuildSummaryFallback !== true) {
    return null;
  }
  const sourcePath = state.options?.buildSummaryPath
    ? path.resolve(state.options.buildSummaryPath)
    : await findLatestBuildSummaryPath();
  if (!sourcePath) {
    return {
      sourcePath: null,
      items: [],
      accounts: [],
      reasonCode: 'build_summary_fallback_not_found',
    };
  }
  const summary = await readJson(sourcePath);
  const pages = Array.isArray(summary?.authenticatedPages)
    ? summary.authenticatedPages
    : Array.isArray(summary?.pages)
      ? summary.pages
      : [];
  const matched = pages.filter((page) => bucketMatchesStructurePage(bucket, page));
  const fallbackMatched = matched.length ? matched : pages.filter((page) => {
    const pageType = normalizeRouteText(page?.pageType ?? page?.pageKind);
    const route = normalizeRouteText(page?.routeTemplate ?? page?.routePath ?? page?.url);
    return pageType === 'author-page' && route.includes('{account}');
  }).slice(0, 1);
  const items = fallbackMatched.map((page, index) => ({
    ...structurePageToItemRow(page, bucket, sourcePath, index),
    fallbackPrecision: matched.length ? 'exact_bucket_surface' : 'profile_structure_substitute',
  }));
  const accounts = bucket.account && matched.length
    ? [{
      id: `instagram-account-structure:${fingerprint(bucket.account)}`,
      handle: bucket.account,
      siteKey: 'instagram',
      sourceKind: 'authorized_structure_summary',
      sourceArtifact: sourcePath,
      bucketId: bucket.id,
      degradation: 'structure_summary_only',
      reasonCode: 'live_login_missing_reused_authorized_structure_summary',
      savedMaterial: 'sanitized_summary_only',
    }]
    : [];
  return {
    sourcePath,
    items,
    accounts,
    reasonCode: matched.length
      ? 'live_login_missing_reused_authorized_structure_summary'
      : fallbackMatched.length
        ? 'live_login_missing_reused_profile_structure_summary'
        : 'build_summary_no_matching_structure_page',
  };
}

function initialState(plan, options) {
  return {
    schemaVersion: SCHEMA_VERSION,
    siteKey: 'instagram',
    task: plan.task,
    plan,
    layout: plan.layout,
    createdAt: plan.generatedAt,
    updatedAt: plan.generatedAt,
    resumeCount: 0,
    buckets: plan.buckets.map((bucket) => ({ ...bucket })),
    apiFirstPolicy: plan.apiFirstPolicy,
    failures: [],
    options: {
      execute: options.execute,
      dryRunActions: options.dryRunActions,
      retryFailed: options.retryFailed,
      maxItems: options.maxItems,
      maxScrolls: options.maxScrolls,
      maxBucketsPerRun: options.maxBucketsPerRun,
      downloadMedia: effectiveDownloadMedia(options),
      useBuildSummaryFallback: options.useBuildSummaryFallback,
      buildSummaryPath: options.buildSummaryPath,
      userProvidedLoginState: Boolean(options.cookieFile),
    },
  };
}

function commandWithTransientLoginState(command, options) {
  if (!options?.cookieFile) {
    return command;
  }
  return [...command, '--cookie-file', path.resolve(options.cookieFile)];
}

function parseCommandJson(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

async function executeCommand(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ exitCode: 124, stdout, stderr: `${stderr}\ncommand timed out after ${timeoutMs}ms`.trim() });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function classifyFailure({ exitCode, stdout, stderr, parsed }) {
  const text = `${stdout ?? ''}\n${stderr ?? ''}\n${JSON.stringify(parsed ?? {})}`.toLowerCase();
  if (/no_replay_verified_instagram_api|no verified api/u.test(text)) return {
    layer: 'api',
    reasonCode: 'no_replay_verified_instagram_api',
    remediation: '补充脱敏 API capture、回放验证和 adapter binding 后才能启用 API 能力；当前立即使用 verified site fallback。',
  };
  if (/relation-surface-empty|empty|0 items|no result/u.test(text)) return {
    layer: 'empty_result',
    reasonCode: 'empty_result',
    remediation: '确认账号/关键词存在且授权摘要覆盖该 route；必要时扩大查询或刷新结构摘要。',
  };
  if (/login|auth|session|not authenticated|challenge|profile.*json|profile.*missing|enoent.*profiles/u.test(text)) return {
    layer: 'login',
    reasonCode: 'login_or_session_required',
    remediation: '刷新用户授权浏览器会话，只保留脱敏结构摘要，不输出 session 材料。',
  };
  if (/robot/u.test(text)) return {
    layer: 'robots',
    reasonCode: 'robots_or_access_policy',
    remediation: '遵守 robots 和站点策略；改用已有授权摘要或降低任务范围。',
  };
  if (/rate.?limit|too many requests|cooldown/u.test(text)) return {
    layer: 'rate_limit',
    reasonCode: 'rate_limited',
    remediation: '不要等待或重试同一 surface；保留 state，改用缓存、非冲突 fallback 或 degraded bucket。',
  };
  if (/selector|locator|element/u.test(text)) return {
    layer: 'selector',
    reasonCode: 'selector_changed',
    remediation: '刷新 verified site fallback 的结构证据和选择器绑定。',
  };
  if (/permission|forbidden|private|blocked/u.test(text)) return {
    layer: 'permission_or_policy',
    reasonCode: 'permission_or_policy_blocked',
    remediation: '不要绕过权限；只输出可访问的脱敏摘要，并说明缺口。',
  };
  return {
    layer: 'runtime',
    reasonCode: exitCode === 124 ? 'command_timeout' : 'runtime_command_failed',
    remediation: '查看 bucket 的 manifest/report 路径；用 --resume 从 task-state.json 继续。',
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function mediaKey(record = {}) {
  return record.id
    ?? `${record.sourceItemId ?? record.itemId ?? ''}|${record.sourceItemUrl ?? record.pageUrl ?? ''}|${record.mediaIndex ?? ''}|${record.url ?? ''}|${record.type ?? ''}`;
}

function normalizeMediaRecord(record = {}, bucket, statusFallback = null) {
  const localPath = record.localPath ?? record.filePath ?? null;
  const status = record.status ?? statusFallback ?? (record.ok === true ? 'downloaded' : 'planned');
  return {
    ...record,
    id: record.id ?? fingerprint(`${bucket.id}:${mediaKey(record)}`),
    bucketId: bucket.id,
    action: bucket.action,
    bucketContentType: bucket.contentType ?? null,
    sourceItemId: record.sourceItemId ?? record.itemId ?? null,
    sourceItemUrl: record.sourceItemUrl ?? record.pageUrl ?? null,
    localPath,
    filePath: record.filePath ?? localPath,
    status,
    ok: record.ok === true || status === 'downloaded',
  };
}

function mediaAssetsFromBucket(bucket) {
  const download = bucket.siteFallbackResult?.download ?? bucket.result?.download ?? null;
  if (!download) return [];
  const records = new Map();
  const add = (record, statusFallback = null) => {
    if (!record || typeof record !== 'object') return;
    const normalized = normalizeMediaRecord(record, bucket, statusFallback);
    records.set(mediaKey(normalized), normalized);
  };
  for (const record of toArray(download.expectedMedia)) add(record, 'planned');
  for (const record of toArray(download.downloadCandidates)) add(record, 'planned');
  for (const record of toArray(download.queue)) add(record, record.status ?? 'pending');
  for (const record of toArray(download.downloads)) add(record, record.status ?? (record.ok === true ? 'downloaded' : 'failed'));
  return [...records.values()];
}

function gatherMediaAssets(state) {
  const assets = [];
  for (const bucket of state.buckets ?? []) {
    assets.push(...mediaAssetsFromBucket(bucket));
  }
  const seen = new Set();
  return assets.filter((asset) => {
    const key = mediaKey(asset);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeMediaAssets(state, assets) {
  const enabled = state.task?.defaults?.downloadMedia === true || state.options?.downloadMedia === true;
  const counts = {
    total: assets.length,
    downloaded: assets.filter((asset) => asset.ok === true || asset.status === 'downloaded').length,
    failed: assets.filter((asset) => asset.status === 'failed').length,
    pending: assets.filter((asset) => asset.status === 'pending').length,
    planned: assets.filter((asset) => asset.status === 'planned').length,
    images: assets.filter((asset) => asset.type === 'image').length,
    videos: assets.filter((asset) => asset.type === 'video').length,
  };
  const status = !enabled
    ? 'disabled'
    : counts.total === 0
      ? 'planned'
      : counts.failed > 0
        ? 'partial'
        : counts.downloaded >= counts.total
          ? 'complete'
          : 'incomplete';
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    enabled,
    reason: enabled ? null : 'media_download_disabled',
    counts,
    assets,
  };
}

async function collectRowsFromArtifact(filePath, bucket, kind) {
  const rows = await readJsonlIfExists(filePath);
  return rows.map((row, index) => ({
    ...row,
    siteKey: 'instagram',
    taskId: bucket.taskId,
    bucketId: bucket.id,
    sourceKind: kind,
    sourceArtifact: filePath,
    rowIndex: index,
    savedMaterial: 'sanitized_summary_only',
  }));
}

function accountRowsFromParsedResult(parsed, bucket) {
  const account = parsed?.result?.account;
  if (!account || typeof account !== 'object' || Array.isArray(account)) return [];
  return [{
    ...account,
    siteKey: 'instagram',
    taskId: bucket.taskId,
    bucketId: bucket.id,
    sourceKind: 'account',
    sourceArtifact: 'siteFallbackResult.result.account',
    rowIndex: 0,
    savedMaterial: 'sanitized_summary_only',
  }];
}

function dedupeRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = row.handle
      ? `handle:${String(row.handle).toLowerCase()}`
      : row.id ?? row.url ?? row.href ?? JSON.stringify(row).slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

async function gatherBucketRows(state) {
  const rawItems = [];
  const accounts = [];
  for (const bucket of state.buckets) {
    if (Array.isArray(bucket.structureFallbackRows?.items)) {
      rawItems.push(...bucket.structureFallbackRows.items.map((row, index) => ({
        ...row,
        taskId: state.task.id,
        rowIndex: index,
      })));
    }
    if (Array.isArray(bucket.structureFallbackRows?.accounts)) {
      accounts.push(...bucket.structureFallbackRows.accounts.map((row, index) => ({
        ...row,
        taskId: state.task.id,
        rowIndex: index,
      })));
    }
    const artifacts = bucket.siteFallbackResult?.artifacts ?? bucket.result?.artifacts ?? {};
    if (artifacts.items) rawItems.push(...await collectRowsFromArtifact(artifacts.items, { ...bucket, taskId: state.task.id }, 'item'));
    if (artifacts.users) accounts.push(...await collectRowsFromArtifact(artifacts.users, { ...bucket, taskId: state.task.id }, 'account'));
    accounts.push(...accountRowsFromParsedResult(bucket.siteFallbackResult, { ...bucket, taskId: state.task.id }));
  }
  return {
    rawItems,
    dedupedItems: dedupeRows(rawItems),
    accounts: dedupeRows(accounts),
  };
}

function summarizeState(state, rows, mediaAssets = []) {
  const bucketCounts = state.buckets.reduce((counts, bucket) => {
    counts[bucket.status] = (counts[bucket.status] ?? 0) + 1;
    return counts;
  }, {});
  const complete = state.buckets.every((bucket) => ['completed', 'captured_with_warning', 'blocked', 'failed'].includes(bucket.status));
  const failed = state.buckets.filter((bucket) => bucket.status === 'failed');
  const blocked = state.buckets.filter((bucket) => bucket.status === 'blocked');
  const warningBuckets = state.buckets.filter((bucket) => bucket.status === 'captured_with_warning' || bucket.status === 'planned');
  const bucketFailures = state.buckets
    .map((bucket) => bucket.failure)
    .filter(Boolean);
  const completedBuckets = state.buckets.filter((bucket) => bucket.status === 'completed');
  const degradedBuckets = state.buckets.filter((bucket) => bucket.status === 'captured_with_warning');
  const plannedBuckets = state.buckets.filter((bucket) => bucket.status === 'planned');
  const pendingBuckets = state.buckets.filter((bucket) => bucket.status === 'pending');
  const collectedRecordCount = rows.rawItems.length + rows.accounts.length;
  const contentCollectionComplete = complete
    && failed.length === 0
    && plannedBuckets.length === 0
    && pendingBuckets.length === 0
    && completedBuckets.length > 0
    && collectedRecordCount > 0;
  const allWorksArchiveComplete = contentCollectionComplete
    && new Set(['account-full-archive', 'account-works-archive']).has(state.task.id);
  const contentProfileComplete = contentCollectionComplete
    && new Set(['account-full-archive', 'account-works-archive', 'account-composite-profile', 'account-content-profile']).has(state.task.id);
  const productionEvidenceReasons = [];
  if (!contentCollectionComplete) {
    if (completedBuckets.length === 0) productionEvidenceReasons.push('no_completed_real_site_fallback_bucket');
    if (plannedBuckets.length > 0) productionEvidenceReasons.push('dry_run_or_planned_bucket_present');
    if (pendingBuckets.length > 0) productionEvidenceReasons.push('pending_bucket_present');
    if (failed.length > 0) productionEvidenceReasons.push('failed_bucket_present');
    if (collectedRecordCount === 0) productionEvidenceReasons.push('no_sanitized_content_records_collected');
  }
  const status = failed.length
    ? 'failed'
    : !complete
      ? 'partial'
    : contentCollectionComplete
      ? 'completed'
    : degradedBuckets.length > 0
      ? 'degraded'
      : 'completed';
  return {
    schemaVersion: SCHEMA_VERSION,
    siteKey: 'instagram',
    task: state.task,
    status,
    ok: failed.length === 0,
    complete,
    updatedAt: state.updatedAt,
    bucketCounts,
    itemCounts: {
      raw: rows.rawItems.length,
      deduped: rows.dedupedItems.length,
      accounts: rows.accounts.length,
    },
    apiFirst: {
      status: state.apiFirstPolicy.status,
      activeApiCapabilities: state.apiFirstPolicy.activeApiCapabilities ?? [],
      executedApiBuckets: state.buckets
        .filter((bucket) => bucket.apiAttempt?.status === 'executed_replay_verified_api')
        .map((bucket) => bucket.id),
      fallbackUsed: state.buckets.some((bucket) => [
        'skipped_no_verified_api',
        'skipped_no_verified_api_for_bucket',
        'fallback_after_api_unavailable',
      ].includes(bucket.apiAttempt?.status)),
      reasonCode: state.apiFirstPolicy.reasonCode,
    },
    fallback: {
      siteFallbackBuckets: state.buckets.filter((bucket) => bucket.siteFallbackAttempted === true).length,
      completedBuckets: state.buckets.filter((bucket) => bucket.status === 'completed').length,
      warningBuckets: warningBuckets.map((bucket) => bucket.id),
    },
    failures: [...state.failures, ...bucketFailures],
    quality: {
      zeroEvidenceBuckets: state.buckets
        .filter((bucket) => Number(bucket.itemCount ?? 0) === 0 && Number(bucket.accountCount ?? 0) === 0)
        .map((bucket) => bucket.id),
      dryRunBuckets: state.buckets.filter((bucket) => bucket.status === 'planned').map((bucket) => bucket.id),
      savedMaterial: 'sanitized_summary_only',
      providedLoginState: {
        source: state.options?.userProvidedLoginState ? 'user-provided-login-state-file' : 'not-provided',
        usedForChildCommands: state.options?.userProvidedLoginState === true,
        filePathPersisted: false,
        rawMaterialPersisted: false,
      },
    },
    mediaDownloads: summarizeMediaAssets(state, mediaAssets),
    productionEvidence: {
      contentCollectionComplete,
      descriptorOnlyOrDryRunOnly: !contentCollectionComplete && completedBuckets.length === 0,
      collectedRecordCount,
      completedBucketCount: completedBuckets.length,
      degradedBucketCount: degradedBuckets.length,
      plannedBucketCount: plannedBuckets.length,
      pendingBucketCount: pendingBuckets.length,
      failedBucketCount: failed.length,
      reasons: productionEvidenceReasons,
      accountContentProfileSupport: contentProfileComplete ? 'supported_with_current_artifacts' : 'not_supported_yet',
      userArchiveSupport: allWorksArchiveComplete
        ? 'supported_with_current_artifacts'
        : contentProfileComplete
          ? 'content_profile_supported_full_archive_not_proven'
          : 'planned_not_proven',
      supportBoundary: allWorksArchiveComplete
        ? 'real verified site fallback produced sanitized JSONL records for the account works archive task'
        : contentProfileComplete
          ? 'real verified site fallback produced profile/content JSONL records; full user works and relation archive is not proven'
        : degradedBuckets.length > 0
          ? 'degraded JSONL was produced from authorized structure summary only; full user works collection is not proven'
          : 'only planner/resume/artifact contract or failure explanation is proven; full user works collection is not proven',
    },
    artifactContract: state.plan.artifactContract,
  };
}

function renderReport(summary) {
  const lines = [
    `# Instagram ${summary.task.id}`,
    '',
    `- Status: ${summary.status}`,
    `- Target: ${summary.task.target}`,
    `- Raw items: ${summary.itemCounts.raw}`,
    `- Deduped items: ${summary.itemCounts.deduped}`,
    `- Accounts/authors: ${summary.itemCounts.accounts}`,
    `- API-first: ${summary.apiFirst.status} (${summary.apiFirst.reasonCode})`,
    `- Site fallback buckets: ${summary.fallback.siteFallbackBuckets}`,
    `- Production collection complete: ${summary.productionEvidence.contentCollectionComplete}`,
    `- Media downloaded: ${summary.mediaDownloads.counts.downloaded}/${summary.mediaDownloads.counts.total}`,
    `- Media download status: ${summary.mediaDownloads.status}`,
    `- Saved material: sanitized_summary_only`,
    '',
    '## Bucket Counts',
    '',
  ];
  for (const [status, count] of Object.entries(summary.bucketCounts)) {
    lines.push(`- ${status}: ${count}`);
  }
  if (summary.failures.length) {
    lines.push('', '## Failures And Recovery');
    for (const failure of summary.failures) {
      lines.push(`- ${failure?.reasonCode ?? 'unknown'}: ${failure?.remediation ?? 'Use --resume after inspecting artifacts.'}`);
    }
  }
  if (!summary.productionEvidence.contentCollectionComplete) {
    lines.push('', '## Production Evidence Boundary');
    lines.push(`- User archive support: ${summary.productionEvidence.userArchiveSupport}`);
    for (const reason of summary.productionEvidence.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  lines.push('', '## Safety Boundary', '', 'No cookies, tokens, auth headers, browser profiles, raw private bodies, payment/account mutation, publish/delete/follow/like/DM actions are captured or executed.');
  return `${lines.join('\n')}\n`;
}

async function writeTaskArtifacts(state) {
  state.updatedAt = new Date().toISOString();
  const rows = await gatherBucketRows(state);
  const mediaAssets = gatherMediaAssets(state);
  const mediaSummary = summarizeMediaAssets(state, mediaAssets);
  const summary = summarizeState(state, rows, mediaAssets);
  await writeJson(state.layout.planPath, state.plan);
  await writeJson(state.layout.statePath, state);
  await writeJsonl(state.layout.rawItemsPath, rows.rawItems);
  await writeJsonl(state.layout.dedupedItemsPath, rows.dedupedItems);
  await writeJsonl(state.layout.accountsPath, rows.accounts);
  await writeJsonl(state.layout.authorsPath, rows.accounts);
  const cacheRows = state.buckets.map((bucket) => ({
    bucketId: bucket.id,
    status: bucket.status,
    action: bucket.action,
    apiStatus: bucket.apiAttempt?.status ?? 'not_attempted',
    fallbackStatus: bucket.siteFallbackResult?.ok === true ? 'ok' : bucket.siteFallbackAttempted ? 'attempted' : 'not_attempted',
    manifest: bucket.siteFallbackResult?.artifacts?.manifest ?? null,
    report: bucket.siteFallbackResult?.artifacts?.report ?? null,
    runDir: bucket.siteFallbackResult?.artifacts?.runDir ?? null,
  }));
  await writeJson(state.layout.cacheIndexPath, { schemaVersion: SCHEMA_VERSION, rows: cacheRows });
  await writeJsonl(state.layout.cacheIndexJsonlPath, cacheRows);
  await writeJson(state.layout.mediaAssetsPath, mediaSummary);
  await writeJsonl(state.layout.mediaAssetsJsonlPath, mediaAssets);
  await writeJson(state.layout.summaryPath, summary);
  const report = renderReport(summary);
  await writeText(state.layout.reportPath, report);
  await writeText(state.layout.archiveIndexPath, report);
  await writeText(state.layout.archiveReportPath, report);
  return summary;
}

function bucketResultCounts(parsed = null) {
  const items = Array.isArray(parsed?.result?.items) ? parsed.result.items.length : Number(parsed?.result?.itemCount ?? parsed?.itemCount ?? 0) || 0;
  const users = Array.isArray(parsed?.result?.users)
    ? parsed.result.users.length
    : parsed?.result?.account && typeof parsed.result.account === 'object' && !Array.isArray(parsed.result.account)
      ? 1
      : Number(parsed?.result?.userCount ?? parsed?.userCount ?? 0) || 0;
  return { items, users };
}

async function executeBucket(bucket, state, deps) {
  const startedAt = new Date().toISOString();
  const next = {
    ...bucket,
    attempts: Number(bucket.attempts ?? 0) + 1,
    startedAt,
    apiAttempt: {
      status: bucket.apiFirst?.active ? 'planned_replay_verified_api' : 'skipped_no_verified_api_for_bucket',
      operationId: bucket.apiFirst?.operationId ?? null,
      reasonCode: bucket.apiFirst?.active ? null : 'no_replay_verified_instagram_api_for_bucket',
      remediation: bucket.apiFirst?.active
        ? 'Run verified action command with API cursor enabled and fall back to governed site extraction if API returns no usable rows.'
        : 'No replay-verified API exists for this bucket; falls through immediately to verified site fallback.',
    },
    siteFallbackAttempted: true,
  };
  const runtimeCommand = commandWithTransientLoginState(next.siteFallback.command, state.runtimeOptions ?? {});
  const [command, ...args] = runtimeCommand;
  const result = await (deps.executeCommand ?? executeCommand)(command, args, {
    cwd: deps.cwd ?? process.cwd(),
    timeoutMs: state.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const parsed = parseCommandJson(result.stdout);
  next.siteFallbackResult = parsed ?? {
    ok: false,
    stdout: result.stdout?.slice?.(0, 1000) ?? '',
  };
  next.exitCode = result.exitCode;
  next.stderr = result.stderr ? String(result.stderr).slice(0, 2000) : '';
  next.finishedAt = new Date().toISOString();
  const counts = bucketResultCounts(parsed);
  const archive = parsed?.result?.archive ?? parsed?.archive ?? null;
  if (bucket.apiFirst?.active) {
    next.apiAttempt = {
      ...next.apiAttempt,
      status: archive?.strategy?.startsWith?.('instagram-') ? 'executed_replay_verified_api' : 'fallback_after_api_unavailable',
      archiveStrategy: archive?.strategy ?? null,
      complete: archive?.complete === true,
      reason: archive?.reason ?? null,
    };
  }
  next.itemCount = counts.items;
  next.accountCount = counts.users;
  if (result.exitCode === 0 && parsed?.ok === true && parsed?.dryRun !== true) {
    next.status = counts.items > 0 || counts.users > 0 ? 'completed' : 'captured_with_warning';
    if (next.status === 'captured_with_warning') {
      next.failure = classifyFailure({ exitCode: result.exitCode, stdout: result.stdout, stderr: '0 items', parsed });
    }
  } else if (result.exitCode === 0 && parsed?.ok === true && parsed?.dryRun === true) {
    next.status = 'planned';
    next.failure = {
      layer: 'site_fallback',
      reasonCode: 'dry_run_site_fallback',
      remediation: 'Remove --dry-run-actions and run --execute --resume for real verified site fallback; unverified API remains disabled.',
    };
  } else {
    const failure = classifyFailure({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, parsed });
    if (failure.layer === 'login' && state.options?.useBuildSummaryFallback === true) {
      const fallbackRows = await collectBuildSummaryFallbackRows(next, state);
      if (fallbackRows?.items?.length || fallbackRows?.accounts?.length) {
        next.status = 'captured_with_warning';
        next.failure = {
          layer: 'login',
          reasonCode: fallbackRows.reasonCode,
          remediation: 'Reused SiteForge authorized sanitized structure summary as degraded JSONL. Refresh login profile and rerun --execute --resume for real content JSONL.',
          originalFailure: failure,
        };
        next.structureFallbackRows = fallbackRows;
        next.itemCount = fallbackRows.items.length;
        next.accountCount = fallbackRows.accounts.length;
        return next;
      }
      failure.fallbackAttempt = {
        reasonCode: fallbackRows?.reasonCode ?? 'build_summary_fallback_not_found',
        sourcePath: fallbackRows?.sourcePath ?? null,
      };
    }
    next.status = 'failed';
    next.failure = failure;
  }
  return next;
}

async function loadOrCreateState(options) {
  const validationErrors = validateOptions(options);
  if (validationErrors.length) {
    return { validationErrors };
  }
  const plan = buildTaskPlan(options);
  if (options.resume) {
    try {
      const state = await readJson(plan.layout.statePath);
      const refreshed = refreshPendingBucketCommands({
        ...state,
        resumeCount: Number(state.resumeCount ?? 0) + 1,
      }, plan);
      return {
        state: options.retryFailed ? requeueFailedBuckets(refreshed, plan) : refreshed,
      };
    } catch {
      return { state: initialState(plan, options) };
    }
  }
  return { state: initialState(plan, options) };
}

function refreshPendingBucketCommands(state, freshPlan) {
  const freshById = new Map((freshPlan.buckets ?? []).map((bucket) => [bucket.id, bucket]));
  return {
    ...state,
    plan: {
      ...freshPlan,
      buckets: state.plan?.buckets ?? freshPlan.buckets,
    },
    buckets: (state.buckets ?? []).map((bucket) => {
      const fresh = freshById.get(bucket.id);
      if (!fresh || bucket.status !== 'pending') return bucket;
      return {
        ...bucket,
        apiFirst: fresh.apiFirst,
        siteFallback: fresh.siteFallback,
        artifactRunId: fresh.artifactRunId,
      };
    }),
  };
}

function requeueFailedBuckets(state, freshPlan) {
  const freshById = new Map((freshPlan.buckets ?? []).map((bucket) => [bucket.id, bucket]));
  return {
    ...state,
    buckets: (state.buckets ?? []).map((bucket) => {
      if (bucket.status !== 'failed') return bucket;
      const fresh = freshById.get(bucket.id);
      return {
        ...(fresh ?? bucket),
        attempts: Number(bucket.attempts ?? 0),
        status: 'pending',
        failure: null,
        previousFailure: bucket.failure ?? null,
      };
    }),
  };
}

async function runInstagramResearchTask(options = parseArgs(), deps = {}) {
  if (options.help) {
    return { ok: true, help: usage() };
  }
  const loaded = await loadOrCreateState(options);
  if (loaded.validationErrors) {
    return {
      ok: false,
      status: 'invalid_request',
      errors: loaded.validationErrors,
      help: usage(),
    };
  }
  const state = loaded.state;
  state.options = state.options ?? {};
  state.options.timeoutMs = options.timeoutMs;
  state.options.retryFailed = options.retryFailed;
  state.options.downloadMedia = effectiveDownloadMedia(options);
  state.task = {
    ...state.task,
    defaults: {
      ...(state.task?.defaults ?? {}),
      downloadMedia: effectiveDownloadMedia(options),
    },
  };
  state.options.useBuildSummaryFallback = options.useBuildSummaryFallback;
  state.options.buildSummaryPath = options.buildSummaryPath;
  state.options.userProvidedLoginState = Boolean(options.cookieFile);
  Object.defineProperty(state, 'runtimeOptions', {
    value: {
      cookieFile: options.cookieFile,
    },
    enumerable: false,
    configurable: true,
  });
  if (options.refreshReport || options.dryRun || !options.execute) {
    const summary = await writeTaskArtifacts(state);
    return {
      ok: summary.ok,
      status: options.refreshReport ? 'refreshed' : 'planned',
      complete: false,
      planPath: state.layout.planPath,
      statePath: state.layout.statePath,
      summaryPath: state.layout.summaryPath,
      reportPath: state.layout.reportPath,
      bucketCounts: summary.bucketCounts,
    };
  }

  let executed = 0;
  const maxBuckets = Number(options.maxBucketsPerRun ?? 0);
  for (let index = 0; index < state.buckets.length; index += 1) {
    const bucket = state.buckets[index];
    if (bucket.status !== 'pending') continue;
    state.buckets[index] = await executeBucket(bucket, state, deps);
    executed += 1;
    await writeTaskArtifacts(state);
    if (maxBuckets > 0 && executed >= maxBuckets) break;
  }
  const summary = await writeTaskArtifacts(state);
  return {
    ok: summary.ok,
    status: summary.status,
    complete: summary.complete,
    statePath: state.layout.statePath,
    summaryPath: state.layout.summaryPath,
    reportPath: state.layout.reportPath,
    executedBuckets: executed,
    bucketCounts: summary.bucketCounts,
  };
}

async function main() {
  const options = parseArgs();
  const result = await runInstagramResearchTask(options);
  if (result.help && !options.json) {
    process.stdout.write(result.help);
    return;
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok !== true) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export {
  TASKS,
  buildTaskPlan,
  classifyFailure,
  executeCommand,
  parseArgs,
  runInstagramResearchTask,
};
