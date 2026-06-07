// @ts-check

import {
  areAuthScopesSubset,
} from '../auth-runtime.mjs';

export function sessionVaultScopesAllow({
  requestedScopes = [],
  sessionScopes = [],
} = {}) {
  return areAuthScopesSubset(requestedScopes, sessionScopes);
}
