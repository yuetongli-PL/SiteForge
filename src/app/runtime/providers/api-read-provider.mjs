// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  resolveAuthHttpRequestDescriptor,
} from '../auth-runtime.mjs';
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

function responseContentType(response = null) {
  try {
    return String(response?.headers?.get?.('content-type') ?? '').trim() || null;
  } catch {
    return null;
  }
}

function redirectSummary(response, requestUrl) {
  const status = Number(response?.status ?? 0);
  if (status < 300 || status > 399) {
    return null;
  }
  let locationOrigin = null;
  let crossOrigin = false;
  try {
    const location = String(response.headers?.get?.('location') ?? '').trim();
    if (location) {
      const nextUrl = new URL(location, requestUrl);
      locationOrigin = nextUrl.origin;
      crossOrigin = nextUrl.origin !== new URL(requestUrl).origin;
    }
  } catch {
    locationOrigin = null;
  }
  return {
    status,
    locationOrigin,
    crossOrigin,
  };
}

function bodySummaryFromText(text, contentType = null) {
  const bodyText = String(text ?? '');
  const summary = {
    kind: 'text',
    byteLength: Buffer.byteLength(bodyText),
  };
  if (contentType?.includes('json')) {
    try {
      const parsed = JSON.parse(bodyText);
      summary.kind = Array.isArray(parsed) ? 'json_array' : parsed && typeof parsed === 'object' ? 'json_object' : 'json_scalar';
      if (Array.isArray(parsed)) {
        summary.itemCount = parsed.length;
      }
    } catch {
      summary.kind = 'text';
    }
  }
  return summary;
}

function failedAuthApiRead(reasonCode, authSummary, {
  sideEffectAttempted = false,
  redirect = null,
} = {}) {
  const resultSummary = {
    outcome: 'api_read_failed',
    providerId: API_READ_PROVIDER_ID,
    reasonCode,
    responseMaterial: 'sanitized_summary_only',
    redirect,
    authSummary,
    artifactRefs: [],
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: API_READ_PROVIDER_ID,
    providerKind: 'api_read_provider',
    status: 'failed',
    reasonCode,
    runtimeExecuted: true,
    sideEffectAttempted,
    sideEffectSucceeded: false,
    sideEffectFailed: true,
    authSummary,
    resultSummary,
  };
}

async function runAuthApiRead(options = {}) {
  const descriptor = resolveAuthHttpRequestDescriptor({
    providerId: API_READ_PROVIDER_ID,
    executionContract: options.executionContract,
    runtimeContext: options.runtimeContext,
  });
  if (descriptor.ok !== true) {
    return failedAuthApiRead(descriptor.reasonCode, options.authAdapter?.isRequired?.() ? null : null);
  }
  const applied = await options.authAdapter.applyHttpAuth({
    url: descriptor.descriptor.url,
    method: descriptor.descriptor.method,
  });
  if (applied.ok !== true) {
    return failedAuthApiRead(applied.reasonCode, applied.authSummary, {
      sideEffectAttempted: false,
    });
  }
  const fetchImpl = options.runtimeContext?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return failedAuthApiRead('runtime.provider_failed', applied.authSummary, {
      sideEffectAttempted: false,
    });
  }
  let response;
  try {
    response = await fetchImpl(applied.request.url, {
      method: applied.request.method,
      headers: applied.request.headers,
      redirect: 'manual',
    });
  } catch {
    return failedAuthApiRead('runtime.provider_failed', applied.authSummary, {
      sideEffectAttempted: true,
    });
  }
  const redirect = redirectSummary(response, applied.request.url);
  if (redirect?.crossOrigin === true) {
    return failedAuthApiRead('runtime.auth_session_scope_not_allowed', {
      ...applied.authSummary,
      outcome: 'blocked',
      reason: 'runtime.auth_session_scope_not_allowed',
    }, {
      sideEffectAttempted: true,
      redirect,
    });
  }
  const contentType = responseContentType(response);
  const bodyText = applied.request.method === 'HEAD'
    ? ''
    : typeof response?.text === 'function'
      ? await response.text()
      : '';
  const resultSummary = {
    outcome: 'api_read_completed',
    providerId: API_READ_PROVIDER_ID,
    runtimeMode: 'auth_http_read_v1',
    responseMaterial: 'sanitized_summary_only',
    response: {
      status: Number(response?.status ?? 0) || null,
      ok: response?.ok === true,
      contentType,
      bodySummary: bodySummaryFromText(bodyText, contentType),
      redirect,
    },
    authSummary: applied.authSummary,
    artifactRefs: [],
    savedMaterial: 'sanitized_summary_only',
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(resultSummary);
  return {
    providerId: API_READ_PROVIDER_ID,
    providerKind: 'api_read_provider',
    status: 'completed',
    runtimeExecuted: true,
    sideEffectAttempted: true,
    sideEffectSucceeded: true,
    sideEffectFailed: false,
    authSummary: applied.authSummary,
    resultSummary,
  };
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
      if (options.authAdapter?.isRequired?.() === true) {
        return await runAuthApiRead(options);
      }
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
