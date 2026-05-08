// @ts-check

import { createProgressRenderer } from './progress.mjs';
import { pipelineStageTitle } from './progress-copy.mjs';

const PROGRESS_OPTION_KEYS = new Set([
  'json',
  'quiet',
  'progressMode',
  'forceTty',
  'noTty',
]);

export function readCliFlagValue(args, current, index) {
  const eqIndex = current.indexOf('=');
  if (eqIndex !== -1) {
    return { value: current.slice(eqIndex + 1), nextIndex: index };
  }
  if (index + 1 >= args.length) {
    throw new Error(`Missing value for ${current}`);
  }
  return { value: args[index + 1], nextIndex: index + 1 };
}

export function parseProgressCliOption(args, current, index, options) {
  switch (current.split('=')[0]) {
    case '--json':
      options.json = true;
      return { handled: true, nextIndex: index };
    case '--quiet':
      options.quiet = true;
      return { handled: true, nextIndex: index };
    case '--progress': {
      const { value, nextIndex } = readCliFlagValue(args, current, index);
      options.progressMode = value;
      return { handled: true, nextIndex };
    }
    case '--force-tty':
      options.forceTty = true;
      return { handled: true, nextIndex: index };
    case '--no-tty':
      options.noTty = true;
      return { handled: true, nextIndex: index };
    default:
      return { handled: false, nextIndex: index };
  }
}

export function stripProgressCliOptions(options = {}) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !PROGRESS_OPTION_KEYS.has(key)),
  );
}

export function createCliProgressRenderer(options = {}) {
  return createProgressRenderer({
    stdout: process.stdout,
    stderr: process.stderr,
    mode: options.progressMode ?? 'auto',
    forceTty: options.forceTty,
    noTty: options.noTty,
    json: options.json,
    quiet: options.quiet,
  });
}

export async function runSingleStageCliWithProgress({
  inputUrl,
  options = {},
  taskId,
  title,
  stageId,
  stageTitle,
  run,
  successMessage,
  artifacts,
  isFailureResult,
  failureReason,
  warningResult,
  failureTitle,
  nextStep,
}) {
  const progress = createCliProgressRenderer(options);
  const resolvedStageTitle = stageTitle ?? pipelineStageTitle(stageId);
  const taskTitle = title ?? resolvedStageTitle;
  const task = progress.task({
    id: taskId,
    title: taskTitle,
    totalStages: 1,
    item: inputUrl,
  });
  const stage = task.stage({
    id: stageId,
    title: resolvedStageTitle,
    index: 1,
    total: 1,
    item: inputUrl,
  });

  try {
    const result = await run(stripProgressCliOptions(options), {
      progress,
      task,
      stage,
    });
    const resolvedArtifacts = typeof artifacts === 'function' ? artifacts(result) : artifacts;
    const resolvedMessage = typeof successMessage === 'function'
      ? successMessage(result)
      : successMessage;
    if (typeof isFailureResult === 'function' && isFailureResult(result)) {
      const reason = typeof failureReason === 'function'
        ? failureReason(result)
        : failureReason ?? result?.error?.message ?? 'Stage failed';
      stage.fail({ message: reason });
      task.fail({ message: reason, artifacts: resolvedArtifacts });
      progress.failure({
        taskId,
        title: failureTitle ?? `${taskTitle} failed`,
        stage: resolvedStageTitle,
        reason,
        nextStep,
      });
      return result;
    }
    const status = result?.status;
    if (status === 'skipped') {
      stage.skip({ message: resolvedMessage ?? result?.reason ?? 'Stage skipped' });
      task.skip({ message: resolvedMessage ?? result?.reason ?? 'Stage skipped', artifacts: resolvedArtifacts });
    } else if (
      status === 'warning'
      || typeof warningResult === 'function' && warningResult(result)
      || Array.isArray(result?.warnings) && result.warnings.length > 0
    ) {
      stage.warn({ message: resolvedMessage ?? 'Stage completed with warnings' });
      task.warn({ message: resolvedMessage ?? 'Stage completed with warnings', artifacts: resolvedArtifacts });
    } else {
      stage.succeed({ message: resolvedMessage ?? 'Stage completed' });
      task.succeed({ message: resolvedMessage ?? 'Stage completed', artifacts: resolvedArtifacts });
    }
    return result;
  } catch (error) {
    const reason = error?.message ?? String(error);
    stage.fail({ message: reason });
    task.fail({ message: reason });
    progress.failure({
      taskId,
      title: failureTitle ?? `${taskTitle} failed`,
      stage: resolvedStageTitle,
      reason,
      nextStep,
    });
    throw error;
  }
}
