// @ts-check

import {
  assertNoForbiddenPatterns,
  isSensitiveFieldName,
} from './security-guard.mjs';

export const SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_SCHEMA_VERSION = 1;
export const SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT = 20;

export const SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_ALLOWED_STATUSES = Object.freeze([
  'not_started',
  'partial',
  'implemented',
  'verified',
  'blocked',
]);

const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'codeEvidence',
  'testEvidence',
  'verificationCommand',
  'verificationResult',
]);

const INCOMPLETE_EVIDENCE_PATTERN =
  /\b(?:not run|todo|placeholder|only documentation|documentation only|pending|tbd|n\/a)\b/iu;

const FINAL_VALIDATION_RUNTIME_PRODUCT_KEYS = Object.freeze([
  'accessToken',
  'authorization',
  'authorizationHeader',
  'browserProfile',
  'browserProfilePath',
  'cookie',
  'cookies',
  'csrf',
  'csrfToken',
  'downloader',
  'execute',
  'executor',
  'handler',
  'rawCredentials',
  'rawSession',
  'rawSessionMaterial',
  'refreshToken',
  'SESSDATA',
  'sessionId',
  'sessionMaterial',
  'sessionView',
  'taskRunner',
  'token',
  'userDataDir',
]);

const FINAL_VALIDATION_RUNTIME_PRODUCT_KEY_SET = new Set(
  FINAL_VALIDATION_RUNTIME_PRODUCT_KEYS.map((key) => normalizeKey(key)),
);

const FINAL_VALIDATION_DISABLED_FLAG_KEYS = Object.freeze([
  'deliveryDescriptorScanPerformed',
  'downloaderInvoked',
  'externalTelemetryDispatched',
  'matrixWritePerformed',
  'repoWritePerformed',
  'runtimeArtifactWritePerformed',
  'runtimeExecutionPerformed',
  'sessionMaterialized',
  'siteAdapterInvoked',
]);

const FINAL_VALIDATION_DISABLED_FLAG_KEY_SET = new Set(
  FINAL_VALIDATION_DISABLED_FLAG_KEYS.map((key) => normalizeKey(key)),
);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeKey(value) {
  return String(value ?? '').replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return true;
}

function assertStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const entry of value) {
    if (!normalizeText(entry)) {
      throw new Error(`${label} entries must be non-empty strings`);
    }
  }
  return true;
}

