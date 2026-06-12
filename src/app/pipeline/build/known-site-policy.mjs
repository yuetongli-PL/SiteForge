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
export const KNOWN_SITE_BUSINESS_COVERAGE_SCHEMA_VERSION = 1;

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

function normalizeCoverageToken(value, fallback = null) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || fallback;
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

function safeKnownPolicyAuthRouteTarget(value, rootUrl = null) {
  const raw = String(value ?? '').trim();
  if (!raw || /(?:authorization|bearer|cookie|sid|uid|token|secret|session|password)/iu.test(raw)) {
    return null;
  }
  try {
    const parsed = new URL(normalizeUrl(raw, rootUrl ?? undefined));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.pathname || '/';
  } catch {
    const pathOnly = raw.split(/[?#]/u)[0].trim();
    return pathOnly.startsWith('/') && !/[<>"']|(?:authorization|bearer|cookie|sid|uid|token|secret|session|password)/iu.test(pathOnly)
      ? pathOnly
      : null;
  }
}

function knownPolicyAuthSummary(registryRecord, capabilityRecord) {
  const registryAuth = registryRecord?.auth && typeof registryRecord.auth === 'object' ? registryRecord.auth : {};
  const capabilityAuth = capabilityRecord?.auth && typeof capabilityRecord.auth === 'object' ? capabilityRecord.auth : {};
  const rootUrl = registryRecord?.canonicalBaseUrl ?? capabilityRecord?.baseUrl ?? null;
  const authRoutes = uniqueSortedStrings([
    ...asStringList(registryAuth.authRoutes ?? registryRecord?.authRoutes),
    ...asStringList(capabilityAuth.authRoutes ?? capabilityRecord?.authRoutes),
  ].map((route) => safeKnownPolicyAuthRouteTarget(route, rootUrl)).filter(Boolean));
  const publicRevisitRoutes = uniqueSortedStrings([
    ...asStringList(registryAuth.publicRevisitRoutes ?? registryRecord?.publicRevisitRoutes),
    ...asStringList(capabilityAuth.publicRevisitRoutes ?? capabilityRecord?.publicRevisitRoutes),
  ].map((route) => safeKnownPolicyAuthRouteTarget(route, rootUrl)).filter(Boolean));
  const authCheckUrl = safeKnownPolicyAuthRouteTarget(
    registryAuth.authCheckUrl ?? registryRecord?.authCheckUrl ?? capabilityAuth.authCheckUrl ?? capabilityRecord?.authCheckUrl,
    rootUrl,
  );
  const mode = ['browser', 'cookie'].includes(String(registryAuth.mode ?? capabilityAuth.mode ?? '').trim())
    ? String(registryAuth.mode ?? capabilityAuth.mode).trim()
    : null;
  const required = registryAuth.required === true || capabilityAuth.required === true;
  if (!required && !mode && !authCheckUrl && !authRoutes.length && !publicRevisitRoutes.length) {
    return null;
  }
  return {
    required,
    mode,
    authCheckUrl,
    authRoutes,
    publicRevisitRoutes,
    evidencePersistence: firstPresent(registryAuth.evidencePersistence, capabilityAuth.evidencePersistence),
    sessionMaterialPersistence: firstPresent(registryAuth.sessionMaterialPersistence, capabilityAuth.sessionMaterialPersistence),
  };
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

function publicRouteTemplateTarget(route = /** @type {any} */ ({})) {
  return String(
    route.path
      ?? route.route
      ?? route.samplePath
      ?? route.examplePath
      ?? route.authSeedPath
      ?? route.pathTemplate
      ?? route.routeTemplate
      ?? '',
  ).trim();
}

export function knownPolicyBusinessAreaForRoute(route = /** @type {any} */ ({})) {
  const explicit = normalizeCoverageToken(
    route.businessArea ?? route.coverageGroup ?? route.businessDomain ?? route.coverageArea,
  );
  if (explicit) {
    return explicit;
  }
  const target = publicRouteTemplateTarget(route);
  const text = [
    route.id,
    target,
    route.pageType,
    ...(Array.isArray(route.capabilityFamilies) ? route.capabilityFamilies : []),
  ].join(' ').toLowerCase();
  if (/home|^\/$/u.test(text)) return 'home';
  if (/search|keyword|query|\?s=|[?&]q=/u.test(text)) return 'search';
  if (/reserve|pre[-_ ]?order/u.test(text)) return 'reserve-listings';
  if (/newreleases?|new[-_ ]?release|release|archive|date/u.test(text)) return 'release-listings';
  if (/news|blog|column|article/u.test(text)) return 'news-updates';
  if (/series/u.test(text)) return 'series-directory';
  if (/label/u.test(text)) return 'label-directory';
  if (/maker|studio/u.test(text)) return 'maker-directory';
  if (/tag|topic|topics/u.test(text)) return 'topic-directory';
  if (/ranking|rank|top|hot|popular|latest-updates|latest|recent|trending/u.test(text)) return 'ranking-lists';
  if (/event|media/u.test(text)) return 'event-media';
  if (/actress|performer|actor|model|talent|author|girls|profile/u.test(text)) return 'person-directory';
  if (/genre|category|categories|channel|section/u.test(text)) return 'genre-directory';
  if (/vr/u.test(text)) return 'vr-catalog';
  if (/sell|sale|shop/u.test(text)) return 'sales-catalog';
  if (/special|campaign|feature/u.test(text)) return 'special-pages';
  if (/works?\/detail|details?|content-detail|book-detail|navigate-to-content/u.test(text)) return 'detail-pages';
  if (/sitemap|site-map/u.test(text)) return 'sitemap';
  if (/help|support|faq/u.test(text)) return 'help';
  if (/contact|inquiry|fan-letter|ad-contact/u.test(text)) return 'contact-boundary';
  if (/privacy|policy|terms|rule/u.test(text)) return 'policy-pages';
  if (/company|about|contents|link|recruit|download|utility/u.test(text)) return 'utility-pages';
  return normalizeCoverageToken(route.pageType, 'public-route');
}

function businessCoveragePriority(area) {
  const priority = new Map([
    ['home', 100],
    ['search', 95],
    ['release-listings', 90],
    ['reserve-listings', 88],
    ['news-updates', 87],
    ['genre-directory', 86],
    ['series-directory', 84],
    ['label-directory', 82],
    ['maker-directory', 80],
    ['person-directory', 78],
    ['topic-directory', 76],
    ['ranking-lists', 74],
    ['detail-pages', 72],
    ['special-pages', 70],
    ['event-media', 68],
    ['vr-catalog', 66],
    ['sales-catalog', 64],
    ['sitemap', 50],
    ['help', 48],
    ['contact-boundary', 46],
    ['policy-pages', 44],
    ['utility-pages', 42],
  ]);
  return priority.get(area) ?? 40;
}

function routeReference(route = /** @type {any} */ ({})) {
  return {
    id: route.id ?? null,
    path: route.path ?? route.route ?? null,
    samplePath: route.samplePath ?? route.examplePath ?? route.authSeedPath ?? null,
    pathTemplate: route.pathTemplate ?? route.routeTemplate ?? null,
    pageType: route.pageType ?? null,
    seedable: route.seedable === true && Boolean(route.path ?? route.route),
    businessArea: knownPolicyBusinessAreaForRoute(route),
    capabilityFamilies: uniqueSortedStrings(route.capabilityFamilies ?? []),
    capabilityIds: uniqueSortedStrings(route.capabilityIds ?? route.capabilities ?? []),
    tabStates: uniqueSortedStrings(route.tabStates ?? (route.tabState ? [route.tabState] : [])),
  };
}

export function knownPolicyBusinessCoverageModel(knownSitePolicy = null) {
  if (!knownSitePolicy || typeof knownSitePolicy !== 'object') {
    return null;
  }
  const routeTemplates = Array.isArray(knownSitePolicy.publicRouteTemplates)
    ? knownSitePolicy.publicRouteTemplates
    : [];
  if (!routeTemplates.length) {
    return null;
  }
  const groups = new Map();
  for (const [index, route] of routeTemplates.entries()) {
    if (!route || typeof route !== 'object') {
      continue;
    }
    const target = publicRouteTemplateTarget(route);
    if (!target) {
      continue;
    }
    const area = knownPolicyBusinessAreaForRoute(route);
    if (!groups.has(area)) {
      groups.set(area, {
        id: area,
        label: area.replace(/-/gu, ' '),
        priority: businessCoveragePriority(area),
        routeCount: 0,
        seedableRouteCount: 0,
        routeIds: [],
        seedableRouteIds: [],
        pageTypes: new Set(),
        capabilityFamilies: new Set(),
        routes: [],
      });
    }
    const group = groups.get(area);
    const routeId = String(route.id ?? `${area}-${index + 1}`);
    group.routeCount += 1;
    group.routeIds.push(routeId);
    group.routes.push(routeReference({ ...route, id: routeId }));
    if (route.seedable === true && (route.path ?? route.route)) {
      group.seedableRouteCount += 1;
      group.seedableRouteIds.push(routeId);
    }
    if (route.pageType) {
      group.pageTypes.add(String(route.pageType));
    }
    for (const family of route.capabilityFamilies ?? []) {
      group.capabilityFamilies.add(String(family));
    }
  }
  const normalizedGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      pageTypes: uniqueSortedStrings([...group.pageTypes]),
      capabilityFamilies: uniqueSortedStrings([...group.capabilityFamilies]),
      routes: group.routes.sort((left, right) => String(left.id).localeCompare(String(right.id), 'en')),
    }))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id, 'en'));
  return {
    schemaVersion: KNOWN_SITE_BUSINESS_COVERAGE_SCHEMA_VERSION,
    status: normalizedGroups.length ? 'configured' : 'empty',
    siteKey: knownSitePolicy.siteKey ?? null,
    adapterId: knownSitePolicy.adapterId ?? null,
    routeCount: routeTemplates.length,
    seedableRouteCount: routeTemplates.filter((route) => route?.seedable === true && (route.path ?? route.route)).length,
    groupCount: normalizedGroups.length,
    groups: normalizedGroups,
    requiredGroupIds: normalizedGroups
      .filter((group) => group.seedableRouteCount > 0)
      .map((group) => group.id),
    templateOnlyGroupIds: normalizedGroups
      .filter((group) => group.seedableRouteCount === 0 && group.routeCount > 0)
      .map((group) => group.id),
  };
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
      samplePath: route.samplePath ?? route.examplePath ?? route.authSeedPath ?? null,
      pathTemplate: pathTemplate ?? null,
      pageType: route.pageType ?? null,
      businessArea: route.businessArea ?? route.coverageGroup ?? route.businessDomain ?? route.coverageArea ?? null,
      coverageRole: route.coverageRole ?? null,
      capabilityFamilies: uniqueSortedStrings(route.capabilityFamilies ?? []),
      capabilityIds: uniqueSortedStrings(route.capabilityIds ?? route.capabilities ?? []),
      tabStates: uniqueSortedStrings(route.tabStates ?? (route.tabState ? [route.tabState] : [])),
      seedable: route.seedable === true && Boolean(pathValue),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, 'en'));
}

