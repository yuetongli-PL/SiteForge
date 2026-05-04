// @ts-check

import {
  REDACTION_PLACEHOLDER,
  isSensitiveFieldName,
  scanForbiddenPatterns,
} from './security-guard.mjs';

export const TRUST_BOUNDARY_REGISTRY_SCHEMA_VERSION = 1;
export const TRUST_BOUNDARY_CROSSING_SCHEMA_VERSION = 1;

export const TRUST_BOUNDARY_IDS = Object.freeze([
  'BrowserProfile',
  'RawCookieJar',
  'SessionView',
  'Artifact',
  'downloader',
  'SiteAdapter',
  'api-candidates',
  'api-catalog',
  'RiskState',
  'SecurityGuard',
]);

export const TRUST_BOUNDARY_CONTROLS = Object.freeze([
  'redacted',
  'minimized',
  'permission-checked',
]);

const TRUST_BOUNDARY_CONTROL_SET = new Set(TRUST_BOUNDARY_CONTROLS);

const RAW_VALUE_PATTERNS = Object.freeze([
  {
    name: 'cookie-assignment',
    pattern: /\b(?:cookie|sid|sessionid|sessdata|csrf|xsrf|token)\s*[:=]\s*(?!\[REDACTED\]|%5BREDACTED%5D)[^;\s&]+/iu,
  },
  {
    name: 'browser-profile-path',
    pattern: /(?:[A-Za-z]:[\\/][^\s"']*browser-profiles?[\\/][^\s"']+|(?:^|[\\/])browser-profiles?[\\/][^\s"']+)/iu,
  },
]);

function freezeBoundary(boundary) {
  return Object.freeze({
    ...boundary,
    requiredOutboundControls: Object.freeze([...(boundary.requiredOutboundControls ?? [])]),
    requiredInboundControls: Object.freeze([...(boundary.requiredInboundControls ?? [])]),
    allowedMaterial: Object.freeze([...(boundary.allowedMaterial ?? [])]),
  });
}

