#!/usr/bin/env node
// @ts-check

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildRuntimeDispatchReport,
} from '../src/app/pipeline/build/execution-governance.mjs';
import {
  createProductionRuntimeProviderRegistry,
  executeRuntimeInvocation,
} from '../src/app/runtime/index.mjs';
import {
  assertNoExecutionSensitiveMaterial,
} from '../src/domain/policies/execution/index.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function parseArgs(argv = []) {
  const options = {
    buildDir: '',
    tasks: /** @type {string[]} */ ([]),
    allRuntimeCallable: false,
    bindings: /** @type {string[]} */ ([]),
    execute: false,
    sessionAvailable: false,
    writePath: '',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--build') {
      options.buildDir = normalizeText(argv[++index]);
    } else if (arg === '--task') {
      options.tasks.push(normalizeText(argv[++index]));
    } else if (arg === '--all-runtime-callable') {
      options.allRuntimeCallable = true;
    } else if (arg === '--binding') {
      options.bindings.push(...normalizeText(argv[++index]).split(',').map(normalizeText).filter(Boolean));
    } else if (arg === '--execute') {
      options.execute = true;
    } else if (arg === '--session-available') {
      options.sessionAvailable = true;
    } else if (arg === '--write') {
      options.writePath = normalizeText(argv[++index]);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.help && !options.buildDir) {
    throw new Error('--build is required');
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/runtime-evidence-from-build.mjs --build <build-dir> --all-runtime-callable --execute --session-available --write runtime_multi_capability_report.json --json',
    '  node scripts/runtime-evidence-from-build.mjs --build <build-dir> --task <capability-id> --binding browser_bridge --execute --session-available',
    '',
    'Notes:',
    '  The runner reads only generated build artifacts and never reads cookies, browser profiles, raw DOM, raw network payloads, or session vault material.',
    '  Use --session-available only when an earlier governed build already proved user-authorized browser login state.',
  ].join('\n');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function runtimeProviderIdForDispatch(runtimeBinding = null) {
  const providerId = normalizeText(runtimeBinding?.providerId);
  if (
    (runtimeBinding?.kind === 'downloader' && providerId === 'known_site_downloader')
    || (runtimeBinding?.kind === 'browser_bridge' && providerId === 'browser_bridge')
    || providerId === 'browser_action_provider'
  ) {
    return providerId;
  }
  return null;
}

function runtimeContractDescriptorForDispatch(selectedContract, dispatchReport) {
  if (!selectedContract || !dispatchReport?.runtimeInvocationRequest) {
    return null;
  }
  return {
    id: dispatchReport.runtimeInvocationRequest.executionContractRef,
    executionContractRef: dispatchReport.runtimeInvocationRequest.executionContractRef,
    capabilityId: selectedContract.capabilityId,
    capabilityKind: selectedContract.capabilityKind ?? null,
    operationKind: selectedContract.operationKind ?? null,
    contractKind: selectedContract.contractKind ?? selectedContract.capabilityKind ?? selectedContract.operationKind ?? 'runtime_contract',
    destructiveAction: selectedContract.destructiveAction === true,
    highRiskAction: selectedContract.highRiskAction === true,
    paymentOrFundsAction: selectedContract.paymentOrFundsAction === true,
    runtimeBinding: selectedContract.runtimeBinding
      ? {
        kind: selectedContract.runtimeBinding.kind ?? null,
        providerId: runtimeProviderIdForDispatch(selectedContract.runtimeBinding),
        downloaderTaskDescriptor: null,
      }
      : null,
    requestSchemaRef: selectedContract.requestSchemaRef ?? null,
    responseSchemaRef: selectedContract.responseSchemaRef ?? null,
    payloadTemplate: selectedContract.payloadTemplate ?? null,
    authRequirement: selectedContract.authRequirement ?? null,
    runtimeBoundary: 'app/runtime',
    descriptorOnly: true,
    redactionRequired: true,
  };
}

function safeCapability(capability = null) {
  if (!capability) return null;
  const runtimeProviderId = runtimeProviderIdForDispatch({
    kind: capability.runtimeBindingKind ?? null,
    providerId: capability.runtimeProviderId ?? capability.providerId ?? null,
  });
  return {
    id: capability.id ?? null,
    name: capability.name ?? null,
    action: capability.action ?? null,
    object: capability.object ?? null,
    status: capability.status ?? null,
    enabled_status: capability.enabled_status ?? capability.enabledStatus ?? null,
    providerId: runtimeProviderId,
    runtimeProviderId,
    destructiveAction: capability.destructiveAction === true,
    paymentOrFundsAction: capability.paymentOrFundsAction === true,
  };
}

function capabilityName(capability = null) {
  return normalizeText(capability?.name);
}

function contractMatchesTask(contract, task, capability = null) {
  const text = normalizeText(task).toLowerCase();
  if (!text) return false;
  return [
    contract.id,
    contract.capabilityId,
    contract.executionPlanId,
    capabilityName(capability),
  ].map((value) => normalizeText(value).toLowerCase()).includes(text);
}

