// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from '../../domain/sessions/security-guard.mjs';
import {
  PLANNER_PLAN_STATUSES,
  PLANNER_REQUEST_MODES,
  PLANNER_SELECTED_ROUTE_SOURCE,
  SITE_CAPABILITY_PLANNER_COMPATIBLE_SCHEMA_VERSIONS,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';

const FORBIDDEN_PLANNER_FIELD_PATTERNS = Object.freeze([
  /(?:^|[_-])raw[_-]?(?:credential|secret|token|cookie|header|session|profile)(?:$|[_-])/iu,
  /^headers$/iu,
  /^requestHeaders$/iu,
  /^responseHeaders$/iu,
  /^requestPayload$/iu,
  /^responsePayload$/iu,
  /^requestBody$/iu,
  /^responseBody$/iu,
  /^cookieJar$/iu,
  /^storageState$/iu,
  /^credentialRef$/iu,
  /^authStoreRef$/iu,
  /^revocationHandle$/iu,
  /^sid$/iu,
  /^profileRef$/iu,
  /(?:^|[_-])account[_-]?(?:id|identifier)(?:$|[_-])/iu,
  /(?:^|[_-])user[_-]?(?:id|identifier|account)(?:$|[_-])/iu,
  /(?:^|[_-])ip[_-]?(?:address)?(?:$|[_-])/iu,
  /(?:^|[_-])network[_-]?identifier(?:$|[_-])/iu,
  /(?:^|[_-])device[_-]?fingerprint(?:$|[_-])/iu,
  /(?:^|[_-])identity(?:$|[_-])/iu,
  /captcha[_-]?bypass/iu,
  /captcha[_-]?(?:solve|solver|unlock)/iu,
  /(?:solve|solver|unlock)[_-]?captcha/iu,
  /anti[_-]?bot[_-]?bypass/iu,
  /access[_-]?control[_-]?bypass/iu,
  /bypass[_-]?access[_-]?control/iu,
  /mfa[_-]?bypass|multi[_-]?factor[_-]?bypass|2fa[_-]?bypass/iu,
  /platform[_-]?risk[_-]?(?:bypass|evasion|evade)/iu,
  /risk[_-]?control[_-]?(?:bypass|evasion|evade)/iu,
  /permission[_-]?bypass|paywall[_-]?bypass|vip[_-]?bypass/iu,
  /credential[_-]?extraction/iu,
  /privilege[_-]?expansion/iu,
  /privilege[_-]?(?:escalation|escalate)/iu,
]);

const FORBIDDEN_RUNTIME_FIELD_PATTERNS = Object.freeze([
  /^downloadPolicy$/iu,
  /^standardTaskList$/iu,
  /^sessionView$/iu,
  /^siteAdapterDecision$/iu,
  /^siteAdapterRuntime$/iu,
  /^resolvedResources$/iu,
  /^downloaderPayload$/iu,
  /^downloaderTask$/iu,
  /^downloaderCommand$/iu,
  /^taskRunner$/iu,
  /^browserContext$/iu,
  /^runtimeHandler$/iu,
  /^handler$/iu,
  /^execute$/iu,
  /^executor$/iu,
  /^page$/iu,
]);

const SAFE_CONTROL_FLAG_FIELDS = Object.freeze([
  'sessionMaterializationAllowed',
]);

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
    fail(`${name} must be a plain object`, 'planner.schema.invalid');
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, 'planner.schema.invalid');
  }
}

function assertCompatibleSchemaVersion(value, name) {
  if (value === undefined || value === null || value === '') {
    fail(`${name} schemaVersion is required`, 'planner.version_incompatible');
  }
  if (!SITE_CAPABILITY_PLANNER_COMPATIBLE_SCHEMA_VERSIONS.includes(value)) {
    fail(`${name} schemaVersion is not compatible`, 'planner.version_incompatible');
  }
}

