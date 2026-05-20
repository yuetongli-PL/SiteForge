import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initializeCliUtf8 } from '../../infra/cli.mjs';
import {
  createBuildProgressController,
  renderBuildSummary,
} from '../../infra/cli/build-progress.mjs';
import { writeTextFile } from '../../infra/io.mjs';

import { executePipeline } from '../../app/pipeline/engine/engine.mjs';
import { normalizePipelineOptions, toBoolean } from '../../app/pipeline/engine/options.mjs';
import { writePartialPreviewArtifacts } from '../../app/pipeline/engine/partial-preview-artifacts.mjs';
import { isTransientNavigationError } from '../../app/pipeline/engine/runners.mjs';
import { PIPELINE_STAGE_SPECS, summarizePipelineStages } from '../../app/pipeline/engine/stage-spec.mjs';
import { DEFAULT_PIPELINE_RUNTIME, resolvePipelineRuntime } from '../../app/pipeline/runtime/create-default-runtime.mjs';
import { prepareRedactedArtifactJsonWithAudit, redactValue } from '../../domain/sessions/security-guard.mjs';
import { reasonCodeSummary } from '../../domain/risks/reason-codes.mjs';
import { normalizeRiskTransition } from '../../domain/risks/risk-state.mjs';
import { resolveSiteAdapter } from '../../sites/adapters/resolver.mjs';
import {
  promptForCapabilityInteraction,
  renderSiteForgeBuildSummary,
  runSiteForgeBuild,
  siteForgeBuildCliJson,
} from '../../app/pipeline/build/index.mjs';
import { prepareSiteForgeBuildSetup } from '../../app/pipeline/build/setup-assistant.mjs';

const PARTIAL_PREVIEW_SCHEMA_VERSION = 1;
const PARTIAL_PREVIEW_RESULT_FILE = 'partial-preview-result.json';
const PARTIAL_PREVIEW_AUDIT_FILE = 'partial-preview-result.redaction-audit.json';
const SITEFORGE_PRIVACY_MODES = new Set(['limited', 'strict']);
const SITEFORGE_REPORT_MODES = new Set(['user', 'debug', 'both']);

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

function stageStateFlags(status) {
  return {
    blocked: status === 'blocked',
    failed: status === 'failed',
    unknown: status === 'unknown',
    skipped: status === 'skipped',
  };
}

function safeErrorSummary(error) {
  return {
    name: error instanceof Error ? error.name : undefined,
    code: error && typeof error === 'object' ? (error.code ?? null) : null,
    message: error?.message ?? String(error),
    transientReason: error && typeof error === 'object' ? (error.transientReason ?? null) : null,
  };
}

function sourceCaptureRefs(captureManifest = {}) {
  return {
    status: captureManifest.status ?? 'success',
    outDir: captureManifest.outDir ?? null,
    manifestPath: captureManifest.files?.manifest ?? null,
    finalUrl: captureManifest.finalUrl ?? null,
    title: captureManifest.title ?? null,
    capturedAt: captureManifest.capturedAt ?? null,
  };
}

function classifyExpandedFailure(error) {
  const retryable = error?.retryable === true || isTransientNavigationError(error);
  const reasonCode = retryable ? 'expand-navigation-failed' : 'expand-stage-failed';
  const recovery = reasonCodeSummary(reasonCode);
  return {
    reasonCode,
    retryable: retryable || recovery.retryable,
    attempts: Number.isFinite(Number(error?.attempts)) ? Number(error.attempts) : 1,
    recovery,
  };
}

function buildPartialStageSummaries(stageSpecs, stageResults, failedStageName, failedStageSummary) {
  const summaries = {};
  let afterFailedStage = false;
  for (const stageSpec of stageSpecs) {
    if (stageSpec.name === failedStageName) {
      summaries[stageSpec.name] = failedStageSummary;
      afterFailedStage = true;
      continue;
    }
    if (!afterFailedStage && stageResults[stageSpec.name]) {
      summaries[stageSpec.name] = stageSpec.summarize(stageResults[stageSpec.name]);
      continue;
    }
    summaries[stageSpec.name] = {
      status: 'skipped',
      reason: `Skipped because ${failedStageName} did not complete.`,
      reasonCode: failedStageSummary.reasonCode,
      ...stageStateFlags('skipped'),
    };
  }
  return summaries;
}