function selectContracts({
  contracts = [],
  capabilities = [],
  tasks = [],
  allRuntimeCallable = false,
  bindings = [],
}) {
  const capabilityById = new Map(capabilities.map((capability) => [capability?.id, capability]));
  let selected = [];
  if (tasks.length > 0) {
    selected = contracts.filter((contract) => {
      const capability = capabilityById.get(contract.capabilityId);
      return tasks.some((task) => contractMatchesTask(contract, task, capability));
    });
  } else if (allRuntimeCallable) {
    selected = contracts.filter((contract) => contract.runtimeCallable === true && contract.planCallable === true);
  } else {
    selected = contracts.slice(0, 1);
  }
  const bindingSet = new Set(bindings.map((binding) => binding.toLowerCase()));
  if (bindingSet.size > 0) {
    selected = selected.filter((contract) => bindingSet.has(normalizeText(contract.runtimeBinding?.kind).toLowerCase()));
  }
  return selected;
}

function summarizeExecution(report = null) {
  if (!report) return null;
  return {
    status: report.status ?? null,
    providerId: report.providerId ?? null,
    providerKind: report.providerKind ?? null,
    providerInvoked: report.providerInvoked === true,
    executionAttempted: report.executionAttempted === true,
    runtimeExecuted: report.runtimeExecuted === true,
    sideEffectAttempted: report.sideEffectAttempted === true,
    sideEffectSucceeded: report.sideEffectSucceeded === true,
    sideEffectFailed: report.sideEffectFailed === true,
    reasonCode: report.reasonCode ?? null,
    blockedReason: report.blockedReason ?? null,
    resultSummary: report.resultSummary
      ? {
        outcome: report.resultSummary.outcome ?? null,
        runtimeMode: report.resultSummary.runtimeMode ?? null,
        contractKind: report.resultSummary.contractKind ?? null,
        operationKind: report.resultSummary.operationKind ?? null,
        stepCount: report.resultSummary.stepCount ?? null,
        routeRefs: asArray(report.resultSummary.routeRefs),
        slotNames: asArray(report.resultSummary.slotNames),
        runtimeExecution: report.resultSummary.runtimeExecution ?? null,
        resultMaterial: report.resultSummary.resultMaterial ?? null,
        responseMaterial: report.resultSummary.responseMaterial ?? null,
        contentMaterial: report.resultSummary.contentMaterial ?? null,
        authMaterial: report.resultSummary.authMaterial ?? null,
        savedMaterial: report.resultSummary.savedMaterial ?? null,
        redactionRequired: report.resultSummary.redactionRequired === true,
      }
      : null,
  };
}

function outputPathFor(buildDir, writePath) {
  if (!writePath) return null;
  const resolved = path.isAbsolute(writePath) ? writePath : path.resolve(buildDir, writePath);
  if (path.extname(resolved).toLowerCase() === '.json') {
    return resolved;
  }
  return path.join(resolved, 'runtime_multi_capability_report.json');
}

