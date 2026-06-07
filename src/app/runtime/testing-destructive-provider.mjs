// @ts-check

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';
import {
  sanitizeDestructiveAuthorizationSummary,
} from './destructive-authorization.mjs';
import {
  RUNTIME_REASONS,
} from './runtime-reasons.mjs';

export const TESTING_DESTRUCTIVE_LAB_PROVIDER_ID = 'testing_destructive_lab_provider';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[\s"'`<>?&=%#]/u.test(text) || /(?:secret|token|password|credential|authorization|cookie)/iu.test(text)) {
    return fallback;
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

function labContext(runtimeContext = null) {
  const source = isPlainObject(runtimeContext?.destructiveLab)
    ? runtimeContext.destructiveLab
    : {};
  return {
    enabled: runtimeContext?.controlledDestructiveLab === true && source.enabled === true,
    dryRunProofRef: safeRef(source.dryRunProofRef ?? source.dryRunProof?.proofRef, null),
    targetSafeRef: safeRef(source.targetSafeRef ?? source.targetVerification?.targetSafeRef, null),
    targetVerified: source.targetVerified === true || source.targetVerification?.verified === true,
    compensationPlanRef: safeRef(source.compensationPlanRef ?? source.compensationPlan?.planRef, null),
    compensationSummary: safeRef(source.compensationSummary ?? source.compensationPlan?.summary, null),
  };
}

function hasStructuredAuthorization(authorization = null) {
  if (!isPlainObject(authorization)) return false;
  const policyGate = isPlainObject(authorization.policyGate) ? authorization.policyGate : {};
  return Boolean(
    normalizeText(authorization.authzRef ?? authorization.authorizationRef)
    && normalizeText(authorization.challengeRef ?? authorization.challengeId)
    && normalizeText(authorization.confirmationRef ?? authorization.confirmationTokenRef)
    && policyGate.satisfied === true,
  );
}

function naturalLanguageAuthorizationObserved(runtimeContext = null) {
  const text = normalizeText(runtimeContext?.taskText ?? runtimeContext?.naturalLanguageAuthorization);
  return text
    ? /\b(?:authorize|authorise|confirm|confirmed|delete|cancel|revoke|destroy)\b/iu.test(text)
    : false;
}

function canExecuteLab(options = {}) {
  const {
    invocationRequest = null,
    executionContract = null,
    runtimeContext = null,
  } = options;
  if (executionContract?.paymentOrFundsAction === true || executionContract?.capabilityKind === 'payment') {
    return { allowed: false, reasonCode: RUNTIME_REASONS.paymentExecutionBlocked };
  }
  const lab = labContext(runtimeContext);
  if (lab.enabled !== true) {
    return { allowed: false, reasonCode: RUNTIME_REASONS.destructiveExecutionBlocked };
  }
  if (!hasStructuredAuthorization(invocationRequest?.destructiveAuthorization)) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_authorization_required' };
  }
  if (naturalLanguageAuthorizationObserved(runtimeContext)) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_natural_language_rejected' };
  }
  if (!lab.dryRunProofRef) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_dry_run_proof_required' };
  }
  if (lab.targetVerified !== true || !lab.targetSafeRef) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_target_verification_required' };
  }
  const requiredTarget = safeRef(executionContract?.destructiveRequirement?.targetRef ?? executionContract?.targetRef, null);
  if (requiredTarget && lab.targetSafeRef !== requiredTarget) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_target_verification_required' };
  }
  if (!lab.compensationPlanRef) {
    return { allowed: false, reasonCode: 'runtime.destructive_lab_compensation_required' };
  }
  return { allowed: true };
}

export function createTestingDestructiveProvider() {
  return {
    id: TESTING_DESTRUCTIVE_LAB_PROVIDER_ID,
    providerKind: 'destructive_lab_provider',
    capabilityKinds: ['destructive'],
    testingOnly: true,
    destructiveLabOnly: true,
    supports(descriptor = {}) {
      return descriptor.capabilityKind === 'destructive'
        || descriptor.executionContract?.destructiveAction === true;
    },
    canExecute(options = {}) {
      return canExecuteLab(options);
    },
    async run(options = {}) {
      const lab = labContext(options.runtimeContext);
      const destructiveSummary = {
        ...sanitizeDestructiveAuthorizationSummary({
          destructiveRequirement: options.executionContract?.destructiveRequirement,
          destructiveAuthorization: options.invocationRequest?.destructiveAuthorization,
          reason: 'runtime.destructive_lab_authorized',
        }),
        outcome: 'lab_authorized',
        reason: 'runtime.destructive_lab_authorized',
      };
      const result = {
        providerId: TESTING_DESTRUCTIVE_LAB_PROVIDER_ID,
        providerKind: 'destructive_lab_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: true,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        destructiveSummary,
        resultSummary: {
          outcome: 'destructive_lab_completed',
          labOnly: true,
          productionExecution: false,
          actionClass: destructiveSummary.actionClass,
          targetSafeRef: lab.targetSafeRef,
          dryRunProofSafeRef: lab.dryRunProofRef,
          compensationSummary: {
            planSafeRef: lab.compensationPlanRef,
            summary: lab.compensationSummary ?? 'compensation_plan_present',
          },
          sideEffectAttemptedSemantics: 'lab_controlled_simulated_side_effect_only',
          artifactRefs: [lab.dryRunProofRef, lab.compensationPlanRef].filter(Boolean),
          redactionRequired: true,
        },
      };
      assertNoExecutionSensitiveMaterial(result);
      return result;
    },
  };
}
