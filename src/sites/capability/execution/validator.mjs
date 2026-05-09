// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from '../security-guard.mjs';
import {
  EXECUTION_STATUSES,
  SITE_CAPABILITY_EXECUTION_COMPATIBLE_SCHEMA_VERSIONS,
} from './schema.mjs';

const FORBIDDEN_EXECUTION_FIELDS = Object.freeze([
  /^downloadPolicy$/iu,
  /^standardTaskList$/iu,
  /^sessionView$/iu,
  /^sessionLease$/iu,
  /^siteAdapterDecision$/iu,
  /^siteAdapterRuntime$/iu,
  /^resolvedResources$/iu,
  /^downloaderPayload$/iu,
  /^downloaderTask$/iu,
  /^downloaderCommand$/iu,
  /^runDownloadTask$/iu,
  /^executeMediaDownloads$/iu,
  /^browserContext$/iu,
  /^handler$/iu,
  /^execute$/iu,
  /^executor$/iu,
  /^headers$/iu,
  /^requestHeaders$/iu,
  /^storageState$/iu,
  /^profilePath$/iu,
  /^browserProfilePath$/iu,
  /^userDataDir$/iu,
  /(?:^|[_-])account[_-]?(?:id|identifier)(?:$|[_-])/iu,
  /(?:^|[_-])ip[_-]?(?:address)?(?:$|[_-])/iu,
  /(?:^|[_-])device[_-]?fingerprint(?:$|[_-])/iu,
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, 'execution.plan_invalid');
  }
}

function assertNonEmptyString(value, name, code = 'execution.plan_invalid') {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, code);
  }
}

function assertSchemaVersion(value, name) {
  if (!SITE_CAPABILITY_EXECUTION_COMPATIBLE_SCHEMA_VERSIONS.includes(value)) {
    fail(`${name} schemaVersion is not compatible`, 'execution.version_incompatible');
  }
}

function scan(value, findings, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scan(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveFieldName(key) || FORBIDDEN_EXECUTION_FIELDS.some((pattern) => pattern.test(key))) {
      findings.push([...path, key].join('.'));
      continue;
    }
    scan(child, findings, [...path, key]);
  }
}

export function assertNoExecutionSensitiveMaterial(value) {
  const findings = [];
  scan(value, findings);
  if (findings.length) {
    fail('Execution descriptor contains forbidden sensitive or runtime fields', 'execution.raw_sensitive_material_rejected');
  }
  try {
    assertNoForbiddenPatterns(value);
  } catch {
    fail('Execution descriptor contains forbidden sensitive value patterns', 'execution.raw_sensitive_material_rejected');
  }
  return true;
}

function assertDisabledRuntimeFlags(value, name) {
  const expectedFalse = [
    'executionAttempted',
    'layerDispatchAllowed',
    'directDownloaderInvocationAllowed',
    'directSiteAdapterInvocationAllowed',
    'sessionViewAllowed',
    'rawCredentialMaterialAllowed',
  ];
  for (const flag of expectedFalse) {
    if (value[flag] !== false) {
      fail(`${name} ${flag} must be false`, 'execution.layer_handoff_unavailable');
    }
  }
  if (value.descriptorOnly !== true || value.redactionRequired !== true) {
    fail(`${name} must be descriptor-only and redaction-required`, 'execution.redaction_required');
  }
}

export function assertExecutionManifestCompatible(manifest) {
  assertPlainObject(manifest, 'ExecutionManifest');
  assertSchemaVersion(manifest.schemaVersion, 'ExecutionManifest');
  assertNoExecutionSensitiveMaterial(manifest);
  assertNonEmptyString(manifest.executionId, 'ExecutionManifest executionId');
  assertNonEmptyString(manifest.capabilityPlanRef, 'ExecutionManifest capabilityPlanRef');
  assertNonEmptyString(manifest.graphVersion, 'ExecutionManifest graphVersion', 'execution.version_incompatible');
  assertNonEmptyString(manifest.plannerVersion, 'ExecutionManifest plannerVersion', 'execution.version_incompatible');
  assertNonEmptyString(
    manifest.layerCompatibilityVersion,
    'ExecutionManifest layerCompatibilityVersion',
    'execution.version_incompatible',
  );
  assertDisabledRuntimeFlags(manifest, 'ExecutionManifest');
  return true;
}

export function assertLayerExecutionHandoffDescriptorCompatible(handoff) {
  assertExecutionManifestCompatible(handoff);
  if (handoff.handoffTarget !== 'site-capability-layer') {
    fail('LayerExecutionHandoffDescriptor target must be site-capability-layer', 'execution.layer_handoff_unavailable');
  }
  return true;
}

export function assertExecutionFeedbackCompatible(feedback) {
  assertPlainObject(feedback, 'ExecutionFeedback');
  assertSchemaVersion(feedback.schemaVersion, 'ExecutionFeedback');
  assertNoExecutionSensitiveMaterial(feedback);
  if (feedback.feedbackSource !== 'site-capability-layer') {
    fail('ExecutionFeedback feedbackSource must be site-capability-layer', 'execution.feedback_invalid');
  }
  if (!EXECUTION_STATUSES.includes(feedback.executionStatus)) {
    fail('ExecutionFeedback executionStatus is unsupported', 'execution.feedback_invalid');
  }
  if (feedback.redactionRequired !== true) {
    fail('ExecutionFeedback redactionRequired must be true', 'execution.redaction_required');
  }
  return true;
}

export function assertCoverageDeltaCompatible(delta) {
  assertPlainObject(delta, 'CoverageDelta');
  assertSchemaVersion(delta.schemaVersion, 'CoverageDelta');
  assertNoExecutionSensitiveMaterial(delta);
  if (delta.redactionRequired !== true) {
    fail('CoverageDelta redactionRequired must be true', 'execution.redaction_required');
  }
  if (!Array.isArray(delta.evidenceRefs)) {
    fail('CoverageDelta evidenceRefs must be an array', 'execution.coverage_delta_invalid');
  }
  if (delta.coverageAfter === 'complete_within_scope' && delta.evidenceRefs.length === 0) {
    fail('CoverageDelta complete coverage requires evidence', 'execution.coverage_delta_invalid');
  }
  return true;
}