export async function generateRuntimeEvidenceFromBuild(options = {}) {
  const buildDir = path.resolve(options.buildDir);
  const [
    site,
    capabilitiesDoc,
    intentsDoc,
    contractsDoc,
    governance,
  ] = await Promise.all([
    readJson(path.join(buildDir, 'site.json')),
    readJson(path.join(buildDir, 'capabilities.json')),
    readJson(path.join(buildDir, 'intents.json')),
    readJson(path.join(buildDir, 'execution_contracts.json')),
    readJson(path.join(buildDir, 'execution_governance.json')),
  ]);
  const capabilities = capabilitiesDoc.capabilities ?? [];
  const intents = intentsDoc.intents ?? [];
  const contracts = contractsDoc.executionContracts ?? [];
  const selectedContracts = selectContracts({
    contracts,
    capabilities,
    tasks: options.tasks ?? [],
    allRuntimeCallable: options.allRuntimeCallable === true,
    bindings: options.bindings ?? [],
  });
  const capabilityById = new Map(capabilities.map((capability) => [capability?.id, capability]));
  const registry = createProductionRuntimeProviderRegistry();
  const rows = [];
  for (const contract of selectedContracts) {
    const capability = capabilityById.get(contract.capabilityId) ?? null;
    const context = {
      buildId: contractsDoc.buildId ?? site.buildId ?? null,
      site,
      buildDir,
      artifactStore: { buildDir },
      session: {
        available: options.sessionAvailable === true,
        source: options.sessionAvailable === true ? 'user_authorized_browser_login_state' : null,
        material: 'not_persisted',
      },
      authStateReport: options.sessionAvailable === true
        ? {
          status: 'browser_verified',
          canUseAuthenticatedRuntime: true,
          material: 'not_persisted',
        }
        : {},
      runtimeConstraints: {
        sessionSatisfied: options.sessionAvailable === true,
        authSatisfied: options.sessionAvailable === true,
      },
      options: {
        execute: options.execute === true,
        executionTask: contract.capabilityId,
      },
    };
    const dispatch = buildRuntimeDispatchReport({
      context,
      contracts,
      intents,
      capabilities,
      governance,
    });
    let executionReport = null;
    if (options.execute === true && dispatch.runtimeInvocationRequest && dispatch.runtimePolicyDecision) {
      const descriptor = runtimeContractDescriptorForDispatch(contract, dispatch);
      executionReport = await executeRuntimeInvocation({
        invocationRequest: dispatch.runtimeInvocationRequest,
        policyDecision: dispatch.runtimePolicyDecision,
        gateStatus: dispatch.selectedGateStatus,
        executionContract: descriptor,
        capability: safeCapability(capability),
        providerRegistry: registry,
      });
    }
    rows.push({
      capabilityId: contract.capabilityId,
      executionContractRef: contract.id,
      name: capability?.name ?? null,
      operationKind: contract.operationKind ?? null,
      runtimeBinding: {
        kind: contract.runtimeBinding?.kind ?? null,
        providerId: runtimeProviderIdForDispatch(contract.runtimeBinding),
        sourceProviderId: contract.runtimeBinding?.providerId ?? null,
        descriptorOnly: true,
        credentialMaterialPolicy: contract.runtimeBinding?.credentialMaterialPolicy ?? 'no_raw_material',
        cookieMaterialPersisted: contract.runtimeBinding?.cookieMaterialPersisted === true,
        sessionViewPersisted: contract.runtimeBinding?.sessionViewPersisted === true,
      },
      gates: dispatch.selectedGates ?? [],
      gateStatus: dispatch.selectedGateStatus ?? null,
      dispatchStatus: dispatch.status ?? null,
      runtimeDispatchAllowed: dispatch.runtimeDispatchAllowed === true,
      runtimeExecutionReason: dispatch.runtimeExecutionReason ?? null,
      execution: summarizeExecution(executionReport),
    });
  }
  const completed = rows.filter((row) => row.execution?.status === 'completed');
  const executed = rows.filter((row) => row.execution?.runtimeExecuted === true);
  const blocked = rows.filter((row) => row.execution?.status && row.execution.status !== 'completed');
  const unsafeSideEffects = rows.filter((row) => (
    row.runtimeBinding.kind === 'browser_bridge'
    && (
      row.execution?.sideEffectAttempted === true
      || row.execution?.sideEffectSucceeded === true
      || row.execution?.sideEffectFailed === true
    )
  ));
  const report = {
    schemaVersion: 1,
    artifactFamily: 'siteforge-runtime-multi-capability-report',
    buildId: contractsDoc.buildId ?? site.buildId ?? null,
    siteId: site.id ?? null,
    generatedAt: new Date().toISOString(),
    scope: options.bindings?.length
      ? `${options.bindings.join(',')}_descriptor_only_capabilities`
      : 'runtime_callable_descriptor_only_capabilities',
    safetyBoundary: {
      contentPersisted: false,
      authMaterialPersisted: false,
      browserStatePersisted: false,
      providerMaterialUse: 'none',
      sessionSignal: options.sessionAvailable === true ? 'boolean_only' : 'not_provided',
      sideEffectsAllowed: false,
      note: 'Report uses generated contracts plus an optional login-state boolean only; it keeps only sanitized structure summaries.',
    },
    summary: {
      attemptedCapabilities: rows.length,
      dispatchAllowed: rows.filter((row) => row.runtimeDispatchAllowed).length,
      providerCompleted: completed.length,
      runtimeExecuted: executed.length,
      blockedOrFailed: blocked.length,
      unsafeBrowserBridgeSideEffectReports: unsafeSideEffects.length,
      successRate: rows.length ? Number((completed.length / rows.length * 100).toFixed(2)) : 0,
      runtimeExecutionRate: rows.length ? Number((executed.length / rows.length * 100).toFixed(2)) : 0,
      browserBridgeSafeSideEffectRate: rows.length
        ? Number(((rows.length - unsafeSideEffects.length) / rows.length * 100).toFixed(2))
        : 0,
    },
    rows,
  };
  assertNoExecutionSensitiveMaterial(report);
  const writePath = outputPathFor(buildDir, options.writePath ?? '');
  if (writePath) {
    await fs.mkdir(path.dirname(writePath), { recursive: true });
    await fs.writeFile(writePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return { report, writePath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { report, writePath } = await generateRuntimeEvidenceFromBuild({
    buildDir: options.buildDir,
    tasks: options.tasks,
    allRuntimeCallable: options.allRuntimeCallable,
    bindings: options.bindings,
    execute: options.execute,
    sessionAvailable: options.sessionAvailable,
    writePath: options.writePath,
  });
  const output = options.json
    ? report
    : {
      buildId: report.buildId,
      siteId: report.siteId,
      written: writePath,
      summary: report.summary,
    };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
