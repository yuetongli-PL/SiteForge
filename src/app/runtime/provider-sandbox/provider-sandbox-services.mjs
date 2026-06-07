// @ts-check

import { assertNoProviderSandboxRawMaterial } from './provider-worker-protocol.mjs';

function sanitizeAuditEvent(event = {}) {
  assertNoProviderSandboxRawMaterial(event);
  const sanitized = {
    eventType: String(event.eventType ?? 'provider_sandbox.event').replace(/[^a-z0-9._:-]+/giu, '_').slice(0, 120),
    providerId: String(event.providerId ?? '').replace(/[^a-z0-9._:-]+/giu, '_').slice(0, 120),
    status: String(event.status ?? 'observed').replace(/[^a-z0-9._:-]+/giu, '_').slice(0, 120),
    redactionRequired: true,
  };
  assertNoProviderSandboxRawMaterial(sanitized);
  return sanitized;
}

export function createRestrictedProviderSandboxServices(policy = {}, sinks = {}) {
  const emittedAuditEvents = [];
  const serviceNames = ['emitAuditEvent'];
  const services = {
    emitAuditEvent(event = {}) {
      const sanitized = sanitizeAuditEvent(event);
      emittedAuditEvents.push(sanitized);
      sinks.audit?.(sanitized);
      return sanitized;
    },
  };
  if (policy.allowOutputWrite === true) {
    serviceNames.push('writeOutput');
    services.writeOutput = (artifact = {}) => {
      const sanitized = {
        artifactRef: String(artifact.artifactRef ?? 'artifact:provider-sandbox-output').replace(/[^a-z0-9._:/-]+/giu, '_').slice(0, 160),
        savedMaterial: 'sanitized_summary_only',
        redactionRequired: true,
      };
      assertNoProviderSandboxRawMaterial(sanitized);
      sinks.output?.(sanitized);
      return sanitized;
    };
  }
  if (policy.allowAuthAdapter === true) {
    serviceNames.push('authAdapter');
    services.authAdapter = Object.freeze({
      kind: 'auth_adapter_proxy',
      rawMaterialAvailable: false,
    });
  }
  if (policy.allowControlledBrowserRuntime === true) {
    serviceNames.push('controlledBrowserRuntime');
    services.controlledBrowserRuntime = Object.freeze({
      kind: 'controlled_browser_runtime_proxy',
      rawHandleAvailable: false,
    });
  }
  return Object.freeze({
    services: Object.freeze(services),
    serviceSummary: Object.freeze({
      serviceNames: serviceNames.sort(),
      rawRuntimeContextAvailable: false,
      rawVaultAvailable: false,
      rawBrowserHandleAvailable: false,
      rawEnvironmentAvailable: false,
    }),
    emittedAuditEvents,
  });
}
