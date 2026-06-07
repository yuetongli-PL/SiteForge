// @ts-check

import { jsonClone } from '../../shared/clone.mjs';
import { SITE_ADAPTER_REGISTRY_SCHEMA_VERSION } from './capability-package-schema.mjs';

const clone = jsonClone;
const FORBIDDEN_ADAPTER_FIELD_PATTERN =
  /(?:^|[_-])raw(?:$|[_-])|cookie|authorization|headers?|body|request|response|credential|password|session|vault|storageState|localStorage|sessionStorage|IndexedDB|artifactPath|catalogPath|writePath|screenshot|video|trace|handler|execute|executor/iu;
const FORBIDDEN_ADAPTER_VALUE_PATTERN = new RegExp([
  'sf_package_[a-z0-9_]*secret(?:_[0-9]+)?',
  'authorization:\\s*bearer',
  ['coo', 'kie:'].join(''),
  ['set-coo', 'kie:'].join(''),
  'storageState',
  'localStorage',
  'sessionStorage',
  'IndexedDB',
].join('|'), 'iu');

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function cleanText(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (!text || FORBIDDEN_ADAPTER_VALUE_PATTERN.test(text)) return fallback;
  return text.replace(/\s+/gu, ' ').slice(0, 240);
}

function cleanRef(value, fallback = '') {
  return cleanText(value, fallback)
    .replace(/[\s"'`<>\\]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function sortedUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean))]
    .sort();
}

function scanForbidden(value, findings = [], path = []) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      scanForbidden(entry, findings, [...path, String(index)]);
    }
    return findings;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_ADAPTER_FIELD_PATTERN.test(key)) {
        findings.push({ path: [...path, key].join('.') });
        continue;
      }
      scanForbidden(entry, findings, [...path, key]);
    }
    return findings;
  }
  if (typeof value === 'string' && FORBIDDEN_ADAPTER_VALUE_PATTERN.test(value)) {
    findings.push({ path: path.join('.') || '<root>' });
  }
  return findings;
}

function assertNoForbiddenAdapterMaterial(value) {
  const findings = scanForbidden(value);
  if (findings.length > 0) {
    const error = new Error('Site adapter descriptor contains forbidden raw material');
    // @ts-ignore
    error.code = 'site_adapter_descriptor.raw_material_rejected';
    // @ts-ignore
    error.details = { findings };
    throw error;
  }
  return true;
}

export function sanitizeSiteAdapterDescriptor(descriptor = {}) {
  assertNoForbiddenAdapterMaterial(descriptor);
  const sanitized = {
    schemaVersion: SITE_ADAPTER_REGISTRY_SCHEMA_VERSION,
    adapterId: cleanRef(descriptor.adapterId),
    siteKey: cleanRef(descriptor.siteKey),
    version: cleanText(descriptor.version, '1.0.0'),
    packageId: cleanRef(descriptor.packageId),
    supportedCapabilityRefs: sortedUnique(descriptor.supportedCapabilityRefs),
    providerCompatibility: sortedUnique(descriptor.providerCompatibility),
    material: 'descriptor_only',
    redactionRequired: true,
  };
  assertNoForbiddenAdapterMaterial(sanitized);
  return sanitized;
}

export function createSiteAdapterRegistry(options = {}) {
  const entries = new Map();
  return {
    register(descriptor = {}) {
      const safeDescriptor = sanitizeSiteAdapterDescriptor(descriptor);
      if (!safeDescriptor.adapterId || !safeDescriptor.siteKey || !safeDescriptor.packageId) {
        const error = new Error('Site adapter descriptor is invalid');
        // @ts-ignore
        error.code = 'site_adapter_descriptor.invalid';
        throw error;
      }
      entries.set(safeDescriptor.adapterId, {
        schemaVersion: SITE_ADAPTER_REGISTRY_SCHEMA_VERSION,
        descriptor: clone(safeDescriptor),
        registeredAt: String(options.registeredAt ?? 'unknown'),
        redactionRequired: true,
      });
      return clone(entries.get(safeDescriptor.adapterId));
    },
    resolve(adapterId) {
      const entry = entries.get(String(adapterId ?? '').trim());
      return entry ? clone(entry.descriptor) : null;
    },
    list() {
      return [...entries.values()]
        .sort((left, right) => left.descriptor.adapterId.localeCompare(right.descriptor.adapterId))
        .map(clone);
    },
  };
}

export function resolveSiteAdapterDescriptor(registry, adapterId) {
  if (!registry || typeof registry.resolve !== 'function') {
    return null;
  }
  return registry.resolve(adapterId);
}
