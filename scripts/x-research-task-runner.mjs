#!/usr/bin/env node
// @ts-check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildSocialMediaDownloadReport,
  downloadMediaAsset,
  mediaAssetRecordsFromItems,
} from '../src/sites/known-sites/social/actions/download-boundary.mjs';

const SCHEMA_VERSION = 1;
const DEFAULT_OUT_ROOT = path.join('.siteforge', 'x-research-tasks');
const DEFAULT_RUNS_ROOT = path.join('.siteforge', 'x-live-runs-skill');
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_ITEMS = 100;
const DEFAULT_DEEP_MAX_ITEMS = 5000;
const DEFAULT_MAX_API_PAGES = 25;
const DEFAULT_DEEP_MAX_API_PAGES = 250;
const DEFAULT_MAX_SCROLLS = 60;
const DEFAULT_SCROLL_WAIT_MS = 1000;
const DEFAULT_LANGUAGES = Object.freeze(['zh', 'en']);
const SEARCH_TASKS = Object.freeze(new Set(['keyword-trend', 'industry-report', 'event-timeline']));
const DEFAULT_SEARCH_MAX_BUCKETS_PER_RUN = 1;
const DEFAULT_SEARCH_BUCKET_DELAY_MS = 0;
const DEFAULT_NO_WAIT_PROFILE_BACKFILL_ACCOUNTS = 8;
const DEFAULT_MEDIA_DOWNLOAD_LIMIT = 50;

const TASKS = Object.freeze({
  'account-full-archive': Object.freeze({
    id: 'account-full-archive',
    label: 'Specified account historical archive',
    required: ['account'],
    defaultMode: 'deep',
  }),
  'keyword-trend': Object.freeze({
    id: 'keyword-trend',
    label: 'Keyword trend analysis',
    required: ['query'],
    defaultMode: 'full',
  }),
  'account-composite-profile': Object.freeze({
    id: 'account-composite-profile',
    label: 'Specified account composite profile',
    required: ['account'],
    defaultMode: 'full',
  }),
  'industry-report': Object.freeze({
    id: 'industry-report',
    label: 'Industry weekly/monthly report',
    required: ['query'],
    defaultMode: 'full',
  }),
  'event-timeline': Object.freeze({
    id: 'event-timeline',
    label: 'Event timeline reconstruction',
    required: ['query'],
    defaultMode: 'full',
  }),
  'similar-account-discovery': Object.freeze({
    id: 'similar-account-discovery',
    label: 'Similar account discovery from seed profile',
    required: ['account'],
    defaultMode: 'full',
  }),
});

const TASK_ALIASES = Object.freeze({
  archive: 'account-full-archive',
  'account-archive': 'account-full-archive',
  'account-full-archive': 'account-full-archive',
  'full-archive': 'account-full-archive',
  'historical-archive': 'account-full-archive',
  trend: 'keyword-trend',
  'keyword-trend': 'keyword-trend',
  'keyword-trend-analysis': 'keyword-trend',
  'search-trend': 'keyword-trend',
  profile: 'account-composite-profile',
  'account-profile': 'account-composite-profile',
  'account-composite-profile': 'account-composite-profile',
  'composite-profile': 'account-composite-profile',
  'industry-report': 'industry-report',
  'industry-hotspots': 'industry-report',
  'weekly-monthly-report': 'industry-report',
  timeline: 'event-timeline',
  'event-timeline': 'event-timeline',
  'event-timeline-reconstruction': 'event-timeline',
  similar: 'similar-account-discovery',
  'similar-accounts': 'similar-account-discovery',
  'similar-account-discovery': 'similar-account-discovery',
  'account-similarity': 'similar-account-discovery',
});

function usage() {
  return `Usage:
  node scripts/x-research-task-runner.mjs --task <task> [options]

Tasks:
  account-full-archive       Archive posts, replies, media, highlights, article route, and media URLs for one account.
  keyword-trend              Sample X search by keyword/subject, language, and date bucket.
  account-composite-profile  Combine content, relation, likes-route, and interaction evidence for one account.
  industry-report            Build weekly and monthly search buckets for an industry/topic.
  event-timeline             Reconstruct an event evidence timeline from search/date buckets.
  similar-account-discovery  Profile a seed account, then search for related/similar accounts.

Options:
  --account <handle>         Required for account tasks.
  --query <value>            Required for search/trend/event/industry tasks.
  --subjects <a,b>           Optional trend subjects. Defaults to splitting --query.
  --from YYYY-MM-DD          Start date for search/date tasks.
  --to YYYY-MM-DD            End date for search/date tasks.
  --languages zh,en          Language filters for search/date tasks. Default: zh,en.
  --mode quick|full|deep     Controls default max items/pages. Task-specific default.
  --collection-mode <mode>   api-first, page, or api. Default: api-first for account tasks, page for search tasks.
  --execute                  Execute pending buckets. Omitted by default for plan-only mode.
  --resume                   Resume from existing task state.
  --refresh-report           Rebuild report from existing state without live execution.
  --out-dir <path>           Output directory. Default: .siteforge/x-research-tasks/<task-target>
  --runs-root <path>         X action run root. Default: .siteforge/x-live-runs-skill
  --max-items <n>
  --max-api-pages <n>
  --max-scrolls <n>
  --scroll-wait-ms <n>
  --timeout <ms>
  --max-buckets-per-run <n>  Execute at most n buckets per invocation. 0 means all pending buckets.
  --bucket-delay-ms <n>      Optional pacing between executed buckets. Default: 0; never used as cooldown recovery.
  --no-wait-profile-accounts <n>
                              Search-cooldown fallback: profile-backfill this many discovered authors. Default: 8.
  --download-media            Download discovered media URLs into <out-dir>/archive/media.
  --no-download-media         Disable media binary downloads even for account-full-archive.
  --media-download-limit <n>  Max media downloads per invocation when --download-media is set. 0 means no limit. Account archives default to 0.
  --now YYYY-MM-DD           Stable date for tests/planning.
  --json                     Print JSON result.
`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    task: null,
    account: null,
    query: null,
    subjects: null,
    from: null,
    to: null,
    languages: [...DEFAULT_LANGUAGES],
    mode: null,
    collectionMode: null,
    execute: false,
    resume: false,
    refreshReport: false,
    dryRun: false,
    outDir: null,
    runsRoot: DEFAULT_RUNS_ROOT,
    statePath: null,
    maxItems: null,
    maxApiPages: null,
    maxScrolls: DEFAULT_MAX_SCROLLS,
    scrollWaitMs: DEFAULT_SCROLL_WAIT_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBucketsPerRun: null,
    bucketDelayMs: null,
    cooldownMinutes: 30,
    noWaitProfileAccounts: DEFAULT_NO_WAIT_PROFILE_BACKFILL_ACCOUNTS,
    downloadMedia: null,
    mediaDownloadLimit: null,
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
      case '--subjects':
        options.subjects = splitCsv(next);
        index += 1;
        break;
      case '--from':
      case '--from-date':
        options.from = next;
        index += 1;
        break;
      case '--to':
      case '--to-date':
        options.to = next;
        index += 1;
        break;
      case '--languages':
        options.languages = splitCsv(next);
        index += 1;
        break;
      case '--language':
        options.languages = [next];
        index += 1;
        break;
      case '--mode':
        options.mode = next;
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
      case '--runs-root':
        options.runsRoot = next;
        index += 1;
        break;
      case '--state':
        options.statePath = next;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = positiveInteger(next, '--max-items');
        index += 1;
        break;
      case '--max-api-pages':
        options.maxApiPages = positiveInteger(next, '--max-api-pages');
        index += 1;
        break;
      case '--max-scrolls':
        options.maxScrolls = positiveInteger(next, '--max-scrolls');
        index += 1;
        break;
      case '--scroll-wait-ms':
      case '--scroll-wait':
        options.scrollWaitMs = nonNegativeInteger(next, arg);
        index += 1;
        break;
      case '--timeout':
      case '--timeout-ms':
        options.timeoutMs = positiveInteger(next, arg);
        index += 1;
        break;
      case '--max-buckets-per-run':
        options.maxBucketsPerRun = nonNegativeInteger(next, '--max-buckets-per-run');
        index += 1;
        break;
      case '--bucket-delay-ms':
      case '--delay-ms':
        options.bucketDelayMs = nonNegativeInteger(next, arg);
        index += 1;
        break;
      case '--cooldown-minutes':
        options.cooldownMinutes = positiveInteger(next, '--cooldown-minutes');
        index += 1;
        break;
      case '--no-wait-profile-accounts':
        options.noWaitProfileAccounts = nonNegativeInteger(next, '--no-wait-profile-accounts');
        index += 1;
        break;
      case '--download-media':
        options.downloadMedia = true;
        break;
      case '--no-download-media':
        options.downloadMedia = false;
        break;
      case '--media-download-limit':
        options.mediaDownloadLimit = nonNegativeInteger(next, '--media-download-limit');
        index += 1;
        break;
      case '--now':
        options.now = next;
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.task === null && !options.help) {
    throw new Error('--task is required');
  }
  if (options.mode !== null && !['quick', 'full', 'deep'].includes(options.mode)) {
    throw new Error('--mode must be quick, full, or deep');
  }
  if (options.collectionMode !== null && !['api-first', 'api', 'page'].includes(options.collectionMode)) {
    throw new Error('--collection-mode must be api-first, api, or page');
  }
  if (!options.languages.length) {
    throw new Error('--languages must contain at least one language');
  }
  return options;
}

function normalizeTask(value) {
  const key = String(value || '').trim().toLowerCase().replace(/_/gu, '-');
  return TASK_ALIASES[key] || key;
}

function normalizeAccount(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return (parts[0] || '').replace(/^@/u, '') || null;
  } catch {
    return raw.replace(/^@/u, '').replace(/^\/+|\/+$/gu, '') || null;
  }
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

function compactSlug(value, fallback = 'x-research-task') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return slug || fallback;
}

function parseDateOnly(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return date;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function nowDate(options = {}) {
  return options.now ? parseDateOnly(options.now, '--now') : new Date();
}

function defaultDateWindow(task, options) {
  if (options.from && options.to) {
    return {
      from: options.from,
      to: options.to,
    };
  }
  const now = nowDate(options);
  const to = options.to || dateOnly(addDays(now, 1));
  if (options.from) {
    return { from: options.from, to };
  }
  const days = task === 'event-timeline' ? 90 : 30;
  return {
    from: dateOnly(addDays(now, -days)),
    to,
  };
}

function buildMonthlyBuckets(fromText, toText) {
  const from = parseDateOnly(fromText, '--from');
  const to = parseDateOnly(toText, '--to');
  if (from >= to) {
    throw new Error('--from must be before --to');
  }
  const buckets = [];
  let cursor = new Date(from.getTime());
  while (cursor < to) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const nextMonth = addUtcMonth(monthStart);
    const until = nextMonth < to ? nextMonth : to;
    buckets.push({
      id: `${dateOnly(cursor)}:${dateOnly(until)}`,
      since: dateOnly(cursor),
      until: dateOnly(until),
      label: dateOnly(cursor).slice(0, 7),
    });
    cursor = until;
  }
  return buckets;
}

function taskMode(task, options) {
  return options.mode || TASKS[task]?.defaultMode || 'full';
}

function maxItemsForTask(task, options) {
  if (options.maxItems) return options.maxItems;
  const mode = taskMode(task, options);
  if (mode === 'quick') return 50;
  if (mode === 'deep') return DEFAULT_DEEP_MAX_ITEMS;
  return DEFAULT_MAX_ITEMS;
}

function maxApiPagesForTask(task, options) {
  if (options.maxApiPages) return options.maxApiPages;
  const mode = taskMode(task, options);
  return mode === 'deep' ? DEFAULT_DEEP_MAX_API_PAGES : DEFAULT_MAX_API_PAGES;
}

function defaultCollectionMode(task, options) {
  if (options.collectionMode) return options.collectionMode;
  return SEARCH_TASKS.has(task)
    ? 'page'
    : 'api-first';
}

function effectiveMaxBucketsPerRun(task, options) {
  if (options.maxBucketsPerRun !== null && options.maxBucketsPerRun !== undefined) {
    return Number(options.maxBucketsPerRun);
  }
  return SEARCH_TASKS.has(task) ? DEFAULT_SEARCH_MAX_BUCKETS_PER_RUN : 0;
}

function effectiveBucketDelayMs(task, options) {
  if (options.bucketDelayMs !== null && options.bucketDelayMs !== undefined) {
    return Number(options.bucketDelayMs);
  }
  return SEARCH_TASKS.has(task) ? DEFAULT_SEARCH_BUCKET_DELAY_MS : 0;
}

function effectiveDownloadMedia(task, options) {
  if (options.downloadMedia !== null && options.downloadMedia !== undefined) {
    return options.downloadMedia === true;
  }
  return task === 'account-full-archive';
}

function effectiveMediaDownloadLimit(task, options) {
  if (options.mediaDownloadLimit !== null && options.mediaDownloadLimit !== undefined) {
    return Number(options.mediaDownloadLimit);
  }
  return task === 'account-full-archive' ? 0 : DEFAULT_MEDIA_DOWNLOAD_LIMIT;
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
    accountsPath: path.join(outDir, 'accounts.jsonl'),
    cacheIndexPath: path.join(outDir, 'cache-index.json'),
    cacheIndexJsonlPath: path.join(outDir, 'cache-index.jsonl'),
    mediaDir: path.join(archiveDir, 'media'),
    mediaAssetsPath: path.join(outDir, 'media-assets.json'),
    mediaAssetsJsonlPath: path.join(outDir, 'media-assets.jsonl'),
    archiveManifestPath: path.join(outDir, 'archive-manifest.json'),
    archivePostsDir: path.join(archiveDir, 'posts'),
    archiveArticlesDir: path.join(archiveDir, 'articles'),
    archiveFollowingPath: path.join(archiveDir, 'following.md'),
    archiveFollowingJsonPath: path.join(archiveDir, 'following.json'),
    archiveFollowingCsvPath: path.join(archiveDir, 'following.csv'),
    archiveRawDir: path.join(archiveDir, 'raw'),
    archiveRawPostsPath: path.join(archiveDir, 'raw', 'posts.jsonl'),
    archiveRawArticlesPath: path.join(archiveDir, 'raw', 'articles.jsonl'),
    archiveRawFollowingPath: path.join(archiveDir, 'raw', 'following.json'),
    archiveRawMediaManifestPath: path.join(archiveDir, 'raw', 'media_manifest.json'),
    archiveRawManifestPath: path.join(archiveDir, 'raw', 'archive_manifest.json'),
    archiveIndexPath: path.join(archiveDir, 'index.md'),
    archivePostsIndexPath: path.join(archiveDir, 'posts_index.md'),
    archiveArticlesIndexPath: path.join(archiveDir, 'articles_index.md'),
    archiveMediaIndexPath: path.join(archiveDir, 'media_index.md'),
    archiveReportPath: path.join(archiveDir, 'archive_report.md'),
    archiveErrorsPath: path.join(archiveDir, 'errors.log'),
    archiveChecksumPath: path.join(archiveDir, 'checksum_manifest.json'),
  };
}

function baseXActionCommand(action, options, extra = {}) {
  const command = [
    'node',
    'src/entrypoints/sites/x-action.mjs',
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
  if (extra.account) command.push('--account', extra.account);
  if (extra.query) command.push('--query', extra.query);
  if (extra.route) command.push('--route', extra.route);
  if (extra.contentType) command.push('--content-type', extra.contentType);
  if (extra.maxItems) command.push('--max-items', String(extra.maxItems));
  if (extra.maxUsers) command.push('--max-users', String(extra.maxUsers));
  if (extra.maxScrolls !== null && extra.maxScrolls !== undefined) command.push('--max-scrolls', String(extra.maxScrolls));
  if (extra.scrollWaitMs !== null && extra.scrollWaitMs !== undefined) command.push('--scroll-wait', String(extra.scrollWaitMs));
  if (extra.api === true) {
    command.push('--api-cursor', 'true', '--max-api-pages', String(extra.maxApiPages));
  }
  if (extra.api === false) {
    command.push('--no-api-cursor');
  }
  if (extra.resume) {
    command.push('--resume');
  }
  return command;
}

function pageCommand(action, options, extra) {
  return baseXActionCommand(action, options, {
    ...extra,
    api: false,
    maxScrolls: extra.maxScrolls ?? options.maxScrolls,
    scrollWaitMs: extra.scrollWaitMs ?? options.scrollWaitMs,
  });
}

function apiCommand(action, options, extra) {
  return baseXActionCommand(action, options, {
    ...extra,
    api: true,
    maxApiPages: extra.maxApiPages ?? maxApiPagesForTask(options.task, options),
  });
}

function commandPair(action, options, extra = {}) {
  const collectionMode = defaultCollectionMode(options.task, options);
  const fallback = pageCommand(action, options, extra);
  if (collectionMode === 'page') {
    return {
      command: fallback,
      fallbackCommand: null,
      primaryCollectionMode: 'page',
    };
  }
  const primary = collectionMode === 'api'
    ? apiCommand(action, options, extra)
    : apiCommand(action, options, extra);
  return {
    command: primary,
    fallbackCommand: fallback,
    primaryCollectionMode: 'api',
  };
}

function createBucket(id, label, action, options, extra = {}) {
  const pair = commandPair(action, options, {
    ...extra,
    artifactRunId: compactSlug(`x-research-${options.task}-${options.targetFingerprint || 'legacy'}-${id}`),
    maxItems: extra.maxItems ?? maxItemsForTask(options.task, options),
    maxUsers: extra.maxUsers ?? maxItemsForTask(options.task, options),
  });
  return {
    id,
    label,
    action,
    route: extra.route ?? null,
    contentType: extra.contentType ?? null,
    query: extra.query ?? null,
    account: extra.account ?? null,
    surfaceKey: surfaceKeyForBucket(action, extra),
    primaryCollectionMode: pair.primaryCollectionMode,
    command: pair.command,
    fallbackCommand: pair.fallbackCommand,
    fallbackPolicy: pair.fallbackCommand ? 'api-stall-to-page' : 'page-primary',
    status: 'pending',
    attempts: 0,
  };
}

function surfaceKeyForBucket(action, extra = {}) {
  if (action === 'search') return 'search';
  if (action === 'read-route') return `read-route:${extra.route || 'route'}`;
  if (action === 'profile-content') return `profile-content:${extra.contentType || 'posts'}`;
  return action;
}

function searchBucket(id, label, query, options) {
  return createBucket(id, label, 'search', options, {
    query,
  });
}

function buildAccountArchiveBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and public metadata', 'account-info', options, { account }),
    createBucket('posts', 'Historical posts', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('replies', 'Historical replies', 'profile-content', options, { account, contentType: 'replies' }),
    createBucket('media', 'Historical media posts and media URLs', 'profile-content', options, { account, contentType: 'media' }),
    createBucket('following', 'Following relation archive', 'profile-following', options, { account }),
    createBucket('highlights', 'Historical highlights', 'profile-content', options, { account, contentType: 'highlights' }),
    createBucket('articles-route', 'Articles route structural/archive evidence', 'read-route', options, { account, route: 'account-articles' }),
  ];
}

