// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const API_READ_PROVIDER_ID = 'api_read_provider';
const READ_KINDS = Object.freeze(new Set(['api', 'api_request', 'read', 'query', 'search', 'navigate', 'public_http']));
const BLOCKED_KINDS = Object.freeze(new Set(['download', 'export', 'write', 'submit', 'payment', 'destructive', 'form_or_action']));
const BLOCKED_TEXT_PATTERN = /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|post)\b/iu;

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function descriptorKind(descriptor = {}) {
  const kind = inferRuntimeCapabilityKind(descriptor);
  if (kind === 'generic') {
    for (const value of [
      descriptor.executionContract?.operationKind,
      descriptor.executionContract?.runtimeBinding?.kind,
      descriptor.runtimeContext?.operationKind,
    ]) {
      const direct = normalizeKind(value);
      if (direct) return direct;
    }
  }
  return kind;
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
  ].map((value) => String(value ?? '')).join(' ');
}

function isBlockedDescriptor(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  if (
    contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
  ) {
    return true;
  }
  const kind = descriptorKind(descriptor);
  if (BLOCKED_KINDS.has(kind)) {
    return true;
  }
  return BLOCKED_TEXT_PATTERN.test(descriptorText(descriptor));
}

function supportsApiRead(descriptor = {}) {
  if (isBlockedDescriptor(descriptor)) return false;
  return READ_KINDS.has(descriptorKind(descriptor));
}

/** @param {Record<string, any>} options */
function buildApiReadSummary(options = {}) {
  const {
    invocationRequest,
    executionContract,
    capability,
    runtimeContext,
  } = options;
  const summary = {
    outcome: 'api_read_completed',
    providerId: API_READ_PROVIDER_ID,
    capabilityId: invocationRequest?.capabilityId ?? executionContract?.capabilityId ?? capability?.id ?? null,
    executionContractRef: invocationRequest?.executionContractRef ?? executionContract?.executionContractRef ?? executionContract?.id ?? null,
    runtimeMode: 'descriptor_only_read',
    contractKind: descriptorKind({
      invocationRequest,
      executionContract,
      capability,
      runtimeContext,
    }),
    artifactRefs: [],
    savedMaterial: 'sanitized_summary_only',
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(summary);
  return summary;
}

export function createApiReadProvider() {
  return {
    id: API_READ_PROVIDER_ID,
    providerKind: 'api_read_provider',
    capabilityKinds: ['api', 'read', 'query', 'search'],
    supports(descriptor = {}) {
      return supportsApiRead(descriptor);
    },
    canExecute(options = {}) {
      if (!supportsApiRead(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.api_read_provider_unsupported',
        };
      }
      return { allowed: true };
    },
    /** @param {Record<string, any>} options */
    async run(options = {}) {
      const {
        invocationRequest,
        executionContract = null,
        capability = null,
        runtimeContext = null,
      } = options;
      return {
        providerId: API_READ_PROVIDER_ID,
        providerKind: 'api_read_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: true,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        resultSummary: buildApiReadSummary({
          invocationRequest,
          executionContract,
          capability,
          runtimeContext,
        }),
      };
    },
  };
}

export { API_READ_PROVIDER_ID };
