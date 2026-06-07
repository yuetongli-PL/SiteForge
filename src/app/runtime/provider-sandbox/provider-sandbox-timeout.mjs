// @ts-check

import { ProviderSandboxError } from './provider-sandbox-errors.mjs';

export async function withProviderSandboxTimeout(task, timeoutMs = 1000) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new ProviderSandboxError('Provider sandbox timed out', {
            code: 'provider_sandbox.timeout',
          }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
