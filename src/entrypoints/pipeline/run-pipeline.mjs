import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  promptForCapabilityInteraction,
  renderSiteForgeBuildSummary,
  runSiteForgeBuild,
  siteForgeReportModeSet,
  siteForgeBuildCliJson,
} from '../../app/pipeline/build/index.mjs';
import { prepareSiteForgeBuildSetup } from '../../app/pipeline/build/setup-assistant.mjs';
import {
  parseIntegerOption,
  readCliValue,
} from '../../infra/cli/parse-values.mjs';
import { sanitizePublicUrl } from '../../shared/url-safety.mjs';

const SITEFORGE_PRIVACY_MODES = new Set(['limited', 'strict']);
const SITEFORGE_REPORT_MODES = siteForgeReportModeSet();
const SITEFORGE_PROGRESS_MODES = new Set(['auto', 'interactive', 'plain']);

function buildSiteForgeCliFailureResult(inputUrl, error) {
  const report = error?.buildReport && typeof error.buildReport === 'object'
    ? error.buildReport
    : {};
  return {
    ...report,
    inputUrl: report.inputUrl ?? sanitizePublicUrl(inputUrl, { fallback: '<url>', keepPath: true }),
    status: report.status ?? 'failed',
    result_status: report.result_status ?? 'failed',
    legacy_status: report.legacy_status ?? report.status ?? 'failed',
    siteId: report.siteId ?? null,
    buildId: report.buildId ?? null,
    skillId: report.skillId ?? null,
    skillDir: report.skillDir ?? null,
    artifactDir: report.artifactDir ?? error?.artifactDir ?? null,
    failedStage: report.failedStage ?? error?.stage ?? null,
    reasonCode: report.reasonCode ?? error?.reasonCode ?? error?.code ?? 'build-failed',
    reason: report.reason ?? null,
    warningCodes: report.warningCodes ?? [],
    warnings: report.warnings ?? [],
    summary: report.summary ?? {
      seeds: 0,
      nodes: 0,
      affordances: 0,
      capabilities: {
        active: 0,
        candidate: 0,
        discarded: 0,
      },
      activeCapabilities: 0,
      intents: 0,
      verificationStatus: null,
      registryStatus: null,
    },
    collectionOutcomes: report.collectionOutcomes ?? {
      unsuccessful: [],
      total: 0,
      truncated: false,
      limit: 0,
    },
    artifacts: {
      ...(report.artifacts ?? {}),
      'build_report.json': report.artifacts?.['build_report.json'] ?? error?.buildReportPath ?? null,
    },
    setupAssistant: {
      ...(report.setupAssistant ?? {}),
      setupPlan: report.setupAssistant?.setupPlan ?? error?.setupPlanPath ?? null,
      userChoices: report.setupAssistant?.userChoices ?? error?.userChoicesPath ?? null,
      capabilityHints: report.setupAssistant?.capabilityHints ?? error?.capabilityHintsPath ?? null,
      profile: report.setupAssistant?.profile ?? error?.buildProfilePath ?? null,
      savedProfile: report.setupAssistant?.savedProfile ?? error?.savedBuildProfilePath ?? null,
    },
  };
}

function normalizeChoice(value, allowed, flagName) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error(`${flagName} must be one of: ${[...allowed].join(', ')}`);
  }
  return normalized;
}

function normalizePositiveInteger(value, flagName) {
  return parseIntegerOption(value, flagName, { min: 1 });
}

function applySiteForgeCliDefaults(options) {
  const next = { ...options };
  if (next.manual === true) {
    next.auto = false;
    next.setupInteractive = true;
    next.disableManualCapabilityProofPrompt = false;
    next.manualSupplementalCollection = true;
  } else {
    next.auto = true;
    const canInteract = process.stdin.isTTY === true
      && process.stdout.isTTY === true
      && next.noTty !== true
      && next.json !== true
      && next.quiet !== true;
    next.setupInteractive = canInteract;
    next.interactive = canInteract;
    next.disableManualCapabilityProofPrompt = true;
  }
  next.privacyMode = normalizeChoice(next.privacyMode ?? 'limited', SITEFORGE_PRIVACY_MODES, '--privacy');
  if (next.deep === true) {
    next.maxDepth = next.maxDepth ?? 3;
    next.maxPages = next.maxPages ?? 100;
    next.maxSeeds = next.maxSeeds ?? 200;
    next.renderJs = next.renderJs ?? true;
  }
  if (next.network === true) {
    next.captureNetwork = true;
  }
  if (!next.reportMode) {
    next.reportMode = next.debug || next.verbose ? 'debug' : 'user';
  }
  next.reportMode = normalizeChoice(next.reportMode, SITEFORGE_REPORT_MODES, '--report');
  next.webInteraction = false;
  return next;
}

