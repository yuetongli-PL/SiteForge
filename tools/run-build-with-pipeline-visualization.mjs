#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runSiteForgeBuild,
} from '../src/app/pipeline/build/index.mjs';
import {
  prepareSiteForgeBuildSetup,
} from '../src/app/pipeline/build/setup-assistant.mjs';
import {
  SITEFORGE_BUILD_STAGE_NAMES,
} from '../src/app/pipeline/build/stage-plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, '.siteforge', 'live', 'build_state.json');

function usage() {
  return [
    'Usage:',
    '  node tools/run-build-with-pipeline-visualization.mjs <url> [options]',
    '',
    'Options:',
    '  --state <path>       State JSON path to update during execution.',
    '  --build-id <id>      Reuse a stable SiteForge build id.',
    '  --max-pages <n>      Limit crawl pages.',
    '  --max-depth <n>      Limit crawl depth.',
    '  --deep              Enable deeper default collection.',
    '  --render-js         Enable rendered-page collection.',
    '  --no-render-js      Disable rendered-page collection.',
    '  --capture-network   Enable network summary capture.',
    '  --sitemap-timeout-ms <n>       Timeout for one sitemap read.',
    '  --sitemap-total-timeout-ms <n> Timeout for sitemap discovery.',
    '  --auth <mode>       Pass auth mode to setup/build.',
    '  --help              Show this help.',
    '',
    'Open the visualization with:',
    '  http://127.0.0.1:4173/docs/siteforge-pipeline.html?state=.siteforge/live/build_state.json',
  ].join('\n');
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = /** @type {Record<string, any>} */ ({ cwd: REPO_ROOT });
  let url = null;
  let statePath = DEFAULT_STATE_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true, url: null, options, statePath };
    }
    if (!arg.startsWith('--')) {
      if (url) {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      url = arg;
      continue;
    }
    switch (arg) {
      case '--state': {
        statePath = path.resolve(REPO_ROOT, readValue(argv, index, arg));
        index += 1;
        break;
      }
      case '--build-id': {
        options.buildId = readValue(argv, index, arg);
        index += 1;
        break;
      }
      case '--max-pages': {
        options.maxPages = Number.parseInt(readValue(argv, index, arg), 10);
        index += 1;
        break;
      }
      case '--max-depth': {
        options.maxDepth = Number.parseInt(readValue(argv, index, arg), 10);
        index += 1;
        break;
      }
      case '--auth': {
        options.authMode = readValue(argv, index, arg);
        index += 1;
        break;
      }
      case '--sitemap-timeout-ms': {
        options.sitemapReadTimeoutMs = Number.parseInt(readValue(argv, index, arg), 10);
        index += 1;
        break;
      }
      case '--sitemap-total-timeout-ms': {
        options.sitemapDiscoveryTimeoutMs = Number.parseInt(readValue(argv, index, arg), 10);
        index += 1;
        break;
      }
      case '--deep':
        options.deep = true;
        break;
      case '--render-js':
        options.renderJs = true;
        break;
      case '--no-render-js':
        options.renderJs = false;
        options.renderJsDisabledExplicit = true;
        break;
      case '--capture-network':
      case '--network':
        options.captureNetwork = true;
        options.network = true;
        break;
      default:
        throw new Error(`Unsupported option for live visualization runner: ${arg}`);
    }
  }

  return { help: false, url, options, statePath };
}

function sanitizeStageRecord(record = /** @type {any} */ ({})) {
  return {
    status: record.status ?? 'pending',
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? record.completedAt ?? record.endedAt ?? null,
    activeSubstep: record.activeSubstep ?? null,
    substeps: sanitizeSubsteps(record.substeps),
    reasonCode: record.reasonCode ?? null,
    reasonCodes: Array.isArray(record.reasonCodes) ? record.reasonCodes.slice(0, 8) : [],
    warnings: Array.isArray(record.warnings) ? record.warnings.slice(0, 5) : [],
    errors: Array.isArray(record.errors) ? record.errors.slice(0, 3) : [],
  };
}

function sanitizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeSubstepRecord(record = /** @type {any} */ ({})) {
  return {
    id: record.id ?? null,
    label: record.label ?? null,
    order: Number.isFinite(Number(record.order)) ? Number(record.order) : null,
    status: record.status ?? 'pending',
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? record.completedAt ?? record.endedAt ?? null,
    reasonCode: record.reasonCode ?? null,
    message: compactText(record.message ?? null, null, 240),
    currentItem: compactText(record.currentItem ?? null, null, 320),
    processedCount: sanitizeOptionalNumber(record.processedCount),
    totalCount: sanitizeOptionalNumber(record.totalCount),
    discoveredCount: sanitizeOptionalNumber(record.discoveredCount),
    skippedCount: sanitizeOptionalNumber(record.skippedCount),
    elapsedMs: sanitizeOptionalNumber(record.elapsedMs),
    warnings: Array.isArray(record.warnings) ? record.warnings.slice(0, 3) : [],
    errors: Array.isArray(record.errors) ? record.errors.slice(0, 2) : [],
  };
}

