# Payment And Destructive Boundaries

Payment and destructive capabilities are high-risk boundaries. In this release line, they are planning, classification, simulation, audit, and threat-model surfaces only.

## Payment Boundary

Payment execution is not implemented.

Payment planning uses:

- `PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION`
- `PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION`
- `PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION`
- `PAYMENT_PRODUCTION_EXECUTION_DEFAULT`
- `validatePaymentAuthorizationPlan`
- `assertPaymentAuthorizationPlanValid`
- `simulatePaymentPolicy`
- `assertProductionPaymentProviderProhibited`
- `classifyPaymentCapability`
- `createPaymentAuditPlanningSummary`

Payment plans may describe amount, currency, payee refs, approval requirements, and audit summaries. They must not include card data, bank data, payment tokens, literal credentials, or private session material.

## Destructive Boundary

Default destructive execution is blocked.

Destructive planning uses:

- `DESTRUCTIVE_EXECUTION_PLAN_SCHEMA_VERSION`
- `DESTRUCTIVE_PLANNING_SIMULATION_SCHEMA_VERSION`
- `DESTRUCTIVE_PLANNING_AUDIT_SUMMARY_SCHEMA_VERSION`
- `DESTRUCTIVE_PRODUCTION_EXECUTION_DEFAULT`
- `validateDestructiveExecutionPlan`
- `assertDestructiveExecutionPlanValid`
- `simulateDestructiveExecutionPlan`
- `createDestructiveDryRunProof`
- `createDestructiveCompensationPlan`
- `createDestructiveAuthorizationLifecycle`
- `verifyDestructiveTargetRef`

Destructive controlled execution remains planning and lab-only unless a later phase explicitly adds a test-only lab provider behind `src/app/runtime/testing.mjs`. Production destructive providers are not registered by default.

## Shared Rule

Skill task text is not authorization. Natural language cannot authorize payment or destructive execution. Production provider registries must continue to reject payment and destructive executable providers by default.