export function knownPolicyBusinessCoverageSeedRoutes(knownSitePolicy = null) {
  const groups = knownSitePolicy?.businessCoverageModel?.groups ?? [];
  const routes = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const route of Array.isArray(group?.routes) ? group.routes : []) {
      const target = route.path ?? route.samplePath ?? null;
      if (!target) {
        continue;
      }
      routes.push({
        path: target,
        routeId: route.id ?? null,
        pathTemplate: route.pathTemplate ?? null,
        pageType: route.pageType ?? null,
        businessArea: group.id ?? route.businessArea ?? null,
        capabilityIds: uniqueSortedStrings(route.capabilityIds ?? []),
        tabStates: uniqueSortedStrings(route.tabStates ?? []),
        source: 'known_site_business_coverage_model',
        reasonCode: 'known-site-business-coverage-seed',
      });
    }
  }
  return uniqueBy(routes, (route) => `${route.path}:${route.businessArea ?? ''}:${route.routeId ?? ''}`)
    .sort((left, right) => String(left.path).localeCompare(String(right.path), 'en'));
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
  const disabledActionKinds = uniqueSortedStrings([
    ...(registryRecord?.disabledActionKinds ?? []),
    ...(capabilityRecord?.disabledActionKinds ?? []),
  ]);
  const genericLiveBuild = knownGenericLiveBuildSummary(registryRecord, capabilityRecord);
  const publicRouteTemplates = knownPolicyPublicRouteTemplates(registryRecord, capabilityRecord);
  const businessCoverageModel = knownPolicyBusinessCoverageModel({
    siteKey: registryRecord?.siteKey ?? capabilityRecord?.siteKey ?? null,
    adapterId: registryRecord?.adapterId ?? capabilityRecord?.adapterId ?? null,
    publicRouteTemplates,
  });
  const auth = knownPolicyAuthSummary(registryRecord, capabilityRecord);
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
    businessCoverageModel,
    capabilityFamilies,
    supportedIntents,
    safeActionKinds,
    approvalActionKinds,
    disabledActionKinds,
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
    auth,
    genericLiveBuild,
    robotsUnavailableFallback: cloneIfPresent(registryRecord?.robotsUnavailableFallback ?? capabilityRecord?.robotsUnavailableFallback) ?? null,
    setupConstraints: {
      userChoicesBypassPolicy: false,
      requiresEvidenceForCapabilities: capabilityFamilies,
      approvalActionKinds,
      safeActionKinds,
      disabledActionKinds,
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
  const supportsMediaContent = policySupportsCapabilityFamily(knownSitePolicy, 'query-media-content');
  const supportsDownloadContent = policySupportsCapabilityFamily(knownSitePolicy, 'download-content');
  const siteKey = String(knownSitePolicy.siteKey ?? knownSitePolicy.adapterId ?? '').trim().toLowerCase();
  const isZhihuPolicy = siteKey === 'zhihu';
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
  if (supportsSocialContent || hasIntent('list-hot-posts', 'open-category')) {
    add('list-hot-posts', 'List hot posts', 'Candidate only until SiteForge captures capability-specific hot-list evidence.');
  }
  if ((isZhihuPolicy && (supportsSocialContent || supportsMediaContent)) || hasIntent('list-hot-broadcasts')) {
    add('list-hot-broadcasts', 'List hot broadcasts', 'Candidate only until SiteForge captures capability-specific hot broadcast evidence.');
  }
  if ((isZhihuPolicy && supportsSocialContent) || hasIntent('list-topic-discussions')) {
    add('list-topic-discussions', 'List topic discussions', 'Candidate only until SiteForge captures capability-specific topic discussion evidence.');
  }
  if ((isZhihuPolicy && supportsSocialContent) || hasIntent('list-topic-featured')) {
    add('list-topic-featured', 'List topic featured answers', 'Candidate only until SiteForge captures capability-specific topic featured evidence.');
  }
  if (supportsSocialContent || supportsAccountProfile || hasIntent('profile-content', 'list-profile-content')) {
    add('list-profile-content', 'List profile content', 'Candidate only until SiteForge captures capability-specific profile evidence.');
  }
  for (const [id, name] of [
    ['list-user-activities', 'List user activities'],
    ['list-user-answers', 'List user answers'],
    ['list-user-questions', 'List user questions'],
    ['list-user-articles', 'List user articles'],
    ['list-user-columns', 'List user columns'],
    ['list-user-pins', 'List user pins'],
    ['list-user-collections', 'List user collections'],
    ['list-user-videos', 'List user videos'],
    ['list-user-following', 'List user following'],
  ]) {
    if ((isZhihuPolicy && (supportsAccountProfile || supportsSocialContent)) || hasIntent(id)) {
      add(id, name, `Candidate only until SiteForge captures capability-specific ${id.replace(/^list-/u, '').replace(/-/gu, ' ')} evidence.`);
    }
  }
  if (supported.has('search-posts') || supported.has('search-content')) {
    add('search-posts', 'Search posts', 'Candidate only until SiteForge captures capability-specific search evidence.');
  }
  if (hasIntent('search-users')) {
    add('search-users', 'Search users', 'Candidate only until SiteForge captures people-search structure evidence.');
  }
  if (hasIntent('search-latest-posts')) {
    add('search-latest-posts', 'Search latest posts', 'Candidate only until SiteForge captures latest-search structure evidence.');
  }
  if (hasIntent('search-media-posts')) {
    add('search-media-posts', 'Search media posts', 'Candidate only until SiteForge captures media-search structure evidence.');
  }
  if (hasIntent('read-search-result-summaries')) {
    add('read-search-result-summaries', 'Read search result summaries', 'Candidate only until SiteForge captures search-result summary evidence.');
  }
  if (hasIntent('open-search-result-detail')) {
    add('open-search-result-detail', 'Open search result detail', 'Candidate only until SiteForge captures search-result detail navigation evidence.');
  }
  if (hasIntent('view-question-detail', 'open-post')) {
    add('view-question-detail', 'View question detail', 'Candidate only until SiteForge captures question-detail structure evidence.');
  }
  if (hasIntent('view-answer-detail', 'open-post')) {
    add('view-answer-detail', 'View answer detail', 'Candidate only until SiteForge captures answer-detail structure evidence.');
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
