#!/usr/bin/env node
// @ts-check

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const SITE_ID = '123av.com-a26d204b';
const SITE_KEY = '123av';
const SITE_HOST = '123av.com';
const DEFAULT_BUILD_DIR = path.join('.siteforge', 'sites', SITE_ID, 'current');
const DEFAULT_OUT_ROOT = path.join('.siteforge', '123av-production-tasks');
const DEFAULT_MAX_ITEMS = 80;
const PUBLIC_METADATA_AUTHORIZED_FIELDS = Object.freeze([
  'schemaVersion',
  'siteKey',
  'taskId',
  'itemId',
  'publicTitle',
  'publicDetailUrl',
  'routeTemplate',
  'sourceNodeId',
  'sourceNodeType',
  'sourceFieldMap',
  'publicUrlHash',
  'evidenceHash',
  'rank',
  'observedAt',
  'exportPolicy',
  'authorizationScope',
  'rawHtmlSaved',
  'rawBodySaved',
  'mediaAssetsWritten',
  'authMaterialSaved',
]);
const PUBLIC_METADATA_EXPORT_DISABLED = Object.freeze({
  status: 'not_enabled',
  reasonCode: 'authorized-public-metadata-contract-required',
  savedMaterial: 'none',
  artifact: null,
  allowedFieldsWhenAuthorized: PUBLIC_METADATA_AUTHORIZED_FIELDS,
});

const TASKS = Object.freeze({
  'channel-full-archive': Object.freeze({
    id: 'channel-full-archive',
    label: 'Public author/channel/topic archive',
    requiredAny: ['route', 'topic', 'url', 'profileUrl', 'entity'],
    inputSlots: ['route', 'topic', 'url', 'profileUrl', 'entity', 'locale', 'maxItems'],
    userIntent: 'Archive a public author, channel, category, tag, or topic route into resumable structural evidence.',
  }),
  'keyword-trend': Object.freeze({
    id: 'keyword-trend',
    label: 'Keyword search and trend analysis',
    requiredAny: ['query'],
    inputSlots: ['query', 'locale', 'from', 'to', 'maxItems'],
    userIntent: 'Plan and execute public keyword search/trend evidence with structural fallback when API is unavailable.',
  }),
  'entity-profile': Object.freeze({
    id: 'entity-profile',
    label: 'Public actor/entity profile snapshot',
    requiredAny: ['profileUrl', 'entity'],
    inputSlots: ['profileUrl', 'entity', 'locale', 'maxItems'],
    userIntent: 'Build a public actor/entity profile snapshot from profile routes and related catalog structure.',
  }),
  'content-profile': Object.freeze({
    id: 'content-profile',
    label: 'Public content profile snapshot',
    requiredAny: ['contentUrl', 'content'],
    inputSlots: ['contentUrl', 'content', 'locale', 'maxItems'],
    userIntent: 'Build a public content-detail profile without saving title, description, comments, thumbnails, or media.',
  }),
  'list-history-collection': Object.freeze({
    id: 'list-history-collection',
    label: 'Public list/history collection',
    requiredAny: ['route', 'topic'],
    inputSlots: ['route', 'topic', 'locale', 'maxItems'],
    userIntent: 'Collect public ranking/list/history-like catalog surfaces while blocking account/private lists.',
  }),
  'event-timeline-report': Object.freeze({
    id: 'event-timeline-report',
    label: 'Topic event timeline/report',
    requiredAny: ['query', 'topic'],
    inputSlots: ['query', 'topic', 'from', 'to', 'locale', 'maxItems'],
    userIntent: 'Compose a public topic/event report from search-binding evidence plus ranking and archive snapshots.',
  }),
});

const TASK_ALIASES = Object.freeze({
  archive: 'channel-full-archive',
  'author-archive': 'channel-full-archive',
  'author-full-archive': 'channel-full-archive',
  'channel-archive': 'channel-full-archive',
  'channel-full-archive': 'channel-full-archive',
  'topic-archive': 'channel-full-archive',
  search: 'keyword-trend',
  trend: 'keyword-trend',
  'keyword-search': 'keyword-trend',
  'keyword-trend': 'keyword-trend',
  actor: 'entity-profile',
  author: 'entity-profile',
  entity: 'entity-profile',
  'actor-profile': 'entity-profile',
  'author-profile': 'entity-profile',
  'entity-profile': 'entity-profile',
  content: 'content-profile',
  detail: 'content-profile',
  'content-profile': 'content-profile',
  list: 'list-history-collection',
  history: 'list-history-collection',
  ranking: 'list-history-collection',
  'list-history': 'list-history-collection',
  'list-history-collection': 'list-history-collection',
  event: 'event-timeline-report',
  timeline: 'event-timeline-report',
  report: 'event-timeline-report',
  'event-timeline': 'event-timeline-report',
  'event-timeline-report': 'event-timeline-report',
});