function buildPartialPreviewPayload({
  inputUrl,
  generatedAt,
  settings,
  stageSpecs,
  stageResults,
  error,
}) {
  const failure = classifyExpandedFailure(error);
  const expandedStage = {
    stage: 'expanded',
    status: 'partial',
    outDir: settings.expandedOutDir,
    reasonCode: failure.reasonCode,
    retryable: failure.retryable,
    attempts: failure.attempts,
    recovery: failure.recovery,
    error: safeErrorSummary(error),
    ...stageStateFlags('failed'),
  };
  const stages = buildPartialStageSummaries(stageSpecs, stageResults, 'expanded', expandedStage);
  const downstreamGaps = stageSpecs
    .filter((stageSpec) => !['capture', 'expanded'].includes(stageSpec.name))
    .map((stageSpec) => ({
      stage: stageSpec.name,
      status: 'skipped',
      reasonCode: failure.reasonCode,
      reason: 'Expanded-state evidence is partial after final expand failure.',
      ...stageStateFlags('skipped'),
    }));

  return {
    schemaVersion: PARTIAL_PREVIEW_SCHEMA_VERSION,
    artifactFamily: 'pipeline-partial-preview-result',
    inputUrl,
    generatedAt,
    status: 'partial',
    failedStage: 'expanded',
    reasonCode: failure.reasonCode,
    retryable: failure.retryable,
    attempts: failure.attempts,
    redactionRequired: true,
    noBypassAttempted: true,
    loginStateReuse: settings.reuseLoginState === false ? 'disabled' : 'not-recorded',
    sourceCaptureRefs: sourceCaptureRefs(stageResults.capture),
    stage: {
      stage: 'expanded',
      status: 'failed',
      reasonCode: failure.reasonCode,
      retryable: failure.retryable,
      attempts: failure.attempts,
      ...stageStateFlags('failed'),
    },
    stages,
    gaps: [
      {
        stage: 'expanded',
        status: 'failed',
        reasonCode: failure.reasonCode,
        retryable: failure.retryable,
        attempts: failure.attempts,
        ...stageStateFlags('failed'),
      },
      ...downstreamGaps,
    ],
  };
}

async function writePartialPreviewResult(payload, settings) {
  const artifactPath = path.join(settings.expandedOutDir, PARTIAL_PREVIEW_RESULT_FILE);
  const redactionAuditPath = path.join(settings.expandedOutDir, PARTIAL_PREVIEW_AUDIT_FILE);
  const prepared = prepareRedactedArtifactJsonWithAudit(payload);
  await writeTextFile(artifactPath, prepared.json);
  await writeTextFile(redactionAuditPath, prepared.auditJson);
  return {
    artifactPath,
    redactionAuditPath,
    result: prepared.value,
    redactionAudit: prepared.auditValue,
  };
}

