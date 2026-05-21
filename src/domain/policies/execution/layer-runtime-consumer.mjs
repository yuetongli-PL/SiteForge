// @ts-check

import path from 'node:path';

import { writeTextFile } from '../../../infra/io.mjs';
import {
  normalizeLifecycleEvent,
  assertLifecycleEventProducerObservability,
  writeLifecycleEventArtifact,
} from '../../lifecycle/lifecycle-events.mjs';
import {
  matchCapabilityHooksForLifecycleEvent,
} from '../../lifecycle/capability-hook.mjs';
import {
  prepareExecutionArtifactJsonWithAudit,
} from './artifact-guard.mjs';
import {
  assertExecutionPolicyDecisionCompatible,
} from './policy-gate.mjs';
import {
  createCoverageDeltaArtifactQueueEntry,
  prepareCoverageDeltaArtifactQueueWrite,
} from './coverage-delta-queue.mjs';
import {
  createCoverageDeltaFromExecutionFeedback,
  createExecutionFeedbackFromLayerReceipt,
} from './layer-handoff.mjs';
import {
  SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
  SITE_CAPABILITY_EXECUTION_VERSION,
} from './schema.mjs';
import {
  assertCoverageDeltaCompatible,
  assertExecutionFeedbackCompatible,
  assertLayerExecutionHandoffDescriptorCompatible,
  assertNoExecutionSensitiveMaterial,
} from './validator.mjs';

function fail(message, code = 'execution.layer_consumer_invalid') {
  /** @type {Error & Record<string, any>} */
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function auditSummaryFromJson(auditJson) {
  const audit = JSON.parse(auditJson);
  return {
    redactedPathCount: Array.isArray(audit.redactedPaths) ? audit.redactedPaths.length : 0,
    findingCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
  };
}

/**
 * @param {Record<string, any>} lifecycleEvent
 * @param {Record<string, any>} options
 */
function capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
  capabilityHookPhases,
} = {}) {
  const hooks = capabilityHookRegistry ?? capabilityHooks;
  if (!hooks) {
    return undefined;
  }
  return matchCapabilityHooksForLifecycleEvent(
    hooks,
    lifecycleEvent,
    { phases: capabilityHookPhases ?? ['after_task'] },
  );
}

/**
 * @param {Record<string, any>} lifecycleEvent
 * @param {Record<string, any>} options
 */
function lifecycleEventWithCapabilityHookMatches(lifecycleEvent, {
  capabilityHookRegistry,
  capabilityHooks,
  capabilityHookPhases,
} = {}) {
  const capabilityHookMatches = capabilityHookMatchSummaryForLifecycleEvent(lifecycleEvent, {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases,
  });
  if (!capabilityHookMatches) {
    return lifecycleEvent;
  }
  return normalizeLifecycleEvent({
    ...lifecycleEvent,
    details: {
      ...lifecycleEvent.details,
      capabilityHookMatches,
    },
  });
}

/** @param {Record<string, any>} options */
async function writeExecutionArtifactPair({
  outDir,
  fileName,
  value,
} = {}) {
  const prepared = prepareExecutionArtifactJsonWithAudit(value);
  const artifactFile = fileName;
  const auditFile = fileName.replace(/\.json$/u, '.audit.json');
  await writeTextFile(path.join(outDir, artifactFile), prepared.artifactJson);
  await writeTextFile(path.join(outDir, auditFile), prepared.auditJson);
  return {
    artifactFile,
    auditFile,
    redactionSummary: auditSummaryFromJson(prepared.auditJson),
  };
}

/** @param {Record<string, any>} [result] */
export function assertLayerOwnedRuntimeConsumerResultCompatible(result = {}) {
  if (result.schemaVersion !== SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION) {
    fail('LayerOwnedRuntimeConsumerResult schemaVersion is not compatible', 'execution.version_incompatible');
  }
  if (result.executionVersion !== SITE_CAPABILITY_EXECUTION_VERSION) {
    fail('LayerOwnedRuntimeConsumerResult executionVersion is not compatible', 'execution.version_incompatible');
  }
  if (result.resultType !== 'LayerOwnedRuntimeConsumerResult') {
    fail('LayerOwnedRuntimeConsumerResult resultType is required');
  }
  if (
    result.consumerOwner !== 'site-capability-layer'
    || result.layerReceiptConsumed !== true
    || result.runtimeExecuted !== false
    || result.runtimeTaskExecutedByConsumer !== false
    || result.directDownloaderInvocationAllowed !== false
    || result.directSiteAdapterInvocationAllowed !== false
    || result.sessionViewMaterializationAllowed !== false
    || result.rawCredentialMaterialAllowed !== false
    || result.redactionRequired !== true
  ) {
    fail('LayerOwnedRuntimeConsumerResult must remain Layer-owned and non-executing');
  }
  assertNoExecutionSensitiveMaterial(result);
  assertExecutionFeedbackCompatible(result.executionFeedback);
  assertCoverageDeltaCompatible(result.coverageDelta);
  assertLifecycleEventProducerObservability(result.lifecycleEvent);
  return true;
}

