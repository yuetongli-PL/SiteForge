// @ts-check

import { assertPolicyPackValid, sanitizePolicyPack } from './policy-pack-validator.mjs';

export function migratePolicyPack(policyPack = {}) {
  return assertPolicyPackValid({
    ...sanitizePolicyPack(policyPack),
    schemaVersion: 'policy.pack.v1',
  });
}
