// @ts-check

import { listCapabilityServiceInventory } from './service-inventory.mjs';

export const LAYER_BOUNDARY_SCHEMA_VERSION = 1;
export const LAYER_CROSSING_SCHEMA_VERSION = 1;

export const LAYER_IDS = Object.freeze([
  'Kernel',
  'CapabilityService',
  'SiteAdapter',
  'downloader',
]);

export const LAYER_CROSSING_CONTROLS = Object.freeze([
  'adapter-mediated',
  'descriptor-only',
  'minimized',
  'permission-checked',
  'policy-gated',
  'reason-coded',
  'redacted',
  'schema-compatible',
]);

const LAYER_ID_SET = new Set(LAYER_IDS);
const LAYER_CROSSING_CONTROL_SET = new Set(LAYER_CROSSING_CONTROLS);

const CONCRETE_SITE_SEMANTIC_PATTERN =
  /\b(?:22biqu|bilibili|douyin|instagram|jable|moodyz|xiaohongshu|x\.com|api\.bilibili\.com|www\.douyin\.com)\b/iu;

const RAW_SENSITIVE_MATERIAL_PATTERN =
  /\b(?:authorization|browser profile|browserProfile|cookie|csrf|raw credential|raw session|SESSDATA|session id|token|userDataDir)\b/iu;

function freezeBoundary(boundary) {
  return Object.freeze({
    ...boundary,
    allowedResponsibilities: Object.freeze([...(boundary.allowedResponsibilities ?? [])]),
    forbiddenResponsibilities: Object.freeze([...(boundary.forbiddenResponsibilities ?? [])]),
    crossingControls: Object.freeze([...(boundary.crossingControls ?? [])]),
    forbiddenPatterns: Object.freeze([...(boundary.forbiddenPatterns ?? [])]),
    evidence: Object.freeze({ ...(boundary.evidence ?? {}) }),
  });
}

function crossing({ from, to, requiredControls, allowedMaterial, purpose }) {
  return Object.freeze({
    schemaVersion: LAYER_CROSSING_SCHEMA_VERSION,
    from,
    to,
    purpose,
    requiredControls: Object.freeze([...requiredControls].sort()),
    allowedMaterial: Object.freeze([...allowedMaterial]),
  });
}

const CAPABILITY_SERVICE_NAMES = Object.freeze(
  listCapabilityServiceInventory().map((entry) => entry.stableName).sort(),
);

