// @ts-check

import {
  validateProviderRuntimeCompatibility,
} from './provider-compatibility.mjs';
import {
  sanitizeProviderManifest,
} from './provider-manifest.mjs';
import {
  sanitizeProviderResult,
} from './provider-result-sanitizer.mjs';
import {
  assertProviderRegistrationValid,
} from './provider-registration-validator.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function safeText(value) {
  const text = String(value ?? '').trim();
  return text && !/sf_provider_|authorization|cookie|token|secret|raw\s+body/iu.test(text)
    ? text.slice(0, 180)
    : undefined;
}

function safeStringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(safeText).filter(Boolean))].sort()
    : [];
}

function safeDescriptorObject(value = {}) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const key of [
    'capabilityId',
    'executionContractRef',
    'id',
    'operationKind',
    'capabilityKind',
    'contractKind',
    'providerId',
    'runtimeProviderId',
  ]) {
    const text = safeText(value[key]);
    if (text) output[key] = text;
  }
  for (const key of ['capabilityKinds', 'supportedOperations', 'artifactRefs']) {
    const list = safeStringArray(value[key]);
    if (list.length > 0) output[key] = list;
  }
  for (const key of ['destructiveAction', 'paymentOrFundsAction', 'dryRun']) {
    if (typeof value[key] === 'boolean') output[key] = value[key];
  }
  return output;
}

function runtimeServiceFlags(services = {}) {
  return {
    controlledBrowserRuntime: services.controlledBrowserRuntime === true,
    authAdapter: services.authAdapter === true,
    outputWriter: services.outputWriter === true,
    network: services.network === true,
  };
}

function safeServicesForManifest(manifest, services = {}) {
  const output = {};
  if (manifest.runtimeServices.requiresBrowserRuntime === true && services.controlledBrowserRuntime === true) {
    output.controlledBrowserRuntime = true;
  }
  if (manifest.riskProfile.requiresAuthAdapter === true && services.authAdapter === true) {
    output.authAdapter = true;
  }
  if (manifest.runtimeServices.requiresOutputWriter === true && services.outputWriter === true) {
    output.outputWriter = true;
  }
  if (manifest.runtimeServices.requiresNetwork === true && services.network === true) {
    output.network = true;
  }
  return Object.freeze(output);
}

/** @param {Record<string, any>} options */
export function createProviderAdapter({ manifest, implementation } = {}) {
  const safeManifest = sanitizeProviderManifest(manifest);
  const provider = {
    id: safeManifest.providerId,
    providerId: safeManifest.providerId,
    manifest: safeManifest,
    supports(descriptor = {}) {
      return implementation?.supports?.({
        invocationRequest: safeDescriptorObject(descriptor.invocationRequest),
        executionContract: safeDescriptorObject(descriptor.executionContract),
        capability: safeDescriptorObject(descriptor.capability),
      }) === true;
    },
    canExecute(descriptor = {}) {
      const compatibility = validateProviderRuntimeCompatibility(safeManifest, runtimeServiceFlags(descriptor.services ?? {}));
      if (!compatibility.ok) {
        return {
          allowed: false,
          reasonCode: compatibility.findings[0]?.reasonCode ?? 'provider.runtime_service_unavailable',
        };
      }
      const decision = implementation?.canExecute?.({
        invocationRequest: safeDescriptorObject(descriptor.invocationRequest),
        executionContract: safeDescriptorObject(descriptor.executionContract),
        capability: safeDescriptorObject(descriptor.capability),
        services: safeServicesForManifest(safeManifest, descriptor.services ?? {}),
      });
      return isPlainObject(decision) ? decision : { allowed: decision === true };
    },
    async run(options = {}) {
      const compatibility = validateProviderRuntimeCompatibility(safeManifest, runtimeServiceFlags(options.services ?? {}));
      if (!compatibility.ok) {
        return sanitizeProviderResult({
          providerId: safeManifest.providerId,
          status: 'failed',
          reasonCode: compatibility.findings[0]?.reasonCode ?? 'provider.runtime_service_unavailable',
          runtimeExecuted: false,
          sideEffectAttempted: false,
          resultSummary: {
            outcome: 'provider_blocked',
            providerId: safeManifest.providerId,
            reasonCode: compatibility.findings[0]?.reasonCode ?? 'provider.runtime_service_unavailable',
            artifactRefs: [],
            savedMaterial: 'sanitized_summary_only',
            redactionRequired: true,
          },
        }, safeManifest);
      }
      const rawResult = await implementation?.run?.({
        invocationRequest: safeDescriptorObject(options.invocationRequest),
        executionContract: safeDescriptorObject(options.executionContract),
        capability: safeDescriptorObject(options.capability),
        services: safeServicesForManifest(safeManifest, options.services ?? {}),
      });
      return sanitizeProviderResult(rawResult, safeManifest);
    },
  };
  assertProviderRegistrationValid(provider, { requireManifest: true });
  return provider;
}
