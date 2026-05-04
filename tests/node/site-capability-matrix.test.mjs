import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MATRIX_URL = new URL('../../CONTRIBUTING.md', import.meta.url);

const EXPECTED_SECTION_NUMBERS = Array.from({ length: 20 }, (_, index) => index + 1);
const ALLOWED_STATUSES = new Set(['not_started', 'partial', 'implemented', 'verified', 'blocked']);
const REQUIRED_FIELDS = Object.freeze([
  'Section name',
  'Requirement summary',
  'Current status',
  'Existing code evidence',
  'Existing test evidence',
  'Verification command',
  'Verification result',
  'Current gaps',
  'Next smallest task',
  'Risk notes',
  'Last updated',
]);
const SECTION_17_TESTING_STRATEGY_CHECKLIST = Object.freeze([
  'CONTRIBUTING.md#focused-regression-batch-definition',
  'layeredValidationPolicy',
  'tests/node/site-capability-regression-batches.test.mjs',
  'tests/node/site-capability-matrix.test.mjs',
  'tests/node/downloads-runner.test.mjs',
  'tests/node/session-view.test.mjs',
  'tests/node/security-guard-redaction.test.mjs',
  'tests/node/risk-state.test.mjs',
  'tests/node/reason-codes.test.mjs',
  'LifecycleEvent',
  'tests/node/capability-hook.test.mjs',
  'tests/node/standard-task-list.test.mjs',
  'tests/node/download-policy.test.mjs',
]);
const SECTION_12_VERSIONING_READINESS_EVIDENCE = Object.freeze([
  Object.freeze({
    label: 'Kernel version evidence',
    pattern: /\bKernel\b.*\bversion(?:ing|s)?\b|\bversion(?:ing|s)?\b.*\bKernel\b/iu,
  }),
  Object.freeze({
    label: 'SiteAdapter version evidence',
    pattern: /\bSiteAdapter\b.*\bversion(?:ing|s)?\b|\bversion(?:ing|s)?\b.*\bSiteAdapter\b/iu,
  }),
  Object.freeze({
    label: 'CapabilityService version evidence',
    pattern: /\bCapability(?:\s+|-)?Service\b.*\bversion(?:ing|s)?\b|\bversion(?:ing|s)?\b.*\bCapability(?:\s+|-)?Service\b/iu,
  }),
  Object.freeze({
    label: 'downloader version evidence',
    pattern: /\bdownloader\b.*\bversion(?:ing|s)?\b|\bversion(?:ing|s)?\b.*\bdownloader\b/iu,
  }),
  Object.freeze({
    label: 'API catalog version evidence',
    pattern: /\b(?:API catalog|api-catalog|ApiCatalog)\b.*\bversion(?:ing|s)?\b|\bversion(?:ing|s)?\b.*\b(?:API catalog|api-catalog|ApiCatalog)\b/iu,
  }),
]);
const FINAL_VALIDATION_BLOCKED_RESULT_PATTERN =
  /\b(?:deferred|not\s+run|not-run|unrun|skipped|pending|todo|blocked|missing|absent|failed|failing|failure)\b/iu;
const SECTION_20_FINAL_VALIDATION_GATES = Object.freeze([
  Object.freeze({
    label: 'matrix focused gate',
    anchor: /\bmatrix\b/iu,
  }),
  Object.freeze({
    label: 'regression focused gate',
    anchor: /\bregression\b/iu,
  }),
  Object.freeze({
    label: 'download focused gate',
    anchor: /\bdownload(?:er|s)?\b/iu,
  }),
  Object.freeze({
    label: 'API focused gate',
    anchor: /\bAPI\b/iu,
  }),
  Object.freeze({
    label: 'security focused gate',
    anchor: /\bsecurity\b/iu,
  }),
]);

