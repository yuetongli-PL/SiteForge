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
  createLayerOwnedRuntimeConsumerResult,
  writeLayerOwnedRuntimeFeedbackArtifacts,
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

function mergeArtifactWrite(baseWrite, summaryWrite) {
  if (!summaryWrite) {
    return baseWrite;
  }
  if (!baseWrite) {
    return summaryWrite;
  }
  return {
    ...baseWrite,
    artifactRefs: [
      ...(baseWrite.artifactRefs ?? []),
      ...(summaryWrite.artifactRefs ?? []),
    ],
    auditRefs: [
      ...(baseWrite.auditRefs ?? []),
      ...(summaryWrite.auditRefs ?? []),
    ],
    redactionRequired: true,
    redactionApplied: true,
  };
}

function createDefaultSiteSpecificEvidenceSummary({ manifest } = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    summaryVersion: '1.0.0',
    summaryType: 'SITE_SPECIFIC_EVIDENCE_SUMMARY',
    siteKey: manifest.siteKey,
    status: 'not_configured',
    descriptorOnly: true,
    redactionRequired: true,
    observedApiAutoPromotionAllowed: false,
    observedCapabilityAutoPromotionAllowed: false,
    executableCapabilityAutoPromotionAllowed: false,
    artifactFamilies: [],
    boundaries: {
      liveCaptureAttempted: false,
      runtimeTaskExecuted: false,
      directDownloaderInvocationAllowed: false,
      directSiteAdapterInvocationAllowed: false,
      sessionViewCreated: false,
    },
  };
}

async function createSiteSpecificEvidenceSummaryForManifest(manifest) {
  if (manifest.siteKey === 'bilibili') {
    const {
      createBilibiliSiteSpecificEvidenceSummary,
    } = await import('../../sites/bilibili/capability-evidence-fixtures.mjs');
    return createBilibiliSiteSpecificEvidenceSummary();
  }
  return createDefaultSiteSpecificEvidenceSummary({ manifest });
}

function createLayerRuntimeConsumerArtifactSummary(layerRuntimeConsumerResult) {
  if (!layerRuntimeConsumerResult) {
    return null;
  }
  return {
    schemaVersion: layerRuntimeConsumerResult.schemaVersion,
    executionVersion: layerRuntimeConsumerResult.executionVersion,
    resultType: layerRuntimeConsumerResult.resultType,
    consumerOwner: layerRuntimeConsumerResult.consumerOwner,
    executionId: layerRuntimeConsumerResult.executionId,
    graphVersion: layerRuntimeConsumerResult.graphVersion,
    plannerVersion: layerRuntimeConsumerResult.plannerVersion,
    layerCompatibilityVersion: layerRuntimeConsumerResult.layerCompatibilityVersion,
    policyDecisionStatus: layerRuntimeConsumerResult.policyDecisionStatus,
    layerReceiptConsumed: layerRuntimeConsumerResult.layerReceiptConsumed,
    runtimeExecuted: layerRuntimeConsumerResult.runtimeExecuted,
    runtimeTaskExecutedByConsumer: layerRuntimeConsumerResult.runtimeTaskExecutedByConsumer,
    directDownloaderInvocationAllowed: layerRuntimeConsumerResult.directDownloaderInvocationAllowed,
    directSiteAdapterInvocationAllowed: layerRuntimeConsumerResult.directSiteAdapterInvocationAllowed,
    sessionViewMaterializationAllowed: layerRuntimeConsumerResult.sessionViewMaterializationAllowed,
    sensitiveMaterialAllowed: layerRuntimeConsumerResult.rawCredentialMaterialAllowed,
    executionFeedback: {
      feedbackSource: layerRuntimeConsumerResult.executionFeedback?.feedbackSource,
      executionStatus: layerRuntimeConsumerResult.executionFeedback?.executionStatus,
      dryRun: layerRuntimeConsumerResult.executionFeedback?.dryRun,
      runtimeExecuted: layerRuntimeConsumerResult.executionFeedback?.runtimeExecuted,
      directDownloaderInvocationAllowed:
        layerRuntimeConsumerResult.executionFeedback?.directDownloaderInvocationAllowed,
      directSiteAdapterInvocationAllowed:
        layerRuntimeConsumerResult.executionFeedback?.directSiteAdapterInvocationAllowed,
      reasonCodes: layerRuntimeConsumerResult.executionFeedback?.reasonCodes ?? [],
      artifactRefCount: layerRuntimeConsumerResult.executionFeedback?.artifactRefs?.length ?? 0,
    },
    coverageDelta: {
      deltaType: layerRuntimeConsumerResult.coverageDelta?.deltaType,
      coverageBefore: layerRuntimeConsumerResult.coverageDelta?.coverageBefore,
      coverageAfter: layerRuntimeConsumerResult.coverageDelta?.coverageAfter,
      affectedNodeRefCount: layerRuntimeConsumerResult.coverageDelta?.affectedNodeRefs?.length ?? 0,
      affectedCapabilityRefCount: layerRuntimeConsumerResult.coverageDelta?.affectedCapabilityRefs?.length ?? 0,
      affectedRouteRefCount: layerRuntimeConsumerResult.coverageDelta?.affectedRouteRefs?.length ?? 0,
      evidenceRefCount: layerRuntimeConsumerResult.coverageDelta?.evidenceRefs?.length ?? 0,
      dryRun: layerRuntimeConsumerResult.coverageDelta?.dryRun,
      runtimeExecuted: layerRuntimeConsumerResult.coverageDelta?.runtimeExecuted,
      directDownloaderInvocationAllowed:
        layerRuntimeConsumerResult.coverageDelta?.directDownloaderInvocationAllowed,
      directSiteAdapterInvocationAllowed:
        layerRuntimeConsumerResult.coverageDelta?.directSiteAdapterInvocationAllowed,
    },
    coverageDeltaArtifactWrite: {
      artifactType: layerRuntimeConsumerResult.coverageDeltaArtifactWrite?.artifactType,
      redactionRequired: layerRuntimeConsumerResult.coverageDeltaArtifactWrite?.redactionRequired,
      redactionApplied: layerRuntimeConsumerResult.coverageDeltaArtifactWrite?.redactionApplied,
      writeAllowed: layerRuntimeConsumerResult.coverageDeltaArtifactWrite?.writeAllowed,
    },
    lifecycleEvent: {
      eventType: layerRuntimeConsumerResult.lifecycleEvent?.eventType,
      taskId: layerRuntimeConsumerResult.lifecycleEvent?.taskId,
      siteKey: layerRuntimeConsumerResult.lifecycleEvent?.siteKey,
      taskType: layerRuntimeConsumerResult.lifecycleEvent?.taskType,
      traceId: layerRuntimeConsumerResult.lifecycleEvent?.traceId,
      correlationId: layerRuntimeConsumerResult.lifecycleEvent?.correlationId,
    },
    runtimeFeedbackArtifactWrite: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite
      ? {
        artifactType: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.artifactType,
        artifactFiles: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.artifactFiles ?? [],
        auditFiles: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.auditFiles ?? [],
        redactionRequired: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.redactionRequired,
        redactionApplied: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.redactionApplied,
        writeAllowed: layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite.writeAllowed,
      }
      : undefined,
    redactionRequired: true,
  };
}

