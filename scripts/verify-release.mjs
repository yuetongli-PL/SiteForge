#!/usr/bin/env node
// @ts-check

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const OPTIONAL_LIVE_SMOKE_ENV = 'SITEFORGE_OPTIONAL_LIVE_SMOKE';

export const VERIFY_RELEASE_COMMANDS = Object.freeze([
  Object.freeze({
    label: 'runtime trust tests',
    command: 'npm',
    args: ['run', 'test:runtime-trust'],
    liveOptional: false,
  }),
  Object.freeze({
    label: 'runtime productization tests',
    command: 'npm',
    args: ['run', 'test:runtime-productization'],
    liveOptional: false,
  }),
  Object.freeze({
    label: 'runtime regression tests',
    command: 'npm',
    args: ['run', 'test:regression'],
    liveOptional: false,
  }),
  Object.freeze({
    label: 'secret scan',
    command: 'npm',
    args: ['run', 'scan:secrets'],
    liveOptional: false,
  }),
  Object.freeze({
    label: 'diff whitespace check',
    command: 'git',
    args: ['diff', '--check'],
    liveOptional: false,
  }),
]);

export const RELEASE_GATE_BLOCKERS = Object.freeze([
  'side_effect_introduced',
  'blocked_to_completed',
  'payment_provider_invoked',
  'destructive_provider_invoked',
  'protected_reason_changed',
  'auth_scope_widened',
  'allowed_origins_widened',
  'policy_denied_to_allowed',
  'runtime_index_testing_export',
  'raw_canary_leakage',
  'default_session_or_browser_injection',
]);

const RELEASE_CANARY_PATTERN =
  /sf_(?:release|runtime|package|skill|pilot|payment|destructive|regression|browser|global|prod_vault)[a-z0-9_]*secret[a-z0-9_]*/iu;
const FORBIDDEN_RUNTIME_INDEX_EXPORT_PATTERN = /mock|fake|test|testing|fixture|raw/iu;
const FORBIDDEN_RUNTIME_INDEX_MATERIAL_EXPORT_PATTERN =
  /^(?:create(?:InMemory)?SessionVaultProvider|createInMemoryProductionVaultAdapter|normalizeSessionMaterialGrant|getScopedSessionMaterial|releaseScopedSessionMaterial)$/u;

function spawnCommandFor(entry) {
  if (entry.command === 'npm' && process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...entry.args].join(' ')],
    };
  }
  return {
    command: entry.command,
    args: entry.args,
  };
}

export function shouldRunOptionalLiveSmoke(env = process.env) {
  return env?.[OPTIONAL_LIVE_SMOKE_ENV] === '1' || env?.[OPTIONAL_LIVE_SMOKE_ENV] === 'true';
}

export function assertNoReleaseGateCanaryLeakage(value, label = 'release gate payload') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (RELEASE_CANARY_PATTERN.test(serialized)) {
    const error = new Error(`${label} contains release gate canary material`);
    // @ts-ignore
    error.code = 'release_gate.raw_canary_leakage';
    throw error;
  }
  return true;
}

export function assertRuntimeIndexExportBoundary(runtimeExports = {}) {
  const forbidden = Object.keys(runtimeExports)
    .filter((name) => (
      FORBIDDEN_RUNTIME_INDEX_EXPORT_PATTERN.test(name)
      || FORBIDDEN_RUNTIME_INDEX_MATERIAL_EXPORT_PATTERN.test(name)
    ))
    .sort();
  if (forbidden.length > 0) {
    const error = new Error('runtime/index.mjs exposes testing or raw-material exports');
    // @ts-ignore
    error.code = 'release_gate.runtime_index_testing_export';
    // @ts-ignore
    error.details = { forbidden };
    throw error;
  }
  return true;
}

export function assertRegressionGatePasses(report = {}) {
  if (
    report.status === 'failed_closed'
    || Number(report.failedClosedCount ?? 0) > 0
    || Number(report.highRiskChangeCount ?? 0) > 0
    || ['high', 'critical'].includes(String(report.maxSeverity ?? ''))
  ) {
    const error = new Error('Release regression gate detected high-risk runtime drift');
    // @ts-ignore
    error.code = 'release_gate.high_risk_regression';
    // @ts-ignore
    error.details = {
      status: report.status,
      failedClosedCount: report.failedClosedCount,
      highRiskChangeCount: report.highRiskChangeCount,
      maxSeverity: report.maxSeverity,
    };
    throw error;
  }
  return true;
}

export async function assertProductionProtectedProvidersAbsent() {
  const {
    createProductionRuntimeProviderRegistry,
  } = await import('../src/app/runtime/index.mjs');
  const registry = createProductionRuntimeProviderRegistry();
  const paymentProvider = registry.resolve({
    invocationRequest: { capabilityId: 'capability:release-gate:payment' },
    capability: {
      kind: 'payment',
      paymentOrFundsAction: true,
    },
    executionContract: {
      paymentOrFundsAction: true,
    },
  });
  const destructiveProvider = registry.resolve({
    invocationRequest: { capabilityId: 'capability:release-gate:destructive' },
    capability: {
      kind: 'destructive',
      destructiveAction: true,
    },
    executionContract: {
      destructiveAction: true,
    },
  });
  if (paymentProvider || destructiveProvider) {
    const error = new Error('Production provider registry exposes protected executable provider');
    // @ts-ignore
    error.code = 'release_gate.protected_provider_registered';
    // @ts-ignore
    error.details = {
      paymentProviderId: paymentProvider?.id ?? null,
      destructiveProviderId: destructiveProvider?.id ?? null,
    };
    throw error;
  }
  return true;
}

export function verifyReleaseCommandLabels() {
  return VERIFY_RELEASE_COMMANDS.map((entry) => entry.label);
}

export function runReleaseGateCommand(entry, {
  cwd = process.cwd(),
  stdio = 'inherit',
  env = process.env,
} = {}) {
  if (entry.liveOptional === true && shouldRunOptionalLiveSmoke(env) !== true) {
    return {
      status: 0,
      skipped: true,
      label: entry.label,
    };
  }
  const command = spawnCommandFor(entry);
  const result = spawnSync(command.command, command.args, {
    cwd,
    stdio,
    shell: false,
    env,
  });
  return {
    status: result.status ?? 1,
    signal: result.signal,
    error: result.error,
    skipped: false,
    label: entry.label,
  };
}

export function runVerifyRelease({
  cwd = process.cwd(),
  stdio = 'inherit',
  env = process.env,
  commands = VERIFY_RELEASE_COMMANDS,
} = {}) {
  for (const entry of commands) {
    const result = runReleaseGateCommand(entry, {
      cwd,
      stdio,
      env,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        failed: result,
        exitCode: result.status,
      };
    }
  }
  return {
    ok: true,
    exitCode: 0,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const result = runVerifyRelease();
  process.exitCode = result.exitCode;
}
