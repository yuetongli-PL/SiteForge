#!/usr/bin/env node
// @ts-check

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeAuditView,
  loadRuntimeRunStore,
  queryRunStoreIndex,
  renderRuntimeAuditViewJson,
  renderRuntimeAuditViewText,
  compareRuntimeRegressionSnapshots,
} from '../runtime/index.mjs';
import {
  diffCapabilityPackages,
  validateCapabilityPackageManifest,
} from '../../domain/capability-packages/index.mjs';
import {
  simulatePolicyPack,
} from '../../domain/policies/policy-pack/index.mjs';

const CLI_RAW_PATTERN =
  /sf_cli_(?:cookie|token|raw_body)_secret_[0-9]+|Bearer\s+|Authorization\s*[:=]|Cookie\s*[:=]|Set-Cookie|rawBody|requestBody|responseBody|"storageState"\s*:|"localStorage"\s*:|"sessionStorage"\s*:|"IndexedDB"\s*:/iu;
const SAFE_FILTER_KEYS = new Set(['status', 'providerId', 'policyId', 'reason']);
const MAX_INPUT_BYTES = 512000;

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

function cliError(code, message = 'Runtime operations CLI request rejected') {
  const error = new Error(message);
  // @ts-ignore
  error.code = code;
  return error;
}

function assertNoCliRawMaterial(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (CLI_RAW_PATTERN.test(serialized)) {
    throw cliError('runtime_ops.raw_material_rejected', 'Runtime operations CLI output was rejected by redaction guard');
  }
  return true;
}

function pathSegments(input = '') {
  return String(input)
    .replace(/\\/gu, '/')
    .split('/')
    .filter(Boolean);
}

function resolveInputPath(input, { cwd = process.cwd() } = {}) {
  const text = String(input ?? '').trim();
  if (
    !text
    || text.includes('\0')
    || /^https?:\/\//iu.test(text)
    || pathSegments(text).includes('..')
  ) {
    throw cliError('runtime_ops.path_rejected', 'Runtime operations CLI path was rejected');
  }
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(cwd, text);
}

async function readJsonInput(input, options = {}) {
  const filePath = resolveInputPath(input, options);
  const info = await stat(filePath);
  if (!info.isFile()) {
    throw cliError('runtime_ops.file_required', 'Runtime operations CLI expected a JSON file');
  }
  if (info.size > (options.maxBytes ?? MAX_INPUT_BYTES)) {
    throw cliError('runtime_ops.file_too_large', 'Runtime operations CLI input is too large');
  }
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  assertNoCliRawMaterial(parsed);
  return parsed;
}

async function runStoreRef(input, options = {}) {
  const filePath = resolveInputPath(input, options);
  const info = await stat(filePath);
  const manifestPath = info.isDirectory()
    ? path.join(filePath, 'run_manifest.json')
    : filePath;
  const rootDir = path.dirname(path.dirname(manifestPath));
  const runDir = path.basename(path.dirname(manifestPath));
  return {
    rootDir,
    manifestPath: `${runDir}/run_manifest.json`,
  };
}

async function loadRunStoreFromInput(input, options = {}) {
  const ref = await runStoreRef(input, options);
  return await loadRuntimeRunStore(ref.rootDir, ref.manifestPath, {
    maxBytes: MAX_INPUT_BYTES,
  });
}