function createCompileResultSummaryArtifactValue({
  result,
  siteSpecificEvidenceSummary,
} = {}) {
  return {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    summaryVersion: '1.0.0',
    artifactType: 'SITE_COMPILE_RESULT_SUMMARY',
    command: result.command,
    descriptorOnly: true,
    siteId: result.siteId,
    siteKey: result.siteKey,
    compileId: result.compileId,
    sourceDigest: result.sourceDigest,
    compileResult: {
      graphVersion: result.graphVersion,
      graphValidationResult: result.graphValidationResult,
      coverageCompleteness: result.coverageCompleteness,
      capabilityCount: result.capabilityCount,
      routeCount: result.routeCount,
      executionPathCount: result.executionPathCount,
      requestedCapabilities: result.requestedCapabilities,
      missingRequestedCapabilityCount: result.missingRequestedCapabilityCount,
      capabilityGapStatus: result.capabilityGapStatus,
      normalizedIntent: result.normalizedIntent,
      planStatus: result.planStatus,
      plannerHandoffReady: result.plannerHandoffReady,
      executionPolicyStatus: result.executionPolicyStatus,
      layerRuntimeConsumerReady: result.layerRuntimeConsumerReady ?? false,
      reasonCode: result.reasonCode,
    },
    layerRuntimeConsumerResult: createLayerRuntimeConsumerArtifactSummary(result.layerRuntimeConsumerResult),
    siteSpecificEvidenceSummary,
    boundaries: {
      executionAttempted: result.executionAttempted,
      runtimeExecuted: result.runtimeExecuted ?? false,
      liveCaptureAttempted: result.liveCaptureAttempted,
      siteAdapterInvocationAllowed: result.siteAdapterInvocationAllowed,
      downloaderInvocationAllowed: result.downloaderInvocationAllowed,
      sessionViewCreated: false,
      runtimeMaterializationAllowed: result.runtimeMaterializationAllowed ?? false,
    },
    artifactGovernance: {
      compilerDerivedArtifactWrite: true,
      securityGuard: 'prepareCompilerDerivedArtifact',
      redactionRequired: true,
      redactionApplied: true,
      artifactRefs: result.artifactWrite?.artifactRefs ?? [],
      auditRefs: result.artifactWrite?.auditRefs ?? [],
    },
    redactionRequired: true,
  };
}

function compileArtifactWriteFromLayerRuntimeFeedback(write) {
  if (!write) {
    return undefined;
  }
  return {
    artifactRefs: write.artifactFiles ?? [],
    auditRefs: write.auditFiles ?? [],
    redactionRequired: true,
    redactionApplied: true,
  };
}

