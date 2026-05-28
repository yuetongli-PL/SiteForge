// @ts-check

import { createProgressRenderer } from './progress.mjs';
import { readCliValue } from './parse-values.mjs';

const PROGRESS_OPTION_KEYS = new Set([
  'json',
  'quiet',
  'progressMode',
  'forceTty',
  'noTty',
]);

export function readCliFlagValue(args, current, index) {
  return readCliValue(args, current, index);
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
      const { value, nextIndex } = readCliValue(args, current, index);
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

export function stripProgressCliOptions(options = /** @type {any} */ ({})) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !PROGRESS_OPTION_KEYS.has(key)),
  );
}

export function createCliProgressRenderer(options = /** @type {any} */ ({})) {
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

function defaultStageTitle({ stageId, taskId, title }) {
  return String(stageId ?? taskId ?? title ?? 'stage');
}

/**
 * @param {any} config
 */
export async function runSingleStageCliWithProgress({
  inputUrl,
  options = /** @type {any} */ ({}),
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
  const resolvedStageTitle = stageTitle ?? defaultStageTitle({ stageId, taskId, title });
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