const LAYER_BOUNDARY_REGISTRY = Object.freeze({
  Kernel: freezeBoundary({
    schemaVersion: LAYER_BOUNDARY_SCHEMA_VERSION,
    id: 'Kernel',
    owner: 'Kernel',
    role: 'site-agnostic coordinator',
    allowedResponsibilities: [
      'coordination',
      'common safety gates',
      'lifecycle event production',
      'schema governance',
      'reason semantics',
      'policy handoff',
    ],
    forbiddenResponsibilities: [
      'concrete site page interpretation',
      'concrete site endpoint validation',
      'direct concrete adapter imports',
      'downloader execution',
      'raw credential or browser profile handling',
    ],
    crossingControls: [
      'adapter-mediated',
      'descriptor-only',
      'policy-gated',
      'reason-coded',
      'schema-compatible',
    ],
    forbiddenPatterns: [
      CONCRETE_SITE_SEMANTIC_PATTERN,
      RAW_SENSITIVE_MATERIAL_PATTERN,
    ],
    siteSemanticsPolicy: 'forbidden',
    evidence: {
      source: 'Section 3 layered architecture contract',
    },
  }),
  CapabilityService: freezeBoundary({
    schemaVersion: LAYER_BOUNDARY_SCHEMA_VERSION,
    id: 'CapabilityService',
    owner: 'CapabilityService',
    role: 'cross-site reusable service layer',
    allowedResponsibilities: [
      'redaction',
      'schema compatibility',
      'minimal SessionView materialization',
      'risk state normalization',
      'lifecycle hook descriptors',
      'artifact reference governance',
      'download policy contracts',
      'capture and API evidence normalization',
    ],
    forbiddenResponsibilities: [
      'concrete site page interpretation',
      'concrete site endpoint meaning',
      'browser runtime orchestration',
      'downloader execution',
      'raw credential or browser profile handling',
    ],
    crossingControls: [
      'descriptor-only',
      'minimized',
      'permission-checked',
      'redacted',
      'schema-compatible',
    ],
    forbiddenPatterns: [
      CONCRETE_SITE_SEMANTIC_PATTERN,
      RAW_SENSITIVE_MATERIAL_PATTERN,
    ],
    siteSemanticsPolicy: 'forbidden',
    evidence: {
      serviceInventoryNames: CAPABILITY_SERVICE_NAMES,
      serviceInventoryPath: 'src/sites/capability/service-inventory.mjs',
    },
  }),
  SiteAdapter: freezeBoundary({
    schemaVersion: LAYER_BOUNDARY_SCHEMA_VERSION,
    id: 'SiteAdapter',
    owner: 'SiteAdapter',
    role: 'site-specific interpreter and validator',
    allowedResponsibilities: [
      'site identity matching',
      'page type interpretation',
      'site API candidate validation',
      'site risk signal mapping',
      'normalized site decisions',
    ],
    forbiddenResponsibilities: [
      'artifact persistence',
      'catalog promotion writes',
      'kernel coordination ownership',
      'downloader execution',
      'raw credential or browser profile handling',
    ],
    crossingControls: [
      'adapter-mediated',
      'minimized',
      'reason-coded',
      'redacted',
      'schema-compatible',
    ],
    forbiddenPatterns: [
      RAW_SENSITIVE_MATERIAL_PATTERN,
    ],
    siteSemanticsPolicy: 'owned',
    evidence: {
      adapterRegistryPath: 'src/sites/core/adapters/resolver.mjs',
    },
  }),
  downloader: freezeBoundary({
    schemaVersion: LAYER_BOUNDARY_SCHEMA_VERSION,
    id: 'downloader',
    owner: 'downloader',
    role: 'low-permission consumer',
    allowedResponsibilities: [
      'consume planned tasks',
      'consume DownloadPolicy',
      'consume minimal SessionView',
      'consume resolved resources',
      'execute low-permission file transfer work',
    ],
    forbiddenResponsibilities: [
      'concrete site page interpretation',
      'concrete site endpoint validation',
      'site identity classification tables',
      'API discovery',
      'catalog promotion writes',
      'browser runtime orchestration',
      'raw credential or browser profile handling',
    ],
    crossingControls: [
      'minimized',
      'permission-checked',
      'policy-gated',
      'redacted',
      'schema-compatible',
    ],
    forbiddenPatterns: [
      CONCRETE_SITE_SEMANTIC_PATTERN,
      RAW_SENSITIVE_MATERIAL_PATTERN,
    ],
    siteSemanticsPolicy: 'forbidden',
    evidence: {
      contractPath: 'src/sites/downloads/contracts.mjs',
    },
  }),
});

