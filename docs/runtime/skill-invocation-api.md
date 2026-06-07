# Skill Runtime Invocation API

The Skill Runtime Invocation API gives external skills a structured way to request SiteForge runtime work without bypassing policy, provider, sandbox, auth, or audit gates.

## Request Shape

Requests use `SKILL_RUNTIME_INVOCATION_SCHEMA_VERSION` and are validated by `validateSkillRuntimeInvocationRequest` or `assertSkillRuntimeInvocationRequestValid`. The stable helper APIs are:

- `createSkillRuntimeInvocationRequest`
- `createSkillRuntimeDryRunPreview`
- `invokeSkillRuntime`
- `convertSkillInvocationToRuntimeInvocationRequest`
- `resolveSkillInvocationPackageRefs`
- `createSkillInvocationIdempotencyLedger`
- `createSkillRuntimeInvocationResult`

Each request must use structured references such as `capabilityRef`, `executionContractRef`, and either `policyDecisionRef` or an explicit policy simulation mode. Use `SKILL_RUNTIME_INVOCATION_MODES` to choose `dryRun` or `execute`.

## Authorization Boundary

Skill task text is not authorization. A sentence in task text cannot authorize high-risk, destructive, payment, private, or authenticated behavior.

`dryRun` does not execute a provider. `execute` still goes through runtime gates, provider registration, policy decisions, sandbox boundaries, and audit recording. The response returns sanitized refs such as `runId` and `auditViewRef`; it does not return private session material.

## Forbidden Inputs

Literal credentials, cookie values, token values, Authorization headers, Cookie headers, browser storage state, and session handles are invalid Skill API material. Use opaque safe refs only. Payment execution is not implemented. Default destructive execution is blocked.

Relevant schema names include `SKILL_RUNTIME_INVOCATION_PREVIEW_SCHEMA_VERSION`, `SKILL_RUNTIME_INVOCATION_RESULT_SCHEMA_VERSION`, and `SKILL_RUNTIME_INVOCATION_IDEMPOTENCY_SCHEMA_VERSION`.
