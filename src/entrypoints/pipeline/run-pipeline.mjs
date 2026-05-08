import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  createBuildProgressController,
  renderBuildSummary,
} from '../../infra/cli/build-progress.mjs';

import { executePipeline } from '../../pipeline/engine/engine.mjs';
import { normalizePipelineOptions, toBoolean } from '../../pipeline/engine/options.mjs';
import { PIPELINE_STAGE_SPECS, summarizePipelineStages } from '../../pipeline/engine/stage-spec.mjs';
import { DEFAULT_PIPELINE_RUNTIME, resolvePipelineRuntime } from '../../pipeline/runtime/create-default-runtime.mjs';
import { prepareRedactedArtifactJsonWithAudit, redactValue } from '../../sites/capability/security-guard.mjs';
import { reasonCodeSummary } from '../../sites/capability/reason-codes.mjs';
import { normalizeRiskTransition } from '../../sites/capability/risk-state.mjs';
import { resolveSiteAdapter } from '../../sites/core/adapters/resolver.mjs';

function summarizeAuthKeepalive(authKeepalive) {
  return {
    attempted: authKeepalive.attempted === true,
    ran: authKeepalive.ran === true,
    trigger: authKeepalive.trigger ?? null,
    reason: authKeepalive.reason ?? null,
    thresholdMinutes: authKeepalive.thresholdMinutes ?? null,
    status: authKeepalive.keepaliveReport?.keepalive?.status ?? null,
    sessionHealthSummary: authKeepalive.sessionHealthSummaryAfter ?? authKeepalive.sessionHealthSummary ?? null,
    reports: authKeepalive.keepaliveReport?.reports ?? null,
  };
}

function resolveRiskAwareAdapter(inputUrl) {
  const adapter = resolveSiteAdapter({ inputUrl });
  return typeof adapter?.detectRestrictionPage === 'function' ? adapter : null;
}

function extractSiteRestriction(adapter, inputUrl, manifest) {
  return adapter?.detectRestrictionPage?.({
    inputUrl,
    finalUrl: manifest?.finalUrl ?? inputUrl,
    title: manifest?.title ?? '',
    pageType: manifest?.pageType ?? null,
    pageFacts: manifest?.pageFacts ?? null,
    runtimeEvidence: manifest?.runtimeEvidence ?? null,
  }) ?? null;
}

function buildRestrictionBlockedReason(adapter, restriction) {
  const siteLabel = adapter?.siteKey ?? adapter?.id ?? 'site';
  return `Blocked by ${siteLabel} restriction page${restriction.riskPageCode ? ` ${restriction.riskPageCode}` : ''}.`;
}

function restrictionReasonCode(restriction) {
  return restriction?.reasonCode
    ?? restriction?.antiCrawlReasonCode
    ?? restriction?.riskCauseCode
    ?? 'unknown-risk';
}

function restrictionRecoverySummary(restriction) {
  return reasonCodeSummary(restrictionReasonCode(restriction));
}

function buildRestrictionRiskState(adapter, restriction, observedAt) {
  const signals = new Set(Array.isArray(restriction?.antiCrawlSignals) ? restriction.antiCrawlSignals : []);
  const reasonCode = restrictionReasonCode(restriction);
  const state = signals.has('verify') || reasonCode === 'anti-crawl-verify'
    ? 'captcha_required'
    : 'manual_recovery_required';
  return normalizeRiskTransition({
    from: 'normal',
    state,
    reasonCode,
    siteKey: adapter?.siteKey ?? adapter?.id,
    scope: 'pipeline-restriction',
    observedAt,
  });
}

function buildBlockedStageSummaries(stageSpecs, captureManifest, reason) {
  return Object.fromEntries(stageSpecs.map((stageSpec) => {
    if (stageSpec.name === 'capture') {
      return [stageSpec.name, stageSpec.summarize(captureManifest)];
    }
    return [stageSpec.name, {
      status: 'skipped',
      reason,
    }];
  }));
}

