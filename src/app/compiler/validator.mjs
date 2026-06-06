// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from '../../domain/sessions/security-guard.mjs';
import {
  isSafeStructuredSensitiveDescriptorValue,
  isStructuredExecutionDescriptorPath,
  isStructuredExecutionRefFieldName,
  scanUnsafeDescriptorRuntimeValues,
  structuredExecutionRefFieldNames,
} from '../../shared/descriptor-safety.mjs';
import {
  SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS,
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
  SITE_COMPILE_CAPTURE_MODES,
  SITE_COMPILE_COVERAGE_COMPLETENESS,
  SITE_COMPILE_COVERAGE_MODES,
  SITE_COMPILE_SOURCE_TYPES,
  CAPABILITY_INTAKE_MODES,
  UNCONFIRMED_CAPABILITY_POLICIES,
} from './schema.mjs';

const FORBIDDEN_COMPILER_FIELD_PATTERNS = Object.freeze([
  /(?:^|[_-])raw[_-]?(?:credential|secret|token|cookie|header|session|profile)(?:$|[_-])/iu,
  /(?:^|[_-])raw[_-]?(?:body|request|response|payload)(?:$|[_-])/iu,
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
  /^sid$/iu,
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
  /^sessionView$/iu,
  /^siteAdapterRuntime$/iu,
  /^downloaderPayload$/iu,
  /^downloaderTask$/iu,
  /^downloaderCommand$/iu,
  /^taskRunner$/iu,
  /^standardTaskList$/iu,
  /^browserContext$/iu,
  /^siteAdapterDecision$/iu,
  /^siteAdapterInstance$/iu,
  /^adapterInstance$/iu,
  /^runtimeHandler$/iu,
  /^handler$/iu,
  /^execute$/iu,
  /^executor$/iu,
  /^page$/iu,
]);

const ALWAYS_FORBIDDEN_COMPILER_DESCRIPTOR_FIELD_PATTERNS = Object.freeze([
  /(?:^|[_-])raw[_-]?(?:credential|secret|token|cookie|header|session|profile|body|request|response|payload)(?:$|[_-])/iu,
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
  /^sid$/iu,
  /^profileRef$/iu,
  /^profilePath$/iu,
  /^browserProfilePath$/iu,
  /^userDataDir$/iu,
  /^localFilePath$/iu,
  /^privateFilePath$/iu,
  /^persistentSessionPath$/iu,
  /^sessionPath$/iu,
  /^dynamicImport$/iu,
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

const COMPILER_REF_FIELD_NAMES = Object.freeze(new Set([
  'ref',
  'sourceRef',
  'sourceRefs',
  'evidenceRef',
  'evidenceRefs',
  'testEvidenceRef',
  'testEvidenceRefs',
  'changedSourceRefs',
  'sourceInventories',
  ...structuredExecutionRefFieldNames(),
]));

const ALLOWED_CONFIG_REF_PATTERN = /^config\/(?:site-registry|site-capabilities)\.json(?:#[a-z0-9._:-]+)?$/iu;
const ALLOWED_COMPILER_REF_PATTERN =
  /^(?:artifact|adapter-metadata|api-discovery|auth-requirement|capabilities|capture|compile|compiler|coverage|dom-facts|downloader-task|dry-run-trace|execution|execution-contract|execution-path-dry-run|fixture|governance-policy|graph|inventory|layer|manifest|node|planner|policy|policy-decision|redacted-artifact|registry|requirement|risk-policy|route|runtime-binding|runtime-invocation|schema|session-requirement|site-capabilities|site-registry|synthetic-fixture|test):[a-z0-9._:/-]+$/iu;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function fail(message, code, details = undefined) {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  throw error;
}

function assertPlainObject(value, name) {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, 'compiler.schema_invalid');
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, 'compiler.schema_invalid');
  }
}

function assertCompilerDigest(value, name) {
  assertNonEmptyString(value, name);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail(`${name} must be a sha256 digest`, 'compiler.manifest_invalid');
  }
}