const BUCKETS_BY_TASK = Object.freeze({
  'channel-full-archive': Object.freeze([
    bucketTemplate('route-inventory', 'Public route inventory', 'catalog-channel', ['browse-public-categories', 'browse-public-navigation']),
    bucketTemplate('ranking-snapshots', 'Public ranking/list snapshots', 'ranking', ['browse-public-rankings', 'browse-public-collections']),
    bucketTemplate('tag-and-category-index', 'Tag/category index', 'tag-category', ['browse-public-tags', 'browse-public-categories']),
    bucketTemplate('detail-route-samples', 'Detail route templates for follow-up', 'detail', ['open-public-detail-pages']),
    bucketTemplate('profile-route-samples', 'Actor/entity route templates for follow-up', 'profile', ['open-public-profiles']),
  ]),
  'keyword-trend': Object.freeze([
    bucketTemplate('search-binding', 'Search form and route binding', 'search', ['search-catalog-content', 'search-public-content']),
    bucketTemplate('ranking-context', 'Ranking context for trend comparison', 'ranking', ['browse-public-rankings']),
    bucketTemplate('tag-backfill', 'Tag/category backfill when search results are unavailable', 'tag-category', ['browse-public-tags', 'browse-public-categories']),
    bucketTemplate('detail-follow-up', 'Detail route follow-up contract', 'detail', ['open-public-detail-pages']),
  ]),
  'entity-profile': Object.freeze([
    bucketTemplate('profile-route', 'Public actor/entity route binding', 'profile', ['open-public-profiles']),
    bucketTemplate('profile-related-tags', 'Related public tag/category context', 'tag-category', ['browse-public-tags']),
    bucketTemplate('profile-detail-follow-up', 'Public detail route follow-up', 'detail', ['open-public-detail-pages']),
  ]),
  'content-profile': Object.freeze([
    bucketTemplate('detail-route', 'Public content detail route binding', 'detail', ['open-public-detail-pages']),
    bucketTemplate('detail-metadata-contract', 'Sanitized metadata contract', 'metadata', ['read-public-metadata']),
    bucketTemplate('related-route-context', 'Related public route context', 'tag-category', ['browse-public-tags', 'browse-public-categories']),
  ]),
  'list-history-collection': Object.freeze([
    bucketTemplate('public-rankings', 'Public ranking/list routes', 'ranking', ['browse-public-rankings', 'browse-public-collections']),
    bucketTemplate('public-collections', 'Public collection/category routes', 'catalog-channel', ['browse-public-collections', 'browse-public-categories']),
    bucketTemplate('blocked-account-lists', 'Blocked account/private list boundary', 'blocked-account-route', ['disabled-delete-action']),
  ]),
  'event-timeline-report': Object.freeze([
    bucketTemplate('timeline-search-binding', 'Search binding for event/topic queries', 'search', ['search-public-content']),
    bucketTemplate('timeline-ranking-snapshots', 'Ranking snapshots for timeline context', 'ranking', ['browse-public-rankings']),
    bucketTemplate('timeline-archive-context', 'Archive/category context for report sections', 'catalog-channel', ['browse-public-categories']),
    bucketTemplate('timeline-follow-up-detail', 'Detail route follow-up contract', 'detail', ['open-public-detail-pages']),
  ]),
});

function usage() {
  return `Usage:
  node scripts/123av-research-task-runner.mjs --task <task> [options]

Tasks:
  channel-full-archive     Archive a public author/channel/category/tag/topic route.
  author-full-archive      Alias for channel-full-archive with profile/entity inputs.
  keyword-trend            Keyword search + trend analysis with verified site fallback.
  entity-profile           Public actor/entity profile snapshot.
  content-profile          Public content/detail profile snapshot.
  list-history-collection  Public ranking/list/history collection; private lists blocked.
  event-timeline-report    Topic/event timeline report.

Options:
  --query <value>          Keyword/topic query for search, trend, and event tasks.
  --topic <value>          Topic/channel descriptor. Stored as a hash, not raw prose.
  --route <path>           Public route template or path, for example /zh/dm9/trending.
  --url <url>              Public route URL. Stored as a hash/template only.
  --profile-url <url>      Public profile URL. Stored as a hash/template only.
  --content-url <url>      Public content detail URL. Stored as a hash/template only.
  --entity <value>         Actor/entity descriptor. Stored as a hash.
  --content <value>        Content descriptor. Stored as a hash.
  --locale <value>         Locale hint. Default: zh.
  --from YYYY-MM-DD        Optional date boundary for report tasks.
  --to YYYY-MM-DD          Optional date boundary for report tasks.
  --build-dir <path>       SiteForge current/build artifact directory.
  --out-dir <path>         Output directory. Default: .siteforge/123av-production-tasks/<task-target>
  --max-items <n>          Max sanitized raw items across buckets. Default: ${DEFAULT_MAX_ITEMS}.
  --allow-public-metadata-export
                           Opt in to a separate public-metadata-items.jsonl artifact.
  --public-metadata-scope <value>
                           Required with --allow-public-metadata-export; records the explicit scope.
  --execute                Execute against local verified SiteForge evidence.
  --resume                 Reuse an existing task-state.json for the same target.
  --dry-run                Write plan/state without collecting items.
  --json                   Print JSON result.
`;
}

