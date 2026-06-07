// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';
import {
  createRuntimeAuditRecorder,
  sanitizeRuntimeError,
} from './audit-recorder.mjs';
import {
  sanitizeDestructiveAuthorizationSummary,
} from './destructive-authorization.mjs';
import {
  createProviderAuthAdapter,
  evaluateRuntimeAuthGate,
  isAuthRequirementSupportedForProvider,
  isAuthSupportedProviderId,
  operationForProvider,
  resolveRuntimeAuthRequirement,
  sanitizeAuthAuditSummary,
  sanitizeRuntimeSessionPolicySummary,
} from './auth-runtime.mjs';
import {
  evaluateRuntimeInvocationDispatch,
} from './execution-dispatcher.mjs';
import {
  inferRuntimeCapabilityKind,
} from './provider-registry.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value ?? '')).origin;
  } catch {
    return '';
  }
}

function authBrowserAllowedOriginReason({
  provider = null,
  executionContract = null,
  runtimeContext = null,
} = {}) {
  if (
    provider?.id !== 'browser_action_provider'
    || executionContract?.authRequirement?.required !== true
    || runtimeContext?.controlledBrowserRuntime !== true
  ) {
    return null;
  }
  const descriptor = runtimeContext?.browserRuntime;
  if (!descriptor || typeof descriptor !== 'object') {
    return null;
  }
  const startOrigin = normalizedOrigin(descriptor.startUrl);
  const allowedOrigins = Array.isArray(descriptor.allowedOrigins)
    ? descriptor.allowedOrigins.map((origin) => normalizedOrigin(origin) || normalizeText(origin)).filter(Boolean)
    : [];
  if (startOrigin && allowedOrigins.length > 0 && !allowedOrigins.includes(startOrigin)) {
    return 'runtime.browser_navigation_not_allowed';
  }
  return null;
}

function inputRequiresAuth({
  invocationRequest = null,
  executionContract = null,
} = {}) {
  return executionContract?.authRequirement?.required === true
    || invocationRequest?.authRequirement?.required === true;
}

function safeAuthHttpDescriptorForInputScan(descriptor = null) {
  if (!isPlainObject(descriptor)) {
    return descriptor;
  }
  return {
    descriptorType: 'auth_http_request_descriptor',
    urlRef: 'runtime:slot:auth-http-url',
    method: ['GET', 'HEAD'].includes(normalizeText(descriptor.method, 'GET').toUpperCase())
      ? normalizeText(descriptor.method, 'GET').toUpperCase()
      : 'UNSUPPORTED',
    redactionRequired: true,
  };
}

function executionContractForInputScan({
  invocationRequest = null,
  executionContract = null,
} = {}) {
  if (!inputRequiresAuth({ invocationRequest, executionContract }) || !isPlainObject(executionContract)) {
    return executionContract;
  }
  const runtimeBinding = isPlainObject(executionContract.runtimeBinding)
    ? {
      ...executionContract.runtimeBinding,
      httpRequest: safeAuthHttpDescriptorForInputScan(executionContract.runtimeBinding.httpRequest),
      downloadDescriptor: safeAuthHttpDescriptorForInputScan(executionContract.runtimeBinding.downloadDescriptor),
    }
    : executionContract.runtimeBinding;
  return {
    ...executionContract,
    runtimeBinding,
    httpRequestDescriptor: safeAuthHttpDescriptorForInputScan(executionContract.httpRequestDescriptor),
    downloadDescriptor: safeAuthHttpDescriptorForInputScan(executionContract.downloadDescriptor),
  };
}

