#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildTaskPlan,
  parseArgs as parseRunnerArgs,
} from './instagram-research-task-runner.mjs';

const SCHEMA_VERSION = 1;
const PLANNER_VERSION = 'instagram-action-planner-v1';
const DEFAULT_RUNS_ROOT = path.join('.siteforge', 'instagram-live-runs-skill');
const DEFAULT_CHECK_ROOT = path.join('.siteforge', 'instagram-planner-checks');
const VERIFIED_API_CAPABILITIES = Object.freeze([
  'instagram-api-profile-info',
  'instagram-api-profile-posts',
  'instagram-api-profile-relations',
]);
const DEFAULT_MEDIA_DOWNLOAD_TASKS = Object.freeze(new Set([
  'account-full-archive',
  'account-works-archive',
  'account-composite-profile',
  'account-content-profile',
]));

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    request: '',
    requestBase64: null,
    requestFile: null,
    account: null,
    query: null,
    task: null,
    outDir: null,
    runsRoot: DEFAULT_RUNS_ROOT,
    maxItems: null,
    maxScrolls: null,
    scrollWaitMs: null,
    timeoutMs: null,
    now: null,
    selfCheck: false,
    selfCheckOutDir: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--request':
        options.request = next ?? '';
        index += 1;
        break;
      case '--request-base64':
        options.requestBase64 = next ?? null;
        index += 1;
        break;
      case '--request-file':
        options.requestFile = next ?? null;
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
        options.query = next ?? null;
        index += 1;
        break;
      case '--task':
      case '--task-type':
        options.task = next ?? null;
        index += 1;
        break;
      case '--out-dir':
        options.outDir = next ?? null;
        index += 1;
        break;
      case '--runs-root':
        options.runsRoot = next ?? DEFAULT_RUNS_ROOT;
        index += 1;
        break;
      case '--max-items':
        options.maxItems = next ?? null;
        index += 1;
        break;
      case '--max-scrolls':
        options.maxScrolls = next ?? null;
        index += 1;
        break;
      case '--scroll-wait-ms':
      case '--scroll-wait':
        options.scrollWaitMs = next ?? null;
        index += 1;
        break;
      case '--timeout':
        options.timeoutMs = next ?? null;
        index += 1;
        break;
      case '--now':
        options.now = next ?? null;
        index += 1;
        break;
      case '--self-check':
        options.selfCheck = true;
        break;
      case '--self-check-out-dir':
        options.selfCheckOutDir = next ?? null;
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
        if (!arg.startsWith('--')) {
          options.request = options.request ? `${options.request} ${arg}` : arg;
        }
        break;
    }
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/plan-instagram-action.mjs --request "<natural-language request>" [--account openai] [--query codex] --json
  node scripts/plan-instagram-action.mjs --self-check --json