/** @param {Record<string, any>} options */
export function createLayerOwnedRuntimeConsumerResult({
  handoffDescriptor,
  policyDecision,
  layerReceipt = {},
  coverageBefore = 'partial',
  coverageAfter = 'partial',
  deltaType = 'observed',
  affectedNodeRefs = [],
  affectedCapabilityRefs = [],
  affectedRouteRefs = [],
  evidenceRefs,
  traceId,
  correlationId,
  siteKey,
  taskType = 'site-capability-execution',
  adapterVersion,
  capabilityHookRegistry,
  capabilityHooks,
  capabilityHookPhases,
} = {}) {
  assertLayerExecutionHandoffDescriptorCompatible(handoffDescriptor);
  assertExecutionPolicyDecisionCompatible(policyDecision);
  assertNoExecutionSensitiveMaterial(layerReceipt);
  if (policyDecision.layerGovernedDispatchReady !== true) {
    fail('Layer-owned runtime consumer requires ready Layer-governed dispatch', 'execution.approval_required');
  }
  if (policyDecision.executionId !== handoffDescriptor.executionId) {
    fail('Layer-owned runtime consumer executionId must match handoff descriptor');
  }
  const artifactRefs = Array.isArray(layerReceipt.artifactRefs)
    ? layerReceipt.artifactRefs
    : [];
  const safeEvidenceRefs = Array.isArray(evidenceRefs) ? evidenceRefs : artifactRefs;
  const executionFeedback = createExecutionFeedbackFromLayerReceipt({
    executionId: handoffDescriptor.executionId,
    executionStatus: normalizeText(layerReceipt.executionStatus) ?? 'accepted',
    reasonCodes: Array.isArray(layerReceipt.reasonCodes) ? layerReceipt.reasonCodes : [],
    artifactRefs,
    timingSummary: layerReceipt.timingSummary ?? {},
  });
  const coverageDelta = createCoverageDeltaFromExecutionFeedback({
    executionFeedback,
    coverageBefore,
    coverageAfter,
    deltaType,
    affectedNodeRefs,
    affectedCapabilityRefs,
    affectedRouteRefs,
    evidenceRefs: safeEvidenceRefs,
    reasonCodes: executionFeedback.reasonCodes,
  });
  const coverageDeltaQueueEntry = createCoverageDeltaArtifactQueueEntry({ coverageDelta });
  const coverageDeltaArtifactWrite = prepareCoverageDeltaArtifactQueueWrite({ coverageDelta });
  const lifecycleEvent = lifecycleEventWithCapabilityHookMatches(normalizeLifecycleEvent({
    eventType: 'execution.layer.consumer.receipt',
    traceId,
    correlationId,
    taskId: handoffDescriptor.executionId,
    siteKey,
    taskType,
    adapterVersion,
    reasonCode: executionFeedback.reasonCodes[0],
    details: {
      executionId: handoffDescriptor.executionId,
      executionStatus: executionFeedback.executionStatus,
      coverageDeltaType: coverageDelta.deltaType,
      coverageAfter: coverageDelta.coverageAfter,
      artifactRefCount: artifactRefs.length,
      directDownloaderInvocationAllowed: false,
      directSiteAdapterInvocationAllowed: false,
      sessionViewMaterializationAllowed: false,
    },
  }), {
    capabilityHookRegistry,
    capabilityHooks,
    capabilityHookPhases,
  });
  const result = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    resultType: 'LayerOwnedRuntimeConsumerResult',
    consumerOwner: 'site-capability-layer',
    executionId: handoffDescriptor.executionId,
    capabilityPlanRef: handoffDescriptor.capabilityPlanRef,
    graphVersion: handoffDescriptor.graphVersion,
    plannerVersion: handoffDescriptor.plannerVersion,
    layerCompatibilityVersion: handoffDescriptor.layerCompatibilityVersion,
    policyDecisionStatus: policyDecision.decisionStatus,
    layerReceiptConsumed: true,
    runtimeExecuted: false,
    runtimeTaskExecutedByConsumer: false,
    directDownloaderInvocationAllowed: false,
    directSiteAdapterInvocationAllowed: false,
    sessionViewMaterializationAllowed: false,
    rawCredentialMaterialAllowed: false,
    executionFeedback,
    coverageDelta,
    coverageDeltaQueueEntry,
    coverageDeltaArtifactWrite,
    lifecycleEvent,
    redactionRequired: true,
  };
  assertLayerOwnedRuntimeConsumerResultCompatible(result);
  return result;
}