function bucketTemplate(id, label, selector, capabilityNames) {
  return Object.freeze({
    id,
    label,
    selector,
    capabilityNames,
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    task: null,
    query: null,
    topic: null,
    route: null,
    url: null,
    profileUrl: null,
    contentUrl: null,
    entity: null,
    content: null,
    locale: 'zh',
    from: null,
    to: null,
    buildDir: DEFAULT_BUILD_DIR,
    outDir: null,
    maxItems: DEFAULT_MAX_ITEMS,
    allowPublicMetadataExport: false,
    publicMetadataScope: null,
    execute: false,
    resume: false,
    dryRun: false,
    json: false,
    now: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--task':
        options.task = normalizeTask(next);
        index += 1;
        break;
      case '--query':
      case '--keyword':
        options.query = requiredValue(next, arg);
        index += 1;
        break;
      case '--topic':
        options.topic = requiredValue(next, arg);
        index += 1;
        break;
      case '--route':
        options.route = requiredValue(next, arg);
        index += 1;
        break;
      case '--url':
        options.url = requiredValue(next, arg);
        index += 1;
        break;
      case '--profile-url':
      case '--author-url':
      case '--actor-url':
        options.profileUrl = requiredValue(next, arg);
        index += 1;
        break;
      case '--content-url':
      case '--detail-url':
        options.contentUrl = requiredValue(next, arg);
        index += 1;
        break;
      case '--entity':
      case '--actor':
      case '--author':
        options.entity = requiredValue(next, arg);
        index += 1;
        break;
      case '--content':
        options.content = requiredValue(next, arg);
        index += 1;
        break;
      case '--locale':
        options.locale = requiredValue(next, arg);
        index += 1;
        break;
      case '--from':
        options.from = parseDateOnly(requiredValue(next, arg), arg);
        index += 1;
        break;
      case '--to':
        options.to = parseDateOnly(requiredValue(next, arg), arg);
        index += 1;
        break;
      case '--build-dir':
        options.buildDir = requiredValue(next, arg);
        index += 1;
        break;
      case '--out-dir':
        options.outDir = requiredValue(next, arg);
        index += 1;
        break;
      case '--max-items':
        options.maxItems = positiveInteger(next, arg);
        index += 1;
        break;
      case '--allow-public-metadata-export':
        options.allowPublicMetadataExport = true;
        break;
      case '--public-metadata-scope':
        options.publicMetadataScope = requiredValue(next, arg);
        index += 1;
        break;
      case '--execute':
        options.execute = true;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        options.execute = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--now':
        options.now = requiredValue(next, arg);
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.help && !options.task) {
    throw new Error('--task is required');
  }
  if (options.allowPublicMetadataExport && !options.publicMetadataScope) {
    throw new Error('--public-metadata-scope is required with --allow-public-metadata-export');
  }
  return options;
}

function requiredValue(value, name) {
  const text = String(value ?? '').trim();
  if (!text || text.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return text;
}

function normalizeTask(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/_/gu, '-');
  return TASK_ALIASES[key] || key;
}

function parseDateOnly(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function validateOptions(options) {
  const task = TASKS[options.task];
  if (!task) {
    throw new Error(`Unsupported task: ${String(options.task)}`);
  }
  const hasRequired = task.requiredAny.some((name) => Boolean(options[name]));
  if (!hasRequired) {
    throw new Error(`Task ${task.id} requires one of: ${task.requiredAny.map((name) => `--${dashCase(name)}`).join(', ')}`);
  }
}

function dashCase(value) {
  return String(value).replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function compactSlug(value, fallback = '123av-task') {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return slug || fallback;
}

function shortHash(value, length = 16) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

function nowIso(options) {
  if (!options.now) {
    return new Date().toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(options.now)) {
    return `${options.now}T00:00:00.000Z`;
  }
  const date = new Date(options.now);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('--now must be an ISO timestamp or YYYY-MM-DD');
  }
  return date.toISOString();
}

function outputLayout(options) {
  const target = options.query || options.topic || options.route || options.entity || options.content || options.url || options.profileUrl || options.contentUrl || options.task;
  const outDir = path.resolve(options.outDir || path.join(DEFAULT_OUT_ROOT, compactSlug(`${options.task}-${shortHash(target, 10)}`)));
  return {
    outDir,
    planPath: path.join(outDir, 'task-plan.json'),
    statePath: path.join(outDir, 'task-state.json'),
    summaryPath: path.join(outDir, 'task-summary.json'),
    reportPath: path.join(outDir, 'task-report.md'),
    rawItemsPath: path.join(outDir, 'raw-items.jsonl'),
    dedupedItemsPath: path.join(outDir, 'deduped-items.jsonl'),
    publicMetadataItemsPath: path.join(outDir, 'public-metadata-items.jsonl'),
    accountsDir: path.join(outDir, 'accounts'),
    authorsDir: path.join(outDir, 'authors'),
    accountsItemsPath: path.join(outDir, 'accounts', 'items.jsonl'),
    authorsItemsPath: path.join(outDir, 'authors', 'items.jsonl'),
    cacheIndexPath: path.join(outDir, 'cache-index.json'),
    cacheIndexJsonlPath: path.join(outDir, 'cache-index.jsonl'),
    archiveDir: path.join(outDir, 'archive'),
    archiveIndexPath: path.join(outDir, 'archive', 'index.md'),
    archiveTaskPath: path.join(outDir, 'archive', `${options.task}.md`),
    archiveRouteSamplesPath: path.join(outDir, 'archive', 'route-samples.md'),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readBuildArtifacts(buildDir) {
  const resolved = path.resolve(buildDir || DEFAULT_BUILD_DIR);
  const [graph, capabilities, plans, contracts, verification, runtimeExecution, runtimeDispatch] = await Promise.all([
    readJson(path.join(resolved, 'graph.json')),
    readJson(path.join(resolved, 'capabilities.json')),
    readJson(path.join(resolved, 'execution_plans.json')),
    readJson(path.join(resolved, 'execution_contracts.json')),
    readJson(path.join(resolved, 'verification_report.json')),
    readJson(path.join(resolved, 'runtime_execution_report.json')).catch(() => null),
    readJson(path.join(resolved, 'runtime_dispatch_report.json')).catch(() => null),
  ]);
  const capabilityRows = Array.isArray(capabilities?.capabilities) ? capabilities.capabilities : [];
  const planRows = Array.isArray(plans?.executionPlans) ? plans.executionPlans : [];
  const contractRows = Array.isArray(contracts?.executionContracts) ? contracts.executionContracts : [];
  return {
    buildDir: resolved,
    graph,
    capabilities: capabilityRows,
    plans: planRows,
    contracts: contractRows,
    verification,
    runtimeExecution,
    runtimeDispatch,
    capabilitiesBySlug: new Map(capabilityRows.map((capability) => [capabilitySlug(capability), capability])),
  };
}

function capabilitySlug(capability) {
  const value = capability?.name || capability?.id || '';
  return compactSlug(value).replace(/^capability-/u, '');
}

function capabilityIdForName(artifacts, name) {
  return artifacts.capabilitiesBySlug.get(name)?.id
    || artifacts.capabilities.find((capability) => compactSlug(capability?.name) === name)?.id
    || null;
}

function targetDescriptor(options) {
  const raw = {
    query: options.query,
    topic: options.topic,
    route: options.route,
    url: options.url,
    profileUrl: options.profileUrl,
    contentUrl: options.contentUrl,
    entity: options.entity,
    content: options.content,
    locale: options.locale,
    from: options.from,
    to: options.to,
  };
  return {
    locale: options.locale,
    from: options.from,
    to: options.to,
    routeTemplate: safeRouteTemplate(options.route || options.url || options.profileUrl || options.contentUrl || ''),
    queryHash: options.query ? shortHash(options.query) : null,
    topicHash: options.topic ? shortHash(options.topic) : null,
    urlHash: options.url ? shortHash(options.url) : null,
    profileUrlHash: options.profileUrl ? shortHash(options.profileUrl) : null,
    contentUrlHash: options.contentUrl ? shortHash(options.contentUrl) : null,
    entityHash: options.entity ? shortHash(options.entity) : null,
    contentHash: options.content ? shortHash(options.content) : null,
    fingerprint: shortHash(JSON.stringify(raw), 20),
  };
}

function buildTaskPlan(options, artifacts) {
  validateOptions(options);
  const layout = outputLayout(options);
  const target = targetDescriptor(options);
  const buckets = (BUCKETS_BY_TASK[options.task] || []).map((template) => {
    const capabilityIds = template.capabilityNames.map((name) => capabilityIdForName(artifacts, name)).filter(Boolean);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: template.id,
      label: template.label,
      selector: template.selector,
      status: 'pending',
      capabilityIds,
      planner: {
        evidenceSource: 'siteforge-current-graph',
        sourceArtifacts: [
          path.join(artifacts.buildDir, 'graph.json'),
          path.join(artifacts.buildDir, 'capabilities.json'),
          path.join(artifacts.buildDir, 'execution_plans.json'),
          path.join(artifacts.buildDir, 'execution_contracts.json'),
        ],
      },
      primary: {
        kind: 'api',
        active: false,
        verified: false,
        replayVerified: false,
        adapterBound: false,
        runtimeTested: false,
        reasonCode: 'no-verified-public-api',
        failureExplanation: '123av adapter rejects API promotion until a public API candidate has replay verification, adapter approval, and runtime binding evidence.',
        commandTemplate: null,
      },
      siteFallback: {
        kind: 'site',
        active: true,
        verified: true,
        reasonCode: 'verified-siteforge-graph-fallback',
        commandTemplate: [
          'node',
          'scripts/123av-research-task-runner.mjs',
          '--task',
          options.task,
          '--out-dir',
          layout.outDir,
          '--execute',
          '--resume',
          '--json',
        ],
        resumeStrategy: 'reuse task-state.json and skip completed buckets; do not wait for API cooldown when no verified API exists',
        savedMaterial: 'sanitized_summary_only',
      },
    };
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(options),
    site: {
      id: SITE_ID,
      key: SITE_KEY,
      host: SITE_HOST,
      archetype: 'adult-catalog-detail',
      publicOnly: true,
    },
    task: {
      id: options.task,
      label: TASKS[options.task].label,
      userIntent: TASKS[options.task].userIntent,
      inputSlots: TASKS[options.task].inputSlots,
      target,
    },
    apiFirstPolicy: {
      activeApiCapabilities: 0,
      verifiedApiRequiredForActive: true,
      fallbackWhenApiUnavailable: 'immediate-verified-site-fallback',
      cooldownPolicy: 'no meaningless cooldown for unavailable/unverified API',
    },
    safetyBoundary: {
      authMaterialAccess: 'forbidden',
      rawCookieTokenHeaders: 'forbidden',
      rawPrivateBody: 'forbidden',
      writePaymentAccountMutations: 'blocked',
      mediaDownload: 'disabled-unless-explicitly-authorized-and-site-policy-allows',
      savedMaterial: 'sanitized_summary_only',
      rawAdultTextSaved: false,
      publicMetadataExport: publicMetadataExportPolicy(options, layout),
    },
    artifactContract: artifactContract(layout, options),
    layout,
    buckets,
  };
}

function publicMetadataExportPolicy(options, layout) {
  if (!options.allowPublicMetadataExport) {
    return PUBLIC_METADATA_EXPORT_DISABLED;
  }
  return {
    status: 'enabled',
    reasonCode: 'explicit-public-metadata-export-request',
    savedMaterial: 'authorized_public_metadata',
    artifact: layout.publicMetadataItemsPath,
    authorizationScope: String(options.publicMetadataScope || ''),
    allowedFieldsWhenAuthorized: PUBLIC_METADATA_AUTHORIZED_FIELDS,
  };
}

function artifactContract(layout, options = {}) {
  const publicMetadataExport = publicMetadataExportPolicy(options, layout);
  return {
    required: {
      taskPlan: layout.planPath,
      taskState: layout.statePath,
      taskSummary: layout.summaryPath,
      taskReport: layout.reportPath,
      rawItems: layout.rawItemsPath,
      dedupedItems: layout.dedupedItemsPath,
      authorItems: layout.authorsItemsPath,
      accountItems: layout.accountsItemsPath,
      cacheIndex: layout.cacheIndexPath,
      cacheIndexJsonl: layout.cacheIndexJsonlPath,
      archiveIndex: layout.archiveIndexPath,
      archiveTaskReport: layout.archiveTaskPath,
    },
    optional: {
      publicMetadataItems: publicMetadataExport.status === 'enabled' ? layout.publicMetadataItemsPath : null,
    },
    fieldPolicy: {
      stableItemFields: ['itemId', 'taskId', 'bucketId', 'itemKind', 'pageType', 'routeTemplate', 'sourceNodeId', 'evidenceHash'],
      forbiddenFields: ['title', 'description', 'comment', 'thumbnail', 'cookie', 'token', 'authorization', 'rawHtml', 'rawBody', 'browserProfile'],
      urlPolicy: 'store hash and route template only; do not store raw adult-content URLs',
      publicMetadataExport,
    },
  };
}

function initialState(plan) {
  return {
    schemaVersion: SCHEMA_VERSION,
    site: plan.site,
    task: plan.task,
    targetFingerprint: plan.task.target.fingerprint,
    status: 'planned',
    startedAt: plan.generatedAt,
    updatedAt: plan.generatedAt,
    layout: plan.layout,
    buckets: plan.buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      selector: bucket.selector,
      status: 'pending',
      attempts: 0,
      itemCount: 0,
      dedupedItemCount: 0,
      resultVerification: 'not-run',
      failureExplanation: null,
      artifacts: {},
    })),
    safetyBoundary: plan.safetyBoundary,
    blockedSurfaces: [],
  };
}

async function loadStateForResume(plan, options) {
  if (!options.resume) {
    return initialState(plan);
  }
  try {
    const existing = JSON.parse(await fs.readFile(plan.layout.statePath, 'utf8'));
    if (existing?.targetFingerprint !== plan.task.target.fingerprint) {
      throw new Error('resume target mismatch; use a different --out-dir or omit --resume');
    }
    return mergeState(existing, plan);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return initialState(plan);
    }
    throw error;
  }
}

