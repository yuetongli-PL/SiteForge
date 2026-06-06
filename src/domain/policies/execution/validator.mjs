// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from '../../sessions/security-guard.mjs';
import {
  isSafeStructuredSensitiveDescriptorValue,
  isStructuredExecutionDescriptorPath,
  isStructuredExecutionRefFieldName,
  scanUnsafeDescriptorRuntimeValues,
  structuredExecutionRefFieldNames,
} from '../../../shared/descriptor-safety.mjs';
import {
  EXECUTION_GATES,
  EXECUTION_STATUSES,
  EXECUTION_VERDICTS,
  SITE_CAPABILITY_EXECUTION_COMPATIBLE_SCHEMA_VERSIONS,
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
} from './schema.mjs';

const FORBIDDEN_EXECUTION_FIELDS = Object.freeze([
  /^sessionView$/iu,
  /^sessionLease$/iu,
  /^siteAdapterRuntime$/iu,
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
  /^responseHeaders$/iu,
  /^requestPayload$/iu,
  /^responsePayload$/iu,
  /^requestBody$/iu,
  /^responseBody$/iu,
  /(?:^|[_-])raw[_-]?(?:credential|secret|token|cookie|header|session|profile|body|request|response|payload)(?:$|[_-])/iu,
  /^storageState$/iu,
  /^cookieJar$/iu,
  /^credentialRef$/iu,
  /^authStoreRef$/iu,
  /^profileRef$/iu,
  /^profilePath$/iu,
  /^browserProfilePath$/iu,
  /^userDataDir$/iu,
  /^localFilePath$/iu,
  /^privateFilePath$/iu,
  /^persistentSessionPath$/iu,
  /^sessionPath$/iu,
  /^dynamicImport$/iu,
  /(?:^|[_-])account[_-]?(?:id|identifier)(?:$|[_-])/iu,
  /(?:^|[_-])user[_-]?(?:id|identifier|account)(?:$|[_-])/iu,
  /(?:^|[_-])profile[_-]?data(?:$|[_-])/iu,
  /(?:^|[_-])submitted[_-]?(?:content|body|form)(?:$|[_-])/iu,
  /(?:^|[_-])user[_-]?submitted[_-]?(?:content|body|form)(?:$|[_-])/iu,
  /(?:^|[_-])order[_-]?(?:data|details?|record|id)(?:$|[_-])/iu,
  /(?:^|[_-])shipping[_-]?address(?:$|[_-])/iu,
  /(?:^|[_-])billing[_-]?address(?:$|[_-])/iu,
  /(?:^|[_-])address(?:$|[_-])/iu,
  /(?:^|[_-])payment[_-]?(?:field|fields|data|method|instrument|token)?(?:$|[_-])/iu,
  /(?:^|[_-])card[_-]?(?:number|holder|expiry|cvv|cvc)?(?:$|[_-])/iu,
  /(?:^|[_-])ip[_-]?(?:address)?(?:$|[_-])/iu,
  /(?:^|[_-])device[_-]?fingerprint(?:$|[_-])/iu,
  /^standardTaskList$/iu,
  /^siteAdapterDecision$/iu,
  /^siteAdapterInstance$/iu,
  /^adapterInstance$/iu,
]);

const EXECUTION_REF_FIELD_NAMES = Object.freeze(new Set([
  'artifactRef',
  'artifactRefs',
  'capabilityPlanRef',
  'plannerHandoffRef',
  'planRef',
  'intentRef',
  'executionContractRef',
  'policyDecisionRef',
  'runtimeInvocationRequestRef',
  'affectedNodeRefs',
  'affectedCapabilityRefs',
  'affectedRouteRefs',
  'evidenceRef',
  'evidenceRefs',
  ...structuredExecutionRefFieldNames(),
]));

const ALWAYS_FORBIDDEN_EXECUTION_DESCRIPTOR_FIELD_PATTERNS = Object.freeze([
  /^sessionView$/iu,
  /^sessionLease$/iu,
  /^siteAdapterRuntime$/iu,
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
  /^responseHeaders$/iu,
  /^requestPayload$/iu,
  /^responsePayload$/iu,
  /^requestBody$/iu,
  /^responseBody$/iu,
  /(?:^|[_-])raw[_-]?(?:credential|secret|token|cookie|header|session|profile|body|request|response|payload)(?:$|[_-])/iu,
  /^storageState$/iu,
  /^cookieJar$/iu,
  /^credentialRef$/iu,
  /^authStoreRef$/iu,
  /^profileRef$/iu,
  /^profilePath$/iu,
  /^browserProfilePath$/iu,
  /^userDataDir$/iu,
  /^localFilePath$/iu,
  /^privateFilePath$/iu,
  /^persistentSessionPath$/iu,
  /^sessionPath$/iu,
  /^dynamicImport$/iu,
]);

