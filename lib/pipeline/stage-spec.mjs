import { maybeLoadValidatedProfileForUrl } from '../sites/profiles.mjs';

function summarizeCapture(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    finalUrl: manifest.finalUrl,
    title: manifest.title,
    capturedAt: manifest.capturedAt,
  };
}

function summarizeExpanded(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    discoveredTriggers: manifest.summary?.discoveredTriggers ?? 0,
    attemptedTriggers: manifest.summary?.attemptedTriggers ?? 0,
    capturedStates: manifest.summary?.capturedStates ?? 0,
    duplicateStates: manifest.summary?.duplicateStates ?? 0,
    noopTriggers: manifest.summary?.noopTriggers ?? 0,
    failedTriggers: manifest.summary?.failedTriggers ?? 0,
  };
}

function summarizeManifestStage(manifest) {
  return {
    status: 'success',
    outDir: manifest.outDir,
    summary: manifest.summary ?? {},
  };
}

function summarizeBookContent(manifest) {
  if (manifest?.status === 'skipped') {
    return {
      status: 'skipped',
      outDir: null,
      summary: {},
      negativeQueries: [],
      reason: manifest.reason ?? null,
    };
  }
  return {
    status: 'success',
    outDir: manifest.outDir,
    summary: manifest.summary ?? {},
    negativeQueries: manifest.negativeQueries ?? [],
  };
}

async function shouldCollectBookContent({ inputUrl }) {
  const validatedProfile = await maybeLoadValidatedProfileForUrl(inputUrl);
  return validatedProfile?.profile?.pipeline?.skipBookContent !== true;
}

function buildSkippedBookContentResult() {
  return {
    status: 'skipped',
    outDir: null,
    summary: {},
    negativeQueries: [],
    reason: 'Skipped by site profile pipeline.skipBookContent.',
  };
}

function summarizeGovernance(result) {
  return {
    status: 'success',
    outDir: result.outDir,
    summary: result.summary ?? {},
  };
}

function summarizeKnowledgeBase(result) {
  return {
    status: 'success',
    kbDir: result.kbDir,
    pages: result.pages,
    lintSummary: result.lintSummary,
    gapGroups: result.gapGroups,
  };
}

function summarizeSkill(result) {
  return {
    status: 'success',
    skillDir: result.skillDir,
    skillName: result.skillName,
    references: result.references,
    warnings: result.warnings,
  };
}