function subjectList(options) {
  if (options.subjects?.length) {
    return options.subjects;
  }
  const query = String(options.query || '').trim();
  const split = query
    .split(/\s*(?:,|;|\bvs\b|\band\b|\bor\b|与|和|对比)\s*/iu)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return split.length > 1 ? split : [query];
}

function buildTrendSearchQuery(subject, language, period) {
  return [
    subject,
    language ? `lang:${language}` : '',
    '-is:retweet',
    `since:${period.since}`,
    `until:${period.until}`,
  ].filter(Boolean).join(' ').replace(/\s+/gu, ' ').trim();
}

function expandEventQuery(query) {
  const text = String(query || '').trim();
  const gptVersion = text.match(/^gpt\s*[-_ ]?\s*(\d+)(?:[._-]\s*(\d+))?$/iu);
  if (!gptVersion) {
    return text;
  }
  const major = gptVersion[1];
  const minor = gptVersion[2];
  if (!minor) {
    return `(gpt${major} OR "gpt ${major}" OR "gpt-${major}")`;
  }
  return `(gpt${major}.${minor} OR "gpt ${major}.${minor}" OR "gpt-${major}.${minor}" OR gpt${major}_${minor})`;
}

function buildKeywordTrendBuckets(options) {
  const { from, to } = defaultDateWindow('keyword-trend', options);
  const periods = buildMonthlyBuckets(from, to);
  const buckets = [];
  for (const period of periods) {
    for (const subject of subjectList(options)) {
      for (const language of options.languages) {
        const query = buildTrendSearchQuery(subject, language, period);
        buckets.push(searchBucket(
          `trend-${compactSlug(subject)}-${language}-${period.since}-${period.until}`,
          `Trend sample for ${subject} (${language}) ${period.since} to ${period.until}`,
          query,
          options,
        ));
      }
    }
  }
  return buckets;
}

function buildCompositeProfileBuckets(options) {
  const account = options.account;
  return [
    createBucket('account-info', 'Profile identity and public metadata', 'account-info', options, { account }),
    createBucket('posts', 'Published content sample', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('replies', 'Replies and interaction content sample', 'profile-content', options, { account, contentType: 'replies' }),
    createBucket('media', 'Media usage sample', 'profile-content', options, { account, contentType: 'media' }),
    createBucket('following', 'Following relation sample', 'profile-following', options, { account }),
    createBucket('followers', 'Follower relation sample', 'profile-followers', options, { account }),
    createBucket('profile-likes-route', 'Public profile likes route when visible', 'read-route', options, { account, route: 'profile-likes' }),
  ];
}

function buildIndustryReportBuckets(options) {
  const now = nowDate(options);
  const to = options.to || dateOnly(addDays(now, 1));
  const weekly = {
    since: options.from || dateOnly(addDays(parseDateOnly(to, '--to'), -7)),
    until: to,
  };
  const monthly = {
    since: options.from || dateOnly(addDays(parseDateOnly(to, '--to'), -30)),
    until: to,
  };
  const buckets = [];
  for (const period of [
    { id: 'weekly', ...weekly },
    { id: 'monthly', ...monthly },
  ]) {
    for (const language of options.languages) {
      const query = buildTrendSearchQuery(options.query, language, period);
      buckets.push(searchBucket(
        `industry-${period.id}-${language}`,
        `Industry ${period.id} sample (${language}) ${period.since} to ${period.until}`,
        query,
        options,
      ));
    }
  }
  return buckets;
}

function buildEventTimelineBuckets(options) {
  const { from, to } = defaultDateWindow('event-timeline', options);
  const eventQuery = expandEventQuery(options.query);
  return buildMonthlyBuckets(from, to).flatMap((period) => (
    options.languages.map((language) => searchBucket(
      `event-${language}-${period.since}-${period.until}`,
      `Event timeline sample (${language}) ${period.since} to ${period.until}`,
      buildTrendSearchQuery(eventQuery, language, period),
      options,
    ))
  ));
}

function buildSimilarAccountBuckets(options) {
  const account = options.account;
  const seedQuery = options.query || `@${account} OR from:${account}`;
  const window = defaultDateWindow('similar-account-discovery', options);
  const searchPeriod = {
    since: window.from,
    until: window.to,
  };
  const buckets = [
    createBucket('seed-account-info', 'Seed profile identity', 'account-info', options, { account }),
    createBucket('seed-posts', 'Seed published content sample', 'profile-content', options, { account, contentType: 'posts' }),
    createBucket('seed-following', 'Seed following relation sample', 'profile-following', options, { account }),
    createBucket('seed-followers', 'Seed follower relation sample', 'profile-followers', options, { account }),
  ];
  for (const language of options.languages) {
    buckets.push(searchBucket(
      `candidate-search-${language}`,
      `Candidate similar-account search (${language})`,
      buildTrendSearchQuery(seedQuery, language, searchPeriod),
      options,
    ));
  }
  return buckets;
}

function validateOptions(options) {
  const task = TASKS[options.task];
  if (!task) {
    throw new Error(`Unsupported task ${JSON.stringify(options.task)}`);
  }
  for (const name of task.required) {
    if (!options[name]) {
      throw new Error(`--${name} is required for task ${task.id}`);
    }
  }
}

function buildTaskBuckets(options) {
  switch (options.task) {
    case 'account-full-archive':
      return buildAccountArchiveBuckets(options);
    case 'keyword-trend':
      return buildKeywordTrendBuckets(options);
    case 'account-composite-profile':
      return buildCompositeProfileBuckets(options);
    case 'industry-report':
      return buildIndustryReportBuckets(options);
    case 'event-timeline':
      return buildEventTimelineBuckets(options);
    case 'similar-account-discovery':
      return buildSimilarAccountBuckets(options);
    default:
      throw new Error(`Unsupported task ${JSON.stringify(options.task)}`);
  }
}

function buildTaskPlan(rawOptions) {
  const options = {
    ...rawOptions,
    task: normalizeTask(rawOptions.task),
    runsRoot: path.resolve(rawOptions.runsRoot || DEFAULT_RUNS_ROOT),
  };
  validateOptions(options);
  options.targetFingerprint = taskTargetFingerprint(options);
  const layout = buildOutputLayout(options.task, options);
  const mode = taskMode(options.task, options);
  const collectionMode = defaultCollectionMode(options.task, options);
  const buckets = buildTaskBuckets(options);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    task: {
      id: options.task,
      label: TASKS[options.task].label,
      mode,
      collectionMode,
      target: {
        account: options.account,
        query: options.query,
        subjects: subjectListSafe(options),
        languages: options.languages,
        from: options.from || null,
        to: options.to || null,
      },
      targetFingerprint: options.targetFingerprint,
      defaults: {
        maxItems: maxItemsForTask(options.task, options),
        maxApiPages: maxApiPagesForTask(options.task, options),
        maxScrolls: options.maxScrolls,
        scrollWaitMs: options.scrollWaitMs,
        timeoutMs: options.timeoutMs,
        maxBucketsPerRun: effectiveMaxBucketsPerRun(options.task, options),
        bucketDelayMs: effectiveBucketDelayMs(options.task, options),
        noWaitProfileAccounts: options.noWaitProfileAccounts,
        downloadMedia: effectiveDownloadMedia(options.task, options),
        mediaDownloadLimit: effectiveMediaDownloadLimit(options.task, options),
      },
      noStallPolicy: {
        apiLocalStallFallback: 'immediate-page-fallback',
        sameSurfaceHardStop: 'no-wait-local-cache-or-profile-backfill',
        existingDataReuse: 'resume-state-before-live-retry',
      },
    },
    layout,
    buckets,
  };
}

function subjectListSafe(options) {
  return options.query ? subjectList(options) : [];
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function fileTime(entry) {
  return entry?.mtimeMs || 0;
}

function siteforgeRootFromRunsRoot(runsRoot) {
  const resolved = path.resolve(runsRoot || DEFAULT_RUNS_ROOT);
  return path.basename(resolved).startsWith('x-live-runs')
    ? path.dirname(resolved)
    : path.dirname(resolved);
}

async function latestXLiveReportPath(siteforgeRoot) {
  let entries = [];
  try {
    entries = await fs.readdir(siteforgeRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^x-live-report-/u.test(entry.name)) {
      continue;
    }
    const reportPath = path.join(siteforgeRoot, entry.name, 'social-live-report.json');
    try {
      const stat = await fs.stat(reportPath);
      candidates.push({ reportPath, stat });
    } catch {
      // Ignore incomplete report directories.
    }
  }
  candidates.sort((a, b) => fileTime(b.stat) - fileTime(a.stat));
  return candidates[0]?.reportPath || null;
}

function timeMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function findActiveRateLimitSurfaces({ runsRoot, cooldownMinutes = 30, now = new Date() }) {
  const reportPath = await latestXLiveReportPath(siteforgeRootFromRunsRoot(runsRoot));
  if (!reportPath) {
    return {
      active: false,
      reportPath: null,
      surfaces: [],
    };
  }
  const report = await readJsonIfExists(reportPath);
  const boundary = report?.coverage?.x?.rateLimitBoundary || report?.coverage?.x?.fullSiteBoundary || {};
  const active = Boolean(boundary.activeRateLimitBlocker);
  const surfaces = Array.isArray(boundary.activeBlockedSurfaces)
    ? boundary.activeBlockedSurfaces
    : Array.isArray(boundary.rateLimitActiveBlockedSurfaces)
      ? boundary.rateLimitActiveBlockedSurfaces
      : [];
  const latestBlocker = boundary.latestBlocker || boundary.latestRateLimitBlocker || null;
  const observedMs = timeMs(latestBlocker?.finishedAt || latestBlocker?.observedAt || latestBlocker?.generatedAt);
  const cooldownMs = Math.max(0, Number(cooldownMinutes || 0)) * 60_000;
  const expired = active && observedMs > 0 && cooldownMs > 0 && now.getTime() - observedMs >= cooldownMs;
  return {
    active: active && !expired,
    reportPath,
    surfaces: active && !expired ? surfaces : [],
    latestBlocker,
    expiredActiveReport: expired,
    cooldownMinutes,
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${stringifyJson(value, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, items) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = items.map((item) => stringifyJson(item)).join('\n');
  await fs.writeFile(filePath, text ? `${text}\n` : '', 'utf8');
}

function stringifyJson(value, indent = 0) {
  return JSON.stringify(value, null, indent).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (char) => (
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value, length = 12) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function taskTargetFingerprint(options) {
  return shortHash(stableStringify({
    task: options.task,
    account: options.account || null,
    query: options.query || null,
    subjects: subjectListSafe(options),
    languages: options.languages || [],
    from: options.from || null,
    to: options.to || null,
    mode: taskMode(options.task, options),
  }));
}

function initialState(plan) {
  return {
    schemaVersion: SCHEMA_VERSION,
    task: plan.task,
    layout: plan.layout,
    status: 'planned',
    generatedAt: plan.generatedAt,
    updatedAt: plan.generatedAt,
    buckets: plan.buckets,
    cooldowns: {},
    artifacts: {
      plan: plan.layout.planPath,
      state: plan.layout.statePath,
      summary: plan.layout.summaryPath,
      report: plan.layout.reportPath,
      rawItems: plan.layout.rawItemsPath,
      dedupedItems: plan.layout.dedupedItemsPath,
      accounts: plan.layout.accountsPath,
      cacheIndex: plan.layout.cacheIndexPath,
      cacheIndexJsonl: plan.layout.cacheIndexJsonlPath,
      mediaAssets: plan.layout.mediaAssetsPath,
      mediaAssetsJsonl: plan.layout.mediaAssetsJsonlPath,
      mediaDir: plan.layout.mediaDir,
      archiveManifest: plan.layout.archiveManifestPath,
      archiveDir: plan.layout.archiveDir,
      archiveFollowing: plan.layout.archiveFollowingPath,
      archiveFollowingJson: plan.layout.archiveFollowingJsonPath,
      archiveFollowingCsv: plan.layout.archiveFollowingCsvPath,
      archiveRawDir: plan.layout.archiveRawDir,
      archiveRawPosts: plan.layout.archiveRawPostsPath,
      archiveRawArticles: plan.layout.archiveRawArticlesPath,
      archiveRawFollowing: plan.layout.archiveRawFollowingPath,
      archiveRawMediaManifest: plan.layout.archiveRawMediaManifestPath,
      archiveRawManifest: plan.layout.archiveRawManifestPath,
      archiveIndex: plan.layout.archiveIndexPath,
      archivePostsIndex: plan.layout.archivePostsIndexPath,
      archiveArticlesIndex: plan.layout.archiveArticlesIndexPath,
      archiveMediaIndex: plan.layout.archiveMediaIndexPath,
      archiveReport: plan.layout.archiveReportPath,
      archiveErrors: plan.layout.archiveErrorsPath,
      archiveChecksum: plan.layout.archiveChecksumPath,
    },
  };
}

function normalizeResumeTarget(target = {}) {
  return Object.fromEntries(Object.entries(target || {})
    .filter(([, value]) => {
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }));
}

function legacyTargetsCompatible(existingTarget, planTarget) {
  for (const [key, value] of Object.entries(existingTarget || {})) {
    if (stableStringify(value) !== stableStringify(planTarget?.[key])) {
      return false;
    }
  }
  return true;
}

function mergeResumeState(existing, plan) {
  if (!existing) return initialState(plan);
  const existingFingerprint = existing.task?.targetFingerprint;
  const planFingerprint = plan.task?.targetFingerprint;
  const existingTarget = normalizeResumeTarget(existing.task?.target || null);
  const planTarget = normalizeResumeTarget(plan.task?.target || null);
  if (existingFingerprint && planFingerprint && existingFingerprint !== planFingerprint) {
    throw new Error(`resume target mismatch: existing=${existingFingerprint} plan=${planFingerprint}. Use a different --out-dir or remove --resume.`);
  }
  if (!existingFingerprint && !legacyTargetsCompatible(existingTarget, planTarget)) {
    throw new Error('resume target mismatch with legacy state. Use a different --out-dir or remove --resume.');
  }
  const byId = new Map((existing.buckets || []).map((bucket) => [bucket.id, bucket]));
  return {
    ...initialState(plan),
    status: existing.status || 'planned',
    generatedAt: existing.generatedAt || plan.generatedAt,
    updatedAt: new Date().toISOString(),
    cooldowns: existing.cooldowns || {},
    buckets: plan.buckets.map((bucket) => ({
      ...bucket,
      ...(byId.get(bucket.id) || {}),
      command: bucket.command,
      fallbackCommand: bucket.fallbackCommand,
      label: bucket.label,
      surfaceKey: bucket.surfaceKey,
    })),
  };
}

function bucketComplete(status) {
  return ['completed', 'captured-with-warning', 'completed-from-cache', 'degraded-complete'].includes(String(status || ''));
}

function hasExecutablePendingBucketAfter(buckets, index, blockedSurfaceKeys) {
  return buckets.slice(index + 1).some((bucket) => (
    !bucketComplete(bucket.status)
    && !blockedSurfaceKeys.has(bucket.surfaceKey)
  ));
}

function activeStateCooldownSurfaces(cooldowns = {}, cooldownMinutes = 30, now = new Date()) {
  const active = new Set();
  const cooldownMs = Math.max(0, Number(cooldownMinutes || 0)) * 60_000;
  for (const [surfaceKey, cooldown] of Object.entries(cooldowns || {})) {
    const observedMs = timeMs(cooldown?.observedAt);
    if (!observedMs || !cooldownMs || now.getTime() - observedMs < cooldownMs) {
      active.add(surfaceKey);
    }
  }
  return active;
}

function parseXActionJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error('empty command stdout');
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error('command stdout did not contain JSON');
  }
}

function runtimeRiskText(parsed) {
  const runtimeRisk = parsed?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  return [
    parsed?.outcome?.status,
    parsed?.outcome?.reason,
    runtimeRisk.stopReason,
    runtimeRisk.suggestedAction,
    riskState.taskId,
    riskState.scope,
    riskState.state,
    ...(Array.isArray(runtimeRisk.riskSignals) ? runtimeRisk.riskSignals : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isApiLocalStall(parsed) {
  const runtimeRisk = parsed?.runtimeRisk || {};
  const riskState = runtimeRisk.riskState || {};
  const text = runtimeRiskText(parsed);
  const status = String(parsed?.outcome?.status || '').toLowerCase();
  const reason = String(parsed?.outcome?.reason || runtimeRisk.stopReason || '').toLowerCase();
  return status === 'blocked-risk'
    && (
      /\bapi\b|api-cursor|cursor|searchtimeline|x:api/u.test(text)
      || /api|cursor/u.test(reason)
      || String(riskState.scope || '').toLowerCase() === 'api'
    );
}

function isApiUnavailableWithoutHardGate(parsed) {
  const runtimeRisk = parsed?.runtimeRisk || {};
  const text = runtimeRiskText(parsed);
  if (runtimeRisk.hardStop === true || (runtimeRisk.rateLimited === true && !isApiLocalStall(parsed))) {
    return false;
  }
  return /no-[a-z-]*api-seed|api-operations-no-archive-seed|no-usable-api-cursor|no api cursor|api cursor unavailable|api seed unavailable/u.test(text);
}

function isSameSurfaceHardStop(parsed) {
  const runtimeRisk = parsed?.runtimeRisk || {};
  if (isApiLocalStall(parsed) || isApiUnavailableWithoutHardGate(parsed)) {
    return false;
  }
  return runtimeRisk.hardStop === true
    || runtimeRisk.rateLimited === true
    || parsed?.outcome?.status === 'blocked-risk'
    || parsed?.sessionGate?.status === 'blocked';
}

function summarizeParsedResult(parsed) {
  const result = parsed?.result || {};
  const archive = result.archive || {};
  return {
    ok: parsed?.ok === true,
    outcome: parsed?.outcome || null,
    runtimeRisk: parsed?.runtimeRisk || null,
    sessionGate: parsed?.sessionGate || null,
    artifacts: parsed?.artifacts || {},
    counts: {
      items: Array.isArray(result.items) ? result.items.length : Number(archive.itemCount || 0),
      users: Array.isArray(result.users) ? result.users.length : Number(archive.userCount || 0),
      media: Array.isArray(result.media) ? result.media.length : Number(archive.mediaCount || 0),
    },
  };
}

function executeCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timeoutMs = Number(options.timeoutMs || 0);
    const timer = timeoutMs > 0 ? setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already be gone.
      }
      finish({
        exitCode: 124,
        stdout,
        stderr: `${stderr}\nrunner-timeout-ms=${timeoutMs}`.trim(),
        timedOut: true,
      });
    }, timeoutMs) : null;
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr || error?.message || String(error),
      });
    });
    child.on('close', (code) => {
      finish({
        exitCode: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommandArray(command, deps) {
  return deps.executeCommand(command[0], command.slice(1), {
    cwd: deps.cwd || process.cwd(),
    timeoutMs: deps.commandTimeoutMs,
  });
}

function commandArgValue(command, flag) {
  const index = command.indexOf(flag);
  return index >= 0 ? command[index + 1] : null;
}

async function artifactsFromPossiblyIncompleteCommand(command) {
  const outDir = commandArgValue(command, '--out-dir');
  const artifactRunId = commandArgValue(command, '--artifact-run-id');
  if (!outDir || !artifactRunId) return {};
  let entries = [];
  try {
    entries = await fs.readdir(outDir, { withFileTypes: true });
  } catch {
    return {};
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(artifactRunId)) continue;
    const runDir = path.join(outDir, entry.name);
    const statePath = path.join(runDir, 'state.json');
    let stat = null;
    try {
      stat = await fs.stat(statePath);
    } catch {
      stat = await fs.stat(runDir).catch(() => null);
    }
    candidates.push({ runDir, statePath, mtimeMs: stat?.mtimeMs || 0 });
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const candidate = candidates[0];
  if (!candidate) return {};
  const state = await readJsonIfExists(candidate.statePath).catch(() => null);
  const artifacts = state?.artifacts && typeof state.artifacts === 'object' ? state.artifacts : {};
  return {
    runDir: candidate.runDir,
    manifest: artifacts.manifest || path.join(candidate.runDir, 'manifest.json'),
    items: artifacts.items || path.join(candidate.runDir, 'items.jsonl'),
    state: artifacts.state || candidate.statePath,
    report: artifacts.report || path.join(candidate.runDir, 'report.md'),
  };
}

async function runBucket(bucket, deps) {
  const startedAt = new Date().toISOString();
  let raw = await runCommandArray(bucket.command, deps);
  let parsed = null;
  try {
    parsed = parseXActionJson(raw.stdout);
  } catch (error) {
    const artifacts = await artifactsFromPossiblyIncompleteCommand(bucket.command);
    return {
      ...bucket,
      status: 'failed',
      attempts: (bucket.attempts || 0) + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: raw.exitCode,
      error: error?.message || String(error),
      stderrTail: raw.stderr.slice(-2000),
      artifacts,
    };
  }

  const primarySummary = summarizeParsedResult(parsed);
  if (bucket.fallbackCommand && (isApiLocalStall(parsed) || isApiUnavailableWithoutHardGate(parsed) || (raw.exitCode !== 0 && bucket.primaryCollectionMode === 'api'))) {
    const fallbackStartedAt = new Date().toISOString();
    const fallbackRaw = await runCommandArray(bucket.fallbackCommand, deps);
    let fallbackParsed = null;
    try {
      fallbackParsed = parseXActionJson(fallbackRaw.stdout);
    } catch (error) {
      const artifacts = await artifactsFromPossiblyIncompleteCommand(bucket.fallbackCommand);
      return {
        ...bucket,
        status: 'failed',
        attempts: (bucket.attempts || 0) + 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: fallbackRaw.exitCode,
        primary: primarySummary,
        fallback: {
          startedAt: fallbackStartedAt,
          exitCode: fallbackRaw.exitCode,
          error: error?.message || String(error),
          stderrTail: fallbackRaw.stderr.slice(-2000),
          artifacts,
        },
        artifacts,
        error: error?.message || String(error),
      };
    }
    const fallbackSummary = summarizeParsedResult(fallbackParsed);
    const fallbackHardStop = isSameSurfaceHardStop(fallbackParsed);
    const fallbackStatus = fallbackParsed?.ok === true && !fallbackHardStop
      ? 'completed'
      : fallbackHardStop
        ? 'waiting-cooldown'
        : 'failed';
    return {
      ...bucket,
      status: fallbackStatus,
      attempts: (bucket.attempts || 0) + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: fallbackRaw.exitCode,
      primary: primarySummary,
      fallback: {
        from: 'api',
        to: 'page',
        reason: primarySummary.outcome?.reason || primarySummary.runtimeRisk?.stopReason || 'api-local-stall',
        startedAt: fallbackStartedAt,
        finishedAt: new Date().toISOString(),
        exitCode: fallbackRaw.exitCode,
        result: fallbackSummary,
      },
      result: fallbackSummary,
      error: fallbackStatus === 'failed' ? fallbackSummary.outcome?.reason || `fallback-command-exit-${fallbackRaw.exitCode}` : undefined,
    };
  }

  const status = parsed?.ok === true && !isSameSurfaceHardStop(parsed)
    ? 'completed'
    : isSameSurfaceHardStop(parsed)
      ? 'waiting-cooldown'
      : 'failed';
  return {
    ...bucket,
    status,
    attempts: (bucket.attempts || 0) + 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: raw.exitCode,
    result: primarySummary,
    error: status === 'failed' ? primarySummary.outcome?.reason || `command-exit-${raw.exitCode}` : undefined,
  };
}

async function readJsonlIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    return [];
  }
}

function bucketArtifacts(bucket) {
  return bucket.result?.artifacts
    || bucket.fallback?.result?.artifacts
    || bucket.fallback?.artifacts
    || bucket.primary?.artifacts
    || bucket.artifacts
    || {};
}

function bucketArtifactGroups(bucket) {
  const groups = [];
  const add = (source, artifacts) => {
    if (!artifacts || typeof artifacts !== 'object') return;
    if (!artifacts.items && !artifacts.users && !artifacts.accounts) return;
    const key = JSON.stringify({
      items: artifacts.items || null,
      users: artifacts.users || null,
      accounts: artifacts.accounts || null,
    });
    if (groups.some((group) => group.key === key)) return;
    groups.push({ source, artifacts, key });
  };
  add('primary', bucket.primary?.artifacts);
  add('fallback', bucket.fallback?.result?.artifacts);
  add('fallback-partial', bucket.fallback?.artifacts);
  add('result', bucket.result?.artifacts);
  add('partial', bucket.artifacts);
  return groups;
}

function bucketItemCount(bucket) {
  if (bucket.fallback?.result) {
    return Number(bucket.primary?.counts?.items || 0)
      + Number(bucket.fallback.result?.counts?.items || 0);
  }
  return Number(bucket.result?.counts?.items || 0);
}

function resetBucketForExecution(bucket) {
  const {
    primary: _primary,
    fallback: _fallback,
    result: _result,
    artifacts: _artifacts,
    error: _error,
    stderrTail: _stderrTail,
    exitCode: _exitCode,
    noWaitFallback: _noWaitFallback,
    skippedReason: _skippedReason,
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...rest
  } = bucket || {};
  return rest;
}

function itemKey(item) {
  return item.id || item.url || `${item.username || item.author?.handle || ''}:${item.createdAt || ''}:${item.text || ''}`;
}

function accountKey(account) {
  return account.handle || account.username || account.screenName || account.id || account.restId || account.url || JSON.stringify(account);
}

function handleFromXStatusUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.replace(/^www\./u, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    const [handle, segment] = parsed.pathname.split('/').filter(Boolean);
    if (segment !== 'status') return null;
    if (String(handle || '').toLowerCase() === 'i') return null;
    if (!/^[A-Za-z0-9_]{1,15}$/u.test(handle || '')) return null;
    return handle;
  } catch {
    const match = text.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//iu);
    if (String(match?.[1] || '').toLowerCase() === 'i') return null;
    return match?.[1] || null;
  }
}

function isInternalXStatusUrl(value) {
  return /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/i\/status\//iu.test(String(value || ''));
}

function authorHandle(item) {
  const url = item.url || item.permalink || item.link;
  if (isInternalXStatusUrl(url) && item.sourceAccount) {
    return item.sourceAccount;
  }
  const embeddedHandle = item.author?.handle || item.username || item.user?.screenName || item.handle || null;
  return handleFromXStatusUrl(url)
    || (String(embeddedHandle || '').toLowerCase() === 'i' ? null : embeddedHandle)
    || null;
}

function searchQueryConstraints(query) {
  const text = String(query || '');
  const since = text.match(/\bsince:(\d{4}-\d{2}-\d{2})/iu)?.[1] || null;
  const until = text.match(/\buntil:(\d{4}-\d{2}-\d{2})/iu)?.[1] || null;
  const lang = text.match(/\blang:([a-z]{2,8})/iu)?.[1] || null;
  const topicPart = text
    .replace(/\blang:\S+/giu, ' ')
    .replace(/\bsince:\S+/giu, ' ')
    .replace(/\buntil:\S+/giu, ' ')
    .replace(/-is:\S+/giu, ' ')
    .trim();
  const quoted = [...topicPart.matchAll(/"([^"]+)"/gu)].map((match) => match[1].trim()).filter(Boolean);
  const unquoted = topicPart
    .replace(/"[^"]+"/gu, ' ')
    .replace(/[()]/gu, ' ')
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term && !/^(?:OR|AND)$/iu.test(term));
  const alternatives = [...quoted, ...unquoted]
    .map((term) => term.replace(/^[-+]/u, '').trim())
    .filter((term) => term && !/^is:/iu.test(term));
  return {
    since,
    until,
    lang,
    alternatives: [...new Set(alternatives)],
  };
}