function summarizeRiskRecovery(result = null) {
  if (!result) {
    return null;
  }
  return {
    attempted: result.attempted === true,
    status: result.status ?? null,
    trigger: result.trigger ?? null,
    initialUrl: result.initialUrl ?? null,
    initialRiskPageCode: result.initialRiskPageCode ?? null,
    finalUrl: result.finalUrl ?? null,
    finalRiskPageCode: result.finalRiskPageCode ?? null,
    reasonCode: result.reasonCode ?? null,
    recovery: result.recovery ?? null,
    reusedLoginState: result.reusedLoginState === true,
    reports: result.keepaliveReport?.reports ?? null,
    warmupSummary: result.keepaliveReport?.keepalive?.warmupSummary ?? result.keepaliveReport?.loginReport?.auth?.warmupSummary ?? null,
    sessionHealthSummary: result.keepaliveReport?.keepalive?.sessionHealthSummary
      ?? result.keepaliveReport?.loginReport?.auth?.sessionHealthSummary
      ?? null,
    error: result.error ?? null,
  };
}

async function executeRiskAwareCapture(adapter, inputUrl, settings, stageSpecs, stageImpls, pipelineSiteKeepalive) {
  const captureStageSpec = stageSpecs.find((stageSpec) => stageSpec.name === 'capture');
  if (!captureStageSpec) {
    throw new Error('Missing capture stage spec.');
  }
  const captureOptions = captureStageSpec.buildOptions({
    inputUrl,
    settings,
    generatedAt: new Date().toISOString(),
    stageResults: {},
  });
  let captureManifest = await stageImpls.capture(inputUrl, captureOptions);
  const initialRestriction = extractSiteRestriction(adapter, inputUrl, captureManifest);
  if (!initialRestriction) {
    return {
      captureManifest,
      initialRestriction: null,
      finalRestriction: null,
      riskRecovery: null,
    };
  }

  if (typeof pipelineSiteKeepalive !== 'function' || settings.reuseLoginState === false) {
    return {
      captureManifest,
      initialRestriction,
      finalRestriction: initialRestriction,
      riskRecovery: {
        attempted: false,
        status: 'not-eligible',
        trigger: null,
        keepaliveReport: null,
        initialUrl: captureManifest?.finalUrl ?? inputUrl,
        initialRiskPageCode: initialRestriction.riskPageCode ?? null,
        finalUrl: captureManifest?.finalUrl ?? inputUrl,
        finalRiskPageCode: initialRestriction.riskPageCode ?? null,
        reasonCode: restrictionReasonCode(initialRestriction),
        recovery: restrictionRecoverySummary(initialRestriction),
        reusedLoginState: settings.reuseLoginState !== false,
      },
    };
  }

  let keepaliveReport = null;
  try {
    keepaliveReport = await pipelineSiteKeepalive(inputUrl, {
      profilePath: settings.profilePath,
      outDir: path.join(settings.captureOutDir, 'risk-recovery-keepalive'),
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: false,
      reuseLoginState: true,
      ...(settings.autoLogin !== undefined ? { autoLogin: settings.autoLogin } : {}),
    });
    captureManifest = await stageImpls.capture(inputUrl, {
      ...captureOptions,
      outDir: path.join(settings.captureOutDir, 'risk-recovery-recapture'),
    });
    const finalRestriction = extractSiteRestriction(adapter, inputUrl, captureManifest);
    return {
      captureManifest,
      initialRestriction,
      finalRestriction,
      riskRecovery: {
        attempted: true,
        status: finalRestriction ? 'still-blocked' : 'recovered',
        trigger: 'restriction-page',
        keepaliveReport,
        initialUrl: initialRestriction.finalUrl ?? inputUrl,
        initialRiskPageCode: initialRestriction.riskPageCode ?? null,
        finalUrl: captureManifest?.finalUrl ?? inputUrl,
        finalRiskPageCode: finalRestriction?.riskPageCode ?? null,
        reasonCode: finalRestriction ? restrictionReasonCode(finalRestriction) : null,
        recovery: finalRestriction ? restrictionRecoverySummary(finalRestriction) : null,
        reusedLoginState: true,
      },
    };
  } catch (error) {
    return {
      captureManifest,
      initialRestriction,
      finalRestriction: initialRestriction,
      riskRecovery: {
        attempted: true,
        status: 'recovery-failed',
        trigger: 'restriction-page',
        keepaliveReport,
        error: error?.message ?? String(error),
        initialUrl: initialRestriction.finalUrl ?? inputUrl,
        initialRiskPageCode: initialRestriction.riskPageCode ?? null,
        finalUrl: captureManifest?.finalUrl ?? inputUrl,
        finalRiskPageCode: initialRestriction.riskPageCode ?? null,
        reasonCode: restrictionReasonCode(initialRestriction),
        recovery: restrictionRecoverySummary(initialRestriction),
        reusedLoginState: true,
      },
    };
  }
}