function parseSections(markdown) {
  const headings = [...markdown.matchAll(/^###\s+(\d+)\.\s+(.+)$/gmu)];
  return headings.map((heading, index) => {
    const next = headings[index + 1];
    return {
      number: Number(heading[1]),
      title: heading[2].trim(),
      body: markdown.slice(heading.index, next?.index ?? markdown.length),
    };
  });
}

function sectionByNumber(sections, sectionNumber) {
  const section = sections.find((candidate) => candidate.number === sectionNumber);
  assert.notEqual(section, undefined, `Section ${sectionNumber} must exist`);
  return section;
}

function getCurrentStatus(section) {
  return section.body.match(/^- Current status:\s+`([^`]+)`/mu)?.[1];
}

function getFieldValue(section, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return section.body.match(new RegExp(`^- ${escapedField}:\\s+(.+)$`, 'mu'))?.[1] ?? '';
}

function getReadinessEvidenceText(section, fields) {
  return fields
    .map((field) => getFieldValue(section, field))
    .join('\n')
    .replace(/\s+/gu, ' ')
    .trim();
}

function assertSection12VersioningReadiness(section) {
  const evidenceText = getReadinessEvidenceText(section, [
    'Existing code evidence',
    'Existing test evidence',
    'Current round code evidence',
    'Current round test evidence',
    'Verification result',
  ]);

  for (const requirement of SECTION_12_VERSIONING_READINESS_EVIDENCE) {
    assert.match(
      evidenceText,
      requirement.pattern,
      `Section 12 verified status requires ${requirement.label}`,
    );
  }
}

function splitValidationEvidenceClauses(evidenceText) {
  return evidenceText
    .split(/[;\n。；]/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function assertSection20FinalValidationReadiness(section) {
  const verificationResult = getFieldValue(section, 'Verification result');
  assert.match(
    verificationResult,
    /\bfinal validation evidence\b/iu,
    'Section 20 verified status must record explicit final validation evidence in Verification result',
  );
  assert.doesNotMatch(
    verificationResult,
    FINAL_VALIDATION_BLOCKED_RESULT_PATTERN,
    'Section 20 final validation evidence must not be missing, deferred, failed, skipped, pending, blocked, or unrun',
  );

  const clauses = splitValidationEvidenceClauses(verificationResult);
  for (const gate of SECTION_20_FINAL_VALIDATION_GATES) {
    const matchingClauses = clauses.filter((clause) => gate.anchor.test(clause));
    assert.notEqual(
      matchingClauses.length,
      0,
      `Section 20 final validation evidence must include ${gate.label} result`,
    );
    assert.equal(
      matchingClauses.some((clause) => /\b(?:passed|pass|ok|succeeded|success)\b/iu.test(clause)),
      true,
      `Section 20 final validation evidence must record a passing ${gate.label} result`,
    );
    assert.equal(
      matchingClauses.every((clause) => !FINAL_VALIDATION_BLOCKED_RESULT_PATTERN.test(clause)),
      true,
      `Section 20 final validation evidence must not defer or skip ${gate.label}`,
    );
  }
}

function makeSyntheticSection20(verificationResult) {
  return {
    number: 20,
    title: 'Final goal',
    body: `### 20. Final goal
- Verification result: ${verificationResult}
`,
  };
}

test('Site Capability implementation matrix covers all design sections with auditable fields', async () => {
  const markdown = await readFile(MATRIX_URL, 'utf8');
  const sections = parseSections(markdown);

  assert.deepEqual(
    sections.map((section) => section.number),
    EXPECTED_SECTION_NUMBERS,
    'implementation matrix must list sections 1-20 exactly once and in order',
  );

  for (const section of sections) {
    for (const field of REQUIRED_FIELDS) {
      assert.match(
        section.body,
        new RegExp(`^- ${field}:\\s+\\S`, 'mu'),
        `Section ${section.number} must include a non-empty ${field} field`,
      );
    }

    const status = getCurrentStatus(section);
    assert.equal(
      ALLOWED_STATUSES.has(status),
      true,
      `Section ${section.number} has invalid status ${status}`,
    );
  }
});

test('verified Site Capability matrix sections must record validation evidence', async () => {
  const markdown = await readFile(MATRIX_URL, 'utf8');
  const sections = parseSections(markdown);

  for (const section of sections) {
    const status = getCurrentStatus(section);
    if (status !== 'verified') {
      continue;
    }

    assert.match(section.body, /- Existing code evidence:\s+(?!.*(?:no runtime code changed|no production code changed))/iu);
    assert.match(section.body, /- Existing test evidence:\s+(?!.*(?:no test|not run|deferred))/iu);
    assert.match(section.body, /- Verification command:\s+`[^`]+`/iu);
    assert.match(section.body, /- Verification result:\s+(?!.*(?:not run|deferred|failed))/iu);
  }
});