/** @param {Record<string, any>} options */
function baseExecutionReport({
  invocationRequest,
  policyDecision,
  dispatchReport,
  executionContract = null,
  capability = null,
} = {}) {
  return {
    schemaVersion: invocationRequest.schemaVersion,
    executionVersion: invocationRequest.executionVersion,
    reportType: 'RuntimeExecutionReport',
    runtimeBoundary: 'app/runtime',
    requestId: invocationRequest.requestId,
    executionId: policyDecision.executionId,
    capabilityId: invocationRequest.capabilityId,
    executionContractRef: invocationRequest.executionContractRef,
    policyDecisionRef: invocationRequest.policyDecisionRef,
    verdict: policyDecision.verdict,
    gates: dispatchReport.gates,
    gateStatus: dispatchReport.gateEvaluation?.gateStatus ?? {},
    gateEvaluation: dispatchReport.gateEvaluation,
    dispatchStatus: dispatchReport.status,
    runtimeDispatchAllowed: dispatchReport.runtimeDispatchAllowed,
    capabilityKind: inferRuntimeCapabilityKind({
      invocationRequest,
      executionContract,
      capability,
    }),
    providerId: null,
    providerKind: null,
    providerInvoked: false,
    executionAttempted: false,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    sideEffectSucceeded: false,
    sideEffectFailed: false,
    reasonCode: null,
    blockedReason: null,
    resultSummary: null,
    authSummary: null,
    policySummary: null,
    destructiveSummary: null,
    sanitizedError: null,
    artifactRefs: [],
    auditRef: null,
    redactionRequired: true,
  };
}

function finalizeReport(report) {
  assertNoExecutionSensitiveMaterial(report);
  return report;
}

function finalizeReportWithAudit(report, auditRecorder) {
  const recorder = auditRecorder ?? createRuntimeAuditRecorder();
  const auditEvent = recorder.record({
    ...report,
    eventType: 'runtime_execution_report',
  });
  return finalizeReport({
    ...report,
    auditRef: auditEvent.auditRef,
  });
}

/** @param {Record<string, any>} options */
function reportWithoutProvider({
  invocationRequest,
  policyDecision,
  dispatchReport,
  executionContract = null,
  capability = null,
  auditRecorder = null,
  provider = null,
  status,
  reasonCode,
  authSummary = null,
  policySummary = null,
  destructiveSummary = null,
} = {}) {
  const effectiveDestructiveSummary = destructiveSummary
    ? sanitizeDestructiveAuthorizationSummary({
      destructiveRequirement: destructiveSummary,
      destructiveAuthorization: destructiveSummary,
      reason: destructiveSummary.reason ?? reasonCode,
    })
    : reasonCode === 'runtime.destructive_execution_blocked'
      ? sanitizeDestructiveAuthorizationSummary({
        destructiveRequirement: executionContract?.destructiveRequirement ?? {
          required: true,
          actionClass: 'other',
          targetRef: executionContract?.targetRef ?? capability?.id ?? invocationRequest?.capabilityId,
        },
        destructiveAuthorization: invocationRequest?.destructiveAuthorization,
        reason: reasonCode,
      })
      : null;
  return finalizeReportWithAudit({
    ...baseExecutionReport({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
    }),
    providerId: provider?.id ?? null,
    providerKind: provider?.providerKind ?? null,
    status,
    reasonCode,
    blockedReason: reasonCode,
    authSummary: authSummary ? sanitizeAuthAuditSummary(authSummary) : null,
    policySummary: policySummary ? sanitizeRuntimeSessionPolicySummary(policySummary) : null,
    destructiveSummary: effectiveDestructiveSummary,
  }, auditRecorder);
}

function artifactRefsFromResult(result = {}) {
  const directRefs = Array.isArray(result.artifactRefs) ? result.artifactRefs : [];
  const summaryRefs = Array.isArray(result.resultSummary?.artifactRefs) ? result.resultSummary.artifactRefs : [];
  return [...new Set([...directRefs, ...summaryRefs])];
}

