// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from '../security-guard.mjs';
import {
  SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS,
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
  SITE_COMPILE_CAPTURE_MODES,
  SITE_COMPILE_COVERAGE_COMPLETENESS,
  SITE_COMPILE_COVERAGE_MODES,
  SITE_COMPILE_SOURCE_TYPES,
} from './schema.mjs';

const FORBIDDEN_COMPILER_FIELD_PATTERNS = Object.freeze([
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
  /^sid$/iu,
  /^profileRef$/iu,
  /^profilePath$/iu,
  /^browserProfilePath$/iu,
  /^userDataDir$/iu,
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

function assertCompatibleSchemaVersion(value, name) {
  if (value === undefined || value === null || value === '') {
    fail(`${name} schemaVersion is required`, 'compiler.version_incompatible');
  }
  if (!SITE_CAPABILITY_COMPILER_COMPATIBLE_SCHEMA_VERSIONS.includes(value)) {
    fail(`${name} schemaVersion is not compatible`, 'compiler.version_incompatible');
  }
}

function assertStringArray(value, name, {
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

function isForbiddenCompilerFieldName(name) {
  const normalized = String(name ?? '').trim();
  return Boolean(normalized) && (
    isSensitiveFieldName(normalized)
    || FORBIDDEN_COMPILER_FIELD_PATTERNS.some((pattern) => pattern.test(normalized))
    || FORBIDDEN_RUNTIME_FIELD_PATTERNS.some((pattern) => pattern.test(normalized))
  );
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
    if (isForbiddenCompilerFieldName(key)) {
      findings.push({ path: [...path, key].join('.') });
      continue;
    }
    scanForbiddenCompilerFields(child, findings, [...path, key]);
  }
}

export function assertNoCompilerSensitiveMaterial(value) {
  const findings = [];
  scanForbiddenCompilerFields(value, findings);
  if (findings.length > 0) {
    fail('Compiler data contains forbidden sensitive or runtime fields', 'compiler.raw_sensitive_material_rejected');
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
    allowedValues: SITE_COMPILE_CAPTURE_MODES,
  });
  if (scope.sourceTypes !== undefined) {
    assertStringArray(scope.sourceTypes, 'SiteCompileScope sourceTypes', {
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
  assertStringArray(request.sourceTypes, 'SiteCompileRequest sourceTypes', {
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
