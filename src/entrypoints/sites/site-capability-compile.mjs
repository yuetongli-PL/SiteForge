// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import {
  ensureDir,
  writeTextFile,
} from '../../infra/io.mjs';
import {
  buildSiteCapabilityGraphFromCompileManifest,
  createCapabilityIntake,
  createCapabilityIntakeQuestionnaire,
  createStaticSiteCompileManifestFromConfig,
  prepareCompilerDerivedArtifact,
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from '../../sites/capability/compiler/index.mjs';
import {
  createDryRunCapabilityPlan,
  createPlannerLayerHandoffDescriptor,
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
} from '../../sites/capability/planner/index.mjs';
import {
  createExecutionPolicyDecision,
  createLayerExecutionHandoffDescriptor,
} from '../../sites/capability/execution/index.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const HELP = `Usage:
  node src/entrypoints/sites/site-capability-compile.mjs --site <siteKey|host> [--url <url>] [--intent <intent>] [--capability <name> ...] [--capabilities <csv>] [--ask-capabilities] [--previous-source-digest <digest>] [--write-artifacts --out-dir <dir>] [--json]

This entrypoint compiles repo-local registry/config descriptors only. It does not
open websites, run captures, invoke SiteAdapter runtime, call downloader, or
materialize session/browser profile data.
`;

function readValue(argv, index, flag) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

export function parseArgs(argv) {
  const options = {
    json: false,
    writeArtifacts: false,
    requestedCapabilities: [],
    askCapabilities: false,
    outDir: path.join(REPO_ROOT, 'runs', 'sites', 'site-capability-compile'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--site': {
        const read = readValue(argv, index, arg);
        options.site = read.value;
        index = read.nextIndex;
        break;
      }
      case '--url': {
        const read = readValue(argv, index, arg);
        options.url = read.value;
        index = read.nextIndex;
        break;
      }
      case '--intent': {
        const read = readValue(argv, index, arg);
        options.intent = read.value;
        index = read.nextIndex;
        break;
      }
      case '--capability': {
        const read = readValue(argv, index, arg);
        options.requestedCapabilities.push(read.value);
        index = read.nextIndex;
        break;
      }
      case '--capabilities': {
        const read = readValue(argv, index, arg);
        options.requestedCapabilities.push(...read.value.split(',').map((value) => value.trim()).filter(Boolean));
        index = read.nextIndex;
        break;
      }
      case '--ask-capabilities':
        options.askCapabilities = true;
        break;
      case '--previous-source-digest': {
        const read = readValue(argv, index, arg);
        options.previousSourceDigest = read.value;
        index = read.nextIndex;
        break;
      }
      case '--out-dir': {
        const read = readValue(argv, index, arg);
        options.outDir = read.value;
        index = read.nextIndex;
        break;
      }
      case '--write-artifacts':
        options.writeArtifacts = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function createCompileRequest({ site, url, requestedCapabilities = [] } = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    siteKey: site,
    url,
    capabilityIntake: createCapabilityIntake({
      requestedCapabilities,
    }),
    compileScope: {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      coverageMode: 'declared_only',
      coverageCompleteness: 'partial',
      allowedCaptureModes: ['static'],
      sourceTypes: ['site-registry', 'site-capabilities'],
      redactionRequired: true,
    },
    sourceTypes: ['site-registry', 'site-capabilities'],
    redactionRequired: true,
  };
}

function createPlanRequest({ manifest, normalizedIntent } = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    taskId: `task:${manifest.compileId}`,
    site: manifest.siteKey,
    siteKey: manifest.siteKey,
    normalizedIntent,
    mode: 'dry_run',
    correlationId: `correlation:${manifest.compileId}`,
    traceId: `trace:${manifest.compileId}`,
  };
}

function createPlanContext() {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    capabilityState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, agentExposed: true },
    sessionState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, status: 'not_required' },
    riskState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, level: 'low', allowed: true },
    approvalState: { schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION, approved: true },
    graphCompatibility: { validated: true },
    layerCompatibility: { compatible: true, layerCompatibilityVersion: '1.0.0' },
  };
}

async function maybeWriteCompilerArtifacts({ outDir, manifest, graphBuild }) {
  await ensureDir(outDir);
  const manifestArtifact = prepareCompilerDerivedArtifact({
    artifactType: 'SITE_COMPILE_MANIFEST',
    value: manifest,
  });
  const graphBuildArtifact = prepareCompilerDerivedArtifact({
    artifactType: 'COMPILER_GRAPH_BUILD_RESULT',
    value: {
      ...graphBuild,
      graph: graphBuild.graph,
      redactionRequired: true,
    },
  });
  await writeTextFile(path.join(outDir, 'site-compile-manifest.json'), manifestArtifact.artifactJson);
  await writeTextFile(path.join(outDir, 'site-compile-manifest.audit.json'), manifestArtifact.auditJson);
  await writeTextFile(path.join(outDir, 'graph-build-result.json'), graphBuildArtifact.artifactJson);
  await writeTextFile(path.join(outDir, 'graph-build-result.audit.json'), graphBuildArtifact.auditJson);
  return {
    outDir,
    artifactRefs: [
      'site-compile-manifest.json',
      'graph-build-result.json',
    ],
    auditRefs: [
      'site-compile-manifest.audit.json',
      'graph-build-result.audit.json',
    ],
    redactionRequired: true,
    redactionApplied: true,
  };
}

function createCompileResultBase({ manifest, graphBuild, artifactWrite } = {}) {
  const coverageSummary = manifest.capabilityCoverageSummary ?? {};
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    command: 'site-capability-compile',
    descriptorOnly: true,
    siteId: manifest.siteId,
    siteKey: manifest.siteKey,
    compileId: manifest.compileId,
    sourceDigest: manifest.sourceDigest,
    incrementalCompile: manifest.incrementalCompile,
    coverageCompleteness: manifest.coverageReport?.coverageCompleteness ?? null,
    unknownNodeCount: manifest.coverageReport?.unknownNodeCount ?? null,
    capabilityCount: manifest.inventories?.capabilities?.length ?? 0,
    capabilityIntake: manifest.capabilityIntake,
    capabilityCoverageSummary: coverageSummary,
    requestedCapabilities: coverageSummary.requestedCapabilities ?? [],
    missingRequestedCapabilities: coverageSummary.missingRequestedCapabilities ?? [],
    missingRequestedCapabilityCount: coverageSummary.missingRequestedCapabilityCount ?? 0,
    capabilityGapStatus: coverageSummary.capabilityGapStatus ?? 'clear',
    unconfirmedCapabilities: coverageSummary.unconfirmedCapabilities ?? [],
    targetedCapabilityCount: coverageSummary.targetedCapabilityCount ?? 0,
    bestEffortUnconfirmedCount: coverageSummary.bestEffortUnconfirmedCount ?? 0,
    routeCount: graphBuild.graph?.nodes?.filter((node) => node.type === 'RouteNode').length ?? 0,
    executionPathCount: manifest.inventories?.executionPaths?.length ?? 0,
    graphVersion: graphBuild.graph.graphVersion,
    graphValidationResult: graphBuild.validationReport.result,
    artifactWrite,
    executionAttempted: false,
    liveCaptureAttempted: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
    sessionMaterializationAllowed: false,
    redactionRequired: true,
  };
}

function normalizeCapabilityDescriptor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return null;
  }
  return text
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || null;
}

function shouldBlockPlannerHandoffForMissingRequestedCapability({ manifest, explicitIntent } = {}) {
  const coverageSummary = manifest.capabilityCoverageSummary ?? {};
  const requested = coverageSummary.requestedCapabilities ?? [];
  const missing = coverageSummary.missingRequestedCapabilities ?? [];
  const normalizedIntent = normalizeCapabilityDescriptor(explicitIntent);
  return Boolean(
    requested.length > 0
      && (
        (normalizedIntent && missing.includes(normalizedIntent))
        || (
          !normalizedIntent
          && missing.length === requested.length
          && (coverageSummary.targetedCapabilityCount ?? 0) === 0
        )
      ),
  );
}

export async function runSiteCapabilityCompile(options = {}) {
  if (!options.site && !options.url) {
    throw new Error('--site or --url is required');
  }
  if (options.askCapabilities) {
    return {
      schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
      command: 'site-capability-compile',
      descriptorOnly: true,
      inquiryRequired: true,
      capabilityIntakeQuestionnaire: createCapabilityIntakeQuestionnaire({
        siteKey: options.site,
        url: options.url,
      }),
      executionAttempted: false,
      liveCaptureAttempted: false,
      siteAdapterInvocationAllowed: false,
      downloaderInvocationAllowed: false,
      sessionMaterializationAllowed: false,
      redactionRequired: true,
    };
  }
  const manifest = await createStaticSiteCompileManifestFromConfig({
    request: createCompileRequest({
      site: options.site,
      url: options.url,
      requestedCapabilities: options.requestedCapabilities,
    }),
    repoRoot: REPO_ROOT,
    previousSourceDigest: options.previousSourceDigest,
  });
  const graphBuild = buildSiteCapabilityGraphFromCompileManifest(manifest);
  if (graphBuild.validationReport.result !== 'passed') {
    const error = new Error('Compiler-generated graph did not pass validation');
    error.code = 'compiler.graph_build_failed';
    throw error;
  }
  const blockedByMissingRequestedCapability = shouldBlockPlannerHandoffForMissingRequestedCapability({
    manifest,
    explicitIntent: options.intent,
  });
  if (blockedByMissingRequestedCapability) {
    const artifactWrite = options.writeArtifacts
      ? await maybeWriteCompilerArtifacts({
        outDir: options.outDir,
        manifest,
        graphBuild,
      })
      : undefined;
    const missingCapability = manifest.capabilityCoverageSummary?.missingRequestedCapabilities?.[0];
    return {
      ...createCompileResultBase({ manifest, graphBuild, artifactWrite }),
      normalizedIntent: missingCapability,
      planStatus: 'blocked',
      plannerHandoffReady: false,
      executionPolicyStatus: 'blocked_by_compile_gap',
      reasonCode: 'compiler.capability_inventory_invalid',
      capabilityGapBlocksPlannerHandoff: true,
      layerHandoffAllowed: false,
      runtimeMaterializationAllowed: false,
    };
  }
  const firstCapability = manifest.inventories.capabilities[0];
  const normalizedIntent = options.intent ?? firstCapability?.normalizedIntent;
  const dryRunResult = createDryRunCapabilityPlan({
    request: createPlanRequest({ manifest, normalizedIntent }),
    context: createPlanContext(),
    graph: graphBuild.graph,
    validationReport: graphBuild.validationReport,
  });
  const plannerHandoff = createPlannerLayerHandoffDescriptor({ dryRunResult });
  const executionHandoff = createLayerExecutionHandoffDescriptor({
    executionId: `execution:${manifest.compileId}`,
    capabilityPlanRef: plannerHandoff.planId,
    graphVersion: graphBuild.graph.graphVersion,
    plannerVersion: dryRunResult.plannerVersion,
    layerCompatibilityVersion: plannerHandoff.layerCompatibilityVersion,
  });
  const executionPolicyDecision = createExecutionPolicyDecision({
    handoffDescriptor: executionHandoff,
    plannerHandoffRef: plannerHandoff.planId,
    governedLayerEntrypointAvailable: true,
    approvalSatisfied: plannerHandoff.governedHandoffReady,
  });
  const artifactWrite = options.writeArtifacts
    ? await maybeWriteCompilerArtifacts({
      outDir: options.outDir,
      manifest,
      graphBuild,
    })
    : undefined;
  return {
    ...createCompileResultBase({ manifest, graphBuild, artifactWrite }),
    normalizedIntent,
    planStatus: dryRunResult.planStatus,
    plannerHandoffReady: plannerHandoff.governedHandoffReady,
    executionPolicyStatus: executionPolicyDecision.decisionStatus,
  };
}

async function main() {
  initializeCliUtf8();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const result = await runSiteCapabilityCompile(options);
  if (options.json) {
    writeJsonStdout(result);
    return;
  }
  if (result.capabilityIntakeQuestionnaire) {
    process.stdout.write(`Capability intake required for ${options.site ?? options.url}; candidates=${result.capabilityIntakeQuestionnaire.candidateCapabilities.join(',')}\n`);
    return;
  }
  process.stdout.write(`Compiled ${result.siteKey} -> ${result.graphValidationResult}; plan=${result.planStatus}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
