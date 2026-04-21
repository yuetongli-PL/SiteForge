function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientLockError(error) {
  const message = error?.message ? String(error.message) : String(error);
  return /EBUSY|resource busy or locked|lockfile/i.test(message);
}

export async function runStage(stageName, action) {
  try {
    return await action();
  } catch (error) {
    const message = error?.message ? String(error.message) : String(error);
    throw new Error(`[${stageName}] ${message}`);
  }
}

export async function runStageWithRetry(stageName, action, { attempts = 2, retryDelayMs = 1_500 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runStage(stageName, action);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientLockError(error)) {
        throw error;
      }
      await delay(retryDelayMs);
    }
  }
  throw lastError;
}

export const DEFAULT_STAGE_RUNNERS = {
  default: (stageName, action) => runStage(stageName, action),
  retry: (stageName, action) => runStageWithRetry(stageName, action),
};
