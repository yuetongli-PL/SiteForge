import { DEFAULT_STAGE_RUNNERS } from './runners.mjs';
import { DEFAULT_STAGE_VALIDATORS } from './validators.mjs';
import { pipelineStageTitle } from '../../../infra/cli/progress-copy.mjs';

export function resolveStageImplementation(stageImpls, stageSpec) {
  const stageImpl = stageImpls[stageSpec.implKey];
  if (typeof stageImpl !== 'function') {
    throw new Error(`[${stageSpec.name}] Missing stage implementation: ${stageSpec.implKey}`);
  }
  return stageImpl;
}

function ensureStageDependencies(stageSpec, stageResults) {
  for (const dependency of stageSpec.deps ?? []) {
    if (!(dependency in stageResults)) {
      throw new Error(`[${stageSpec.name}] Missing stage dependency: ${dependency}`);
    }
  }
}

function attachPipelineStageFailure(error, {
  stageSpec,
  stageIndex,
  stageResults,
} = {}) {
  const target = error && typeof error === 'object'
    ? error
    : new Error(String(error));
  target.pipelineStage = stageSpec?.name ?? null;
  target.pipelineStageIndex = stageIndex;
  target.stageResults = { ...stageResults };
  return target;
}

export async function executePipelineStage(
  stageSpec,
  pipelineContext,
  stageImpls,
  {
    stageRunners = DEFAULT_STAGE_RUNNERS,
    stageValidators = DEFAULT_STAGE_VALIDATORS,
  } = {},
) {
  ensureStageDependencies(stageSpec, pipelineContext.stageResults);

  if (typeof stageSpec.shouldRun === 'function') {
    const shouldRun = await stageSpec.shouldRun(pipelineContext);
    if (!shouldRun) {
      return typeof stageSpec.skipResult === 'function'
        ? stageSpec.skipResult(pipelineContext)
        : { status: 'skipped' };
    }
  }

  const stageRunner = stageRunners[stageSpec.runner] ?? stageRunners.default;
  const stageValidator = stageSpec.validator ? stageValidators[stageSpec.validator] : null;
  const stageImpl = resolveStageImplementation(stageImpls, stageSpec);

  return stageRunner(stageSpec.name, async () => {
    const result = await stageImpl(
      pipelineContext.inputUrl,
      stageSpec.buildOptions(pipelineContext),
    );
    if (stageValidator) {
      stageValidator(result);
    }
    return result;
  });
}

export async function executePipeline(
  inputUrl,
  settings,
  {
    stageSpecs,
    stageImpls,
    generatedAt = new Date().toISOString(),
    stageRunners = DEFAULT_STAGE_RUNNERS,
    stageValidators = DEFAULT_STAGE_VALIDATORS,
    progress = null,
  },
) {
  const stageResults = {};
  const pipelineContext = {
    inputUrl,
    settings,
    generatedAt,
    stageResults,
  };

  for (const [index, stageSpec] of stageSpecs.entries()) {
    const stageProgress = progress?.stage?.({
      id: stageSpec.name,
      title: pipelineStageTitle(stageSpec.name),
      index: index + 1,
      total: stageSpecs.length,
      item: inputUrl,
    });
    try {
      stageResults[stageSpec.name] = await executePipelineStage(
        stageSpec,
        pipelineContext,
        stageImpls,
        { stageRunners, stageValidators },
      );
      const resultStatus = stageResults[stageSpec.name]?.status;
      const result = stageResults[stageSpec.name];
      const message = result?.outDir
        ?? result?.kbDir
        ?? result?.skillDir
        ?? 'Stage completed';
      const warningCount = Number(result?.lintSummary?.warningCount ?? 0)
        + Number(Array.isArray(result?.warnings) ? result.warnings.length : 0);
      if (resultStatus === 'skipped') {
        stageProgress?.skip?.({
          message: result?.reason ?? 'Stage skipped',
        });
      } else if (warningCount > 0) {
        stageProgress?.warn?.({
          message,
          outputDir: result?.outDir ?? result?.kbDir ?? result?.skillDir,
          summary: result?.summary ?? result?.lintSummary ?? null,
          warnings: result?.warnings ?? [],
          current: result?.pages ?? result?.summary?.documents ?? result?.summary?.analyzedStates,
          total: result?.pages ?? result?.summary?.inputStates ?? result?.summary?.documents,
        });
      } else {
        stageProgress?.succeed?.({
          message,
          outputDir: result?.outDir ?? result?.kbDir ?? result?.skillDir,
          summary: result?.summary ?? result?.lintSummary ?? null,
          current: result?.pages ?? result?.summary?.documents ?? result?.summary?.analyzedStates,
          total: result?.pages ?? result?.summary?.inputStates ?? result?.summary?.documents,
        });
      }
    } catch (error) {
      stageProgress?.fail?.({
        message: error?.message ?? String(error),
      });
      throw attachPipelineStageFailure(error, {
        stageSpec,
        stageIndex: index + 1,
        stageResults,
      });
    }
  }

  return {
    inputUrl,
    generatedAt,
    settings,
    stageResults,
  };
}
