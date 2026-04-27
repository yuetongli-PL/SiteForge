// @ts-check

import path from 'node:path';

import { readSiteCapabilities } from '../catalog/capabilities.mjs';
import { readSiteRegistry } from '../catalog/registry.mjs';
import {
  inferHostFromDownloadRequest,
  inferSiteKeyFromHost,
  normalizeDownloadResource,
  normalizeDownloadTaskPlan,
  normalizeResolvedDownloadTask,
} from './contracts.mjs';

export const DEFAULT_DOWNLOAD_SITE_DEFINITIONS = Object.freeze([
  {
    siteKey: '22biqu',
    host: 'www.22biqu.com',
    adapterId: 'chapter-content',
    taskType: 'book',
    taskTypes: ['book'],
    sessionRequirement: 'none',
    resolverMethod: 'legacy-python-book',
    legacyEntrypoint: 'src/sites/chapter-content/download/python/book.py',
    legacyExecutorKind: 'python',
  },
  {
    siteKey: 'bilibili',
    host: 'www.bilibili.com',
    adapterId: 'bilibili',
    taskType: 'video',
    taskTypes: ['video', 'media-bundle'],
    sessionRequirement: 'optional',
    resolverMethod: 'legacy-bilibili-action',
    legacyEntrypoint: 'src/entrypoints/sites/bilibili-action.mjs',
    legacyExecutorKind: 'node',
  },
  {
    siteKey: 'douyin',
    host: 'www.douyin.com',
    adapterId: 'douyin',
    taskType: 'video',
    taskTypes: ['video', 'media-bundle'],
    sessionRequirement: 'optional',
    resolverMethod: 'legacy-douyin-action',
    legacyEntrypoint: 'src/entrypoints/sites/douyin-action.mjs',
    legacyExecutorKind: 'node',
  },
  {
    siteKey: 'xiaohongshu',
    host: 'www.xiaohongshu.com',
    adapterId: 'xiaohongshu',
    taskType: 'image-note',
    taskTypes: ['image-note', 'media-bundle'],
    sessionRequirement: 'optional',
    resolverMethod: 'legacy-xiaohongshu-action',
    legacyEntrypoint: 'src/entrypoints/sites/xiaohongshu-action.mjs',
    legacyExecutorKind: 'node',
  },
  {
    siteKey: 'x',
    host: 'x.com',
    adapterId: 'x',
    taskType: 'social-archive',
    taskTypes: ['social-archive', 'media-bundle'],
    sessionRequirement: 'optional',
    resolverMethod: 'legacy-social-action',
    legacyEntrypoint: 'src/entrypoints/sites/x-action.mjs',
    legacyExecutorKind: 'node',
  },
  {
    siteKey: 'instagram',
    host: 'www.instagram.com',
    adapterId: 'instagram',
    taskType: 'social-archive',
    taskTypes: ['social-archive', 'media-bundle'],
    sessionRequirement: 'required',
    resolverMethod: 'legacy-social-action',
    legacyEntrypoint: 'src/entrypoints/sites/instagram-action.mjs',
    legacyExecutorKind: 'node',
  },
]);

function normalizeDefinition(definition = {}) {
  const siteKey = definition.siteKey ?? inferSiteKeyFromHost(definition.host);
  return {
    ...definition,
    siteKey,
    host: definition.host ?? siteKey,
    adapterId: definition.adapterId ?? siteKey,
    taskType: definition.taskType ?? 'generic-resource',
    taskTypes: Array.isArray(definition.taskTypes) ? definition.taskTypes : [definition.taskType ?? 'generic-resource'],
    sessionRequirement: definition.sessionRequirement ?? 'none',
    resolverMethod: definition.resolverMethod ?? definition.downloadResolverMethod ?? 'resolve-download-resources',
    legacyEntrypoint: definition.legacyEntrypoint ?? definition.downloadEntrypoint ?? null,
    legacyExecutorKind: definition.legacyExecutorKind ?? definition.scriptLanguage ?? null,
  };
}