function isUnsafeRefSyntax(value) {
  const text = String(value ?? '').trim();
  return text === ''
    || text.length > 240
    || text !== value
    || /[\s"'`<>]/u.test(text)
    || /[?&=%]/u.test(text)
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

function assertCompilerEvidenceRefAllowed(value, name) {
  // @ts-ignore
  assertNonEmptyString(value, name, 'compiler.raw_sensitive_material_rejected');
  if (
    isUnsafeRefSyntax(value)
    || (!ALLOWED_CONFIG_REF_PATTERN.test(value) && !ALLOWED_COMPILER_REF_PATTERN.test(value))
  ) {
    fail(`${name} must be a sanitized compiler evidence ref`, 'compiler.raw_sensitive_material_rejected');
  }
  return true;
}

function assertCompatibleSchemaVersion(value, name) {
  if (value === undefined || value === null || value === '') {
    fail(`${name} schemaVersion is required`, 'compiler.version_incompatible');
  }
  if (!SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS.includes(value)) {
    fail(`${name} schemaVersion is not compatible`, 'compiler.version_incompatible');
  }
}

function assertStringArray(value, name, {
  // @ts-ignore
  allowedValues,
  allowEmpty = false,
} = {}) {
  if (!Array.isArray(value)) {
    fail(`${name} must be an array`, 'compiler.schema_invalid');
  }
  if (!allowEmpty && value.length === 0) {
    fail(`${name} must not be empty`, 'compiler.schema_invalid');
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      fail(`${name} entries must be non-empty strings`, 'compiler.schema_invalid');
    }
    if (allowedValues && !allowedValues.includes(item)) {
      fail(`${name} includes unsupported value`, 'compiler.schema_invalid');
    }
  }
}

function assertOptionalStringArray(value, name) {
  if (value === undefined) {
    return;
  }
  assertStringArray(value, name, { allowEmpty: true });
  for (const item of value) {
    if (/https?:\/\//iu.test(item)) {
      fail(`${name} entries must not contain URLs`, 'compiler.capability_intake_invalid');
    }
  }
}

function assertCapabilityIntake(intake) {
  if (intake === undefined || intake === null) {
    return;
  }
  assertPlainObject(intake, 'CapabilityIntake');
  assertCompatibleSchemaVersion(intake.schemaVersion, 'CapabilityIntake');
  assertNoCompilerSensitiveMaterial(intake);
  if (!CAPABILITY_INTAKE_MODES.includes(intake.intakeMode)) {
    fail('CapabilityIntake intakeMode is unsupported', 'compiler.capability_intake_invalid');
  }
  if (!UNCONFIRMED_CAPABILITY_POLICIES.includes(intake.unconfirmedCapabilityPolicy)) {
    fail('CapabilityIntake unconfirmedCapabilityPolicy is unsupported', 'compiler.capability_intake_invalid');
  }
  if (typeof intake.inquiryRequired !== 'boolean') {
    fail('CapabilityIntake inquiryRequired must be boolean', 'compiler.capability_intake_invalid');
  }
  assertOptionalStringArray(intake.requestedCapabilities, 'CapabilityIntake requestedCapabilities');
  assertOptionalStringArray(intake.candidateCapabilities, 'CapabilityIntake candidateCapabilities');
  assertOptionalStringArray(intake.unconfirmedCapabilities, 'CapabilityIntake unconfirmedCapabilities');
  assertNonEmptyString(intake.targetedCaptureStrategy, 'CapabilityIntake targetedCaptureStrategy');
  if (intake.redactionRequired !== true) {
    fail('CapabilityIntake redactionRequired must be true', 'compiler.redaction_required');
  }
}

function assertCapabilityCoverageSummary(summary) {
  if (summary === undefined || summary === null) {
    return;
  }
  assertPlainObject(summary, 'CapabilityCoverageSummary');
  assertCompatibleSchemaVersion(summary.schemaVersion, 'CapabilityCoverageSummary');
  assertNoCompilerSensitiveMaterial(summary);
  assertOptionalStringArray(summary.requestedCapabilities, 'CapabilityCoverageSummary requestedCapabilities');
  assertOptionalStringArray(summary.missingRequestedCapabilities, 'CapabilityCoverageSummary missingRequestedCapabilities');
  assertOptionalStringArray(summary.unconfirmedCapabilities, 'CapabilityCoverageSummary unconfirmedCapabilities');
  if (
    summary.missingRequestedCapabilityCount !== undefined
    && (!Number.isInteger(summary.missingRequestedCapabilityCount) || summary.missingRequestedCapabilityCount < 0)
  ) {
    fail('CapabilityCoverageSummary missingRequestedCapabilityCount must be a non-negative integer', 'compiler.coverage_incomplete');
  }
  if (
    Array.isArray(summary.missingRequestedCapabilities)
    && summary.missingRequestedCapabilityCount !== undefined
    && summary.missingRequestedCapabilityCount !== summary.missingRequestedCapabilities.length
  ) {
    fail('CapabilityCoverageSummary missingRequestedCapabilityCount must match missingRequestedCapabilities length', 'compiler.coverage_incomplete');
  }
  if (!Number.isInteger(summary.targetedCapabilityCount) || summary.targetedCapabilityCount < 0) {
    fail('CapabilityCoverageSummary targetedCapabilityCount must be a non-negative integer', 'compiler.coverage_incomplete');
  }
  if (!Number.isInteger(summary.bestEffortUnconfirmedCount) || summary.bestEffortUnconfirmedCount < 0) {
    fail('CapabilityCoverageSummary bestEffortUnconfirmedCount must be a non-negative integer', 'compiler.coverage_incomplete');
  }
  if (
    summary.capabilityGapStatus !== undefined
    && !['clear', 'missing_requested_capability'].includes(summary.capabilityGapStatus)
  ) {
    fail('CapabilityCoverageSummary capabilityGapStatus is unsupported', 'compiler.coverage_incomplete');
  }
  if (
    summary.missingRequestedCapabilityCount > 0
    && summary.capabilityGapStatus !== 'missing_requested_capability'
  ) {
    fail('CapabilityCoverageSummary missing requested capabilities require missing_requested_capability status', 'compiler.coverage_incomplete');
  }
  if (!UNCONFIRMED_CAPABILITY_POLICIES.includes(summary.unconfirmedCapabilityPolicy)) {
    fail('CapabilityCoverageSummary unconfirmedCapabilityPolicy is unsupported', 'compiler.capability_intake_invalid');
  }
  if (summary.redactionRequired !== true) {
    fail('CapabilityCoverageSummary redactionRequired must be true', 'compiler.redaction_required');
  }
}

function isStructuredDescriptorAllowedField(name, value, path = []) {
  if (ALWAYS_FORBIDDEN_COMPILER_DESCRIPTOR_FIELD_PATTERNS.some((pattern) => pattern.test(String(name ?? '')))) {
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

function isForbiddenCompilerFieldName(name, value, path = []) {
  const normalized = String(name ?? '').trim();
  if (!normalized) {
    return false;
  }
  const sensitive = isSensitiveFieldName(normalized);
  const forbiddenCompilerField = FORBIDDEN_COMPILER_FIELD_PATTERNS.some((pattern) => pattern.test(normalized));
  const forbiddenRuntimeField = FORBIDDEN_RUNTIME_FIELD_PATTERNS.some((pattern) => pattern.test(normalized));
  if ((sensitive || forbiddenCompilerField) && isStructuredDescriptorAllowedField(normalized, value, path)) {
    return false;
  }
  return sensitive || forbiddenCompilerField || forbiddenRuntimeField;
}

function scanForbiddenCompilerFields(value, findings, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanForbiddenCompilerFields(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenCompilerFieldName(key, child, path)) {
      findings.push({ path: [...path, key].join('.') });
      continue;
    }
    scanForbiddenCompilerFields(child, findings, [...path, key]);
  }
}

function scanCompilerEvidenceRefs(value, findings, path = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      scanCompilerEvidenceRefs(item, findings, [...path, String(index)]);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (COMPILER_REF_FIELD_NAMES.has(key) || isStructuredExecutionRefFieldName(key)) {
      if (child === undefined || child === null) {
        continue;
      }
      const values = Array.isArray(child) ? child : [child];
      for (const [index, refValue] of values.entries()) {
        if (isPlainObject(refValue)) {
          if ('ref' in refValue) {
            try {
              assertCompilerEvidenceRefAllowed(refValue.ref, `${childPath.join('.')}.${index}.ref`);
            } catch {
              findings.push({ path: `${childPath.join('.')}.${index}.ref` });
            }
          }
          scanCompilerEvidenceRefs(refValue, findings, [...childPath, String(index)]);
          continue;
        }
        try {
          assertCompilerEvidenceRefAllowed(refValue, `${childPath.join('.')}.${index}`);
        } catch {
          findings.push({ path: `${childPath.join('.')}.${index}` });
        }
      }
      continue;
    }
    scanCompilerEvidenceRefs(child, findings, childPath);
  }
}

export function assertNoCompilerSensitiveMaterial(value) {
  const findings = [];
  scanForbiddenCompilerFields(value, findings);
  if (findings.length > 0) {
    fail('Compiler data contains forbidden sensitive or runtime fields', 'compiler.raw_sensitive_material_rejected', { findings });
  }
  scanUnsafeDescriptorRuntimeValues(value, findings);
  if (findings.length > 0) {
    fail('Compiler data contains forbidden runtime values', 'compiler.raw_sensitive_material_rejected', { findings });
  }
  scanCompilerEvidenceRefs(value, findings);
  if (findings.length > 0) {
    fail('Compiler data contains unsafe evidence refs', 'compiler.raw_sensitive_material_rejected', { findings });
  }
  try {
    assertNoForbiddenPatterns(value);
  } catch {
    fail('Compiler data contains forbidden sensitive value patterns', 'compiler.raw_sensitive_material_rejected');
  }
  return true;
}

export function assertSiteCompileScopeCompatible(scope) {
  assertPlainObject(scope, 'SiteCompileScope');
  assertCompatibleSchemaVersion(scope.schemaVersion, 'SiteCompileScope');
  assertNoCompilerSensitiveMaterial(scope);
  if (!SITE_COMPILE_COVERAGE_MODES.includes(scope.coverageMode)) {
    fail('SiteCompileScope coverageMode is unsupported', 'compiler.scope_invalid');
  }
  if (!SITE_COMPILE_COVERAGE_COMPLETENESS.includes(scope.coverageCompleteness)) {
    fail('SiteCompileScope coverageCompleteness is unsupported', 'compiler.scope_invalid');
  }
  assertStringArray(scope.allowedCaptureModes, 'SiteCompileScope allowedCaptureModes', {
    // @ts-ignore
    allowedValues: SITE_COMPILE_CAPTURE_MODES,
  });
  if (scope.sourceTypes !== undefined) {
    assertStringArray(scope.sourceTypes, 'SiteCompileScope sourceTypes', {
      // @ts-ignore
      allowedValues: SITE_COMPILE_SOURCE_TYPES,
    });
  }
  if (scope.redactionRequired !== true) {
    fail('SiteCompileScope redactionRequired must be true', 'compiler.redaction_required');
  }
  return true;
}

export function assertSiteCompileRequestCompatible(request) {
  assertPlainObject(request, 'SiteCompileRequest');
  assertCompatibleSchemaVersion(request.schemaVersion, 'SiteCompileRequest');
  assertNoCompilerSensitiveMaterial(request);
  if (!request.siteId && !request.siteKey && !request.url) {
    fail('SiteCompileRequest must include siteId, siteKey, or url', 'compiler.request_invalid');
  }
  assertSiteCompileScopeCompatible(request.compileScope);
  assertCapabilityIntake(request.capabilityIntake);
  assertStringArray(request.sourceTypes, 'SiteCompileRequest sourceTypes', {
    // @ts-ignore
    allowedValues: SITE_COMPILE_SOURCE_TYPES,
  });
  if (request.redactionRequired !== true) {
    fail('SiteCompileRequest redactionRequired must be true', 'compiler.redaction_required');
  }
  return true;
}

function assertSourceRefs(sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    fail('SiteCompileManifest sourceRefs are required', 'compiler.manifest_invalid');
  }
  for (const sourceRef of sourceRefs) {
    assertPlainObject(sourceRef, 'SiteCompileSourceRef');
    assertNoCompilerSensitiveMaterial(sourceRef);
    if (!SITE_COMPILE_SOURCE_TYPES.includes(sourceRef.type)) {
      fail('SiteCompileSourceRef type is unsupported', 'compiler.source_unavailable');
    }
    assertNonEmptyString(sourceRef.ref, 'SiteCompileSourceRef ref');
    assertCompilerEvidenceRefAllowed(sourceRef.ref, 'SiteCompileSourceRef ref');
    assertCompilerDigest(sourceRef.digest, 'SiteCompileSourceRef digest');
    assertCompilerDigest(sourceRef.sourceDigest, 'SiteCompileSourceRef sourceDigest');
    if (sourceRef.digestAlgorithm !== 'sha256') {
      fail('SiteCompileSourceRef digestAlgorithm must be sha256', 'compiler.manifest_invalid');
    }
    if (sourceRef.redactionRequired !== true) {
      fail('SiteCompileSourceRef redactionRequired must be true', 'compiler.redaction_required');
    }
  }
}

