// @ts-check

import {
  createProviderSdkFinding,
  ProviderSdkValidationError,
} from './provider-sdk-errors.mjs';
import {
  sanitizeProviderError,
  sanitizeProviderResult,
} from './provider-result-sanitizer.mjs';
import {
  validateProviderRegistration,
} from './provider-registration-validator.mjs';

export const PROVIDER_CONFORMANCE_REPORT_SCHEMA_VERSION = 1;

function providerSnapshot(provider) {
  return JSON.stringify(provider, (key, value) => (typeof value === 'function' ? `[function:${key}]` : value));
}

function forbiddenRuntimeContext() {
  return new Proxy(Object.freeze({}), {
    get(_target, property) {
      const name = String(property);
      throw new ProviderSdkValidationError('Provider runtime service access is forbidden during supports()/canExecute().', {
        code: 'provider.runtime_service_access_forbidden',
        details: { service: name },
      });
    },
    has() {
      return false;
    },
    set(_target, property) {
      const name = String(property);
      throw new ProviderSdkValidationError('Provider runtime service mutation is forbidden during supports()/canExecute().', {
        code: 'provider.runtime_service_mutation_forbidden',
        details: { service: name },
      });
    },
  });
}

function safeDescriptor() {
  return {
    invocationRequest: {
      capabilityId: 'capability:provider-sdk:read',
    },
    executionContract: {
      capabilityId: 'capability:provider-sdk:read',
      operationKind: 'read',
    },
    runtimeContext: forbiddenRuntimeContext(),
  };
}

function runPureMethod(provider, methodName) {
  const before = providerSnapshot(provider);
  try {
    provider[methodName].call(provider, safeDescriptor());
  } catch (error) {
    return {
      ok: false,
      finding: createProviderSdkFinding(
        `provider.${methodName}_side_effect_forbidden`,
        `${methodName}() accessed forbidden runtime services or threw during pure conformance check.`,
        sanitizeProviderError(error),
      ),
    };
  }
  const after = providerSnapshot(provider);
  if (before !== after) {
    return {
      ok: false,
      finding: createProviderSdkFinding(
        `provider.${methodName}_mutation_forbidden`,
        `${methodName}() mutated provider state during pure conformance check.`,
      ),
    };
  }
  return { ok: true, finding: null };
}

export function runProviderConformance(provider = {}, options = {}) {
  const findings = [];
  const registration = validateProviderRegistration(provider, {
    production: options.production === true,
    requireManifest: true,
  });
  findings.push(...registration.findings);

  if (typeof provider.supports === 'function') {
    const supports = runPureMethod(provider, 'supports');
    if (!supports.ok) findings.push(supports.finding);
  }
  if (typeof provider.canExecute === 'function') {
    const canExecute = runPureMethod(provider, 'canExecute');
    if (!canExecute.ok) findings.push(canExecute.finding);
  }
  if (options.sampleResult !== undefined) {
    const sanitized = sanitizeProviderResult(options.sampleResult, registration.manifest, {
      label: 'ProviderConformanceSampleResult',
    });
    if (JSON.stringify(sanitized).includes('provider.raw_output_field_removed')) {
      findings.push(createProviderSdkFinding(
        'provider.result_raw_output_sanitized',
        'Provider result contained raw fields that were removed by the sanitizer.',
      ));
    }
  }

  const uniqueFindings = [...new Map(findings.map((finding) => [finding.reasonCode, finding])).values()];
  return {
    schemaVersion: PROVIDER_CONFORMANCE_REPORT_SCHEMA_VERSION,
    providerId: registration.providerId,
    ok: uniqueFindings.length === 0,
    findings: uniqueFindings,
  };
}

export function createProviderConformanceHarness(options = {}) {
  return {
    run(provider, runOptions = {}) {
      return runProviderConformance(provider, {
        ...options,
        ...runOptions,
      });
    },
  };
}

export function createSafeFixtureProvider(options = {}) {
  const providerId = options.providerId ?? 'safe_fixture_provider';
  return {
    id: providerId,
    providerId,
    manifest: {
      schemaVersion: 'provider.manifest.v1',
      providerId,
      capabilityKinds: ['read'],
      supportedOperations: ['read'],
      riskProfile: {
        sideEffects: 'none',
        requiresControlledRuntime: false,
        requiresAuthAdapter: false,
        allowedAuthMaterialTypes: [],
        allowedInjectionTargets: [],
      },
      runtimeServices: {
        requiresOutputWriter: false,
        requiresBrowserRuntime: false,
        requiresNetwork: false,
        requiresSessionMaterial: false,
      },
      resultPolicy: {
        allowRawHeaders: false,
        allowRawBody: false,
        allowRawCookies: false,
        allowRawTokens: false,
      },
    },
    supports() {
      return true;
    },
    canExecute() {
      return { allowed: true };
    },
    async run() {
      return {
        providerId,
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: false,
        resultSummary: {
          outcome: 'safe_fixture_completed',
          providerId,
          artifactRefs: [],
          savedMaterial: 'sanitized_summary_only',
          redactionRequired: true,
        },
      };
    },
  };
}