function descriptorSafetyBlockedReason({
  invocationRequest = null,
  executionContract = null,
  capability = null,
  runtimeContext = null,
  fallback = 'runtime.provider_unavailable',
} = {}) {
  const kind = inferRuntimeCapabilityKind({
    invocationRequest,
    executionContract,
    capability,
    runtimeContext,
  });
  if (
    executionContract?.paymentOrFundsAction === true
    || capability?.paymentOrFundsAction === true
    || kind === 'payment'
  ) {
    return 'runtime.payment_execution_blocked';
  }
  if (
    executionContract?.destructiveAction === true
    || capability?.destructiveAction === true
    || kind === 'destructive'
  ) {
    return 'runtime.destructive_execution_blocked';
  }
  return fallback;
}

function explicitProtectedExecutionReason({
  executionContract = null,
  capability = null,
} = {}) {
  if (
    executionContract?.paymentOrFundsAction === true
    || capability?.paymentOrFundsAction === true
  ) {
    return 'runtime.payment_execution_blocked';
  }
  if (
    executionContract?.destructiveAction === true
    || capability?.destructiveAction === true
  ) {
    return 'runtime.destructive_execution_blocked';
  }
  return null;
}

function normalizeProviderResult(provider, providerResult) {
  const result = isPlainObject(providerResult) ? providerResult : {};
  const status = normalizeText(result.status, 'completed');
  const reasonCode = normalizeText(result.reasonCode);
  const resultSummary = isPlainObject(result.resultSummary)
    ? result.resultSummary
    : {
      outcome: normalizeText(result.outcome, 'provider_completed'),
      artifactRefs: [],
      redactionRequired: true,
    };
  const normalized = {
    providerId: normalizeText(result.providerId, provider.id),
    providerKind: normalizeText(result.providerKind, provider.providerKind ?? 'runtime_provider'),
    status,
    reasonCode: reasonCode || null,
    runtimeExecuted: result.runtimeExecuted !== false,
    sideEffectAttempted: result.sideEffectAttempted === false ? false : true,
    sideEffectSucceeded: result.sideEffectSucceeded === true
      || (result.sideEffectFailed !== true && status === 'completed'),
    sideEffectFailed: result.sideEffectFailed === true,
    artifactRefs: artifactRefsFromResult(result),
    authSummary: result.authSummary
      ? sanitizeAuthAuditSummary(result.authSummary)
      : resultSummary.authSummary
        ? sanitizeAuthAuditSummary(resultSummary.authSummary)
        : null,
    policySummary: result.policySummary
      ? sanitizeRuntimeSessionPolicySummary(result.policySummary)
      : resultSummary.policySummary
        ? sanitizeRuntimeSessionPolicySummary(resultSummary.policySummary)
        : null,
    sanitizedError: isPlainObject(result.sanitizedError)
      ? result.sanitizedError
      : status === 'completed'
        ? null
        : sanitizeRuntimeError(null, {
          code: reasonCode || 'runtime.provider_failed',
          message: 'Runtime provider failed',
        }),
    resultSummary: {
      ...resultSummary,
      redactionRequired: true,
    },
  };
  assertNoExecutionSensitiveMaterial(normalized);
  return normalized;
}

function resolveRegistry(providerRegistry) {
  if (providerRegistry && typeof providerRegistry.resolve === 'function') {
    return providerRegistry;
  }
  return null;
}

async function providerCanExecute(provider, options) {
  if (typeof provider.canExecute !== 'function') {
    return { allowed: true };
  }
  const result = await provider.canExecute(options);
  if (result === true) return { allowed: true };
  if (result === false || result === null || result === undefined) {
    return { allowed: false, reasonCode: 'runtime.provider_cannot_execute' };
  }
  if (isPlainObject(result)) {
    assertNoExecutionSensitiveMaterial(result);
    return {
      allowed: result.allowed === true || result.canExecute === true,
      reasonCode: normalizeText(result.reasonCode, 'runtime.provider_cannot_execute'),
    };
  }
  return { allowed: false, reasonCode: 'runtime.provider_cannot_execute' };
}