export async function runPipeline(inputUrl, options = {}, runtime = DEFAULT_PIPELINE_RUNTIME) {
  const settings = normalizePipelineOptions(inputUrl, options);
  const { stageSpecs, stageImpls, preflightKeepalive, siteKeepalive: pipelineSiteKeepalive } = resolvePipelineRuntime(runtime);
  const authKeepalive = typeof preflightKeepalive === 'function'
    ? await preflightKeepalive(inputUrl, {
      profilePath: settings.profilePath,
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      timeoutMs: settings.timeoutMs,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
    }, {
      siteKeepaliveImpl: pipelineSiteKeepalive,
    })
    : {
      attempted: false,
      ran: false,
      reason: 'preflight-disabled',
      trigger: null,
      thresholdMinutes: null,
      sessionHealthSummary: null,
      sessionHealthSummaryAfter: null,
      keepaliveReport: null,
    };
  const summarizedAuthKeepalive = summarizeAuthKeepalive(authKeepalive);
  let riskRecovery = null;
  let stageResults = null;
  let generatedAt = new Date().toISOString();

  const riskAwareAdapter = resolveRiskAwareAdapter(inputUrl);
  if (riskAwareAdapter) {
    const riskAwareCapture = await executeRiskAwareCapture(
      riskAwareAdapter,
      inputUrl,
      settings,
      stageSpecs,
      stageImpls,
      pipelineSiteKeepalive,
    );
    riskRecovery = summarizeRiskRecovery(riskAwareCapture.riskRecovery);
    if (riskAwareCapture.finalRestriction?.restrictionDetected) {
      const restriction = riskAwareCapture.finalRestriction;
      const blockedReason = buildRestrictionBlockedReason(riskAwareAdapter, restriction);
      const riskState = buildRestrictionRiskState(riskAwareAdapter, restriction, generatedAt);
      return {
        inputUrl,
        generatedAt,
        kbDir: null,
        skillDir: null,
        skillName: null,
        authKeepalive: summarizedAuthKeepalive,
        riskRecovery,
        riskState,
        pipelineBlockedByRisk: true,
        antiCrawlSignals: restriction.antiCrawlSignals ?? [],
        antiCrawlReasonCode: restriction.antiCrawlReasonCode ?? null,
        riskCauseCode: restriction.riskCauseCode ?? null,
        riskAction: restriction.riskAction ?? null,
        stages: buildBlockedStageSummaries(stageSpecs, riskAwareCapture.captureManifest, blockedReason),
      };
    }

    const wrappedStageImpls = {
      ...stageImpls,
      capture: async () => riskAwareCapture.captureManifest,
    };
    ({ generatedAt, stageResults } = await executePipeline(inputUrl, settings, {
      stageSpecs,
      stageImpls: wrappedStageImpls,
      progress: options.progress,
    }));
  } else {
    ({ generatedAt, stageResults } = await executePipeline(inputUrl, settings, {
      stageSpecs,
      stageImpls,
      progress: options.progress,
    }));
  }

  return {
    inputUrl,
    generatedAt,
    kbDir: stageResults.knowledgeBase.kbDir,
    skillDir: stageResults.skill.skillDir,
    skillName: stageResults.skill.skillName,
    authKeepalive: summarizedAuthKeepalive,
    riskRecovery,
    pipelineBlockedByRisk: false,
    stages: summarizePipelineStages(stageResults),
  };
}

