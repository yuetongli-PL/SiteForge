// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const BROWSER_BRIDGE_PROVIDER_ID = 'browser_bridge';
const READ_OPERATIONS = Object.freeze(new Set([
  'api_request',
  'browser_bridge',
  'navigate',
  'public_http',
  'query',
  'read',
  'search',
  'site_adapter',
]));
const BLOCKED_OPERATIONS = Object.freeze(new Set([
  'adapter_action',
  'destructive',
  'download',
  'export',
  'form_or_action',
  'payment',
  'submit',
  'write',
]));
const BLOCKED_TEXT_PATTERN =
  /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|download|export|write|submit|update|create|publish|draft|upload|send|reply|quote|repost|like|unlike)\b/iu;

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bindingKind(descriptor = {}) {
  return normalizeKind(
    descriptor.executionContract?.runtimeBinding?.kind
      ?? descriptor.runtimeContext?.runtimeBindingKind,
  );
}

function requestedProviderId(descriptor = {}) {
  return normalizeText(
    descriptor.executionContract?.runtimeBinding?.providerId
      ?? descriptor.runtimeContext?.providerId
      ?? descriptor.runtimeContext?.runtimeProviderId
      ?? descriptor.capability?.providerId
      ?? descriptor.capability?.runtimeProviderId,
  );
}

function descriptorOperationKind(descriptor = {}) {
  const inferred = inferRuntimeCapabilityKind(descriptor);
  for (const value of [
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.contractKind,
    descriptor.runtimeContext?.operationKind,
    inferred,
  ]) {
    const kind = normalizeKind(value);
    if (kind) return kind === 'api' ? 'api_request' : kind;
  }
  return '';
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
    descriptor.capability?.object,
  ].map((value) => String(value ?? '')).join(' ');
}

function blockedByPolicy(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  const operationKind = descriptorOperationKind(descriptor);
  return contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
    || BLOCKED_OPERATIONS.has(operationKind)
    || BLOCKED_TEXT_PATTERN.test(descriptorText(descriptor));
}

function supportsBrowserBridgeRead(descriptor = {}) {
  const providerId = requestedProviderId(descriptor);
  if (providerId && providerId !== BROWSER_BRIDGE_PROVIDER_ID) {
    return false;
  }
  if (bindingKind(descriptor) !== 'browser_bridge' && providerId !== BROWSER_BRIDGE_PROVIDER_ID) {
    return false;
  }
  if (blockedByPolicy(descriptor)) {
    return false;
  }
  const operationKind = descriptorOperationKind(descriptor);
  return READ_OPERATIONS.has(operationKind);
}

function safeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function routeTemplates(contract = {}) {
  return [...new Set(asArray(contract.payloadTemplate?.steps)
    .flatMap((step) => [
      step?.routeTemplate,
      step?.routePath,
      step?.routeRef,
      step?.nodeId,
    ])
    .map((value) => safeRef(value))
    .filter(Boolean))]
    .slice(0, 20);
}

function slotNames(contract = {}) {
  return [...new Set([
    ...asArray(contract.payloadTemplate?.slotBindings).map((slot) => slot?.name),
    ...asArray(contract.payloadTemplate?.steps).flatMap((step) => [
      step?.querySlot,
      step?.inputSlot,
      step?.payloadSlot,
      ...asArray(step?.slotNames),
    ]),
  ].map((value) => safeRef(value)).filter(Boolean))]
    .slice(0, 20);
}

function buildBrowserBridgeSummary(options = {}) {
  const contract = options.executionContract ?? {};
  const summary = {
    outcome: 'browser_bridge_summary_available',
    providerId: BROWSER_BRIDGE_PROVIDER_ID,
    runtimeMode: 'browser_bridge_required',
    capabilityId: options.invocationRequest?.capabilityId ?? contract.capabilityId ?? options.capability?.id ?? null,
    executionContractRef: options.invocationRequest?.executionContractRef ?? contract.executionContractRef ?? contract.id ?? null,
    operationKind: descriptorOperationKind(options),
    routeRefs: routeTemplates(contract),
    slotNames: slotNames(contract),
    stepCount: asArray(contract.payloadTemplate?.steps).length,
    bridgeEvidenceRequired: true,
    runtimeExecution: 'descriptor_only_structure_summary',
    resultMaterial: 'sanitized_structure_summary_only',
    contentMaterial: 'no_raw_page_content',
    authMaterial: 'not_requested_by_provider',
    artifactRefs: [],
    savedMaterial: 'sanitized_summary_only',
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(summary);
  return summary;
}

export function createBrowserBridgeReadProvider() {
  return {
    id: BROWSER_BRIDGE_PROVIDER_ID,
    providerKind: 'browser_bridge_read_provider',
    capabilityKinds: ['read', 'query', 'search', 'navigate'],
    supports(descriptor = {}) {
      return supportsBrowserBridgeRead(descriptor);
    },
    canExecute(options = {}) {
      if (!supportsBrowserBridgeRead(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.browser_bridge_provider_unsupported',
        };
      }
      return { allowed: true };
    },
    async run(options = {}) {
      return {
        providerId: BROWSER_BRIDGE_PROVIDER_ID,
        providerKind: 'browser_bridge_read_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        sideEffectSucceeded: false,
        sideEffectFailed: false,
        artifactRefs: [],
        resultSummary: buildBrowserBridgeSummary(options),
      };
    },
  };
}

export { BROWSER_BRIDGE_PROVIDER_ID };
