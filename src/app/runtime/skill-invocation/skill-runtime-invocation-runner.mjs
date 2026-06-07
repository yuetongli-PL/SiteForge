// @ts-check

import {
  createRuntimeInvocationRequest,
} from '../../planner/runtime-invocation-request.mjs';
import {
  createGovernedExecutionPolicyDecision,
} from '../../../domain/policies/execution/index.mjs';
import {
  simulatePolicyPack,
} from '../../../domain/policies/policy-pack/index.mjs';
import {
  executeRuntimeInvocation,
} from '../execution-runner.mjs';
import {
  SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION,
} from './skill-runtime-invocation-schema.mjs';
import {
  assertNoSkillInvocationRawMaterial,
  safeSkillInvocationRef,
} from './skill-runtime-invocation-sanitizer.mjs';
import {
  assertSkillRuntimeInvocationRequestValid,
  createSkillRuntimeInvocationRequest,
} from './skill-runtime-invocation-validator.mjs';
import {
  createSkillRuntimeInvocationResult,
} from './skill-runtime-invocation-result.mjs';
import {
  resolveSkillInvocationPackageRefs,
} from './skill-runtime-invocation-package-resolver.mjs';

function safeIdPart(value, fallback = 'ref') {
  const text = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 96);
  return text || fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeContractRefFor(request) {
  return `execution-contract:${safeIdPart(request.executionContractRef, 'contract')}`;
}

function operationFromPackageCapability(capability = {}, contract = {}) {
  const kind = contract.kind ?? capability.kind;
  if (kind === 'download') return 'download';
  if (kind === 'form_or_action') return 'form_or_action';
  return 'read';
}

function providerIdFromPackageCapability(capability = {}, contract = {}) {
  const providers = [
    ...(Array.isArray(capability.providerCompatibility) ? capability.providerCompatibility : []),
    ...(Array.isArray(contract.providerCompatibility) ? contract.providerCompatibility : []),
  ];
  return providers[0] ?? '';
}

function runtimeAuthRequirementFromPackage(packageResolution = null) {
  const capability = packageResolution?.capability ?? {};
  const contract = packageResolution?.executionContract ?? {};
  if (capability.authRequirement?.required !== true) {
    return undefined;
  }
  const providerId = providerIdFromPackageCapability(capability, contract);
  const operation = operationFromPackageCapability(capability, contract);
  const browserAuth = providerId === 'browser_action_provider';
  return {
    required: true,
    mode: 'session_handle',
    scopes: [{
      origin: packageResolution?.siteOrigin ?? '',
      operations: [operation],
    }],
    material: {
      allowedTypes: browserAuth ? ['cookie'] : ['bearer_token'],
      injectionTarget: browserAuth ? 'browser_context' : 'http_request',
    },
    policy: {
      requireGovernanceGate: true,
      allowCredentialForwarding: false,
      allowRawHeaderAudit: false,
      allowRawCookieAudit: false,
      allowRawBodyAudit: false,
      allowStorageStatePersistence: false,
      allowProfilePersistence: false,
    },
  };
}

function runtimeAuthFromSkillRequest(request, runtimeAuthRequirement = undefined, policyDecision = null) {
  if (!runtimeAuthRequirement || request.auth === null) {
    return undefined;
  }
  return {
    sessionHandle: request.auth.sessionRef,
    requestedScopes: runtimeAuthRequirement.scopes,
    authGate: {
      satisfied: policyDecision?.runtimeDispatchAllowed === true,
      gateId: 'gate:skill-runtime-auth-ref',
      policyId: 'policy:skill-runtime-auth-ref',
    },
  };
}

function runtimeCapabilityIdFor(request, packageResolution = null) {
  return packageResolution?.capability?.sourceCapabilityId
    ?? `capability:${safeIdPart(request.capabilityRef, 'capability')}`;
}

