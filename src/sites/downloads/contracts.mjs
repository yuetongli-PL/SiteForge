// @ts-check

import path from 'node:path';
import { createHash } from 'node:crypto';

import { compactSlug, hostFromUrl, normalizeText, sanitizeHost } from '../../shared/normalize.mjs';

export const DOWNLOAD_TASK_TYPES = Object.freeze([
  'book',
  'video',
  'image-note',
  'media-bundle',
  'social-archive',
  'generic-resource',
]);

export const SESSION_REQUIREMENTS = Object.freeze([
  'none',
  'optional',
  'required',
]);

export const SESSION_LEASE_STATUSES = Object.freeze([
  'ready',
  'blocked',
  'manual-required',
  'expired',
]);

export const SESSION_LEASE_MODES = Object.freeze([
  'anonymous',
  'reusable-profile',
  'authenticated',
]);

export const DOWNLOAD_RESOURCE_MEDIA_TYPES = Object.freeze([
  'text',
  'image',
  'video',
  'audio',
  'json',
  'binary',
]);

export const DOWNLOAD_RUN_STATUSES = Object.freeze([
  'passed',
  'partial',
  'failed',
  'blocked',
  'skipped',
]);

export const DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION = 1;

function valueOrDefault(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function enumValue(value, allowed, fallback) {
  const normalized = normalizeText(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeStringMap(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey || entryValue === undefined || entryValue === null) {
      continue;
    }
    result[normalizedKey] = String(entryValue);
  }
  return result;
}

function normalizeStringList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => normalizeText(entry))
    .filter(Boolean))];
}

export function stableId(parts = []) {
  return createHash('sha1')
    .update(parts.map((part) => normalizeText(part)).join('\n'))
    .digest('hex')
    .slice(0, 12);
}