function assertNoFinalValidationRuntimeProducts(value, label, path = label) {
  if (typeof value === 'function') {
    throw new Error(`${label} must not contain executable function at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoFinalValidationRuntimeProducts(
      entry,
      label,
      `${path}[${index}]`,
    ));
    return true;
  }
  if (!isPlainObject(value)) {
    return true;
  }
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (isSensitiveFieldName(key) || FINAL_VALIDATION_RUNTIME_PRODUCT_KEY_SET.has(normalized)) {
      if (entry === false && FINAL_VALIDATION_DISABLED_FLAG_KEY_SET.has(normalized)) {
        continue;
      }
      throw new Error(`${label} must not contain runtime or sensitive field: ${path}.${key}`);
    }
    assertNoFinalValidationRuntimeProducts(entry, label, `${path}.${key}`);
  }
  return true;
}

function assertNoUnsafeFinalValidationPayload(value, label) {
  assertNoFinalValidationRuntimeProducts(value, label);
  assertNoForbiddenPatterns(value);
  return true;
}

function getMarkdownField(sectionBody, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = sectionBody.match(new RegExp(`^- ${escaped}: (.*)$`, 'mu'));
  return match?.[1]?.trim() ?? '';
}

function stripBackticks(value) {
  return String(value ?? '').replaceAll('`', '').trim();
}

export function extractSiteCapabilityGraphMatrixSections(markdown = '') {
  const source = String(markdown ?? '');
  assertNoUnsafeFinalValidationPayload({ markdown: source }, 'SiteCapabilityGraphMatrixMarkdown');

  const matches = [...source.matchAll(/^## (\d+)\. (.+)$/gmu)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    const body = source.slice(match.index, next?.index ?? source.length);
    return {
      number: Number(match[1]),
      title: match[2].trim(),
      status: stripBackticks(getMarkdownField(body, 'Current status')),
      codeEvidence: getMarkdownField(body, 'Existing code evidence'),
      testEvidence: getMarkdownField(body, 'Existing test evidence'),
      verificationCommand: getMarkdownField(body, 'Verification command'),
      verificationResult: getMarkdownField(body, 'Verification result'),
      currentGaps: getMarkdownField(body, 'Current gaps'),
      riskNotes: getMarkdownField(body, 'Risk notes'),
    };
  });
}

function normalizeSection(section = {}) {
  assertPlainObject(section, 'SiteCapabilityGraphFinalValidationSection');
  const number = Number(section.number);
  if (!Number.isInteger(number) || number < 1 || number > SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT) {
    throw new Error('SiteCapabilityGraphFinalValidationSection number must be 1-20');
  }
  const status = normalizeText(section.status);
  if (!SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_ALLOWED_STATUSES.includes(status ?? '')) {
    throw new Error(`SiteCapabilityGraphFinalValidationSection ${number} status is unsupported`);
  }
  const normalized = {
    number,
    title: normalizeText(section.title) ?? `Section ${number}`,
    status,
    codeEvidence: normalizeText(section.codeEvidence),
    testEvidence: normalizeText(section.testEvidence),
    verificationCommand: normalizeText(section.verificationCommand),
    verificationResult: normalizeText(section.verificationResult),
    currentGaps: normalizeText(section.currentGaps),
    riskNotes: normalizeText(section.riskNotes),
  };
  assertNoUnsafeFinalValidationPayload(normalized, 'SiteCapabilityGraphFinalValidationSection');
  return normalized;
}

function createSectionGaps(sections) {
  const gaps = [];
  const byNumber = new Map();
  for (const section of sections) {
    if (byNumber.has(section.number)) {
      gaps.push({
        reasonCode: 'graph-final-validation-section-duplicate',
        section: section.number,
        message: `Section ${section.number} appears more than once`,
      });
      continue;
    }
    byNumber.set(section.number, section);
  }

  for (let sectionNumber = 1; sectionNumber <= SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT; sectionNumber += 1) {
    const section = byNumber.get(sectionNumber);
    if (!section) {
      gaps.push({
        reasonCode: 'graph-final-validation-section-missing',
        section: sectionNumber,
        message: `Section ${sectionNumber} is missing`,
      });
      continue;
    }

    if (section.status !== 'verified') {
      gaps.push({
        reasonCode: 'graph-final-validation-section-not-verified',
        section: sectionNumber,
        message: `Section ${sectionNumber} is ${section.status}, not verified`,
      });
    }

    for (const fieldName of REQUIRED_EVIDENCE_FIELDS) {
      const value = section[fieldName];
      if (!value || INCOMPLETE_EVIDENCE_PATTERN.test(value)) {
        gaps.push({
          reasonCode: 'graph-final-validation-section-evidence-incomplete',
          section: sectionNumber,
          field: fieldName,
          message: `Section ${sectionNumber} ${fieldName} is incomplete`,
        });
      }
    }
  }

  return gaps;
}

function countStatuses(sections) {
  const counts = Object.fromEntries(
    SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_ALLOWED_STATUSES.map((status) => [status, 0]),
  );
  for (const section of sections) {
    counts[section.status] = (counts[section.status] ?? 0) + 1;
  }
  return counts;
}

function booleanOption(options, fieldName) {
  return options?.[fieldName] === true;
}

function createSection19Gaps(testingStrategy = {}) {
  assertPlainObject(testingStrategy, 'SiteCapabilityGraphFinalValidationSection19TestingStrategy');
  assertNoUnsafeFinalValidationPayload(
    testingStrategy,
    'SiteCapabilityGraphFinalValidationSection19TestingStrategy',
  );
  const requirements = [
    ['focusedFinalValidationPassed', 'focused final validation must pass'],
    ['matrixValidationPassed', 'matrix validation must pass'],
    ['regressionCoverageRecorded', 'regression coverage must be recorded'],
    ['promotionBlockingCoverageResolved', 'promotion-blocking coverage must be resolved'],
  ];
  return requirements
    .filter(([fieldName]) => !booleanOption(testingStrategy, fieldName))
    .map(([fieldName, message]) => ({
      reasonCode: 'graph-final-validation-section19-testing-strategy-incomplete',
      section: 19,
      field: fieldName,
      message,
    }));
}

function createSection20Gaps(completionGate = {}, agentBReview = {}) {
  assertPlainObject(completionGate, 'SiteCapabilityGraphFinalValidationSection20CompletionGate');
  assertPlainObject(agentBReview, 'SiteCapabilityGraphFinalValidationAgentBReview');
  assertNoUnsafeFinalValidationPayload(
    completionGate,
    'SiteCapabilityGraphFinalValidationSection20CompletionGate',
  );
  assertNoUnsafeFinalValidationPayload(agentBReview, 'SiteCapabilityGraphFinalValidationAgentBReview');

  const requirements = [
    ['finalMatrixValidationPassed', 'final matrix validation must pass'],
    ['finalValidationSummaryAccepted', 'final validation summary must be accepted'],
    ['noKnownSeriousSafetyViolations', 'known serious safety violations must be absent'],
  ];
  const gaps = requirements
    .filter(([fieldName]) => !booleanOption(completionGate, fieldName))
    .map(([fieldName, message]) => ({
      reasonCode: 'graph-final-validation-section20-completion-gate-incomplete',
      section: 20,
      field: fieldName,
      message,
    }));

  if (agentBReview.result !== 'Accepted') {
    gaps.push({
      reasonCode: 'graph-final-validation-agent-b-not-accepted',
      section: 20,
      field: 'agentBReview.result',
      message: 'Agent B must accept the final state',
    });
  }
  return gaps;
}

function normalizeKnownRisks(value) {
  if (value === undefined || value === null) {
    return [];
  }
  assertStringArray(value, 'SiteCapabilityGraphFinalValidationKnownRisks');
  return value.map((entry) => entry.trim());
}

export function createSiteCapabilityGraphFinalValidationSummary(input = {}) {
  assertPlainObject(input, 'SiteCapabilityGraphFinalValidationInput');
  assertNoUnsafeFinalValidationPayload(input, 'SiteCapabilityGraphFinalValidationInput');

  if (!Array.isArray(input.sections)) {
    throw new Error('SiteCapabilityGraphFinalValidationInput sections must be an array');
  }

  const sections = input.sections.map((section) => normalizeSection(section));
  const sectionGaps = createSectionGaps(sections);
  const section19Gaps = createSection19Gaps(input.section19TestingStrategy ?? {});
  const section20Gaps = createSection20Gaps(input.section20CompletionGate ?? {}, input.agentBReview ?? {});
  const knownRisks = normalizeKnownRisks(input.knownRisks);
  const knownRiskGaps = knownRisks.map((risk, index) => ({
    reasonCode: 'graph-final-validation-known-risk-open',
    field: `knownRisks[${index}]`,
    message: risk,
  }));
  const gaps = [
    ...sectionGaps,
    ...section19Gaps,
    ...section20Gaps,
    ...knownRiskGaps,
  ];
  const result = gaps.length === 0 ? 'passed' : 'blocked';
  const statusCounts = countStatuses(sections);
  const allSectionsVerified =
    sections.length === SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT
    && statusCounts.verified === SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT
    && sectionGaps.length === 0;

  const summary = {
    schemaVersion: SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_SCHEMA_VERSION,
    artifactFamily: 'site-capability-graph-final-validation-summary',
    graphVersion: normalizeText(input.graphVersion) ?? 'site-capability-graph-v1',
    result,
    redactionRequired: true,
    descriptorOnly: true,
    deliveryDescriptorScanPerformed: false,
    runtimeExecutionPerformed: false,
    repoWritePerformed: false,
    matrixWritePerformed: false,
    runtimeArtifactWritePerformed: false,
    externalTelemetryDispatched: false,
    siteAdapterInvoked: false,
    downloaderInvoked: false,
    sessionMaterialized: false,
    statusCounts,
    allSectionsVerified,
    section19: {
      section: 19,
      gateKind: 'testing-strategy-final-validation',
      readyForVerified: result === 'passed',
      focusedFinalValidationPassed: booleanOption(input.section19TestingStrategy, 'focusedFinalValidationPassed'),
      matrixValidationPassed: booleanOption(input.section19TestingStrategy, 'matrixValidationPassed'),
      regressionCoverageRecorded: booleanOption(input.section19TestingStrategy, 'regressionCoverageRecorded'),
      promotionBlockingCoverageResolved:
        booleanOption(input.section19TestingStrategy, 'promotionBlockingCoverageResolved'),
    },
    section20: {
      section: 20,
      gateKind: 'completion-gate-final-validation',
      readyForVerified: result === 'passed',
      finalMatrixValidationPassed: booleanOption(input.section20CompletionGate, 'finalMatrixValidationPassed'),
      finalValidationSummaryAccepted:
        booleanOption(input.section20CompletionGate, 'finalValidationSummaryAccepted'),
      noKnownSeriousSafetyViolations:
        booleanOption(input.section20CompletionGate, 'noKnownSeriousSafetyViolations'),
      agentBReviewResult: normalizeText(input.agentBReview?.result) ?? 'missing',
    },
    promotion: {
      matrixVerifiedPromotionAllowed: result === 'passed',
      automaticMatrixMutationAllowed: false,
      requiresHumanOrMainThreadMatrixUpdate: true,
      requiresAgentBAcceptance: true,
    },
    gaps,
  };

  assertSiteCapabilityGraphFinalValidationSummaryCompatible(summary);
  return summary;
}

export function assertSiteCapabilityGraphFinalValidationSummaryCompatible(summary = {}) {
  assertPlainObject(summary, 'SiteCapabilityGraphFinalValidationSummary');
  assertNoUnsafeFinalValidationPayload(summary, 'SiteCapabilityGraphFinalValidationSummary');
  if (summary.schemaVersion !== SITE_CAPABILITY_GRAPH_FINAL_VALIDATION_SCHEMA_VERSION) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary schemaVersion is not compatible');
  }
  if (summary.artifactFamily !== 'site-capability-graph-final-validation-summary') {
    throw new Error('SiteCapabilityGraphFinalValidationSummary artifactFamily is not supported');
  }
  if (!['passed', 'blocked'].includes(summary.result)) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary result is unsupported');
  }
  for (const fieldName of [
    'redactionRequired',
    'descriptorOnly',
    'deliveryDescriptorScanPerformed',
    'runtimeExecutionPerformed',
    'repoWritePerformed',
    'matrixWritePerformed',
    'runtimeArtifactWritePerformed',
    'externalTelemetryDispatched',
    'siteAdapterInvoked',
    'downloaderInvoked',
    'sessionMaterialized',
    'allSectionsVerified',
  ]) {
    assertBoolean(summary[fieldName], `SiteCapabilityGraphFinalValidationSummary ${fieldName}`);
  }
  if (summary.redactionRequired !== true) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary redactionRequired must be true');
  }
  if (summary.descriptorOnly !== true) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary descriptorOnly must be true');
  }
  for (const fieldName of [
    'deliveryDescriptorScanPerformed',
    'runtimeExecutionPerformed',
    'repoWritePerformed',
    'matrixWritePerformed',
    'runtimeArtifactWritePerformed',
    'externalTelemetryDispatched',
    'siteAdapterInvoked',
    'downloaderInvoked',
    'sessionMaterialized',
  ]) {
    if (summary[fieldName] !== false) {
      throw new Error(`SiteCapabilityGraphFinalValidationSummary ${fieldName} must be false`);
    }
  }
  assertPlainObject(summary.statusCounts, 'SiteCapabilityGraphFinalValidationSummary statusCounts');
  assertPlainObject(summary.section19, 'SiteCapabilityGraphFinalValidationSummary section19');
  assertPlainObject(summary.section20, 'SiteCapabilityGraphFinalValidationSummary section20');
  assertPlainObject(summary.promotion, 'SiteCapabilityGraphFinalValidationSummary promotion');
  if (!Array.isArray(summary.gaps)) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary gaps must be an array');
  }
  if (summary.promotion.automaticMatrixMutationAllowed !== false) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary must not mutate the matrix automatically');
  }
  if (summary.promotion.requiresAgentBAcceptance !== true) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary requiresAgentBAcceptance must be true');
  }
  if (summary.result === 'passed') {
    if (summary.gaps.length !== 0) {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires no gaps');
    }
    if (summary.statusCounts.verified !== SITE_CAPABILITY_GRAPH_FINAL_SECTION_COUNT) {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires 20 verified sections');
    }
    if (summary.allSectionsVerified !== true) {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires allSectionsVerified');
    }
    if (summary.section19.readyForVerified !== true || summary.section20.readyForVerified !== true) {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires Section 19/20 readiness');
    }
    if (summary.section20.agentBReviewResult !== 'Accepted') {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires Agent B acceptance');
    }
    if (summary.promotion.matrixVerifiedPromotionAllowed !== true) {
      throw new Error('SiteCapabilityGraphFinalValidationSummary passed result requires verified promotion readiness');
    }
  } else if (summary.promotion.matrixVerifiedPromotionAllowed !== false) {
    throw new Error('SiteCapabilityGraphFinalValidationSummary blocked result must not allow verified promotion');
  }
  return true;
}

export function assertSiteCapabilityGraphFinalValidationPassed(summary = {}) {
  assertSiteCapabilityGraphFinalValidationSummaryCompatible(summary);
  if (summary.result !== 'passed') {
    throw new Error('Site Capability Graph final validation did not pass');
  }
  return true;
}