test('Section 20 final goal cannot be verified before prerequisite sections and final validation evidence', async () => {
  const markdown = await readFile(MATRIX_URL, 'utf8');
  const sections = parseSections(markdown);
  const section20 = sectionByNumber(sections, 20);

  if (getCurrentStatus(section20) !== 'verified') {
    assert.equal(
      getCurrentStatus(section20),
      'partial',
      'Section 20 should stay partial until the final-goal readiness gate is satisfied',
    );
    return;
  }

  const incompletePrerequisites = sections
    .filter((section) => section.number >= 1 && section.number <= 19)
    .filter((section) => getCurrentStatus(section) !== 'verified')
    .map((section) => section.number);

  assert.deepEqual(
    incompletePrerequisites,
    [],
    'Section 20 cannot be verified until Sections 1-19 are all verified',
  );

  assertSection20FinalValidationReadiness(section20);

  assertSection12VersioningReadiness(sectionByNumber(sections, 12));
});

test('Section 20 final validation evidence requires all focused gate results to pass', () => {
  assertSection20FinalValidationReadiness(
    makeSyntheticSection20(
      '2026-05-03 final validation evidence: matrix focused gate passed; regression focused gate passed; download focused gate passed; API focused gate passed; security focused gate passed.',
    ),
  );

  assert.throws(
    () =>
      assertSection20FinalValidationReadiness(
        makeSyntheticSection20(
          '2026-05-03 final validation evidence: matrix focused gate passed; regression focused gate passed; download focused gate passed; API focused gate passed.',
        ),
      ),
    /security focused gate result/u,
  );

  assert.throws(
    () =>
      assertSection20FinalValidationReadiness(
        makeSyntheticSection20(
          '2026-05-03 final validation evidence: matrix focused gate passed; regression focused gate passed; download focused gate deferred; API focused gate passed; security focused gate passed.',
        ),
      ),
    /must not be missing, deferred/u,
  );

  assert.throws(
    () =>
      assertSection20FinalValidationReadiness(
        makeSyntheticSection20(
          '2026-05-03 final validation evidence: matrix focused gate passed; regression focused gate passed; download focused gate passed; API focused gate not run; security focused gate passed.',
        ),
      ),
    /must not be missing, deferred/u,
  );
});

test('Section 12 cannot be verified without complete versioning readiness evidence', async () => {
  const markdown = await readFile(MATRIX_URL, 'utf8');
  const sections = parseSections(markdown);
  const section12 = sectionByNumber(sections, 12);

  if (getCurrentStatus(section12) !== 'verified') {
    assert.notEqual(
      getCurrentStatus(section12),
      'verified',
      'Section 12 is not verified, so versioning readiness evidence is not yet required',
    );
    return;
  }

  assertSection12VersioningReadiness(section12);
});

test('Section 17 records the focused testing strategy checklist for priority coverage', async () => {
  const markdown = await readFile(MATRIX_URL, 'utf8');
  const sections = parseSections(markdown);
  const section = sectionByNumber(sections, 17);
  const normalizedBody = section.body.replace(/\\/gu, '/');

  assert.match(section.body, /focused regression batch/iu);
  assert.match(section.body, /directly related tests/iu);
  assert.match(section.body, /defer wildcard Node(?:\/| and )Python full suites/iu);

  for (const evidence of SECTION_17_TESTING_STRATEGY_CHECKLIST) {
    assert.equal(
      normalizedBody.includes(evidence),
      true,
      `Section 17 testing strategy must record focused evidence for ${evidence}`,
    );
  }
});