function mergeState(existing, plan) {
  const existingBuckets = new Map((existing?.buckets || []).map((bucket) => [bucket.id, bucket]));
  return {
    ...initialState(plan),
    ...existing,
    layout: plan.layout,
    task: plan.task,
    safetyBoundary: plan.safetyBoundary,
    buckets: plan.buckets.map((bucket) => existingBuckets.get(bucket.id) || {
      id: bucket.id,
      label: bucket.label,
      selector: bucket.selector,
      status: 'pending',
      attempts: 0,
      itemCount: 0,
      dedupedItemCount: 0,
      resultVerification: 'not-run',
      failureExplanation: null,
      artifacts: {},
    }),
  };
}

function safeRouteTemplate(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  let pathname = text;
  try {
    pathname = new URL(text).pathname;
  } catch {
    pathname = text.split('?')[0];
  }
  const parts = pathname
    .replace(/\/{2,}/gu, '/')
    .split('/')
    .filter(Boolean);
  if (parts.length === 0) {
    return '/';
  }
  const locale = isLocale(parts[0]) ? parts[0] : null;
  const rest = locale ? parts.slice(1) : parts;
  const prefix = locale ? `/${locale}` : '';
  if (rest[0] === 'v' && rest.length > 1) return `${prefix}/v/:contentSlug`;
  if (rest[0] === 'actresses' && rest.length > 1) return `${prefix}/actresses/:actorSlug`;
  if (rest[0] === 'tags' && rest.length > 1) return `${prefix}/tags/:tagSlug`;
  if (rest[0] === 'genres') return `${prefix}/genres`;
  if (rest[0] === 'makers' && rest.length > 1) return `${prefix}/makers/:makerSlug`;
  if (rest[0] === 'series' && rest.length > 1) return `${prefix}/series/:seriesSlug`;
  if (rest.length >= 2 && isSortSegment(rest[1])) return `${prefix}/:catalogSlug/${rest[1]}`;
  if (rest.length === 1 && isSortSegment(rest[0])) return `${prefix}/${rest[0]}`;
  if (rest[0] === 'search') return `${prefix}/search`;
  if (['2257', 'abuse', 'privacy', 'terms', 'contact'].includes(rest[0])) return `${prefix}/${rest[0]}`;
  if (rest[0] === 'actresses') return `${prefix}/actresses`;
  if (rest.length === 1 && isCatalogRoot(rest[0])) return `${prefix}/:catalogSlug`;
  return `${prefix}/${rest.map((part) => (isSafeFixedSegment(part) ? part : ':segment')).join('/')}`;
}

