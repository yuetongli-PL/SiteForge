// @ts-check

import {
  createSkillInvocationIdempotencyLedger,
  invokeSkillRuntime,
} from '../skill-invocation/index.mjs';
import {
  LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY,
} from './local-skill-runtime-service-schema.mjs';
import {
  createLocalSkillRuntimeServiceError,
  sanitizeLocalSkillRuntimeServiceRequest,
  sanitizeLocalSkillRuntimeServiceResponse,
} from './local-skill-runtime-service-sanitizer.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function contextValue(serviceRequest, serviceContext, key) {
  if (serviceRequest[key] !== undefined && serviceRequest[key] !== null) return serviceRequest[key];
  return serviceContext[key] ?? null;
}

/**
 * @param {{ serviceRequest?: Record<string, any>, serviceContext?: Record<string, any> }} [options]
 */
async function invokeSanitizedLocalSkillRuntime({
  serviceRequest = {},
  serviceContext = {},
} = {}) {
  const result = await invokeSkillRuntime({
    request: serviceRequest.skillRequest,
    packageManifest: contextValue(serviceRequest, serviceContext, 'packageManifest'),
    policyPack: contextValue(serviceRequest, serviceContext, 'policyPack'),
    policyDecision: contextValue(serviceRequest, serviceContext, 'policyDecision'),
    providerRegistry: serviceContext.providerRegistry ?? null,
    runtimeContext: serviceContext.runtimeContext ?? null,
    gateStatus: serviceContext.gateStatus ?? null,
    auditRecorder: serviceContext.auditRecorder ?? null,
    idempotencyLedger: serviceContext.idempotencyLedger ?? null,
  });
  return sanitizeLocalSkillRuntimeServiceResponse({
    operation: serviceRequest.operation,
    status: 'ok',
    result,
    runId: result.runId,
    auditViewRef: result.auditViewRef,
    providerInvoked: result.providerInvoked === true,
    browserInvoked: result.browserInvoked === true,
    vaultAccessed: result.vaultAccessed === true,
    networkInvoked: result.networkInvoked === true,
    sideEffectAttempted: result.sideEffectAttempted === true,
    taskTextGrantsAuthorization: false,
    naturalLanguageRequestGrantsExecution: false,
    networkBinding: LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY,
  });
}

/**
 * @param {{ serviceRequest?: Record<string, any>, serviceContext?: Record<string, any>, operation?: string | null }} [options]
 */
export async function invokeLocalSkillRuntime({
  serviceRequest,
  serviceContext = {},
  operation = null,
} = {}) {
  try {
    const sanitized = sanitizeLocalSkillRuntimeServiceRequest(serviceRequest, { operation });
    return invokeSanitizedLocalSkillRuntime({
      serviceRequest: sanitized,
      serviceContext,
    });
  } catch (error) {
    return createLocalSkillRuntimeServiceError(error);
  }
}

/**
 * @param {Record<string, any>} [options]
 */
export function createLocalSkillRuntimeService(options = {}) {
  const serviceContext = {
    packageManifest: options.packageManifest ?? null,
    policyPack: options.policyPack ?? null,
    policyDecision: options.policyDecision ?? null,
    providerRegistry: options.providerRegistry ?? null,
    runtimeContext: options.runtimeContext ?? null,
    gateStatus: options.gateStatus ?? null,
    auditRecorder: options.auditRecorder ?? null,
    idempotencyLedger: options.idempotencyLedger ?? createSkillInvocationIdempotencyLedger(),
  };
  return Object.freeze({
    serviceType: 'LocalSkillRuntimeService',
    serviceMode: 'local-sdk',
    networkBinding: clone(LOCAL_SKILL_RUNTIME_SERVICE_NETWORK_BOUNDARY),
    /**
     * @param {Record<string, any>} serviceRequest
     * @param {Record<string, any>} [invocationOptions]
     */
    async dryRun(serviceRequest, invocationOptions = {}) {
      return invokeLocalSkillRuntime({
        serviceRequest,
        operation: 'dryRun',
        serviceContext: {
          ...serviceContext,
          ...invocationOptions,
        },
      });
    },
    /**
     * @param {Record<string, any>} serviceRequest
     * @param {Record<string, any>} [invocationOptions]
     */
    async invoke(serviceRequest, invocationOptions = {}) {
      return invokeLocalSkillRuntime({
        serviceRequest,
        operation: 'execute',
        serviceContext: {
          ...serviceContext,
          ...invocationOptions,
        },
      });
    },
    /**
     * @param {Record<string, any>} serviceRequest
     * @param {Record<string, any>} [invocationOptions]
     */
    async handle(serviceRequest, invocationOptions = {}) {
      return invokeLocalSkillRuntime({
        serviceRequest,
        serviceContext: {
          ...serviceContext,
          ...invocationOptions,
        },
      });
    },
  });
}