function assertIncrementalCompileSummary(summary, manifestSourceDigest) {
  assertPlainObject(summary, 'IncrementalCompileSummary');
  assertNoCompilerSensitiveMaterial(summary);
  assertCompilerDigest(summary.sourceDigest, 'IncrementalCompileSummary sourceDigest');
  if (summary.sourceDigest !== manifestSourceDigest) {
    fail('IncrementalCompileSummary sourceDigest must match SiteCompileManifest sourceDigest', 'compiler.manifest_invalid');
  }
  if (summary.previousSourceDigest !== undefined && summary.previousSourceDigest !== null) {
    assertCompilerDigest(summary.previousSourceDigest, 'IncrementalCompileSummary previousSourceDigest');
  }
  if (typeof summary.unchanged !== 'boolean' || typeof summary.changed !== 'boolean') {
    fail('IncrementalCompileSummary changed flags must be boolean', 'compiler.manifest_invalid');
  }
  if (!Array.isArray(summary.changedSourceRefs)) {
    fail('IncrementalCompileSummary changedSourceRefs must be an array', 'compiler.manifest_invalid');
  }
  for (const changedRef of summary.changedSourceRefs) {
    assertCompilerEvidenceRefAllowed(changedRef, 'IncrementalCompileSummary changedSourceRefs');
  }
}

