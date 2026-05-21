// @ts-check

import {
  SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
} from './schema.mjs';
import {
  assertNoCompilerSensitiveMaterial,
} from './validator.mjs';

const DEFAULT_CAPABILITY_CANDIDATES = Object.freeze([
  'search',
  'open-content',
  'open-author',
  'open-category',
  'download-content',
  'list-followed-users',
  'list-followed-updates',
]);

function normalizeCapabilityName(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (/https?:\/\//iu.test(text)) {
    /** @type {Error & Record<string, any>} */
    const error = new Error('Capability names must not contain URLs or raw capture targets');
    error.code = 'compiler.capability_intake_invalid';
    throw error;
  }
  return text
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || null;
}

function uniqueCapabilities(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeCapabilityName(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** @param {Record<string, any>} [capability] */
function capabilityAliases(capability = {}) {
  return uniqueCapabilities([
    capability.capabilityKey,
    capability.normalizedIntent,
    capability.capabilityFamily,
    ...(Array.isArray(capability.supportedTaskTypes) ? capability.supportedTaskTypes : []),
  ]);
}

/** @param {Record<string, any>} options */
export function createCapabilityIntake({
  requestedCapabilities = [],
  candidateCapabilities = [],
  unconfirmedCapabilityPolicy = 'best_effort_full_coverage',
  inquiryRequired = false,
} = {}) {
  const requested = uniqueCapabilities(requestedCapabilities);
  const candidates = uniqueCapabilities(candidateCapabilities.length ? candidateCapabilities : DEFAULT_CAPABILITY_CANDIDATES);
  const requestedSet = new Set(requested);
  const unconfirmedCapabilities = candidates.filter((candidate) => !requestedSet.has(candidate));
  const intake = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    intakeMode: requested.length && inquiryRequired ? 'mixed' : (requested.length ? 'user_requested' : 'inquiry_required'),
    inquiryRequired: requested.length === 0 || inquiryRequired === true,
    requestedCapabilities: requested,
    candidateCapabilities: candidates,
    unconfirmedCapabilities,
    unconfirmedCapabilityPolicy,
    targetedCaptureStrategy: 'requested_first_then_best_effort_unconfirmed',
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(intake);
  return intake;
}

/** @param {Record<string, any>} options */
export function createCapabilityIntakeQuestionnaire({
  siteKey,
  url,
  candidateCapabilities = DEFAULT_CAPABILITY_CANDIDATES,
} = {}) {
  const questionnaire = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    questionId: 'site-capability-intake',
    siteKey: normalizeCapabilityName(siteKey) ?? undefined,
    url: url ? String(url) : undefined,
    prompt: 'Which site capabilities should be prioritized before compile and capture?',
    candidateCapabilities: uniqueCapabilities(candidateCapabilities),
    unconfirmedCapabilityPolicy: 'best_effort_full_coverage',
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(questionnaire);
  return questionnaire;
}

/** @param {Record<string, any>} [capability] */
export function capabilityIntakeStatusForCapability(capability = {}, capabilityIntake = null) {
  if (!capabilityIntake || !Array.isArray(capabilityIntake.requestedCapabilities)) {
    return 'unconfirmed_best_effort';
  }
  const requested = new Set(capabilityIntake.requestedCapabilities);
  const aliases = capabilityAliases(capability);
  return aliases.some((alias) => requested.has(alias))
    ? 'requested'
    : 'unconfirmed_best_effort';
}

/** @param {Record<string, any>} options */
export function createCapabilityCoverageSummary({
  capabilityIntake = null,
  capabilities = [],
} = {}) {
  const requestedCapabilities = capabilityIntake?.requestedCapabilities ?? [];
  const unconfirmedCapabilities = capabilityIntake?.unconfirmedCapabilities ?? [];
  const knownAliases = new Set(capabilities.flatMap(capabilityAliases));
  const missingRequestedCapabilities = requestedCapabilities
    .filter((capability) => !knownAliases.has(capability));
  const requestedCount = capabilities.filter((capability) => (
    capabilityIntakeStatusForCapability(capability, capabilityIntake) === 'requested'
  )).length;
  const summary = {
    schemaVersion: SITE_CAPABILITY_COMPILER_SCHEMA_VERSION,
    requestedCapabilities: [...requestedCapabilities],
    missingRequestedCapabilities,
    missingRequestedCapabilityCount: missingRequestedCapabilities.length,
    unconfirmedCapabilities: [...unconfirmedCapabilities],
    targetedCapabilityCount: requestedCount,
    bestEffortUnconfirmedCount: unconfirmedCapabilities.length,
    capabilityGapStatus: missingRequestedCapabilities.length > 0 ? 'missing_requested_capability' : 'clear',
    unconfirmedCapabilityPolicy: capabilityIntake?.unconfirmedCapabilityPolicy ?? 'best_effort_full_coverage',
    redactionRequired: true,
  };
  assertNoCompilerSensitiveMaterial(summary);
  return summary;
}
