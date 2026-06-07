// @ts-check

import {
  createProviderSandboxEnvelope,
} from './provider-worker-protocol.mjs';
import {
  assertProviderSandboxPolicyValid,
} from './provider-sandbox-policy.mjs';
import {
  createRestrictedProviderSandboxServices,
} from './provider-sandbox-services.mjs';
import {
  sanitizeProviderSandboxError,
  sanitizeProviderSandboxResult,
} from './provider-sandbox-sanitizer.mjs';
import {
  withProviderSandboxTimeout,
} from './provider-sandbox-timeout.mjs';

/** @param {Record<string, any>} options */
export async function runProviderInRestrictedSandbox({
  provider,
  manifest = provider?.manifest ?? {},
  invocationRequest = {},
  executionContract = {},
  capability = {},
  policy = {},
  sinks = {},
} = {}) {
  const envelope = createProviderSandboxEnvelope({
    providerId: manifest.providerId ?? provider?.providerId,
    invocationRequest,
    executionContract,
    capability,
    policy,
  });
  assertProviderSandboxPolicyValid(envelope.policy);
  const restricted = createRestrictedProviderSandboxServices(envelope.policy, sinks);
  const runtimeServiceAvailability = {
    ...restricted.services,
    outputWriter: envelope.policy.allowOutputWrite === true,
    authAdapter: envelope.policy.allowAuthAdapter === true,
    controlledBrowserRuntime: envelope.policy.allowControlledBrowserRuntime === true,
    network: envelope.policy.allowNetwork === true,
  };
  try {
    const rawResult = await withProviderSandboxTimeout(
      () => provider.run({
        invocationRequest: envelope.invocationRequest,
        executionContract: envelope.executionContract,
        capability: envelope.capability,
        services: runtimeServiceAvailability,
        sandbox: {
          serviceSummary: restricted.serviceSummary,
          limitationStatement: envelope.limitationStatement,
        },
      }),
      envelope.policy.timeoutMs,
    );
    return {
      envelope,
      serviceSummary: restricted.serviceSummary,
      auditEvents: restricted.emittedAuditEvents,
      result: sanitizeProviderSandboxResult(rawResult, manifest),
      limitationStatement: envelope.limitationStatement,
      cleanup: {
        completed: true,
        providerTerminated: true,
      },
      redactionRequired: true,
    };
  } catch (error) {
    return {
      envelope,
      serviceSummary: restricted.serviceSummary,
      auditEvents: restricted.emittedAuditEvents,
      result: sanitizeProviderSandboxError(error, manifest),
      limitationStatement: envelope.limitationStatement,
      cleanup: {
        completed: true,
        providerTerminated: true,
      },
      redactionRequired: true,
    };
  }
}