function assertInventories(inventories) {
  assertPlainObject(inventories, 'SiteCompileManifest inventories');
  const required = [
    'nodes',
    'capabilities',
    'executionPaths',
    'requirements',
  ];
  for (const key of required) {
    if (!Array.isArray(inventories[key])) {
      fail(`SiteCompileManifest inventories.${key} must be an array`, 'compiler.manifest_invalid');
    }
  }
}

function assertCoverageReport(coverageReport) {
  assertPlainObject(coverageReport, 'CompileCoverageReport');
  assertNoCompilerSensitiveMaterial(coverageReport);
  if (!SITE_COMPILE_COVERAGE_COMPLETENESS.includes(coverageReport.coverageCompleteness)) {
    fail('CompileCoverageReport coverageCompleteness is unsupported', 'compiler.coverage_incomplete');
  }
  if (!Number.isInteger(coverageReport.unknownNodeCount) || coverageReport.unknownNodeCount < 0) {
    fail('CompileCoverageReport unknownNodeCount must be a non-negative integer', 'compiler.coverage_incomplete');
  }
  if (!Array.isArray(coverageReport.blockedReasonCodes)) {
    fail('CompileCoverageReport blockedReasonCodes must be an array', 'compiler.coverage_incomplete');
  }
  if (coverageReport.evidenceRefs !== undefined) {
    assertStringArray(coverageReport.evidenceRefs, 'CompileCoverageReport evidenceRefs', { allowEmpty: true });
    for (const evidenceRef of coverageReport.evidenceRefs) {
      assertCompilerEvidenceRefAllowed(evidenceRef, 'CompileCoverageReport evidenceRefs');
    }
  }
  assertCapabilityCoverageSummary(coverageReport.capabilityCoverageSummary);
}