const TRUST_BOUNDARY_REGISTRY = Object.freeze({
  BrowserProfile: freezeBoundary({
    id: 'BrowserProfile',
    label: 'Browser profile',
    role: 'high-sensitive-source',
    sensitivity: 'high',
    trustLevel: 'privileged',
    rawSensitiveMaterial: true,
    persistent: true,
    requiredOutboundControls: ['minimized', 'permission-checked'],
    requiredInboundControls: ['permission-checked'],
    allowedMaterial: ['references-only', 'health-summary', 'revocation-handle'],
  }),
  RawCookieJar: freezeBoundary({
    id: 'RawCookieJar',
    label: 'Raw cookie jar',
    role: 'high-sensitive-source',
    sensitivity: 'high',
    trustLevel: 'privileged',
    rawSensitiveMaterial: true,
    persistent: false,
    requiredOutboundControls: ['redacted', 'minimized', 'permission-checked'],
    requiredInboundControls: ['permission-checked'],
    allowedMaterial: ['redacted-cookie-summary', 'cookie-count', 'expiry-summary'],
  }),
  SessionView: freezeBoundary({
    id: 'SessionView',
    label: 'SessionView',
    role: 'minimized-session-materialization',
    sensitivity: 'medium',
    trustLevel: 'controlled',
    rawSensitiveMaterial: false,
    persistent: false,
    requiredOutboundControls: ['minimized', 'permission-checked'],
    requiredInboundControls: ['redacted', 'minimized', 'permission-checked'],
    allowedMaterial: ['siteKey', 'purpose', 'scope', 'permission', 'ttl', 'status', 'reasonCode'],
  }),
  Artifact: freezeBoundary({
    id: 'Artifact',
    label: 'Artifact',
    role: 'persistent-output',
    sensitivity: 'varies',
    trustLevel: 'untrusted-persistent-output',
    rawSensitiveMaterial: false,
    persistent: true,
    requiredOutboundControls: ['redacted'],
    requiredInboundControls: ['redacted'],
    allowedMaterial: ['redacted-json', 'redaction-audit', 'stable-references'],
  }),
  downloader: freezeBoundary({
    id: 'downloader',
    label: 'downloader',
    role: 'low-permission-consumer',
    sensitivity: 'low',
    trustLevel: 'low-permission',
    rawSensitiveMaterial: false,
    persistent: false,
    requiredOutboundControls: ['minimized'],
    requiredInboundControls: ['minimized', 'permission-checked'],
    allowedMaterial: ['planned-task', 'DownloadPolicy', 'SessionView', 'resolved-resource'],
  }),
  SiteAdapter: freezeBoundary({
    id: 'SiteAdapter',
    label: 'SiteAdapter',
    role: 'site-specific-interpreter',
    sensitivity: 'medium',
    trustLevel: 'site-scoped',
    rawSensitiveMaterial: false,
    persistent: false,
    requiredOutboundControls: ['minimized'],
    requiredInboundControls: ['permission-checked'],
    allowedMaterial: ['site-decision', 'normalized-url', 'candidate-decision', 'reasonCode'],
  }),
  'api-candidates': freezeBoundary({
    id: 'api-candidates',
    label: 'api-candidates',
    role: 'candidate-evidence-store',
    sensitivity: 'medium',
    trustLevel: 'redacted-observation',
    rawSensitiveMaterial: false,
    persistent: true,
    requiredOutboundControls: ['redacted', 'minimized'],
    requiredInboundControls: ['redacted', 'minimized', 'permission-checked'],
    allowedMaterial: ['redacted-request-summary', 'response-shape', 'verification-evidence'],
  }),
  'api-catalog': freezeBoundary({
    id: 'api-catalog',
    label: 'api-catalog',
    role: 'verified-api-contract-store',
    sensitivity: 'medium',
    trustLevel: 'governed-persistent-contract',
    rawSensitiveMaterial: false,
    persistent: true,
    requiredOutboundControls: ['redacted', 'minimized'],
    requiredInboundControls: ['redacted', 'minimized', 'permission-checked'],
    allowedMaterial: ['verified-endpoint-shape', 'pagination-model', 'field-mapping', 'risk-summary'],
  }),
  RiskState: freezeBoundary({
    id: 'RiskState',
    label: 'RiskState',
    role: 'reasoned-risk-producer',
    sensitivity: 'medium',
    trustLevel: 'controlled-diagnostic',
    rawSensitiveMaterial: false,
    persistent: true,
    requiredOutboundControls: ['redacted', 'minimized'],
    requiredInboundControls: ['redacted', 'minimized'],
    allowedMaterial: ['state', 'reasonCode', 'recovery', 'scope'],
  }),
  SecurityGuard: freezeBoundary({
    id: 'SecurityGuard',
    label: 'SecurityGuard / Redaction',
    role: 'mandatory-redaction-gate',
    sensitivity: 'control-plane',
    trustLevel: 'guard',
    rawSensitiveMaterial: false,
    persistent: false,
    requiredOutboundControls: ['redacted'],
    requiredInboundControls: [],
    allowedMaterial: ['redaction-audit', 'forbidden-pattern-findings'],
  }),
});

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeBoundaryId(value, fieldName) {
  const id = String(value ?? '').trim();
  if (!id) {
    throw new Error(`TrustBoundary ${fieldName} is required`);
  }
  if (!Object.hasOwn(TRUST_BOUNDARY_REGISTRY, id)) {
    throw new Error(`Unknown TrustBoundary ${fieldName}: ${id}`);
  }
  return id;
}

function normalizeControls(controls = []) {
  if (!Array.isArray(controls)) {
    throw new Error('TrustBoundary crossing controls must be an array');
  }
  const normalized = [];
  for (const raw of controls) {
    const control = String(raw ?? '').trim();
    if (!TRUST_BOUNDARY_CONTROL_SET.has(control)) {
      throw new Error(`Unsupported TrustBoundary crossing control: ${control || '<empty>'}`);
    }
    if (!normalized.includes(control)) {
      normalized.push(control);
    }
  }
  return normalized.sort();
}

function requiredControlsForCrossing(from, to) {
  return [...new Set([
    ...TRUST_BOUNDARY_REGISTRY[from].requiredOutboundControls,
    ...TRUST_BOUNDARY_REGISTRY[to].requiredInboundControls,
  ])].sort();
}

