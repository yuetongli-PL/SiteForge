// @ts-check

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  SECURITY_GUARD_SCHEMA_VERSION,
  prepareRedactedArtifactJsonWithAudit,
} from '../../domain/sessions/security-guard.mjs';
import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoPlannerSensitiveMaterial,
  assertPlanArtifactCompatible,
  assertPlanManifestCompatible,
} from './validator.mjs';

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

function assertPlainObject(value, name, code = 'planner.artifact_redaction_required') {
  if (!isPlainObject(value)) {
    fail(`${name} must be a plain object`, code);
  }
}

function assertWritableFilePath(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`, 'planner.artifact_redaction_required');
  }
}

const FORBIDDEN_WRITE_RESULT_FIELDS = Object.freeze([
  'json',
  'auditJson',
  'artifactJson',
  'artifactValue',
  'payload',
  'runtimePayload',
  'artifact',
  'manifest',
]);

function assertNoWriteResultPayloadFields(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoWriteResultPayloadFields(item, [...pathParts, String(index)]);
    }
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_WRITE_RESULT_FIELDS.includes(key)) {
      const pathName = [...pathParts, key].join('.');
      fail(`PlannerArtifactWriteResult must not expose artifact payload field ${pathName}`, 'planner.artifact_redaction_failed');
    }
    assertNoWriteResultPayloadFields(child, [...pathParts, key]);
  }
  return true;
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} must be a non-negative integer`, 'planner.artifact_redaction_failed');
  }
}

function assertBasename(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || path.basename(value) !== value) {
    fail(`${name} must be a basename only`, 'planner.artifact_redaction_failed');
  }
}

export function assertPlannerArtifactWriteResultCompatible(result) {
  assertPlainObject(result, 'PlannerArtifactWriteResult');
  if (result.schemaVersion !== SITE_CAPABILITY_PLANNER_SCHEMA_VERSION) {
    fail('PlannerArtifactWriteResult schemaVersion is not compatible', 'planner.version_incompatible');
  }
  if (
    result.redactionRequired !== true
    || result.descriptorOnly !== true
    || result.securityGuardApplied !== true
    || result.auditWritten !== true
    || result.writeOrder !== 'audit-before-artifact'
    || result.rawArtifactWriteAllowed !== false
    || result.runtimePayloadIncluded !== false
    || result.executionAllowed !== false
    || result.layerHandoffAllowed !== false
    || result.siteAdapterInvocationAllowed !== false
    || result.downloaderInvocationAllowed !== false
    || result.runtimeMaterializationAllowed !== false
    || result.artifactServiceInvocationAllowed !== false
    || result.graphMutationAllowed !== false
  ) {
    fail('PlannerArtifactWriteResult must be redacted descriptor-only artifact evidence', 'planner.artifact_redaction_failed');
  }
  if (!['PlanArtifact', 'PlanManifest'].includes(result.artifactKind)) {
    fail('PlannerArtifactWriteResult artifactKind is unsupported', 'planner.artifact_redaction_failed');
  }
  assertBasename(result.artifactFileName, 'PlannerArtifactWriteResult artifactFileName');
  assertBasename(result.auditFileName, 'PlannerArtifactWriteResult auditFileName');
  assertNonNegativeInteger(result.artifactBytes, 'PlannerArtifactWriteResult artifactBytes');
  assertNonNegativeInteger(result.auditBytes, 'PlannerArtifactWriteResult auditBytes');
  assertPlainObject(result.audit, 'PlannerArtifactWriteResult audit', 'planner.artifact_redaction_failed');
  if (
    result.audit.schemaVersion !== SECURITY_GUARD_SCHEMA_VERSION
    || result.audit.redactionRequired !== true
  ) {
    fail('PlannerArtifactWriteResult audit metadata is not compatible', 'planner.artifact_redaction_failed');
  }
  assertNoWriteResultPayloadFields(result);
  assertNoPlannerSensitiveMaterial(result);
  return true;
}

function preparePlannerValueForWrite(value, assertCompatible) {
  assertCompatible(value);
  try {
    const prepared = prepareRedactedArtifactJsonWithAudit(value);
    return {
      schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
      redactionRequired: true,
      descriptorOnly: true,
      securityGuardApplied: true,
      json: prepared.json,
      auditJson: prepared.auditJson,
      audit: {
        schemaVersion: prepared.auditValue.schemaVersion,
        redactionRequired: true,
        redactionCount: Array.isArray(prepared.auditValue.redactions)
          ? prepared.auditValue.redactions.length
          : 0,
        findingCount: Array.isArray(prepared.auditValue.findings)
          ? prepared.auditValue.findings.length
          : 0,
      },
    };
  } catch {
    fail('Planner artifact redaction failed before write', 'planner.artifact_redaction_failed');
  }
}

export function preparePlannerArtifactForWrite(artifact) {
  return preparePlannerValueForWrite(artifact, assertPlanArtifactCompatible);
}

export function preparePlannerManifestForWrite(manifest) {
  return preparePlannerValueForWrite(manifest, assertPlanManifestCompatible);
}

function createWriteResult({
  artifactKind,
  artifactType,
  artifactPath,
  auditPath,
  prepared,
}) {
  const result = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    artifactKind,
    artifactType,
    redactionRequired: true,
    descriptorOnly: true,
    securityGuardApplied: true,
    auditWritten: true,
    writeOrder: 'audit-before-artifact',
    rawArtifactWriteAllowed: false,
    runtimePayloadIncluded: false,
    executionAllowed: false,
    layerHandoffAllowed: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
    runtimeMaterializationAllowed: false,
    artifactServiceInvocationAllowed: false,
    graphMutationAllowed: false,
    artifactFileName: path.basename(artifactPath),
    auditFileName: path.basename(auditPath),
    artifactBytes: Buffer.byteLength(prepared.json, 'utf8'),
    auditBytes: Buffer.byteLength(prepared.auditJson, 'utf8'),
    audit: prepared.audit,
  };
  assertPlannerArtifactWriteResultCompatible(result);
  return result;
}

export async function writePlannerArtifact({
  artifact,
  artifactPath,
  auditPath,
} = {}) {
  assertWritableFilePath(artifactPath, 'artifactPath');
  assertWritableFilePath(auditPath, 'auditPath');
  const prepared = preparePlannerArtifactForWrite(artifact);
  await writeFile(auditPath, prepared.auditJson, 'utf8');
  await writeFile(artifactPath, prepared.json, 'utf8');
  return createWriteResult({
    artifactKind: 'PlanArtifact',
    artifactType: artifact.type,
    artifactPath,
    auditPath,
    prepared,
  });
}

export async function writePlannerManifest({
  manifest,
  manifestPath,
  auditPath,
} = {}) {
  assertWritableFilePath(manifestPath, 'manifestPath');
  assertWritableFilePath(auditPath, 'auditPath');
  const prepared = preparePlannerManifestForWrite(manifest);
  await writeFile(auditPath, prepared.auditJson, 'utf8');
  await writeFile(manifestPath, prepared.json, 'utf8');
  return createWriteResult({
    artifactKind: 'PlanManifest',
    artifactType: 'PLAN_MANIFEST',
    artifactPath: manifestPath,
    auditPath,
    prepared,
  });
}

export function createPlanManifestFromArtifacts(artifacts) {
  const manifest = {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    redactionRequired: true,
    artifacts,
  };
  assertPlanManifestCompatible(manifest);
  return manifest;
}