async function maybeBuildPartialPreviewResult({
  error,
  inputUrl,
  generatedAt,
  settings,
  stageSpecs,
  authKeepalive,
  riskRecovery,
}) {
  if (error?.pipelineStage !== 'expanded' || !error?.stageResults?.capture) {
    return null;
  }
  const payload = buildPartialPreviewPayload({
    inputUrl,
    generatedAt,
    settings,
    stageSpecs,
    stageResults: error.stageResults,
    error,
  });
  const partialPreview = await writePartialPreviewResult(payload, settings);
  const partialArtifacts = await writePartialPreviewArtifacts({
    inputUrl,
    generatedAt,
    settings,
    partialPreviewResult: partialPreview.result,
  });
  const stages = {
    ...partialPreview.result.stages,
    knowledgeBase: {
      status: 'partial',
      kbDir: partialArtifacts.knowledgeBase.kbDir,
      resultPath: partialArtifacts.knowledgeBase.resultPath,
      redactionAuditPath: partialArtifacts.knowledgeBase.resultRedactionAuditPath,
      reasonCode: partialPreview.result.reasonCode,
      redactionRequired: true,
      failedStage: 'expanded',
      requestedKbDir: partialArtifacts.knowledgeBase.requestedKbDir,
      repoLocalKnowledgeBaseWriteSkipped: partialArtifacts.knowledgeBase.repoLocalKnowledgeBaseWriteSkipped,
      repoLocalKnowledgeBaseWriteSkippedReason: partialArtifacts.knowledgeBase.repoLocalKnowledgeBaseWriteSkippedReason,
    },
    skill: {
      status: 'partial',
      skillDir: partialArtifacts.skill.skillDir,
      skillName: partialArtifacts.skill.skillName,
      references: partialArtifacts.skill.references,
      warnings: partialArtifacts.skill.warnings,
      resultPath: partialArtifacts.skill.resultPath,
      redactionAuditPath: partialArtifacts.skill.resultRedactionAuditPath,
      reasonCode: partialPreview.result.reasonCode,
      redactionRequired: true,
      repoLocalSkillUpdated: false,
      failedStage: 'expanded',
    },
  };
  return {
    inputUrl,
    generatedAt,
    kbDir: partialArtifacts.knowledgeBase.kbDir,
    skillDir: partialArtifacts.skill.skillDir,
    skillName: settings.skillName,
    authKeepalive,
    riskRecovery,
    pipelineBlockedByRisk: false,
    pipelinePartial: true,
    partialPreview,
    partialKnowledgeBase: partialArtifacts.knowledgeBase,
    partialSkill: partialArtifacts.skill,
    stages,
  };
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
    try {
      ({ generatedAt, stageResults } = await executePipeline(inputUrl, settings, {
        stageSpecs,
        stageImpls: wrappedStageImpls,
        generatedAt,
        progress: options.progress,
      }));
    } catch (error) {
      const partialResult = await maybeBuildPartialPreviewResult({
        error,
        inputUrl,
        generatedAt,
        settings,
        stageSpecs,
        authKeepalive: summarizedAuthKeepalive,
        riskRecovery,
      });
      if (partialResult) {
        return partialResult;
      }
      throw error;
    }
  } else {
    try {
      ({ generatedAt, stageResults } = await executePipeline(inputUrl, settings, {
        stageSpecs,
        stageImpls,
        generatedAt,
        progress: options.progress,
      }));
    } catch (error) {
      const partialResult = await maybeBuildPartialPreviewResult({
        error,
        inputUrl,
        generatedAt,
        settings,
        stageSpecs,
        authKeepalive: summarizedAuthKeepalive,
        riskRecovery,
      });
      if (partialResult) {
        return partialResult;
      }
      throw error;
    }
  }

  return {
    inputUrl,
    generatedAt,
    kbDir: stageResults.knowledgeBase.kbDir,
    skillDir: stageResults.skill.skillDir,
    skillName: stageResults.skill.skillName,
    compileSummaryPath: stageResults.capabilityCompile.compileSummaryPath,
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
  process.stdout.write(`用法:
  node src/entrypoints/pipeline/run-pipeline.mjs <url> [internal options]

公开命令:
  siteforge build <url>

选项:
  --browser-path <path>        指定 Chromium/Chrome 可执行文件路径
  --browser-profile-root <path> 持久浏览器 profile 根目录
  --user-data-dir <path>       指定要复用的 Chromium user-data-dir
  --timeout <ms>               浏览器步骤整体超时时间
  --wait-until <mode>          load | networkidle
  --idle-ms <ms>               页面就绪后额外等待时间
  --max-triggers <n>           最多展开的触发器数量
  --max-captured-states <n>    展开期间最多新采集状态数
  --search-query <text>        可重复的网站搜索种子
  --book-title <title>         章节/书籍内容采集的目标书名
  --book-url <url>             章节/书籍内容采集的目标 URL
  --skip-fallback              不采集展开状态的兜底书籍
  --chapter-fetch-concurrency <n> 公开章节并发抓取数
  --examples <path>            可选示例表达 JSON 文件
  --capture-out-dir <dir>      第 1 步输出根目录
  --expanded-out-dir <dir>     第 2 步输出根目录
  --book-content-out-dir <dir> 章节/书籍内容输出根目录
  --analysis-out-dir <dir>     第 3 步输出根目录
  --abstraction-out-dir <dir>  第 4 步输出根目录
  --nl-entry-out-dir <dir>     第 5 步输出根目录
  --docs-out-dir <dir>         第 6 步输出根目录
  --governance-out-dir <dir>   第 7 步输出根目录
  --capability-compile-out-dir <dir> Graph/Planner 编译产物输出目录
  --capability-intent <intent> Graph/Planner 编译时优先处理的意图
  --capability <name>          可重复的优先能力
  --capabilities <csv>         逗号分隔的优先能力
  --kb-dir <dir>               最终知识库目录
  --skill-out-dir <dir>        最终 Skill 目录
  --skill-name <name>          覆盖默认 Skill 名称
  --metadata-config-dir <dir>  将生成的站点元数据写入该配置沙盒
  --metadata-runtime-dir <dir> 将运行时站点元数据写入该沙盒
  --strict <true|false>        compileKnowledgeBase 严格模式
  --reuse-login-state          复用持久化的站点浏览器 profile
  --no-reuse-login-state       禁用登录态复用
  --auto-login                 存在凭据时尝试最佳努力登录
  --no-auto-login              禁用自动登录
  --headless                   使用无头浏览器
  --no-headless                使用可见浏览器窗口
  --full-page                  强制整页截图（默认）
  --no-full-page               禁用整页截图
  --json                       stdout 保持 JSON，并关闭进度输出
  --quiet                      抑制 stderr 的人类可读进度
  --verbose                    显示更多细节和完整路径
  --debug                      显示堆栈和原始诊断 JSON
  --auto                       Non-interactive build mode (default)
  --manual                     Enable legacy step-by-step supplemental collection
  --deep                       Request broader/deeper discovery
  --network                    Save a sanitized network summary only
  --privacy <mode>             limited | strict
  --explain                    Include explanatory user-facing output
  --report <mode>              user | debug | both
  --no-color                   禁用 ANSI 颜色
  --ascii                      禁用 Unicode 符号
  --compact                    使用紧凑单行输出
  --progress <mode>            auto | interactive | plain
  --no-tty                     强制普通进度输出
  --force-tty                  强制交互式进度输出
  --help                       显示帮助

说明:
  - 除非显式设置 --headless，抖音和小红书默认使用可见浏览器。
`);
}