function comparableText(value) {
  return String(value || '').toLowerCase();
}

function compactComparableText(value) {
  return comparableText(value).replace(/[^a-z0-9.\u4e00-\u9fff]+/giu, '');
}

function itemMatchesSearchQuery(item, query) {
  const constraints = searchQueryConstraints(query);
  const created = createdAtText(item);
  const createdMs = timeMs(created);
  if (constraints.since && createdMs && createdMs < Date.parse(`${constraints.since}T00:00:00.000Z`)) {
    return false;
  }
  if (constraints.until && createdMs && createdMs >= Date.parse(`${constraints.until}T00:00:00.000Z`)) {
    return false;
  }
  const haystack = comparableText([
    textOfItem(item),
    item.url,
    item.author?.handle,
    item.username,
  ].filter(Boolean).join(' '));
  const compactHaystack = compactComparableText(haystack);
  const alternatives = constraints.alternatives
    .filter((term) => !/^lang:|^since:|^until:/iu.test(term))
    .filter((term) => !/^-?is:/iu.test(term));
  if (!alternatives.length) return true;
  return alternatives.some((term) => {
    const lower = comparableText(term);
    if (haystack.includes(lower)) return true;
    return compactHaystack.includes(compactComparableText(lower));
  });
}

async function listItemJsonlFiles(root) {
  const output = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === 'items.jsonl') {
        output.push(entryPath);
      }
    }
  }
  return output;
}

async function matchingLocalCacheItems(bucket, options, limit) {
  const indexedMatches = await matchingIndexedCacheItems(bucket, options, limit);
  if (indexedMatches.length) {
    return indexedMatches;
  }
  const files = await listItemJsonlFiles(options.runsRoot || DEFAULT_RUNS_ROOT);
  const matches = [];
  for (const file of files) {
    const items = await readJsonlIfExists(file);
    for (const item of items) {
      if (!itemMatchesSearchQuery(item, bucket.query)) continue;
      matches.push({
        ...item,
        _noWaitFallback: 'local-cache',
        _sourceItemsPath: file,
      });
      if (matches.length >= limit) {
        return matches;
      }
    }
  }
  return matches;
}

async function writeNoWaitItems(state, bucket, source, items) {
  const runDir = path.join(state.layout.outDir, 'no-wait-fallback', compactSlug(bucket.id), source);
  const itemsPath = path.join(runDir, 'items.jsonl');
  await writeJsonl(itemsPath, items);
  return {
    runDir,
    items: itemsPath,
  };
}

function completedBucketResultFromItems(source, artifacts, items, extra = {}) {
  return {
    ok: true,
    outcome: {
      status: 'captured-with-warning',
      reason: source,
      resumable: false,
    },
    runtimeRisk: {
      riskSignals: [source],
      stopReason: source,
      rateLimited: false,
      hardStop: false,
    },
    sessionGate: null,
    artifacts,
    counts: {
      items: items.length,
      users: 0,
      media: items.reduce((count, item) => count + (Array.isArray(item.media) ? item.media.length : 0), 0),
    },
    ...extra,
  };
}

function topCandidateHandles(evidence, limit) {
  return topCounts(evidence.accounts.map(accountKey).filter(Boolean), limit)
    .map((entry) => entry.value)
    .filter((handle) => /^[A-Za-z0-9_]{1,15}$/u.test(handle));
}

async function profileBackfillItemsForSearchBucket(bucket, state, options, deps) {
  const evidence = await collectEvidence(state);
  const handles = topCandidateHandles(evidence, options.noWaitProfileAccounts);
  const matches = [];
  const attempts = [];
  const limit = Math.max(1, Math.min(maxItemsForTask(options.task, options), 100));
  for (const handle of handles) {
    const command = pageCommand('profile-content', options, {
      account: handle,
      contentType: 'posts',
      artifactRunId: compactSlug(`x-research-${options.task}-${bucket.id}-profile-${handle}`),
      maxItems: limit,
      maxScrolls: Math.min(options.maxScrolls || DEFAULT_MAX_SCROLLS, 20),
      scrollWaitMs: options.scrollWaitMs,
    });
    const raw = await runCommandArray(command, deps);
    let parsed = null;
    try {
      parsed = parseXActionJson(raw.stdout);
    } catch (error) {
      attempts.push({
        handle,
        status: 'parse-failed',
        exitCode: raw.exitCode,
        error: error?.message || String(error),
      });
      continue;
    }
    const summary = summarizeParsedResult(parsed);
    attempts.push({
      handle,
      status: parsed?.outcome?.status || (parsed?.ok ? 'ok' : 'not-ok'),
      reason: parsed?.outcome?.reason || summary.runtimeRisk?.stopReason || null,
      items: summary.counts.items,
      hardStop: isSameSurfaceHardStop(parsed),
    });
    if (isSameSurfaceHardStop(parsed)) {
      continue;
    }
    const items = await readJsonlIfExists(summary.artifacts.items);
    for (const item of items) {
      if (!itemMatchesSearchQuery(item, bucket.query)) continue;
      matches.push({
        ...item,
        _noWaitFallback: 'profile-backfill',
        _backfillAccount: handle,
        _sourceItemsPath: summary.artifacts.items,
      });
      if (matches.length >= limit) {
        return { matches, attempts };
      }
    }
  }
  return { matches, attempts };
}

async function resolveSearchBucketWithoutWaiting(bucket, state, options, deps, source) {
  const now = new Date().toISOString();
  const preserved = await preservePartialArtifactBucket(bucket, source, now);
  if (preserved) return preserved;
  const existingArtifacts = bucketArtifacts(bucket);
  if (existingArtifacts.items && bucketItemCount(bucket) > 0) {
    return {
      ...bucket,
      status: 'captured-with-warning',
      skippedReason: `${source}-partial-artifact-preserved`,
      noWaitFallback: {
        source: 'partial-artifact',
        items: bucketItemCount(bucket),
        observedAt: now,
      },
      updatedAt: now,
    };
  }

  const limit = Math.max(1, Math.min(maxItemsForTask(options.task, options), 100));
  const cachedItems = await matchingLocalCacheItems(bucket, options, limit);
  if (cachedItems.length) {
    const fallbackSource = cachedItems.some((item) => item._noWaitFallback === 'cache-index')
      ? 'cache-index'
      : 'local-cache';
    const artifacts = await writeNoWaitItems(state, bucket, fallbackSource, cachedItems);
    return {
      ...bucket,
      status: 'captured-with-warning',
      skippedReason: `${source}-${fallbackSource}`,
      noWaitFallback: {
        source: fallbackSource,
        items: cachedItems.length,
        observedAt: now,
      },
      result: completedBucketResultFromItems(`${fallbackSource}-no-wait`, artifacts, cachedItems),
      updatedAt: now,
      finishedAt: now,
    };
  }

  const { matches, attempts } = options.noWaitProfileAccounts > 0
    ? await profileBackfillItemsForSearchBucket(bucket, state, options, deps)
    : { matches: [], attempts: [] };
  const profileArtifacts = await writeNoWaitItems(state, bucket, 'profile-backfill', matches);
  return {
    ...bucket,
    status: 'captured-with-warning',
    skippedReason: matches.length ? `${source}-profile-backfill` : `${source}-empty-profile-backfill`,
    noWaitFallback: {
      source: matches.length ? 'profile-backfill' : 'empty-profile-backfill',
      items: matches.length,
      attempts,
      observedAt: now,
    },
    result: completedBucketResultFromItems(
      matches.length ? 'profile-backfill-no-wait' : 'empty-profile-backfill-no-wait',
      profileArtifacts,
      matches,
      { profileBackfillAttempts: attempts },
    ),
    updatedAt: now,
    finishedAt: now,
  };
}

async function preservePartialArtifactBucket(bucket, source, now = new Date().toISOString()) {
  const existingArtifacts = bucketArtifacts(bucket);
  if (existingArtifacts.items) {
    const rows = await readJsonlIfExists(existingArtifacts.items);
    const itemRows = rows.filter((row) => row?.kind !== 'user' && row?.kind !== 'account');
    const userRows = rows.filter((row) => row?.kind === 'user' || row?.kind === 'account');
    if (itemRows.length || userRows.length) {
      const result = {
        ok: true,
        outcome: {
          status: 'captured-with-warning',
          reason: `${source}-partial-artifact-preserved`,
          resumable: false,
        },
        runtimeRisk: {
          riskSignals: [`${source}-partial-artifact-preserved`],
          stopReason: `${source}-partial-artifact-preserved`,
          rateLimited: false,
          hardStop: false,
        },
        sessionGate: null,
        artifacts: existingArtifacts,
        counts: {
          items: itemRows.length,
          users: userRows.length,
          media: itemRows.reduce((count, item) => count + (Array.isArray(item.media) ? item.media.length : 0), 0),
        },
      };
      return {
        ...bucket,
        status: 'captured-with-warning',
        skippedReason: `${source}-partial-artifact-preserved`,
        noWaitFallback: {
          source: 'partial-artifact',
          items: itemRows.length,
          users: userRows.length,
          observedAt: now,
        },
        result,
        updatedAt: now,
        finishedAt: now,
      };
    }
  }
  return null;
}