This planner is descriptor-only. It never reads cookies, tokens, auth headers, browser profiles, or private payloads.
`;
}

async function hydrateRequest(options) {
  if (options.requestFile) {
    options.request = await fs.readFile(options.requestFile, 'utf8');
  }
  if (options.requestBase64) {
    options.request = Buffer.from(String(options.requestBase64), 'base64').toString('utf8');
  }
  return options;
}

function normalizeAccount(value) {
  return String(value ?? '').trim().replace(/^@/u, '');
}

function compactSlug(value, fallback = 'instagram-plan') {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/u, '')
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return slug || fallback;
}

function text(value) {
  return String(value ?? '').trim();
}

function has(pattern, request) {
  return pattern.test(String(request ?? ''));
}

function extractAccount(request) {
  const source = String(request ?? '');
  const atMatch = source.match(/@([a-z0-9._]{1,30})/iu);
  if (atMatch) return normalizeAccount(atMatch[1]);
  const urlMatch = source.match(/instagram\.com\/([a-z0-9._]{1,30})(?:[/?#]|$)/iu);
  if (urlMatch) return normalizeAccount(urlMatch[1]);
  const accountMatch = source.match(/\b(?:account|user|profile|handle)\s+([a-z0-9._]{1,30})\b/iu);
  if (accountMatch) return normalizeAccount(accountMatch[1]);
  return null;
}

function requestLooksLikeMutation(request) {
  return has(/\b(?:publish|send|delete|like|follow|unfollow|dm|direct\s+message|change\s+password|edit\s+profile|payment|pay|subscribe)\b/iu, request)
    || has(/(?:\u53d1\u9001\u79c1\u4fe1|\u53d1\u79c1\u4fe1|\u70b9\u8d5e|\u5173\u6ce8\s*@|\u5173\u6ce8\u7528\u6237|\u53d6\u5173|\u53d1\u5e03|\u5220\u9664|\u4fee\u6539\u5bc6\u7801|\u7f16\u8f91\u8d44\u6599|\u652f\u4ed8)/u, request);
}

function requestHasFullArchiveIntent(request) {
  return has(/\b(?:archive|all|full|complete|entire|exhaustive|download|collect)\b/iu, request)
    || has(/(?:\u5168\u90e8|\u5168\u91cf|\u6240\u6709|\u5b8c\u6574|\u5f52\u6863|\u91c7\u96c6)/u, request);
}

function inferTask(options) {
  const request = text(options.request);
  const explicitTask = options.task
    ? parseRunnerArgs(['--task', options.task]).task
    : null;
  if (explicitTask) return { task: explicitTask, confidence: 1, reasonCode: 'explicit_task' };
  if (requestLooksLikeMutation(request)) {
    return {
      task: null,
      confidence: 1,
      blocked: true,
      reasonCode: 'mutation_or_sensitive_action_blocked',
    };
  }
  const allArchive = requestHasFullArchiveIntent(request);
  const accountish = options.account || extractAccount(request);
  if (has(/(?:\bfollowers?\b|\bfollowing\b|\brelation(?:s|ship)?\b|\u7c89\u4e1d|\u5173\u6ce8\u5217\u8868|\u5173\u6ce8\u7684\u4eba|\u5173\u6ce8\u8005)/iu, request)) {
    return { task: 'relation-list-collection', confidence: 0.92, reasonCode: 'relation_list_intent' };
  }
  if (allArchive && has(/(?:\b(?:post|posts|reel|reels|media|content|works)\b|\u4f5c\u54c1|\u5e16\u5b50|\u52a8\u6001|\u5185\u5bb9)/iu, request)) {
    return { task: 'account-works-archive', confidence: 0.96, reasonCode: 'account_works_archive_intent' };
  }
  if (allArchive && accountish) {
    return { task: 'account-full-archive', confidence: 0.95, reasonCode: 'account_full_archive_intent' };
  }
  if (has(/(?:\bsimilar\b|\blookalike\b|\brelated\s+accounts?\b|\u76f8\u4f3c|\u7c7b\u4f3c|\u540c\u7c7b)/iu, request)) {
    return { task: 'similar-account-discovery', confidence: 0.9, reasonCode: 'similar_account_intent' };
  }
  if (has(/(?:\btimeline\b|\bevent\b|\bincident\b|\bchronolog(?:y|ical)\b|\u4e8b\u4ef6|\u65f6\u95f4\u7ebf|\u8fdb\u5c55|\u590d\u76d8)/iu, request)) {
    return { task: 'event-timeline', confidence: 0.88, reasonCode: 'event_timeline_intent' };
  }
  if (has(/(?:\breport\b|\bindustry\b|\bweekly\b|\bmonthly\b|\btopic\b|\u4e3b\u9898\u62a5\u544a|\u884c\u4e1a\u62a5\u544a|\u4e13\u9898|\u5468\u62a5|\u6708\u62a5)/iu, request)) {
    return { task: 'industry-report', confidence: 0.88, reasonCode: 'topic_report_intent' };
  }
  if (has(/(?:\btrend\b|\bsearch\b|\bkeyword\b|\bhashtag\b|\u8d8b\u52bf|\u70ed\u5ea6|\u641c\u7d22|\u5173\u952e\u8bcd|\u6807\u7b7e)/iu, request)) {
    return { task: 'keyword-trend', confidence: 0.86, reasonCode: 'keyword_trend_intent' };
  }
  if (accountish && has(/(?:\bprofile\b|\bsummary\b|\baccount\b|\banaly[sz]e\b|\u753b\u50cf|\u8d26\u53f7\u5206\u6790|\u4e2a\u4eba\u4e3b\u9875)/iu, request)) {
    return { task: 'account-content-profile', confidence: 0.84, reasonCode: 'account_content_profile_intent' };
  }
  if (accountish) return { task: 'account-content-profile', confidence: 0.72, reasonCode: 'account_default_profile' };
  if (request) return { task: 'keyword-trend', confidence: 0.62, reasonCode: 'query_default_search' };
  return { task: null, confidence: 0, reasonCode: 'planner.intent_unresolved' };
}

function isAccountTask(task) {
  return new Set([
    'account-full-archive',
    'account-works-archive',
    'account-composite-profile',
    'account-content-profile',
    'relation-list-collection',
    'similar-account-discovery',
  ]).has(task);
}

function isQueryTask(task) {
  return new Set([
    'keyword-trend',
    'industry-report',
    'event-timeline',
  ]).has(task);
}

function mediaDownloadsDefaultForTask(task) {
  return DEFAULT_MEDIA_DOWNLOAD_TASKS.has(task);
}

function runnerArgsFor({ task, account, query, options, execute = false, resume = false, retryFailed = false, degradedFallback = false }) {
  const args = [
    'scripts/instagram-research-task-runner.mjs',
    '--task',
    task,
  ];
  if (account) args.push('--account', account);
  if (query) args.push('--query', query);
  if (mediaDownloadsDefaultForTask(task)) args.push('--download-media');
  if (options.outDir) args.push('--out-dir', options.outDir);
  if (options.runsRoot) args.push('--runs-root', options.runsRoot);
  if (options.maxItems) args.push('--max-items', String(options.maxItems));
  if (options.maxScrolls) args.push('--max-scrolls', String(options.maxScrolls));
  if (options.scrollWaitMs) args.push('--scroll-wait-ms', String(options.scrollWaitMs));
  if (options.timeoutMs) args.push('--timeout', String(options.timeoutMs));
  if (options.now) args.push('--now', String(options.now));
  if (execute) args.push('--execute');
  if (resume) args.push('--resume');
  if (retryFailed) args.push('--retry-failed');
  if (degradedFallback) args.push('--use-build-summary-fallback');
  args.push('--json');
  return ['node', ...args];
}

function runnerParseArgsForPlan(task, account, query, options) {
  const args = ['--task', task];
  if (account) args.push('--account', account);
  if (query) args.push('--query', query);
  if (options.outDir) args.push('--out-dir', options.outDir);
  if (options.runsRoot) args.push('--runs-root', options.runsRoot);
  if (options.maxItems) args.push('--max-items', String(options.maxItems));
  if (options.maxScrolls) args.push('--max-scrolls', String(options.maxScrolls));
  if (options.scrollWaitMs) args.push('--scroll-wait-ms', String(options.scrollWaitMs));
  if (options.timeoutMs) args.push('--timeout', String(options.timeoutMs));
  if (options.now) args.push('--now', String(options.now));
  return parseRunnerArgs(args);
}

function planInstagramAction(options = parseArgs()) {
  const request = text(options.request);
  const inference = inferTask(options);
  const account = normalizeAccount(options.account || extractAccount(request));
  const query = text(options.query || (isQueryTask(inference.task) ? request : ''));
  const missingParameters = [];
  if (!inference.task) {
    if (!inference.blocked) missingParameters.push('request');
  } else if (isAccountTask(inference.task) && !account) {
    missingParameters.push('account');
  } else if (isQueryTask(inference.task) && !query) {
    missingParameters.push('query');
  }
  const blocked = inference.blocked === true;
  const canPlan = !blocked && inference.task && missingParameters.length === 0;
  const outDir = options.outDir ?? (canPlan
    ? path.join('.siteforge', 'instagram-research-tasks', compactSlug(`${inference.task}-${account || query}`))
    : null);
  const commandOptions = { ...options, outDir, runsRoot: options.runsRoot || DEFAULT_RUNS_ROOT };
  const result = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    siteKey: 'instagram',
    request,
    blocked,
    reasonCode: blocked ? inference.reasonCode : missingParameters.length ? 'planner.missing_parameters' : 'planner.plan_generated',
    inference,
    matchedTask: inference.task,
    parameters: {
      account: account || null,
      query: query || null,
    },
    missingParameters,
    apiFirst: {
      primary: {
        kind: 'api',
        available: true,
        verified: true,
        reasonCode: null,
        activeApiCapabilities: VERIFIED_API_CAPABILITIES,
      },
      fallbackPolicy: 'immediate_verified_site_fallback',
      cooldownPolicy: 'do_not_wait_for_same_surface_cooldown',
    },
    mediaDownloads: {
      defaultEnabled: mediaDownloadsDefaultForTask(inference.task),
      enabledTaskIds: [...DEFAULT_MEDIA_DOWNLOAD_TASKS],
      runtimeFlag: '--download-media',
      disableFlag: '--no-download-media',
      artifacts: ['media-assets.json', 'media-assets.jsonl'],
      material: 'governed_image_video_binaries',
    },
    safety: {
      savedMaterial: 'sanitized_summary_only',
      mutationActions: 'blocked_by_default',
      forbiddenMaterial: [
        'cookie',
        'token',
        'authorization_header',
        'browser_profile',
        'raw_private_body',
        'payment_or_account_mutation',
      ],
    },
    planner: null,
    execution: null,
    resume: null,
    degradedFallback: null,
    artifactContract: null,
    completionGate: {
      specifiedUserAllWorks: {
        requiredField: 'task-summary.json#/productionEvidence/userArchiveSupport',
        requiredValue: 'supported_with_current_artifacts',
        requiredTask: 'account-works-archive',
        mediaRequiredField: 'task-summary.json#/mediaDownloads',
        mediaArtifacts: ['media-assets.json', 'media-assets.jsonl'],
        boundary: 'Do not claim support for all works/posts unless account-works-archive or account-full-archive completed real site fallback buckets, produced sanitized JSONL records, and preserved media download artifacts when media URLs were discovered.',
      },
    },
    planPreview: null,
  };
  if (!canPlan) return result;

  const plan = buildTaskPlan(runnerParseArgsForPlan(inference.task, account, query, commandOptions));
  result.planner = {
    kind: 'task-runner',
    command: runnerArgsFor({ task: inference.task, account, query, options: commandOptions }),
  };
  result.execution = {
    kind: 'api-first-with-verified-site-fallback',
    command: runnerArgsFor({ task: inference.task, account, query, options: commandOptions, execute: true, resume: true }),
  };
  result.resume = {
    strategy: 'reuse-task-state-before-live-retry',
    command: runnerArgsFor({ task: inference.task, account, query, options: commandOptions, execute: true, resume: true, retryFailed: true }),
  };
  result.degradedFallback = {
    when: 'login_or_session_required_after_real_site_fallback_failure',
    command: runnerArgsFor({ task: inference.task, account, query, options: commandOptions, execute: true, resume: true, retryFailed: true, degradedFallback: true }),
    boundary: 'structure_summary_only_not_real_content_collection',
  };
  result.artifactContract = plan.artifactContract;
  result.planPreview = {
    task: plan.task,
    bucketIds: plan.buckets.map((bucket) => bucket.id),
    siteFallbacks: plan.buckets.map((bucket) => ({
      bucketId: bucket.id,
      verified: bucket.siteFallback.verified,
      action: bucket.action,
    })),
    outDir: plan.layout.outDir,
    downloadMediaDefault: plan.task.defaults?.downloadMedia === true,
    mediaCapableBucketIds: plan.buckets
      .filter((bucket) => bucket.siteFallback.command.includes('--download-media'))
      .map((bucket) => bucket.id),
  };
  return result;
}

async function runSelfCheck(options = parseArgs()) {
  const cases = [
    {
      id: 'account-full-archive',
      options: { request: 'archive full account profile for @openai', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'account-full-archive', blocked: false, missing: [] },
    },
    {
      id: 'account-works-archive',
      options: { request: 'archive all posts for @openai', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'account-works-archive', blocked: false, missing: [] },
    },
    {
      id: 'industry-report',
      options: { request: '\u751f\u6210 openai codex \u4e3b\u9898\u62a5\u544a', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'industry-report', blocked: false, missing: [] },
    },
    {
      id: 'account-content-profile',
      options: { request: 'build a content profile for @openai', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'account-content-profile', blocked: false, missing: [] },
    },
    {
      id: 'relation-list-collection',
      options: { request: 'collect followers list for @openai', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'relation-list-collection', blocked: false, missing: [] },
    },
    {
      id: 'missing-account',
      options: { request: 'archive all posts', runsRoot: options.runsRoot, now: options.now },
      expect: { task: 'account-works-archive', blocked: false, missing: ['account'] },
    },
    {
      id: 'blocked-mutation',
      options: { request: 'follow @openai and like latest post', runsRoot: options.runsRoot, now: options.now },
      expect: { task: null, blocked: true, missing: [] },
    },
  ];
  const rows = cases.map((entry) => {
    const plan = planInstagramAction({
      ...parseArgs([]),
      ...entry.options,
      outDir: options.outDir ?? null,
    });
    const passed = plan.matchedTask === entry.expect.task
      && plan.blocked === entry.expect.blocked
      && JSON.stringify(plan.missingParameters) === JSON.stringify(entry.expect.missing);
    return {
      id: entry.id,
      passed,
      expected: entry.expect,
      actual: {
        task: plan.matchedTask,
        blocked: plan.blocked,
        missing: plan.missingParameters,
        reasonCode: plan.reasonCode,
      },
    };
  });
  const outDir = path.resolve(options.selfCheckOutDir || path.join(DEFAULT_CHECK_ROOT, 'latest'));
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    generatedAt: new Date().toISOString(),
    ok: rows.every((row) => row.passed),
    total: rows.length,
    passed: rows.filter((row) => row.passed).length,
    rows,
    safety: {
      descriptorOnly: true,
      sensitiveMaterialRead: false,
    },
  };
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'planner-check.json');
  const mdPath = path.join(outDir, 'planner-check.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, renderSelfCheckMarkdown(summary), 'utf8');
  return {
    ok: summary.ok,
    status: summary.ok ? 'passed' : 'failed',
    jsonPath,
    mdPath,
    summary,
  };
}

function renderSelfCheckMarkdown(summary) {
  const rows = summary.rows
    .map((row) => `| \`${row.id}\` | ${row.passed ? 'pass' : 'fail'} | \`${row.actual.task ?? 'blocked'}\` | \`${row.actual.reasonCode}\` |`)
    .join('\n');
  return [
    '# Instagram Planner Self Check',
    '',
    `- Status: ${summary.ok ? 'passed' : 'failed'}`,
    `- Passed: ${summary.passed}/${summary.total}`,
    '- Boundary: descriptor-only, no sensitive material read',
    '',
    '| Case | Result | Task | Reason |',
    '|---|---:|---|---|',
    rows,
    '',
  ].join('\n');
}

async function main() {
  const options = await hydrateRequest(parseArgs());
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = options.selfCheck
    ? await runSelfCheck(options)
    : planInstagramAction(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false || result.status === 'failed') {
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
  inferTask,
  parseArgs,
  planInstagramAction,
  runSelfCheck,
};