function isForbiddenPlannerFieldName(name) {
  const normalized = String(name ?? '').trim();
  if (SAFE_CONTROL_FLAG_FIELDS.includes(normalized)) {
    return false;
  }
  return Boolean(normalized) && (
    isSensitiveFieldName(normalized)
    || FORBIDDEN_PLANNER_FIELD_PATTERNS.some((pattern) => pattern.test(normalized))
    || FORBIDDEN_RUNTIME_FIELD_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

function scanForbiddenPlannerFields(value, findings, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanForbiddenPlannerFields(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenPlannerFieldName(key)) {
      findings.push({
        path: [...path, key].join('.'),
      });
      continue;
    }
    scanForbiddenPlannerFields(child, findings, [...path, key]);
  }
}

export function assertNoPlannerSensitiveMaterial(value) {
  const findings = [];
  scanForbiddenPlannerFields(value, findings);
  if (findings.length > 0) {
    fail('Planner data contains forbidden sensitive or runtime fields', 'planner.sensitive_material_forbidden');
  }
  try {
    assertNoForbiddenPatterns(value);
  } catch {
    fail('Planner data contains forbidden sensitive value patterns', 'planner.sensitive_material_forbidden');
  }
  return true;
}

export function assertPlannerConfigCompatible(config) {
  assertPlainObject(config, 'PlannerConfig');
  assertCompatibleSchemaVersion(config.schemaVersion, 'PlannerConfig');
  assertNoPlannerSensitiveMaterial(config);
  if (config.defaultMode !== undefined && !PLANNER_REQUEST_MODES.includes(config.defaultMode)) {
    fail('PlannerConfig defaultMode is unsupported', 'planner.request_invalid');
  }
  return true;
}

export function assertPlanRequestCompatible(request) {
  assertPlainObject(request, 'PlanRequest');
  assertCompatibleSchemaVersion(request.schemaVersion, 'PlanRequest');
  assertNoPlannerSensitiveMaterial(request);
  assertNonEmptyString(request.taskId, 'PlanRequest taskId');
  if (!request.site && !request.url) {
    fail('PlanRequest must include site or url', 'planner.site_unresolved');
  }
  if (!request.normalizedIntent && !request.intentInput) {
    fail('PlanRequest must include normalizedIntent or intentInput', 'planner.intent_unresolved');
  }
  if (request.mode !== undefined && !PLANNER_REQUEST_MODES.includes(request.mode)) {
    fail('PlanRequest mode is unsupported', 'planner.request_invalid');
  }
  return true;
}

export function assertPlanContextCompatible(context) {
  assertPlainObject(context, 'PlanContext');
  assertCompatibleSchemaVersion(context.schemaVersion, 'PlanContext');
  assertNoPlannerSensitiveMaterial(context);
  return true;
}

export function assertPlanArtifactCompatible(artifact) {
  assertPlainObject(artifact, 'PlanArtifact');
  assertCompatibleSchemaVersion(artifact.schemaVersion, 'PlanArtifact');
  assertNoPlannerSensitiveMaterial(artifact);
  assertNonEmptyString(artifact.type, 'PlanArtifact type');
  if (artifact.redactionRequired !== true) {
    fail('PlanArtifact redactionRequired must be true', 'planner.artifact_redaction_required');
  }
  return true;
}

export function assertPlanManifestCompatible(manifest) {
  assertPlainObject(manifest, 'PlanManifest');
  assertCompatibleSchemaVersion(manifest.schemaVersion, 'PlanManifest');
  assertNoPlannerSensitiveMaterial(manifest);
  if (manifest.redactionRequired !== true) {
    fail('PlanManifest redactionRequired must be true', 'planner.artifact_redaction_required');
  }
  if (!Array.isArray(manifest.artifacts)) {
    fail('PlanManifest artifacts are required', 'planner.schema_missing');
  }
  for (const artifact of manifest.artifacts) {
    assertPlanArtifactCompatible(artifact);
  }
  return true;
}

function assertSelectedRoute(route, name = 'selectedRoute') {
  assertPlainObject(route, name);
  assertNonEmptyString(route.routeId, `${name} routeId`);
  if (route.source !== PLANNER_SELECTED_ROUTE_SOURCE) {
    fail(`${name} source must be site-capability-graph`, 'planner.route_not_found');
  }
  return true;
}

function assertFallbacks(plan) {
  if (plan.fallbacks === undefined) {
    return true;
  }
  if (!Array.isArray(plan.fallbacks)) {
    fail('CapabilityPlan fallbacks must be an array', 'planner.fallback_not_found');
  }
  for (const fallback of plan.fallbacks) {
    assertSelectedRoute(fallback, 'fallbackRoute');
  }
  return true;
}

function assertExpectedArtifacts(plan) {
  if (!Array.isArray(plan.expectedArtifacts) || plan.expectedArtifacts.length === 0) {
    fail('CapabilityPlan expectedArtifacts are required', 'planner.artifact_redaction_required');
  }
  for (const artifact of plan.expectedArtifacts) {
    if (!isPlainObject(artifact)) {
      fail('CapabilityPlan expectedArtifacts must be objects', 'planner.artifact_redaction_required');
    }
    if (artifact.schemaVersion !== undefined) {
      assertPlanArtifactCompatible(artifact);
      continue;
    }
    if (artifact.redactionRequired !== true) {
      fail('CapabilityPlan expectedArtifacts redactionRequired must be true', 'planner.artifact_redaction_required');
    }
  }
  return true;
}

function assertNonReadOnlyApproval(plan) {
  const mode = plan.capabilityMode ?? plan.mode;
  if (mode === undefined || mode === 'readOnly') {
    return true;
  }
  const approval = plan.requirements?.approval;
  const approvalRequired = plan.requirements?.approvalRequired;
  if (approvalRequired === true || approval === 'required' || approval === 'required_for_non_readonly') {
    return true;
  }
  fail('Non-readOnly CapabilityPlan requires approval requirement', 'planner.approval_required');
}

export function assertCapabilityPlanCompatible(plan) {
  assertPlainObject(plan, 'CapabilityPlan');
  assertCompatibleSchemaVersion(plan.schemaVersion, 'CapabilityPlan');
  assertNoPlannerSensitiveMaterial(plan);
  assertNonEmptyString(plan.plannerVersion, 'CapabilityPlan plannerVersion');
  assertNonEmptyString(plan.graphVersion, 'CapabilityPlan graphVersion');
  if (plan.planStatus !== undefined && !PLANNER_PLAN_STATUSES.includes(plan.planStatus)) {
    fail('CapabilityPlan planStatus is unsupported', 'planner.request_invalid');
  }
  assertNonEmptyString(plan.siteId, 'CapabilityPlan siteId');
  assertNonEmptyString(plan.normalizedIntent, 'CapabilityPlan normalizedIntent');
  assertNonEmptyString(plan.capabilityId, 'CapabilityPlan capabilityId');
  assertSelectedRoute(plan.selectedRoute);
  assertFallbacks(plan);
  assertExpectedArtifacts(plan);
  if (plan.redactionRequired !== true) {
    fail('CapabilityPlan redactionRequired must be true', 'planner.artifact_redaction_required');
  }
  assertNonReadOnlyApproval(plan);
  return true;
}

export function assertPlannerCompatibilityDeclarationCompatible(declaration) {
  assertPlainObject(declaration, 'PlannerCompatibilityDeclaration');
  assertCompatibleSchemaVersion(declaration.schemaVersion, 'PlannerCompatibilityDeclaration');
  assertNoPlannerSensitiveMaterial(declaration);
  assertNonEmptyString(declaration.plannerVersion, 'PlannerCompatibilityDeclaration plannerVersion');
  assertNonEmptyString(declaration.graphVersion, 'PlannerCompatibilityDeclaration graphVersion');
  assertNonEmptyString(
    declaration.layerCompatibilityVersion,
    'PlannerCompatibilityDeclaration layerCompatibilityVersion',
  );
  if (
    !Array.isArray(declaration.compatiblePlannerSchemaVersions)
    || !declaration.compatiblePlannerSchemaVersions.includes(SITE_CAPABILITY_PLANNER_SCHEMA_VERSION)
  ) {
    fail(
      'PlannerCompatibilityDeclaration compatiblePlannerSchemaVersions must include current schema',
      'planner.version_incompatible',
    );
  }
  return true;
}
