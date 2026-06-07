// @ts-check

import { ProviderSandboxError } from './provider-sandbox-errors.mjs';

export function validateProviderSandboxPolicy(policy = {}) {
  const findings = [];
  if (policy.allowNetwork === true) findings.push('provider_sandbox.network_requires_explicit_runtime_service');
  if (policy.allowControlledBrowserRuntime === true && policy.dryRun === true) findings.push('provider_sandbox.browser_unavailable_in_dry_run');
  if (Number(policy.timeoutMs) > 30000) findings.push('provider_sandbox.timeout_too_large');
  return {
    ok: findings.length === 0,
    findings,
  };
}

export function assertProviderSandboxPolicyValid(policy = {}) {
  const report = validateProviderSandboxPolicy(policy);
  if (!report.ok) {
    throw new ProviderSandboxError('Provider sandbox policy is invalid', {
      code: report.findings[0] ?? 'provider_sandbox.policy_invalid',
      details: report.findings,
    });
  }
  return true;
}