async function writeCompileResultSummaryArtifact({
  outDir,
  result,
  siteSpecificEvidenceSummary,
} = {}) {
  await ensureDir(outDir);
  const summary = createCompileResultSummaryArtifactValue({
    result,
    siteSpecificEvidenceSummary,
  });
  const prepared = prepareCompilerDerivedArtifact({
    artifactType: 'SITE_COMPILE_RESULT_SUMMARY',
    value: summary,
  });
  await writeTextFile(path.join(outDir, 'site-compile-result-summary.json'), prepared.artifactJson);
  await writeTextFile(path.join(outDir, 'site-compile-result-summary.audit.json'), prepared.auditJson);
  return {
    compileResultSummary: JSON.parse(prepared.artifactJson),
    artifactWrite: {
      outDir,
      artifactRefs: ['site-compile-result-summary.json'],
      auditRefs: ['site-compile-result-summary.audit.json'],
      redactionRequired: true,
      redactionApplied: true,
    },
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
    runtimeExecuted: false,
    liveCaptureAttempted: false,
    siteAdapterInvocationAllowed: false,
    downloaderInvocationAllowed: false,
    sessionMaterializationAllowed: false,
    redactionRequired: true,
  };
}

function createDryRunLayerRuntimeConsumerResult({
  manifest,
  normalizedIntent,
  handoffDescriptor,
  policyDecision,
  artifactWrite,
} = {}) {
  const safeIntent = normalizeCapabilityDescriptor(normalizedIntent) ?? 'default';
  const artifactRefs = artifactWrite?.artifactRefs?.length
    ? artifactWrite.artifactRefs.map((_, index) => `artifact:site-capability-compile:${manifest.siteKey}:${index + 1}`)
    : [`artifact:site-capability-compile:${manifest.siteKey}:dry-run`];
  return createLayerOwnedRuntimeConsumerResult({
    handoffDescriptor,
    policyDecision,
    layerReceipt: {
      executionStatus: 'accepted',
      artifactRefs,
    },
    coverageBefore: 'partial',
    coverageAfter: 'partial',
    deltaType: 'observed',
    affectedNodeRefs: [`node:${manifest.siteKey}:static-compile`],
    affectedCapabilityRefs: [`capability:${manifest.siteKey}:${safeIntent}`],
    affectedRouteRefs: [`route:${manifest.siteKey}:${safeIntent}`],
    evidenceRefs: artifactRefs,
    traceId: `trace:${manifest.compileId}`,
    correlationId: `correlation:${manifest.compileId}`,
    siteKey: manifest.siteKey,
    taskType: 'site-capability-compile-dry-run',
    adapterVersion: manifest.adapterId,
  });
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
    const result = {
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
    if (options.writeArtifacts) {
      const siteSpecificEvidenceSummary = await createSiteSpecificEvidenceSummaryForManifest(manifest);
      const summaryWrite = await writeCompileResultSummaryArtifact({
        outDir: options.outDir,
        result,
        siteSpecificEvidenceSummary,
      });
      result.artifactWrite = mergeArtifactWrite(result.artifactWrite, summaryWrite.artifactWrite);
      result.compileResultSummary = summaryWrite.compileResultSummary;
    }
    return result;
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
  const layerRuntimeConsumerResult = executionPolicyDecision.layerGovernedDispatchReady
    ? createDryRunLayerRuntimeConsumerResult({
      manifest,
      normalizedIntent,
      handoffDescriptor: executionHandoff,
      policyDecision: executionPolicyDecision,
      artifactWrite,
    })
    : undefined;
  const layerRuntimeFeedbackArtifactWrite = options.writeArtifacts && layerRuntimeConsumerResult
    ? await writeLayerOwnedRuntimeFeedbackArtifacts({
      outDir: options.outDir,
      result: layerRuntimeConsumerResult,
    })
    : undefined;
  if (layerRuntimeConsumerResult && layerRuntimeFeedbackArtifactWrite) {
    layerRuntimeConsumerResult.runtimeFeedbackArtifactWrite = layerRuntimeFeedbackArtifactWrite;
  }
  const result = {
    ...createCompileResultBase({ manifest, graphBuild, artifactWrite }),
    normalizedIntent,
    planStatus: dryRunResult.planStatus,
    plannerHandoffReady: plannerHandoff.governedHandoffReady,
    executionPolicyStatus: executionPolicyDecision.decisionStatus,
    layerRuntimeConsumerReady: Boolean(layerRuntimeConsumerResult),
    ...(layerRuntimeConsumerResult ? { layerRuntimeConsumerResult } : {}),
  };
  if (options.writeArtifacts) {
    result.artifactWrite = mergeArtifactWrite(
      result.artifactWrite,
      compileArtifactWriteFromLayerRuntimeFeedback(layerRuntimeFeedbackArtifactWrite),
    );
    const siteSpecificEvidenceSummary = await createSiteSpecificEvidenceSummaryForManifest(manifest);
    const summaryWrite = await writeCompileResultSummaryArtifact({
      outDir: options.outDir,
      result,
      siteSpecificEvidenceSummary,
    });
    result.artifactWrite = mergeArtifactWrite(result.artifactWrite, summaryWrite.artifactWrite);
    result.compileResultSummary = summaryWrite.compileResultSummary;
  }
  return result;
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