export function assertSiteCompileManifestCompatible(manifest) {
  assertPlainObject(manifest, 'SiteCompileManifest');
  assertCompatibleSchemaVersion(manifest.schemaVersion, 'SiteCompileManifest');
  assertNoCompilerSensitiveMaterial(manifest);
  assertNonEmptyString(manifest.compilerVersion, 'SiteCompileManifest compilerVersion');
  assertNonEmptyString(manifest.siteId, 'SiteCompileManifest siteId');
  assertCompilerDigest(manifest.sourceDigest, 'SiteCompileManifest sourceDigest');
  assertCompilerDigest(manifest.manifestDigest, 'SiteCompileManifest manifestDigest');
  assertIncrementalCompileSummary(manifest.incrementalCompile, manifest.sourceDigest);
  assertSiteCompileScopeCompatible(manifest.compileScope);
  assertCapabilityIntake(manifest.capabilityIntake);
  assertCapabilityCoverageSummary(manifest.capabilityCoverageSummary);
  assertSourceRefs(manifest.sourceRefs);
  assertInventories(manifest.inventories);
  assertCoverageReport(manifest.coverageReport);
  if (manifest.redactionRequired !== true) {
    fail('SiteCompileManifest redactionRequired must be true', 'compiler.redaction_required');
  }
  return true;
}

export function assertCompilerCompatibilityDeclarationCompatible(declaration) {
  assertPlainObject(declaration, 'CompilerCompatibilityDeclaration');
  assertCompatibleSchemaVersion(declaration.schemaVersion, 'CompilerCompatibilityDeclaration');
  assertNoCompilerSensitiveMaterial(declaration);
  assertNonEmptyString(declaration.compilerVersion, 'CompilerCompatibilityDeclaration compilerVersion');
  if (
    !Array.isArray(declaration.compatibleCompilerSchemaVersions)
    || !declaration.compatibleCompilerSchemaVersions.includes(SITE_CAPABILITY_COMPILER_SCHEMA_VERSION)
  ) {
    fail(
      'CompilerCompatibilityDeclaration compatibleCompilerSchemaVersions must include current schema',
      'compiler.version_incompatible',
    );
  }
  if (declaration.compilerVersion !== SITE_CAPABILITY_COMPILER_VERSION) {
    fail('CompilerCompatibilityDeclaration compilerVersion is not supported', 'compiler.version_incompatible');
  }
  return true;
}