async function resolveMediaBucketFromTaskEvidence(bucket, state, options, source, now = new Date().toISOString()) {
  if (bucket.contentType !== 'media' && bucket.surfaceKey !== 'profile-content:media') {
    return null;
  }
  const evidence = await collectEvidence(state);
  const limit = Math.max(1, maxItemsForTask(options.task, options));
  const mediaItems = dedupeBy(
    evidence.rawItems
      .filter((item) => Array.isArray(item.media) && item.media.length > 0)
      .map((item) => ({
        ...item,
        _noWaitFallback: 'local-media-evidence',
        _mediaEvidenceSourceBucket: item._bucketId || null,
      })),
    itemKey,
  ).slice(0, limit);
  if (!mediaItems.length) {
    return null;
  }
  const artifacts = await writeNoWaitItems(state, bucket, 'local-media-evidence', mediaItems);
  return {
    ...bucket,
    status: 'captured-with-warning',
    skippedReason: `${source}-local-media-evidence`,
    noWaitFallback: {
      source: 'local-media-evidence',
      items: mediaItems.length,
      media: mediaItems.reduce((count, item) => count + (Array.isArray(item.media) ? item.media.length : 0), 0),
      observedAt: now,
    },
    result: completedBucketResultFromItems('local-media-evidence-no-wait', artifacts, mediaItems),
    updatedAt: now,
    finishedAt: now,
  };
}

async function emptyNoWaitTerminalBucket(bucket, state, source) {
  const now = new Date().toISOString();
  const artifacts = await writeNoWaitItems(state, bucket, 'empty-degraded-terminal', []);
  return {
    ...bucket,
    status: 'captured-with-warning',
    skippedReason: `${source}-empty-degraded-terminal`,
    noWaitFallback: {
      source: 'empty-degraded-terminal',
      items: 0,
      observedAt: now,
    },
    result: completedBucketResultFromItems('empty-degraded-terminal-no-wait', artifacts, []),
    updatedAt: now,
    finishedAt: now,
  };
}

async function resolveBucketWithoutWaiting(bucket, state, options, deps, source) {
  const preserved = await preservePartialArtifactBucket(bucket, source);
  if (preserved) return preserved;
  const mediaBackfill = await resolveMediaBucketFromTaskEvidence(bucket, state, options, source);
  if (mediaBackfill) return mediaBackfill;
  if (bucket.action === 'search' || bucket.surfaceKey === 'search') {
    return resolveSearchBucketWithoutWaiting(bucket, state, options, deps, source);
  }
  return emptyNoWaitTerminalBucket(bucket, state, source);
}

function recoverableExecutionFailure(bucket) {
  const text = [
    bucket?.error,
    bucket?.stderrTail,
    bucket?.fallback?.error,
    bucket?.fallback?.stderrTail,
  ].filter(Boolean).join('\n').toLowerCase();
  return text.includes('empty command stdout')
    || text.includes('runner-timeout-ms=')
    || text.includes('command timed out');
}

function commandTimeoutMsForTask(options) {
  const base = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS) + 30_000;
  if (options.task !== 'account-full-archive') return base;
  const pageBudget = Math.max(1, Number(maxApiPagesForTask(options.task, options) || 1)) * 5_000;
  return Math.max(base, Math.min(1_800_000, pageBudget));
}

async function collectEvidence(state) {
  const rawItems = [];
  const accounts = [];
  for (const bucket of state.buckets || []) {
    for (const group of bucketArtifactGroups(bucket)) {
      const { artifacts } = group;
      if (artifacts.items) {
        const items = await readJsonlIfExists(artifacts.items);
        for (const item of items) {
          if (item?.kind === 'user' || item?.kind === 'account') {
            const { kind: _kind, ...account } = item || {};
            accounts.push({ ...account, source: 'relation', artifactSource: group.source, bucketId: bucket.id });
            continue;
          }
          const normalizedItem = {
            ...item,
            _bucketId: bucket.id,
            _bucketLabel: bucket.label,
            _artifactSource: group.source,
          };
          const handle = authorHandle(normalizedItem);
          if (handle) {
            normalizedItem.author = {
              ...(normalizedItem.author || {}),
              handle,
            };
          }
          rawItems.push(normalizedItem);
          if (handle) {
            accounts.push({
              handle,
              source: 'item-author',
              artifactSource: group.source,
              bucketId: bucket.id,
            });
          }
        }
      }
      const usersPath = artifacts.users || artifacts.accounts;
      if (usersPath) {
        const users = await readJsonlIfExists(usersPath);
        for (const user of users) accounts.push({ ...user, source: 'relation', artifactSource: group.source, bucketId: bucket.id });
      }
    }
  }
  const dedupedItems = dedupeBy(rawItems, itemKey);
  const dedupedAccounts = dedupeBy(accounts, accountKey);
  return {
    rawItems,
    dedupedItems,
    accounts: dedupedAccounts,
  };
}

function cacheIndexTerms(item) {
  return [...new Set([
    ...tokenizeText(textOfItem(item)),
    authorHandle(item),
    ...(String(item.url || item.link || '').match(/[A-Za-z0-9_#.+-]{2,}/gu) || []),
  ].filter(Boolean).map((value) => String(value).toLowerCase()))].slice(0, 80);
}

function buildCacheIndex(state, evidence) {
  const records = evidence.dedupedItems.map((item) => ({
    schemaVersion: SCHEMA_VERSION,
    taskId: state.task.id,
    targetFingerprint: state.task.targetFingerprint || null,
    bucketId: item._bucketId || null,
    artifactSource: item._artifactSource || null,
    sourceItemsPath: item._sourceItemsPath || null,
    author: authorHandle(item),
    createdAt: dateOfItem(item),
    month: monthOfItem(item),
    url: item.url || item.link || null,
    text: textOfItem(item).slice(0, 500),
    terms: cacheIndexTerms(item),
    item,
  }));
  const authors = topCounts(records.map((record) => record.author).filter(Boolean), 100);
  const terms = topCounts(records.flatMap((record) => record.terms), 200);
  const dates = records.map((record) => record.createdAt).filter(Boolean).sort();
  return {
    summary: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      task: state.task,
      totalRecords: records.length,
      buckets: topCounts(records.map((record) => record.bucketId).filter(Boolean), 100),
      authors,
      terms,
      dateRange: {
        first: dates[0] || null,
        last: dates[dates.length - 1] || null,
      },
    },
    records,
  };
}

async function listCacheIndexJsonlFiles(root) {
  const output = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name === 'cache-index.jsonl') {
        output.push(entryPath);
      }
    }
  }
  return output;
}

async function matchingIndexedCacheItems(bucket, options, limit) {
  const outRoot = path.resolve(options.outDir ? path.dirname(options.outDir) : DEFAULT_OUT_ROOT);
  const files = await listCacheIndexJsonlFiles(outRoot);
  const matches = [];
  for (const file of files) {
    const records = await readJsonlIfExists(file);
    for (const record of records) {
      const item = record.item || record;
      if (!itemMatchesSearchQuery(item, bucket.query)) continue;
      matches.push({
        ...item,
        _noWaitFallback: 'cache-index',
        _sourceCacheIndexPath: file,
        _sourceItemsPath: record.sourceItemsPath || item._sourceItemsPath || null,
      });
      if (matches.length >= limit) {
        return matches;
      }
    }
  }
  return matches;
}

function mediaUrlCandidates(entry) {
  const urls = [];
  if (!entry || typeof entry !== 'object') return urls;
  for (const key of [
    'url',
    'mediaUrl',
    'media_url',
    'media_url_https',
    'preview_image_url',
    'expanded_url',
    'display_url',
  ]) {
    if (entry[key]) urls.push(entry[key]);
  }
  if (entry.video_info?.variants) {
    for (const variant of entry.video_info.variants) {
      if (variant.url) urls.push(variant.url);
    }
  }
  return urls
    .map((url) => String(url || '').trim())
    .filter((url) => /^(?:https?:|data:)/iu.test(url));
}

function mediaEntriesForItem(item) {
  const containers = [];
  if (Array.isArray(item.media)) containers.push(...item.media);
  if (Array.isArray(item.extended_entities?.media)) containers.push(...item.extended_entities.media);
  if (Array.isArray(item.entities?.media)) containers.push(...item.entities.media);
  if (Array.isArray(item.attachments?.media)) containers.push(...item.attachments.media);
  return containers;
}

function mediaArchiveSourceItems(state, evidence) {
  if (state.task.id !== 'account-full-archive') {
    return evidence.dedupedItems;
  }
  return evidence.dedupedItems.filter((item) => itemWithinTaskTimeRange(item, state));
}

function mediaAssetRecords(state, evidence) {
  return mediaAssetRecordsFromItems(mediaArchiveSourceItems(state, evidence), { mediaDir: state.layout.mediaDir });
}

async function buildMediaArchive(state, evidence) {
  const downloadMedia = state.task.defaults?.downloadMedia === true;
  const limit = Number(state.task.defaults?.mediaDownloadLimit ?? DEFAULT_MEDIA_DOWNLOAD_LIMIT);
  const sourceItems = mediaArchiveSourceItems(state, evidence);
  const report = downloadMedia
    ? await buildSocialMediaDownloadReport({
        items: sourceItems,
        mediaDir: state.layout.mediaDir,
        limit,
      })
    : {
        candidates: mediaAssetRecords(state, evidence),
        downloads: [],
        queue: [],
        expectedMedia: mediaAssetRecords(state, evidence),
        skippedMedia: 0,
        skippedCandidates: 0,
        status: 'planned',
        supported: true,
        blocked: false,
        reason: null,
      };
  const downloadedById = new Map((report.downloads || []).map((record) => [record.id, record]));
  const queuedById = new Map((report.queue || []).map((record) => [record.id, record]));
  const archived = (report.candidates || []).map((record) => (
    downloadedById.get(record.id)
    || queuedById.get(record.id)
    || record
  ));
  const counts = {
    total: archived.length,
    downloaded: archived.filter((record) => record.status === 'downloaded').length,
    planned: archived.filter((record) => record.status === 'planned' || record.status === 'pending').length,
    failed: archived.filter((record) => record.status === 'failed').length,
    pending: archived.filter((record) => record.status === 'pending').length,
    images: archived.filter((record) => record.type === 'image').length,
    videos: archived.filter((record) => record.type === 'video').length,
  };
  return {
    summary: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      downloadMedia,
      mediaDownloadLimit: limit,
      unlimited: downloadMedia && limit === 0,
      counts,
      mediaDir: state.layout.mediaDir,
      status: report.status,
      reason: report.reason,
      supported: report.supported !== false,
      blocked: report.blocked === true,
    },
    records: archived,
  };
}

function markdownEscape(value) {
  return String(value ?? '')
    .replace(/\|/gu, '\\|')
    .replace(/\r?\n/gu, '<br>');
}

function markdownTextBlock(value) {
  const text = textOfItem(value);
  return text || '_No text captured._';
}

function archiveTimestamp(value, fallbackId = 'undated') {
  const dateText = dateOfItem(value);
  if (!dateText) return fallbackId;
  return dateText
    .replace(/T/u, '_')
    .replace(/:/gu, '-')
    .replace(/\.\d{3}Z$/u, '');
}

function contentId(item, index = 0) {
  return String(item.id || item.itemId || item.restId || item.statusId || item.articleId || item.url || `item-${index + 1}`)
    .replace(/^https?:\/\//iu, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    || `item-${index + 1}`;
}

function archiveFileName(item, index) {
  return `${archiveTimestamp(item, 'undated')}_${contentId(item, index)}.md`;
}

function markdownRelativeLink(fromFile, toFile) {
  return path.relative(path.dirname(fromFile), toFile).replace(/\\/gu, '/');
}

function mediaRecordsForItem(item, mediaRecords) {
  const itemId = item.id || item.itemId || item.restId || null;
  const itemUrl = item.url || item.link || item.permalink || null;
  return (mediaRecords || []).filter((record) => (
    (itemId && record.sourceItemId === itemId)
    || (itemUrl && record.sourceItemUrl === itemUrl)
  ));
}

function renderLocalMediaMarkdown(item, mediaRecords, markdownPath) {
  const records = mediaRecordsForItem(item, mediaRecords);
  if (!records.length) return [];
  const lines = ['## Local Media', ''];
  for (const record of records) {
    if (record.status === 'downloaded' && record.localPath) {
      const rel = markdownRelativeLink(markdownPath, record.localPath);
      if (record.type === 'video') {
        lines.push(`[Local video file](${rel})`);
      } else {
        lines.push(`![${record.type || 'media'}](${rel})`);
      }
      lines.push('');
    } else {
      lines.push(`- Media not available offline: ${record.type || 'media'} (${record.status || 'unknown'}${record.error ? `, ${record.error}` : ''})`);
    }
  }
  lines.push('');
  return lines;
}

function renderContextSection(item) {
  const sections = [];
  const candidates = [
    ['Reply to', item.inReplyTo || item.in_reply_to || item.inReplyToStatus],
    ['Quoted content', item.quotedStatus || item.quoted_status || item.quote],
    ['Conversation context', item.context || item.conversation],
  ];
  for (const [label, value] of candidates) {
    if (!value) continue;
    sections.push(`## ${label}`, '');
    if (typeof value === 'string') {
      sections.push(value, '');
    } else {
      sections.push(markdownTextBlock(value), '');
      const author = authorHandle(value);
      if (author) sections.push(`- Author: @${author}`);
      if (dateOfItem(value)) sections.push(`- Time: ${dateOfItem(value)}`);
      if (value.url || value.link) sections.push(`- Source: ${value.url || value.link}`);
      sections.push('');
    }
  }
  const replies = Array.isArray(item.replies) ? item.replies : [];
  if (replies.length) {
    sections.push('## Captured Replies', '');
    for (const reply of replies) {
      sections.push(`### ${dateOfItem(reply) || 'undated'} ${authorHandle(reply) ? `@${authorHandle(reply)}` : ''}`.trim(), '');
      sections.push(markdownTextBlock(reply), '');
    }
  }
  return sections;
}

function yamlEscape(value) {
  return String(value ?? '').replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function yamlScalar(key, value) {
  if (typeof value === 'boolean') return `${key}: ${value}`;
  if (typeof value === 'number') return `${key}: ${value}`;
  return `${key}: "${yamlEscape(value)}"`;
}

function archiveTimeText(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().replace(/T/u, ' ').replace(/\.\d{3}Z$/u, '');
}

function renderYamlFrontMatter(item, kind, mediaRecords) {
  const records = mediaRecordsForItem(item, mediaRecords);
  const fields = [
    yamlScalar('type', kind),
    yamlScalar('author_handle', authorHandle(item) ? `@${authorHandle(item)}` : item.sourceAccount || ''),
    yamlScalar('author_name', item.author?.name || item.author?.displayName || item.sourceAccount || authorHandle(item) || ''),
    yamlScalar('x_id', contentId(item)),
    yamlScalar('created_at', archiveTimeText(dateOfItem(item) || createdAtText(item))),
    yamlScalar('timezone', 'UTC'),
    yamlScalar('source_url', item.url || item.link || ''),
    yamlScalar('archive_time', archiveTimeText()),
    yamlScalar('has_media', records.length > 0),
    yamlScalar('media_count', records.length),
    yamlScalar('archive_status', records.every((record) => record.status === 'downloaded') ? 'complete' : records.length ? 'download_failed' : 'complete'),
  ];
  return ['---', ...fields, '---', ''].join('\n');
}

function itemMetricValue(item, keys) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
    if (item.public_metrics?.[key] !== undefined && item.public_metrics?.[key] !== null) return item.public_metrics[key];
    if (item.metrics?.[key] !== undefined && item.metrics?.[key] !== null) return item.metrics[key];
  }
  return null;
}

function renderItemMarkdown(item, markdownPath, mediaRecords, kind) {
  const title = kind === 'article'
    ? (item.title || textOfItem(item).split(/\r?\n/u)[0]?.slice(0, 120) || 'Untitled article')
    : `Post ${dateOfItem(item) || item.id || ''}`.trim();
  const metrics = [
    ['Replies', itemMetricValue(item, ['reply_count', 'replyCount', 'replies'])],
    ['Reposts', itemMetricValue(item, ['retweet_count', 'retweetCount', 'reposts'])],
    ['Quotes', itemMetricValue(item, ['quote_count', 'quoteCount', 'quotes'])],
    ['Likes', itemMetricValue(item, ['favorite_count', 'like_count', 'likes'])],
    ['Views', itemMetricValue(item, ['view_count', 'views'])],
  ].filter(([, value]) => value !== null);
  const lines = [
    renderYamlFrontMatter(item, kind, mediaRecords),
    `# ${title}`,
    '',
    '## Metadata',
    '',
    `- Type: ${kind}`,
    `- Author: ${authorHandle(item) ? `@${authorHandle(item)}` : item.sourceAccount || 'unknown'}`,
    `- Published: ${dateOfItem(item) || createdAtText(item) || 'unknown'}`,
    `- Source bucket: ${item._bucketId || 'unknown'}`,
    `- Original captured URL: ${item.url || item.link || 'not captured'}`,
    '',
    '## Content',
    '',
    markdownTextBlock(item),
    '',
  ];
  if (metrics.length) {
    lines.push('## Interaction Metrics', '');
    for (const [label, value] of metrics) lines.push(`- ${label}: ${value}`);
    lines.push('');
  }
  lines.push(...renderContextSection(item));
  lines.push(...renderLocalMediaMarkdown(item, mediaRecords, markdownPath));
  return `${lines.join('\n').replace(/\n{4,}/gu, '\n\n\n')}\n`;
}

function accountDisplayName(account) {
  return account.displayName || account.name || account.fullName || account.userName || account.handle || account.username || account.screenName || account.id || '';
}

function accountHandle(account) {
  return account.handle || account.username || account.screenName || account.restId || account.id || '';
}

function accountDescription(account) {
  return account.description || account.bio || account.summary || account.profile || '';
}