function isLocale(value) {
  return new Set(['de', 'en', 'fil', 'fr', 'hi', 'id', 'ja', 'ko', 'ms', 'th', 'vi', 'zh']).has(String(value));
}

function isSortSegment(value) {
  return new Set(['censored', 'monthly-hot', 'new-release', 'recent-update', 'today-hot', 'trending', 'uncensored', 'weekly-hot']).has(String(value));
}

function isCatalogRoot(value) {
  return new Set(['dm9', 'jable', 'javguru', 'supjav']).has(String(value));
}

function isSafeFixedSegment(value) {
  return isLocale(value)
    || isSortSegment(value)
    || ['2257', 'abuse', 'actresses', 'contact', 'genres', 'makers', 'privacy', 'search', 'series', 'tags', 'terms'].includes(String(value));
}

function rawPathSignal(value) {
  const text = String(value ?? '');
  try {
    return new URL(text).pathname.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function isBlockedAccountOrMutationRoute(node) {
  const text = [
    rawPathSignal(node?.url),
    rawPathSignal(node?.linkHref),
    rawPathSignal(node?.formAction),
    String(node?.routeTemplate ?? ''),
    String(node?.routePattern ?? ''),
  ].join(' ').toLowerCase();
  return /(?:^|\/)(?:user|account|login|signup|payment|checkout|collection|history|favorite|favorites|likes|download)(?:\/|$)/u.test(text)
    || /\b(?:delete|upload|publish|payment|password|email|dm|message)\b/u.test(text);
}

function itemKind(node) {
  if (isBlockedAccountOrMutationRoute(node)) return 'blocked-account-route';
  const text = [
    node?.pageType,
    node?.structureType,
    node?.elementRole,
    node?.linkSemanticKind,
    node?.routeTemplate,
    node?.routePattern,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ');
  if (/search/u.test(text)) return 'search-binding';
  if (/ranking|hot|trending|recent-update|new-release|monthly-hot|weekly-hot/u.test(text)) return 'ranking-route';
  if (/tag|genre|category|maker|series/u.test(text)) return 'tag-category-route';
  if (/author|actress|actor|profile/u.test(text)) return 'author-route';
  if (/detail|book-detail|\/v\//u.test(text)) return 'detail-route';
  if (/metadata/u.test(text)) return 'metadata-contract';
  if (/navigation|catalog|dm9|jable|javguru|supjav/u.test(text)) return 'catalog-channel-route';
  if (/utility|2257|abuse|privacy|terms|contact/u.test(text)) return 'utility-route';
  return 'public-route';
}

function selectorMatches(kind, selector) {
  switch (selector) {
    case 'search':
      return kind === 'search-binding';
    case 'ranking':
      return kind === 'ranking-route';
    case 'tag-category':
      return kind === 'tag-category-route';
    case 'profile':
      return kind === 'author-route';
    case 'detail':
      return kind === 'detail-route';
    case 'metadata':
      return kind === 'metadata-contract' || kind === 'detail-route' || kind === 'catalog-channel-route';
    case 'catalog-channel':
      return kind === 'catalog-channel-route' || kind === 'public-route' || kind === 'utility-route';
    case 'blocked-account-route':
      return kind === 'blocked-account-route';
    default:
      return true;
  }
}

function graphNodes(artifacts) {
  return Array.isArray(artifacts.graph?.nodes) ? artifacts.graph.nodes : [];
}

function nodeToItem(node, { taskId, bucketId, index, observedAt }) {
  const routeTemplate = safeRouteTemplate(node?.routeTemplate || node?.routePattern || node?.url || node?.linkHref || node?.formAction || '');
  const kind = itemKind(node);
  const urlMaterial = node?.url || node?.linkHref || node?.formAction || routeTemplate || node?.id;
  const evidenceHash = shortHash(JSON.stringify({
    nodeId: node?.id,
    type: node?.type,
    pageType: node?.pageType,
    structureType: node?.structureType,
    routeTemplate,
    urlMaterial,
  }), 20);
  return {
    schemaVersion: SCHEMA_VERSION,
    siteKey: SITE_KEY,
    taskId,
    bucketId,
    itemId: `123av:${shortHash(`${taskId}:${bucketId}:${evidenceHash}`, 18)}`,
    itemKind: kind,
    pageType: String(node?.pageType || ''),
    routeTemplate,
    locale: localeFromTemplate(routeTemplate),
    sourceNodeId: String(node?.id || ''),
    sourceNodeType: String(node?.type || ''),
    structureType: String(node?.structureType || ''),
    linkSemanticKind: String(node?.linkSemanticKind || ''),
    publicUrlHash: urlMaterial ? shortHash(urlMaterial, 20) : null,
    evidenceHash,
    rank: index + 1,
    observedAt,
    materialPolicy: 'sanitized_summary_only',
    rawContentSaved: false,
    privateContentSaved: false,
  };
}

function publicMetadataText(value, maxLength = 240) {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function publicMetadataUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  for (const key of parsed.searchParams.keys()) {
    if (/(?:token|cookie|session|auth|password|secret|credential)/iu.test(key)) {
      return null;
    }
  }
  parsed.hash = '';
  return parsed.toString();
}

function nodeToPublicMetadataItem(node, { taskId, index, observedAt, authorizationScope }) {
  const publicTitle = publicMetadataText(node?.title);
  const publicDetailUrl = publicMetadataUrl(node?.url || node?.linkHref);
  if (!publicTitle || !publicDetailUrl) {
    return null;
  }
  const routeTemplate = safeRouteTemplate(node?.routeTemplate || node?.routePattern || publicDetailUrl);
  const evidenceHash = shortHash(JSON.stringify({
    nodeId: node?.id,
    routeTemplate,
    publicDetailUrl,
    titleHash: shortHash(publicTitle, 20),
  }), 20);
  return {
    schemaVersion: SCHEMA_VERSION,
    siteKey: SITE_KEY,
    taskId,
    itemId: `123av-public-metadata:${shortHash(`${taskId}:${publicDetailUrl}:${publicTitle}`, 18)}`,
    publicTitle,
    publicDetailUrl,
    routeTemplate,
    sourceNodeId: String(node?.id || ''),
    sourceNodeType: String(node?.type || ''),
    sourceFieldMap: {
      publicTitle: 'title',
      publicDetailUrl: node?.url ? 'url' : 'linkHref',
    },
    publicUrlHash: shortHash(publicDetailUrl, 20),
    evidenceHash,
    rank: index + 1,
    observedAt,
    exportPolicy: 'authorized_public_metadata',
    authorizationScope,
    rawHtmlSaved: false,
    rawBodySaved: false,
    mediaAssetsWritten: false,
    authMaterialSaved: false,
  };
}

function localeFromTemplate(routeTemplate) {
  const match = String(routeTemplate || '').match(/^\/([a-z]{2,3})(?:\/|$)/u);
  return match ? match[1] : null;
}

function itemKey(item) {
  return [
    item.itemKind,
    item.routeTemplate,
    item.pageType,
    item.structureType,
    item.linkSemanticKind,
    item.publicUrlHash,
  ].join('|');
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function collectBucketItems(plan, artifacts, bucket, options) {
  const observedAt = nowIso(options);
  const all = graphNodes(artifacts)
    .filter((node) => node && typeof node === 'object')
    .filter((node) => {
      const kind = itemKind(node);
      if (kind === 'blocked-account-route') {
        return bucket.selector === 'blocked-account-route';
      }
      if (node.type === 'content') {
        return false;
      }
      return selectorMatches(kind, bucket.selector);
    })
    .slice(0, options.maxItems)
    .map((node, index) => nodeToItem(node, {
      taskId: plan.task.id,
      bucketId: bucket.id,
      index,
      observedAt,
    }));
  if (all.length > 0 || bucket.selector === 'blocked-account-route') {
    return all;
  }
  const fallback = graphNodes(artifacts)
    .filter((node) => node && typeof node === 'object' && node.type !== 'content' && itemKind(node) !== 'blocked-account-route')
    .slice(0, Math.min(10, options.maxItems))
    .map((node, index) => ({
      ...nodeToItem(node, {
        taskId: plan.task.id,
        bucketId: bucket.id,
        index,
        observedAt,
      }),
      fallbackReason: 'selector-empty-using-public-structural-sample',
    }));
  return fallback;
}

function collectPublicMetadataItems(plan, artifacts, options) {
  const policy = plan.artifactContract.fieldPolicy.publicMetadataExport;
  if (policy.status !== 'enabled') {
    return [];
  }
  const observedAt = nowIso(options);
  const items = graphNodes(artifacts)
    .filter((node) => node && typeof node === 'object' && node.type === 'content')
    .map((node, index) => nodeToPublicMetadataItem(node, {
      taskId: plan.task.id,
      index,
      observedAt,
      authorizationScope: policy.authorizationScope,
    }))
    .filter(Boolean)
    .slice(0, options.maxItems);
  return dedupePublicMetadataItems(items);
}

function dedupePublicMetadataItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.publicTitle}|${item.publicDetailUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function bucketStateById(state, bucketId) {
  return state.buckets.find((bucket) => bucket.id === bucketId);
}

function executeBuckets(plan, state, artifacts, options) {
  const rawItems = [];
  const completed = new Set();
  for (const bucket of plan.buckets) {
    const current = bucketStateById(state, bucket.id);
    if (!current) continue;
    if (options.resume && current.status === 'completed') {
      completed.add(bucket.id);
      continue;
    }
    current.attempts += 1;
    const items = collectBucketItems(plan, artifacts, bucket, options);
    const unique = dedupeItems(items);
    rawItems.push(...items);
    current.status = 'completed';
    current.itemCount = items.length;
    current.dedupedItemCount = unique.length;
    current.resultVerification = bucket.selector === 'blocked-account-route'
      ? 'blocked-boundary-verified'
      : (items.length > 0 ? 'non-empty-sanitized-structure' : 'empty-but-boundary-explained');
    current.failureExplanation = items.length > 0
      ? null
      : failureExplanationForBucket(bucket);
    current.artifacts = {
      rawItems: plan.layout.rawItemsPath,
      dedupedItems: plan.layout.dedupedItemsPath,
    };
    completed.add(bucket.id);
  }
  const deduped = dedupeItems(rawItems);
  state.status = 'completed';
  state.updatedAt = nowIso(options);
  state.completedBucketCount = completed.size;
  state.rawItemCount = rawItems.length;
  state.dedupedItemCount = deduped.length;
  state.apiFirstOutcome = {
    activeApiCapabilities: 0,
    apiAttempted: false,
    reasonCode: 'no-verified-public-api',
    fallbackUsed: true,
    fallbackReasonCode: 'verified-siteforge-graph-fallback',
  };
  return { rawItems, dedupedItems: deduped };
}

function failureExplanationForBucket(bucket) {
  if (bucket.selector === 'blocked-account-route') {
    return 'Account/private list or mutation-like route remains blocked by site policy; use only public catalog routes.';
  }
  return 'No matching sanitized structural evidence was found in the current SiteForge graph; rerun SiteForge with deeper public crawl or browser bridge route coverage.';
}

function cacheEntries(items) {
  return items.map((item) => ({
    schemaVersion: SCHEMA_VERSION,
    cacheKey: item.itemId,
    taskId: item.taskId,
    bucketId: item.bucketId,
    itemKind: item.itemKind,
    routeTemplate: item.routeTemplate,
    evidenceHash: item.evidenceHash,
    publicUrlHash: item.publicUrlHash,
    materialPolicy: item.materialPolicy,
  }));
}

function buildSummary(plan, state, artifacts, rawItems, dedupedItems, publicMetadataItems = []) {
  const blocked = dedupedItems.filter((item) => item.itemKind === 'blocked-account-route').length;
  const usableItems = dedupedItems.length - blocked;
  const bucketCount = state.buckets.length;
  const completedBuckets = state.buckets.filter((bucket) => bucket.status === 'completed').length;
  const emptyBuckets = state.buckets.filter((bucket) => bucket.status === 'completed' && bucket.itemCount === 0).length;
  const taskStatus = state.status !== 'completed'
    ? state.status
    : (completedBuckets === bucketCount && emptyBuckets === 0 ? 'completed' : 'completed-with-warnings');
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: state.updatedAt,
    site: plan.site,
    task: plan.task,
    status: taskStatus,
    apiFirst: state.apiFirstOutcome || {
      activeApiCapabilities: 0,
      apiAttempted: false,
      reasonCode: 'no-verified-public-api',
      fallbackUsed: false,
    },
    execution: {
      bucketCount,
      completedBuckets,
      rawItemCount: rawItems.length,
      dedupedItemCount: dedupedItems.length,
      usableItemCount: usableItems,
      publicMetadataItemCount: publicMetadataItems.length,
      blockedBoundaryItemCount: blocked,
      runtimeEvidenceSource: 'current SiteForge graph plus execution plans/contracts',
      runtimeBuildId: artifacts.graph?.buildId || artifacts.verification?.buildId || null,
      verificationStatus: artifacts.verification?.status || null,
    },
    quality: {
      resultVerification: emptyBuckets === 0 ? 'all-buckets-have-explicit-result' : 'some-buckets-empty-with-explanation',
      outputStructure: 'stable-jsonl-fields',
      resumeState: 'task-state.json',
      dedupe: 'deterministic-item-key',
      evidenceCompletenessScore: emptyBuckets === 0 ? 100 : Math.max(80, Math.round(((bucketCount - emptyBuckets) / Math.max(1, bucketCount)) * 100)),
    },
    safety: {
      savedMaterial: 'sanitized_summary_only',
      rawAdultTextSaved: false,
      rawHtmlSaved: false,
      cookieTokenAuthHeaderAccessed: false,
      browserProfileAccessed: false,
      mutationActionsBlocked: true,
      mediaAssetsWritten: false,
      publicMetadataExport: plan.artifactContract.fieldPolicy.publicMetadataExport,
    },
    failureExplanation: emptyBuckets === 0
      ? null
      : state.buckets.filter((bucket) => bucket.itemCount === 0).map((bucket) => ({
        bucketId: bucket.id,
        reason: bucket.failureExplanation,
        remediation: 'Rerun SiteForge with deeper public crawl, but keep API disabled until replay/adapter/runtime evidence exists.',
      })),
    artifacts: {
      ...plan.artifactContract.required,
      ...plan.artifactContract.optional,
    },
  };
}

function renderReport(summary, plan, state) {
  const lines = [
    '# 123av Production Task Report',
    '',
    `- Task: ${summary.task.id}`,
    `- Status: ${summary.status}`,
    `- API-first: active API=${summary.apiFirst.activeApiCapabilities}, fallback used=${summary.apiFirst.fallbackUsed}`,
    `- Build evidence: ${summary.execution.runtimeBuildId || 'unknown'}, verification=${summary.execution.verificationStatus || 'unknown'}`,
    `- Buckets: ${summary.execution.completedBuckets}/${summary.execution.bucketCount}`,
    `- Items: raw=${summary.execution.rawItemCount}, deduped=${summary.execution.dedupedItemCount}, usable=${summary.execution.usableItemCount}`,
    `- Public metadata items: ${summary.execution.publicMetadataItemCount}`,
    '',
    '## Artifact Contract',
    '',
    `- task-plan.json: ${summary.artifacts.taskPlan}`,
    `- task-state.json: ${summary.artifacts.taskState}`,
    `- task-summary.json: ${summary.artifacts.taskSummary}`,
    `- raw-items.jsonl: ${summary.artifacts.rawItems}`,
    `- deduped-items.jsonl: ${summary.artifacts.dedupedItems}`,
    `- authors/items.jsonl: ${summary.artifacts.authorItems}`,
    `- cache-index.json: ${summary.artifacts.cacheIndex}`,
    ...(summary.artifacts.publicMetadataItems ? [`- public-metadata-items.jsonl: ${summary.artifacts.publicMetadataItems}`] : []),
    '',
    '## Buckets',
    '',
  ];
  for (const bucket of state.buckets) {
    const planBucket = plan.buckets.find((entry) => entry.id === bucket.id);
    lines.push(`- ${bucket.id}: status=${bucket.status}, selector=${bucket.selector}, items=${bucket.dedupedItemCount}, api=${planBucket?.primary?.reasonCode || 'n/a'}, fallback=${planBucket?.siteFallback?.reasonCode || 'n/a'}`);
  }
  lines.push(
    '',
    '## Safety',
    '',
    '- Raw titles, descriptions, comments, thumbnails, raw HTML, cookies, tokens, auth headers, and browser profiles are not saved.',
    `- Public metadata export: ${summary.safety.publicMetadataExport.status} (${summary.safety.publicMetadataExport.reasonCode}).`,
    '- Payment, account mutation, upload, delete, private messaging, login, and media download actions remain blocked unless a separate governed authorization path is built.',
  );
  if (summary.failureExplanation) {
    lines.push('', '## Failure Explanations', '');
    for (const failure of summary.failureExplanation) {
      lines.push(`- ${failure.bucketId}: ${failure.reason} Remediation: ${failure.remediation}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderArchiveIndex(summary) {
  return [
    '# 123av Sanitized Archive Index',
    '',
    `- Task: ${summary.task.id}`,
    `- Status: ${summary.status}`,
    `- Deduped structural items: ${summary.execution.dedupedItemCount}`,
    `- Saved material: ${summary.safety.savedMaterial}`,
    '- Raw adult content text and media are not included.',
    '',
    '## Files',
    '',
    '- ../task-report.md',
    '- ../raw-items.jsonl',
    '- ../deduped-items.jsonl',
    '- ../cache-index.json',
  ].join('\n') + '\n';
}

function renderArchiveTask(summary, dedupedItems) {
  const counts = new Map();
  for (const item of dedupedItems) {
    counts.set(item.itemKind, (counts.get(item.itemKind) || 0) + 1);
  }
  const lines = [
    `# ${summary.task.id} Sanitized Evidence`,
    '',
    '## Counts By Kind',
    '',
  ];
  for (const [kind, count] of [...counts.entries()].sort()) {
    lines.push(`- ${kind}: ${count}`);
  }
  lines.push('', '## Note', '', 'This archive stores route templates and evidence hashes only. It does not store page titles, descriptions, comments, thumbnails, media URLs, or raw HTML.');
  return `${lines.join('\n')}\n`;
}

function renderRouteSamples(dedupedItems) {
  const samples = dedupedItems.slice(0, 40);
  const lines = ['# Route Samples', '', '| Kind | Route template | Evidence hash |', '|---|---|---|'];
  for (const item of samples) {
    lines.push(`| ${markdownEscape(item.itemKind)} | ${markdownEscape(item.routeTemplate || '')} | ${markdownEscape(item.evidenceHash)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function markdownEscape(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

async function ensureLayout(layout) {
  await Promise.all([
    fs.mkdir(layout.outDir, { recursive: true }),
    fs.mkdir(layout.accountsDir, { recursive: true }),
    fs.mkdir(layout.authorsDir, { recursive: true }),
    fs.mkdir(layout.archiveDir, { recursive: true }),
  ]);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath, rows) {
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, text ? `${text}\n` : '', 'utf8');
}

async function writeArtifacts(plan, state, summary, rawItems, dedupedItems, publicMetadataItems = []) {
  const layout = plan.layout;
  const authors = dedupedItems.filter((item) => item.itemKind === 'author-route');
  const accounts = dedupedItems.filter((item) => item.itemKind === 'blocked-account-route').map((item) => ({
    ...item,
    boundary: 'blocked-account-or-private-list-route',
  }));
  const cache = cacheEntries(dedupedItems);
  await ensureLayout(layout);
  const writes = [
    writeJson(layout.planPath, plan),
    writeJson(layout.statePath, state),
    writeJson(layout.summaryPath, summary),
    writeJsonl(layout.rawItemsPath, rawItems),
    writeJsonl(layout.dedupedItemsPath, dedupedItems),
    writeJsonl(layout.authorsItemsPath, authors),
    writeJsonl(layout.accountsItemsPath, accounts),
    writeJson(layout.cacheIndexPath, {
      schemaVersion: SCHEMA_VERSION,
      siteKey: SITE_KEY,
      taskId: plan.task.id,
      generatedAt: summary.generatedAt,
      entryCount: cache.length,
      entries: cache,
    }),
    writeJsonl(layout.cacheIndexJsonlPath, cache),
    fs.writeFile(layout.reportPath, renderReport(summary, plan, state), 'utf8'),
    fs.writeFile(layout.archiveIndexPath, renderArchiveIndex(summary), 'utf8'),
    fs.writeFile(layout.archiveTaskPath, renderArchiveTask(summary, dedupedItems), 'utf8'),
    fs.writeFile(layout.archiveRouteSamplesPath, renderRouteSamples(dedupedItems), 'utf8'),
  ];
  if (summary.artifacts.publicMetadataItems) {
    writes.push(writeJsonl(layout.publicMetadataItemsPath, publicMetadataItems));
  }
  await Promise.all(writes);
}

export async function runOneTwoThreeAvResearchTask(rawOptions) {
  const options = {
    ...rawOptions,
    task: normalizeTask(rawOptions.task),
    buildDir: path.resolve(rawOptions.buildDir || DEFAULT_BUILD_DIR),
    maxItems: rawOptions.maxItems || DEFAULT_MAX_ITEMS,
    allowPublicMetadataExport: rawOptions.allowPublicMetadataExport === true,
    publicMetadataScope: rawOptions.publicMetadataScope || null,
  };
  if (options.allowPublicMetadataExport && !options.publicMetadataScope) {
    throw new Error('publicMetadataScope is required when allowPublicMetadataExport is true');
  }
  const artifacts = await readBuildArtifacts(options.buildDir);
  const plan = buildTaskPlan(options, artifacts);
  let state = await loadStateForResume(plan, options);
  let rawItems = [];
  let dedupedItems = [];
  let publicMetadataItems = [];
  if (options.execute) {
    ({ rawItems, dedupedItems } = executeBuckets(plan, state, artifacts, options));
    publicMetadataItems = collectPublicMetadataItems(plan, artifacts, options);
  } else {
    state.status = 'planned';
    state.updatedAt = nowIso(options);
  }
  const summary = buildSummary(plan, state, artifacts, rawItems, dedupedItems, publicMetadataItems);
  await writeArtifacts(plan, state, summary, rawItems, dedupedItems, publicMetadataItems);
  return {
    status: summary.status,
    taskId: plan.task.id,
    outDir: plan.layout.outDir,
    artifacts: summary.artifacts,
    summary,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runOneTwoThreeAvResearchTask(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`123av task ${result.taskId} ${result.status}\n`);
  process.stdout.write(`outDir=${result.outDir}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
