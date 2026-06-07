// @ts-check

import { runProviderInRestrictedSandbox } from './provider-worker-host.mjs';

export function createProviderSandboxClient(options = {}) {
  return {
    run(request = {}) {
      return runProviderInRestrictedSandbox({
        ...options,
        ...request,
      });
    },
  };
}
