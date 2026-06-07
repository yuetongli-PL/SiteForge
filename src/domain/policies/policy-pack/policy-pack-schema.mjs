// @ts-check

export const POLICY_PACK_SCHEMA_VERSION = 'policy.pack.v1';
export const POLICY_PACK_SIMULATION_SCHEMA_VERSION = 1;
export const POLICY_PACK_DECISION_SCHEMA_VERSION = 1;
export const POLICY_PACK_DIFF_SCHEMA_VERSION = 1;
export const POLICY_PACK_REGRESSION_SCHEMA_VERSION = 1;

export const POLICY_RULE_EFFECTS = Object.freeze(['allow', 'deny']);
export const POLICY_CAPABILITY_KINDS = Object.freeze(['read', 'download', 'form_or_action', 'destructive', 'payment']);
export const POLICY_OPERATIONS = Object.freeze(['read', 'download', 'write', 'form_or_action']);

export function listPolicyPackSchemaDefinitions() {
  return [
    {
      name: 'PolicyPack',
      version: POLICY_PACK_SCHEMA_VERSION,
      sourcePath: 'src/domain/policies/policy-pack/policy-pack-schema.mjs',
    },
    {
      name: 'PolicyPackSimulation',
      version: POLICY_PACK_SIMULATION_SCHEMA_VERSION,
      sourcePath: 'src/domain/policies/policy-pack/policy-pack-schema.mjs',
    },
    {
      name: 'PolicyPackDecision',
      version: POLICY_PACK_DECISION_SCHEMA_VERSION,
      sourcePath: 'src/domain/policies/policy-pack/policy-pack-schema.mjs',
    },
    {
      name: 'PolicyPackDiff',
      version: POLICY_PACK_DIFF_SCHEMA_VERSION,
      sourcePath: 'src/domain/policies/policy-pack/policy-pack-schema.mjs',
    },
  ];
}
