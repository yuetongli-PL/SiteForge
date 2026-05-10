// @ts-check

import { createNativeResolutionMiss } from './common.mjs';

export const siteKey = 'jable';
export const resolverMethod = 'native-jable-resource-seeds';
export const resolverRequiredReason = 'jable-native-resolver-required';

export function resolveResources(plan, _sessionLease = null, _context = {}) {
  return createNativeResolutionMiss(siteKey, plan, {
    method: resolverMethod,
    reason: resolverRequiredReason,
    expectedCount: 1,
    resolution: {
      sourceType: 'experimental-placeholder',
      currentPhase: 'native-resolver-contract',
      downloaderStatus: 'experimental',
      resourcePolicy: 'no-resources-produced',
    },
  });
}

export default Object.freeze({
  siteKey,
  resolveResources,
});