const LAYER_CROSSING_REGISTRY = Object.freeze(new Map([
  ['Kernel->CapabilityService', crossing({
    from: 'Kernel',
    to: 'CapabilityService',
    purpose: 'site-agnostic governance and service calls',
    requiredControls: ['schema-compatible'],
    allowedMaterial: ['schema name', 'reason code', 'policy descriptor', 'lifecycle descriptor'],
  })],
  ['CapabilityService->Kernel', crossing({
    from: 'CapabilityService',
    to: 'Kernel',
    purpose: 'normalized service evidence returned to orchestration',
    requiredControls: ['redacted', 'schema-compatible'],
    allowedMaterial: ['redaction audit', 'normalized risk state', 'artifact reference', 'lifecycle event'],
  })],
  ['Kernel->SiteAdapter', crossing({
    from: 'Kernel',
    to: 'SiteAdapter',
    purpose: 'site-specific interpretation through adapter contracts',
    requiredControls: ['adapter-mediated', 'minimized', 'schema-compatible'],
    allowedMaterial: ['url facts', 'page facts', 'candidate evidence reference'],
  })],
  ['SiteAdapter->Kernel', crossing({
    from: 'SiteAdapter',
    to: 'Kernel',
    purpose: 'normalized site decision returned to site-agnostic orchestration',
    requiredControls: ['reason-coded', 'redacted', 'schema-compatible'],
    allowedMaterial: ['normalized site decision', 'reason code', 'redacted evidence summary'],
  })],
  ['CapabilityService->SiteAdapter', crossing({
    from: 'CapabilityService',
    to: 'SiteAdapter',
    purpose: 'redacted evidence supplied for adapter validation',
    requiredControls: ['minimized', 'redacted', 'schema-compatible'],
    allowedMaterial: ['redacted API candidate', 'redacted capture summary'],
  })],
  ['SiteAdapter->CapabilityService', crossing({
    from: 'SiteAdapter',
    to: 'CapabilityService',
    purpose: 'adapter decisions supplied to governed services',
    requiredControls: ['reason-coded', 'redacted', 'schema-compatible'],
    allowedMaterial: ['candidate decision', 'catalog upgrade policy', 'risk signal'],
  })],
  ['Kernel->downloader', crossing({
    from: 'Kernel',
    to: 'downloader',
    purpose: 'low-permission download handoff',
    requiredControls: ['minimized', 'permission-checked', 'policy-gated', 'schema-compatible'],
    allowedMaterial: ['StandardTaskList', 'DownloadPolicy', 'SessionView', 'resolved resource reference'],
  })],
  ['CapabilityService->downloader', crossing({
    from: 'CapabilityService',
    to: 'downloader',
    purpose: 'governed low-permission contract materialization',
    requiredControls: ['minimized', 'permission-checked', 'redacted', 'schema-compatible'],
    allowedMaterial: ['DownloadPolicy', 'SessionView', 'artifact reference set'],
  })],
]));

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function cloneBoundary(boundary) {
  return {
    ...boundary,
    allowedResponsibilities: [...boundary.allowedResponsibilities],
    forbiddenResponsibilities: [...boundary.forbiddenResponsibilities],
    crossingControls: [...boundary.crossingControls],
    forbiddenPatterns: [...boundary.forbiddenPatterns],
    evidence: { ...boundary.evidence },
  };
}

function cloneCrossing(crossingRecord) {
  return {
    ...crossingRecord,
    requiredControls: [...crossingRecord.requiredControls],
    allowedMaterial: [...crossingRecord.allowedMaterial],
  };
}

function normalizeLayerId(value, fieldName = 'layerId') {
  const layerId = String(value ?? '').trim();
  if (!layerId) {
    throw new Error(`LayerBoundary ${fieldName} is required`);
  }
  if (!LAYER_ID_SET.has(layerId)) {
    throw new Error(`Unknown LayerBoundary ${fieldName}: ${layerId}`);
  }
  return layerId;
}