function profileImageUrl(account) {
  return account.profileImageUrl
    || account.profile_image_url_https
    || account.profile_image_url
    || account.avatarUrl
    || account.avatar_url
    || account.avatar
    || account.image
    || account.legacy?.profile_image_url_https
    || account.raw?.profile_image_url_https
    || null;
}

function profileBannerUrl(account) {
  return account.profileBannerUrl
    || account.profile_banner_url
    || account.bannerUrl
    || account.banner_url
    || account.banner
    || account.coverImageUrl
    || account.cover_image_url
    || account.legacy?.profile_banner_url
    || account.raw?.profile_banner_url
    || null;
}

function accountUserId(account) {
  return account.id || account.restId || account.userId || account.user_id || account.id_str || '';
}

function xProfileUrl(handle, account = {}) {
  if (account.url || account.profileUrl || account.profile_url) {
    return account.url || account.profileUrl || account.profile_url;
  }
  return handle ? `https://x.com/${String(handle).replace(/^@/u, '')}` : '';
}

function accountStatusText(account) {
  return account.status || account.accountStatus || account.state || account.availability || 'normal';
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function archiveRelativePath(state, filePath) {
  if (!filePath) return '';
  return path.relative(state.layout.archiveDir, filePath).replace(/\\/gu, '/');
}

function firstPathStatus(record) {
  if (!record) return 'unavailable';
  return record.status || 'planned';
}

function profileMediaRecord(account, kind, url, state) {
  if (!url) return null;
  const handle = accountHandle(account) || account.id || account.restId || 'account';
  const key = createHash('sha256').update(`${kind}:${url}`).digest('hex');
  return {
    id: key,
    url,
    type: 'image',
    expectedType: 'image',
    contentType: null,
    sourceContentType: null,
    sourceItemId: accountUserId(account) || handle,
    sourceItemUrl: xProfileUrl(handle, account),
    sourceBucketId: 'following',
    pageUrl: xProfileUrl(handle, account),
    mediaIndex: kind === 'avatar' ? 0 : 1,
    localPath: path.join(state.layout.mediaDir, 'images', `${compactSlug(handle)}-${kind}-${key.slice(0, 12)}.jpg`),
    status: 'planned',
    ok: false,
    bytes: 0,
    error: null,
    source: `following-${kind}`,
  };
}

async function buildFollowingArchiveRows(accounts, state) {
  const sourceRows = accounts.filter((account) => account.bucketId === 'following' && account.source === 'relation');
  const downloadMedia = state.task.defaults?.downloadMedia === true;
  const rows = [];
  const mediaRecords = [];
  for (const account of sourceRows) {
    const handle = accountHandle(account);
    const avatar = profileMediaRecord(account, 'avatar', profileImageUrl(account), state);
    const banner = profileMediaRecord(account, 'banner', profileBannerUrl(account), state);
    const downloadedAvatar = avatar && downloadMedia ? await downloadMediaAsset(avatar) : avatar;
    const downloadedBanner = banner && downloadMedia ? await downloadMediaAsset(banner) : banner;
    if (downloadedAvatar) mediaRecords.push(downloadedAvatar);
    if (downloadedBanner) mediaRecords.push(downloadedBanner);
    const profileUrl = xProfileUrl(handle, account);
    rows.push({
      displayName: accountDisplayName(account),
      handle,
      userId: accountUserId(account),
      bio: accountDescription(account),
      profileUrl,
      avatarLocalPath: downloadedAvatar?.status === 'downloaded' ? archiveRelativePath(state, downloadedAvatar.localPath) : '',
      bannerLocalPath: downloadedBanner?.status === 'downloaded' ? archiveRelativePath(state, downloadedBanner.localPath) : '',
      avatarStatus: firstPathStatus(downloadedAvatar),
      bannerStatus: firstPathStatus(downloadedBanner),
      avatarSourceUrl: profileImageUrl(account) || '',
      bannerSourceUrl: profileBannerUrl(account) || '',
      followingSince: account.followingSince || account.followedAt || '',
      accountStatus: accountStatusText(account),
      note: 'captured-from-following',
      raw: account,
    });
  }
  return { rows, mediaRecords };
}

function renderFollowingMarkdown(rows, state) {
  const lines = [
    `# Following Archive for @${state.task.target.account || 'account'}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total following records: ${rows.length}`,
    '',
    '| Display name | Handle | User ID | Bio | Profile | Avatar local path | Banner local path | Account status | Media status | Note |',
    '| - | - | - | - | - | - | - | - | - | - |',
  ];
  for (const row of rows) {
    const mediaStatus = `avatar=${row.avatarStatus}; banner=${row.bannerStatus}`;
    lines.push(`| ${markdownEscape(row.displayName)} | ${markdownEscape(row.handle ? `@${row.handle}` : '')} | ${markdownEscape(row.userId)} | ${markdownEscape(row.bio)} | ${markdownEscape(row.profileUrl)} | ${markdownEscape(row.avatarLocalPath)} | ${markdownEscape(row.bannerLocalPath)} | ${markdownEscape(row.accountStatus)} | ${markdownEscape(mediaStatus)} | ${markdownEscape(row.note)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderFollowingCsv(rows) {
  const columns = ['displayName', 'handle', 'userId', 'bio', 'profileUrl', 'avatarLocalPath', 'bannerLocalPath', 'avatarStatus', 'bannerStatus', 'followingSince', 'accountStatus', 'note'];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n') + '\n';
}

function publicFollowingRows(rows) {
  return rows.map(({ raw: _raw, ...row }) => row);
}

function mergeMediaRecords(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const record of [...primary, ...secondary]) {
    if (!record) continue;
    const key = record.id || `${record.type}:${record.url}:${record.localPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(record);
  }
  return merged;
}

function mediaRecordCounts(records = []) {
  return {
    total: records.length,
    downloaded: records.filter((record) => record.status === 'downloaded').length,
    planned: records.filter((record) => record.status === 'planned' || record.status === 'pending').length,
    failed: records.filter((record) => record.status === 'failed').length,
    pending: records.filter((record) => record.status === 'pending').length,
    images: records.filter((record) => record.type === 'image').length,
    videos: records.filter((record) => record.type === 'video').length,
  };
}

function updateMediaArchiveRecords(mediaArchive, records) {
  if (!mediaArchive) return;
  const counts = mediaRecordCounts(records);
  mediaArchive.records = records;
  mediaArchive.summary = {
    ...(mediaArchive.summary || {}),
    counts,
    status: counts.failed > 0 ? 'partial' : counts.planned > 0 || counts.pending > 0 ? 'bounded' : 'complete',
    reason: counts.failed > 0 ? 'media-download-incomplete' : counts.planned > 0 || counts.pending > 0 ? 'media-download-limit-or-disabled' : null,
  };
}

function itemWithinTaskTimeRange(item, state) {
  const from = state.task.target?.from || null;
  const to = state.task.target?.to || null;
  if (!from && !to) return true;
  const dateText = dateOfItem(item);
  const time = Date.parse(dateText || '');
  if (!Number.isFinite(time)) return false;
  if (from && time < Date.parse(`${from}T00:00:00.000Z`)) return false;
  if (to && time >= Date.parse(`${to}T00:00:00.000Z`)) return false;
  return true;
}

function itemArchiveSummary(item, filePath, mediaRecords, state, indexPath = null) {
  const records = mediaRecordsForItem(item, mediaRecords);
  return {
    itemId: item.id || item.itemId || item.restId || null,
    xId: contentId(item),
    type: item._bucketId === 'articles-route' ? 'article' : 'post',
    author: authorHandle(item),
    sourceBucketId: item._bucketId || null,
    sourceUrl: item.url || item.link || null,
    filePath,
    localPath: archiveRelativePath(state, filePath),
    markdownLink: indexPath ? markdownRelativeLink(indexPath, filePath) : archiveRelativePath(state, filePath),
    publishedAt: dateOfItem(item),
    mediaCount: records.length,
    mediaLocalPaths: records
      .filter((record) => record.status === 'downloaded' && record.localPath)
      .map((record) => archiveRelativePath(state, record.localPath)),
    mediaStatuses: records.map((record) => record.status || 'unknown'),
    textPreview: textOfItem(item).slice(0, 180),
  };
}

function renderItemIndex(title, entries, indexPath) {
  const lines = [
    `# ${title}`,
    '',
    `Total records: ${entries.length}`,
    '',
    '| Published | Type | Author | Content ID | Summary | Markdown | Media | Source | Status |',
    '| - | - | - | - | - | - | - | - | - |',
  ];
  for (const entry of entries) {
    const status = entry.mediaStatuses.length
      ? [...new Set(entry.mediaStatuses)].join(';')
      : 'no-media';
    lines.push(`| ${markdownEscape(entry.publishedAt || '')} | ${markdownEscape(entry.type)} | ${markdownEscape(entry.author ? `@${entry.author}` : '')} | ${markdownEscape(entry.xId)} | ${markdownEscape(entry.textPreview)} | [md](${markdownRelativeLink(indexPath, entry.filePath)}) | ${markdownEscape(entry.mediaLocalPaths.join('<br>'))} | ${markdownEscape(entry.sourceUrl || '')} | ${markdownEscape(status)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderMediaIndex(records, state) {
  const lines = [
    '# Media Index',
    '',
    `Total media records: ${records.length}`,
    '',
    '| Type | Status | Local path | Source content ID | Bucket | Source URL | Error |',
    '| - | - | - | - | - | - | - |',
  ];
  for (const record of records) {
    lines.push(`| ${markdownEscape(record.type || '')} | ${markdownEscape(record.status || '')} | ${markdownEscape(archiveRelativePath(state, record.localPath))} | ${markdownEscape(record.sourceItemId || '')} | ${markdownEscape(record.sourceBucketId || '')} | ${markdownEscape(record.url || '')} | ${markdownEscape(record.error || '')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderArchiveIndex(state, manifest) {
  const indexPath = state.layout.archiveIndexPath;
  const lines = [
    `# Offline X Archive for @${state.task.target.account || 'account'}`,
    '',
    `Generated: ${manifest.generatedAt}`,
    `Offline complete: ${manifest.offlineComplete === true}`,
    '',
    '## Contents',
    '',
    `- [Posts index](${markdownRelativeLink(indexPath, state.layout.archivePostsIndexPath)})`,
    `- [Articles index](${markdownRelativeLink(indexPath, state.layout.archiveArticlesIndexPath)})`,
    `- [Media index](${markdownRelativeLink(indexPath, state.layout.archiveMediaIndexPath)})`,
    `- [Following](${markdownRelativeLink(indexPath, state.layout.archiveFollowingPath)})`,
    `- [Archive report](${markdownRelativeLink(indexPath, state.layout.archiveReportPath)})`,
    `- [Raw data](raw/)`,
    '',
    '## Counts',
    '',
    `- Posts: ${manifest.counts.posts}`,
    `- Articles: ${manifest.counts.articles}`,
    `- Following records: ${manifest.counts.following}`,
    `- Media downloaded: ${manifest.counts.mediaDownloaded}/${manifest.counts.mediaTotal}`,
    `- Validation status: ${manifest.validation.status}`,
    '',
  ];
  return lines.join('\n');
}

function renderArchiveReport(state, manifest, validation) {
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity !== 'error');
  const lines = [
    `# Archive Validation Report for @${state.task.target.account || 'account'}`,
    '',
    `- Generated: ${manifest.generatedAt}`,
    `- Validation status: ${validation.status}`,
    `- Offline complete: ${manifest.offlineComplete === true}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    `- Markdown files: ${manifest.counts.posts + manifest.counts.articles}`,
    `- Media downloaded: ${manifest.counts.mediaDownloaded}/${manifest.counts.mediaTotal}`,
    `- Following records: ${manifest.counts.following}`,
    '',
    '## Integrity Checks',
    '',
    ...validation.checks.map((check) => `- ${check.name}: ${check.ok ? 'ok' : 'failed'}${check.detail ? ` (${check.detail})` : ''}`),
    '',
    '## Issues',
    '',
    ...(validation.issues.length
      ? validation.issues.map((issue) => `- ${issue.severity}: ${issue.code}${issue.filePath ? ` ${archiveRelativePath(state, issue.filePath)}` : ''} - ${issue.message}`)
      : ['- No errors.']),
    '',
    '## Incremental Resume',
    '',
    `- Resumable: ${manifest.incremental.resumable}`,
    `- Previous archive time: ${manifest.incremental.previousArchiveTime || 'none'}`,
    `- Last archive time: ${manifest.incremental.lastArchiveTime}`,
    `- Retry failed downloads: ${manifest.incremental.retryFailedDownloads}`,
    `- Checksum validation: ${manifest.incremental.checksumValidation}`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderErrorsLog(validation, state) {
  if (!validation.issues.length) return 'No errors.\n';
  return validation.issues.map((issue) => {
    const file = issue.filePath ? ` file=${archiveRelativePath(state, issue.filePath)}` : '';
    return `${issue.severity.toUpperCase()} ${issue.code}${file} ${issue.message}`;
  }).join('\n') + '\n';
}

async function fileStatOrNull(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function localMarkdownRefsExist(markdownPath, text) {
  const issues = [];
  const refs = [...text.matchAll(/\]\(([^)]+)\)/gu)]
    .map((match) => String(match[1] || '').trim().replace(/^<|>$/gu, ''))
    .filter((target) => target && !/^(?:https?:|mailto:|#)/iu.test(target));
  for (const ref of refs) {
    const clean = ref.split(/\s+/u)[0];
    const target = path.resolve(path.dirname(markdownPath), clean);
    const stat = await fileStatOrNull(target);
    if (!stat || stat.size <= 0) {
      issues.push({ ref: clean, target });
    }
  }
  return issues;
}

async function validateOfflineArchive(state, { postEntries, articleEntries, followingRows, mediaRecords }) {
  const issues = [];
  const checks = [];
  const addIssue = (severity, code, message, filePath = null, detail = {}) => {
    issues.push({ severity, code, message, filePath, detail });
  };
  const markdownEntries = [...postEntries, ...articleEntries];
  const basenames = new Set();
  let markdownOk = true;
  for (const entry of markdownEntries) {
    const stat = await fileStatOrNull(entry.filePath);
    if (!stat || stat.size <= 0) {
      markdownOk = false;
      addIssue('error', 'missing_markdown', `Markdown file is missing or empty for ${entry.xId}`, entry.filePath);
      continue;
    }
    const basename = path.basename(entry.filePath);
    if (basenames.has(basename)) {
      markdownOk = false;
      addIssue('error', 'duplicate_markdown_name', `Duplicate markdown filename ${basename}`, entry.filePath);
    }
    basenames.add(basename);
    const text = await fs.readFile(entry.filePath, 'utf8');
    if (!text.startsWith('---\n')) {
      markdownOk = false;
      addIssue('error', 'missing_front_matter', `Markdown file lacks YAML front matter for ${entry.xId}`, entry.filePath);
    }
    if (/data:(?:image|video)/iu.test(text)) {
      markdownOk = false;
      addIssue('error', 'url_only_media_reference', `Markdown file contains embedded media data URL for ${entry.xId}`, entry.filePath);
    }
    const missingRefs = await localMarkdownRefsExist(entry.filePath, text);
    for (const missing of missingRefs) {
      markdownOk = false;
      addIssue('error', 'missing_local_media_ref', `Local Markdown media/link target is missing: ${missing.ref}`, entry.filePath, missing);
    }
  }
  checks.push({ name: 'markdown_files', ok: markdownOk, detail: `${markdownEntries.length} checked` });

  let mediaOk = true;
  for (const record of mediaRecords) {
    if (record.status !== 'downloaded') {
      mediaOk = false;
      addIssue('error', 'media_not_downloaded', `Media was not downloaded: ${record.status || 'unknown'}${record.error ? ` (${record.error})` : ''}`, record.localPath, {
        sourceUrl: record.url || null,
        sourceItemId: record.sourceItemId || null,
      });
      continue;
    }
    const stat = await fileStatOrNull(record.localPath);
    if (!stat || stat.size <= 0) {
      mediaOk = false;
      addIssue('error', 'missing_media_file', `Downloaded media file is missing or empty for ${record.sourceItemId || record.id}`, record.localPath);
    }
  }
  checks.push({ name: 'media_files', ok: mediaOk, detail: `${mediaRecords.length} checked` });

  let followingOk = true;
  for (const filePath of [state.layout.archiveFollowingPath, state.layout.archiveFollowingJsonPath, state.layout.archiveFollowingCsvPath]) {
    const stat = await fileStatOrNull(filePath);
    if (!stat || stat.size <= 0) {
      followingOk = false;
      addIssue('error', 'missing_following_artifact', 'Following artifact is missing or empty', filePath);
    }
  }
  for (const row of followingRows) {
    for (const kind of ['avatar', 'banner']) {
      const sourceKey = `${kind}SourceUrl`;
      const statusKey = `${kind}Status`;
      if (!row[sourceKey]) {
        addIssue('warning', `${kind}_unavailable`, `${kind} URL was not captured for @${row.handle || row.userId || 'unknown'}`, null, { handle: row.handle || null });
      } else if (row[statusKey] !== 'downloaded') {
        followingOk = false;
        addIssue('error', `${kind}_download_failed`, `${kind} was not downloaded for @${row.handle || row.userId || 'unknown'}: ${row[statusKey]}`, null, { handle: row.handle || null });
      }
    }
  }
  checks.push({ name: 'following_artifacts', ok: followingOk, detail: `${followingRows.length} rows` });

  for (const bucket of state.buckets || []) {
    if (bucket.status === 'failed' || bucket.status === 'waiting-cooldown') {
      addIssue('error', 'bucket_unavailable', `Bucket ${bucket.id} ended as ${bucket.status}`);
    } else if (bucket.status === 'captured-with-warning' || bucket.status === 'degraded-complete') {
      addIssue('warning', 'bucket_degraded', `Bucket ${bucket.id} ended as ${bucket.status}`);
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  return {
    status: errorCount ? 'failed' : issues.length ? 'passed-with-warnings' : 'passed',
    checks,
    issues,
  };
}

async function listFilesRecursive(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

async function buildChecksumManifest(state) {
  const archiveFiles = await listFilesRecursive(state.layout.archiveDir);
  const candidates = [...archiveFiles, state.layout.archiveManifestPath]
    .filter((filePath) => path.resolve(filePath) !== path.resolve(state.layout.archiveChecksumPath));
  const files = [];
  for (const filePath of candidates) {
    const stat = await fileStatOrNull(filePath);
    if (!stat || stat.size <= 0) continue;
    const buffer = await fs.readFile(filePath);
    files.push({
      relativePath: path.relative(state.layout.archiveDir, filePath).replace(/\\/gu, '/'),
      filePath,
      bytes: stat.size,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      mtime: stat.mtime.toISOString(),
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    root: state.layout.archiveDir,
    files,
  };
}

async function writeOfflineAccountArchive(state, evidence, mediaArchive) {
  if (state.task.id !== 'account-full-archive') {
    return null;
  }
  const previousArchive = await readJsonIfExists(state.layout.archiveManifestPath);
  const initialMediaRecords = mediaArchive?.records || [];
  await fs.mkdir(state.layout.archivePostsDir, { recursive: true });
  await fs.mkdir(state.layout.archiveArticlesDir, { recursive: true });
  await fs.mkdir(state.layout.mediaDir, { recursive: true });
  await fs.mkdir(state.layout.archiveRawDir, { recursive: true });
  const postBuckets = new Set(['posts', 'replies', 'media', 'highlights']);
  const candidatePostItems = evidence.dedupedItems
    .filter((item) => postBuckets.has(item._bucketId))
    .sort((a, b) => String(dateOfItem(a) || '').localeCompare(String(dateOfItem(b) || '')));
  const candidateArticleItems = evidence.dedupedItems
    .filter((item) => item._bucketId === 'articles-route')
    .sort((a, b) => String(dateOfItem(a) || '').localeCompare(String(dateOfItem(b) || '')));
  const postItems = candidatePostItems.filter((item) => itemWithinTaskTimeRange(item, state));
  const articleItems = candidateArticleItems.filter((item) => itemWithinTaskTimeRange(item, state));
  const rangeFilteredOut = {
    posts: candidatePostItems.length - postItems.length,
    articles: candidateArticleItems.length - articleItems.length,
  };
  const followingArchive = await buildFollowingArchiveRows(evidence.accounts, state);
  const followingRows = publicFollowingRows(followingArchive.rows);
  const allMediaRecords = mergeMediaRecords(initialMediaRecords, followingArchive.mediaRecords);
  updateMediaArchiveRecords(mediaArchive, allMediaRecords);
  const posts = [];
  const articles = [];
  for (const [index, item] of postItems.entries()) {
    const filePath = path.join(state.layout.archivePostsDir, archiveFileName(item, index));
    await fs.writeFile(filePath, renderItemMarkdown(item, filePath, allMediaRecords, 'post'), 'utf8');
    posts.push(itemArchiveSummary(item, filePath, allMediaRecords, state));
  }
  for (const [index, item] of articleItems.entries()) {
    const filePath = path.join(state.layout.archiveArticlesDir, archiveFileName(item, index));
    await fs.writeFile(filePath, renderItemMarkdown(item, filePath, allMediaRecords, 'article'), 'utf8');
    articles.push(itemArchiveSummary(item, filePath, allMediaRecords, state));
  }
  await fs.mkdir(path.dirname(state.layout.archiveFollowingPath), { recursive: true });
  await fs.writeFile(state.layout.archiveFollowingPath, renderFollowingMarkdown(followingRows, state), 'utf8');
  await writeJson(state.layout.archiveFollowingJsonPath, followingRows);
  await fs.writeFile(state.layout.archiveFollowingCsvPath, renderFollowingCsv(followingRows), 'utf8');
  await writeJsonl(state.layout.archiveRawPostsPath, postItems);
  await writeJsonl(state.layout.archiveRawArticlesPath, articleItems);
  await writeJson(state.layout.archiveRawFollowingPath, {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    rows: followingArchive.rows,
  });
  await writeJson(state.layout.archiveRawMediaManifestPath, {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    records: allMediaRecords,
  });
  await fs.writeFile(state.layout.archivePostsIndexPath, renderItemIndex('Posts Index', posts, state.layout.archivePostsIndexPath), 'utf8');
  await fs.writeFile(state.layout.archiveArticlesIndexPath, renderItemIndex('Articles Index', articles, state.layout.archiveArticlesIndexPath), 'utf8');
  await fs.writeFile(state.layout.archiveMediaIndexPath, renderMediaIndex(allMediaRecords, state), 'utf8');

  const validation = await validateOfflineArchive(state, {
    postEntries: posts,
    articleEntries: articles,
    followingRows,
    mediaRecords: allMediaRecords,
  });
  const mediaCounts = mediaArchive?.summary?.counts || mediaRecordCounts(allMediaRecords);
  const downloaded = mediaCounts.downloaded || 0;
  const total = mediaCounts.total || 0;
  const generatedAt = new Date().toISOString();
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    archiveDir: state.layout.archiveDir,
    postsDir: state.layout.archivePostsDir,
    articlesDir: state.layout.archiveArticlesDir,
    followingPath: state.layout.archiveFollowingPath,
    followingJsonPath: state.layout.archiveFollowingJsonPath,
    followingCsvPath: state.layout.archiveFollowingCsvPath,
    mediaDir: state.layout.mediaDir,
    rawDir: state.layout.archiveRawDir,
    indexPath: state.layout.archiveIndexPath,
    reportPath: state.layout.archiveReportPath,
    errorsPath: state.layout.archiveErrorsPath,
    checksumPath: state.layout.archiveChecksumPath,
    counts: {
      posts: posts.length,
      articles: articles.length,
      following: followingRows.length,
      mediaTotal: total,
      mediaDownloaded: downloaded,
      mediaMissing: Math.max(0, total - downloaded),
      rangeFilteredOutPosts: rangeFilteredOut.posts,
      rangeFilteredOutArticles: rangeFilteredOut.articles,
    },
    validation: {
      status: validation.status,
      errors: validation.issues.filter((issue) => issue.severity === 'error').length,
      warnings: validation.issues.filter((issue) => issue.severity !== 'error').length,
    },
    incremental: {
      resumable: true,
      previousArchiveTime: previousArchive?.generatedAt || null,
      lastArchiveTime: generatedAt,
      timeRange: {
        from: state.task.target?.from || null,
        to: state.task.target?.to || null,
      },
      skipExistingMedia: true,
      retryFailedDownloads: true,
      checksumValidation: true,
      corruptedChecksumAction: 'redownload-on-next-media-pass-when-previous-checksum-differs',
    },
    offlineComplete: validation.issues.every((issue) => issue.severity !== 'error'),
    posts,
    articles,
    following: followingRows,
    media: allMediaRecords,
  };
  await fs.writeFile(state.layout.archiveIndexPath, renderArchiveIndex(state, summary), 'utf8');
  await fs.writeFile(state.layout.archiveReportPath, renderArchiveReport(state, summary, validation), 'utf8');
  await fs.writeFile(state.layout.archiveErrorsPath, renderErrorsLog(validation, state), 'utf8');
  await writeJson(state.layout.archiveManifestPath, summary);
  await writeJson(state.layout.archiveRawManifestPath, summary);
  await writeJson(state.layout.archiveChecksumPath, await buildChecksumManifest(state));
  return summary;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function incrementMap(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function minDateText(values) {
  const sorted = values.filter(Boolean).sort();
  return sorted[0] || null;
}

function maxDateText(values) {
  const sorted = values.filter(Boolean).sort();
  return sorted[sorted.length - 1] || null;
}

function buildQualityAudit(state, evidence) {
  const rawByBucket = new Map();
  const dedupedByBucket = new Map();
  const itemKeysByBucket = new Map();
  const rawAccountsByBucket = new Map();
  const accountKeysByBucket = new Map();
  const datesByBucket = new Map();
  const urlCounts = new Map();
  let internalStatusUrls = 0;
  let missingText = 0;
  let missingTime = 0;
  for (const item of evidence.rawItems) {
    incrementMap(rawByBucket, item._bucketId);
    if (item._bucketId) {
      const keys = itemKeysByBucket.get(item._bucketId) || new Set();
      const key = itemKey(item);
      if (key) keys.add(key);
      itemKeysByBucket.set(item._bucketId, keys);
    }
    const date = dateOfItem(item);
    if (date) {
      const list = datesByBucket.get(item._bucketId) || [];
      list.push(date);
      datesByBucket.set(item._bucketId, list);
    }
    if (!textOfItem(item)) missingText += 1;
    if (!date) missingTime += 1;
    const url = item.url || item.link || null;
    if (url) {
      incrementMap(urlCounts, url);
      if (/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/status\//iu.test(String(url))) {
        internalStatusUrls += 1;
      }
    }
  }
  for (const [bucketId, keys] of itemKeysByBucket.entries()) {
    dedupedByBucket.set(bucketId, keys.size);
  }
  for (const account of evidence.accounts || []) {
    const bucketId = account.bucketId || 'unknown';
    incrementMap(rawAccountsByBucket, bucketId);
    const key = accountKey(account);
    if (key) {
      const keys = accountKeysByBucket.get(bucketId) || new Set();
      keys.add(key);
      accountKeysByBucket.set(bucketId, keys);
    }
  }
  const bucketCoverage = (state.buckets || []).map((bucket) => {
    const dates = datesByBucket.get(bucket.id) || [];
    return {
      id: bucket.id,
      status: bucket.status,
      rawItems: rawByBucket.get(bucket.id) || 0,
      dedupedItems: dedupedByBucket.get(bucket.id) || 0,
      rawAccounts: rawAccountsByBucket.get(bucket.id) || 0,
      dedupedAccounts: accountKeysByBucket.get(bucket.id)?.size || 0,
      noWaitFallback: bucket.noWaitFallback || null,
      firstItemAt: minDateText(dates),
      lastItemAt: maxDateText(dates),
    };
  });
  const duplicateUrlCount = [...urlCounts.values()].filter((count) => count > 1).length;
  const zeroEvidenceBuckets = bucketCoverage
    .filter((bucket) => bucket.dedupedItems === 0 && bucket.dedupedAccounts === 0)
    .map((bucket) => bucket.id);
  const severeDedupDrops = bucketCoverage
    .filter((bucket) => bucket.rawItems >= 20 && bucket.dedupedItems / bucket.rawItems < 0.25)
    .map((bucket) => ({
      id: bucket.id,
      rawItems: bucket.rawItems,
      dedupedItems: bucket.dedupedItems,
    }));
  const warnings = [];
  if (zeroEvidenceBuckets.length) {
    warnings.push(`zero-evidence-buckets:${zeroEvidenceBuckets.length}`);
  }
  if (severeDedupDrops.length) {
    warnings.push(`severe-dedup-drop:${severeDedupDrops.length}`);
  }
  if (internalStatusUrls) {
    warnings.push(`internal-status-urls:${internalStatusUrls}`);
  }
  if (duplicateUrlCount) {
    warnings.push(`duplicate-urls:${duplicateUrlCount}`);
  }
  if (missingText) {
    warnings.push(`missing-text:${missingText}`);
  }
  if (missingTime) {
    warnings.push(`missing-time:${missingTime}`);
  }
  const noWaitBuckets = bucketCoverage
    .filter((bucket) => bucket.noWaitFallback)
    .map((bucket) => ({
      id: bucket.id,
      source: bucket.noWaitFallback.source,
      items: bucket.noWaitFallback.items,
    }));
  if (noWaitBuckets.length) {
    warnings.push(`no-wait-degraded-buckets:${noWaitBuckets.length}`);
  }
  return {
    warnings,
    bucketCoverage,
    zeroEvidenceBuckets,
    severeDedupDrops,
    noWaitBuckets,
    counts: {
      duplicateUrls: duplicateUrlCount,
      internalStatusUrls,
      missingText,
      missingTime,
    },
  };
}

function coverageForBucket(quality, id) {
  return (quality.bucketCoverage || []).find((bucket) => bucket.id === id) || null;
}

function bucketUniqueCount(quality, id) {
  const coverage = coverageForBucket(quality, id);
  return coverage?.dedupedItems || coverage?.dedupedAccounts || 0;
}

function clampRatio(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function completenessGrade(score) {
  if (score >= 85) return 'strong';
  if (score >= 65) return 'usable';
  if (score >= 40) return 'weak';
  return 'insufficient';
}

function taskItemTarget(taskId) {
  return ({
    'account-full-archive': 500,
    'keyword-trend': 120,
    'account-composite-profile': 120,
    'industry-report': 100,
    'event-timeline': 60,
    'similar-account-discovery': 120,
  })[taskId] || 100;
}

function weightedCompleteness(dimensions) {
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0) || 1;
  const score = dimensions.reduce((sum, dimension) => sum + clampRatio(dimension.score) * dimension.weight, 0) / totalWeight;
  return Math.round(score * 100);
}

function buildEvidenceCompleteness(state, evidence, quality, analysis) {
  const totalBuckets = Math.max(1, state.buckets.length);
  const coveredBuckets = (quality.bucketCoverage || []).filter((bucket) => bucket.dedupedItems > 0).length;
  const noWaitBuckets = (quality.noWaitBuckets || []).length;
  const itemTarget = taskItemTarget(state.task.id);
  const dimensions = [
    {
      id: 'bucket-coverage',
      label: 'Bucket coverage',
      score: coveredBuckets / totalBuckets,
      weight: 3,
      observed: coveredBuckets,
      target: totalBuckets,
    },
    {
      id: 'item-volume',
      label: 'Deduped item volume',
      score: evidence.dedupedItems.length / itemTarget,
      weight: 3,
      observed: evidence.dedupedItems.length,
      target: itemTarget,
    },
    {
      id: 'no-wait-cleanliness',
      label: 'Live coverage cleanliness',
      score: 1 - (noWaitBuckets / totalBuckets),
      weight: 2,
      observed: totalBuckets - noWaitBuckets,
      target: totalBuckets,
    },
  ];

  if (SEARCH_TASKS.has(state.task.id)) {
    const datedBuckets = (quality.bucketCoverage || []).filter((bucket) => bucket.firstItemAt || bucket.lastItemAt).length;
    dimensions.push({
      id: 'time-coverage',
      label: 'Time-bucket evidence coverage',
      score: datedBuckets / totalBuckets,
      weight: 2,
      observed: datedBuckets,
      target: totalBuckets,
    });
  }

  if (state.task.id === 'account-full-archive' || state.task.id === 'account-composite-profile' || state.task.id === 'similar-account-discovery') {
    const relationBucketIds = state.task.id === 'account-full-archive'
      ? ['following']
      : state.task.id === 'similar-account-discovery'
        ? ['seed-following', 'seed-followers']
        : ['following', 'followers'];
    const relationCovered = relationBucketIds.filter((id) => bucketUniqueCount(quality, id) > 0).length;
    dimensions.push({
      id: 'relation-coverage',
      label: 'Relation graph coverage',
      score: relationCovered / relationBucketIds.length,
      weight: 2,
      observed: relationCovered,
      target: relationBucketIds.length,
    });
  }

  if (state.task.id === 'account-full-archive' || state.task.id === 'account-composite-profile') {
    const mediaRows = bucketUniqueCount(quality, 'media');
    const mediaTypes = analysis.mediaTypes?.length || 0;
    dimensions.push({
      id: 'media-coverage',
      label: 'Media evidence coverage',
      score: mediaRows > 0 || mediaTypes > 0 ? 1 : 0,
      weight: 1,
      observed: mediaRows,
      target: 1,
    });
  }

  const score = weightedCompleteness(dimensions);
  return {
    score,
    grade: completenessGrade(score),
    dimensions: dimensions.map((dimension) => ({
      ...dimension,
      score: Math.round(clampRatio(dimension.score) * 100),
    })),
    thresholds: {
      strong: 85,
      usable: 65,
      weak: 40,
    },
  };
}

function taskVerificationStatus({ noStallOk, degraded, weakEvidence, blockingIssues }) {
  if (!noStallOk || blockingIssues.length) return 'not-verified';
  if (degraded) return 'degraded-complete';
  if (weakEvidence) return 'usable-with-limitations';
  return 'verified';
}

function buildTaskVerification(state, evidence, quality, analysis, evidenceCompleteness) {
  const limitations = [];
  const strengths = [];
  const nextEvidenceActions = [];
  const noStallOk = (state.buckets || []).every((bucket) => bucketComplete(bucket.status));
  let degraded = (quality.noWaitBuckets || []).length > 0;
  let weakEvidence = false;
  const blockingIssues = [];

  if (!noStallOk) {
    blockingIssues.push('one-or-more-buckets-not-terminal');
  }
  if (quality.zeroEvidenceBuckets.length) {
    weakEvidence = true;
    limitations.push(`zero evidence buckets: ${quality.zeroEvidenceBuckets.join(', ')}`);
  }
  if (quality.noWaitBuckets.length) {
    limitations.push(`no-wait degraded buckets: ${quality.noWaitBuckets.map((bucket) => `${bucket.id}:${bucket.source}:${bucket.items}`).join(', ')}`);
  }
  if (quality.severeDedupDrops.length) {
    weakEvidence = true;
    limitations.push(`severe raw-to-dedup drops: ${quality.severeDedupDrops.map((bucket) => `${bucket.id} ${bucket.rawItems}->${bucket.dedupedItems}`).join(', ')}`);
  }
  if (evidenceCompleteness.grade !== 'strong') {
    weakEvidence = true;
    limitations.push(`evidence completeness is ${evidenceCompleteness.grade} (${evidenceCompleteness.score}/100)`);
    nextEvidenceActions.push('prioritize lowest-scoring evidence completeness dimensions before making strong conclusions');
  } else {
    strengths.push(`evidence completeness is strong (${evidenceCompleteness.score}/100)`);
  }

  switch (state.task.id) {
    case 'account-full-archive': {
      const contentCount = ['posts', 'replies', 'media', 'articles-route']
        .reduce((sum, id) => sum + bucketUniqueCount(quality, id), 0);
      const followingCount = bucketUniqueCount(quality, 'following');
      if (contentCount > 0) strengths.push(`archived ${contentCount} unique content/media/article rows`);
      if (followingCount > 0) strengths.push(`archived ${followingCount} following relation rows`);
      if (bucketUniqueCount(quality, 'posts') === 0) {
        weakEvidence = true;
        limitations.push('posts bucket has zero direct post rows');
        nextEvidenceActions.push('use media/articles/replies as current evidence and schedule non-search profile-content backfill for posts if a distinct route is available');
      }
      if (followingCount === 0) {
        weakEvidence = true;
        limitations.push('following bucket has zero relation rows');
        nextEvidenceActions.push('resume the following bucket before claiming the account archive includes a complete local following list');
      }
      if (quality.counts.internalStatusUrls > 0) {
        limitations.push('internal /i/status URLs were mapped to source account for author statistics');
      }
      break;
    }
    case 'keyword-trend': {
      const coveredBuckets = (quality.bucketCoverage || []).filter((bucket) => bucket.dedupedItems > 0).length;
      strengths.push(`${coveredBuckets}/${state.buckets.length} trend buckets have evidence`);
      if (coveredBuckets < state.buckets.length) {
        weakEvidence = true;
        nextEvidenceActions.push('refill empty subject/language/time buckets from local cache or alternate surfaces before making strong trend claims');
      }
      break;
    }
    case 'account-composite-profile': {
      const contentCount = ['posts', 'replies', 'media'].reduce((sum, id) => sum + bucketUniqueCount(quality, id), 0);
      const relationCount = ['following', 'followers'].reduce((sum, id) => sum + bucketUniqueCount(quality, id), 0);
      strengths.push(`content evidence rows=${contentCount}; relation evidence rows=${relationCount}`);
      if (contentCount < 10) {
        weakEvidence = true;
        limitations.push('published-content profile is thin; relation/likes evidence is stronger than content evidence');
        nextEvidenceActions.push('prefer relation and likes conclusions; run distinct content backfill when available');
      }
      break;
    }
    case 'industry-report': {
      if (quality.noWaitBuckets.length) {
        degraded = true;
        limitations.push('weekly/monthly report includes local-cache no-wait supplements, so treat it as directional rather than a clean live period scan');
      }
      const periodRows = analysis.periodComparison || [];
      strengths.push(`period buckets summarized=${periodRows.length}`);
      break;
    }
    case 'event-timeline': {
      if (quality.noWaitBuckets.length) {
        degraded = true;
        limitations.push('timeline includes partial/local-cache buckets after same-surface search was blocked');
      }
      if ((analysis.earliestEvidence || []).length) {
        strengths.push(`earliest evidence starts at ${analysis.earliestEvidence[0].createdAt}`);
      }
      break;
    }
    case 'similar-account-discovery': {
      const candidateCount = (analysis.candidateAccounts || []).length;
      if (candidateCount) strengths.push(`ranked candidate accounts=${candidateCount}`);
      if (bucketUniqueCount(quality, 'seed-posts') === 0) {
        weakEvidence = true;
        limitations.push('seed-posts bucket has zero evidence; similarity relies more on candidate search and relations than seed content style');
        nextEvidenceActions.push('collect seed content through a distinct profile route before making strong content-style similarity claims');
      }
      break;
    }
    default:
      break;
  }

  return {
    status: taskVerificationStatus({ noStallOk, degraded, weakEvidence, blockingIssues }),
    noStallOk,
    strengths,
    limitations,
    nextEvidenceActions,
    blockingIssues,
  };
}

function buildSummary(state, evidence, mediaArchive = null, offlineArchive = null) {
  const bucketCounts = {
    total: state.buckets.length,
    completed: state.buckets.filter((bucket) => bucket.status === 'completed').length,
    capturedWithWarning: state.buckets.filter((bucket) => bucket.status === 'captured-with-warning').length,
    completedFromCache: state.buckets.filter((bucket) => bucket.status === 'completed-from-cache').length,
    degradedComplete: state.buckets.filter((bucket) => bucket.status === 'degraded-complete').length,
    waitingCooldown: state.buckets.filter((bucket) => bucket.status === 'waiting-cooldown').length,
    failed: state.buckets.filter((bucket) => bucket.status === 'failed').length,
    pending: state.buckets.filter((bucket) => bucket.status === 'pending').length,
  };
  const terminalComplete = bucketCounts.completed
    + bucketCounts.capturedWithWarning
    + bucketCounts.completedFromCache
    + bucketCounts.degradedComplete;
  const allSettled = terminalComplete + bucketCounts.failed === bucketCounts.total;
  const status = bucketCounts.failed > 0
    ? 'failed'
    : bucketCounts.pending > 0 || bucketCounts.waitingCooldown > 0
        ? 'partial'
        : allSettled
          ? 'complete'
          : 'partial';
  const quality = buildQualityAudit(state, evidence);
  const analysis = buildTaskAnalysis(state, evidence);
  const evidenceCompleteness = buildEvidenceCompleteness(state, evidence, quality, analysis);
  const verification = buildTaskVerification(state, evidence, quality, analysis, evidenceCompleteness);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    task: state.task,
    status,
    ok: bucketCounts.failed === 0 && bucketCounts.waitingCooldown === 0,
    complete: status === 'complete',
    noStallPolicySatisfied: bucketCounts.failed === 0 && bucketCounts.waitingCooldown === 0,
    bucketCounts,
    evidenceCounts: {
      rawItems: evidence.rawItems.length,
      dedupedItems: evidence.dedupedItems.length,
      accounts: evidence.accounts.length,
    },
    quality,
    evidenceCompleteness,
    mediaArchive: mediaArchive?.summary || null,
    offlineArchive: offlineArchive || null,
    verification,
    analysis,
    waitingCooldownBuckets: state.buckets
      .filter((bucket) => bucket.status === 'waiting-cooldown')
      .map((bucket) => ({
        id: bucket.id,
        surfaceKey: bucket.surfaceKey,
        reason: bucket.result?.outcome?.reason || bucket.fallback?.result?.outcome?.reason || bucket.result?.runtimeRisk?.stopReason || null,
      })),
    failedBuckets: state.buckets
      .filter((bucket) => bucket.status === 'failed')
      .map((bucket) => ({
        id: bucket.id,
        surfaceKey: bucket.surfaceKey,
        error: bucket.error || null,
      })),
    artifacts: state.artifacts,
  };
}

function textOfItem(item) {
  return String(item.text || item.fullText || item.content || item.title || '').trim();
}

function createdAtText(item) {
  return item.createdAt || item.created_at || item.timestamp || item.datetime || null;
}

function topCounts(values, limit = 20) {
  const counts = new Map();
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function tokenizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, ' ')
    .split(/[^\p{L}\p{N}_#@.+-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => ![
      'the',
      'and',
      'for',
      'with',
      'from',
      'this',
      'that',
      'are',
      'was',
      'you',
      'your',
      'http',
      'https',
      'com',
      'www',
      'is',
      'to',
      'of',
      'in',
      'on',
      'or',
      'a',
      'an',
    ].includes(token));
}

function monthOfItem(item) {
  const dateText = createdAtText(item);
  const date = dateText ? new Date(dateText) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

function dateOfItem(item) {
  const dateText = createdAtText(item);
  const date = dateText ? new Date(dateText) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function mediaTypeValues(items) {
  const values = [];
  for (const item of items) {
    const media = Array.isArray(item.media) ? item.media : [];
    for (const entry of media) {
      values.push(entry.type || entry.mediaType || 'media');
    }
  }
  return values;
}

const SENTIMENT_TERMS = Object.freeze({
  positive: ['love', 'great', 'good', 'amazing', 'useful', 'fast', 'smooth', 'recommend', 'impressive', 'bullish', '增长', '利好', '看好', '好用', '推荐'],
  negative: ['hate', 'bad', 'slow', 'broken', 'bug', 'issue', 'problem', 'risk', 'bearish', 'down', 'lawsuit', 'fail', '糟糕', '风险', '看空', '失败', '问题'],
});

const INVESTMENT_SIGNAL_TERMS = Object.freeze({
  adoption: ['adopt', 'users', 'customer', 'usage', 'growth', 'demand', 'traction', '用户', '采用', '增长', '需求'],
  product: ['launch', 'release', 'feature', 'roadmap', 'benchmark', 'performance', '发布', '功能', '性能', '产品'],
  competition: ['competitor', 'vs', 'alternative', 'switch', 'market share', 'rival', '竞品', '替代', '市场份额'],
  risk: ['risk', 'regulation', 'lawsuit', 'ban', 'outage', 'security', 'privacy', '监管', '诉讼', '安全', '隐私', '宕机'],
  monetization: ['price', 'pricing', 'revenue', 'subscription', 'paid', 'margin', '定价', '收入', '订阅', '付费'],
});

function countTermHits(text, terms) {
  const lower = String(text || '').toLowerCase();
  return terms.reduce((count, term) => count + (lower.includes(String(term).toLowerCase()) ? 1 : 0), 0);
}

function sentimentForText(text) {
  const positive = countTermHits(text, SENTIMENT_TERMS.positive);
  const negative = countTermHits(text, SENTIMENT_TERMS.negative);
  if (positive > negative) return 'positive';
  if (negative > positive) return 'negative';
  if (positive && negative) return 'mixed';
  return 'neutral';
}

function sentimentSummary(items) {
  const counts = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  for (const item of items) {
    counts[sentimentForText(textOfItem(item))] += 1;
  }
  return counts;
}

function domainFromUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.hostname.replace(/^www\./u, '').toLowerCase();
  } catch {
    return null;
  }
}

function itemUrls(item) {
  const urls = [];
  for (const key of ['url', 'link', 'expandedUrl', 'sourceUrl']) {
    if (item[key]) urls.push(item[key]);
  }
  for (const media of mediaEntriesForItem(item)) {
    urls.push(...mediaUrlCandidates(media));
  }
  return urls;
}

function linkDomainCounts(items) {
  return topCounts(items.flatMap(itemUrls).map(domainFromUrl).filter(Boolean), 30);
}

function themeSummary(items) {
  const terms = topCounts(items.flatMap((item) => tokenizeText(textOfItem(item))), 50);
  const authors = topCounts(items.map(authorHandle).filter(Boolean), 30);
  return {
    topTerms: terms,
    topAuthors: authors,
    topDomains: linkDomainCounts(items),
  };
}

function investmentSignals(items) {
  return Object.fromEntries(Object.entries(INVESTMENT_SIGNAL_TERMS).map(([signal, terms]) => {
    const matched = items
      .filter((item) => countTermHits(textOfItem(item), terms) > 0)
      .slice(0, 10)
      .map((item) => ({
        url: item.url || item.link || null,
        author: authorHandle(item),
        createdAt: dateOfItem(item),
        text: textOfItem(item).slice(0, 240),
      }));
    return [signal, {
      count: items.filter((item) => countTermHits(textOfItem(item), terms) > 0).length,
      examples: matched,
    }];
  }));
}

function representativeItems(items, limit = 12) {
  return items
    .map((item) => {
      const text = textOfItem(item);
      const termCount = tokenizeText(text).length;
      const hasUrl = Boolean(item.url || item.link);
      const hasDate = Boolean(dateOfItem(item));
      const hasAuthor = Boolean(authorHandle(item));
      return {
        score: termCount + (hasUrl ? 3 : 0) + (hasDate ? 2 : 0) + (hasAuthor ? 1 : 0),
        url: item.url || item.link || null,
        author: authorHandle(item),
        createdAt: dateOfItem(item),
        sentiment: sentimentForText(text),
        text: text.slice(0, 280),
      };
    })
    .filter((item) => item.text)
    .sort((a, b) => b.score - a.score || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .slice(0, limit)
    .map(({ score: _score, ...item }) => item);
}

function earliestItems(items, limit = 20) {
  return items
    .map((item) => ({
      id: item.id || null,
      url: item.url || item.link || null,
      author: authorHandle(item),
      createdAt: dateOfItem(item),
      text: textOfItem(item).slice(0, 280),
    }))
    .filter((item) => item.createdAt)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);
}

function bucketStatusMap(state) {
  return Object.fromEntries((state.buckets || []).map((bucket) => [bucket.id, {
    status: bucket.status,
    surfaceKey: bucket.surfaceKey,
    itemCount: bucket.result?.counts?.items || bucket.fallback?.result?.counts?.items || 0,
    userCount: bucket.result?.counts?.users || bucket.fallback?.result?.counts?.users || 0,
    mediaCount: bucket.result?.counts?.media || bucket.fallback?.result?.counts?.media || 0,
  }]));
}

function buildTaskAnalysis(state, evidence) {
  const items = evidence.dedupedItems;
  const texts = items.map(textOfItem).filter(Boolean);
  const authors = items.map(authorHandle).filter(Boolean);
  const base = {
    topTerms: topCounts(texts.flatMap(tokenizeText), 25),
    topAuthors: topCounts(authors, 20),
    monthCounts: topCounts(items.map(monthOfItem).filter(Boolean), 24),
    mediaTypes: topCounts(mediaTypeValues(items), 10),
    sentiment: sentimentSummary(items),
    themes: themeSummary(items),
    linkDomains: linkDomainCounts(items),
    representativeItems: representativeItems(items, 12),
    investmentSignals: investmentSignals(items),
    bucketStatus: bucketStatusMap(state),
  };
  switch (state.task.id) {
    case 'account-full-archive':
      return {
        ...base,
        archiveCoverage: archiveCoverage(state),
      };
    case 'account-composite-profile':
      return {
        ...base,
        profileSignals: {
          contentBuckets: ['posts', 'replies', 'media'].map((id) => base.bucketStatus[id]).filter(Boolean),
          relationBuckets: ['following', 'followers'].map((id) => base.bucketStatus[id]).filter(Boolean),
          publicLikesStatus: base.bucketStatus['profile-likes-route']?.status || null,
        },
      };
    case 'keyword-trend':
      return {
        ...base,
        directionalTrend: directionalTrend(state, items),
      };
    case 'industry-report':
      return {
        ...base,
        periodComparison: periodComparison(state),
      };
    case 'event-timeline':
      return {
        ...base,
        earliestEvidence: earliestItems(items, 30),
      };
    case 'similar-account-discovery':
      return {
        ...base,
        candidateAccounts: similarAccountCandidates(state, evidence),
      };
    default:
      return base;
  }
}

function archiveCoverage(state) {
  const wanted = ['account-info', 'posts', 'replies', 'media', 'following', 'highlights', 'articles-route'];
  return wanted.map((id) => {
    const bucket = (state.buckets || []).find((entry) => entry.id === id);
    return {
      id,
      status: bucket?.status || 'missing',
      itemCount: bucket?.result?.counts?.items || bucket?.fallback?.result?.counts?.items || 0,
      userCount: bucket?.result?.counts?.users || bucket?.fallback?.result?.counts?.users || 0,
      mediaCount: bucket?.result?.counts?.media || bucket?.fallback?.result?.counts?.media || 0,
    };
  });
}

function directionalTrend(state, items) {
  const rows = [];
  for (const bucket of state.buckets || []) {
    rows.push({
      bucketId: bucket.id,
      status: bucket.status,
      query: bucket.query,
      itemCount: items.filter((item) => item._bucketId === bucket.id).length,
    });
  }
  return rows;
}

function periodComparison(state) {
  return (state.buckets || []).map((bucket) => ({
    bucketId: bucket.id,
    status: bucket.status,
    query: bucket.query,
    itemCount: bucket.result?.counts?.items || bucket.fallback?.result?.counts?.items || 0,
  }));
}

function similarAccountCandidates(state, evidence) {
  const seed = String(state.task.target.account || '').toLowerCase();
  const seedContentItems = (evidence.rawItems || []).filter((item) => /^seed-(?:posts|replies|media)/u.test(item._bucketId || ''));
  const seedTerms = new Set(seedContentItems.flatMap((item) => tokenizeText(textOfItem(item))).slice(0, 200));
  const seedDomains = new Set(seedContentItems.flatMap(itemUrls).map(domainFromUrl).filter(Boolean));
  const seedAvgLength = seedContentItems.length
    ? seedContentItems.reduce((sum, item) => sum + textOfItem(item).length, 0) / seedContentItems.length
    : 0;
  const candidates = new Map();
  const ensure = (handle) => {
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/u.test(handle) || handle.toLowerCase() === seed) {
      return null;
    }
    if (!candidates.has(handle)) {
      candidates.set(handle, {
        handle,
        score: 0,
        appearances: 0,
        relationHits: 0,
        searchHits: 0,
        buckets: new Set(),
        sources: new Set(),
        sampleUrls: [],
        terms: new Set(),
        domains: new Set(),
        textLengths: [],
      });
    }
    return candidates.get(handle);
  };
  for (const item of evidence.rawItems || []) {
    const candidate = ensure(authorHandle(item));
    if (!candidate) continue;
    const bucketId = item._bucketId || 'unknown';
    candidate.appearances += 1;
    candidate.buckets.add(bucketId);
    candidate.sources.add(bucketId.startsWith('candidate-search') ? 'candidate-search' : 'seed-content');
    candidate.score += bucketId.startsWith('candidate-search') ? 3 : 1;
    if (bucketId.startsWith('candidate-search')) candidate.searchHits += 1;
    for (const term of tokenizeText(textOfItem(item))) candidate.terms.add(term);
    for (const domain of itemUrls(item).map(domainFromUrl).filter(Boolean)) candidate.domains.add(domain);
    if (textOfItem(item)) candidate.textLengths.push(textOfItem(item).length);
    const sampleUrl = item.url || item.link || null;
    if (candidate.sampleUrls.length < 3 && sampleUrl && !candidate.sampleUrls.includes(sampleUrl)) {
      candidate.sampleUrls.push(sampleUrl);
    }
  }
  for (const account of evidence.accounts || []) {
    const candidate = ensure(account.handle || account.username || account.screenName || null);
    if (!candidate) continue;
    const bucketId = account.bucketId || 'unknown';
    candidate.buckets.add(bucketId);
    if (account.source === 'relation' || /^seed-(?:following|followers)/u.test(bucketId)) {
      candidate.relationHits += 1;
      candidate.sources.add('seed-relation');
      candidate.score += 2;
    }
  }
  return [...candidates.values()]
    .map((candidate) => {
      const termOverlap = [...candidate.terms].filter((term) => seedTerms.has(term)).length;
      const domainOverlap = [...candidate.domains].filter((domain) => seedDomains.has(domain)).length;
      const avgLength = candidate.textLengths.length
        ? candidate.textLengths.reduce((sum, length) => sum + length, 0) / candidate.textLengths.length
        : 0;
      const styleSimilarity = seedAvgLength && avgLength
        ? clampRatio(1 - Math.abs(seedAvgLength - avgLength) / Math.max(seedAvgLength, avgLength))
        : 0;
      candidate.score += candidate.buckets.size
        + candidate.sources.size
        + termOverlap * 2
        + domainOverlap * 3
        + Math.round(styleSimilarity * 5);
      const sources = [...candidate.sources].sort();
      const buckets = [...candidate.buckets].sort();
      const evidenceSourceCount = sources.length + (candidate.relationHits > 0 ? 1 : 0) + (candidate.searchHits > 0 ? 1 : 0);
      const confidence = evidenceSourceCount >= 4 && (termOverlap > 0 || domainOverlap > 0)
        ? 'high'
        : evidenceSourceCount >= 2
          ? 'medium'
          : 'low';
      const priority = candidate.score >= 20 && confidence !== 'low'
        ? 'high'
        : candidate.score >= 10
          ? 'medium'
          : 'low';
      return {
        handle: candidate.handle,
        score: candidate.score,
        priority,
        confidence,
        appearances: candidate.appearances,
        relationHits: candidate.relationHits,
        searchHits: candidate.searchHits,
        bucketCount: candidate.buckets.size,
        similarity: {
          contentTermOverlap: termOverlap,
          domainOverlap,
          styleSimilarity: Math.round(styleSimilarity * 100),
          evidenceSources: sources,
          buckets,
        },
        reason: `priority=${priority}; confidence=${confidence}; sources=${sources.join('+') || 'unknown'}; termOverlap=${termOverlap}; domainOverlap=${domainOverlap}`,
        sampleUrls: candidate.sampleUrls,
      };
    })
    .sort((a, b) => b.score - a.score
      || b.similarity.contentTermOverlap - a.similarity.contentTermOverlap
      || b.searchHits - a.searchHits
      || b.relationHits - a.relationHits
      || a.handle.localeCompare(b.handle))
    .slice(0, 50);
}

function renderReport(summary, state) {
  const topTerms = summary.analysis?.topTerms?.slice(0, 10)
    .map((entry) => `${entry.value}(${entry.count})`)
    .join(', ') || 'none';
  const topAuthors = summary.analysis?.topAuthors?.slice(0, 10)
    .map((entry) => `${entry.value}(${entry.count})`)
    .join(', ') || 'none';
  const qualityWarnings = summary.quality?.warnings?.length
    ? summary.quality.warnings.join(', ')
    : 'none';
  const sentiment = summary.analysis?.sentiment || {};
  const topDomains = summary.analysis?.linkDomains?.slice(0, 8)
    .map((entry) => `${entry.value}(${entry.count})`)
    .join(', ') || 'none';
  const investmentLines = Object.entries(summary.analysis?.investmentSignals || {}).map(([signal, value]) => (
    `- ${signal}: ${value.count || 0}`
  ));
  const coverageLines = (summary.quality?.bucketCoverage || []).map((bucket) => (
    `- ${bucket.id}: raw=${bucket.rawItems}, deduped=${bucket.dedupedItems}, accounts=${bucket.dedupedAccounts || 0}, first=${bucket.firstItemAt || 'n/a'}, last=${bucket.lastItemAt || 'n/a'}${bucket.noWaitFallback ? `, noWait=${bucket.noWaitFallback.source}:${bucket.noWaitFallback.items}` : ''}`
  ));
  const completeness = summary.evidenceCompleteness || {};
  const completenessLines = (completeness.dimensions || []).map((dimension) => (
    `- ${dimension.id}: score=${dimension.score}/100, observed=${dimension.observed}, target=${dimension.target}, weight=${dimension.weight}`
  ));
  const mediaArchive = summary.mediaArchive || {};
  const mediaCounts = mediaArchive.counts || {};
  const offlineArchive = summary.offlineArchive || {};
  const offlineCounts = offlineArchive.counts || {};
  const verification = summary.verification || {};
  const verificationStrengths = verification.strengths?.length
    ? verification.strengths.map((item) => `- ${item}`)
    : ['- none recorded'];
  const verificationLimitations = verification.limitations?.length
    ? verification.limitations.map((item) => `- ${item}`)
    : ['- none recorded'];
  const verificationActions = verification.nextEvidenceActions?.length
    ? verification.nextEvidenceActions.map((item) => `- ${item}`)
    : ['- none required for the current evidence level'];
  const verificationBlocks = verification.blockingIssues?.length
    ? verification.blockingIssues.map((item) => `- ${item}`)
    : ['- none'];
  const lines = [
    `# ${summary.task.label}`,
    '',
    `- Task: ${summary.task.id}`,
    `- Status: ${summary.status}`,
    `- Complete: ${summary.complete}`,
    `- No-stall policy satisfied: ${summary.noStallPolicySatisfied}`,
    `- Verification status: ${verification.status || 'not-recorded'}`,
    `- Evidence completeness: ${completeness.score ?? 'n/a'}/100 (${completeness.grade || 'not-recorded'})`,
    `- Media archive: total=${mediaCounts.total ?? 0}, images=${mediaCounts.images ?? 0}, videos=${mediaCounts.videos ?? 0}, downloaded=${mediaCounts.downloaded ?? 0}, planned=${mediaCounts.planned ?? 0}, failed=${mediaCounts.failed ?? 0}`,
    `- Offline account archive: posts=${offlineCounts.posts ?? 0}, articles=${offlineCounts.articles ?? 0}, following=${offlineCounts.following ?? 0}, offlineComplete=${offlineArchive.offlineComplete === true}`,
    `- Buckets: ${summary.bucketCounts.completed}/${summary.bucketCounts.total} completed, ${summary.bucketCounts.capturedWithWarning} captured with warning, ${summary.bucketCounts.waitingCooldown} unresolved cooldown, ${summary.bucketCounts.failed} failed, ${summary.bucketCounts.pending} pending`,
    `- Evidence: raw items ${summary.evidenceCounts.rawItems}, deduped items ${summary.evidenceCounts.dedupedItems}, accounts ${summary.evidenceCounts.accounts}`,
    `- Quality warnings: ${qualityWarnings}`,
    `- Top terms: ${topTerms}`,
    `- Top authors: ${topAuthors}`,
    `- Sentiment: positive=${sentiment.positive ?? 0}, negative=${sentiment.negative ?? 0}, mixed=${sentiment.mixed ?? 0}, neutral=${sentiment.neutral ?? 0}`,
    `- Top domains: ${topDomains}`,
    '',
    '## Buckets',
    ...state.buckets.map((bucket) => `- ${bucket.id}: ${bucket.status} (${bucket.surfaceKey})${bucket.fallback ? ' fallback=page' : ''}${bucket.noWaitFallback ? ` noWait=${bucket.noWaitFallback.source}:${bucket.noWaitFallback.items}` : ''}`),
    '',
    '## Bucket Coverage',
    ...coverageLines,
    '',
    '## Evidence Completeness',
    `- Score: ${completeness.score ?? 'n/a'}/100`,
    `- Grade: ${completeness.grade || 'not-recorded'}`,
    ...completenessLines,
    '',
    '## Media Archive',
    `- Download enabled: ${mediaArchive.downloadMedia === true}`,
    `- Unlimited downloads: ${mediaArchive.unlimited === true}`,
    `- Total assets: ${mediaCounts.total ?? 0}`,
    `- Images: ${mediaCounts.images ?? 0}`,
    `- Videos: ${mediaCounts.videos ?? 0}`,
    `- Downloaded: ${mediaCounts.downloaded ?? 0}`,
    `- Planned: ${mediaCounts.planned ?? 0}`,
    `- Pending: ${mediaCounts.pending ?? 0}`,
    `- Failed: ${mediaCounts.failed ?? 0}`,
    `- Media directory: ${mediaArchive.mediaDir || summary.artifacts.mediaDir || 'n/a'}`,
    '',
    '## Offline Account Archive',
    `- Archive directory: ${offlineArchive.archiveDir || summary.artifacts.archiveDir || 'n/a'}`,
    `- Posts markdown files: ${offlineCounts.posts ?? 0}`,
    `- Article markdown files: ${offlineCounts.articles ?? 0}`,
    `- Following records: ${offlineCounts.following ?? 0}`,
    `- Media downloaded: ${offlineCounts.mediaDownloaded ?? 0}/${offlineCounts.mediaTotal ?? 0}`,
    `- Offline complete: ${offlineArchive.offlineComplete === true}`,
    `- Following markdown: ${offlineArchive.followingPath || summary.artifacts.archiveFollowing || 'n/a'}`,
    `- Following JSON: ${offlineArchive.followingJsonPath || summary.artifacts.archiveFollowingJson || 'n/a'}`,
    `- Following CSV: ${offlineArchive.followingCsvPath || summary.artifacts.archiveFollowingCsv || 'n/a'}`,
    `- Archive index: ${offlineArchive.indexPath || summary.artifacts.archiveIndex || 'n/a'}`,
    `- Archive report: ${offlineArchive.reportPath || summary.artifacts.archiveReport || 'n/a'}`,
    `- Errors log: ${offlineArchive.errorsPath || summary.artifacts.archiveErrors || 'n/a'}`,
    `- Checksum manifest: ${offlineArchive.checksumPath || summary.artifacts.archiveChecksum || 'n/a'}`,
    '',
    '## Analysis Signals',
    `- Representative items: ${summary.analysis?.representativeItems?.length || 0}`,
    `- Top domains: ${topDomains}`,
    ...(investmentLines.length ? investmentLines : ['- No investment signals available.']),
    '',
    '## Verification',
    `- Status: ${verification.status || 'not-recorded'}`,
    `- No-stall ok: ${verification.noStallOk === true}`,
    '',
    '### Strengths',
    ...verificationStrengths,
    '',
    '### Limitations',
    ...verificationLimitations,
    '',
    '### Next Evidence Actions',
    ...verificationActions,
    '',
    '### Blocking Issues',
    ...verificationBlocks,
    '',
    '## Artifacts',
    `- State: ${summary.artifacts.state}`,
    `- Summary: ${summary.artifacts.summary}`,
    `- Raw items: ${summary.artifacts.rawItems}`,
    `- Deduped items: ${summary.artifacts.dedupedItems}`,
    `- Accounts: ${summary.artifacts.accounts}`,
    `- Cache index: ${summary.artifacts.cacheIndex}`,
    `- Cache index JSONL: ${summary.artifacts.cacheIndexJsonl}`,
    `- Media assets: ${summary.artifacts.mediaAssets}`,
    `- Media assets JSONL: ${summary.artifacts.mediaAssetsJsonl}`,
    `- Media dir: ${summary.artifacts.mediaDir}`,
    `- Archive manifest: ${summary.artifacts.archiveManifest}`,
    `- Archive dir: ${summary.artifacts.archiveDir}`,
    `- Archive following: ${summary.artifacts.archiveFollowing}`,
    `- Archive following JSON: ${summary.artifacts.archiveFollowingJson}`,
    `- Archive following CSV: ${summary.artifacts.archiveFollowingCsv}`,
    `- Archive raw dir: ${summary.artifacts.archiveRawDir}`,
    `- Archive posts index: ${summary.artifacts.archivePostsIndex}`,
    `- Archive articles index: ${summary.artifacts.archiveArticlesIndex}`,
    `- Archive media index: ${summary.artifacts.archiveMediaIndex}`,
    `- Archive report: ${summary.artifacts.archiveReport}`,
    `- Archive errors: ${summary.artifacts.archiveErrors}`,
    `- Archive checksum: ${summary.artifacts.archiveChecksum}`,
    '',
    '## Boundary',
    '- API-local cursor or seed stalls use immediate Browser Bridge/page fallback when a fallback command exists.',
    '- Same-surface hard stops use no-wait continuation: preserve partial evidence, reuse local cache, or backfill from discovered profile surfaces.',
    '',
  ];
  return lines.join('\n');
}

async function writeTaskArtifacts(state) {
  const evidence = await collectEvidence(state);
  const cacheIndex = buildCacheIndex(state, evidence);
  const mediaArchive = await buildMediaArchive(state, evidence);
  const offlineArchive = await writeOfflineAccountArchive(state, evidence, mediaArchive);
  const summary = buildSummary(state, evidence, mediaArchive, offlineArchive);
  state.status = summary.status;
  state.updatedAt = summary.generatedAt;
  await writeJsonl(state.layout.rawItemsPath, evidence.rawItems);
  await writeJsonl(state.layout.dedupedItemsPath, evidence.dedupedItems);
  await writeJsonl(state.layout.accountsPath, evidence.accounts);
  await writeJson(state.layout.cacheIndexPath, cacheIndex.summary);
  await writeJsonl(state.layout.cacheIndexJsonlPath, cacheIndex.records);
  await writeJson(state.layout.mediaAssetsPath, mediaArchive.summary);
  await writeJsonl(state.layout.mediaAssetsJsonlPath, mediaArchive.records);
  await writeJson(state.layout.summaryPath, summary);
  await fs.mkdir(path.dirname(state.layout.reportPath), { recursive: true });
  await fs.writeFile(state.layout.reportPath, renderReport(summary, state), 'utf8');
  await writeJson(state.layout.statePath, state);
  return summary;
}

async function runXResearchTask(rawOptions, deps = {}) {
  if (rawOptions.help) {
    return {
      ok: true,
      help: usage(),
    };
  }
  const options = {
    ...rawOptions,
    task: normalizeTask(rawOptions.task),
    runsRoot: path.resolve(rawOptions.runsRoot || DEFAULT_RUNS_ROOT),
  };
  const plan = buildTaskPlan(options);
  await fs.mkdir(plan.layout.outDir, { recursive: true });
  await writeJson(plan.layout.planPath, plan);
  const existing = options.resume || options.refreshReport
    ? await readJsonIfExists(plan.layout.statePath)
    : null;
  const state = /** @type {any} */ (mergeResumeState(existing, plan));

  if (options.refreshReport || !options.execute) {
    const summary = await writeTaskArtifacts(state);
    return {
      ok: true,
      status: options.refreshReport ? 'report-refreshed' : 'planned',
      complete: summary.complete,
      planPath: plan.layout.planPath,
      statePath: plan.layout.statePath,
      summaryPath: plan.layout.summaryPath,
      reportPath: plan.layout.reportPath,
      buckets: state.buckets.length,
    };
  }

  state.status = 'running';
  state.updatedAt = new Date().toISOString();
  await writeJson(state.layout.statePath, state);

  let executed = 0;
  const maxBucketsPerRun = effectiveMaxBucketsPerRun(options.task, options);
  const bucketDelayMs = effectiveBucketDelayMs(options.task, options);
  const preflightCooldowns = deps.findActiveCooldownSurfaces
    ? await deps.findActiveCooldownSurfaces({ runsRoot: options.runsRoot, cooldownMinutes: options.cooldownMinutes, now: nowDate(options) })
    : await findActiveRateLimitSurfaces({ runsRoot: options.runsRoot, cooldownMinutes: options.cooldownMinutes, now: nowDate(options) });
  state.preflightCooldowns = preflightCooldowns;
  const commandTimeoutMs = commandTimeoutMsForTask(options);
  const stateCooldownSurfaces = activeStateCooldownSurfaces(state.cooldowns, options.cooldownMinutes, nowDate(options));
  const blockedSurfaceKeys = new Set([
    ...(preflightCooldowns?.surfaces || []),
    ...stateCooldownSurfaces,
  ]);
  for (let index = 0; index < state.buckets.length; index += 1) {
    let bucket = state.buckets[index];
    if (bucketComplete(bucket.status)) {
      if ((bucket.action === 'search' || bucket.surfaceKey === 'search') && bucketItemCount(bucket) === 0 && !bucket.noWaitFallback) {
        const refilled = await resolveBucketWithoutWaiting(bucket, state, options, {
          executeCommand: deps.executeCommand || executeCommand,
          cwd: deps.cwd || process.cwd(),
          commandTimeoutMs,
        }, 'zero-evidence-completed-search');
        if (refilled) {
          state.buckets[index] = refilled;
          executed += 1;
          await writeTaskArtifacts(state);
          if (maxBucketsPerRun && executed >= maxBucketsPerRun) {
            break;
          }
        }
      }
      continue;
    }
    if (blockedSurfaceKeys.has(bucket.surfaceKey)) {
      const skippedReason = preflightCooldowns?.surfaces?.includes(bucket.surfaceKey)
        ? 'preflight-active-rate-limit'
        : stateCooldownSurfaces.has(bucket.surfaceKey)
          ? 'state-active-rate-limit'
          : 'same-surface-cooldown-already-observed';
      bucket = await resolveBucketWithoutWaiting(bucket, state, options, {
        executeCommand: deps.executeCommand || executeCommand,
        cwd: deps.cwd || process.cwd(),
        commandTimeoutMs,
      }, skippedReason) || {
        ...bucket,
        status: 'failed',
        skippedReason: `${skippedReason}-no-no-wait-resolver`,
        updatedAt: new Date().toISOString(),
      };
      state.buckets[index] = bucket;
      await writeTaskArtifacts(state);
      continue;
    }
    bucket = {
      ...resetBucketForExecution(bucket),
      status: 'running',
      updatedAt: new Date().toISOString(),
    };
    state.buckets[index] = bucket;
    await writeJson(state.layout.statePath, state);

    let finished = await runBucket(bucket, {
      executeCommand: deps.executeCommand || executeCommand,
      cwd: deps.cwd || process.cwd(),
      commandTimeoutMs,
    });
    state.buckets[index] = finished;
    if (finished.status === 'waiting-cooldown') {
      const resolved = await resolveBucketWithoutWaiting(finished, state, options, {
        executeCommand: deps.executeCommand || executeCommand,
        cwd: deps.cwd || process.cwd(),
        commandTimeoutMs,
      }, 'runtime-hard-stop');
      if (resolved) {
        finished = resolved;
        state.buckets[index] = finished;
      } else {
        blockedSurfaceKeys.add(finished.surfaceKey);
        state.cooldowns[finished.surfaceKey] = {
          observedAt: finished.finishedAt,
          reason: finished.result?.outcome?.reason || finished.fallback?.result?.outcome?.reason || 'runtime-hard-stop',
          bucketId: finished.id,
        };
      }
    }
    if (finished.status === 'failed' && recoverableExecutionFailure(finished)) {
      const resolved = await resolveBucketWithoutWaiting(finished, state, options, {
        executeCommand: deps.executeCommand || executeCommand,
        cwd: deps.cwd || process.cwd(),
        commandTimeoutMs,
      }, 'runtime-command-failed');
      if (resolved) {
        finished = resolved;
        state.buckets[index] = finished;
      }
    }
    executed += 1;
    await writeTaskArtifacts(state);
    if (maxBucketsPerRun && executed >= maxBucketsPerRun) {
      break;
    }
    if (bucketDelayMs > 0 && hasExecutablePendingBucketAfter(state.buckets, index, blockedSurfaceKeys)) {
      state.lastBucketDelay = {
        afterBucketId: finished.id,
        delayMs: bucketDelayMs,
        observedAt: new Date().toISOString(),
      };
      await writeJson(state.layout.statePath, state);
      await (deps.sleep || sleep)(bucketDelayMs);
    }
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
  const result = await runXResearchTask(options);
  if (result.help) {
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
  executeCommand,
  findActiveRateLimitSurfaces,
  isApiLocalStall,
  parseArgs,
  runXResearchTask,
};
