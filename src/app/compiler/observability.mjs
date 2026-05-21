// @ts-check

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
  SITE_CAPABILITY_COMPILER_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';

const REQUIRED_FIELDS = Object.freeze([
  'traceId',
  'correlationId',
  'site',
  'compileId',
  'compilerVersion',
  'validationResult',
  'redactionEvent',
]);

/** @param {Record<string, any>} options */
export function createCompilerLifecycleEvent({
  eventType = 'compiler.manifest.generated',
  traceId,
  correlationId,
  site,
  compileId,
  compilerVersion = SITE_CAPABILITY_COMPILER_VERSION,
  graphVersion,
  plannerVersion,
  layerCompatibilityVersion,
  adapterId,
  capabilityId,
  routeId,
  endpointId,
  coverageMode,
  coverageCompleteness,
  reasonCode,
  riskState,
  validationResult,
  artifactWriteEvent,
  redactionEvent = { redactionRequired: true, redactionApplied: true },
} = {}) {
  const event = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    eventType,
    traceId,
    correlationId,
    site,
    compileId,
    compilerVersion,
    graphVersion,
    plannerVersion,
    layerCompatibilityVersion,
    adapterId,
    capabilityId,
    routeId,
    endpointId,
    coverageMode,
    coverageCompleteness,
    reasonCode,
    riskState,
    validationResult,
    artifactWriteEvent,
    redactionEvent,
    redactionRequired: true,
  };
  assertCompilerLifecycleEventCompatible(event);
  return event;
}

export function assertCompilerLifecycleEventCompatible(event) {
  for (const field of REQUIRED_FIELDS) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      /** @type {Error & Record<string, any>} */
      const error = new Error(`CompilerLifecycleEvent ${field} is required`);
      error.code = 'compiler.schema_invalid';
      throw error;
    }
  }
  if (event.redactionRequired !== true || event.redactionEvent?.redactionRequired !== true) {
    /** @type {Error & Record<string, any>} */
    const error = new Error('CompilerLifecycleEvent redactionRequired must be true');
    error.code = 'compiler.redaction_required';
    throw error;
  }
  assertNoCompilerSensitiveMaterial(event);
  return true;
}