function normalizeControls(controls = []) {
  if (!Array.isArray(controls)) {
    throw new Error('LayerBoundary crossing controls must be an array');
  }
  const normalized = [];
  for (const raw of controls) {
    const control = String(raw ?? '').trim();
    if (!LAYER_CROSSING_CONTROL_SET.has(control)) {
      throw new Error(`Unsupported LayerBoundary crossing control: ${control || '<empty>'}`);
    }
    if (!normalized.includes(control)) {
      normalized.push(control);
    }
  }
  return normalized.sort();
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LayerBoundary ${fieldName} is required`);
  }
}

function assertStringArray(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`LayerBoundary ${fieldName} must be a non-empty array`);
  }
  for (const [index, value] of values.entries()) {
    assertNonEmptyString(value, `${fieldName}[${index}]`);
  }
}

function assertForbiddenPatterns(layer, responsibility) {
  const text = String(responsibility ?? '');
  for (const pattern of layer.forbiddenPatterns) {
    if (pattern.test(text)) {
      const error = new Error(`LayerBoundary ${layer.id} responsibility crosses a forbidden boundary: ${text}`);
      error.code = 'layer-boundary-forbidden-responsibility';
      error.layerId = layer.id;
      throw error;
    }
  }
}

export function listLayerBoundaries() {
  return LAYER_IDS.map((id) => cloneBoundary(LAYER_BOUNDARY_REGISTRY[id]));
}

export function getLayerBoundary(layerId) {
  return cloneBoundary(LAYER_BOUNDARY_REGISTRY[normalizeLayerId(layerId)]);
}

export function listLayerCrossings() {
  return [...LAYER_CROSSING_REGISTRY.values()].map(cloneCrossing);
}

export function assertLayerBoundary(boundary = {}) {
  if (!isPlainObject(boundary)) {
    throw new Error('LayerBoundary definition must be an object');
  }
  if (boundary.schemaVersion !== LAYER_BOUNDARY_SCHEMA_VERSION) {
    throw new Error(
      `LayerBoundary ${boundary.id ?? '<unknown>'} schemaVersion must be ${LAYER_BOUNDARY_SCHEMA_VERSION}`,
    );
  }
  const layerId = normalizeLayerId(boundary.id, 'id');
  assertNonEmptyString(boundary.owner, `${layerId}.owner`);
  assertNonEmptyString(boundary.role, `${layerId}.role`);
  assertStringArray(boundary.allowedResponsibilities, `${layerId}.allowedResponsibilities`);
  assertStringArray(boundary.forbiddenResponsibilities, `${layerId}.forbiddenResponsibilities`);
  const crossingControls = normalizeControls(boundary.crossingControls);
  if (crossingControls.length === 0) {
    throw new Error(`LayerBoundary ${layerId}.crossingControls must not be empty`);
  }
  if (!['forbidden', 'owned'].includes(boundary.siteSemanticsPolicy)) {
    throw new Error(`LayerBoundary ${layerId}.siteSemanticsPolicy must be forbidden or owned`);
  }
  if (layerId !== 'SiteAdapter' && boundary.siteSemanticsPolicy !== 'forbidden') {
    throw new Error(`LayerBoundary ${layerId} must not own concrete site semantics`);
  }
  for (const responsibility of boundary.allowedResponsibilities) {
    assertForbiddenPatterns(boundary, responsibility);
  }
  return true;
}

export function assertLayerBoundaryRegistryComplete(requiredLayers = LAYER_IDS) {
  for (const layerId of requiredLayers) {
    if (!Object.hasOwn(LAYER_BOUNDARY_REGISTRY, layerId)) {
      throw new Error(`LayerBoundary registry is missing required layer: ${layerId}`);
    }
    assertLayerBoundary(LAYER_BOUNDARY_REGISTRY[layerId]);
  }
  return true;
}

export function assertLayerResponsibility({ layerId, responsibility } = {}) {
  const layer = LAYER_BOUNDARY_REGISTRY[normalizeLayerId(layerId)];
  assertNonEmptyString(responsibility, `${layer.id}.responsibility`);
  assertForbiddenPatterns(layer, responsibility);
  const normalizedResponsibility = responsibility.trim().toLowerCase();
  const forbidden = layer.forbiddenResponsibilities.find(
    (entry) => normalizedResponsibility.includes(entry.toLowerCase()),
  );
  if (forbidden) {
    const error = new Error(`LayerBoundary ${layer.id} forbids responsibility: ${forbidden}`);
    error.code = 'layer-boundary-forbidden-responsibility';
    error.layerId = layer.id;
    error.responsibility = responsibility;
    throw error;
  }
  return {
    layerId: layer.id,
    responsibility: responsibility.trim(),
  };
}

export function normalizeLayerCrossing(crossingRecord = {}) {
  if (!isPlainObject(crossingRecord)) {
    throw new Error('LayerBoundary crossing must be an object');
  }
  const from = normalizeLayerId(crossingRecord.from ?? crossingRecord.source, 'from');
  const to = normalizeLayerId(crossingRecord.to ?? crossingRecord.target, 'to');
  const key = `${from}->${to}`;
  const contract = LAYER_CROSSING_REGISTRY.get(key);
  if (!contract) {
    throw new Error(`Unknown LayerBoundary crossing: ${key}`);
  }
  return {
    schemaVersion: LAYER_CROSSING_SCHEMA_VERSION,
    from,
    to,
    purpose: String(crossingRecord.purpose ?? contract.purpose).trim(),
    controls: normalizeControls(crossingRecord.controls),
    requiredControls: [...contract.requiredControls],
    allowedMaterial: [...contract.allowedMaterial],
  };
}

export function assertLayerCrossing(crossingRecord = {}) {
  const normalized = normalizeLayerCrossing(crossingRecord);
  const missingControls = normalized.requiredControls.filter(
    (control) => !normalized.controls.includes(control),
  );
  if (missingControls.length) {
    const error = new Error(
      `LayerBoundary crossing ${normalized.from}->${normalized.to} is missing required controls: ${missingControls.join(', ')}`,
    );
    error.code = 'layer-boundary-missing-controls';
    error.missingControls = missingControls;
    throw error;
  }
  return normalized;
}