/** @param {Record<string, any>} options */
export async function executeRuntimeInvocation({
  invocationRequest,
  policyDecision,
  gateStatus = null,
  executionContract = null,
  capability = null,
  runtimeContext = null,
  providerRegistry = null,
  auditRecorder = null,
} = {}) {
  assertNoExecutionSensitiveMaterial({
    invocationRequest,
    policyDecision,
    gateStatus,
    executionContract: executionContractForInputScan({
      invocationRequest,
      executionContract,
    }),
    capability,
  });

  const dispatchReport = evaluateRuntimeInvocationDispatch({
    invocationRequest,
    policyDecision,
    gateStatus,
  });

  if (dispatchReport.runtimeDispatchAllowed !== true) {
    const fallbackReason = dispatchReport.verdict === 'blocked'
      ? 'runtime.policy_blocked'
      : 'runtime.gates_not_satisfied';
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      status: dispatchReport.status,
      reasonCode: dispatchReport.verdict === 'blocked'
        ? descriptorSafetyBlockedReason({
          invocationRequest,
          executionContract,
          capability,
          runtimeContext,
          fallback: fallbackReason,
        })
        : fallbackReason,
    });
  }

  const registry = resolveRegistry(providerRegistry);
  if (!registry) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      status: 'blocked',
      reasonCode: 'runtime.provider_registry_unavailable',
    });
  }
  const provider = registry.resolve({
    invocationRequest,
    executionContract,
    capability,
    runtimeContext,
  });

  if (!provider) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      status: 'blocked',
      reasonCode: descriptorSafetyBlockedReason({
        invocationRequest,
        executionContract,
        capability,
        runtimeContext,
        fallback: 'runtime.provider_unavailable',
      }),
    });
  }

  const protectedExecutionReason = explicitProtectedExecutionReason({
    executionContract,
    capability,
  });
  if (protectedExecutionReason) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: protectedExecutionReason,
    });
  }

  // Pure contract/request narrowing only; vault inspection, material access,
  // network requests, and provider.run stay behind the later auth gate/adapter.
  const authRequirementPreflight = resolveRuntimeAuthRequirement({
    invocationRequest,
    executionContract,
  });
  if (authRequirementPreflight.required === true && !isAuthSupportedProviderId(provider.id)) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: 'runtime.auth_required',
      authSummary: {
        required: true,
        used: false,
        outcome: 'blocked',
        reason: 'runtime.auth_required',
      },
    });
  }
  if (
    authRequirementPreflight.required === true
    && !isAuthRequirementSupportedForProvider(provider.id, authRequirementPreflight.requirement, operationForProvider(provider.id, {
      invocationRequest,
      executionContract,
      capability,
      runtimeContext,
    }))
  ) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: 'runtime.auth_required',
      authSummary: {
        required: true,
        used: false,
        outcome: 'blocked',
        reason: 'runtime.auth_required',
      },
    });
  }
  if (authRequirementPreflight.required === true && authRequirementPreflight.allowed !== true) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: authRequirementPreflight.reasonCode,
      authSummary: {
        required: true,
        used: false,
        outcome: 'blocked',
        reason: authRequirementPreflight.reasonCode,
      },
    });
  }
  const authBrowserOriginReason = authBrowserAllowedOriginReason({
    provider,
    executionContract,
    runtimeContext,
  });
  if (authBrowserOriginReason) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: authBrowserOriginReason,
      authSummary: {
        required: true,
        used: false,
        outcome: 'blocked',
        reason: authBrowserOriginReason,
      },
    });
  }

  const providerOptions = {
    invocationRequest,
    policyDecision,
    dispatchReport,
    executionContract,
    capability,
    runtimeContext,
  };
  const canExecute = await providerCanExecute(provider, providerOptions);
  if (canExecute.allowed !== true) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'provider_not_executable',
      reasonCode: canExecute.reasonCode,
    });
  }

  const authGate = await evaluateRuntimeAuthGate({
    invocationRequest,
    executionContract,
    runtimeContext,
    provider,
  });
  if (authGate.allowed !== true) {
    return reportWithoutProvider({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
      auditRecorder,
      provider,
      status: 'blocked',
      reasonCode: authGate.reasonCode,
      authSummary: authGate.authSummary,
      policySummary: authGate.policySummary,
    });
  }

  const authAdapter = authGate.required === true
    ? createProviderAuthAdapter({
      sessionVault: authGate.sessionVault,
      sessionHandle: authGate.sessionHandle,
      providerId: provider.id,
      capabilityId: invocationRequest.capabilityId,
      requirement: authGate.requirement,
      requestedScopes: authGate.requestedScopes,
      sessionScopes: authGate.sessionScopes,
      sessionRef: authGate.sessionRef,
      sessionExpiresAt: authGate.sessionExpiresAt,
      policyConstraints: authGate.policySummary?.constraints ?? null,
      operation: operationForProvider(provider.id, {
        invocationRequest,
        executionContract,
        capability,
        runtimeContext,
      }),
    })
    : null;
  const providerRunOptions = authAdapter
    ? {
      ...providerOptions,
      authAdapter,
    }
    : providerOptions;

  let providerResult;
  try {
    providerResult = await provider.run(providerRunOptions);
  } catch (error) {
    return finalizeReportWithAudit({
      ...baseExecutionReport({
        invocationRequest,
        policyDecision,
        dispatchReport,
        executionContract,
        capability,
      }),
      providerId: provider.id,
      providerKind: provider.providerKind ?? 'runtime_provider',
      providerInvoked: true,
      status: 'failed',
      reasonCode: 'runtime.provider_failed',
      executionAttempted: true,
      runtimeExecuted: true,
      sideEffectAttempted: true,
      sideEffectFailed: true,
      authSummary: authGate.authSummary ?? null,
      policySummary: authGate.policySummary ?? null,
      sanitizedError: sanitizeRuntimeError(null),
    }, auditRecorder);
  } finally {
    if (authAdapter) {
      await authAdapter.releaseAll();
    }
  }

  let normalizedProviderResult;
  try {
    normalizedProviderResult = normalizeProviderResult(provider, providerResult);
  } catch {
    return finalizeReportWithAudit({
      ...baseExecutionReport({
        invocationRequest,
        policyDecision,
        dispatchReport,
        executionContract,
        capability,
      }),
      providerId: provider.id,
      providerKind: provider.providerKind ?? 'runtime_provider',
      providerInvoked: true,
      status: 'provider_output_rejected',
      reasonCode: 'runtime.provider_output_rejected',
      executionAttempted: true,
      runtimeExecuted: true,
      sideEffectAttempted: true,
      sideEffectFailed: true,
      authSummary: authGate.authSummary ?? null,
      policySummary: authGate.policySummary ?? null,
      sanitizedError: sanitizeRuntimeError(null, {
        code: 'runtime.provider_output_rejected',
        message: 'Runtime provider output was rejected by redaction guard',
      }),
    }, auditRecorder);
  }

  return finalizeReportWithAudit({
    ...baseExecutionReport({
      invocationRequest,
      policyDecision,
      dispatchReport,
      executionContract,
      capability,
    }),
    providerId: normalizedProviderResult.providerId,
    providerKind: normalizedProviderResult.providerKind,
    providerInvoked: true,
    status: normalizedProviderResult.status,
    reasonCode: normalizedProviderResult.reasonCode,
    executionAttempted: true,
    runtimeExecuted: normalizedProviderResult.runtimeExecuted,
    sideEffectAttempted: normalizedProviderResult.sideEffectAttempted,
    sideEffectSucceeded: normalizedProviderResult.sideEffectSucceeded,
    sideEffectFailed: normalizedProviderResult.sideEffectFailed,
    artifactRefs: normalizedProviderResult.artifactRefs,
    authSummary: normalizedProviderResult.authSummary ?? authGate.authSummary ?? null,
    policySummary: normalizedProviderResult.policySummary ?? authGate.policySummary ?? null,
    sanitizedError: normalizedProviderResult.sanitizedError,
    resultSummary: normalizedProviderResult.resultSummary,
  }, auditRecorder);
}
