function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientLockError(error) {
  const message = error?.message ? String(error.message) : String(error);
  return /EBUSY|resource busy or locked|lockfile/i.test(message);
}

export function isTransientNavigationError(error) {
  const message = error?.message ? String(error.message) : String(error);
  return /net::ERR_(?:CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_ABORTED|NETWORK_CHANGED|INTERNET_DISCONNECTED)|ECONNRESET|EPIPE|socket hang up|CDP socket closed|WebSocket is not open|browser has disconnected|target closed|page crashed|navigation timeout/i.test(message);
}

export function classifyTransientStageError(error) {
  if (isTransientLockError(error)) {
    return 'transient-lock-error';
  }
  if (isTransientNavigationError(error)) {
    return 'transient-navigation-failure';
  }
  return null;
}

function attachRetryMetadata(error, metadata = {}) {
  if (error && typeof error === 'object') {
    error.attempts = metadata.attempts;
    error.retryable = metadata.retryable === true;
    error.transientReason = metadata.transientReason ?? null;
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.attempts = metadata.attempts;
  wrapped.retryable = metadata.retryable === true;
  wrapped.transientReason = metadata.transientReason ?? null;
  return wrapped;
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
      const transientReason = classifyTransientStageError(error);
      if (attempt >= attempts || !transientReason) {
        throw attachRetryMetadata(error, {
          attempts: attempt,
          retryable: Boolean(transientReason),
          transientReason,
        });
      }
      await delay(retryDelayMs);
    }
  }
  throw attachRetryMetadata(lastError, {
    attempts,
    retryable: Boolean(classifyTransientStageError(lastError)),
    transientReason: classifyTransientStageError(lastError),
  });
}

export const DEFAULT_STAGE_RUNNERS = {
  default: (stageName, action) => runStage(stageName, action),
  retry: (stageName, action) => runStageWithRetry(stageName, action),
};
