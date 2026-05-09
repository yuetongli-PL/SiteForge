// @ts-check

import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
} from './schema.mjs';
import {
  assertExecutionFeedbackCompatible,
  assertExecutionManifestCompatible,
  assertCoverageDeltaCompatible,
  assertLayerExecutionHandoffDescriptorCompatible,
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

export function createLayerExecutionHandoffDescriptor(options = {}) {
  assertNoExecutionSensitiveMaterial(options);
  const {
  executionId,
  capabilityPlanRef,
  graphVersion,
  plannerVersion,
  layerCompatibilityVersion,
  reasonCode,
} = options;
  const handoff = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    executionId,
    capabilityPlanRef,
    graphVersion,
    plannerVersion,
    layerCompatibilityVersion,
    handoffTarget: 'site-capability-layer',
    reasonCode,
    descriptorOnly: true,
    executionAttempted: false,
    layerDispatchAllowed: false,
    directDownloaderInvocationAllowed: false,
    directSiteAdapterInvocationAllowed: false,
    sessionViewAllowed: false,
    rawCredentialMaterialAllowed: false,
    redactionRequired: true,
  };
  assertLayerExecutionHandoffDescriptorCompatible(handoff);
  return handoff;
}

export function createExecutionFeedbackFromLayerReceipt(options = {}) {
  assertNoExecutionSensitiveMaterial(options);
  const {
  executionId,
  executionStatus,
  reasonCodes = [],
  artifactRefs = [],
  timingSummary = {},
} = options;
  const feedback = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionId,
    feedbackSource: 'site-capability-layer',
    executionStatus,
    reasonCodes,
    artifactRefs,
    timingSummary,
    redactionRequired: true,
  };
  assertExecutionFeedbackCompatible(feedback);
  return feedback;
}

export function createCoverageDeltaFromExecutionFeedback(options = {}) {
  assertNoExecutionSensitiveMaterial(options);
  const {
  executionFeedback,
  coverageBefore = 'partial',
  coverageAfter = 'partial',
  deltaType = 'observed',
  affectedNodeRefs = [],
  affectedCapabilityRefs = [],
  affectedRouteRefs = [],
  evidenceRefs = [],
  reasonCodes = [],
} = options;
  assertExecutionFeedbackCompatible(executionFeedback);
  const delta = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionId: executionFeedback.executionId,
    coverageBefore,
    coverageAfter,
    deltaType,
    affectedNodeRefs,
    affectedCapabilityRefs,
    affectedRouteRefs,
    evidenceRefs,
    reasonCodes,
    redactionRequired: true,
  };
  assertCoverageDeltaCompatible(delta);
  return delta;
}

export {
  assertExecutionManifestCompatible,
  assertExecutionFeedbackCompatible,
  assertCoverageDeltaCompatible,
  assertLayerExecutionHandoffDescriptorCompatible,
};
