// @ts-check

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

export function createCompileCoverageReport({
  coverageCompleteness = 'partial',
  unknownNodes = [],
  blockedReasonCodes = [],
  evidenceRefs = [],
  confidence = 0.6,
  capabilityCoverageSummary,
} = {}) {
  const report = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    coverageCompleteness,
    unknownNodeCount: Array.isArray(unknownNodes) ? unknownNodes.length : 0,
    blockedReasonCodes: [...blockedReasonCodes],
    evidenceRefs: [...evidenceRefs],
    confidence,
    ...(capabilityCoverageSummary ? { capabilityCoverageSummary } : {}),
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(report);
  return report;
}

export function createUnknownNodeReport({
  siteId,
  unknownNodes = [],
  blockedReasonCodes = [],
} = {}) {
  const report = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteId,
    unknownNodes: Array.isArray(unknownNodes) ? [...unknownNodes] : [],
    blockedReasonCodes: Array.isArray(blockedReasonCodes) ? [...blockedReasonCodes] : [],
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(report);
  return report;
}

export function assertCompileCoverageReportConsistent(scope = {}, report = {}) {
  if (!isPlainObject(scope) || !isPlainObject(report)) {
    const error = new Error('Compile coverage scope and report must be objects');
    error.code = 'compiler.coverage_incomplete';
    throw error;
  }
  if (
    scope.coverageCompleteness === 'complete_within_scope'
    && (!nonEmptyArray(report.evidenceRefs) || report.unknownNodeCount !== 0 || nonEmptyArray(report.blockedReasonCodes))
  ) {
    const error = new Error('complete_within_scope requires evidence, no unknown nodes, and no blockers');
    error.code = 'compiler.coverage_incomplete';
    throw error;
  }
  assertNoCompilerSensitiveMaterial({ scope, report });
  return true;
}
