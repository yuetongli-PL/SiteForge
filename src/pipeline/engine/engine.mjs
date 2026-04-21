import { DEFAULT_STAGE_RUNNERS } from './runners.mjs';
import { DEFAULT_STAGE_VALIDATORS } from './validators.mjs';

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
  },
) {
  const stageResults = {};
  const pipelineContext = {
    inputUrl,
    settings,
    generatedAt,
    stageResults,
  };

  for (const stageSpec of stageSpecs) {
    stageResults[stageSpec.name] = await executePipelineStage(
      stageSpec,
      pipelineContext,
      stageImpls,
      { stageRunners, stageValidators },
    );
  }

  return {
    inputUrl,
    generatedAt,
    settings,
    stageResults,
  };
}
