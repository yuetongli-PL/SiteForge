import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION,
  assertFocusedRegressionBatchDefinitionCompatible,
} from '../../src/sites/capability/focused-regression-batches.mjs';
import { assertSchemaCompatible } from '../../src/sites/capability/compatibility-registry.mjs';

const CONTRIBUTING_URL = new URL('../../CONTRIBUTING.md', import.meta.url);
const EXPECTED_BATCH_IDS = [
  'scl-matrix-schema-compatibility',
  'scl-priority-focused-guards',
  'scl-redaction-trust-boundaries',
  'scl-api-knowledge-lifecycle',
  'scl-downloader-boundaries',
  'scl-risk-lifecycle-observability',
  'scl-recent-high-value-focused-regression',
];
const REQUIRED_TEST_FILES_BY_BATCH = {
  'scl-matrix-schema-compatibility': [
    'tests/node/site-capability-matrix.test.mjs',
    'tests/node/schema-inventory.test.mjs',
    'tests/node/compatibility-registry.test.mjs',
  ],
  'scl-priority-focused-guards': [
    'tests/node/architecture-import-rules.test.mjs',
    'tests/node/network-capture.test.mjs',
    'tests/node/session-view.test.mjs',
    'tests/node/site-capability-matrix.test.mjs',
  ],
  'scl-redaction-trust-boundaries': [
    'tests/node/security-guard-redaction.test.mjs',
    'tests/node/session-view.test.mjs',
    'tests/node/download-media-executor.test.mjs',
  ],
  'scl-api-knowledge-lifecycle': [
    'tests/node/network-capture.test.mjs',
    'tests/node/capture-manifest-redaction.test.mjs',
    'tests/node/api-discovery.test.mjs',
    'tests/node/api-candidates.test.mjs',
    'tests/node/site-adapter-contract.test.mjs',
  ],
  'scl-downloader-boundaries': [
    'tests/node/architecture-import-rules.test.mjs',
    'tests/node/downloads-runner.test.mjs',
    'tests/node/standard-task-list.test.mjs',
    'tests/node/download-policy.test.mjs',
    'tests/node/planner-policy-handoff.test.mjs',
  ],
  'scl-risk-lifecycle-observability': [
    'tests/node/risk-state.test.mjs',
    'tests/node/reason-codes.test.mjs',
    'tests/node/lifecycle-events.test.mjs',
    'tests/node/capability-hook.test.mjs',
  ],
  'scl-recent-high-value-focused-regression': [
    'tests/node/downloads-runner.test.mjs',
    'tests/node/architecture-import-rules.test.mjs',
    'tests/node/session-view.test.mjs',
    'tests/node/site-session-runner.test.mjs',
    'tests/node/site-session-governance.test.mjs',
    'tests/node/security-guard-redaction.test.mjs',
    'tests/node/schema-governance.test.mjs',
    'tests/node/compatibility-registry.test.mjs',
    'tests/node/capability-hook.test.mjs',
    'tests/node/site-capability-matrix.test.mjs',
  ],
};
const RECENT_HIGH_VALUE_BATCH_ID = 'scl-recent-high-value-focused-regression';
const REQUIRED_RECENT_HIGH_VALUE_EVIDENCE = [
  'main focused gate 291/291',
  '2026-05-03 bounded rerun 292/292',
  '2026-05-03 resumed bounded rerun 296/296',
  'downloads-runner included',
  'architecture-import-rules included',
  'session-view included',
  'site-session-runner included',
  'site-session-governance included',
  'security-guard-redaction included',
  'schema-governance included',
  'compatibility-registry included',
  'capability-hook included',
  'site-capability-matrix included',
];
const REQUIRED_FOCUSED_TEST_ENTRIES_BY_SECTION = {
  1: {
    batchId: 'scl-priority-focused-guards',
    testFiles: [
      'tests/node/architecture-import-rules.test.mjs',
    ],
  },
  2: {
    batchId: 'scl-priority-focused-guards',
    testFiles: [
      'tests/node/architecture-import-rules.test.mjs',
    ],
  },
  3: {
    batchId: 'scl-priority-focused-guards',
    testFiles: [
      'tests/node/architecture-import-rules.test.mjs',
    ],
  },
  4: {
    batchId: 'scl-priority-focused-guards',
    testFiles: [
      'tests/node/network-capture.test.mjs',
    ],
  },
  10: {
    batchId: 'scl-downloader-boundaries',
    testFiles: [
      'tests/node/downloads-runner.test.mjs',
      'tests/node/standard-task-list.test.mjs',
      'tests/node/download-policy.test.mjs',
    ],
  },
  13: {
    batchId: 'scl-redaction-trust-boundaries',
    testFiles: [
      'tests/node/session-view.test.mjs',
      'tests/node/download-media-executor.test.mjs',
    ],
  },
  14: {
    batchId: 'scl-redaction-trust-boundaries',
    testFiles: [
      'tests/node/security-guard-redaction.test.mjs',
      'tests/node/download-media-executor.test.mjs',
    ],
  },
  15: {
    batchId: 'scl-risk-lifecycle-observability',
    testFiles: [
      'tests/node/risk-state.test.mjs',
      'tests/node/reason-codes.test.mjs',
      'tests/node/lifecycle-events.test.mjs',
    ],
  },
  16: {
    batchId: 'scl-risk-lifecycle-observability',
    testFiles: [
      'tests/node/lifecycle-events.test.mjs',
      'tests/node/capability-hook.test.mjs',
    ],
  },
  18: {
    batchId: 'scl-risk-lifecycle-observability',
    testFiles: [
      'tests/node/lifecycle-events.test.mjs',
      'tests/node/capability-hook.test.mjs',
    ],
  },
  19: {
    batchId: 'scl-downloader-boundaries',
    testFiles: [
      'tests/node/standard-task-list.test.mjs',
      'tests/node/download-policy.test.mjs',
    ],
  },
  20: {
    batchId: 'scl-priority-focused-guards',
    testFiles: [
      'tests/node/site-capability-matrix.test.mjs',
    ],
  },
};
const FORBIDDEN_COMMAND_PATTERNS = [
  /\*/u,
  /python\s+-m\s+unittest/iu,
  /npm\s+test/iu,
  /pnpm\s+test/iu,
  /node\s+--test\s+tests\/node(?:\s|$)/iu,
];
const REQUIRED_LAYERED_VALIDATION_POLICIES = [
  'directTask',
  'sameTypeBatch',
  'matrix',
  'fullSuite',
];