function toPipelineCliSummaryRedactionFailure(error) {
  const recovery = reasonCodeSummary('redaction-failed');
  const causeSummary = redactValue({
    name: error instanceof Error ? error.name : undefined,
    code: error && typeof error === 'object' ? (error.code ?? null) : null,
  }).value;
  const failure = new Error('Pipeline CLI summary redaction failed');
  failure.name = 'PipelineCliSummaryRedactionFailure';
  failure.code = 'redaction-failed';
  failure.reasonCode = 'redaction-failed';
  failure.retryable = recovery.retryable;
  failure.cooldownNeeded = recovery.cooldownNeeded;
  failure.isolationNeeded = recovery.isolationNeeded;
  failure.manualRecoveryNeeded = recovery.manualRecoveryNeeded;
  failure.degradable = recovery.degradable;
  failure.artifactWriteAllowed = recovery.artifactWriteAllowed;
  failure.catalogAction = recovery.catalogAction;
  failure.diagnosticWriteAllowed = false;
  failure.causeSummary = causeSummary;
  return failure;
}

export function pipelineCliJson(result) {
  try {
    return `${prepareRedactedArtifactJsonWithAudit(result).json}\n`;
  } catch (error) {
    throw toPipelineCliSummaryRedactionFailure(error);
  }
}

