# Policy Pack

Policy packs define reusable execution policy decisions for SiteForge runtime requests. They are evaluated before provider execution and remain separate from natural-language task text.

## Core APIs

Policy packs use `POLICY_PACK_SCHEMA_VERSION` and related schemas:

- `POLICY_PACK_SIMULATION_SCHEMA_VERSION`
- `POLICY_PACK_DECISION_SCHEMA_VERSION`
- `POLICY_PACK_REGRESSION_SCHEMA_VERSION`
- `POLICY_PACK_DIFF_SCHEMA_VERSION`

Use these APIs:

- `validatePolicyPack`
- `assertPolicyPackValid`
- `sanitizePolicyPack`
- `sanitizePolicySimulationInput`
- `simulatePolicyPack`
- `explainPolicyDecision`
- `diffPolicyPacks`
- `createPolicyRegressionSnapshot`
- `migratePolicyPack`

## Safety Model

Skill task text is not authorization. A policy simulation may explain what would happen, but it does not grant session access or bypass runtime gates.

Payment execution is not implemented. Default destructive execution is blocked. Policy packs can model a blocked payment or destructive request, but production runtime execution remains unavailable unless a future phase adds a separately reviewed implementation and release gate.

Policy inputs and outputs must be sanitized. Literal credentials, cookie values, token values, session handles, full request bodies, and full response bodies are forbidden policy material.
