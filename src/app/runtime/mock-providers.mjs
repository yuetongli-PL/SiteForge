// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';
import {
  createRuntimeProviderRegistryWith,
  inferRuntimeCapabilityKind,
} from './provider-registry.mjs';

/** @param {Record<string, any>} options */
function buildMockSummary({
  providerId,
  outcome,
  invocationRequest,
  executionContract,
  capabilityKind,
} = {}) {
  const summary = {
    outcome,
    providerId,
    capabilityId: invocationRequest?.capabilityId,
    executionContractRef: invocationRequest?.executionContractRef,
    contractKind: executionContract?.contractKind ?? executionContract?.capabilityKind ?? capabilityKind,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(summary);
  return summary;
}

/** @param {Record<string, any>} options */
function createMockProvider({ id, capabilityKinds, outcome }) {
  return {
    id,
    capabilityKinds,
    providerKind: 'mock',
    sideEffectProfile: 'none',
    /** @param {Record<string, any>} options */
    async run({
      invocationRequest,
      executionContract = null,
      capability = null,
      runtimeContext = null,
    } = {}) {
      const capabilityKind = inferRuntimeCapabilityKind({
        invocationRequest,
        executionContract,
        capability,
        runtimeContext,
      });
      return {
        providerId: id,
        providerKind: 'mock',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: true,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        resultSummary: buildMockSummary({
          providerId: id,
          outcome,
          invocationRequest,
          executionContract,
          capabilityKind,
        }),
      };
    },
  };
}

export function createMockRuntimeProviders() {
  return [
    createMockProvider({
      id: 'mock-runtime-read',
      capabilityKinds: ['read', 'query', 'search', 'generic'],
      outcome: 'mock_read_completed',
    }),
    createMockProvider({
      id: 'mock-runtime-write',
      capabilityKinds: ['write', 'submit'],
      outcome: 'mock_write_completed',
    }),
    createMockProvider({
      id: 'mock-runtime-download',
      capabilityKinds: ['download'],
      outcome: 'mock_download_completed',
    }),
  ];
}

export function createMockRuntimeProviderRegistry() {
  return createRuntimeProviderRegistryWith(createMockRuntimeProviders());
}