const ALLOWED_EXECUTION_REF_PATTERN =
  /^(?:artifact|auth-requirement|capability|compiler|coverage|downloader-task|execution|execution-contract|governance-policy|graph|intent|layer|manifest|node|plan|planner|planner-handoff|policy|policy-decision|route|runtime-binding|runtime-invocation|schema|session-requirement|test):[a-z0-9._:/-]+$/iu;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code) {
  /** @type {Error & Record<string, any>} */
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

function isUnsafeRefSyntax(value) {
  const text = String(value ?? '').trim();
  return text === ''
    || text.length > 240
    || text !== value
    || /[\s"'`<>]/u.test(text)
    || /[?&=%#]/u.test(text)
    || /^https?:\/\//iu.test(text)
    || /^[a-z]:[\\/]/iu.test(text)
    || /^\\\\/u.test(text)
    || /^\//u.test(text)
    || /(?:^|\/)\.\.(?:\/|$)/u.test(text)
    || /\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(text)
    || /@/u.test(text)
    || /\.(?:cmd|bat|ps1|sh|exe|dll|mjs|cjs|js)(?:$|[#:/])/iu.test(text)
    || /\b(?:cookie|authorization|credential|sessdata|csrf|access[_-]?token|refresh[_-]?token|session[_-]?id|browser[_-]?profile|user[_-]?data[_-]?dir)\b/iu.test(text);
}

function assertExecutionEvidenceRefAllowed(value, name) {
  assertNonEmptyString(value, name, 'execution.raw_sensitive_material_rejected');
  if (isUnsafeRefSyntax(value) || !ALLOWED_EXECUTION_REF_PATTERN.test(value)) {
    fail(`${name} must be a sanitized execution evidence ref`, 'execution.raw_sensitive_material_rejected');
  }
  return true;
}

function assertSchemaVersion(value, name) {
  if (!SITE_CAPABILITY_EXECUTION_COMPATIBLE_SCHEMA_VERSIONS.includes(value)) {
    fail(`${name} schemaVersion is not compatible`, 'execution.version_incompatible');
  }
}

function isStructuredDescriptorAllowedField(name, value, path = []) {
  if (ALWAYS_FORBIDDEN_EXECUTION_DESCRIPTOR_FIELD_PATTERNS.some((pattern) => pattern.test(String(name ?? '')))) {
    return false;
  }
  const childPath = [...path, String(name ?? '')];
  if (!isStructuredExecutionDescriptorPath(path) && !isStructuredExecutionDescriptorPath(childPath)) {
    return false;
  }
  return isSafeStructuredSensitiveDescriptorValue(value, childPath, {
    isSensitiveFieldName,
  });
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
    const sensitive = isSensitiveFieldName(key);
    const forbidden = FORBIDDEN_EXECUTION_FIELDS.some((pattern) => pattern.test(key));
    if (
      (sensitive || forbidden)
      && !isStructuredDescriptorAllowedField(key, child, path)
    ) {
      findings.push([...path, key].join('.'));
      continue;
    }
    scan(child, findings, [...path, key]);
  }
}

function scanExecutionEvidenceRefs(value, findings, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanExecutionEvidenceRefs(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (EXECUTION_REF_FIELD_NAMES.has(key) || isStructuredExecutionRefFieldName(key)) {
      if (child === undefined || child === null) {
        continue;
      }
      const values = Array.isArray(child) ? child : [child];
      for (const [index, refValue] of values.entries()) {
        try {
          assertExecutionEvidenceRefAllowed(refValue, `${childPath.join('.')}.${index}`);
        } catch {
          findings.push(`${childPath.join('.')}.${index}`);
        }
      }
      continue;
    }
    scanExecutionEvidenceRefs(child, findings, childPath);
  }
}

export function assertNoExecutionSensitiveMaterial(value) {
  const findings = [];
  scan(value, findings);
  if (findings.length) {
    fail('Execution descriptor contains forbidden sensitive or runtime fields', 'execution.raw_sensitive_material_rejected');
  }
  scanUnsafeDescriptorRuntimeValues(value, findings);
  if (findings.length) {
    fail('Execution descriptor contains forbidden runtime values', 'execution.raw_sensitive_material_rejected');
  }
  scanExecutionEvidenceRefs(value, findings);
  if (findings.length) {
    fail('Execution descriptor contains unsafe evidence refs', 'execution.raw_sensitive_material_rejected');
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

function assertLayerDryRunFeedbackFlags(value, name) {
  if (
    value.dryRun !== true
    || value.runtimeExecuted !== false
    || value.directDownloaderInvocationAllowed !== false
    || value.directSiteAdapterInvocationAllowed !== false
    || value.sessionViewMaterializationAllowed !== false
  ) {
    fail(`${name} must describe dry-run Layer feedback without direct runtime execution`, 'execution.layer_handoff_unavailable');
  }
}

export function assertExecutionManifestCompatible(manifest) {
  assertPlainObject(manifest, 'ExecutionManifest');
  assertSchemaVersion(manifest.schemaVersion, 'ExecutionManifest');
  assertNoExecutionSensitiveMaterial(manifest);
  assertNonEmptyString(manifest.executionId, 'ExecutionManifest executionId');
  assertNonEmptyString(manifest.capabilityPlanRef, 'ExecutionManifest capabilityPlanRef');
  assertExecutionEvidenceRefAllowed(manifest.capabilityPlanRef, 'ExecutionManifest capabilityPlanRef');
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
  if (feedback.artifactRefs !== undefined) {
    if (!Array.isArray(feedback.artifactRefs)) {
      fail('ExecutionFeedback artifactRefs must be an array', 'execution.feedback_invalid');
    }
    for (const artifactRef of feedback.artifactRefs) {
      assertExecutionEvidenceRefAllowed(artifactRef, 'ExecutionFeedback artifactRefs');
    }
  }
  if (feedback.redactionRequired !== true) {
    fail('ExecutionFeedback redactionRequired must be true', 'execution.redaction_required');
  }
  assertLayerDryRunFeedbackFlags(feedback, 'ExecutionFeedback');
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
  for (const evidenceRef of delta.evidenceRefs) {
    assertExecutionEvidenceRefAllowed(evidenceRef, 'CoverageDelta evidenceRefs');
  }
  if (delta.coverageAfter === 'complete_within_scope' && delta.evidenceRefs.length === 0) {
    fail('CoverageDelta complete coverage requires evidence', 'execution.coverage_delta_invalid');
  }
  assertLayerDryRunFeedbackFlags(delta, 'CoverageDelta');
  return true;
}

export function assertRuntimeInvocationRequestCompatible(request) {
  assertPlainObject(request, 'RuntimeInvocationRequest');
  assertSchemaVersion(request.schemaVersion, 'RuntimeInvocationRequest');
  assertNoExecutionSensitiveMaterial(request);
  if (request.requestType !== 'RuntimeInvocationRequest') {
    fail('RuntimeInvocationRequest requestType is required', 'execution.runtime_invocation_invalid');
  }
  if (request.runtimeBoundary !== 'app/runtime') {
    fail('RuntimeInvocationRequest runtimeBoundary must be app/runtime', 'execution.runtime_invocation_invalid');
  }
  if (request.descriptorOnly !== true || request.redactionRequired !== true) {
    fail('RuntimeInvocationRequest must be descriptor-only and redaction-required', 'execution.redaction_required');
  }
  if (request.executionAttempted !== false || request.sideEffectAttempted !== false) {
    fail('RuntimeInvocationRequest cannot claim runtime execution', 'execution.layer_handoff_unavailable');
  }
  if (request.schemaVersion !== SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION) {
    fail('RuntimeInvocationRequest schemaVersion is not compatible', 'execution.version_incompatible');
  }
  assertNonEmptyString(request.requestId, 'RuntimeInvocationRequest requestId');
  assertNonEmptyString(request.capabilityId, 'RuntimeInvocationRequest capabilityId');
  assertNonEmptyString(request.executionContractRef, 'RuntimeInvocationRequest executionContractRef');
  assertExecutionEvidenceRefAllowed(request.executionContractRef, 'RuntimeInvocationRequest executionContractRef');
  if (request.planRef !== undefined) {
    assertExecutionEvidenceRefAllowed(request.planRef, 'RuntimeInvocationRequest planRef');
  }
  if (request.intentRef !== undefined) {
    assertExecutionEvidenceRefAllowed(request.intentRef, 'RuntimeInvocationRequest intentRef');
  }
  if (request.policyDecisionRef !== undefined) {
    assertExecutionEvidenceRefAllowed(request.policyDecisionRef, 'RuntimeInvocationRequest policyDecisionRef');
  }
  if (request.verdictHint !== undefined && !EXECUTION_VERDICTS.includes(request.verdictHint)) {
    fail('RuntimeInvocationRequest verdictHint is unsupported', 'execution.runtime_invocation_invalid');
  }
  if (request.requiredGates !== undefined) {
    if (!Array.isArray(request.requiredGates)) {
      fail('RuntimeInvocationRequest requiredGates must be an array', 'execution.runtime_invocation_invalid');
    }
    for (const gate of request.requiredGates) {
      if (!EXECUTION_GATES.includes(gate)) {
        fail('RuntimeInvocationRequest requiredGates contains an unsupported gate', 'execution.runtime_invocation_invalid');
      }
    }
  }
  return true;
}