async function closeSiteForgeWebInteraction(options = /** @type {any} */ ({})) {
  const session = options.webInteractionSession;
  delete options.webInteractionSession;
  if (typeof session?.close === 'function') {
    await session.close();
  }
}

function readValue(args, current, index, options = /** @type {any} */ ({})) {
  return readCliValue(args, current, index, options);
}

function rejectRetiredNumericFlag(args, current, index, parseOptions = /** @type {any} */ ({})) {
  const { value, nextIndex } = readValue(args, current, index);
  const flagName = current.split('=')[0];
  parseIntegerOption(value, flagName, parseOptions);
  throw new Error(`${flagName} is retired with the legacy pipeline chain; use siteforge build <url> options instead.`);
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = /** @type {any} */ ({});
  let url = null;

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith('--')) {
      if (url !== null) {
        throw new Error(`未知参数: ${current}`);
      }
      url = current;
      continue;
    }

    switch (current.split('=')[0]) {
      case '--browser-path': {
        const { value, nextIndex } = readValue(args, current, index);
        options.browserPath = value;
        index = nextIndex;
        break;
      }
      case '--timeout': {
        const { value, nextIndex } = readValue(args, current, index);
        options.timeoutMs = normalizePositiveInteger(value, '--timeout');
        index = nextIndex;
        break;
      }
      case '--max-depth': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxDepth = normalizePositiveInteger(value, '--max-depth');
        index = nextIndex;
        break;
      }
      case '--max-pages': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxPages = normalizePositiveInteger(value, '--max-pages');
        index = nextIndex;
        break;
      }
      case '--max-seeds': {
        const { value, nextIndex } = readValue(args, current, index);
        options.maxSeeds = normalizePositiveInteger(value, '--max-seeds');
        index = nextIndex;
        break;
      }
      case '--idle-ms': {
        rejectRetiredNumericFlag(args, current, index, { min: 0 });
        break;
      }
      case '--max-triggers': {
        rejectRetiredNumericFlag(args, current, index, { min: 0 });
        break;
      }
      case '--max-captured-states': {
        rejectRetiredNumericFlag(args, current, index, { min: 1 });
        break;
      }
      case '--chapter-fetch-concurrency': {
        rejectRetiredNumericFlag(args, current, index, { min: 1 });
        break;
      }
      case '--auto':
        options.auto = true;
        options.manual = false;
        options.setupInteractive = false;
        break;
      case '--manual':
        options.manual = true;
        options.auto = false;
        options.setupInteractive = true;
        break;
      case '--deep':
        options.deep = true;
        break;
      case '--network':
        options.network = true;
        options.captureNetwork = true;
        break;
      case '--render-js':
        options.renderJs = true;
        break;
      case '--no-render-js':
        options.renderJs = false;
        break;
      case '--privacy': {
        const { value, nextIndex } = readValue(args, current, index);
        options.privacyMode = normalizeChoice(value, SITEFORGE_PRIVACY_MODES, '--privacy');
        index = nextIndex;
        break;
      }
      case '--explain':
        options.explain = true;
        break;
      case '--report': {
        const { value, nextIndex } = readValue(args, current, index);
        options.reportMode = normalizeChoice(value, SITEFORGE_REPORT_MODES, '--report');
        index = nextIndex;
        break;
      }
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
        const { value, nextIndex } = readValue(args, current, index);
        options.progressMode = normalizeChoice(value, SITEFORGE_PROGRESS_MODES, '--progress');
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
        throw new Error(`未知参数: ${current}`);
    }
  }

  return { url, options: applySiteForgeCliDefaults(options) };
}

