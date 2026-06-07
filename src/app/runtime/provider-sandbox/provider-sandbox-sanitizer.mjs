// @ts-check

import {
  sanitizeProviderError,
  sanitizeProviderResult,
} from '../provider-sdk/index.mjs';
import {
  PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION,
  assertNoProviderSandboxRawMaterial,
} from './provider-worker-protocol.mjs';

export function sanitizeProviderSandboxResult(result = {}, manifest = {}) {
  const providerResult = sanitizeProviderResult(result, manifest, { label: 'ProviderSandboxResult' });
  const sandboxResult = {
    schemaVersion: PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION,
    providerId: providerResult.providerId ?? manifest.providerId ?? null,
    status: providerResult.status,
    reasonCode: providerResult.reasonCode ?? null,
    runtimeExecuted: providerResult.runtimeExecuted === true,
    sideEffectAttempted: providerResult.sideEffectAttempted === true,
    resultSummary: providerResult.resultSummary ?? {
      savedMaterial: 'sanitized_summary_only',
      redactionRequired: true,
    },
    warnings: [...new Set([
      ...(providerResult.warnings ?? []),
      'provider_sandbox.result_sanitized',
    ])].sort(),
    redactionRequired: true,
  };
  assertNoProviderSandboxRawMaterial(sandboxResult);
  return sandboxResult;
}

export function sanitizeProviderSandboxError(error = {}, manifest = {}) {
  const sanitized = sanitizeProviderError(error, { label: 'ProviderSandboxError' });
  const safeError = /sf_sandbox_[a-z0-9_]*secret(?:_[0-9]+)?|authorization:\s*bearer/iu.test(JSON.stringify(sanitized))
    ? {
      ...sanitized,
      message: 'Provider sandbox error contained sensitive material and was sanitized.',
    }
    : sanitized;
  const sandboxError = {
    schemaVersion: PROVIDER_SANDBOX_RESULT_SCHEMA_VERSION,
    providerId: manifest.providerId ?? null,
    status: 'failed',
    reasonCode: safeError.code ?? 'provider_sandbox.error',
    error: safeError,
    runtimeExecuted: false,
    sideEffectAttempted: false,
    warnings: ['provider_sandbox.error_sanitized'],
    redactionRequired: true,
  };
  assertNoProviderSandboxRawMaterial(sandboxError);
  return sandboxError;
}
