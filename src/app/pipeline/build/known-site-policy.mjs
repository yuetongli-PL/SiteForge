// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  policySupportsCapabilityFamily,
} from '../../../sites/registry/core/capability-intent-mapping.mjs';
import { normalizeCapabilityId } from './capability-id.mjs';
import {
  isInternalUrl,
  normalizeUrl,
} from './models.mjs';

export const KNOWN_SITE_POLICY_SCHEMA_VERSION = 1;

const clone = jsonClone;

function cloneIfPresent(value) {
  return value === undefined ? undefined : clone(value);
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function asStringList(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : [];
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = /** @type {any[]} */ ([]);
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function capabilityIdsFromUserAuthorizedEvidence(evidence) {
  const seeds = Array.isArray(evidence?.browserSeeds) ? evidence.browserSeeds : [];
  return new Set(seeds
    .flatMap((seed) => [
      seed?.capabilityId,
      seed?.setupCapabilityId,
      seed?.intentType,
      seed?.action,
      ...(Array.isArray(seed?.capabilityIds) ? seed.capabilityIds : []),
    ])
    .map(normalizeCapabilityId)
    .filter(Boolean));
}

export function knownGenericLiveBuildSummary(registryRecord, capabilityRecord) {
  const registryGeneric = registryRecord?.genericLiveBuild && typeof registryRecord.genericLiveBuild === 'object'
    ? registryRecord.genericLiveBuild
    : {};
  const capabilityGeneric = capabilityRecord?.genericLiveBuild && typeof capabilityRecord.genericLiveBuild === 'object'
    ? capabilityRecord.genericLiveBuild
    : {};
  const registryDownloadSupport = registryRecord?.downloadSupport && typeof registryRecord.downloadSupport === 'object'
    ? registryRecord.downloadSupport
    : {};
  const capabilityDownloader = capabilityRecord?.downloader && typeof capabilityRecord.downloader === 'object'
    ? capabilityRecord.downloader
    : {};
  const alternativeAccessPaths = uniqueSortedStrings([
    ...asStringList(registryGeneric.alternativeAccessPaths),
    ...asStringList(capabilityGeneric.alternativeAccessPaths),
    ...asStringList(registryRecord?.alternativeAccessPaths),
    ...asStringList(capabilityRecord?.alternativeAccessPaths),
  ]);
  const status = firstPresent(
    registryGeneric.status,
    capabilityGeneric.status,
    registryRecord?.siteAccessStatus,
    capabilityRecord?.siteAccessStatus,
    registryDownloadSupport.liveAccessStatus,
    capabilityDownloader.liveAccessStatus,
    capabilityRecord?.liveAccessStatus,
  );
  const reasonCode = firstPresent(
    registryGeneric.reasonCode,
    capabilityGeneric.reasonCode,
    registryRecord?.unsupportedLiveReasonCode,
    capabilityRecord?.unsupportedLiveReasonCode,
    registryDownloadSupport.reasonCode,
    capabilityDownloader.reasonCode,
    registryDownloadSupport.unsupportedLiveReasonCode,
    capabilityDownloader.liveAccessReasonCode,
    capabilityDownloader.unsupportedLiveReasonCode,
    capabilityRecord?.liveAccessReasonCode,
  );
  const reason = firstPresent(
    registryGeneric.reason,
    capabilityGeneric.reason,
    registryRecord?.unsupportedLiveReason,
    capabilityRecord?.unsupportedLiveReason,
    registryDownloadSupport.reason,
    capabilityDownloader.reason,
    registryDownloadSupport.unsupportedLiveReason,
    capabilityDownloader.liveAccessReason,
    capabilityDownloader.unsupportedLiveReason,
    capabilityRecord?.liveAccessReason,
  );
  if (!status && !reasonCode && !reason && alternativeAccessPaths.length === 0) {
    return null;
  }
  return {
    status,
    reasonCode,
    reason,
    alternativeAccessPaths,
  };
}

function explicitPublicRouteTemplates(...records) {
  return records.flatMap((record) => (
    Array.isArray(record?.publicRouteTemplates)
      ? record.publicRouteTemplates
      : Array.isArray(record?.publicRoutes)
        ? record.publicRoutes
        : []
  ));
}

export function knownPolicyPublicRouteTemplates(registryRecord, capabilityRecord) {
  const explicit = explicitPublicRouteTemplates(registryRecord, capabilityRecord);
  const adapterId = String(registryRecord?.adapterId ?? capabilityRecord?.adapterId ?? '').toLowerCase();
  const archetype = String(registryRecord?.siteArchetype ?? capabilityRecord?.primaryArchetype ?? '').toLowerCase();
  const routePolicy = {
    capabilityFamilies: [
      ...(registryRecord?.capabilityFamilies ?? []),
      ...(capabilityRecord?.capabilityFamilies ?? []),
    ],
    supportedIntents: capabilityRecord?.supportedIntents ?? [],
  };
  const explicitRouteKeys = new Set(explicit
    .map((route) => String(route?.path ?? route?.route ?? route?.pathTemplate ?? route?.routeTemplate ?? '').trim())
    .filter(Boolean));
  const inferred = [];
  const addInferred = (route) => {
    const routeKey = String(route?.path ?? route?.route ?? route?.pathTemplate ?? route?.routeTemplate ?? '').trim();
    if (routeKey && !explicitRouteKeys.has(routeKey)) {
      inferred.push(route);
    }
  };
  if (adapterId === 'chapter-content' || archetype === 'chapter-content') {
    if (policySupportsCapabilityFamily(routePolicy, 'navigate-to-category')) {
      addInferred({ id: 'chapter-content-category-template', pathTemplate: '/category/{categoryId}/', pageType: 'category-page', capabilityFamilies: ['navigate-to-category'], seedable: false });
    }
    if (policySupportsCapabilityFamily(routePolicy, 'search-content')) {
      addInferred({ id: 'chapter-content-search-template', pathTemplate: '/search', pageType: 'search-results-page', capabilityFamilies: ['search-content'], seedable: false });
    }
    if (policySupportsCapabilityFamily(routePolicy, 'navigate-to-content')) {
      addInferred({ id: 'chapter-content-book-template', pathTemplate: '/book/{bookId}/', pageType: 'book-detail-page', capabilityFamilies: ['navigate-to-content'], seedable: false });
    }
    if (policySupportsCapabilityFamily(routePolicy, 'navigate-to-chapter')) {
      addInferred({ id: 'chapter-content-chapter-template', pathTemplate: '/chapter/{bookId}/{chapterId}/', pageType: 'chapter-page', capabilityFamilies: ['navigate-to-chapter'], seedable: false });
    }
  }
  const byId = new Map();
  for (const [index, route] of [...explicit, ...inferred].entries()) {
    if (!route || typeof route !== 'object') {
      continue;
    }
    const pathValue = route.path ?? route.route ?? null;
    const pathTemplate = route.pathTemplate ?? route.routeTemplate ?? null;
    if (!pathValue && !pathTemplate) {
      continue;
    }
    const id = String(route.id ?? pathValue ?? pathTemplate ?? `public-route-${index}`).trim();
    byId.set(id, {
      id,
      path: pathValue ?? null,
      pathTemplate: pathTemplate ?? null,
      pageType: route.pageType ?? null,
      capabilityFamilies: uniqueSortedStrings(route.capabilityFamilies ?? []),
      seedable: route.seedable === true && Boolean(pathValue),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

function routeTargetToUrl(context, routeTarget) {
  const value = String(routeTarget ?? '').trim();
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(normalizeUrl(value, context.site.rootUrl));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function knownPolicyPublicSeedRoutes(context) {
  const policyRoutes = context.setupProfile?.knownSitePolicy?.publicRouteTemplates ?? [];
  const contractRoutes = context.crawlContract?.coverageTargets?.publicRoutes ?? [];
  const routes = [
    ...policyRoutes
      .filter((route) => route?.seedable === true && route.path)
      .map((route) => ({
        path: route.path,
        pageType: route.pageType ?? null,
        source: 'known_site_public_route_template',
        reasonCode: 'known-site-public-route',
      })),
    ...contractRoutes.map((path) => ({
      path,
      pageType: null,
      source: 'coverage_target_public_route',
      reasonCode: 'coverage-target-public-route',
    })),
  ];
  return uniqueBy(routes
    .map((route) => {
      const normalizedUrl = routeTargetToUrl(context, route.path);
      if (!normalizedUrl || !isInternalUrl(normalizedUrl, context.site.allowedDomains)) {
        return null;
      }
      return {
        ...route,
        normalizedUrl,
      };
    })
    .filter(Boolean), (route) => route.normalizedUrl)
    .sort((left, right) => left.normalizedUrl.localeCompare(right.normalizedUrl, 'en'));
}

export function knownPolicyPublicRouteTemplatePattern(route = /** @type {any} */ ({})) {
  const raw = String(route.pathTemplate ?? route.routeTemplate ?? route.path ?? '').trim();
  if (!raw || /[?#<>"']|(?:authorization|bearer|cookie|sid|uid|token|secret|session|password)/iu.test(raw)) {
    return null;
  }
  const normalized = raw
    .replace(/\{[^}/]+\}/gu, ':id')
    .replace(/\/+/gu, '/');
  if (!normalized.startsWith('/')) {
    return null;
  }
  return normalized.length > 1 ? normalized.replace(/\/$/u, '') : normalized;
}

export function knownPolicyPublicRouteTemplatePatterns(context) {
  const policyRoutes = context.setupProfile?.knownSitePolicy?.publicRouteTemplates ?? [];
  return uniqueBy(policyRoutes
    .map((route) => {
      const pattern = knownPolicyPublicRouteTemplatePattern(route);
      if (!pattern) {
        return null;
      }
      return {
        pattern,
        pageType: route.pageType ?? null,
        source: route.seedable === true ? 'known_site_public_seed_route_template' : 'known_site_public_route_template',
        seedable: route.seedable === true,
      };
    })
    .filter(Boolean), (route) => `${route.pattern}:${route.pageType ?? ''}`)
    .sort((left, right) => left.pattern.localeCompare(right.pattern, 'en'));
}

export function knownPolicySummary(registryRecord, capabilityRecord) {
  if (!registryRecord && !capabilityRecord) {
    return null;
  }
  const capabilityFamilies = uniqueSortedStrings([
    ...(registryRecord?.capabilityFamilies ?? []),
    ...(capabilityRecord?.capabilityFamilies ?? []),
  ]);
  const pageTypes = uniqueSortedStrings([
    ...(registryRecord?.pageTypes ?? []),
    ...(capabilityRecord?.pageTypes ?? []),
  ]);
  const supportedIntents = uniqueSortedStrings(capabilityRecord?.supportedIntents ?? []);
  const safeActionKinds = uniqueSortedStrings(capabilityRecord?.safeActionKinds ?? []);
  const approvalActionKinds = uniqueSortedStrings(capabilityRecord?.approvalActionKinds ?? []);
  const genericLiveBuild = knownGenericLiveBuildSummary(registryRecord, capabilityRecord);
  const publicRouteTemplates = knownPolicyPublicRouteTemplates(registryRecord, capabilityRecord);
  return {
    schemaVersion: KNOWN_SITE_POLICY_SCHEMA_VERSION,
    status: 'matched',
    host: registryRecord?.host ?? capabilityRecord?.host ?? null,
    siteKey: registryRecord?.siteKey ?? capabilityRecord?.siteKey ?? null,
    adapterId: registryRecord?.adapterId ?? capabilityRecord?.adapterId ?? null,
    repoSkillDir: registryRecord?.repoSkillDir ?? null,
    siteArchetype: registryRecord?.siteArchetype ?? capabilityRecord?.primaryArchetype ?? null,
    siteAccessStatus: registryRecord?.siteAccessStatus ?? capabilityRecord?.siteAccessStatus ?? null,
    pageTypes,
    publicRouteTemplates,
    capabilityFamilies,
    supportedIntents,
    safeActionKinds,
    approvalActionKinds,
    downloadEntrypoint: registryRecord?.downloadEntrypoint ?? null,
    downloadSessionRequirement: registryRecord?.downloadSessionRequirement ?? null,
    downloadTaskTypes: cloneIfPresent(registryRecord?.downloadTaskTypes) ?? [],
    scriptLanguage: registryRecord?.scriptLanguage ?? null,
    interpreterRequired: registryRecord?.interpreterRequired ?? null,
    crawlerScriptsDir: registryRecord?.crawlerScriptsDir ?? null,
    templateVersion: registryRecord?.templateVersion ?? null,
    downloadSupport: cloneIfPresent(registryRecord?.downloadSupport) ?? null,
    downloader: cloneIfPresent(capabilityRecord?.downloader) ?? null,
    accessSignals: cloneIfPresent(registryRecord?.accessSignals ?? capabilityRecord?.accessSignals) ?? null,
    routingNotes: cloneIfPresent(registryRecord?.routingNotes ?? capabilityRecord?.routingNotes) ?? [],
    genericLiveBuild,
    setupConstraints: {
      userChoicesBypassPolicy: false,
      requiresEvidenceForCapabilities: capabilityFamilies,
      approvalActionKinds,
      safeActionKinds,
      downloadSessionRequirement: registryRecord?.downloadSessionRequirement ?? null,
      genericLiveBuildStatus: genericLiveBuild?.status ?? null,
      genericLiveBuildReasonCode: genericLiveBuild?.reasonCode ?? null,
      downloadReasonCode: registryRecord?.downloadSupport?.reasonCode ?? capabilityRecord?.downloader?.reasonCode ?? null,
      alternativeAccessPaths: cloneIfPresent(genericLiveBuild?.alternativeAccessPaths) ?? [],
    },
    sources: [
      registryRecord ? 'config/site-registry.json' : null,
      capabilityRecord ? 'config/site-capabilities.json' : null,
    ].filter(Boolean),
  };
}

export function knownPolicyRecommendedCapabilities(knownSitePolicy, { userAuthorized = false, userAuthorizedEvidence = null } = /** @type {any} */ ({})) {
  if (!knownSitePolicy || !userAuthorized) {
    return [];
  }
  const supported = new Set(knownSitePolicy.supportedIntents ?? []);
  const observed = capabilityIdsFromUserAuthorizedEvidence(userAuthorizedEvidence);
  const supportsSocialContent = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-content');
  const supportsSocialRelations = policySupportsCapabilityFamily(knownSitePolicy, 'query-social-relations');
  const supportsAccountProfile = policySupportsCapabilityFamily(knownSitePolicy, 'query-account-profile');
  const supportsDownloadContent = policySupportsCapabilityFamily(knownSitePolicy, 'download-content');
  const capabilities = /** @type {any[]} */ ([]);
  const add = (id, name, reason, safety = 'read_only', recommended = false, extra = /** @type {any} */ ({})) => {
    if (!capabilities.some((capability) => capability.id === id)) {
      capabilities.push({
        id,
        name,
        reason,
        safety,
        recommended,
        status: recommended ? 'recommended' : 'candidate',
        evidenceRequirement: extra.evidenceRequirement ?? 'capability-specific-evidence',
        disabledReason: recommended ? null : (extra.disabledReason ?? 'capability-specific-evidence-required'),
      });
    }
  };
  const hasIntent = (...ids) => ids.some((id) => supported.has(id) || observed.has(normalizeCapabilityId(id)));
  if (supportsSocialRelations || observed.has('list-followed-users')) {
    add('list-followed-users', 'List followed users', 'Candidate only until SiteForge captures capability-specific followed-user evidence.');
  }
  if (supportsSocialContent || observed.has('list-followed-updates')) {
    add('list-followed-updates', 'List followed updates', 'Candidate only until SiteForge captures capability-specific followed-update evidence.');
  }
  if (supportsSocialContent || hasIntent('recommended-timeline-posts', 'list-recommended-timeline-posts')) {
    add('recommended-timeline-posts', 'List recommended timeline posts', 'Candidate only until SiteForge captures capability-specific recommended timeline evidence.');
  }
  if (supportsSocialContent || supportsAccountProfile || hasIntent('profile-content', 'list-profile-content')) {
    add('list-profile-content', 'List profile content', 'Candidate only until SiteForge captures capability-specific profile evidence.');
  }
  if (supported.has('search-posts') || supported.has('search-content')) {
    add('search-posts', 'Search posts', 'Candidate only until SiteForge captures capability-specific search evidence.');
  }
  if (hasIntent('list-notifications', 'notifications')) {
    add('list-notifications', 'List notifications', 'Candidate only until SiteForge captures capability-specific notification evidence.');
  }
  if (hasIntent('list-bookmarks', 'bookmarks')) {
    add('list-bookmarks', 'List bookmarks', 'Candidate only until SiteForge captures capability-specific bookmark evidence.');
  }
  if (hasIntent('list-lists', 'lists')) {
    add('list-lists', 'List lists', 'Candidate only until SiteForge captures capability-specific list evidence.');
  }
  if (hasIntent('list-direct-messages', 'direct-messages', 'messages')) {
    add('list-direct-messages', 'List direct messages', 'Candidate only until SiteForge captures explicit message-list evidence.', 'requires_confirmation');
  }
  if (supportsDownloadContent) {
    add('download-content-candidate', 'Prepare media download candidate', 'Downloads require a separate approved bounded action path.', 'requires_confirmation', false);
  }
  return capabilities;
}

function policyCapabilityMatches(value) {
  const text = String(value ?? '').toLowerCase();
  return text.includes('download') || text.includes('social') || text.includes('query');
}

export function knownPolicyCapabilityPressure(knownSitePolicy) {
  if (!knownSitePolicy) {
    return null;
  }
  const matchedCapabilityFamilies = uniqueSortedStrings(
    (knownSitePolicy.capabilityFamilies ?? []).filter(policyCapabilityMatches),
  );
  const matchedSupportedIntents = uniqueSortedStrings(
    (knownSitePolicy.supportedIntents ?? []).filter(policyCapabilityMatches),
  );
  const matchedDownloadTaskTypes = uniqueSortedStrings(
    (knownSitePolicy.downloadTaskTypes ?? []).filter(policyCapabilityMatches),
  );
  return {
    schemaVersion: KNOWN_SITE_POLICY_SCHEMA_VERSION,
    siteKey: knownSitePolicy.siteKey ?? null,
    adapterId: knownSitePolicy.adapterId ?? null,
    sources: clone(knownSitePolicy.sources ?? []),
    hasPolicyCapabilities: matchedCapabilityFamilies.length > 0
      || matchedSupportedIntents.length > 0
      || matchedDownloadTaskTypes.length > 0,
    matchedCapabilityFamilies,
    matchedSupportedIntents,
    matchedDownloadTaskTypes,
  };
}

export function knownPolicyAllowsUserAuthorizedSetup(knownSitePolicy) {
  if (!knownSitePolicy) {
    return false;
  }
  const alternatives = [
    ...(knownSitePolicy.genericLiveBuild?.alternativeAccessPaths ?? []),
    ...(knownSitePolicy.setupConstraints?.alternativeAccessPaths ?? []),
    ...(knownSitePolicy.routingNotes ?? []),
    ...(knownSitePolicy.accessSignals?.restrictionSignals ?? []),
    ...(knownSitePolicy.accessSignals?.notes ?? []),
  ].join(' ');
  return knownSitePolicy.downloadSessionRequirement === 'required'
    || /user-authori[sz]ed|authorized|login|session|consent|manual user/iu.test(alternatives);
}