function printHelp() {
  process.stdout.write(`用法:
  node src/entrypoints/pipeline/run-pipeline.mjs <url> [build options]

公开命令:
  siteforge build <url>

选项:
  --auto                       Non-interactive build mode (default)
  --manual                     Enable interactive setup and supplemental collection
  --deep                       Request broader/deeper discovery
  --network                    Save a sanitized network summary only
  --privacy <mode>             limited | strict
  --explain                    Include explanatory user-facing output
  --report <mode>              user | debug | both
  --browser-path <path>        指定 Chromium/Chrome 可执行文件路径
  --timeout <ms>               浏览器授权步骤超时时间
  --max-depth <n>              Discovery depth for deep builds
  --max-pages <n>              Maximum pages for deep builds
  --max-seeds <n>              Maximum seeds for deep builds
  --render-js                  Enable rendered-page discovery
  --no-render-js               Disable rendered-page discovery
  --json                       stdout 保持 JSON，并关闭进度输出
  --quiet                      抑制 stderr 的人类可读进度
  --verbose                    显示更多细节和完整路径
  --debug                      显示堆栈和原始诊断 JSON
  --no-color                   禁用 ANSI 颜色
  --ascii                      禁用 Unicode 符号
  --compact                    使用紧凑单行输出
  --progress <mode>            auto | interactive | plain
  --no-tty                     强制普通进度输出
  --force-tty                  强制交互式进度输出
  --help                       显示帮助
`);
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
  let result;
  let setup;
  try {
    setup = await prepareSiteForgeBuildSetup(url, options);
    result = await runSiteForgeBuild(url, setup.buildOptions);
    result.setupAssistant = {
      status: setup.status,
      profile: setup.paths.buildProfilePath,
      savedProfile: setup.paths.savedBuildProfilePath,
      setupPlan: setup.paths.setupPlanPath,
      userChoices: setup.paths.userChoicesPath,
      capabilityHints: setup.paths.capabilityHintsPath,
    };
  } catch (error) {
    await closeSiteForgeWebInteraction(options);
    const failureResult = buildSiteForgeCliFailureResult(url, error);
    const renderOptions = {
      ...options,
      durationMs: Date.now() - startedAt,
      columns: process.stdout.columns,
      cwd: process.cwd(),
    };
    if (options.json) {
      process.stdout.write(siteForgeBuildCliJson(failureResult, options));
    } else if (options.quiet) {
      process.stdout.write('Skill：-\n');
    } else {
      process.stdout.write(renderSiteForgeBuildSummary(failureResult, renderOptions));
      if (options.debug) {
        process.stdout.write('\n调试报告已写入构建目录；如需机器可读输出，请使用 --json --report debug。\n');
      }
    }
    if (options.debug && error?.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    await closeSiteForgeWebInteraction(options);
    process.stdout.write(siteForgeBuildCliJson(result, options));
    return;
  }
  if (options.quiet) {
    await closeSiteForgeWebInteraction(options);
    process.stdout.write(`Skill：${result.skillDir}\n`);
    return;
  }
  const interactionOptions = {
    ...options,
    input: process.stdin,
    output: process.stdout,
    cwd: process.cwd(),
    siteDir: result.buildContext?.siteDir,
  };
  const handledByInteractiveTree = options.interactive === true
    && options.debug !== true
    && options.verbose !== true
    && options.manual !== true
    ? await promptForCapabilityInteraction(result, interactionOptions)
    : null;
  if (handledByInteractiveTree) {
    await closeSiteForgeWebInteraction(interactionOptions);
    return;
  }
  process.stdout.write(renderSiteForgeBuildSummary(result, {
    ...options,
    durationMs: Date.now() - startedAt,
    columns: process.stdout.columns,
    cwd: process.cwd(),
  }));
  const followupInteractionOptions = {
    ...interactionOptions,
    treeUi: false,
  };
  await promptForCapabilityInteraction(result, followupInteractionOptions);
  await closeSiteForgeWebInteraction(followupInteractionOptions);
  if (options.debug) {
    process.stdout.write('\n调试报告已写入构建目录；如需机器可读输出，请使用 --json --report debug。\n');
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