async function readFocusedRegressionBatchDefinition() {
  const markdown = await readFile(CONTRIBUTING_URL, 'utf8');
  const match = markdown.match(
    /<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_BEGIN -->\s*```json[^\n]*\n([\s\S]*?)\n```\s*<!-- SCL_FOCUSED_REGRESSION_BATCHES_JSON_END -->/u,
  );
  assert.notEqual(match, null, 'CONTRIBUTING.md must embed focused regression batches JSON');
  return JSON.parse(match[1]);
}

function testFilesFromCommand(command) {
  return [...command.matchAll(/\btests\/node\/[A-Za-z0-9_.-]+\.test\.mjs\b/gu)]
    .map((match) => match[0]);
}

test('focused Site Capability regression batches are explicit and bounded', async () => {
  const definition = await readFocusedRegressionBatchDefinition();

  assert.equal(definition.schemaVersion, FOCUSED_REGRESSION_BATCH_DEFINITION_SCHEMA_VERSION);
  assert.equal(assertFocusedRegressionBatchDefinitionCompatible(definition), true);
  assert.equal(assertSchemaCompatible('FocusedRegressionBatchDefinition', definition), true);
  assert.deepEqual(definition.batches.map((batch) => batch.id), EXPECTED_BATCH_IDS);
  assert.deepEqual(Object.keys(definition.layeredValidationPolicy), REQUIRED_LAYERED_VALIDATION_POLICIES);
  assert.match(definition.layeredValidationPolicy.directTask, /directly related/u);
  assert.match(definition.layeredValidationPolicy.sameTypeBatch, /3-5 same-type tasks/u);
  assert.match(definition.layeredValidationPolicy.sameTypeBatch, /status upgrade/u);
  assert.match(definition.layeredValidationPolicy.matrix, /after every implementation matrix update/u);
  assert.match(definition.layeredValidationPolicy.fullSuite, /Defer wildcard Node and Python full suites/u);
  assert.equal(definition.fullSuitePolicy.nodeWildcard.includes('deferred'), true);
  assert.equal(definition.fullSuitePolicy.pythonUnittest.includes('deferred'), true);

  const seenCommands = new Set();
  for (const batch of definition.batches) {
    assert.equal(typeof batch.command, 'string');
    assert.equal(batch.command.startsWith('node --test '), true);
    assert.equal(seenCommands.has(batch.command), false);
    seenCommands.add(batch.command);
    assert.equal(Array.isArray(batch.sectionFocus), true);
    assert.equal(batch.sectionFocus.length > 0, true);
    assert.equal(typeof batch.purpose, 'string');
    assert.equal(batch.purpose.length > 0, true);

    for (const pattern of FORBIDDEN_COMMAND_PATTERNS) {
      assert.equal(
        pattern.test(batch.command),
        false,
        `${batch.id} must stay focused and avoid wildcard/full-suite commands`,
      );
    }

    const testFiles = testFilesFromCommand(batch.command);
    assert.equal(testFiles.length > 0, true);
    assert.deepEqual(
      testFiles,
      REQUIRED_TEST_FILES_BY_BATCH[batch.id],
      `${batch.id} must keep the curated focused test file inventory explicit`,
    );
    for (const testFile of testFiles) {
      await access(new URL(`../../${testFile}`, import.meta.url));
    }
  }

  for (const [section, entry] of Object.entries(REQUIRED_FOCUSED_TEST_ENTRIES_BY_SECTION)) {
    const batch = definition.batches.find((candidate) => candidate.id === entry.batchId);
    assert.notEqual(batch, undefined, `Section ${section} must name an existing focused regression batch`);
    assert.equal(
      batch.sectionFocus.includes(Number(section)),
      true,
      `Section ${section} must be explicitly listed in ${entry.batchId}.sectionFocus`,
    );

    const testFiles = testFilesFromCommand(batch.command);
    for (const testFile of entry.testFiles) {
      assert.equal(
        testFiles.includes(testFile),
        true,
        `Section ${section} must keep ${testFile} in its focused regression entry`,
      );
    }
  }

  const recentHighValueBatch = definition.batches.find((batch) => batch.id === RECENT_HIGH_VALUE_BATCH_ID);
  assert.notEqual(recentHighValueBatch, undefined);
  assert.equal(
    recentHighValueBatch.purpose.includes('291/291 main focused gate'),
    true,
  );
  assert.equal(
    recentHighValueBatch.purpose.includes('292/292 on 2026-05-03'),
    true,
  );
  assert.equal(
    recentHighValueBatch.purpose.includes('296/296 on 2026-05-03'),
    true,
  );
  assert.equal(
    recentHighValueBatch.purpose.includes('Prefer this precise batch over wildcard/full-suite reruns'),
    true,
  );
  assert.deepEqual(recentHighValueBatch.recentPassingEvidence, REQUIRED_RECENT_HIGH_VALUE_EVIDENCE);
  assert.deepEqual(
    recentHighValueBatch.sectionFocus,
    [1, 2, 3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  );
});