function printHelp() {
  process.stdout.write(`Usage:
  node src/entrypoints/pipeline/run-pipeline.mjs <url> [options]

Options:
  --browser-path <path>        Explicit Chromium/Chrome executable path
  --browser-profile-root <path> Root directory for persistent browser profiles
  --user-data-dir <path>       Explicit Chromium user-data-dir to reuse
  --timeout <ms>               Overall timeout for browser steps
  --wait-until <mode>          load | networkidle
  --idle-ms <ms>               Extra delay after readiness before capture
  --max-triggers <n>           Maximum discovered triggers to expand
  --max-captured-states <n>    Maximum newly captured states during expansion
  --search-query <text>        Repeatable search query seed for site search
  --examples <path>            Optional example utterance JSON file
  --capture-out-dir <dir>      Root output directory for step 1
  --expanded-out-dir <dir>     Root output directory for step 2
  --book-content-out-dir <dir> Root output directory for chapter/book content collection
  --analysis-out-dir <dir>     Root output directory for step 3
  --abstraction-out-dir <dir>  Root output directory for step 4
  --nl-entry-out-dir <dir>     Root output directory for step 5
  --docs-out-dir <dir>         Root output directory for step 6
  --governance-out-dir <dir>   Root output directory for step 7
  --kb-dir <dir>               Final knowledge base directory
  --skill-out-dir <dir>        Final skill directory
  --skill-name <name>          Override default skill name
  --strict <true|false>        Strict mode for compileKnowledgeBase
  --reuse-login-state          Reuse a persistent per-site browser profile
  --no-reuse-login-state       Disable persistent login-state reuse
  --auto-login                 Best-effort credential login when credentials exist
  --no-auto-login              Disable credential auto-login
  --headless                   Run browser headless
  --no-headless                Run browser with a visible window
  --full-page                  Force full-page screenshot (default)
  --no-full-page               Disable full-page screenshot
  --json                       Keep stdout as JSON and suppress progress
  --quiet                      Suppress human progress on stderr
  --verbose                    Show more details and full paths in human output
  --debug                      Show stack traces and raw diagnostic JSON
  --no-color                   Disable ANSI colors
  --ascii                      Disable Unicode glyphs
  --compact                    Use compact line-oriented output
  --progress <mode>            auto | interactive | plain
  --no-tty                     Force plain progress
  --force-tty                  Force interactive progress
  --help                       Show this help

Notes:
  - Douyin and Xiaohongshu default to a visible browser unless --headless is explicitly set.
`);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {};
  let url = null;

  const readValue = (current, index) => {
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) {
      return { value: current.slice(eqIndex + 1), nextIndex: index };
    }
    if (index + 1 >= args.length) {
      throw new Error(`Missing value for ${current}`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`Unexpected argument: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--browser-path': {
        const { value, nextIndex } = readValue(current, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--browser-profile-root': {
        const { value, nextIndex } = readValue(current, index);
        options.browserProfileRoot = value;
        index = nextIndex;
        break;
      }
      case '--user-data-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.userDataDir = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(current, index);
        options.timeoutMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--wait-until': {
        const { value, nextIndex } = readValue(current, index);
        options.waitUntil = value;
        index = nextIndex;
        break;
      }
      case '--idle-ms': {
        const { value, nextIndex } = readValue(current, index);
        options.idleMs = Number(value);
        index = nextIndex;
        break;
      }
      case '--max-triggers': {
        const { value, nextIndex } = readValue(current, index);
        options.maxTriggers = Number(value);
        index = nextIndex;
        break;
      }
      case '--max-captured-states': {
        const { value, nextIndex } = readValue(current, index);
        options.maxCapturedStates = Number(value);
        index = nextIndex;
        break;
      }
      case '--search-query': {
        const { value, nextIndex } = readValue(current, index);
        options.searchQueries = [...(options.searchQueries ?? []), value];
        index = nextIndex;
        break;
      }
      case '--examples': {
        const { value, nextIndex } = readValue(current, index);
        options.examplesPath = value;
        index = nextIndex;
        break;
      }
      case '--capture-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.captureOutDir = value;
        index = nextIndex;
        break;
      }
      case '--expanded-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.expandedOutDir = value;
        index = nextIndex;
        break;
      }
      case '--analysis-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.analysisOutDir = value;
        index = nextIndex;
        break;
      }
      case '--book-content-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.bookContentOutDir = value;
        index = nextIndex;
        break;
      }
      case '--abstraction-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.abstractionOutDir = value;
        index = nextIndex;
        break;
      }
      case '--nl-entry-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.nlEntryOutDir = value;
        index = nextIndex;
        break;
      }
      case '--docs-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.docsOutDir = value;
        index = nextIndex;
        break;
      }
      case '--governance-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.governanceOutDir = value;
        index = nextIndex;
        break;
      }
      case '--kb-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.kbDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.skillOutDir = value;
        index = nextIndex;
        break;
      }
      case '--skill-name': {
        const { value, nextIndex } = readValue(current, index);
        options.skillName = value;
        index = nextIndex;
        break;
      }
      case '--strict': {
        const { value, nextIndex } = readValue(current, index);
        options.strict = toBoolean(value, '--strict');
        index = nextIndex;
        break;
      }
      case '--headless':
        options.headless = true;
        break;
      case '--no-headless':
        options.headless = false;
        break;
      case '--reuse-login-state':
        options.reuseLoginState = true;
        break;
      case '--no-reuse-login-state':
        options.reuseLoginState = false;
        break;
      case '--auto-login':
        options.autoLogin = true;
        break;
      case '--no-auto-login':
        options.autoLogin = false;
        break;
      case '--full-page':
        options.fullPage = true;
        break;
      case '--no-full-page':
        options.fullPage = false;
        break;
      case '--help':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      case '--no-color':
        options.noColor = true;
        break;
      case '--ascii':
        options.ascii = true;
        break;
      case '--compact':
        options.compact = true;
        break;
      case '--progress': {
        const { value, nextIndex } = readValue(current, index);
        options.progressMode = value;
        index = nextIndex;
        break;
      }
      case '--no-tty':
        options.noTty = true;
        break;
      case '--force-tty':
        options.forceTty = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return { url, options };
}

async function runCli() {
  initializeCliUtf8();
  const { url, options } = parseCliArgs(process.argv.slice(2));
  if (options.help || !url) {
    printHelp();
    if (!options.help && !url) {
      process.exitCode = 1;
    }
    return;
  }

  const startedAt = Date.now();
  const progress = createBuildProgressController({
    inputUrl: url,
    stageSpecs: PIPELINE_STAGE_SPECS,
    options,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  let result;
  try {
    result = await runPipeline(url, { ...options, progress });
    if (result.pipelineBlockedByRisk) {
      progress.fail(new Error(result.antiCrawlReasonCode ?? result.riskCauseCode ?? 'verification or access-control page'));
    } else {
      await progress.complete(result);
    }
  } catch (error) {
    progress.fail(error);
    if (options.debug && error?.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    throw error;
  }
  if (options.json) {
    process.stdout.write(pipelineCliJson(result));
    return;
  }
  if (options.quiet) {
    process.stdout.write(`Skill: ${result.skillDir}\n`);
    return;
  }
  process.stdout.write(renderBuildSummary(result, {
    ...options,
    durationMs: Date.now() - startedAt,
    columns: process.stdout.columns,
  }));
  if (options.debug) {
    process.stdout.write('\nDebug JSON\n\n');
    process.stdout.write(pipelineCliJson(result));
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