function runtimeExecutionContractFromPackage(packageResolution = null, runtimeExecutionContractRef = '') {
  const contract = packageResolution?.executionContract ?? {};
  const capability = packageResolution?.capability ?? {};
  const runtimeAuthRequirement = runtimeAuthRequirementFromPackage(packageResolution);
  return {
    executionContractRef: runtimeExecutionContractRef,
    sourceExecutionContractId: contract.sourceExecutionContractId ?? runtimeExecutionContractRef,
    capabilityKind: contract.kind ?? capability.kind ?? 'api_read',
    contractKind: contract.kind ?? capability.kind ?? 'api_read',
    runtimeBindingRef: contract.runtimeBindingRef ?? `runtime-binding:${safeIdPart(runtimeExecutionContractRef, 'contract')}`,
    providerCompatibility: Array.isArray(contract.providerCompatibility)
      ? contract.providerCompatibility
      : Array.isArray(capability.providerCompatibility)
        ? capability.providerCompatibility
        : [],
    authRequirement: runtimeAuthRequirement,
    destructiveAction: capability.riskClassification?.destructive === true || capability.risk === 'destructive',
    paymentOrFundsAction: capability.riskClassification?.payment === true || capability.risk === 'payment',
    redactionRequired: true,
  };
}

function runtimeCapabilityFromPackage(request, packageResolution = null) {
  const capability = packageResolution?.capability ?? {};
  return {
    id: runtimeCapabilityIdFor(request, packageResolution),
    capabilityId: capability.capabilityId ?? safeIdPart(request.capabilityRef, 'capability'),
    kind: capability.kind ?? 'api_read',
    risk: capability.risk ?? 'public_read',
    providerCompatibility: Array.isArray(capability.providerCompatibility) ? capability.providerCompatibility : [],
    authRequirement: capability.authRequirement,
    destructiveAction: capability.riskClassification?.destructive === true || capability.risk === 'destructive',
    paymentOrFundsAction: capability.riskClassification?.payment === true || capability.risk === 'payment',
    redactionRequired: true,
  };
}

function policySimulationInput(request, packageResolution = null) {
  const capability = packageResolution?.capability ?? {};
  const contract = packageResolution?.executionContract ?? {};
  const providerId = capability.providerCompatibility?.[0] ?? contract.providerCompatibility?.[0] ?? '';
  return {
    packageId: packageResolution?.packageId ?? request.packageId,
    capabilityRef: request.capabilityRef,
    providerId,
    capabilityKind: capability.kind ?? contract.kind ?? 'api_read',
    operation: contract.kind ?? capability.kind ?? 'api_read',
    authRequirement: capability.authRequirement ?? { required: false, scopes: [] },
    requestedScopes: capability.authRequirement?.scopes ?? [],
    destructiveRequirement: {
      required: capability.riskClassification?.destructive === true || capability.risk === 'destructive',
    },
    paymentRequirement: {
      required: capability.riskClassification?.payment === true || capability.risk === 'payment',
    },
    naturalLanguageRequestGrantsExecution: false,
  };
}

/** @param {Record<string, any>} options */
function governedDecisionFromPolicySimulation({ request, packageResolution = null, policyPack = null } = {}) {
  if (!policyPack) return null;
  const input = policySimulationInput(request, packageResolution);
  const simulation = simulatePolicyPack(policyPack, input);
  const capability = packageResolution?.capability ?? {};
  const contract = packageResolution?.executionContract ?? {};
  const destructiveAction = input.destructiveRequirement.required === true;
  const paymentOrFundsAction = input.paymentRequirement.required === true;
  const sideEffecting = capability.riskClassification?.sideEffecting === true
    || ['form_or_action', 'ordinary_write'].includes(capability.kind ?? contract.kind);
  const gates = Array.isArray(capability.policyRequirements?.executionGates)
    ? capability.policyRequirements.executionGates
    : Array.isArray(contract.policyRequirements?.executionGates)
      ? contract.policyRequirements.executionGates
      : [];
  const verdict = simulation.decision.allowed === true
    ? sideEffecting ? 'controlled' : 'allow'
    : 'blocked';
  return createGovernedExecutionPolicyDecision({
    executionId: `execution:${safeIdPart(request.requestId, 'skill')}`,
    capabilityId: runtimeCapabilityIdFor(request, packageResolution),
    executionContractRef: runtimeContractRefFor(request),
    verdict,
    gates,
    runtimeDispatchAllowed: verdict === 'allow',
    siteAdapterInvocationAllowed: verdict !== 'blocked',
    downloaderInvocationAllowed: (capability.providerCompatibility ?? []).includes('download_provider'),
    destructiveAction,
    paymentOrFundsAction,
    auditRequired: true,
    reasonCode: simulation.decision.reason,
    naturalLanguageRequestGrantsExecution: false,
    policyPackDecisionRef: simulation.decision.decisionId,
  });
}