function outputJson(payload) {
  assertNoCliRawMaterial(payload);
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function parseFlagValue(args, flagName, fallback = null) {
  const inline = args.find((arg) => String(arg).startsWith(`${flagName}=`));
  if (inline) return String(inline).slice(flagName.length + 1);
  const index = args.indexOf(flagName);
  if (index !== -1) {
    return args[index + 1] ?? fallback;
  }
  return fallback;
}

function parseSafeFilter(args) {
  const raw = parseFlagValue(args, '--filter', '');
  if (!raw) return {};
  const [key, ...rest] = String(raw).split('=');
  const value = rest.join('=');
  if (!SAFE_FILTER_KEYS.has(key) || !value || CLI_RAW_PATTERN.test(value)) {
    throw cliError('runtime_ops.filter_rejected', 'Runtime operations CLI filter was rejected');
  }
  return { [key]: value };
}

function capabilityPackageSimulationInput(pkg) {
  const capability = pkg.capabilities?.[0] ?? {};
  const contract = pkg.executionContracts?.find((entry) => entry.executionContractRef === capability.executionContractRef)
    ?? pkg.executionContracts?.[0]
    ?? {};
  return {
    packageId: pkg.packageId,
    capabilityRef: capability.capabilityRef,
    providerId: capability.providerCompatibility?.[0] ?? contract.providerCompatibility?.[0] ?? '',
    capabilityKind: capability.kind ?? contract.kind ?? '',
    operation: contract.kind ?? capability.kind ?? '',
    authRequirement: capability.authRequirement ?? { required: false, scopes: [] },
    requestedScopes: capability.authRequirement?.scopes ?? [],
    targetOrigin: pkg.siteOrigin,
    destructiveRequirement: {
      required: capability.riskClassification?.destructive === true || capability.risk === 'destructive',
    },
    paymentRequirement: {
      required: capability.riskClassification?.payment === true || capability.risk === 'payment',
    },
    naturalLanguageRequestGrantsExecution: false,
  };
}

async function inspectRun(input, options = {}) {
  const loaded = await loadRunStoreFromInput(input, options);
  return {
    command: 'run.inspect',
    run: {
      runId: loaded.manifest.runId,
      status: loaded.manifest.status,
      providerId: loaded.manifest.providerId,
      packageId: loaded.manifest.packageId,
      policyId: loaded.manifest.policyId,
      sideEffectAttempted: loaded.manifest.sideEffectAttempted,
      artifactMetadataCount: loaded.manifest.artifactMetadata.length,
      fileCount: loaded.manifest.files.length,
      warnings: loaded.warnings,
    },
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    rawArtifactContentRead: false,
    redactionRequired: true,
  };
}

async function renderAuditView(input, args, options = {}) {
  const format = parseFlagValue(args, '--format', 'text');
  const fileName = path.basename(String(input));
  const view = input.endsWith('.json') && fileName !== 'run_manifest.json'
    ? await readJsonInput(input, options)
    : (await loadRunStoreFromInput(input, options)).auditView;
  const auditView = view?.schemaVersion ? view : createRuntimeAuditView({ report: view });
  if (format === 'json') {
    const output = `${renderRuntimeAuditViewJson(auditView)}\n`;
    assertNoCliRawMaterial(output);
    return output;
  }
  if (format !== 'text') {
    throw cliError('runtime_ops.format_rejected', 'Runtime operations CLI format was rejected');
  }
  const output = `${renderRuntimeAuditViewText(auditView)}\n`;
  assertNoCliRawMaterial(output);
  return output;
}

async function queryAudit(input, args, options = {}) {
  const loaded = await loadRunStoreFromInput(input, options);
  const result = queryRunStoreIndex(loaded.queryIndex, parseSafeFilter(args));
  return {
    command: 'audit.query',
    ...result,
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
  };
}

async function inspectPackage(input, options = {}) {
  const pkg = await readJsonInput(input, options);
  const report = validateCapabilityPackageManifest(pkg);
  if (report.ok !== true) {
    throw cliError('runtime_ops.package_invalid', 'Runtime operations CLI package validation failed');
  }
  return {
    command: 'package.inspect',
    packageId: report.sanitized.packageId,
    version: report.sanitized.version,
    siteOrigin: report.sanitized.siteOrigin,
    capabilityCount: report.sanitized.capabilities.length,
    executionContractCount: report.sanitized.executionContracts.length,
    capabilities: report.sanitized.capabilities.map((capability) => ({
      capabilityRef: capability.capabilityRef,
      kind: capability.kind,
      risk: capability.risk,
      runtimeCallable: capability.runtimeCallable,
      executableByDefault: capability.executableByDefault,
      providerCompatibility: capability.providerCompatibility,
    })),
    redactionRequired: true,
  };
}

async function diffPackages(previousInput, nextInput, options = {}) {
  const previous = await readJsonInput(previousInput, options);
  const next = await readJsonInput(nextInput, options);
  return {
    command: 'package.diff',
    ...diffCapabilityPackages(previous, next),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
  };
}

async function simulatePolicy(policyInput, packageInput, options = {}) {
  const policyPack = await readJsonInput(policyInput, options);
  const pkg = await readJsonInput(packageInput, options);
  return {
    command: 'policy.simulate',
    ...simulatePolicyPack(policyPack, capabilityPackageSimulationInput(pkg)),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
  };
}

async function compareRegression(previousInput, nextInput, options = {}) {
  const previous = await readJsonInput(previousInput, options);
  const next = await readJsonInput(nextInput, options);
  return {
    command: 'regression.compare',
    ...compareRuntimeRegressionSnapshots(previous, next),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
  };
}

async function dispatchRuntimeOps(argv, options = {}) {
  const [command, subcommand, ...rest] = argv;
  if (command === 'run' && subcommand === 'inspect' && rest[0]) {
    return outputJson(await inspectRun(rest[0], options));
  }
  if (command === 'audit' && subcommand === 'view' && rest[0]) {
    return await renderAuditView(rest[0], rest.slice(1), options);
  }
  if (command === 'audit' && subcommand === 'query' && rest[0]) {
    return outputJson(await queryAudit(rest[0], rest.slice(1), options));
  }
  if (command === 'package' && subcommand === 'inspect' && rest[0]) {
    return outputJson(await inspectPackage(rest[0], options));
  }
  if (command === 'package' && subcommand === 'diff' && rest[0] && rest[1]) {
    return outputJson(await diffPackages(rest[0], rest[1], options));
  }
  if (command === 'policy' && subcommand === 'simulate' && rest[0] && rest[1]) {
    return outputJson(await simulatePolicy(rest[0], rest[1], options));
  }
  if (command === 'regression' && subcommand === 'compare' && rest[0] && rest[1]) {
    return outputJson(await compareRegression(rest[0], rest[1], options));
  }
  throw cliError('runtime_ops.command_not_supported', 'Runtime operations CLI command is not available');
}

export async function runRuntimeOpsCli(argv = [], options = {}) {
  try {
    const stdout = await dispatchRuntimeOps(argv.map((arg) => String(arg)), options);
    assertNoCliRawMaterial(stdout);
    return {
      exitCode: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    const code = error?.code ?? 'runtime_ops.failed';
    const stderr = `${code}\n`;
    assertNoCliRawMaterial(stderr);
    return {
      exitCode: 1,
      stdout: '',
      stderr,
    };
  }
}

if (isMain()) {
  runRuntimeOpsCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }).catch(() => {
    process.stderr.write('runtime_ops.failed\n');
    process.exitCode = 1;
  });
}