function definitionKeyCandidates(definition = {}) {
  return [
    definition.siteKey,
    definition.host,
    definition.adapterId,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

function requestKeyCandidates(request = {}) {
  const host = inferHostFromDownloadRequest(request);
  return [
    request.siteKey,
    request.site,
    request.host,
    request.adapterId,
    host,
    host ? inferSiteKeyFromHost(host) : null,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
}

function mergeRegistryDefinition(base, registryRecord = {}, capabilitiesRecord = {}) {
  return normalizeDefinition({
    ...base,
    host: registryRecord.host ?? capabilitiesRecord.host ?? base.host,
    siteKey: registryRecord.siteKey ?? capabilitiesRecord.siteKey ?? base.siteKey,
    adapterId: registryRecord.adapterId ?? capabilitiesRecord.adapterId ?? base.adapterId,
    canonicalBaseUrl: registryRecord.canonicalBaseUrl ?? capabilitiesRecord.baseUrl ?? base.canonicalBaseUrl,
    downloadEntrypoint: registryRecord.downloadEntrypoint ?? base.legacyEntrypoint,
    legacyEntrypoint: registryRecord.downloadEntrypoint ?? base.legacyEntrypoint,
    downloadPlanner: registryRecord.downloadPlanner ?? base.downloadPlanner,
    downloadResolver: registryRecord.downloadResolver ?? base.downloadResolver,
    downloadExecutor: registryRecord.downloadExecutor ?? base.downloadExecutor,
    capabilityFamilies: [
      ...(base.capabilityFamilies ?? []),
      ...(registryRecord.capabilityFamilies ?? []),
      ...(capabilitiesRecord.capabilityFamilies ?? []),
    ],
    supportedIntents: [
      ...(base.supportedIntents ?? []),
      ...(capabilitiesRecord.supportedIntents ?? []),
    ],
  });
}

export async function listDownloadSiteDefinitions(workspaceRoot = process.cwd(), pathOptions = {}) {
  const [registry, capabilities] = await Promise.all([
    readSiteRegistry(workspaceRoot, pathOptions),
    readSiteCapabilities(workspaceRoot, pathOptions),
  ]);
  const byHost = new Map(DEFAULT_DOWNLOAD_SITE_DEFINITIONS.map((definition) => [definition.host, normalizeDefinition(definition)]));
  for (const [host, registryRecord] of Object.entries(registry?.sites ?? {})) {
    const capabilitiesRecord = capabilities?.sites?.[host] ?? {};
    const hasDownloadCapability = [
      ...(registryRecord.capabilityFamilies ?? []),
      ...(capabilitiesRecord.capabilityFamilies ?? []),
    ].includes('download-content');
    const hasDownloadEntrypoint = Boolean(registryRecord.downloadEntrypoint);
    if (!hasDownloadCapability && !hasDownloadEntrypoint && !byHost.has(host)) {
      continue;
    }
    byHost.set(host, mergeRegistryDefinition(byHost.get(host) ?? { host }, registryRecord, capabilitiesRecord));
  }
  return [...byHost.values()].sort((left, right) => left.siteKey.localeCompare(right.siteKey, 'en'));
}

export async function resolveDownloadSiteDefinition(request = {}, options = {}) {
  if (options.definition) {
    return normalizeDefinition(options.definition);
  }
  const definitions = options.definitions ?? await listDownloadSiteDefinitions(
    options.workspaceRoot ?? process.cwd(),
    options.siteMetadataOptions ?? {},
  );
  const requestKeys = new Set(requestKeyCandidates(request));
  const matched = definitions.find((definition) => definitionKeyCandidates(definition).some((key) => requestKeys.has(key)));
  if (matched) {
    return matched;
  }
  const host = inferHostFromDownloadRequest(request);
  if (host) {
    return normalizeDefinition({
      siteKey: inferSiteKeyFromHost(host),
      host,
      adapterId: inferSiteKeyFromHost(host),
      taskType: request.taskType ?? 'generic-resource',
      taskTypes: [request.taskType ?? 'generic-resource'],
      sessionRequirement: 'none',
    });
  }
  throw new Error('Download request requires --site, --host, or an input URL with a host.');
}

function requestResources(request = {}) {
  const resources = [
    ...(Array.isArray(request.resources) ? request.resources : []),
    ...(Array.isArray(request.resourceUrls) ? request.resourceUrls.map((url) => ({ url })) : []),
  ];
  if (request.resourceUrl) {
    resources.push({ url: request.resourceUrl });
  }
  return resources;
}

export async function createDownloadPlan(request = {}, context = {}) {
  const definition = context.definition ?? await resolveDownloadSiteDefinition(request, context);
  const requestedTaskType = request.taskType ?? request.download?.taskType;
  const taskType = requestedTaskType && definition.taskTypes.includes(requestedTaskType)
    ? requestedTaskType
    : definition.taskType;
  const sourceInput = request.input ?? request.inputUrl ?? request.url ?? request.account ?? request.title ?? definition.canonicalBaseUrl ?? '';
  return normalizeDownloadTaskPlan({
    ...request,
    siteKey: definition.siteKey,
    host: definition.host,
    taskType,
    source: {
      input: sourceInput,
      canonicalUrl: request.canonicalUrl ?? request.url ?? request.inputUrl ?? definition.canonicalBaseUrl,
      account: request.account,
      title: request.title,
    },
    sessionRequirement: request.sessionRequirement ?? definition.sessionRequirement,
    resolver: {
      adapterId: definition.adapterId,
      method: definition.resolverMethod,
    },
    output: {
      root: request.outDir ?? request.outputRoot,
      runDir: request.runDir,
      namingStrategy: request.namingStrategy,
    },
    policy: {
      dryRun: request.dryRun !== undefined ? request.dryRun : true,
      concurrency: request.concurrency,
      retries: request.retries,
      retryBackoffMs: request.retryBackoffMs,
      skipExisting: request.skipExisting,
      verify: request.verify,
      maxItems: request.maxItems,
    },
    legacy: definition.legacyEntrypoint ? {
      entrypoint: definition.legacyEntrypoint,
      executorKind: definition.legacyExecutorKind,
      commandHint: definition.legacyExecutorKind === 'node'
        ? `node ${definition.legacyEntrypoint} download <target>`
        : `${definition.legacyExecutorKind ?? 'python'} ${definition.legacyEntrypoint}`,
    } : undefined,
    metadata: {
      definition,
      resourcesProvided: requestResources(request).length,
    },
  });
}

export async function resolveDownloadResources(plan, sessionLease = null, context = {}) {
  const request = context.request ?? {};
  const resources = requestResources(request).map((resource, index) => normalizeDownloadResource({
    mediaType: request.mediaType,
    headers: sessionLease?.headers ?? {},
    ...resource,
    fileName: resource.fileName ?? request.fileName ?? (path.basename(resource.url ?? '') || undefined),
  }, index));
  return normalizeResolvedDownloadTask({
    planId: plan.id,
    siteKey: plan.siteKey,
    taskType: plan.taskType,
    resources,
    metadata: {
      resolver: plan.resolver,
      legacy: plan.legacy,
    },
    completeness: {
      expectedCount: resources.length,
      resolvedCount: resources.length,
      complete: resources.length > 0,
      reason: resources.length > 0 ? 'resources-provided' : 'legacy-downloader-required',
    },
  }, plan);
}
