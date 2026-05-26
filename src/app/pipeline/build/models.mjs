// @ts-check

import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { sanitizeHost, slugifyAscii } from '../../../shared/normalize.mjs';
import { normalizeEvidenceObject } from './risk-policy.mjs';

export const BUILD_SCHEMA_VERSION = 1;

export const DEFAULT_BUILD_POLICY = Object.freeze({
  maxDepth: 8,
  maxPages: 1000,
  maxSeeds: 5000,
  maxSitemaps: 200,
  fetchDelayMs: 100,
  fetchTimeoutMs: 20000,
  renderJs: false,
  interactive: true,
  captureNetwork: false,
  submitForms: false,
  allowDestructiveActions: false,
  allowPayment: false,
  allowAccountMutation: false,
  allowContactSubmit: false,
  allowReadOnlyInteractions: true,
  allowNavigationClicks: true,
  allowMenuExpansion: true,
  allowTabExpansion: true,
  allowModalOpen: true,
  allowPagination: true,
});

export const TRACKING_QUERY_PARAMS = new Set([
  'access_token',
  'auth',
  'authorization',
  'fbclid',
  'gclid',
  'gbraid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'oly_anon_id',
  'oly_enc_id',
  'ref',
  'ref_src',
  'refresh_token',
  'sessdata',
  'session',
  'sessionid',
  'sid',
  'spm',
  'token',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'utm_id',
]);

export const EVIDENCE_TYPES = new Set(['url', 'dom', 'text', 'network', 'form', 'screenshot', 'fixture']);
export const SITE_NODE_TYPES = new Set(['page', 'route', 'route_template', 'content', 'operation', 'component', 'form', 'api', 'modal', 'tab', 'menu', 'pagination', 'workflow', 'entity', 'auth_state']);
export const DISCOVERED_BY_VALUES = new Set(['sitemap', 'robots', 'html_link', 'rendered_link', 'js_route', 'interaction', 'form', 'network', 'pagination', 'fixture', 'authorized_source']);
export const AFFORDANCE_KINDS = new Set(['link', 'button', 'form', 'input', 'select', 'api_call', 'route', 'menu', 'modal', 'download', 'upload']);
export const AFFORDANCE_SAFETY_VALUES = new Set(['safe', 'read_only', 'requires_input', 'state_changing', 'destructive', 'payment']);
export const CAPABILITY_ACTIONS = new Set(['view', 'search', 'filter', 'compare', 'create', 'submit', 'download', 'upload', 'book', 'purchase', 'login', 'register', 'manage', 'track', 'contact']);
export const SAFETY_LEVELS = new Set(['read_only', 'requires_confirmation', 'state_changing', 'payment', 'destructive']);
export const CAPABILITY_STATUSES = new Set(['active', 'candidate', 'discarded', 'disabled']);

const DEFAULT_PORT_BY_PROTOCOL = Object.freeze({
  'http:': '80',
  'https:': '443',
});

export function mergeBuildPolicy(policy = /** @type {any} */ ({})) {
  return {
    ...DEFAULT_BUILD_POLICY,
    ...Object.fromEntries(Object.entries(policy ?? {}).filter(([, value]) => value !== undefined)),
  };
}

export function sha256Short(value, length = 10) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export function formatBuildId(date = new Date()) {
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.(\d{3})Z$/u, '$1Z');
}

export function normalizeUrl(inputUrl, baseUrl = undefined) {
  const parsed = new URL(inputUrl, baseUrl);
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.port && parsed.port === DEFAULT_PORT_BY_PROTOCOL[parsed.protocol]) {
    parsed.port = '';
  }
  parsed.hash = '';
  const nextParams = new URLSearchParams();
  const sortedEntries = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_QUERY_PARAMS.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_'))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey ? leftValue.localeCompare(rightValue, 'en') : leftKey.localeCompare(rightKey, 'en')
    ));
  for (const [key, value] of sortedEntries) {
    nextParams.append(key, value);
  }
  parsed.search = nextParams.toString();
  parsed.pathname = parsed.pathname.replace(/\/{2,}/gu, '/');
  if (!parsed.pathname) {
    parsed.pathname = '/';
  }
  return parsed.toString();
}

