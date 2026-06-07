// @ts-check

import { createHash } from 'node:crypto';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../domain/policies/execution/index.mjs';

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

function hashRef(value, prefix = 'destructive-ref') {
  const digest = createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 24);
  return `${prefix}:sha256:${digest}`;
}

function safeRef(value, fallback = null) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/[\s"'`<>?&=%#]/u.test(text) || /(?:secret|token|password|credential|authorization|cookie|confirmation_secret)/iu.test(text)) {
    return hashRef(text);
  }
  return text
    .replace(/[^a-z0-9._:/-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180) || fallback;
}

export function normalizeDestructiveRequirement(requirement = null) {
  const source = isPlainObject(requirement) ? requirement : {};
  const required = source.required === true;
  const actionClass = safeRef(source.actionClass, 'other');
  const normalized = {
    required,
    actionClass,
    targetSafeRef: safeRef(source.targetRef ?? source.targetSafeRef, null),
    strongAuthRequired: source.requiresStrongAuthorization !== false && source.strongAuthRequired !== false,
    twoStepRequired: source.requireTwoStepConfirmation !== false && source.twoStepRequired !== false,
    policyGateRequired: source.requirePolicyGate !== false && source.policyGateRequired !== false,
    naturalLanguageAllowed: false,
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}

export function normalizeDestructiveAuthorization(authorization = null) {
  if (!isPlainObject(authorization)) {
    return null;
  }
  const policyGate = isPlainObject(authorization.policyGate) ? authorization.policyGate : {};
  const normalized = {
    authzRef: safeRef(authorization.authzRef ?? authorization.authorizationRef, null),
    challengeRef: safeRef(authorization.challengeId ?? authorization.challengeRef, null),
    confirmationRef: safeRef(authorization.confirmationRef ?? authorization.confirmationTokenRef, null),
    policyGate: {
      satisfied: policyGate.satisfied === true,
      policyId: safeRef(policyGate.policyId, null),
    },
    redactionRequired: true,
  };
  const output = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== null));
  assertNoExecutionSensitiveMaterial(output);
  return output;
}

export function sanitizeDestructiveAuthorizationSummary({
  destructiveRequirement = null,
  destructiveAuthorization = null,
  reason = 'runtime.destructive_execution_blocked',
} = {}) {
  const requirement = normalizeDestructiveRequirement(destructiveRequirement);
  const authorization = normalizeDestructiveAuthorization(destructiveAuthorization);
  const summary = {
    required: requirement.required === true,
    actionClass: requirement.actionClass,
    targetSafeRef: requirement.targetSafeRef ?? null,
    strongAuth: {
      present: Boolean(authorization?.authzRef && authorization?.challengeRef && authorization?.confirmationRef),
      authzRef: authorization?.authzRef ?? null,
      challengeRef: authorization?.challengeRef ?? null,
      confirmationRef: authorization?.confirmationRef ?? null,
    },
    policyGate: {
      required: requirement.policyGateRequired === true,
      satisfied: authorization?.policyGate?.satisfied === true,
      policyId: authorization?.policyGate?.policyId ?? null,
    },
    naturalLanguageAccepted: false,
    outcome: 'blocked',
    reason: safeRef(reason, 'runtime.destructive_execution_blocked'),
    redactionRequired: true,
  };
  const sanitized = {
    ...summary,
    targetSafeRef: summary.targetSafeRef ?? undefined,
    strongAuth: Object.fromEntries(Object.entries(summary.strongAuth).filter(([, value]) => value !== null)),
    policyGate: Object.fromEntries(Object.entries(summary.policyGate).filter(([, value]) => value !== null)),
  };
  assertNoExecutionSensitiveMaterial(sanitized);
  return sanitized;
}