export const PIPELINE_STAGE_SPECS = [
  {
    name: 'capture',
    implKey: 'capture',
    deps: [],
    runner: 'retry',
    validator: 'captureSucceeded',
    buildOptions: ({ settings }) => ({
      outDir: settings.captureOutDir,
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
      timeoutMs: settings.timeoutMs,
      waitUntil: settings.waitUntil,
      idleMs: settings.idleMs,
      fullPage: settings.fullPage,
      viewport: settings.viewport,
      userAgent: settings.userAgent,
    }),
    summarize: summarizeCapture,
  },
  {
    name: 'expanded',
    implKey: 'expandStates',
    deps: ['capture'],
    runner: 'retry',
    buildOptions: ({ settings, stageResults }) => ({
      initialManifestPath: stageResults.capture.files.manifest,
      outDir: settings.expandedOutDir,
      browserPath: settings.browserPath,
      browserProfileRoot: settings.browserProfileRoot,
      userDataDir: settings.userDataDir,
      headless: settings.headless,
      reuseLoginState: settings.reuseLoginState,
      autoLogin: settings.autoLogin,
      timeoutMs: settings.timeoutMs,
      waitUntil: settings.waitUntil,
      idleMs: settings.idleMs,
      fullPage: settings.fullPage,
      viewport: settings.viewport,
      userAgent: settings.userAgent,
      maxTriggers: settings.maxTriggers,
      maxCapturedStates: settings.maxCapturedStates,
      searchQueries: settings.searchQueries,
    }),
    summarize: summarizeExpanded,
  },
  {
    name: 'bookContent',
    implKey: 'collectBookContent',
    deps: ['expanded'],
    runner: 'default',
    shouldRun: shouldCollectBookContent,
    skipResult: buildSkippedBookContentResult,
    buildOptions: ({ settings, stageResults }) => ({
      expandedStatesDir: stageResults.expanded.outDir,
      outDir: settings.bookContentOutDir,
      searchQueries: settings.searchQueries,
    }),
    summarize: summarizeBookContent,
  },
  {
    name: 'analysis',
    implKey: 'analyzeStates',
    deps: ['expanded', 'bookContent'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      expandedStatesDir: stageResults.expanded.outDir,
      bookContentDir: stageResults.bookContent.outDir ?? undefined,
      outDir: settings.analysisOutDir,
    }),
    summarize: summarizeManifestStage,
  },
  {
    name: 'abstraction',
    implKey: 'abstractInteractions',
    deps: ['analysis', 'expanded'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      analysisDir: stageResults.analysis.outDir,
      expandedStatesDir: stageResults.expanded.outDir,
      outDir: settings.abstractionOutDir,
    }),
    summarize: summarizeManifestStage,
  },
  {
    name: 'nlEntry',
    implKey: 'buildNlEntry',
    deps: ['abstraction', 'analysis'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      abstractionDir: stageResults.abstraction.outDir,
      analysisDir: stageResults.analysis.outDir,
      examplesPath: settings.examplesPath,
      outDir: settings.nlEntryOutDir,
    }),
    summarize: summarizeManifestStage,
  },
  {
    name: 'docs',
    implKey: 'generateDocs',
    deps: ['nlEntry', 'abstraction', 'analysis', 'expanded'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      nlEntryDir: stageResults.nlEntry.outDir,
      abstractionDir: stageResults.abstraction.outDir,
      analysisDir: stageResults.analysis.outDir,
      expandedStatesDir: stageResults.expanded.outDir,
      outDir: settings.docsOutDir,
    }),
    summarize: summarizeManifestStage,
  },
  {
    name: 'governance',
    implKey: 'buildGovernance',
    deps: ['docs', 'nlEntry', 'abstraction', 'analysis', 'expanded'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      docsDir: stageResults.docs.outDir,
      nlEntryDir: stageResults.nlEntry.outDir,
      abstractionDir: stageResults.abstraction.outDir,
      analysisDir: stageResults.analysis.outDir,
      expandedStatesDir: stageResults.expanded.outDir,
      outDir: settings.governanceOutDir,
    }),
    summarize: summarizeGovernance,
  },
  {
    name: 'knowledgeBase',
    implKey: 'compileKnowledgeBase',
    deps: ['capture', 'expanded', 'bookContent', 'analysis', 'abstraction', 'nlEntry', 'docs', 'governance'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      captureDir: stageResults.capture.outDir,
      expandedStatesDir: stageResults.expanded.outDir,
      bookContentDir: stageResults.bookContent.outDir ?? undefined,
      skipBookContent: stageResults.bookContent.status === 'skipped',
      analysisDir: stageResults.analysis.outDir,
      abstractionDir: stageResults.abstraction.outDir,
      nlEntryDir: stageResults.nlEntry.outDir,
      docsDir: stageResults.docs.outDir,
      governanceDir: stageResults.governance.outDir,
      kbDir: settings.kbDir,
      strict: settings.strict,
    }),
    summarize: summarizeKnowledgeBase,
  },
  {
    name: 'skill',
    implKey: 'generateSkill',
    deps: ['knowledgeBase'],
    runner: 'default',
    buildOptions: ({ settings, stageResults }) => ({
      kbDir: stageResults.knowledgeBase.kbDir,
      outDir: settings.skillOutDir,
      skillName: settings.skillName,
    }),
    summarize: summarizeSkill,
  },
];

export function summarizePipelineStages(stageResults) {
  return Object.fromEntries(
    PIPELINE_STAGE_SPECS.map((stageSpec) => [stageSpec.name, stageSpec.summarize(stageResults[stageSpec.name])]),
  );
}