export function rootUrlFrom(inputUrl) {
  const parsed = new URL(normalizeUrl(inputUrl));
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function allowedDomainsFrom(inputUrl) {
  const host = new URL(normalizeUrl(inputUrl)).hostname;
  const domains = new Set([host]);
  if (host.startsWith('www.')) {
    domains.add(host.slice(4));
  } else {
    domains.add(`www.${host}`);
  }
  return [...domains].sort((left, right) => left.localeCompare(right, 'en'));
}

export function isInternalUrl(urlValue, allowedDomains) {
  try {
    const parsed = new URL(urlValue);
    return allowedDomains.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isSameSiteUrl(urlValue, allowedDomains) {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return (Array.isArray(allowedDomains) ? allowedDomains : [])
      .map((domain) => String(domain ?? '').toLowerCase())
      .filter(Boolean)
      .some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function stableSiteIdFromUrl(inputUrl) {
  const normalized = normalizeUrl(rootUrlFrom(inputUrl));
  const host = sanitizeHost(new URL(normalized).hostname.replace(/^www\./u, ''));
  return `${host}-${sha256Short(normalized, 8)}`;
}

export function assertSafeBuildPathSegment(value, label = 'path segment') {
  const segment = String(value ?? '').trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(segment)
    || segment === '.'
    || segment === '..'
    || /[\\/]/u.test(segment)
    || /^[A-Za-z]:/u.test(segment)
    || path.basename(segment) !== segment
  ) {
    throw new Error(`${label} must be a safe path segment.`);
  }
  return segment;
}

export function buildArtifactDir({
  cwd = process.cwd(),
  artifactRoot,
  siteId,
  buildId,
} = /** @type {any} */ ({})) {
  const expectedRoot = path.resolve(cwd, '.siteforge', 'sites');
  const resolvedRoot = artifactRoot === undefined || artifactRoot === null
    ? expectedRoot
    : path.resolve(cwd, artifactRoot);
  if (resolvedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw new Error('artifactRoot must resolve to .siteforge/sites.');
  }
  return path.resolve(
    expectedRoot,
    assertSafeBuildPathSegment(siteId, 'siteId'),
    'builds',
    assertSafeBuildPathSegment(buildId, 'buildId'),
  );
}

export function createSiteRecord(inputUrl, nowIso) {
  const normalizedUrl = normalizeUrl(inputUrl);
  return {
    schemaVersion: BUILD_SCHEMA_VERSION,
    id: stableSiteIdFromUrl(inputUrl),
    rootUrl: rootUrlFrom(normalizedUrl),
    normalizedUrl,
    allowedDomains: allowedDomainsFrom(normalizedUrl),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function buildEvidence({
  type,
  source,
  selector,
  text,
  endpoint,
  method,
  confidence = 1,
} = /** @type {any} */ ({})) {
  return normalizeEvidenceObject({
    type,
    source,
    confidence,
    ...(selector ? { selector } : {}),
    ...(text ? { text } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(method ? { method } : {}),
  });
}

export function stableNodeId(prefix, value) {
  return `${prefix}:${sha256Short(value, 12)}`;
}

export function stableCapabilityId(siteId, name) {
  return `capability:${siteId}:${slugifyAscii(name, 'capability')}`;
}

export function stableIntentId(capabilityId) {
  return `intent:${capabilityId.replace(/^capability:/u, '')}`;
}

function assertSetValue(set, value, label) {
  if (!set.has(value)) {
    throw new Error(`${label} has invalid value: ${value}`);
  }
}

function assertEvidenceList(evidence, label) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(`${label} requires non-empty evidence`);
  }
  for (const item of evidence) {
    assertSetValue(EVIDENCE_TYPES, item?.type, `${label}.evidence.type`);
    if (!item.source) {
      throw new Error(`${label}.evidence.source is required`);
    }
  }
}

export function assertSiteNode(node) {
  if (!node?.id || !node.siteId) {
    throw new Error('SiteNode requires id and siteId');
  }
  assertSetValue(SITE_NODE_TYPES, node.type, `SiteNode ${node.id} type`);
  assertSetValue(DISCOVERED_BY_VALUES, node.discoveredBy, `SiteNode ${node.id} discoveredBy`);
  assertEvidenceList(node.evidence, `SiteNode ${node.id}`);
  if (!Array.isArray(node.parentNodeIds) || !Array.isArray(node.childNodeIds)) {
    throw new Error(`SiteNode ${node.id} requires parentNodeIds and childNodeIds`);
  }
  if (!Number.isFinite(Number(node.confidence))) {
    throw new Error(`SiteNode ${node.id} requires confidence`);
  }
}

export function assertAffordance(affordance) {
  if (!affordance?.id || !affordance.nodeId) {
    throw new Error('Affordance requires id and nodeId');
  }
  assertSetValue(AFFORDANCE_KINDS, affordance.kind, `Affordance ${affordance.id} kind`);
  assertSetValue(AFFORDANCE_SAFETY_VALUES, affordance.safety, `Affordance ${affordance.id} safety`);
  assertEvidenceList(affordance.evidence, `Affordance ${affordance.id}`);
  if (!Number.isFinite(Number(affordance.confidence))) {
    throw new Error(`Affordance ${affordance.id} requires confidence`);
  }
}

export function assertCapability(capability) {
  if (!capability?.id || !capability.siteId || !capability.name) {
    throw new Error('Capability requires id, siteId, and name');
  }
  assertSetValue(CAPABILITY_ACTIONS, capability.action, `Capability ${capability.id} action`);
  assertSetValue(SAFETY_LEVELS, capability.safetyLevel, `Capability ${capability.id} safetyLevel`);
  assertSetValue(CAPABILITY_STATUSES, capability.status, `Capability ${capability.id} status`);
  if (capability.status === 'active') {
    if (!Array.isArray(capability.entryNodeIds) || capability.entryNodeIds.length === 0) {
      throw new Error(`Active capability ${capability.id} requires entryNodeIds`);
    }
    assertEvidenceList(capability.evidence, `Capability ${capability.id}`);
    if (!Number.isFinite(Number(capability.confidence))) {
      throw new Error(`Active capability ${capability.id} requires confidence`);
    }
    if (!capability.executionPlan && capability.informational !== true) {
      throw new Error(`Active capability ${capability.id} requires executionPlan or informational=true`);
    }
  }
}

export function assertUserIntent(intent, capabilityIds) {
  const graphOnly = intent?.intentSource === 'graph_element'
    && intent.callable === false
    && Boolean(intent.sourceNodeId);
  if (!intent?.id || !intent.skillId || (!intent.capabilityId && !graphOnly)) {
    throw new Error('UserIntent requires id, skillId, and either capabilityId or graph element source');
  }
  if (intent.capabilityId && !capabilityIds.has(intent.capabilityId)) {
    throw new Error(`UserIntent ${intent.id} references missing capability ${intent.capabilityId}`);
  }
  if (!intent.canonicalUtterance || !Array.isArray(intent.utteranceExamples) || intent.utteranceExamples.length === 0) {
    throw new Error(`UserIntent ${intent.id} requires deterministic utterances`);
  }
  assertSetValue(SAFETY_LEVELS, intent.safetyLevel, `UserIntent ${intent.id} safetyLevel`);
  assertEvidenceList(intent.evidence, `UserIntent ${intent.id}`);
}