/** @param {Record<string, any>} options */
export function convertSkillInvocationToRuntimeInvocationRequest({
  request,
  packageResolution = null,
  policyDecision = null,
} = {}) {
  const safeRequest = assertSkillRuntimeInvocationRequestValid(request);
  const runtimeExecutionContractRef = runtimeContractRefFor(safeRequest);
  const runtimeAuthRequirement = runtimeAuthRequirementFromPackage(packageResolution);
  const runtimeInvocation = createRuntimeInvocationRequest({
    capabilityPlan: {
      siteId: packageResolution?.packageId ?? safeRequest.packageId ?? 'skill-runtime',
      capabilityId: runtimeCapabilityIdFor(safeRequest, packageResolution),
      executionContractRef: runtimeExecutionContractRef,
    },
    executionContractRef: runtimeExecutionContractRef,
    policyDecisionRef: safeRequest.policyDecisionRef,
    verdictHint: policyDecision?.verdict ?? 'controlled',
    requiredGates: policyDecision?.gates ?? packageResolution?.capability?.policyRequirements?.executionGates ?? [],
    requestId: `runtime-invocation:${safeIdPart(safeRequest.requestId, 'skill')}`,
    taskId: safeRequest.requestId,
    correlationId: safeRequest.idempotencyKey,
    authRequirement: runtimeAuthRequirement,
    auth: runtimeAuthFromSkillRequest(safeRequest, runtimeAuthRequirement, policyDecision),
    destructiveAuthorization: safeRequest.destructiveAuthorization ?? undefined,
  });
  assertNoSkillInvocationRawMaterial({
    skillRequest: safeRequest,
    runtimeInvocationRequestRef: runtimeInvocation.requestId,
  });
  return runtimeInvocation;
}