/** @param {Record<string, any>} options */
export async function writeLayerOwnedRuntimeFeedbackArtifacts({
  outDir,
  result,
} = {}) {
  if (!outDir) {
    fail('Layer-owned runtime feedback artifact outDir is required', 'execution.artifact_write_invalid');
  }
  assertLayerOwnedRuntimeConsumerResultCompatible(result);
  const consumerResult = { ...result };
  delete consumerResult.runtimeFeedbackArtifactWrite;

  const consumer = await writeExecutionArtifactPair({
    outDir,
    fileName: 'layer-runtime-consumer-result.json',
    value: consumerResult,
  });
  const feedback = await writeExecutionArtifactPair({
    outDir,
    fileName: 'layer-runtime-execution-feedback.json',
    value: result.executionFeedback,
  });
  const coverageDelta = await writeExecutionArtifactPair({
    outDir,
    fileName: 'layer-runtime-coverage-delta.json',
    value: result.coverageDelta,
  });
  const coverageDeltaQueue = await writeExecutionArtifactPair({
    outDir,
    fileName: 'layer-runtime-coverage-delta-queue.json',
    value: result.coverageDeltaQueueEntry,
  });
  const lifecycleEventFile = 'layer-runtime-lifecycle-event.json';
  const lifecycleEventAuditFile = 'layer-runtime-lifecycle-event.audit.json';
  const lifecycleEventWrite = await writeLifecycleEventArtifact(result.lifecycleEvent, {
    eventPath: path.join(outDir, lifecycleEventFile),
    auditPath: path.join(outDir, lifecycleEventAuditFile),
  });
  const writeSummary = {
    schemaVersion: SITE_CAPABILITY_EXECUTION_SCHEMA_VERSION,
    executionVersion: SITE_CAPABILITY_EXECUTION_VERSION,
    artifactType: 'LAYER_RUNTIME_FEEDBACK_ARTIFACTS',
    executionId: result.executionId,
    consumerOwner: 'site-capability-layer',
    dryRun: true,
    runtimeExecuted: false,
    runtimeTaskExecutedByConsumer: false,
    directDownloaderInvocationAllowed: false,
    directSiteAdapterInvocationAllowed: false,
    sessionViewMaterializationAllowed: false,
    artifactFiles: [
      consumer.artifactFile,
      feedback.artifactFile,
      coverageDelta.artifactFile,
      coverageDeltaQueue.artifactFile,
      lifecycleEventFile,
    ],
    auditFiles: [
      consumer.auditFile,
      feedback.auditFile,
      coverageDelta.auditFile,
      coverageDeltaQueue.auditFile,
      lifecycleEventAuditFile,
    ],
    executionFeedbackArtifactFile: feedback.artifactFile,
    coverageDeltaArtifactFile: coverageDelta.artifactFile,
    coverageDeltaQueueArtifactFile: coverageDeltaQueue.artifactFile,
    lifecycleEventArtifactFile: lifecycleEventFile,
    redactionSummaries: {
      consumerResult: consumer.redactionSummary,
      executionFeedback: feedback.redactionSummary,
      coverageDelta: coverageDelta.redactionSummary,
      coverageDeltaQueue: coverageDeltaQueue.redactionSummary,
      lifecycleEvent: lifecycleEventWrite.redactionSummary,
    },
    redactionRequired: true,
    redactionApplied: true,
    writeAllowed: true,
  };
  assertNoExecutionSensitiveMaterial(writeSummary);
  return writeSummary;
}