function safeBuildInputUrl(value) {
  try {
    const parsed = new URL(String(value));
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    if (!parsed.pathname) {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return '<url>';
  }
}

function buildSiteForgeCliFailureResult(inputUrl, error) {
  const report = error?.buildReport && typeof error.buildReport === 'object'
    ? error.buildReport
    : {};
  return {
    ...report,
    inputUrl: report.inputUrl ?? safeBuildInputUrl(inputUrl),
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

async function closeSiteForgeWebInteraction(options = {}) {
  delete options.webInteractionSession;
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
      throw new Error(`缺少 ${current} 的取值`);
    }
    return { value: args[index + 1], nextIndex: index + 1 };
  };

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
      case '--book-title': {
        const { value, nextIndex } = readValue(current, index);
        options.targetBookTitle = value;
        index = nextIndex;
        break;
      }
      case '--book-url': {
        const { value, nextIndex } = readValue(current, index);
        options.targetBookUrl = value;
        index = nextIndex;
        break;
      }
      case '--skip-fallback':
        options.skipFallback = true;
        break;
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
      case '--privacy': {
        const { value, nextIndex } = readValue(current, index);
        options.privacyMode = normalizeChoice(value, SITEFORGE_PRIVACY_MODES, '--privacy');
        index = nextIndex;
        break;
      }
      case '--explain':
        options.explain = true;
        break;
      case '--report': {
        const { value, nextIndex } = readValue(current, index);
        options.reportMode = normalizeChoice(value, SITEFORGE_REPORT_MODES, '--report');
        index = nextIndex;
        break;
      }
      case '--chapter-fetch-concurrency': {
        const { value, nextIndex } = readValue(current, index);
        options.chapterFetchConcurrency = Number(value);
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
      case '--capability-compile-out-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.capabilityCompileOutDir = value;
        index = nextIndex;
        break;
      }
      case '--capability-intent': {
        const { value, nextIndex } = readValue(current, index);
        options.capabilityCompileIntent = value;
        index = nextIndex;
        break;
      }
      case '--capability': {
        const { value, nextIndex } = readValue(current, index);
        options.requestedCapabilities = [...(options.requestedCapabilities ?? []), value];
        index = nextIndex;
        break;
      }
      case '--capabilities': {
        const { value, nextIndex } = readValue(current, index);
        options.requestedCapabilities = [
          ...(options.requestedCapabilities ?? []),
          ...value.split(',').map((entry) => entry.trim()).filter(Boolean),
        ];
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
      case '--metadata-config-dir':
      case '--site-metadata-config-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.siteMetadataOptions = {
          ...(options.siteMetadataOptions ?? {}),
          configDir: value,
        };
        index = nextIndex;
        break;
      }
      case '--metadata-runtime-dir':
      case '--site-metadata-runtime-dir': {
        const { value, nextIndex } = readValue(current, index);
        options.siteMetadataOptions = {
          ...(options.siteMetadataOptions ?? {}),
          runtimeDir: value,
        };
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
        throw new Error(`未知参数: ${current}`);
    }
  }

  return { url, options: applySiteForgeCliDefaults(options) };
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