/** @param {Record<string, any>} options */
export function createSkillRuntimeDryRunPreview({
  request,
  packageResolution = null,
  policyDecision = null,
  policyPack = null,
} = {}) {
  const safeRequest = assertSkillRuntimeInvocationRequestValid(request);
  const effectivePolicyDecision = policyDecision
    ?? governedDecisionFromPolicySimulation({ request: safeRequest, packageResolution, policyPack });
  const runtimeInvocationRequest = convertSkillInvocationToRuntimeInvocationRequest({
    request: safeRequest,
    packageResolution,
    policyDecision: effectivePolicyDecision,
  });
  const preview = {
    schemaVersion: SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION,
    previewType: 'SkillRuntimeInvocationDryRunPreview',
    requestId: safeRequest.requestId,
    capabilityRef: safeRequest.capabilityRef,
    executionContractRef: safeRequest.executionContractRef,
    packageResolved: packageResolution?.ok === true,
    runtimeInvocationRequestRef: runtimeInvocationRequest.requestId,
    policyDecisionRef: safeRequest.policyDecisionRef,
    verdictPreview: effectivePolicyDecision?.verdict ?? 'controlled',
    requiredGates: effectivePolicyDecision?.gates ?? packageResolution?.capability?.policyRequirements?.executionGates ?? [],
    requiredSlotNames: Object.keys(safeRequest.slots),
    providerCompatibility: packageResolution?.capability?.providerCompatibility ?? [],
    paymentBlocked: packageResolution?.capability?.riskClassification?.payment === true || packageResolution?.capability?.risk === 'payment',
    destructiveBlockedByDefault: packageResolution?.capability?.riskClassification?.destructive === true || packageResolution?.capability?.risk === 'destructive',
    naturalLanguageRequestGrantsExecution: false,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(preview);
  return clone(preview);
}

/** @param {Record<string, any>} options */
export async function invokeSkillRuntime({
  request,
  packageManifest = null,
  packageResolution = null,
  policyPack = null,
  policyDecision = null,
  providerRegistry = null,
  runtimeContext = null,
  gateStatus = null,
  auditRecorder = null,
  idempotencyLedger = null,
} = {}) {
  const safeRequest = createSkillRuntimeInvocationRequest({
    ...request,
    policyMode: request?.policyMode ?? (policyPack && !request?.policyDecisionRef ? 'simulate' : undefined),
  });
  const existing = idempotencyLedger?.get?.(safeRequest.idempotencyKey);
  if (existing) {
    return {
      ...existing,
      status: 'duplicate',
      idempotencyStatus: 'duplicate',
      providerInvoked: false,
      browserInvoked: false,
      vaultAccessed: false,
      networkInvoked: false,
    };
  }
  const resolvedPackage = packageResolution
    ?? resolveSkillInvocationPackageRefs({ packageManifest, request: safeRequest });
  if (resolvedPackage.ok !== true) {
    const blocked = createSkillRuntimeInvocationResult({
      request: safeRequest,
      status: 'blocked',
      reasonCode: resolvedPackage.reasonCode,
    });
    idempotencyLedger?.record?.(safeRequest, blocked);
    return blocked;
  }
  const effectivePolicyDecision = policyDecision
    ?? governedDecisionFromPolicySimulation({ request: safeRequest, packageResolution: resolvedPackage, policyPack });

  if (safeRequest.mode === 'dryRun') {
    const preview = createSkillRuntimeDryRunPreview({
      request: safeRequest,
      packageResolution: resolvedPackage,
      policyDecision: effectivePolicyDecision,
      policyPack,
    });
    const result = createSkillRuntimeInvocationResult({
      request: safeRequest,
      status: 'preview',
      reasonCode: 'skill_invocation.dry_run_preview',
      dryRunPreview: preview,
      runtimeInvocationRequest: {
        requestId: preview.runtimeInvocationRequestRef,
      },
    });
    idempotencyLedger?.record?.(safeRequest, result);
    return result;
  }

  const runtimeInvocationRequest = convertSkillInvocationToRuntimeInvocationRequest({
    request: safeRequest,
    packageResolution: resolvedPackage,
    policyDecision: effectivePolicyDecision,
  });
  const runtimeExecutionContract = runtimeExecutionContractFromPackage(
    resolvedPackage,
    runtimeInvocationRequest.executionContractRef,
  );
  const runtimeCapability = runtimeCapabilityFromPackage(safeRequest, resolvedPackage);
  const runtimeReport = await executeRuntimeInvocation({
    invocationRequest: runtimeInvocationRequest,
    policyDecision: effectivePolicyDecision,
    gateStatus,
    executionContract: runtimeExecutionContract,
    capability: runtimeCapability,
    runtimeContext,
    providerRegistry,
    auditRecorder,
  });
  const result = createSkillRuntimeInvocationResult({
    request: safeRequest,
    status: runtimeReport.status === 'completed' ? 'completed' : runtimeReport.status === 'failed' ? 'failed' : 'blocked',
    reasonCode: runtimeReport.reasonCode ?? runtimeReport.blockedReason ?? null,
    runtimeInvocationRequest,
    runtimeReport: {
      ...runtimeReport,
      runId: runtimeReport.runId ?? `run:${safeSkillInvocationRef(safeRequest.requestId, 'skill')}`,
    },
  });
  idempotencyLedger?.record?.(safeRequest, result);
  return result;
}