export function timestampForRun(date = new Date()) {
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

export function inferSiteKeyFromHost(host) {
  const normalizedHost = sanitizeHost(String(host ?? '').toLowerCase());
  switch (normalizedHost) {
    case 'www.22biqu.com':
      return '22biqu';
    case 'www.bilibili.com':
      return 'bilibili';
    case 'www.douyin.com':
      return 'douyin';
    case 'www.xiaohongshu.com':
      return 'xiaohongshu';
    case 'x.com':
    case 'www.x.com':
      return 'x';
    case 'www.instagram.com':
    case 'instagram.com':
      return 'instagram';
    default:
      return normalizedHost;
  }
}

export function inferHostFromDownloadRequest(request = {}) {
  const explicitHost = normalizeText(request.host);
  if (explicitHost) {
    return sanitizeHost(explicitHost.toLowerCase());
  }
  const inputUrl = normalizeText(request.inputUrl ?? request.url ?? request.input ?? request.source?.canonicalUrl);
  return inputUrl ? hostFromUrl(inputUrl) : null;
}

export function createDownloadPlanId({ siteKey, taskType, input, seed = null } = {}) {
  const slug = compactSlug([siteKey, taskType, input].filter(Boolean).join('-'), 'download', 72);
  return `${slug}-${stableId([siteKey, taskType, input, seed])}`;
}

export function normalizeSessionLease(raw = {}, defaults = {}) {
  const siteKey = normalizeText(raw.siteKey ?? defaults.siteKey ?? inferSiteKeyFromHost(raw.host ?? defaults.host));
  const host = sanitizeHost(normalizeText(raw.host ?? defaults.host ?? siteKey));
  return {
    siteKey,
    host,
    mode: enumValue(raw.mode, SESSION_LEASE_MODES, defaults.mode ?? 'anonymous'),
    status: enumValue(raw.status, SESSION_LEASE_STATUSES, defaults.status ?? 'ready'),
    browserProfileRoot: normalizeText(raw.browserProfileRoot ?? defaults.browserProfileRoot) || undefined,
    userDataDir: normalizeText(raw.userDataDir ?? defaults.userDataDir) || undefined,
    headers: normalizeStringMap(raw.headers ?? defaults.headers),
    cookies: Array.isArray(raw.cookies ?? defaults.cookies) ? [...(raw.cookies ?? defaults.cookies)] : [],
    riskSignals: normalizeStringList(raw.riskSignals ?? defaults.riskSignals),
    expiresAt: normalizeText(raw.expiresAt ?? defaults.expiresAt) || undefined,
    quarantineKey: normalizeText(raw.quarantineKey ?? defaults.quarantineKey) || undefined,
    reason: normalizeText(raw.reason ?? defaults.reason) || undefined,
    purpose: normalizeText(raw.purpose ?? defaults.purpose) || undefined,
  };
}

export function createAnonymousSessionLease({ siteKey, host, purpose } = {}) {
  return normalizeSessionLease({
    siteKey,
    host,
    mode: 'anonymous',
    status: 'ready',
    riskSignals: [],
    purpose,
  });
}

export function createBlockedSessionLease({ siteKey, host, purpose, status = 'blocked', reason, riskSignals = [] } = {}) {
  return normalizeSessionLease({
    siteKey,
    host,
    mode: 'reusable-profile',
    status,
    reason,
    riskSignals,
    purpose,
  });
}

export function normalizeDownloadTaskPlan(raw = {}, defaults = {}) {
  const siteKey = normalizeText(raw.siteKey ?? defaults.siteKey ?? inferSiteKeyFromHost(raw.host ?? defaults.host));
  const taskType = enumValue(raw.taskType ?? defaults.taskType, DOWNLOAD_TASK_TYPES, 'generic-resource');
  const sourceInput = normalizeText(
    raw.source?.input
      ?? raw.input
      ?? raw.inputUrl
      ?? raw.url
      ?? raw.account
      ?? defaults.input
      ?? defaults.inputUrl
      ?? '',
  );
  const id = normalizeText(raw.id ?? defaults.id) || createDownloadPlanId({
    siteKey,
    taskType,
    input: sourceInput,
    seed: raw.createdAt ?? defaults.createdAt ?? '',
  });
  const sessionRequirement = enumValue(
    raw.sessionRequirement ?? defaults.sessionRequirement,
    SESSION_REQUIREMENTS,
    'none',
  );
  return {
    id,
    siteKey,
    host: sanitizeHost(normalizeText(raw.host ?? defaults.host ?? inferHostFromDownloadRequest(raw) ?? siteKey)),
    taskType,
    source: {
      input: sourceInput,
      canonicalUrl: normalizeText(raw.source?.canonicalUrl ?? raw.canonicalUrl ?? raw.inputUrl ?? raw.url) || undefined,
      account: normalizeText(raw.source?.account ?? raw.account ?? defaults.account) || undefined,
      title: normalizeText(raw.source?.title ?? raw.title ?? defaults.title) || undefined,
    },
    sessionRequirement,
    resolver: {
      adapterId: normalizeText(raw.resolver?.adapterId ?? defaults.resolver?.adapterId ?? siteKey),
      method: normalizeText(raw.resolver?.method ?? defaults.resolver?.method ?? 'resolve-download-resources'),
    },
    output: {
      root: normalizeText(raw.output?.root ?? raw.outDir ?? defaults.output?.root) || undefined,
      runDir: normalizeText(raw.output?.runDir ?? raw.runDir ?? defaults.output?.runDir) || undefined,
      namingStrategy: normalizeText(raw.output?.namingStrategy ?? defaults.output?.namingStrategy) || undefined,
    },
    policy: {
      dryRun: Boolean(raw.policy?.dryRun ?? raw.dryRun ?? defaults.policy?.dryRun ?? true),
      concurrency: Number(valueOrDefault(raw.policy?.concurrency ?? raw.concurrency, defaults.policy?.concurrency ?? 4)),
      retries: Number(valueOrDefault(raw.policy?.retries ?? raw.retries, defaults.policy?.retries ?? 2)),
      retryBackoffMs: Number(valueOrDefault(raw.policy?.retryBackoffMs ?? raw.retryBackoffMs, defaults.policy?.retryBackoffMs ?? 1_000)),
      skipExisting: Boolean(raw.policy?.skipExisting ?? raw.skipExisting ?? defaults.policy?.skipExisting ?? true),
      verify: Boolean(raw.policy?.verify ?? raw.verify ?? defaults.policy?.verify ?? true),
      maxItems: Number(valueOrDefault(raw.policy?.maxItems ?? raw.maxItems, defaults.policy?.maxItems ?? 0)),
    },
    resume: raw.resume ?? defaults.resume ?? undefined,
    legacy: raw.legacy ?? defaults.legacy ?? undefined,
    metadata: {
      ...(defaults.metadata ?? {}),
      ...(raw.metadata ?? {}),
    },
  };
}

function normalizeFileName(fileName, fallback = 'download.bin') {
  const normalized = normalizeText(fileName).replace(/[<>:"/\\|?*\x00-\x1F]+/gu, '-').replace(/-+/gu, '-').trim();
  return normalized || fallback;
}

export function normalizeDownloadResource(raw = {}, index = 0) {
  const url = normalizeText(raw.url);
  const sourceUrl = normalizeText(raw.sourceUrl ?? raw.referer);
  const id = normalizeText(raw.id) || stableId([url, sourceUrl, raw.fileName, index]);
  const parsedPathName = (() => {
    try {
      return path.basename(new URL(url).pathname);
    } catch {
      return '';
    }
  })();
  return {
    id,
    url,
    method: enumValue(raw.method, ['GET', 'POST'], 'GET'),
    headers: normalizeStringMap(raw.headers),
    body: raw.body === undefined || raw.body === null ? undefined : String(raw.body),
    fileName: normalizeFileName(raw.fileName ?? parsedPathName, `${id}.bin`),
    mediaType: enumValue(raw.mediaType, DOWNLOAD_RESOURCE_MEDIA_TYPES, 'binary'),
    sourceUrl: sourceUrl || undefined,
    referer: normalizeText(raw.referer ?? sourceUrl) || undefined,
    expectedBytes: raw.expectedBytes === undefined ? undefined : Number(raw.expectedBytes),
    expectedHash: normalizeText(raw.expectedHash) || undefined,
    priority: raw.priority === undefined ? index : Number(raw.priority),
    groupId: normalizeText(raw.groupId) || undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {},
  };
}

export function normalizeResolvedDownloadTask(raw = {}, plan = {}) {
  const resources = (Array.isArray(raw.resources) ? raw.resources : [])
    .map((resource, index) => normalizeDownloadResource(resource, index))
    .filter((resource) => resource.url);
  const expectedCount = raw.completeness?.expectedCount ?? raw.expectedCount ?? resources.length;
  return {
    planId: normalizeText(raw.planId ?? plan.id),
    siteKey: normalizeText(raw.siteKey ?? plan.siteKey),
    taskType: normalizeText(raw.taskType ?? plan.taskType),
    resources,
    groups: Array.isArray(raw.groups) ? raw.groups : [],
    metadata: raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {},
    completeness: {
      expectedCount,
      resolvedCount: raw.completeness?.resolvedCount ?? resources.length,
      complete: Boolean(raw.completeness?.complete ?? (resources.length >= Number(expectedCount || 0))),
      reason: normalizeText(raw.completeness?.reason ?? raw.reason) || undefined,
    },
  };
}

export function resolveDownloadRunStatus({ expected = 0, attempted = 0, downloaded = 0, failed = 0, skipped = 0, blocked = false, dryRun = false } = {}) {
  if (blocked) {
    return 'blocked';
  }
  if (dryRun) {
    return 'skipped';
  }
  if (failed > 0 && downloaded > 0) {
    return 'partial';
  }
  if (failed > 0) {
    return 'failed';
  }
  if (expected > 0 && downloaded + skipped < expected) {
    return attempted > 0 || downloaded > 0 ? 'partial' : 'skipped';
  }
  return 'passed';
}

export function normalizeDownloadRunStatus(value, context = {}) {
  const normalized = normalizeText(value).toLowerCase();
  const aliases = {
    ok: 'passed',
    success: 'passed',
    successful: 'passed',
    complete: 'passed',
    completed: 'passed',
    done: 'passed',
    warning: 'partial',
    warnings: 'partial',
    degraded: 'partial',
    bounded: 'partial',
    incomplete: 'partial',
    error: 'failed',
    failure: 'failed',
    auth: 'blocked',
    'blocked-auth': 'blocked',
    'blocked-risk': 'blocked',
    manual: 'blocked',
    pending: 'skipped',
    planned: 'skipped',
    'dry-run': 'skipped',
    noop: 'skipped',
  };
  const aliased = aliases[normalized] ?? normalized;
  return enumValue(aliased, DOWNLOAD_RUN_STATUSES, resolveDownloadRunStatus(context));
}

export function normalizeDownloadRunReason(value, status = undefined) {
  const reason = normalizeText(value);
  if (!reason) {
    return undefined;
  }
  if (
    status === 'passed'
    && ['ok', 'passed', 'success', 'successful', 'complete', 'completed', 'done'].includes(reason.toLowerCase())
  ) {
    return undefined;
  }
  return reason;
}

function normalizeArtifactRefs(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result = {};
  for (const [key, artifactValue] of Object.entries(value)) {
    if (artifactValue === undefined || artifactValue === null || artifactValue === '') {
      continue;
    }
    if (artifactValue && typeof artifactValue === 'object' && !Array.isArray(artifactValue)) {
      const nested = normalizeArtifactRefs(artifactValue);
      if (nested && Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      continue;
    }
    result[key] = String(artifactValue);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function normalizeDownloadRunArtifacts(raw = {}, context = {}) {
  const artifactInput = raw && typeof raw === 'object' ? raw : {};
  const contextInput = context && typeof context === 'object' ? context : {};
  const result = {
    manifest: normalizeText(artifactInput.manifest ?? contextInput.manifest) || undefined,
    queue: normalizeText(artifactInput.queue ?? contextInput.queue) || undefined,
    downloadsJsonl: normalizeText(artifactInput.downloadsJsonl ?? contextInput.downloadsJsonl) || undefined,
    reportMarkdown: normalizeText(artifactInput.reportMarkdown ?? contextInput.reportMarkdown) || undefined,
    plan: normalizeText(artifactInput.plan ?? contextInput.plan) || undefined,
    resolvedTask: normalizeText(artifactInput.resolvedTask ?? contextInput.resolvedTask) || undefined,
    runDir: normalizeText(artifactInput.runDir ?? contextInput.runDir) || undefined,
    filesDir: normalizeText(artifactInput.filesDir ?? contextInput.filesDir) || undefined,
  };
  const source = normalizeArtifactRefs(artifactInput.source ?? contextInput.source);
  if (source) {
    result.source = source;
  }
  return result;
}

export function normalizeDownloadRunManifest(raw = {}, context = {}) {
  const counts = {
    expected: Number(raw.counts?.expected ?? context.expected ?? 0),
    attempted: Number(raw.counts?.attempted ?? context.attempted ?? 0),
    downloaded: Number(raw.counts?.downloaded ?? context.downloaded ?? 0),
    skipped: Number(raw.counts?.skipped ?? context.skipped ?? 0),
    failed: Number(raw.counts?.failed ?? context.failed ?? 0),
  };
  const status = normalizeDownloadRunStatus(raw.status ?? context.status, {
    ...counts,
    blocked: raw.blocked,
    dryRun: raw.dryRun,
  });
  return {
    schemaVersion: Number(raw.schemaVersion ?? context.schemaVersion ?? DOWNLOAD_RUN_MANIFEST_SCHEMA_VERSION),
    runId: normalizeText(raw.runId ?? context.runId),
    planId: normalizeText(raw.planId ?? context.planId),
    siteKey: normalizeText(raw.siteKey ?? context.siteKey),
    status,
    reason: normalizeDownloadRunReason(raw.reason ?? context.reason, status),
    counts,
    files: Array.isArray(raw.files) ? raw.files : [],
    failedResources: Array.isArray(raw.failedResources) ? raw.failedResources : [],
    resumeCommand: normalizeText(raw.resumeCommand ?? context.resumeCommand) || undefined,
    artifacts: normalizeDownloadRunArtifacts(raw.artifacts, context.artifacts),
    legacy: raw.legacy ?? context.legacy ?? undefined,
    session: raw.session ?? context.session ?? undefined,
    createdAt: normalizeText(raw.createdAt ?? context.createdAt) || new Date().toISOString(),
    finishedAt: normalizeText(raw.finishedAt ?? context.finishedAt) || undefined,
  };
}