function sanitizeSubsteps(substeps = /** @type {any} */ (null)) {
  if (!substeps) {
    return {};
  }
  if (Array.isArray(substeps)) {
    return Object.fromEntries(substeps
      .filter((entry) => entry?.id)
      .map((entry) => [entry.id, sanitizeSubstepRecord(entry)]));
  }
  if (typeof substeps === 'object') {
    return Object.fromEntries(Object.entries(substeps).map(([id, value]) => [
      id,
      typeof value === 'string'
        ? { id, status: value }
        : sanitizeSubstepRecord({ id, ...value }),
    ]));
  }
  return {};
}

function sanitizeStageRecords(stageRecords = /** @type {Record<string, any>} */ ({})) {
  return Object.fromEntries(
    SITEFORGE_BUILD_STAGE_NAMES.map((stageName) => [
      stageName,
      stageRecords[stageName] ? sanitizeStageRecord(stageRecords[stageName]) : { status: 'pending' },
    ]),
  );
}

function summarizeSite(site = /** @type {any} */ ({})) {
  return {
    id: site.id ?? null,
    hostKey: site.hostKey ?? site.host ?? null,
    accessStatus: site.siteAccessStatus ?? site.accessStatus ?? null,
  };
}

function compactText(value, fallback = null, maxLength = 160) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) {
    return fallback;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function safeEndpoint(value) {
  const text = compactText(value, null, 220);
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search ? '?…' : ''}`;
  } catch {
    return text;
  }
}

function safeHost(value) {
  const text = compactText(value);
  if (!text) {
    return null;
  }
  try {
    return new URL(text).hostname;
  } catch {
    return null;
  }
}

function takeSafeList(values, limit, mapper) {
  return (Array.isArray(values) ? values : [])
    .slice(0, limit)
    .map(mapper)
    .filter(Boolean);
}

function summarizeApiCandidate(result = /** @type {any} */ ({}), index = 0) {
  const candidate = result.candidate ?? result.value ?? result.summary ?? result;
  const endpoint = candidate.endpoint ?? {};
  const url = candidate.url ?? endpoint.url ?? candidate.request?.url ?? null;
  return {
    id: compactText(candidate.id ?? result.id ?? `api-candidate-${index + 1}`),
    stage: 'captureNetworkTraces',
    method: compactText(candidate.method ?? endpoint.method ?? candidate.request?.method ?? 'GET', 'GET', 16),
    endpoint: safeEndpoint(url ?? candidate.path ?? endpoint.path),
    host: safeHost(url),
    source: compactText(candidate.source ?? result.source ?? 'network-summary'),
    status: compactText(result.status ?? candidate.status ?? 'observed'),
    evidenceRef: compactText(result.artifactPath ?? result.candidateRef ?? null, null, 220),
  };
}

function summarizeReplayDecision(decision = /** @type {any} */ ({}), index = 0) {
  const candidate = decision.candidate ?? {};
  const endpoint = candidate.endpoint ?? {};
  const url = candidate.url ?? endpoint.url ?? candidate.request?.url ?? null;
  return {
    id: compactText(candidate.id ?? decision.id ?? `api-decision-${index + 1}`),
    stage: 'apiAdapterReplay',
    method: compactText(candidate.method ?? endpoint.method ?? candidate.request?.method ?? 'GET', 'GET', 16),
    endpoint: safeEndpoint(url ?? candidate.path ?? endpoint.path),
    host: safeHost(url),
    source: compactText(candidate.source ?? 'api-adapter-candidate'),
    status: compactText(decision.status ?? 'validated'),
    replayStatus: compactText(decision.reasonCode ?? decision.status ?? null),
    evidenceRef: compactText(decision.artifactPath ?? null, null, 220),
  };
}

function summarizeApiAdapter(adapter = /** @type {any} */ ({}), index = 0) {
  return {
    id: compactText(adapter.adapterId ?? adapter.candidateId ?? `api-adapter-${index + 1}`),
    candidateId: compactText(adapter.candidateId ?? null),
    method: compactText(adapter.method ?? adapter.endpoint?.method ?? 'GET', 'GET', 16),
    endpoint: safeEndpoint(adapter.endpoint?.url ?? adapter.endpoint ?? adapter.runtimeEndpoint),
    runtimeBindingId: compactText(adapter.runtimeBindingId ?? null),
    runtimeParameterSource: compactText(adapter.runtimeParameterSource ?? null),
    authBoundary: compactText(adapter.authBoundary ?? null),
    status: 'activated',
    evidenceRef: compactText(adapter.replayVerificationRef ?? adapter.adapterDecisionRef ?? adapter.candidateRef ?? null, null, 220),
    semantics: compactText(adapter.apiSemantics?.operation ?? adapter.apiSemantics?.resource ?? null),
  };
}

function summarizeCapability(capability = /** @type {any} */ ({}), index = 0) {
  const plan = capability.executionPlan ?? null;
  return {
    id: compactText(capability.id ?? `capability-${index + 1}`),
    name: compactText(capability.name ?? capability.label ?? capability.id ?? `capability-${index + 1}`),
    status: compactText(capability.status ?? null),
    enabledStatus: compactText(capability.enabled_status ?? capability.enabledStatus ?? null),
    safetyLevel: compactText(capability.safetyLevel ?? capability.safety ?? null),
    riskLevel: compactText(capability.risk_level ?? capability.riskLevel ?? null),
    evidenceStatus: compactText(capability.evidence_status ?? capability.evidenceStatus ?? null),
    sourceLayer: compactText(capability.sourceLayer ?? capability.providerId ?? null),
    runtimeMode: compactText(capability.runtimeMode ?? plan?.runtimeMode ?? plan?.mode ?? null),
    hasExecutionPlan: Boolean(plan),
    apiBacked: Boolean(capability.apiAdapter ?? capability.apiCandidateCount ?? capability.runtimeMode === 'generic_http_read'),
  };
}

function summarizeExecutionPlan(plan = /** @type {any} */ ({}), index = 0, capability = /** @type {any} */ ({})) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return {
    id: compactText(plan.id ?? `${capability.id ?? 'plan'}-${index + 1}`),
    capabilityId: compactText(plan.capabilityId ?? capability.id ?? null),
    capabilityName: compactText(capability.name ?? capability.label ?? null),
    mode: compactText(plan.mode ?? plan.runtimeMode ?? capability.runtimeMode ?? null),
    runtimeMode: compactText(plan.runtimeMode ?? capability.runtimeMode ?? null),
    requiresConfirmation: plan.requiresConfirmation === true,
    autoExecute: plan.autoExecute === true,
    stepCount: steps.length,
    firstStep: compactText(steps[0]?.kind ?? steps[0]?.action ?? null),
    apiBacked: Boolean(capability.apiBacked ?? capability.apiAdapter ?? capability.runtimeMode === 'generic_http_read'),
  };
}

function summarizeIntent(intent = /** @type {any} */ ({}), index = 0) {
  return {
    id: compactText(intent.id ?? `intent-${index + 1}`),
    name: compactText(intent.name ?? intent.canonicalUtterance ?? `intent-${index + 1}`),
    canonicalUtterance: compactText(intent.canonicalUtterance ?? null),
    example: compactText(intent.utteranceExamples?.[0] ?? null),
    capabilityId: compactText(intent.capabilityId ?? null),
    callable: intent.callable !== false,
    safetyLevel: compactText(intent.safetyLevel ?? null),
    runtimeMode: compactText(intent.runtimeMode ?? null),
  };
}

function buildExecutionObservations(stageResults = /** @type {any} */ ({})) {
  const apiCandidates = takeSafeList(stageResults.captureNetworkTraces?.apiCandidateResults, 80, summarizeApiCandidate);
  const apiDecisions = takeSafeList(stageResults.apiAdapterReplay?.decisions, 80, summarizeReplayDecision);
  const apiAdapters = takeSafeList(stageResults.apiAdapterReplay?.activatedAdapters, 80, summarizeApiAdapter);
  const capabilities = takeSafeList(stageResults.discoverCapabilities?.capabilities, 160, summarizeCapability);
  const capabilityById = new Map((Array.isArray(stageResults.discoverCapabilities?.capabilities)
    ? stageResults.discoverCapabilities.capabilities
    : []).map((capability) => [capability.id, capability]));
  const executionPlans = takeSafeList(stageResults.discoverCapabilities?.executionPlans, 160, (plan, index) => (
    summarizeExecutionPlan(plan, index, capabilityById.get(plan?.capabilityId) ?? {})
  ));
  const intents = takeSafeList(stageResults.generateIntents?.intents, 200, summarizeIntent);
  const apiDiscoveries = [
    ...apiCandidates,
    ...apiDecisions,
    ...apiAdapters.map((adapter) => ({
      id: adapter.candidateId ?? adapter.id,
      stage: 'apiAdapterReplay',
      method: adapter.method,
      endpoint: adapter.endpoint,
      host: null,
      source: 'activated-api-adapter',
      status: 'activated',
      replayStatus: 'verified',
      evidenceRef: adapter.evidenceRef,
    })),
  ];
  return {
    schemaVersion: 'siteforge.pipeline.observations.v1',
    summary: {
      apiDiscoveries: apiDiscoveries.length,
      apiAdapters: apiAdapters.length,
      capabilities: capabilities.length,
      executableCapabilities: executionPlans.length,
      apiExecutableCapabilities: executionPlans.filter((plan) => plan.apiBacked).length,
      userIntents: intents.length,
      callableIntents: intents.filter((intent) => intent.callable).length,
    },
    apiDiscoveries,
    apiAdapters,
    capabilityDiscoveries: capabilities,
    executableCapabilities: executionPlans,
    userIntents: intents,
  };
}

function createFileBackedWebInteractionSession(statePath) {
  let closed = false;
  let writeChain = Promise.resolve();

  async function writeState(payload) {
    if (closed) {
      return;
    }
    await mkdir(path.dirname(statePath), { recursive: true });
    const state = {
      schemaVersion: 'siteforge.pipeline.live_state.v1',
      generatedAt: new Date().toISOString(),
      cwd: payload.cwd ?? REPO_ROOT,
      site: summarizeSite(payload.site),
      phase: payload.phase ?? 'build',
      status: payload.status ?? 'running',
      stageRecords: sanitizeStageRecords(payload.stageRecords),
      observations: buildExecutionObservations(payload.stageResults),
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  return {
    update(payload) {
      writeChain = writeChain.then(() => writeState(payload));
    },
    async flush() {
      await writeChain;
    },
    async close() {
      await writeChain;
      closed = true;
    },
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || !parsed.url) {
    console.log(usage());
    process.exitCode = parsed.help ? 0 : 1;
    return;
  }

  const session = createFileBackedWebInteractionSession(parsed.statePath);
  const stateRelativePath = path.relative(REPO_ROOT, parsed.statePath).replaceAll(path.sep, '/');
  const visualUrl = `http://127.0.0.1:4173/docs/siteforge-pipeline.html?state=${encodeURIComponent(stateRelativePath)}`;
  console.log(`Live state: ${stateRelativePath}`);
  console.log(`Visualization: ${visualUrl}`);

  try {
    const options = {
      ...parsed.options,
      webInteractionSession: session,
    };
    const setup = await prepareSiteForgeBuildSetup(parsed.url, options);
    const result = await runSiteForgeBuild(parsed.url, {
      ...setup.buildOptions,
      sitemapReadTimeoutMs: parsed.options.sitemapReadTimeoutMs,
      sitemapDiscoveryTimeoutMs: parsed.options.sitemapDiscoveryTimeoutMs,
      webInteractionSession: session,
    });
    await session.flush();
    await mkdir(path.dirname(parsed.statePath), { recursive: true });
    await writeFile(parsed.statePath, `${JSON.stringify({
      schemaVersion: 'siteforge.pipeline.live_state.v1',
      generatedAt: new Date().toISOString(),
      cwd: REPO_ROOT,
      site: summarizeSite(result.buildContext?.site),
      phase: 'outputs',
      status: 'success',
      stageRecords: sanitizeStageRecords(result.stages ?? result.stageRecords ?? {}),
      observations: buildExecutionObservations(result.stageResults ?? result.results ?? {}),
      artifacts: {
        buildReport: result.artifacts?.['build_report.json'] ?? null,
        userReport: result.artifacts?.['build_report.user.json'] ?? null,
      },
    }, null, 2)}\n`, 'utf8');
  } catch (error) {
    await session.flush();
    const previous = {
      schemaVersion: 'siteforge.pipeline.live_state.v1',
      generatedAt: new Date().toISOString(),
      cwd: REPO_ROOT,
      phase: 'outputs',
      status: error?.buildStatus ?? error?.stageStatus ?? 'failed',
      failedStage: error?.stage ?? null,
      error: error?.message ?? String(error),
      stageRecords: sanitizeStageRecords(error?.buildReport?.stages ?? {}),
    };
    await mkdir(path.dirname(parsed.statePath), { recursive: true });
    await writeFile(parsed.statePath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