function pathToString(path = []) {
  return path.length ? path.join('.') : '$';
}

function isRedactedValue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (typeof value === 'string') {
    return value === REDACTION_PLACEHOLDER || value === encodeURIComponent(REDACTION_PLACEHOLDER);
  }
  if (Array.isArray(value)) {
    return value.every(isRedactedValue);
  }
  if (isPlainObject(value)) {
    return Object.values(value).every(isRedactedValue);
  }
  return false;
}

function scanRawSensitiveMaterial(value, path = [], findings = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanRawSensitiveMaterial(item, [...path, String(index)], findings);
    }
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (isSensitiveFieldName(key) && !isRedactedValue(child)) {
        findings.push({
          path: pathToString(childPath),
          pattern: 'sensitive-field-name',
        });
        continue;
      }
      scanRawSensitiveMaterial(child, childPath, findings);
    }
    return findings;
  }
  if (typeof value !== 'string') {
    return findings;
  }
  for (const finding of scanForbiddenPatterns(value)) {
    findings.push({
      path: pathToString(path),
      pattern: finding.pattern,
    });
  }
  for (const { name, pattern } of RAW_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      findings.push({
        path: pathToString(path),
        pattern: name,
      });
    }
  }
  return findings;
}

function assertNoRawSensitiveMaterial(payload) {
  const findings = scanRawSensitiveMaterial(payload);
  if (findings.length) {
    const error = new Error('TrustBoundary crossing contains raw sensitive material');
    error.code = 'trust-boundary-raw-sensitive-material';
    error.findings = findings;
    throw error;
  }
}

export function getTrustBoundaryRegistry() {
  return TRUST_BOUNDARY_REGISTRY;
}

export function listTrustBoundaries() {
  return TRUST_BOUNDARY_IDS.map((id) => TRUST_BOUNDARY_REGISTRY[id]);
}

export function getTrustBoundary(id) {
  return TRUST_BOUNDARY_REGISTRY[normalizeBoundaryId(id, 'id')];
}

export function assertTrustBoundaryRegistryComplete(requiredIds = TRUST_BOUNDARY_IDS) {
  for (const id of requiredIds) {
    if (!Object.hasOwn(TRUST_BOUNDARY_REGISTRY, id)) {
      throw new Error(`TrustBoundary registry is missing required boundary: ${id}`);
    }
  }
  for (const boundary of Object.values(TRUST_BOUNDARY_REGISTRY)) {
    for (const control of [
      ...boundary.requiredOutboundControls,
      ...boundary.requiredInboundControls,
    ]) {
      if (!TRUST_BOUNDARY_CONTROL_SET.has(control)) {
        throw new Error(`TrustBoundary ${boundary.id} declares unsupported control: ${control}`);
      }
    }
  }
  return true;
}

export function normalizeTrustBoundaryCrossing(crossing = {}) {
  if (!isPlainObject(crossing)) {
    throw new Error('TrustBoundary crossing must be an object');
  }
  const from = normalizeBoundaryId(crossing.from ?? crossing.source, 'from');
  const to = normalizeBoundaryId(crossing.to ?? crossing.target, 'to');
  const controls = normalizeControls(crossing.controls);
  const requiredControls = requiredControlsForCrossing(from, to);
  return {
    schemaVersion: TRUST_BOUNDARY_CROSSING_SCHEMA_VERSION,
    from,
    to,
    purpose: String(crossing.purpose ?? '').trim() || undefined,
    controls,
    requiredControls,
  };
}

export function assertTrustBoundaryCrossing(crossing = {}) {
  const normalized = normalizeTrustBoundaryCrossing(crossing);
  const missingControls = normalized.requiredControls.filter(
    (control) => !normalized.controls.includes(control),
  );
  if (missingControls.length) {
    const error = new Error(
      `TrustBoundary crossing ${normalized.from}->${normalized.to} is missing required controls: ${missingControls.join(', ')}`,
    );
    error.code = 'trust-boundary-missing-controls';
    error.missingControls = missingControls;
    throw error;
  }
  assertNoRawSensitiveMaterial(crossing.payload);
  return normalized;
}

export function createTrustBoundaryCrossingRecord(crossing = {}) {
  return assertTrustBoundaryCrossing(crossing);
}
