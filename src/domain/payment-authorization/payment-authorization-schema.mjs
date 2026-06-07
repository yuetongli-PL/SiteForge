// @ts-check

export const PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION = 'payment.authorization_plan.v1';
export const PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION = 'payment.policy_simulation.v1';
export const PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION = 'payment.audit_planning_summary.v1';

export const PAYMENT_CAPABILITY_CLASSES = Object.freeze([
  'direct_payment',
  'funds_transfer',
  'subscription',
  'purchase',
  'billing_update',
  'refund',
  'other',
]);

export const PAYMENT_PRODUCTION_EXECUTION_DEFAULT = 'blocked';

export const PAYMENT_AUTHORIZATION_SCHEMA_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'PaymentAuthorizationPlan',
    version: PAYMENT_AUTHORIZATION_PLAN_SCHEMA_VERSION,
    sourcePath: 'src/domain/payment-authorization/payment-authorization-schema.mjs',
  }),
  Object.freeze({
    name: 'PaymentPolicySimulation',
    version: PAYMENT_POLICY_SIMULATION_SCHEMA_VERSION,
    sourcePath: 'src/domain/payment-authorization/payment-authorization-schema.mjs',
  }),
  Object.freeze({
    name: 'PaymentAuditPlanningSummary',
    version: PAYMENT_AUDIT_PLANNING_SUMMARY_SCHEMA_VERSION,
    sourcePath: 'src/domain/payment-authorization/payment-authorization-schema.mjs',
  }),
]);

export function listPaymentAuthorizationSchemaDefinitions() {
  return PAYMENT_AUTHORIZATION_SCHEMA_DEFINITIONS.map((definition) => ({ ...definition }));
}
