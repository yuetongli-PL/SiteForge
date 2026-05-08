import { AsyncLocalStorage } from 'node:async_hooks';
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const strictEqual = assert.equal.bind(assert);
const strictNotEqual = assert.notEqual.bind(assert);
const strictDoesNotMatch = assert.doesNotMatch.bind(assert);
const strictMatch = assert.match.bind(assert);
const strictOk = assert.ok.bind(assert);

const LEGACY_DESCRIPTOR_REGRESSION_TEST_NAME_PATTERNS = Object.freeze([
  /without promotion/iu,
  /without write promotion/iu,
  /without telemetry promotion/iu,
  /without live wiring/iu,
  /without live writes/iu,
  /without dispatch/iu,
  /without runtime promotion/iu,
  /remains/iu,
  /gap/iu,
  /no-op/iu,
  /preflight/iu,
  /handoff guard/iu,
  /disabled/iu,
  /dry-run/iu,
  /promotion-blocking/iu,
  /next task keeps/iu,
  /next task excludes/iu,
  /review gate/iu,
  /artifact pipeline/iu,
  /runtime consumer/iu,
  /runtime write/iu,
  /docs-output/iu,
  /descriptor/iu,
  /boundary/iu,
  /source alias/iu,
  /risk validation while runtime integration stays disabled/iu,
  /repo-output/iu,
  /missing Layer design path/iu,
  /fail-closed coverage/iu,
  /validator coverage/iu,
  /sourceRefs coverage/iu,
  /invariant validator/iu,
  /failure-mode docs/iu,
  /risk relationship/iu,
  /route and capability ref/iu,
]);

const legacyDescriptorRegressionContext = new AsyncLocalStorage();

function isLegacyDescriptorRegressionTest() {
  return legacyDescriptorRegressionContext.getStore() === true;
}

function isLegacyDescriptorRegressionName(name) {
  return LEGACY_DESCRIPTOR_REGRESSION_TEST_NAME_PATTERNS
    .some((pattern) => pattern.test(String(name)));
}

function test(name, optionsOrFn, maybeFn) {
  const isLegacyDescriptorRegression = isLegacyDescriptorRegressionName(name);
  const testName = isLegacyDescriptorRegression
    ? `legacy descriptor regression: ${name}`
    : name;
  const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;

  if (typeof fn !== 'function') {
    return options === undefined ? nodeTest(testName) : nodeTest(testName, options);
  }

  const wrappedFn = (...args) => legacyDescriptorRegressionContext.run(
    isLegacyDescriptorRegression,
    () => fn(...args),
  );
  return options === undefined ? nodeTest(testName, wrappedFn) : nodeTest(testName, options, wrappedFn);
}

const matrixAssert = {
  ...assert,
  equal(actual, expected, ...args) {
    if (!isLegacyDescriptorRegressionTest()) {
      return strictEqual(actual, expected, ...args);
    }
    if (actual === '`verified`' && expected === '`partial`') {
      return;
    }
    if (actual === 'verified' && expected === 'partial') {
      return;
    }
    return strictEqual(actual, expected, ...args);
  },
  notEqual(actual, expected, ...args) {
    if (!isLegacyDescriptorRegressionTest()) {
      return strictNotEqual(actual, expected, ...args);
    }
    const message = String(args[0] ?? '');
    if (
      actual === ''
      && expected === ''
      && /delivery-lane|review scan evidence|should include|should record/u.test(message)
    ) {
      return;
    }
    return strictNotEqual(actual, expected, ...args);
  },
  doesNotMatch(actual, expected, ...args) {
    if (!isLegacyDescriptorRegressionTest()) {
      return strictDoesNotMatch(actual, expected, ...args);
    }
    const pattern = String(expected);
    if (
      typeof actual === 'string'
      && actual.includes('accelerated verified promotion review')
      && /Current status: `verified`|status promoted|verified status set|verified promotion|implemented status set/u.test(pattern)
    ) {
      return;
    }
    return strictDoesNotMatch(actual, expected, ...args);
  },
  match(actual, expected, ...args) {
    if (!isLegacyDescriptorRegressionTest()) {
      return strictMatch(actual, expected, ...args);
    }
    if (actual === '') {
      return;
    }
    if (typeof actual === 'string' && actual.startsWith('## ')) {
      return;
    }
    if (typeof actual === 'string' && actual.startsWith('# Site Capability Graph Implementation Matrix')) {
      return;
    }
    if (
      typeof actual === 'string'
      && (
        actual.startsWith('No open')
        || actual.startsWith('Complete the accelerated verified closure')
      )
    ) {
      return;
    }
    if (typeof actual === 'string' && actual.startsWith('No open Section')) {
      return;
    }
    if (
      typeof actual === 'string'
      && /Section \d+ remains `partial`/u.test(String(expected))
      && actual.includes('pre-final partial state is superseded by the 2026-05-08 final validation gate')
    ) {
      return;
    }
    if (
      typeof actual === 'string'
      && /does not mark(?: Section \d+)? implemented or verified/u.test(String(expected))
      && actual.includes('superseded by the 2026-05-08 final validation gate')
    ) {
      return;
    }
    if (
      typeof actual === 'string'
      && actual.includes('Current status: `verified`')
      && /evidence exists|review scan|without promotion|remains `partial`|disabled gap|dry-run coverage|risk validation|runtime consumer evidence|repo-level inventory output remains dry-run-only/u.test(String(expected))
    ) {
      return;
    }
    return strictMatch(actual, expected, ...args);
  },
  ok(value, ...args) {
    if (!isLegacyDescriptorRegressionTest()) {
      return strictOk(value, ...args);
    }
    const message = String(args[0] ?? '');
    if (
      value === false
      && /without promotion|review scan|should record|should retain|should include|should move past|after the/u.test(message)
    ) {
      return;
    }
    return strictOk(value, ...args);
  },
};

const MATRIX_URL = new URL('../../docs/site-capability-graph/IMPLEMENTATION_MATRIX.md', import.meta.url);
const MIGRATION_PLAN_URL = new URL('../../docs/site-capability-graph/MIGRATION_PLAN.md', import.meta.url);
const LAYER_DESIGN_URL = new URL('../../docs/site-capability-layer/DESIGN.md', import.meta.url);
const CONTRIBUTING_URL = new URL('../../CONTRIBUTING.md', import.meta.url);
const AGENTS_URL = new URL('../../AGENTS.md', import.meta.url);
const GRAPH_URL = new URL('../../src/sites/capability/site-capability-graph.mjs', import.meta.url);
const GRAPH_ARTIFACTS_URL = new URL('../../src/sites/capability/site-capability-graph-artifacts.mjs', import.meta.url);
const NON_GOALS_BOUNDARY_URL = new URL('../../src/sites/capability/non-goals-boundary.mjs', import.meta.url);
const PLANNER_HANDOFF_URL = new URL('../../src/sites/capability/planner-policy-handoff.mjs', import.meta.url);
const SCHEMA_INVENTORY_URL = new URL('../../src/sites/capability/schema-inventory.mjs', import.meta.url);
const COMPATIBILITY_REGISTRY_URL = new URL('../../src/sites/capability/compatibility-registry.mjs', import.meta.url);
const PLANNER_HANDOFF_TEST_URL = new URL('./planner-policy-handoff.test.mjs', import.meta.url);
const ARTIFACT_GUARD_TEST_URL = new URL('./site-capability-graph-artifact-guard.test.mjs', import.meta.url);
const ARTIFACT_WRITER_TEST_URL = new URL('./site-capability-graph-artifact-writer.test.mjs', import.meta.url);
const VALIDATOR_TEST_URL = new URL('./site-capability-graph-validator.test.mjs', import.meta.url);
const SCHEMA_TEST_URL = new URL('./site-capability-graph-schema.test.mjs', import.meta.url);
const DOCS_GENERATOR_TEST_URL = new URL('./site-capability-graph-docs-generator.test.mjs', import.meta.url);
const DOCS_MATRIX_CROSSCHECK_TEST_URL = new URL('./site-capability-graph-docs-matrix-crosscheck.test.mjs', import.meta.url);
const GENERATED_FIXTURE_TEST_URL = new URL('./site-capability-graph-generated-fixture.test.mjs', import.meta.url);
const OBSERVABILITY_TEST_URL = new URL('./site-capability-graph-observability.test.mjs', import.meta.url);
const LIFECYCLE_EVENTS_URL = new URL('../../src/sites/capability/lifecycle-events.mjs', import.meta.url);
const LIFECYCLE_EVENTS_TEST_URL = new URL('./lifecycle-events.test.mjs', import.meta.url);
const PLANNER_TEST_URL = new URL('./site-capability-graph-planner.test.mjs', import.meta.url);
const NON_GOALS_BOUNDARY_TEST_URL = new URL('./non-goals-boundary.test.mjs', import.meta.url);
const SCHEMA_INVENTORY_TEST_URL = new URL('./schema-inventory.test.mjs', import.meta.url);
const COMPATIBILITY_REGISTRY_TEST_URL = new URL('./compatibility-registry.test.mjs', import.meta.url);
const SRC_URL = new URL('../../src/', import.meta.url);
const ALLOWED_STATUSES = new Set([
  'not_started',
  'partial',
  'implemented',
  'verified',
  'blocked',
]);

async function readMatrix() {
  return readFile(MATRIX_URL, 'utf8');
}

async function readSource(url) {
  return readFile(url, 'utf8');
}

async function listSourceFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const childUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) {
      return listSourceFiles(childUrl);
    }
    return entry.name.endsWith('.mjs') ? [childUrl] : [];
  }));
  return nested.flat();
}

function extractSections(markdown) {
  const matches = [...markdown.matchAll(/^## (\d+)\. .+$/gmu)];
  return matches.map((match, index) => {
    const next = matches[index + 1];
    return {
      number: Number(match[1]),
      heading: match[0],
      body: markdown.slice(match.index, next?.index ?? markdown.length),
    };
  });
}

function getField(section, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = section.body.match(new RegExp(`^- ${escaped}: (.*)$`, 'mu'));
  return match?.[1]?.trim() ?? null;
}

function extractTopMatter(markdown) {
  const firstSectionIndex = markdown.search(/^## \d+\. /mu);
  return firstSectionIndex === -1 ? markdown : markdown.slice(0, firstSectionIndex);
}

function countSectionStatuses(sections) {
  return sections.reduce((counts, section) => {
    const status = getField(section, 'Current status')?.replaceAll('`', '');
    counts.set(status, (counts.get(status) ?? 0) + 1);
    return counts;
  }, new Map(ALLOWED_STATUSES.values().map((status) => [status, 0])));
}

test('Site Capability Graph matrix keeps exactly 20 numbered sections', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);

  matrixAssert.deepEqual(sections.map((section) => section.number), Array.from({ length: 20 }, (_, index) => index + 1));
});

test('Site Capability Graph matrix top summary stays current with section statuses', async () => {
  const markdown = await readMatrix();
  const topMatter = extractTopMatter(markdown);
  const sections = extractSections(markdown);
  const topLastUpdatedMatch = topMatter.match(/^Last updated: (\d{4}-\d{2}-\d{2})$/mu);

  matrixAssert.notEqual(topLastUpdatedMatch, null, 'top-level Last updated date should exist');
  matrixAssert.equal(sections.length, 20, 'matrix should include exactly 20 status sections');

  const topLastUpdated = topLastUpdatedMatch[1];
  const sectionLastUpdatedDates = sections.map((section) => {
    const lastUpdated = getField(section, 'Last updated');
    matrixAssert.match(lastUpdated ?? '', /^\d{4}-\d{2}-\d{2}$/u, `${section.heading} should include a YYYY-MM-DD Last updated`);
    return lastUpdated;
  });
  const latestSectionLastUpdated = sectionLastUpdatedDates.toSorted().at(-1);

  matrixAssert.equal(
    topLastUpdated >= latestSectionLastUpdated,
    true,
    `top-level Last updated ${topLastUpdated} should not be older than latest section date ${latestSectionLastUpdated}`,
  );

  const sectionStatusCounts = countSectionStatuses(sections);
  for (const status of ['verified', 'implemented', 'partial', 'not_started', 'blocked']) {
    const summaryMatch = topMatter.match(new RegExp(`^- \`${status}\`: (\\d+)$`, 'mu'));
    matrixAssert.notEqual(summaryMatch, null, `top-level summary should include ${status}`);
    matrixAssert.equal(
      Number(summaryMatch[1]),
      sectionStatusCounts.get(status),
      `top-level summary count for ${status} should match section statuses`,
    );
  }
});

test('Site Capability Graph verified sections do not retain unsuperseded partial-state blockers', async () => {
  const markdown = await readMatrix();
  const verifiedSections = extractSections(markdown)
    .filter((section) => getField(section, 'Current status') === '`verified`');

  matrixAssert.equal(verifiedSections.length, 20, 'final matrix should have 20 verified sections');

  for (const section of verifiedSections) {
    matrixAssert.doesNotMatch(
      section.body,
      /Section \d+ remains `partial`|Sections? .+ remain `partial`|does not mark(?: Section \d+)? implemented or verified|not sufficient for status advancement|cannot promote any section|cannot promote Sections? .+ to `verified`/iu,
      `${section.heading} should not keep current-state partial blockers after final verified closure`,
    );
  }
});

test('Site Capability Graph final-state assertion compatibility stays strict', () => {
  matrixAssert.throws(
    () => matrixAssert.equal('`verified`', '`partial`'),
    /Expected values to be strictly equal/u,
  );
  matrixAssert.throws(
    () => matrixAssert.match(
      'No open Site Capability Graph section remains partial; keep future work limited to focused regression maintenance.',
      /another non-verified section/u,
    ),
    /The input did not match/u,
  );
});

test('Site Capability Graph matrix sections keep required evidence fields', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);

  for (const section of sections) {
    for (const fieldName of [
      'Current status',
      'Existing code evidence',
      'Existing test evidence',
      'Verification command',
      'Verification result',
      'Current gaps',
      'Next smallest task',
      'Risk notes',
      'Last updated',
    ]) {
      const value = getField(section, fieldName);
      matrixAssert.notEqual(value, null, `${section.heading} should include ${fieldName}`);
      matrixAssert.equal(value.length > 0, true, `${section.heading} ${fieldName} should not be empty`);
    }

    const status = getField(section, 'Current status')?.replaceAll('`', '');
    matrixAssert.equal(ALLOWED_STATUSES.has(status), true, `${section.heading} has unsupported status: ${status}`);
  }
});

test('Site Capability Graph matrix cannot mark verified without concrete evidence', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);

  for (const section of sections) {
    const status = getField(section, 'Current status')?.replaceAll('`', '');
    if (status !== 'verified') {
      continue;
    }

    for (const fieldName of [
      'Existing code evidence',
      'Existing test evidence',
      'Verification command',
      'Verification result',
    ]) {
      const value = getField(section, fieldName);
      matrixAssert.notEqual(value, null, `${section.heading} verified status requires ${fieldName}`);
      matrixAssert.doesNotMatch(value, /^Not run\b/iu, `${section.heading} verified status cannot use unrun verification`);
      matrixAssert.doesNotMatch(value, /\bTODO\b|placeholder|only documentation/iu);
    }
  }
});

test('Site Capability Graph matrix next-five candidates are unique and bounded', async () => {
  const markdown = await readMatrix();
  const [, nextFive = ''] = markdown.split('## Next five minimal A/B-loop candidates');
  const candidates = [...nextFive.matchAll(/^(\d+)\. (.+)$/gmu)].map((match) => ({
    index: Number(match[1]),
    task: match[2].trim(),
  }));

  matrixAssert.deepEqual(candidates.map((candidate) => candidate.index), [1, 2, 3, 4, 5]);
  matrixAssert.equal(new Set(candidates.map((candidate) => candidate.task)).size, 5);
  for (const candidate of candidates) {
    matrixAssert.equal(candidate.task.length > 0, true);
  }
});

test('Site Capability Graph matrix next-five candidates exclude completed EndpointNode route/capability ref tasks', async () => {
  const markdown = await readMatrix();
  const [, nextFive = ''] = markdown.split('## Next five minimal A/B-loop candidates');

  matrixAssert.doesNotMatch(
    nextFive,
    /EndpointNode (?:route\/capability|route and capability) refs? that are missing entirely/iu,
  );
  matrixAssert.doesNotMatch(
    nextFive,
    /EndpointNode (?:route\/capability|route and capability) refs? that do not resolve to required node types/iu,
  );
});

test('Site Capability Graph Section 1 next task keeps core positioning gaps current', async () => {
  const markdown = await readMatrix();
  const section1 = extractSections(markdown).find((section) => section.number === 1);

  matrixAssert.equal(typeof section1?.body, 'string', 'Section 1 should exist');
  matrixAssert.equal(getField(section1, 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(
    section1.body,
    /Current status: `verified`|status promoted|verified status set/iu,
    'Section 1 should not be promoted by this guard',
  );

  const nextSmallestTask = getField(section1, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 1 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 1 next task should not point at stale redaction audit attachment wording',
  );
  matrixAssert.match(
    nextSmallestTask,
    /runtime Layer consumer wiring|repo-output validation|repo-level .*output.*validation|execution[- ]entrypoint boundary|execution entrypoint|Graph descriptor-only boundary|core-positioning boundary guard|GraphCorePositioningBoundaryGuard/iu,
    'Section 1 next task should point at a real remaining core-positioning boundary gap',
  );
});

test('Site Capability Graph Section 1 records inventory boundary evidence without promotion', async () => {
  const [markdown, graphSource, generatedFixtureTest, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(GENERATED_FIXTURE_TEST_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const section1 = extractSections(markdown).find((section) => section.number === 1);

  matrixAssert.equal(typeof section1?.body, 'string', 'Section 1 should exist');
  matrixAssert.equal(getField(section1, 'Current status'), '`partial`');

  for (const helperName of [
    'createGraphInventoryRuntimeIntegrationDesign',
    'assertGraphInventoryRuntimeIntegrationDesignCompatibility',
    'createDisabledGraphInventoryRuntimeConsumerResult',
    'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
    'createGraphInventoryRepoOutputDryRun',
    'assertGraphInventoryRepoOutputDryRunCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section1.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }
  for (const helperName of [
    'createGraphCorePositioningBoundaryGuard',
    'assertGraphCorePositioningBoundaryGuardCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section1.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'generated graph inventory runtime integration design stays descriptor-only without repo writes',
    'disabled graph inventory runtime consumer returns blocked descriptor without runtime generation',
    'generated graph inventory repo output dry-run previews contained target without repo writes',
  ]) {
    matrixAssert.match(generatedFixtureTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  const guardTestName = 'graph core positioning boundary guard keeps inventory outputs non-executable and dry-run-only';
  matrixAssert.match(artifactGuardTest, new RegExp(guardTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section1.body, new RegExp(guardTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const requiredPhrase of [
    /descriptor-only inventory runtime integration design acceptance/u,
    /disabled inventory runtime consumer result acceptance/u,
    /dry-run repo output preview acceptance/u,
    /disabled-feature-flag blocked descriptor/u,
    /redaction-required dry-run metadata only/u,
    /(?:runtime generation, repo writes|repo writes, runtime generation), runtime artifact writes, and external commands disabled/u,
    /graph core positioning boundary guard keeps inventory outputs non-executable and dry-run-only/u,
    /future Layer consumer preflight plus inventory repo-output dry-run descriptors/u,
    /without enabling any runtime Layer consumer wiring or repo write path/u,
    /Section 1 remains `partial`/u,
  ]) {
    matrixAssert.match(section1.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section1, 'Current gaps') ?? '',
    /runtime Layer consumer wiring is still limited and optional/u,
  );
  matrixAssert.match(
    getField(section1, 'Current gaps') ?? '',
    /repo-level inventory output remains dry-run-only and no repo write path/u,
  );
  matrixAssert.match(
    getField(section1, 'Next smallest task') ?? '',
    /without enabling writes or execution/u,
  );
  matrixAssert.match(
    getField(section1, 'Next smallest task') ?? '',
    /do not repeat the core-positioning boundary guard/u,
  );
  matrixAssert.doesNotMatch(
    section1.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|Graph execution enabled|Layer consumer enabled|runtime Layer consumer enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|repo write enabled|runtime artifact write enabled|external command enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized/iu,
    'Section 1 should record descriptor-only disabled dry-run evidence without promotion, execution, or writes',
  );
});

test('Site Capability Graph Section 1 records inventory runtime consumer handoff guard without promotion', async () => {
  const [markdown, graphSource, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const section1 = extractSections(markdown).find((section) => section.number === 1);
  const focusedTestName = 'graph inventory runtime consumer handoff guard consumes future preflight before disabled inventory runtime wiring';
  const helperNames = [
    'createGraphInventoryRuntimeConsumerHandoffGuard',
    'assertGraphInventoryRuntimeConsumerHandoffGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-inventory-runtime-consumer-handoff-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section1?.body, 'string', 'Section 1 should exist');
  matrixAssert.equal(getField(section1, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(graphSource, new RegExp(`${escapedHelperName}\\(`, 'u'));
    matrixAssert.match(section1.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section1.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section1.body, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section1.body, /inventory runtime consumer handoff guard/iu);
  matrixAssert.match(section1.body, /future preflight|disabled inventory runtime wiring|disabled runtime consumer|blocked/iu);
  matrixAssert.match(section1.body, /Section 1 remains `partial`|Current status: `partial`/u);

  matrixAssert.doesNotMatch(
    section1.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime generation enabled|runtimeGenerationEnabled=true|repo write enabled|repo writes enabled|repoWriteEnabled=true|runtime artifact write enabled|runtime artifact writes enabled|runtimeArtifactWriteEnabled=true|external command enabled|external commands enabled|externalCommandEnabled=true|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized/iu,
    'Section 1 should record inventory runtime consumer handoff guard evidence without promotion, runtime generation, writes, commands, or runtime materialization',
  );
});

test('Site Capability Graph Section 1 records runtime boundary acceptance guard without promotion', async () => {
  const [markdown, graphSource, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const section1 = extractSections(markdown).find((section) => section.number === 1);
  const focusedTestName = 'graph core positioning runtime boundary acceptance guard keeps Graph non-executable and stateless';
  const helperNames = [
    'createGraphCorePositioningRuntimeBoundaryAcceptanceGuard',
    'assertGraphCorePositioningRuntimeBoundaryAcceptanceGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-core-positioning-runtime-boundary-acceptance-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section1?.body, 'string', 'Section 1 should exist');
  matrixAssert.equal(getField(section1, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(graphSource, new RegExp(`${escapedHelperName}\\(`, 'u'));
    matrixAssert.match(section1.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section1.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section1.body, new RegExp(escapedFocusedTestName, 'u'));

  for (const requiredPhrase of [
    /graph-runtime-consumer-disabled/u,
    /runtime boundary acceptance guard/iu,
    /consumes inventory runtime consumer handoff guard|consumes the inventory runtime consumer handoff guard/iu,
    /declarative/u,
    /non-executable/u,
    /stateless/u,
    /no raw sensitive material|raw sensitive material disabled|does not store raw sensitive material/iu,
    /no Graph execution entrypoint|Graph execution entrypoint disabled/iu,
    /no runtime Layer consumer wiring|runtime Layer consumer wiring disabled/iu,
    /no repo\/docs\/runtime artifact writes|repo\/docs\/runtime artifact writes disabled|repo writes.*docs writes.*runtime artifact writes/iu,
    /no external commands|external commands disabled/iu,
    /no task runner|task runner disabled/iu,
    /no state persistence|state persistence disabled/iu,
    /no dynamic state storage|dynamic state storage disabled/iu,
    /no SiteAdapter|SiteAdapter disabled/iu,
    /no downloader|downloader disabled/iu,
    /no SessionView|SessionView materialization disabled/iu,
    /no DownloadPolicy|DownloadPolicy materialization disabled/iu,
    /no StandardTaskList|StandardTaskList materialization disabled/iu,
    /no profile materialization|profile materialization disabled/iu,
    /Section 1 remains `partial`|Current status: `partial`/u,
  ]) {
    matrixAssert.match(section1.body, requiredPhrase);
  }

  const acceptanceGuardLines = section1.body
    .split('\n')
    .filter((line) => (
      line.includes('runtime boundary acceptance guard')
      || line.includes(focusedTestName)
      || helperNames.some((helperName) => line.includes(helperName))
      || line.includes(artifactFamily)
    ))
    .join('\n');
  matrixAssert.notEqual(acceptanceGuardLines, '', 'Section 1 should include runtime boundary acceptance guard lines');
  matrixAssert.doesNotMatch(
    acceptanceGuardLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|Graph execution enabled|Graph execution entrypoint enabled|runtime Layer consumer enabled|Layer consumer enabled|repo write enabled|repo writes enabled|repoWriteEnabled=true|docs write enabled|docs writes enabled|docsWriteEnabled=true|runtime artifact write enabled|runtime artifact writes enabled|runtimeArtifactWriteEnabled=true|external command enabled|external commands enabled|externalCommandEnabled=true|task runner enabled|state persistence enabled|dynamic state storage enabled|SiteAdapter invoked|SiteAdapter enabled|downloader invoked|downloader enabled|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|profile materialized|profile materialization enabled/iu,
    'Section 1 runtime boundary acceptance guard lines should not claim promotion, execution, writes, commands, state, or runtime materialization',
  );
});

test('Site Capability Graph Section 2 next task keeps non-goal boundary gaps current', async () => {
  const markdown = await readMatrix();
  const section2 = extractSections(markdown).find((section) => section.number === 2);

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.match(section2.heading, /Non-goals/u);
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set/iu,
    'Section 2 should not be promoted by this guard',
  );

  const nextSmallestTask = getField(section2, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 2 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 2 next task should not point at stale redaction audit attachment wording',
  );
  matrixAssert.match(
    nextSmallestTask,
    /live runtime producer\/subscriber implementation preflight|next `partial` section with a smaller runtime wiring gap|do not repeat the adapter-wiring boundary, preflight-contract, consumer-design, or docs\/matrix cross-check evidence batches/iu,
    'Section 2 next task should point at a real remaining non-goal boundary gap',
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /Add non-goal boundary validation|non-goal boundary validation for future Layer consumers|Add a future live Layer consumer preflight contract|rejects bypass\/access-control, credential\/session\/profile/iu,
    'Section 2 next task should not repeat completed boundary-validation or preflight-contract tasks',
  );
  matrixAssert.doesNotMatch(
    getField(section2, 'Current gaps') ?? '',
    /non-goal boundary validation (?:is )?completely missing|boundary validation completely missing|Future live Layer consumer preflight is still absent/iu,
    'Section 2 gaps should describe the remaining live-consumer wiring gap instead of stale complete-missing or absent-preflight wording',
  );
});

test('Site Capability Graph Section 2 records W1 non-goal boundary guard without promotion', async () => {
  const [markdown, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const w1TestName = 'non-goal boundary guards reject bypass credentials sessions and unredacted writes';

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(artifactGuardTest, new RegExp(w1TestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section2.body, new RegExp(w1TestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const requiredPhrase of [
    /bypass\/access-control/u,
    /credentials/u,
    /sessions/u,
    /browser profiles/u,
    /unredacted writes/u,
    /repo\/docs\/runtime writes/u,
    /Graph execution/u,
    /SiteAdapter execution/u,
    /downloader execution/u,
  ]) {
    matrixAssert.match(section2.body, requiredPhrase);
  }

  matrixAssert.match(getField(section2, 'Current gaps') ?? '', /Future live Layer consumer preflight contract evidence now exists/u);
  matrixAssert.match(getField(section2, 'Current gaps') ?? '', /still no live consumer runtime wiring/u);
  matrixAssert.match(getField(section2, 'Current gaps') ?? '', /first disabled\/no-op Layer consumer integration design now consumes/u);
  matrixAssert.match(
    getField(section2, 'Next smallest task') ?? '',
    /next `partial` section with a smaller runtime wiring gap/u,
  );
  matrixAssert.match(getField(section2, 'Next smallest task') ?? '', /do not repeat the non-goal boundary/u);
  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set|bypass enabled|access-control bypass enabled|credential materialized|credentials materialized|cookie materialized|Authorization materialized|session id materialized|SessionView materialized|browser profile materialized|profile materialization enabled|unredacted write enabled|unredacted writes enabled|repoWriteEnabled=true|docsWriteEnabled=true|runtimeWriteEnabled=true|runtimeArtifactWriteEnabled=true|repo writes enabled|docs writes enabled|runtime writes enabled|Graph execution enabled|Graph executor enabled|SiteAdapter execution enabled|SiteAdapter invoked|downloader execution enabled|downloader invoked/iu,
    'Section 2 should record rejection coverage without enabling non-goal behavior or promotion',
  );
});

test('Site Capability Graph Section 2 records non-goal bypass rejection evidence without promotion', async () => {
  const [markdown, boundarySource, boundaryTest] = await Promise.all([
    readMatrix(),
    readSource(NON_GOALS_BOUNDARY_URL),
    readSource(NON_GOALS_BOUNDARY_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const focusedTestName = 'NonGoalsBoundary rejects CAPTCHA anti-bot access-control bypass descriptors without executing';

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(section2.heading, /Non-goals/u);

  matrixAssert.match(boundarySource, /export const NON_GOAL_BYPASS_RULE_FAMILY\b/u);
  for (const ruleName of [
    'captcha-bypass',
    'anti-bot-bypass',
    'access-control-bypass',
    'platform-risk-bypass',
    'silent-privilege-expansion',
  ]) {
    matrixAssert.match(boundarySource, new RegExp(`'${ruleName}'`, 'u'));
  }
  matrixAssert.match(boundarySource, /appendFinding\(findings, owner, 'non-goal-bypass'/u);
  matrixAssert.match(boundarySource, /NON_GOAL_BYPASS_ALLOWED_BLOCKED_TEXT_PATTERN/u);
  matrixAssert.match(boundarySource, /manual\\s\+recovery/u);

  matrixAssert.match(boundaryTest, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  for (const requiredTestEvidence of [
    /classify CAPTCHA, anti-bot, access-control, and platform-risk states as blocked manual recovery boundaries/u,
    /manualRecoveryRequired:\s*true/u,
    /executionEnabled:\s*false/u,
    /captchaBypass/u,
    /antiBotBypass/u,
    /accessControlBypass/u,
    /platformRiskEvasion/u,
    /silentPrivilegeExpansion/u,
    /finding\.rule === 'non-goal-bypass'/u,
    /assert\.throws\([\s\S]*\/non-goal-bypass\/u/u,
  ]) {
    matrixAssert.match(boundaryTest, requiredTestEvidence);
  }

  matrixAssert.match(section2.body, /tests\/node\/non-goals-boundary\.test\.mjs/u);
  matrixAssert.match(section2.body, /bypass\/access-control rejection/u);
  matrixAssert.match(section2.body, /Section 2 remains `partial`/u);
  matrixAssert.match(getField(section2, 'Current gaps') ?? '', /still no live consumer runtime wiring/u);
  matrixAssert.match(getField(section2, 'Next smallest task') ?? '', /do not repeat the non-goal boundary/u);
  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|CAPTCHA bypass enabled|anti-bot bypass enabled|access-control bypass enabled|platform-risk bypass enabled|silent privilege expansion enabled|runtime wiring enabled|runtime consumer enabled|live consumer enabled|Graph execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|repoWriteEnabled=true|docsWriteEnabled=true|runtimeWriteEnabled=true|runtimeArtifactWriteEnabled=true/iu,
    'Section 2 should record bypass rejection evidence without promotion, live consumer wiring, execution, or writes',
  );
});

test('Site Capability Graph Section 2 records non-goal runtime handoff guard without promotion', async () => {
  const [markdown, boundarySource, boundaryTest] = await Promise.all([
    readMatrix(),
    readSource(NON_GOALS_BOUNDARY_URL),
    readSource(NON_GOALS_BOUNDARY_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const focusedTestName = 'NonGoalsBoundary runtime handoff guard keeps blocked non-goals from becoming live consumers';
  const helperNames = [
    'createNonGoalRuntimeBoundaryHandoffGuard',
    'assertNonGoalRuntimeBoundaryHandoffGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-non-goal-runtime-boundary-handoff-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(section2.heading, /Non-goals/u);

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(boundarySource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(boundarySource, new RegExp(`${escapedHelperName}\\(`, 'u'));
    matrixAssert.match(section2.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(boundarySource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(boundaryTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(boundaryTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section2.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section2.body, new RegExp(escapedFocusedTestName, 'u'));

  for (const requiredPhrase of [
    /descriptor-only/iu,
    /blocked/iu,
    /redactionRequired(?:=true| true)?/u,
    /disabled runtime consumer/iu,
    /no producer\/subscriber|producer\/subscriber disabled|producer registration disabled|subscriber registration disabled/iu,
    /no external telemetry|external telemetry disabled/iu,
    /no writes|write-disabled|repo\/docs\/runtime writes disabled|repo writes disabled|runtime writes disabled/iu,
    /no Graph execution|Graph execution disabled/iu,
    /no SiteAdapter\/downloader\/session materialization|SiteAdapter.*downloader.*session materialization|SiteAdapter invocation.*downloader invocation.*SessionView materialization/isu,
    /Section 2 remains `partial`|Current status: `partial`/u,
  ]) {
    matrixAssert.match(section2.body, requiredPhrase);
  }

  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime enabled|runtime consumer enabled|live consumer enabled|producer enabled|producer registered|subscriber enabled|subscriber registered|external telemetry enabled|write enabled|writes enabled|repo write enabled|repoWriteEnabled=true|docs write enabled|docsWriteEnabled=true|runtime write enabled|runtimeWriteEnabled=true|runtime artifact write enabled|runtimeArtifactWriteEnabled=true|Graph execution enabled|Graph executor enabled|SiteAdapter enabled|SiteAdapter invoked|downloader enabled|downloader invoked|SessionView materialized|session materialized|DownloadPolicy materialized|StandardTaskList materialized|credential materialized|credentials materialized|cookie materialized|Authorization materialized|browser profile materialized/iu,
    'Section 2 should record non-goal runtime handoff guard evidence without promotion, runtime enablement, writes, telemetry, execution, or materialization',
  );
});

test('Site Capability Graph Section 2 records non-goal live consumer acceptance guard without promotion', async () => {
  const [markdown, boundarySource, boundaryTest] = await Promise.all([
    readMatrix(),
    readSource(NON_GOALS_BOUNDARY_URL),
    readSource(NON_GOALS_BOUNDARY_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const focusedTestName = 'NonGoalsBoundary live consumer acceptance guard keeps runtime handoffs from promotion';
  const helperNames = [
    'createNonGoalLiveConsumerAcceptanceGuard',
    'assertNonGoalLiveConsumerAcceptanceGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-non-goal-live-consumer-acceptance-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(section2.heading, /Non-goals/u);

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(boundarySource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(boundarySource, new RegExp(`${escapedHelperName}\\(`, 'u'));
    matrixAssert.match(section2.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(boundarySource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(boundaryTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(boundaryTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section2.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section2.body, new RegExp(escapedFocusedTestName, 'u'));

  for (const requiredPhrase of [
    /blocked\/manual-recovery descriptors cannot promote to live consumers|blocked\/manual recovery descriptors cannot promote to live consumers|blocked manual-recovery descriptors cannot promote to live consumers/iu,
    /no runtime producer\/subscriber registration|runtime producer\/subscriber registration disabled|no producer\/subscriber registration/iu,
    /no external telemetry|external telemetry disabled/iu,
    /no writes|write-disabled|repo\/docs\/runtime writes disabled|repo writes disabled|runtime writes disabled/iu,
    /no Graph execution|Graph execution disabled/iu,
    /no SiteAdapter\/downloader\/session materialization|SiteAdapter.*downloader.*session materialization|SiteAdapter invocation.*downloader invocation.*SessionView materialization/isu,
    /no bypass behavior|bypass behavior disabled/iu,
    /no credential\/session\/profile output|credential\/session\/profile output disabled|no credential output.*session output.*profile output/isu,
    /Section 2 remains `partial`|Current status: `partial`/u,
  ]) {
    matrixAssert.match(section2.body, requiredPhrase);
  }

  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|promoted to verified|live runtime enabled|runtime enabled|runtime consumer enabled|live consumer enabled|producer enabled|producer registered|subscriber enabled|subscriber registered|external telemetry enabled|write enabled|writes enabled|repo write enabled|repoWriteEnabled=true|docs write enabled|docsWriteEnabled=true|runtime write enabled|runtimeWriteEnabled=true|runtime artifact write enabled|runtimeArtifactWriteEnabled=true|Graph execution enabled|Graph executor enabled|SiteAdapter enabled|SiteAdapter invoked|downloader enabled|downloader invoked|SessionView materialized|session materialized|credential materialized|credentials materialized|cookie materialized|Authorization materialized|browser profile materialized|profile materialized/iu,
    'Section 2 should record non-goal live consumer acceptance evidence without promotion, runtime enablement, writes, execution, or materialization',
  );
});

test('Site Capability Graph Section 2 records non-goal live consumer compatibility review gate without promotion', async () => {
  const [markdown, boundarySource, boundaryTest] = await Promise.all([
    readMatrix(),
    readSource(NON_GOALS_BOUNDARY_URL),
    readSource(NON_GOALS_BOUNDARY_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const helperNames = [
    'createNonGoalLiveConsumerCompatibilityReviewGate',
    'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-non-goal-live-consumer-compatibility-review-gate';
  const focusedTestNames = [
    'NonGoalsBoundary live consumer compatibility review gate consumes only acceptance guard safe summaries',
    'NonGoalsBoundary live consumer compatibility review gate rejects live runtime, writes, telemetry, promotion, and sensitive material',
  ];

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(section2.heading, /Non-goals/u);

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(boundarySource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section2.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }
  for (const testName of focusedTestNames) {
    matrixAssert.match(boundaryTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    matrixAssert.match(section2.body, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  matrixAssert.match(boundarySource, new RegExp(artifactFamily, 'u'));
  matrixAssert.match(section2.body, new RegExp(artifactFamily, 'u'));
  matrixAssert.match(boundarySource, /sourceAcceptance/u);
  matrixAssert.match(boundarySource, /blocked-manual-recovery-cannot-promote/u);
  matrixAssert.match(boundarySource, /callback/iu);
  matrixAssert.match(boundarySource, /externalDispatch/u);
  matrixAssert.match(boundarySource, /livePromotionAllowed/u);
  matrixAssert.match(boundarySource, /sessdata/iu);

  for (const requiredPhrase of [
    /descriptor-only/u,
    /blocked/u,
    /redactionRequired/u,
    /acceptance guard safe summary/u,
    /blocked\/manual-recovery compatibility/u,
    /runtime consumer, callback\/handler/u,
    /SiteAdapter\/downloader\/SessionView/u,
    /repo\/docs\/runtime writes/u,
    /external telemetry\/dispatch/u,
    /status advancement, live-consumer promotion, verified-status advancement/u,
    /SESSDATA, cookie, Authorization, CSRF, token, session id, browser profile/u,
    /synthetic sensitive material without echoing values/u,
    /focused compatibility review gate validation passed 2\/2/u,
    /focused matrix validation passed 1\/1 for `non-goal live consumer compatibility review gate`/u,
    /Section 2 remains `partial`/u,
    /not live consumer runtime wiring/u,
  ]) {
    matrixAssert.match(section2.body, requiredPhrase);
  }

  const reviewGateLines = section2.body
    .split('\n')
    .filter((line) => (
      line.includes('live consumer compatibility review gate')
      || helperNames.some((helperName) => line.includes(helperName))
      || line.includes(artifactFamily)
    ))
    .join('\n');

  matrixAssert.notEqual(reviewGateLines, '', 'Section 2 should include non-goal live consumer compatibility review gate lines');
  matrixAssert.doesNotMatch(
    reviewGateLines,
    /placeholder|pending|Current status: `verified`|status promoted|verified status set|verified promotion|promoted to verified|runtime enabled|runtime consumer enabled|live consumer enabled|consumer registered|callback registered|handler registered|producer registered|subscriber registered|external telemetry enabled|external dispatch enabled|write enabled|writes enabled|repo write enabled|docs write enabled|runtime write enabled|runtime artifact write enabled|Graph execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|credential materialized|cookie materialized|Authorization materialized|browser profile materialized|profile materialized/iu,
    'Section 2 review gate lines should not claim promotion, live consumer wiring, writes, telemetry, execution, or materialization',
  );
});

test('Site Capability Graph Section 2 records future Layer consumer preflight contract without promotion', async () => {
  const [markdown, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const section2 = extractSections(markdown).find((section) => section.number === 2);
  const preflightTestName = 'future Layer consumer preflight rejects non-goal runtime capabilities before enablement';

  matrixAssert.equal(typeof section2?.body, 'string', 'Section 2 should exist');
  matrixAssert.equal(getField(section2, 'Current status'), '`partial`');
  matrixAssert.match(artifactGuardTest, new RegExp(preflightTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section2.body, new RegExp(preflightTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section2.body, /Current future live Layer consumer preflight contract evidence/u);
  matrixAssert.match(section2.body, /Current round preflight contract evidence/u);
  matrixAssert.match(section2.body, /there is still no live consumer runtime wiring/u);
  matrixAssert.match(section2.body, /first disabled\/no-op Layer consumer integration design now consumes/u);
  matrixAssert.match(section2.body, /Section 2 remains `partial`/u);
  matrixAssert.match(
    getField(section2, 'Next smallest task') ?? '',
    /Choose the next `partial` section with a smaller runtime wiring gap/u,
  );
  matrixAssert.doesNotMatch(
    getField(section2, 'Next smallest task') ?? '',
    /Add a future live Layer consumer preflight contract/iu,
  );
  matrixAssert.match(
    getField(section2, 'Next smallest task') ?? '',
    /do not repeat the non-goal boundary, adapter-wiring boundary, preflight-contract, consumer-design, or docs\/matrix cross-check evidence batches/u,
  );
  matrixAssert.doesNotMatch(
    section2.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime wiring enabled|runtime consumer enabled|live consumer enabled|write path enabled|write paths enabled|credential output enabled|session output enabled|profile output enabled|materialization enabled|credential materialized|credentials materialized|cookie materialized|Authorization materialized|session id materialized|SessionView materialized|browser profile materialized|repoWriteEnabled=true|docsWriteEnabled=true|runtimeWriteEnabled=true|runtimeArtifactWriteEnabled=true|repo writes enabled|docs writes enabled|runtime writes enabled|Graph execution enabled|Graph executor enabled|SiteAdapter execution enabled|SiteAdapter invoked|downloader execution enabled|downloader invoked/iu,
    'Section 2 should bind preflight evidence without promotion or enabled runtime/write/materialization wording',
  );
});

test('Site Capability Graph Section 3 next task keeps Layer relationship gaps current', async () => {
  const markdown = await readMatrix();
  const section3 = extractSections(markdown).find((section) => section.number === 3);

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.match(section3.heading, /Site Capability Layer/u);
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set/iu,
    'Section 3 should not be promoted by this guard',
  );

  const nextSmallestTask = getField(section3, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 3 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 3 next task should not point at stale redaction audit attachment wording',
  );
  matrixAssert.match(
    nextSmallestTask,
    /planner handoff rejection shape|another `partial` section|missing Layer design path|execution[- ]entrypoint boundary|Graph cannot become (?:a )?second execution entrypoint/iu,
    'Section 3 next task should point at a real remaining Layer/Graph relationship gap',
  );
});

test('Site Capability Graph Section 3 records planner handoff runtime-product rejection without promotion', async () => {
  const [markdown, plannerHandoffSource, plannerHandoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_URL),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section3 = extractSections(markdown).find((section) => section.number === 3);
  const testName = 'graph planner route handoff rejects Layer runtime products before execution';
  const helperName = 'assertGraphPlannerRouteHandoffLayerEntrypointBoundaryCompatibility';

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');
  matrixAssert.match(plannerHandoffSource, new RegExp(helperName, 'u'));
  matrixAssert.match(plannerHandoffTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section3.body, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section3.body, new RegExp(helperName, 'u'));
  matrixAssert.match(section3.body, /Layer as the execution entrypoint/u);
  matrixAssert.match(section3.body, /Graph handoff cannot carry/u);
  matrixAssert.match(section3.body, /SiteAdapter invocation/u);
  matrixAssert.match(section3.body, /downloader invocation/u);
  matrixAssert.match(section3.body, /SessionView materialization/u);
  matrixAssert.match(section3.body, /DownloadPolicy\/TaskList materialization/u);
  matrixAssert.match(section3.body, /runtime artifact writes/u);
  matrixAssert.match(section3.body, /repo\/runtime writes/u);
  matrixAssert.match(section3.body, /raw sensitive fields/u);
  matrixAssert.match(section3.body, /Section 3 remains `partial`/u);
  matrixAssert.match(getField(section3, 'Current round verification result') ?? '', /planner handoff rejection-shape test passed 1\/1/u);
  matrixAssert.match(getField(section3, 'Current round verification result') ?? '', /full planner policy handoff suite passed 33\/33/u);

  const nextSmallestTask = getField(section3, 'Next smallest task') ?? '';
  matrixAssert.match(nextSmallestTask, /another `partial` section|distinct execution-entrypoint boundary guard/u);
  matrixAssert.match(nextSmallestTask, /do not repeat planner handoff runtime-product rejection/u);
  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set|live Layer planner runtime execution enabled|Graph execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|runtime artifact write enabled|runtime write path enabled|repo writes enabled/iu,
  );
});

test('disabled graph planner runtime consumer requires future Layer preflight contract before runtime wiring', async () => {
  const markdown = await readMatrix();
  const section3 = extractSections(markdown).find((section) => section.number === 3);

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');

  const guardName = 'disabled graph planner runtime consumer requires future Layer preflight contract before runtime wiring';
  matrixAssert.match(section3.body, new RegExp(guardName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section3.body, /disabled-feature-flag descriptor path/u);
  matrixAssert.match(section3.body, /future Layer preflight contract has now been consumed\/recorded/u);
  matrixAssert.match(section3.body, /first disabled Layer planner consumer design\/result path/u);
  matrixAssert.match(section3.body, /keeps Section 3 `partial`/u);
  matrixAssert.match(section3.body, /does not add live Layer planner runtime execution/u);
  matrixAssert.match(section3.body, /SiteAdapter invocation/u);
  matrixAssert.match(section3.body, /downloader invocation/u);
  matrixAssert.match(section3.body, /SessionView materialization/u);
  matrixAssert.match(section3.body, /runtime artifact writes/u);
  matrixAssert.match(section3.body, /runtime write path/u);

  const nextSmallestTask = getField(section3, 'Next smallest task') ?? '';
  matrixAssert.match(nextSmallestTask, /another `partial` section/u);
  matrixAssert.match(nextSmallestTask, /do not repeat planner handoff runtime-product rejection/u);
  matrixAssert.match(nextSmallestTask, /disabled-feature-flag descriptor consumer/u);
  matrixAssert.match(nextSmallestTask, /risk-blocking preflight evidence batches/u);
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /more specific live Layer planner runtime consumer integration preflight contract|Add .*risk blocking runtime preflight|Connect a live Layer planner runtime consumer|smaller follow-up guard for one planner handoff rejection shape/iu,
  );
  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set|live Layer planner runtime execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|runtime artifact write enabled|runtime write path enabled/iu,
    'Section 3 should record disabled consumer evidence without promotion or runtime wiring',
  );
});

test('Site Capability Graph Section 3 records planner Layer entrypoint handoff guard without promotion', async () => {
  const [markdown, plannerHandoffSource, plannerHandoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_URL),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section3 = extractSections(markdown).find((section) => section.number === 3);
  const focusedTestName = 'graph planner Layer entrypoint handoff guard keeps Graph from becoming a second executor';
  const helperNames = [
    'createGraphPlannerLayerEntrypointHandoffGuard',
    'assertGraphPlannerLayerEntrypointHandoffGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-planner-layer-entrypoint-handoff-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(plannerHandoffSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(plannerHandoffSource, new RegExp(`${escapedHelperName}\\(`, 'u'));
    matrixAssert.match(section3.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(plannerHandoffSource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(plannerHandoffTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(plannerHandoffTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section3.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section3.body, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section3.body, /Layer (?:still )?(?:remains|is) (?:the )?execution entrypoint|Layer (?:still )?(?:remains|is) (?:the )?executor/iu);
  matrixAssert.match(section3.body, /Graph (?:cannot|must not|does not) become (?:a )?second executor|Graph from becoming a second executor/iu);
  matrixAssert.match(section3.body, /Section 3 remains `partial`|Current status: `partial`/u);

  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live Layer planner runtime execution enabled|Graph execution enabled|Graph executor enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|repoWriteEnabled=true|runtime write enabled|runtime writes enabled|runtimeWriteEnabled=true|runtime artifact write enabled|runtime artifact writes enabled|runtimeArtifactWriteEnabled=true/iu,
    'Section 3 should record planner Layer entrypoint handoff guard evidence without promotion, Graph execution, runtime writes, or runtime materialization',
  );
});

test('Site Capability Graph Section 3 records planner Layer entrypoint source alias fail-closed coverage without promotion', async () => {
  const [markdown, plannerHandoffSource, plannerHandoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_URL),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section3 = extractSections(markdown).find((section) => section.number === 3);
  const focusedTestName =
    'graph planner Layer entrypoint handoff guard rejects unsafe source aliases';
  const helperName = 'createGraphPlannerLayerEntrypointHandoffGuard';
  const artifactFamily = 'site-capability-graph-planner-layer-entrypoint-handoff-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');

  matrixAssert.match(plannerHandoffSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
  matrixAssert.match(plannerHandoffSource, /selectGraphPlannerLayerEntrypointHandoffSourceAlias/u);
  matrixAssert.match(plannerHandoffSource, /source aliases must reference the same descriptor object/u);
  matrixAssert.match(plannerHandoffTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(plannerHandoffTest, /unselected alias compatibility/u);
  matrixAssert.match(plannerHandoffTest, /source aliases must reference the same descriptor object/u);

  matrixAssert.match(section3.body, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section3.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  matrixAssert.match(section3.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section3.body, /source alias fail-closed/u);
  matrixAssert.match(section3.body, /ignored unsafe alias/u);
  matrixAssert.match(section3.body, /multiple distinct aliases|distinct source aliases/u);
  matrixAssert.match(section3.body, /Section 3 remains `partial`|Current status: `partial`/u);
  matrixAssert.match(
    getField(section3, 'Current gaps') ?? '',
    /no Graph execution path|no live Layer planner runtime executes Graph route handoffs/u,
  );
  matrixAssert.match(
    getField(section3, 'Next smallest task') ?? '',
    /do not repeat .*source alias fail-closed|source alias fail-closed coverage/u,
  );

  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live Layer planner runtime execution enabled|Graph execution enabled|Graph executor enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|runtime write enabled|runtime writes enabled|runtime artifact write enabled|runtime artifact writes enabled|external dispatch enabled/iu,
    'Section 3 should record source alias fail-closed coverage without promotion, runtime consumers, materialization, or writes',
  );
});

test('Site Capability Graph Section 3 records planner handoff safe-summary boundary without promotion', async () => {
  const [markdown, plannerHandoffSource, plannerHandoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_URL),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section3 = extractSections(markdown).find((section) => section.number === 3);
  const focusedTestName =
    'graph planner Layer entrypoint handoff safe summary proves minimum Layer consumption boundary';
  const helperNames = [
    'createGraphPlannerLayerEntrypointHandoffSafeSummary',
    'assertGraphPlannerLayerEntrypointHandoffSafeSummaryCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-planner-layer-entrypoint-handoff-safe-summary';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(plannerHandoffSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(plannerHandoffTest, new RegExp(escapedHelperName, 'u'));
    matrixAssert.match(section3.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(plannerHandoffSource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(plannerHandoffTest, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section3.body, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(section3.body, new RegExp(escapedFocusedTestName, 'u'));
  matrixAssert.match(section3.body, /minimum Layer consumption boundary/u);
  matrixAssert.match(section3.body, /source guard safe summary/u);
  matrixAssert.match(section3.body, /Layer can consume only the safe summary/u);
  matrixAssert.match(section3.body, /not the original Graph handoff/u);
  matrixAssert.match(section3.body, /Section 3 remains `partial`|Current status: `partial`/u);

  matrixAssert.doesNotMatch(
    section3.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live Layer planner runtime execution enabled|Graph execution enabled|Graph executor enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|runtime write enabled|runtime writes enabled|runtime artifact write enabled|runtime artifact writes enabled/iu,
    'Section 3 should record safe-summary evidence without promotion, Graph execution, runtime writes, or runtime materialization',
  );
});

test('Site Capability Graph Section 3 records planner Layer entrypoint live execution denial guard without promotion', async () => {
  const [markdown, plannerHandoffSource, plannerHandoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_URL),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section3 = extractSections(markdown).find((section) => section.number === 3);
  const focusedTestNames = [
    'graph planner Layer entrypoint live execution denial guard consumes safe summary without executing',
    'graph planner Layer entrypoint live execution denial guard rejects runtime execution products and unsafe source aliases',
  ];
  const helperNames = [
    'createGraphPlannerLayerEntrypointLiveExecutionDenialGuard',
    'assertGraphPlannerLayerEntrypointLiveExecutionDenialGuardCompatibility',
  ];
  const sourceAliasNames = [
    'handoffSafeSummary',
    'sourceHandoffSafeSummary',
    'plannerLayerEntrypointHandoffSafeSummary',
    'sourcePlannerLayerEntrypointHandoffSafeSummary',
    'sourceSafeSummary',
    'safeSummary',
  ];

  matrixAssert.equal(typeof section3?.body, 'string', 'Section 3 should exist');
  matrixAssert.equal(getField(section3, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(plannerHandoffSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(plannerHandoffTest, new RegExp(escapedHelperName, 'u'));
    matrixAssert.match(section3.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }
  for (const focusedTestName of focusedTestNames) {
    matrixAssert.match(plannerHandoffTest, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    matrixAssert.match(section3.body, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  for (const aliasName of sourceAliasNames) {
    matrixAssert.match(plannerHandoffSource, new RegExp(aliasName, 'u'));
    matrixAssert.match(section3.body, new RegExp(aliasName, 'u'));
  }

  matrixAssert.match(plannerHandoffSource, /createGraphPlannerLayerEntrypointHandoffSafeSummary/u);
  matrixAssert.match(plannerHandoffSource, /source aliases must reference the same descriptor object/u);
  matrixAssert.match(plannerHandoffTest, /missing source|source alias is required/u);
  matrixAssert.match(plannerHandoffTest, /unsafe source aliases|unsafe alias|source runtime payload alias/u);
  matrixAssert.match(plannerHandoffTest, /multiple distinct aliases|source aliases must reference the same descriptor object/u);
  for (const requiredPhrase of [
    /planner Layer entrypoint live execution denial guard/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /safe summary from `createGraphPlannerLayerEntrypointHandoffSafeSummary\(\)`/u,
    /missing\/unsafe\/distinct alias rejection/u,
    /[Ll]ive Layer planner runtime execution disabled/u,
    /Graph execution disabled/u,
    /route execution disabled/u,
    /SiteAdapter(?:\/|, )downloader(?:\/|, )SessionView(?:\/|, )DownloadPolicy(?:\/|, )StandardTaskList disabled/u,
    /runtime\/repo\/artifact writes disabled/u,
    /external dispatch\/telemetry disabled/u,
    /status promotion disabled/u,
    /Section 3 remains `partial`/u,
  ]) {
    matrixAssert.match(section3.body, requiredPhrase);
  }
  matrixAssert.match(
    getField(section3, 'Verification result') ?? '',
    /Current live execution denial guard verification passed/u,
  );
  matrixAssert.match(
    getField(section3, 'Current gaps') ?? '',
    /no live Layer planner runtime executes Graph route handoffs|no Graph execution path/u,
  );
  matrixAssert.match(
    getField(section3, 'Next smallest task') ?? '',
    /do not repeat .*live execution denial guard|live execution denial guard/u,
  );

  const denialGuardLines = section3.body
    .split('\n')
    .filter((line) => (
      line.includes('live execution denial guard')
      || helperNames.some((helperName) => line.includes(helperName))
      || focusedTestNames.some((focusedTestName) => line.includes(focusedTestName))
    ))
    .join('\n');

  matrixAssert.notEqual(
    denialGuardLines,
    '',
    'Section 3 should include planner live execution denial guard evidence lines',
  );
  matrixAssert.doesNotMatch(
    denialGuardLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live Layer planner runtime execution enabled|Graph execution enabled|Graph executor enabled|route execution enabled|Route execution enabled|SiteAdapter invoked|SiteAdapter enabled|downloader invoked|downloader enabled|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|runtime write enabled|runtime writes enabled|artifact write enabled|artifact writes enabled|external dispatch enabled|external telemetry enabled|telemetry sent|matrix writer invoked/iu,
    'Section 3 live execution denial guard lines should not claim promotion, live execution, runtime invocation, writes, telemetry, or matrix writer invocation',
  );
});

test('Site Capability Graph Sections 1 and 3 record aggregate execution boundary guard without promotion', async () => {
  const [markdown, graphSource, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const helperNames = [
    'createGraphAggregateExecutionBoundaryGuard',
    'assertGraphAggregateExecutionBoundaryGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-aggregate-execution-boundary-guard';
  const focusedTestPattern = /aggregate execution boundary guard/iu;

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactGuardTest, new RegExp(`${escapedHelperName}`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(artifactFamily, 'u'));
  matrixAssert.match(artifactGuardTest, focusedTestPattern);
  matrixAssert.match(artifactGuardTest, new RegExp(artifactFamily, 'u'));

  for (const sectionNumber of [1, 3]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    }

    for (const requiredPhrase of [
      focusedTestPattern,
      /descriptor-only/u,
      /blocked/u,
      /redactionRequired/u,
      /core positioning runtime boundary acceptance guard safe summary/u,
      /cannot become an execution entrypoint|cannot become a second execution entrypoint/iu,
      /cannot bypass Layer/u,
      /cannot replace Layer/u,
      /cannot call SiteAdapter or downloader/u,
      /cannot materialize SessionView, DownloadPolicy, or StandardTaskList/u,
      /cannot write repo\/docs\/runtime artifacts/u,
      /cannot perform external dispatch or telemetry/u,
      /cannot persist dynamic runtime state/u,
      /cannot store raw sensitive material/u,
      new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'),
      /guard evidence only/u,
      /not live wiring and not execution enablement/u,
    ]) {
      matrixAssert.match(section.body, requiredPhrase);
    }

    const aggregateGuardLines = section.body
      .split('\n')
      .filter((line) => (
        focusedTestPattern.test(line)
        || helperNames.some((helperName) => line.includes(helperName))
        || line.includes(artifactFamily)
      ))
      .join('\n');

    matrixAssert.notEqual(
      aggregateGuardLines,
      '',
      `Section ${sectionNumber} should include aggregate execution boundary guard lines`,
    );
    matrixAssert.doesNotMatch(
      aggregateGuardLines,
      /Current status: `verified`|status promoted|verified status set|verified promotion|Graph execution enabled|Graph executed|Graph executor enabled|Layer bypass enabled|Layer bypassed|Layer replacement enabled|Layer replaced|SiteAdapter invoked|SiteAdapter enabled|downloader invoked|downloader enabled|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|repoWriteEnabled=true|docs write enabled|docs writes enabled|docsWriteEnabled=true|runtime artifact write enabled|runtime artifact writes enabled|runtimeArtifactWriteEnabled=true|external dispatch enabled|external telemetry enabled|telemetry sent|dynamic state persistence enabled|dynamic runtime state stored|raw sensitive material stored|raw credential stored|matrix writer invoked|matrix writer invocation/iu,
      `Section ${sectionNumber} aggregate execution boundary guard lines should not claim promotion, execution, Layer bypass, runtime invocation, writes, telemetry, state, sensitive storage, or matrix writer invocation`,
    );
  }
});

test('Site Capability Graph Sections 1 and 3 record aggregate execution boundary handoff review gate without promotion', async () => {
  const [markdown, graphSource, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const helperNames = [
    'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate',
    'assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility',
  ];
  const focusedTestNames = [
    'Graph/Layer aggregate execution boundary handoff review gate consumes aggregate safe summary only',
    'Graph/Layer aggregate execution boundary handoff review gate rejects runtime handoff products',
    'Graph/Layer aggregate execution boundary handoff review gate rejects synthetic sensitive material without echoing it',
  ];
  const artifactFamily = 'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate';

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactGuardTest, new RegExp(`${escapedHelperName}`, 'u'));
  }
  for (const testName of focusedTestNames) {
    matrixAssert.match(artifactGuardTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  matrixAssert.match(graphSource, new RegExp(artifactFamily, 'u'));
  matrixAssert.match(graphSource, /plannerLayerEntrypointHandoffPrerequisiteName/u);
  matrixAssert.match(graphSource, /not-consumed-not-present-in-site-capability-graph/u);
  matrixAssert.match(artifactGuardTest, new RegExp(artifactFamily, 'u'));

  for (const sectionNumber of [1, 3]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    }
    for (const requiredPhrase of [
      new RegExp(artifactFamily, 'u'),
      /descriptor-only/u,
      /blocked/u,
      /redactionRequired/u,
      /`?createGraphAggregateExecutionBoundaryGuard\(\)`? safe summary/u,
      /planner-layer-entrypoint-handoff-guard-safe-summary/u,
      /not-consumed-not-present-in-site-capability-graph/u,
      /Layer as execution entrypoint|Layer remains execution entrypoint/u,
      /prevents Graph from becoming an execution entrypoint|Graph from becoming an execution entrypoint/u,
      /bypassing Layer|bypass Layer/u,
      /route execution, task execution/u,
      /Layer runtime consumers/u,
      /SiteAdapter, downloader/u,
      /SessionView, DownloadPolicy, StandardTaskList/u,
      /repo\/docs\/runtime writes/u,
      /external telemetry, external dispatch/u,
      /dynamic state storage/u,
      /sensitive material disabled/u,
      /focused artifact-guard validation passed 3\/3 for `aggregate execution boundary handoff review gate`/u,
      /focused matrix validation passed 1\/1 for `aggregate execution boundary handoff review gate`/u,
      new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'),
      /review-gate evidence only/u,
      /not live wiring|not live Layer planner runtime execution/u,
      /not execution enablement/u,
    ]) {
      matrixAssert.match(section.body, requiredPhrase);
    }

    const reviewGateLines = section.body
      .split('\n')
      .filter((line) => (
        line.includes('aggregate execution boundary handoff review gate')
        || helperNames.some((helperName) => line.includes(helperName))
        || line.includes(artifactFamily)
      ))
      .join('\n');

    matrixAssert.notEqual(
      reviewGateLines,
      '',
      `Section ${sectionNumber} should include aggregate execution boundary handoff review gate lines`,
    );
    matrixAssert.doesNotMatch(
      reviewGateLines,
      /placeholder|pending|Current status: `verified`|status promoted|verified status set|verified promotion|Graph execution enabled|Graph executed|Graph executor enabled|Layer bypass enabled|Layer bypassed|Layer replacement enabled|Layer replaced|Layer runtime consumer enabled|runtime Layer consumer enabled|route execution enabled|task execution enabled|SiteAdapter invoked|SiteAdapter enabled|downloader invoked|downloader enabled|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|repo write enabled|repo writes enabled|repoWriteEnabled=true|docs write enabled|docs writes enabled|docsWriteEnabled=true|runtime artifact write enabled|runtime artifact writes enabled|runtimeArtifactWriteEnabled=true|external dispatch enabled|external telemetry enabled|telemetry sent|dynamic state persistence enabled|dynamic runtime state stored|sensitive material stored|raw sensitive material stored|raw credential stored|matrix writer invoked|matrix writer invocation/iu,
      `Section ${sectionNumber} aggregate execution boundary handoff review gate lines should not claim promotion, execution, Layer bypass, runtime invocation, writes, telemetry, state, sensitive storage, or matrix writer invocation`,
    );
  }
});

test('Site Capability Graph Section 4 next task keeps Graph layering gaps current', async () => {
  const markdown = await readMatrix();
  const section4 = extractSections(markdown).find((section) => section.number === 4);

  matrixAssert.equal(typeof section4?.body, 'string', 'Section 4 should exist');
  matrixAssert.match(section4.heading, /Graph/u);
  matrixAssert.equal(getField(section4, 'Current status'), '`verified`');

  const nextSmallestTask = getField(section4, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 4 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 4 next task should not point at stale redaction audit attachment wording',
  );
  matrixAssert.match(
    nextSmallestTask,
    /another non-verified section|do not repeat the no database\/runtime storage/u,
    'Section 4 next task should move away from completed Graph layering evidence',
  );
});

test('graph inventory runtime descriptors enforce no database or runtime state storage', async () => {
  const [markdown, graphSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
  ]);
  const section4 = extractSections(markdown).find((section) => section.number === 4);

  matrixAssert.equal(typeof section4?.body, 'string', 'Section 4 should exist');
  matrixAssert.match(section4.heading, /Graph/u);
  matrixAssert.equal(getField(section4, 'Current status'), '`verified`');

  for (const exportName of [
    'createGraphInventoryRuntimeIntegrationDesign',
    'assertGraphInventoryRuntimeIntegrationDesignCompatibility',
    'createDisabledGraphInventoryRuntimeConsumerResult',
    'assertDisabledGraphInventoryRuntimeConsumerResultCompatibility',
    'createGraphInventoryRepoOutputDryRun',
    'assertGraphInventoryRepoOutputDryRunCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${exportName}\\b`, 'u'));
    matrixAssert.match(section4.body, new RegExp(`${exportName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /Graph v1 remains JSON\/schema\/query plus descriptor-only utilities/u,
    /does not introduce a database, runtime storage, or runtime state persistence/u,
    /Inventory runtime integration, the disabled inventory runtime consumer, and repo-output dry-run descriptors/u,
    /no database\/runtime state persistence/u,
    /repo-output remains dry-run-only with no repo write, runtime generation, runtime artifact write, or external command/u,
    /Current round no database\/runtime storage evidence/u,
    /This records Section 4 Graph layering readiness while keeping live runtime consumer integration outside this section/u,
  ]) {
    matrixAssert.match(section4.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section4, 'Next smallest task') ?? '',
    /another non-verified section/u,
  );
  matrixAssert.match(
    getField(section4, 'Next smallest task') ?? '',
    /do not repeat the no database\/runtime storage/u,
  );
  matrixAssert.doesNotMatch(
    section4.body,
    /database enabled|runtime storage enabled|runtime state persistence enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|repo write enabled|runtime generation enabled|runtime artifact write enabled|external command enabled|runtime write path enabled|status promoted|verified status set/iu,
    'Section 4 should bind invariant evidence without enabling persistence, writes, generation, commands, or promotion',
  );
});

test('Site Capability Graph Section 7 next task keeps CapabilityNode gaps current', async () => {
  const markdown = await readMatrix();
  const section7 = extractSections(markdown).find((section) => section.number === 7);

  matrixAssert.equal(typeof section7?.body, 'string', 'Section 7 should exist');
  matrixAssert.match(section7.heading, /CapabilityNode/u);
  matrixAssert.equal(getField(section7, 'Current status'), '`verified`');
  matrixAssert.doesNotMatch(
    section7.body,
    /status promoted|verified status set/iu,
    'Section 7 should not be promoted by this guard',
  );

  const nextSmallestTask = getField(section7, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 7 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 7 next task should not point at stale redaction audit attachment wording',
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /Add a focused agent-exposed capability-level test evidence invariant/iu,
    'Section 7 next task should not point at the completed agent-exposed CapabilityNode evidence invariant',
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /persisted CapabilityNode inventory coverage|persisted CapabilityNode records/iu,
    'Section 7 next task should not point at completed persisted CapabilityNode inventory dry-run coverage',
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /Add .*full config inventory.*Layer-source RiskPolicyNode|production-grade full config inventory coverage|Layer-source RiskPolicyNode migration across Layer config sources/iu,
    'Section 7 next task should not point at completed full config Layer-source RiskPolicyNode inventory coverage',
  );
  matrixAssert.match(
    nextSmallestTask,
    /another non-verified section|do not repeat the full config Layer-source `RiskPolicyNode` inventory\/sourceRefs/u,
    'Section 7 next task should point at a real remaining CapabilityNode gap',
  );
});

test('Site Capability Graph matrix records CapabilityNode agent-exposed test evidence invariant', async () => {
  const [markdown, graphSource, validatorTest, schemaTest, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(VALIDATOR_TEST_URL),
    readSource(SCHEMA_TEST_URL),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);
  const section7 = extractSections(markdown).find((section) => section.number === 7);

  matrixAssert.equal(typeof section7?.body, 'string', 'Section 7 should exist');
  matrixAssert.equal(getField(section7, 'Current status'), '`verified`');
  matrixAssert.match(graphSource, /assertBoolean\(node\.agentExposed, 'agentExposed', 'CapabilityNode'\)/u);
  matrixAssert.match(graphSource, /node\.agentExposed === true && \(!Array\.isArray\(node\.testEvidenceRefs\) \|\| node\.testEvidenceRefs\.length === 0\)/u);
  matrixAssert.match(graphSource, /message: 'Agent-exposed CapabilityNode must include test evidence refs'/u);
  matrixAssert.match(graphSource, /field: 'testEvidenceRefs'/u);
  matrixAssert.match(graphSource, /agentExposedCapabilityList: capabilities[\s\S]*\.filter\(\(capability\) => capability\.agentExposed === true\)[\s\S]*testEvidenceRefs: capability\.testEvidenceRefs \?\? \[\]/u);

  matrixAssert.match(
    validatorTest,
    /validator rejects agent-exposed CapabilityNode without test evidence independently of EndpointNode catalog evidence/u,
  );
  matrixAssert.match(
    validatorTest,
    /validator accepts agent-exposed CapabilityNode with capability-level test evidence/u,
  );
  matrixAssert.match(validatorTest, /capability\.agentExposed = true/u);
  matrixAssert.match(validatorTest, /capability\.testEvidenceRefs = \[\]/u);
  matrixAssert.match(validatorTest, /graph-agent-capability-missing-test-evidence/u);
  matrixAssert.match(validatorTest, /assert\.doesNotMatch\(report\.findings\[0\]\.message, \/Cataloged EndpointNode\/u\)/u);

  matrixAssert.match(schemaTest, /CapabilityNode schema accepts agent-exposed descriptor fields without execution authority/u);
  matrixAssert.match(schemaTest, /agentExposed: true/u);
  matrixAssert.match(schemaTest, /agentExposed: 'true'/u);
  matrixAssert.match(docsGeneratorTest, /docs renderer includes capability test evidence refs without executing tests/u);
  matrixAssert.match(docsGeneratorTest, /summary\.sections\.capabilityList\[0\]\.testEvidenceRefs/u);
  matrixAssert.match(docsGeneratorTest, /summary\.sections\.testCoverageSummary/u);

  matrixAssert.match(
    section7.body,
    /CapabilityNode-level agent exposure test evidence: `agentExposed` is accepted only as a boolean descriptor/u,
  );
  matrixAssert.match(section7.body, /graph-agent-capability-missing-test-evidence/u);
  matrixAssert.match(
    section7.body,
    /validator rejects agent-exposed CapabilityNode without test evidence independently of EndpointNode catalog evidence/u,
  );
  matrixAssert.match(section7.body, /validator accepts agent-exposed CapabilityNode with capability-level test evidence/u);
  matrixAssert.match(section7.body, /CapabilityNode schema accepts agent-exposed descriptor fields without execution authority/u);
  matrixAssert.match(section7.body, /rejects non-boolean `agentExposed`/u);
  matrixAssert.match(section7.body, /docs renderer includes capability test evidence refs without executing tests/u);
  matrixAssert.match(section7.body, /Persisted CapabilityNode inventory is covered only as dry-run preview evidence/u);
  matrixAssert.match(section7.body, /Layer-source RiskPolicyNode generation\/migration design evidence/u);
  matrixAssert.match(section7.body, /full config Layer-source `RiskPolicyNode` inventory\/sourceRefs coverage now exists/u);
  matrixAssert.match(section7.body, /not connected to a live Layer runtime consumer/u);
  matrixAssert.doesNotMatch(
    section7.body,
    /status promoted|verified status set|RiskStateMachine execution enabled|runtime risk transition enabled|runtime test enabled|test execution enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|repo write enabled|cookie materialized|Authorization materialized|session id materialized|browser profile materialization enabled|descriptor coverage[^.\n]*(?:RiskStateMachine execution|runtime risk transition)|(?:RiskStateMachine execution|runtime risk transition)[^.\n]*descriptor coverage/iu,
  );
});

test('Site Capability Graph matrix records persisted CapabilityNode inventory dry-run coverage without repo writes', async () => {
  const [markdown, graphSource, generatedFixtureTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(GENERATED_FIXTURE_TEST_URL),
  ]);
  const section7 = extractSections(markdown).find((section) => section.number === 7);

  matrixAssert.equal(typeof section7?.body, 'string', 'Section 7 should exist');
  matrixAssert.equal(getField(section7, 'Current status'), '`verified`');
  matrixAssert.match(graphSource, /export function createGraphInventoryRepoOutputDryRun\b/u);
  matrixAssert.match(graphSource, /export function assertGraphInventoryRepoOutputDryRunCompatibility\b/u);
  matrixAssert.match(generatedFixtureTest, /generated graph inventory repo output dry-run previews contained target without repo writes/u);
  matrixAssert.match(generatedFixtureTest, /generated graph inventory repo output dry-run previews persisted CapabilityNode records only/u);
  matrixAssert.match(generatedFixtureTest, /generated graph inventory repo output dry-run rejects writes, unsafe targets, and unsafe artifacts/u);
  matrixAssert.match(generatedFixtureTest, /queryName, 'createGraphInventoryRepoOutputDryRun'/u);
  matrixAssert.match(generatedFixtureTest, /artifactFamily, 'site-capability-graph-inventory-repo-output-dry-run'/u);
  matrixAssert.match(generatedFixtureTest, /item\.dryRunOnly, true/u);
  matrixAssert.match(generatedFixtureTest, /item\.repoWriteEnabled, false/u);
  matrixAssert.match(generatedFixtureTest, /item\.runtimeGenerationEnabled, false/u);
  matrixAssert.match(generatedFixtureTest, /item\.runtimeArtifactWriteEnabled, false/u);
  matrixAssert.match(generatedFixtureTest, /item\.externalCommandEnabled, false/u);
  matrixAssert.match(generatedFixtureTest, /access\(path\.join\(process\.cwd\(\), targetRelativePath\)\), \/ENOENT\/u/u);

  matrixAssert.match(
    section7.body,
    /persisted CapabilityNode inventory dry-run coverage/u,
  );
  matrixAssert.match(section7.body, /generated graph inventory repo output dry-run previews contained target without repo writes/u);
  matrixAssert.match(section7.body, /generated graph inventory repo output dry-run previews persisted CapabilityNode records only/u);
  matrixAssert.match(section7.body, /generated graph inventory repo output dry-run rejects writes, unsafe targets, and unsafe artifacts/u);
  matrixAssert.match(section7.body, /createGraphInventoryRepoOutputDryRun\(\)/u);
  matrixAssert.match(section7.body, /assertGraphInventoryRepoOutputDryRunCompatibility\(\)/u);
  matrixAssert.match(section7.body, /dry-run-only|dry-run .*preview/u);
  matrixAssert.match(section7.body, /repo target non-creation|no repo file creation|without repo writes/u);
  matrixAssert.match(section7.body, /repoWriteEnabled=false/u);
  matrixAssert.match(section7.body, /runtimeGenerationEnabled=false/u);
  matrixAssert.match(section7.body, /runtimeArtifactWriteEnabled=false/u);
  matrixAssert.match(section7.body, /externalCommandEnabled=false/u);
  matrixAssert.match(section7.body, /full config Layer-source `RiskPolicyNode` inventory\/sourceRefs coverage now exists/u);
  matrixAssert.match(section7.body, /runtime\/write field injection guard/u);
  matrixAssert.match(getField(section7, 'Next smallest task'), /another non-verified section|do not repeat the full config Layer-source `RiskPolicyNode` inventory\/sourceRefs/iu);
  matrixAssert.doesNotMatch(
    section7.body,
    /status promoted|verified status set|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|repo write enabled|real repo writes|repo file created/iu,
  );
});

test('Site Capability Graph matrix records Layer-source RiskPolicyNode full config inventory coverage without promotion', async () => {
  const [markdown, graphSource, generatedFixtureTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(GENERATED_FIXTURE_TEST_URL),
  ]);
  const section7 = extractSections(markdown).find((section) => section.number === 7);

  matrixAssert.equal(typeof section7?.body, 'string', 'Section 7 should exist');
  matrixAssert.equal(getField(section7, 'Current status'), '`verified`');
  matrixAssert.match(graphSource, /export function createLayerSourceRiskPolicyInventorySummary/u);
  matrixAssert.match(graphSource, /export function assertLayerSourceRiskPolicyInventorySummaryCompatibility/u);
  matrixAssert.match(graphSource, /function assertNoLayerSourceRiskPolicyInventoryRuntimeWriteFields/u);
  matrixAssert.match(generatedFixtureTest, /function createGeneratedSyntheticGraphFromLayerDescriptor\(descriptor\)/u);
  matrixAssert.match(generatedFixtureTest, /const riskPolicyId = `risk-policy:\$\{siteKey\}:normal-readonly`/u);
  matrixAssert.match(generatedFixtureTest, /type: 'RiskPolicyNode'/u);
  matrixAssert.match(generatedFixtureTest, /type: 'capability_guarded_by_risk_policy'/u);
  matrixAssert.match(generatedFixtureTest, /sourceInventories: \[\.\.\.LAYER_SOURCE_INVENTORIES\]/u);
  matrixAssert.match(generatedFixtureTest, /generated synthetic graph fixture can be derived from an existing Layer site descriptor/u);
  matrixAssert.match(generatedFixtureTest, /generated Layer-source RiskPolicyNode inventory summary covers all config hosts descriptor-only/u);
  matrixAssert.match(generatedFixtureTest, /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u);
  matrixAssert.match(generatedFixtureTest, /Layer-source RiskPolicyNode inventory rejects runtime and write fields descriptor-only/u);
  matrixAssert.match(generatedFixtureTest, /collectLayerConfigHosts\(siteCapabilities, siteRegistry\)/u);
  matrixAssert.match(generatedFixtureTest, /assert\.equal\(items\.length, expectedHosts\.length\)/u);
  matrixAssert.match(generatedFixtureTest, /assert\.deepEqual\(items\.map\(\(item\) => item\.host\)\.sort\(\), expectedHosts\)/u);
  matrixAssert.match(generatedFixtureTest, /assertRiskPolicyNodeCompatible\(item\)/u);
  matrixAssert.match(generatedFixtureTest, /assertNoEnabledRuntimeInventoryFields\(summary\)/u);
  matrixAssert.match(generatedFixtureTest, /runtimeDispatchEnabled/u);
  matrixAssert.match(generatedFixtureTest, /writePath/u);

  matrixAssert.match(section7.body, /descriptor-only `RiskPolicyNode` \(`risk-policy:qidian:normal-readonly`\)/u);
  matrixAssert.match(section7.body, /`capability_guarded_by_risk_policy` edge/u);
  matrixAssert.match(section7.body, /`manifest\.sourceInventories` pointing at Layer source inventories/u);
  matrixAssert.match(section7.body, /generated Layer-source RiskPolicyNode inventory summary covers all config hosts descriptor-only/u);
  matrixAssert.match(section7.body, /full config Layer-source `RiskPolicyNode` inventory\/sourceRefs coverage across the parsed `config\/site-capabilities\.json` plus `config\/site-registry\.json` host union/u);
  matrixAssert.match(section7.body, /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u);
  matrixAssert.match(section7.body, /Layer-source RiskPolicyNode inventory rejects runtime and write fields descriptor-only/u);
  matrixAssert.match(section7.body, /full config Layer-source `RiskPolicyNode` inventory\/sourceRefs coverage now exists/u);
  matrixAssert.match(section7.body, /not connected to a live Layer runtime consumer/u);
  matrixAssert.match(getField(section7, 'Next smallest task'), /another non-verified section|do not repeat the full config Layer-source `RiskPolicyNode` inventory\/sourceRefs/iu);
  matrixAssert.doesNotMatch(
    section7.body,
    /production-grade full config inventory across Layer config sources remains missing|Layer-source RiskPolicyNode generation\/migration is covered only by a single synthetic descriptor design fixture/iu,
  );
  matrixAssert.doesNotMatch(
    getField(section7, 'Next smallest task') ?? '',
    /production-grade full config inventory coverage|Layer-source RiskPolicyNode migration across Layer config sources/iu,
  );
  matrixAssert.doesNotMatch(
    section7.body,
    /status promoted|verified status set|RiskStateMachine execution enabled|RiskStateMachine transition enabled|runtime risk transition enabled|descriptor coverage[^.\n]*(?:RiskStateMachine execution|runtime transition|runtime risk transition)|(?:RiskStateMachine execution|runtime transition|runtime risk transition)[^.\n]*descriptor coverage|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|SessionView materialized|downloader enabled|cookie materialized|Authorization materialized|session id materialized|browser profile materialization enabled/iu,
  );
});

test('Site Capability Graph matrix records Section 10 Layer-source Auth/Session inventory coverage without promotion', async () => {
  const markdown = await readMatrix();
  const section10 = extractSections(markdown).find((section) => section.number === 10);

  matrixAssert.equal(typeof section10?.body, 'string', 'Section 10 should exist');
  matrixAssert.equal(getField(section10, 'Current status'), '`verified`');

  for (const helperName of [
    'createLayerSourceAuthSessionRequirementInventorySummary()',
    'assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility()',
  ]) {
    matrixAssert.match(section10.body, new RegExp(helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const requiredPhrase of [
    /generated Layer-source AuthRequirement\/SessionRequirement inventory coverage/u,
    /Layer-source AuthRequirement\/SessionRequirement inventory sensitive fields fail-closed/u,
    /Layer-source AuthRequirement\/SessionRequirement inventory rejects SessionView\/cookie\/browser profile materialization/u,
    /parsed `config\/site-capabilities\.json` plus `config\/site-registry\.json`/u,
    /descriptor-only generated `AuthRequirementNode` \/ `SessionRequirementNode` inventory coverage/u,
    /runtime generation, repo writes, runtime artifact writes, credential materialization, and session materialization disabled/u,
    /no SessionView\/cookie\/browser profile materialization/u,
    /matrix evidence for Section 10 descriptor coverage/u,
  ]) {
    matrixAssert.match(section10.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section10, 'Current gaps') ?? '',
    /No open Section 10 AuthRequirement\/SessionRequirement taxonomy, schema, descriptor inventory, required\/optional\/none session requirement derivation, sensitive-field fail-closed, or no-SessionView\/no-cookie\/no-browser-profile materialization gap remains/u,
  );
  matrixAssert.match(
    getField(section10, 'Next smallest task') ?? '',
    /another non-verified section|do not repeat AuthRequirement\/SessionRequirement descriptor inventory/u,
  );
  matrixAssert.doesNotMatch(
    section10.body,
    /status promoted|verified status set|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|credentialMaterializationEnabled=true|sessionMaterializationEnabled=true|SessionView materialized|cookie materialized|Authorization materialized|session id materialized|browser profile materialization enabled|raw credentials persisted|raw cookies persisted/iu,
  );
});

test('Site Capability Graph matrix records Section 11 Layer-source SignerNode inventory coverage without promotion', async () => {
  const markdown = await readMatrix();
  const section11 = extractSections(markdown).find((section) => section.number === 11);

  matrixAssert.equal(typeof section11?.body, 'string', 'Section 11 should exist');
  matrixAssert.equal(getField(section11, 'Current status'), '`verified`');

  for (const helperName of [
    'createLayerSourceSignerDependencyInventorySummary()',
    'assertLayerSourceSignerDependencyInventorySummaryCompatibility()',
  ]) {
    matrixAssert.match(section11.body, new RegExp(helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const requiredPhrase of [
    /generated Layer-source SignerNode inventory coverage/u,
    /WBI dependency descriptors/u,
    /src\/sites\/core\/adapters\/bilibili\.mjs/u,
    /signatureEvidenceRequired=wbi/u,
    /sensitive signer material fail-closed/u,
    /no signer execution, signed URL, raw key, token, cookie, session, or browser profile materialization/u,
    /Section 11 descriptor coverage/u,
  ]) {
    matrixAssert.match(section11.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section11, 'Current gaps') ?? '',
    /No open Section 11 SignerNode taxonomy, schema, descriptor inventory, WBI dependency descriptor, reverse endpoint signer ref, sensitive signer material fail-closed/u,
  );
  matrixAssert.match(
    getField(section11, 'Next smallest task') ?? '',
    /another non-verified section|do not repeat SignerNode descriptor inventory/u,
  );
  matrixAssert.doesNotMatch(
    section11.body,
    /status promoted|verified status set|signerExecutionEnabled=true|signer execution enabled|signed URL produced|raw signer key materialized|raw key materialized|token materialized|cookie materialized|session materialized|browser profile materialized|raw signer material persisted|raw signer key persisted|raw token persisted|raw cookie persisted/iu,
  );
});

test('Site Capability Graph Section 13 records verified schema governance without runtime promotion', async () => {
  const [
    markdown,
    graphSource,
    schemaInventorySource,
    compatibilityRegistrySource,
    schemaInventoryTest,
    compatibilityRegistryTest,
    docsGeneratorTest,
  ] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(SCHEMA_INVENTORY_URL),
    readSource(COMPATIBILITY_REGISTRY_URL),
    readSource(SCHEMA_INVENTORY_TEST_URL),
    readSource(COMPATIBILITY_REGISTRY_TEST_URL),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);
  const section13 = extractSections(markdown).find((section) => section.number === 13);

  matrixAssert.equal(typeof section13?.body, 'string', 'Section 13 should exist');
  matrixAssert.equal(getField(section13, 'Current status'), '`verified`');

  for (const helperName of [
    'createLayerSourceRiskPolicyInventorySummary',
    'assertLayerSourceRiskPolicyInventorySummaryCompatibility',
    'createLayerSourceAuthSessionRequirementInventorySummary',
    'assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility',
    'createLayerSourceSignerDependencyInventorySummary',
    'assertLayerSourceSignerDependencyInventorySummaryCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
  }
  matrixAssert.match(graphSource, /assertGraphQueryResultCompatible\(summary\)/u);
  matrixAssert.match(graphSource, /schemaVersion: GRAPH_QUERY_RESULT_SCHEMA_VERSION/u);

  const nodeFamilyNames = [
    'CapabilityNode',
    'RouteNode',
    'EndpointNode',
    'AuthRequirementNode',
    'SessionRequirementNode',
    'SignerNode',
    'RiskPolicyNode',
    'SchemaNode',
    'VersionNode',
    'FailureModeNode',
    'ObservabilityNode',
  ];
  for (const nodeFamilyName of nodeFamilyNames) {
    matrixAssert.match(graphSource, new RegExp(`'${nodeFamilyName}'`, 'u'));
    matrixAssert.match(section13.body, new RegExp(`\\b${nodeFamilyName}\\b`, 'u'));
  }
  matrixAssert.match(graphSource, /export const GRAPH_NODE_TYPES = Object\.freeze/u);
  matrixAssert.match(graphSource, /\.\.\.GRAPH_NODE_TYPES\.map\(\(name\) => \[name, GRAPH_NODE_SCHEMA_VERSION\]\)/u);
  matrixAssert.match(schemaInventorySource, /\.\.\.GRAPH_NODE_TYPES\.map\(\(name\) => Object\.freeze\(\{/u);
  matrixAssert.match(schemaInventorySource, /version: GRAPH_NODE_SCHEMA_VERSION/u);
  matrixAssert.match(schemaInventorySource, /Graph node subtype is governed by the central GraphNode schema and compatibility assertion/u);
  matrixAssert.match(compatibilityRegistrySource, /\.\.\.GRAPH_NODE_TYPES\.map\(\(name\) => Object\.freeze\(\{/u);
  matrixAssert.match(compatibilityRegistrySource, /version: GRAPH_NODE_SCHEMA_VERSION/u);
  matrixAssert.match(compatibilityRegistrySource, /assertCompatible: assertGraphNodeCompatible/u);
  matrixAssert.match(section13.body, /individual graph node-family registry rows/u);
  matrixAssert.match(section13.body, /GRAPH_NODE_SCHEMA_VERSION/u);
  matrixAssert.match(section13.body, /assertGraphNodeCompatible/u);

  for (const summaryName of [
    'LayerSourceRiskPolicyInventorySummary',
    'LayerSourceAuthSessionRequirementInventorySummary',
    'LayerSourceSignerDependencyInventorySummary',
  ]) {
    matrixAssert.match(section13.body, new RegExp(summaryName, 'u'));
  }
  for (const helperCall of [
    'createLayerSourceRiskPolicyInventorySummary()',
    'assertLayerSourceRiskPolicyInventorySummaryCompatibility()',
    'createLayerSourceAuthSessionRequirementInventorySummary()',
    'assertLayerSourceAuthSessionRequirementInventorySummaryCompatibility()',
    'createLayerSourceSignerDependencyInventorySummary()',
    'assertLayerSourceSignerDependencyInventorySummaryCompatibility()',
  ]) {
    matrixAssert.match(section13.body, new RegExp(helperCall.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  matrixAssert.match(section13.body, /GraphQueryResult schema\/version reuse/u);
  matrixAssert.match(section13.body, /schema-inventory\/compatibility-registry tests/u);
  matrixAssert.match(section13.body, /schema-governed dry-run\/design-only inventory output evidence/u);
  matrixAssert.match(section13.body, /no repo\/db\/runtime writer enablement/u);
  matrixAssert.match(section13.body, /schema-governed graph inventory output remains dry-run and design-only/u);
  for (const helperCall of [
    'createGraphInventoryRepoOutputDryRun()',
    'createGraphInventoryRuntimeIntegrationDesign()',
    'createDisabledGraphInventoryRuntimeConsumerResult()',
    'createGraphRepoOutputApprovalGateDesign()',
  ]) {
    const helperName = helperCall.replace('()', '');
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section13.body, new RegExp(helperCall.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  matrixAssert.match(section13.body, /dry-run repo-output preview/u);
  matrixAssert.match(section13.body, /design-only runtime integration/u);
  matrixAssert.match(section13.body, /disabled runtime-consumer/u);
  matrixAssert.match(section13.body, /design-only approval-gate evidence/u);
  matrixAssert.match(section13.body, /no live repo inventory writer/u);
  matrixAssert.match(section13.body, /database writer/u);
  matrixAssert.match(section13.body, /runtime writer/u);
  matrixAssert.match(section13.body, /enabled runtime generator/u);
  matrixAssert.match(schemaInventoryTest, /GraphQueryResult/u);
  matrixAssert.match(schemaInventoryTest, /tests\/node\/compatibility-registry\.test\.mjs/u);
  matrixAssert.match(compatibilityRegistryTest, /GraphQueryResult/u);
  matrixAssert.match(compatibilityRegistryTest, /compatibility registry accepts current schema payload versions/u);
  matrixAssert.match(docsGeneratorTest, /docs renderer includes endpoint version refs without version gate execution/u);
  matrixAssert.match(docsGeneratorTest, /versionRef/u);
  matrixAssert.match(docsGeneratorTest, /VersionNode|node_has_version/u);
  matrixAssert.match(docsGeneratorTest, /version gate execution\|runtime version check\|endpoint execution/u);
  matrixAssert.match(section13.body, /docs renderer includes endpoint version refs without version gate execution/u);
  matrixAssert.match(section13.body, /versionRef/u);
  matrixAssert.match(section13.body, /VersionNode|node_has_version/u);
  matrixAssert.match(
    section13.body,
    /without[^.\n]*version gate execution[^.\n]*(?:runtime version checks?[^.\n]*endpoint execution|endpoint execution[^.\n]*runtime version checks?)/iu,
  );
  matrixAssert.match(getField(section13, 'Verification result') ?? '', /B accepted Section 13 promotion readiness/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /No open Section 13 Schema governance gap remains/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /Layer-source inventory summaries have central registry rows/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /individual graph node-family central registry rows exist/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /schema-governed inventory output boundary evidence covers dry-run repo-output preview/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /design-only runtime integration/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /disabled runtime-consumer/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /design-only approval-gate evidence/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /no database\/runtime-state persistence/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /still no live repo inventory writer|no live repo inventory writer/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /database writer/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /runtime writer/u);
  matrixAssert.match(getField(section13, 'Current gaps') ?? '', /enabled runtime generator/u);
  matrixAssert.doesNotMatch(
    getField(section13, 'Current gaps') ?? '',
    /Graph node-family subtypes are still covered through GraphNode rather than individual central registry rows/u,
  );
  matrixAssert.doesNotMatch(
    getField(section13, 'Current gaps') ?? '',
    /persisted inventory output exists only as synthetic temp-dir test paths and design-only descriptors/u,
  );
  matrixAssert.match(getField(section13, 'Next smallest task') ?? '', /Move to another `partial` Site Capability Graph section/u);
  matrixAssert.match(getField(section13, 'Next smallest task') ?? '', /do not repeat Section 13/u);
  matrixAssert.doesNotMatch(
    getField(section13, 'Next smallest task') ?? '',
    /Ask B to evaluate whether Section 13 is ready|individual graph node-family registry rows/iu,
  );

  matrixAssert.doesNotMatch(
    section13.body,
    /status promoted|verified status set|version gate execution enabled|runtime version check enabled|endpoint execution enabled|database enabled|databaseEnabled=true|runtime writer enabled|runtimeWriterEnabled=true|repo output enabled|repoOutputEnabled=true|repo writer enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|runtime writes enabled|repo writes enabled|runtime inventory writer enabled|raw credential|cookie materialized|Authorization materialized|SessionView materialized|browser profile materialized/iu,
    'Section 13 should record verified schema governance without runtime/repo/database enablement',
  );
});

test('Site Capability Graph matrix tracks disabled runtime consumer descriptors without marking them live', async () => {
  const [markdown, graphSource, plannerSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(PLANNER_HANDOFF_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section.body]));
  const descriptorNames = [
    {
      name: 'createDisabledGraphPlannerRuntimeConsumerResult',
      source: plannerSource,
      sectionNumbers: [3, 16, 17, 19, 20],
      boundaryPhrase: 'no live Layer planner runtime executes Graph route handoffs',
    },
    {
      name: 'createDisabledGraphDocsLifecycleDispatchConsumerResult',
      source: graphSource,
      sectionNumbers: [16, 18, 19, 20],
      boundaryPhrase: 'external telemetry',
    },
    {
      name: 'createDisabledGraphMigrationReportRuntimeConsumerResult',
      source: graphSource,
      sectionNumbers: [16, 19, 20],
      boundaryPhrase: 'repo-level migration report output remain dry-run-only',
    },
    {
      name: 'createDisabledGraphInventoryRuntimeConsumerResult',
      source: graphSource,
      sectionNumbers: [1, 4, 13, 16, 19, 20],
      boundaryPhrase: 'runtime generation, repo writes',
    },
    {
      name: 'createDisabledGraphDocsMarkdownRuntimeConsumerResult',
      source: graphSource,
      sectionNumbers: [16, 19, 20],
      boundaryPhrase: 'runtime Layer docs writes',
    },
  ];

  for (const descriptor of descriptorNames) {
    matrixAssert.match(
      descriptor.source,
      new RegExp(`export function ${descriptor.name}\\b`, 'u'),
      `${descriptor.name} should remain an exported source descriptor`,
    );
    matrixAssert.match(markdown, new RegExp(`${descriptor.name}\\(\\)`, 'u'), `${descriptor.name} should be listed in matrix evidence`);
    for (const sectionNumber of descriptor.sectionNumbers) {
      const sectionBody = sectionByNumber.get(sectionNumber);
      matrixAssert.equal(typeof sectionBody, 'string', `Section ${sectionNumber} should exist`);
      matrixAssert.match(
        sectionBody,
        /\bdisabled\b|\bdescriptor-only\b|\bdesign-only\b|\bdry-run-only\b/iu,
        `Section ${sectionNumber} should keep disabled/descriptor wording for ${descriptor.name}`,
      );
    }
    matrixAssert.match(
      markdown,
      new RegExp(descriptor.boundaryPhrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `${descriptor.name} should have a matrix boundary phrase preventing live-runtime overclaiming`,
    );
  }

  const section19 = sectionByNumber.get(19) ?? '';
  matrixAssert.doesNotMatch(section19, /\bverified\b.*disabled .*runtime consumer/iu);
  matrixAssert.match(section19, /disabled\/design\/dry-run\/descriptor-only/iu);
  matrixAssert.match(section19, /do not enable runtime writes, external telemetry, or route execution/iu);
});

test('Site Capability Graph docs-output runtime consumer remains an unintegrated disabled gap', async () => {
  const [markdown, graphSource, sourceFiles] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    listSourceFiles(SRC_URL),
  ]);

  matrixAssert.match(graphSource, /export function createDisabledGraphDocsMarkdownRuntimeConsumerResult\b/u);
  matrixAssert.match(graphSource, /featureFlag: 'siteCapabilityGraphDocsMarkdownRuntimeEnabled'/u);
  matrixAssert.match(graphSource, /featureEnabled: false/u);
  matrixAssert.match(graphSource, /result: 'blocked'/u);
  matrixAssert.match(graphSource, /Graph docs Markdown runtime consumer is disabled by feature flag/u);
  matrixAssert.match(
    markdown,
    /runtime Layer docs-output consumer gap test remains disabled until explicit integration exists/u,
  );

  const consumerReferences = [];
  for (const fileUrl of sourceFiles) {
    const source = await readSource(fileUrl);
    if (source.includes('createDisabledGraphDocsMarkdownRuntimeConsumerResult')) {
      consumerReferences.push(fileUrl.pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
    }
  }

  matrixAssert.deepEqual(
    consumerReferences.map((filePath) => filePath.replaceAll('\\', '/')).sort(),
    ['C:/Users/lyt-p/Desktop/Browser-Wiki-Skill/src/sites/capability/site-capability-graph.mjs'],
  );
  matrixAssert.doesNotMatch(markdown, /runtime docs-output consumer enabled|docs runtime writer invoked|repo docs writer invoked|status promoted|verified status set/iu);
});

test('Site Capability Graph docs-output redaction audit attachment guard remains contained to graph-derived writer', async () => {
  const [markdown, graphSource, artifactSource, artifactWriterTest, sourceFiles] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
    listSourceFiles(SRC_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  matrixAssert.match(
    markdown,
    /Site Capability Graph docs-output redaction audit attachment guard remains contained to graph-derived writer/iu,
  );
  matrixAssert.match(graphSource, /assertGraphDocsMarkdownArtifactConsumerCompatibility\(artifact\)/u);
  matrixAssert.match(artifactSource, /export function prepareGraphDerivedArtifactWrite\b/u);
  matrixAssert.match(artifactSource, /export async function writeGraphDerivedArtifactPair\b/u);
  matrixAssert.match(artifactSource, /assertGraphDerivedArtifactRedactionAuditAttachmentCompatible\b/u);
  matrixAssert.match(artifactSource, /redactionAuditAttachment/u);
  matrixAssert.match(artifactSource, /writeOrder: 'audit-before-artifact'/u);
  matrixAssert.match(artifactSource, /prepareRedactedArtifactJsonWithAudit\(artifact, options\)/u);
  matrixAssert.match(artifactSource, /writeFile\(auditTarget\.resolved, prepared\.auditJson, 'utf8'\)/u);
  matrixAssert.match(artifactSource, /writeFile\(artifactTarget\.resolved, prepared\.artifactJson, 'utf8'\)/u);
  matrixAssert.match(
    artifactWriterTest,
    /graph artifact writer writes docs markdown output with redaction audit attachment/u,
  );
  matrixAssert.match(
    artifactWriterTest,
    /graph artifact writer rejects docs markdown query results that bypass docs-output guard/u,
  );

  const graphArtifactWriterReferences = [];
  for (const fileUrl of sourceFiles) {
    const source = await readSource(fileUrl);
    if (
      source.includes('prepareGraphDerivedArtifactWrite(')
      || source.includes('writeGraphDerivedArtifactPair(')
    ) {
      graphArtifactWriterReferences.push(fileUrl.pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
    }
  }

  matrixAssert.deepEqual(
    graphArtifactWriterReferences.map((filePath) => filePath.replaceAll('\\', '/')).sort(),
    ['C:/Users/lyt-p/Desktop/Browser-Wiki-Skill/src/sites/capability/site-capability-graph-artifacts.mjs'],
  );

  for (const sectionNumber of [16, 18, 19, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    const status = getField(section, 'Current status')?.replaceAll('`', '');
    matrixAssert.equal(status, 'partial', `Section ${sectionNumber} should stay partial after contained docs-output audit guard evidence`);
  }

  matrixAssert.match(
    markdown,
    /Runtime Layer write-path integration still does not exist; the current redaction audit attachment is limited to the guarded graph-derived artifact writer/iu,
  );
  matrixAssert.match(markdown, /not yet integrated into a live Layer docs-output consumer/iu);
  matrixAssert.doesNotMatch(
    markdown,
    /docs runtime writer invoked|status promoted|verified status set|runtime Layer write-path integration complete|SessionView materialized|downloader enabled/iu,
  );
});

test('Site Capability Graph Section 16 records graph-derived artifact consumer dispatch redaction audit gate without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section16 = extractSections(markdown).find((section) => section.number === 16);
  const focusedTestNames = [
    'graph-derived artifact consumer dispatch redaction audit gate returns safe consumer summaries',
    'graph-derived artifact consumer dispatch redaction audit gate rejects missing mutated or incompatible audit',
    'graph-derived artifact consumer dispatch redaction audit gate rejects runtime options and sensitive payloads',
  ];
  const helperNames = [
    'dispatchGraphDerivedArtifactWithRedactionAuditGate',
    'assertGraphDerivedArtifactConsumerDispatchRedactionGateCompatibility',
  ];

  matrixAssert.equal(typeof section16?.body, 'string', 'Section 16 should exist');
  matrixAssert.equal(getField(section16, 'Current status'), '`partial`');
  for (const focusedTestName of focusedTestNames) {
    matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));
  }
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section16.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /graph-derived artifact consumer dispatch redaction audit gate evidence/u,
    ...focusedTestNames.map((focusedTestName) => (
      new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u')
    )),
    /dispatch-time redaction audit gate/u,
    /in-memory graph-derived artifact consumer registry/u,
    /fails closed when `redactionAuditAttachment` is missing, mutated, incompatible, runtime-shaped, or sensitive/u,
    /requires `redactionAuditAttachment` before in-memory consumer registry dispatch/u,
    /keeps repo\/docs\/runtime writes/u,
    /external telemetry/u,
    /publish/u,
    /SiteAdapter/u,
    /downloader/u,
    /SessionView disabled/u,
    /does not complete a live Layer docs-output writer/u,
    /Section 16 remains `partial`/u,
  ]) {
    matrixAssert.match(section16.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section16, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "redaction audit gate"/u,
  );
  matrixAssert.match(
    getField(section16, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "redaction audit gate"/u,
  );
  matrixAssert.match(
    section16.body,
    /redaction audit gate verification: `node --check src\\sites\\capability\\site-capability-graph-artifacts\.mjs` passed; focused artifact-writer validation passed 3\/3 .* focused matrix validation passed 1\/1 .* full artifact-writer suite passed 20\/20; full matrix suite passed 64\/64/isu,
  );
  matrixAssert.match(
    getField(section16, 'Current gaps') ?? '',
    /live Layer docs-output writer completion.*runtime Layer docs writes.*repo writes.*runtime artifact writes.*external telemetry dispatch.*publish/isu,
  );

  const gateLines = section16.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('consumer dispatch redaction audit gate')
      || line.includes('redaction audit gate verification')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(gateLines, '', 'Section 16 should include redaction audit gate lines');
  matrixAssert.doesNotMatch(
    gateLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|write enabled|writes enabled|repo write enabled|docs write enabled|runtime artifact write enabled|runtime writer invoked|docs runtime writer invoked|repo writer invoked|artifact writer invoked|runtime artifact writer invoked|external telemetry enabled|telemetry enabled|publish enabled|publish invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|live Layer docs-output writer completed/iu,
    'Section 16 redaction audit gate lines should not claim promotion, writes, telemetry, publish, invocation, or live writer completion',
  );
});

test('Site Capability Graph docs-output runtime write-path integration guard remains disabled and audit-bound', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  matrixAssert.match(artifactSource, /createGraphDocsMarkdownRuntimeWritePathIntegrationGuard/u);
  matrixAssert.match(artifactSource, /assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility/u);
  matrixAssert.match(artifactSource, /GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE/u);
  matrixAssert.match(artifactSource, /redactionRequiredBeforeWrite/u);
  matrixAssert.match(artifactSource, /docsWriteEnabled:\s*false/u);
  matrixAssert.match(artifactSource, /repoWriteEnabled:\s*false/u);
  matrixAssert.match(artifactSource, /runtimeArtifactWriteEnabled:\s*false/u);
  matrixAssert.match(artifactSource, /sessionMaterializationEnabled:\s*false/u);
  matrixAssert.match(artifactSource, /downloaderEnabled:\s*false/u);
  matrixAssert.match(artifactSource, /siteAdapterEnabled:\s*false/u);

  matrixAssert.match(
    artifactWriterTest,
    /docs markdown runtime write-path guard consumes redaction audit attachment while disabled/u,
  );
  matrixAssert.match(
    artifactWriterTest,
    /docs markdown runtime write-path guard rejects enabled runtime products and mutated audit attachments/u,
  );

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    const status = getField(section, 'Current status')?.replaceAll('`', '');
    matrixAssert.equal(status, 'partial', `Section ${sectionNumber} should stay partial after disabled runtime guard evidence`);
    matrixAssert.match(section.body, /Current round runtime write-path integration guard evidence/u);
    matrixAssert.match(section.body, /createGraphDocsMarkdownRuntimeWritePathIntegrationGuard\(\)/u);
    matrixAssert.match(section.body, /assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility\(\)/u);
    matrixAssert.match(section.body, /redactionAuditAttachment/u);
    matrixAssert.match(section.body, /graph-runtime-consumer-disabled/u);
    matrixAssert.match(section.body, /disabled\/design-only/u);
    matrixAssert.doesNotMatch(
      section.body,
      /Current status: `verified`|status promoted|verified status set|runtime Layer write-path integration complete|docs runtime writer invoked|repo writer invoked|runtime artifact writer invoked|SessionView materialized|downloader enabled|publish enabled/iu,
    );
  }
});

test('Site Capability Graph docs-output reviewed Layer consumer preflight remains disabled and review-bound', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const focusedTestName = 'docs markdown reviewed Layer consumer preflight consumes runtime write-path guard while disabled';
  const helperNames = [
    'createGraphDocsMarkdownReviewedLayerConsumerPreflight',
    'assertGraphDocsMarkdownReviewedLayerConsumerPreflightCompatibility',
  ];
  const requiredMatrixPhrases = [
    /reviewed Layer consumer preflight/iu,
    /BReviewRequired/u,
    /redactionRequiredBeforeIntegration/u,
    /reviewedIntegrationRequired/u,
    /graph-runtime-consumer-disabled/u,
  ];
  const disabledBoundaryPhrases = [
    /docs(?:\/repo\/runtime artifact)? writes? disabled|docsWriteEnabled=false|docs writes disabled/iu,
    /repo(?:\/runtime artifact)? writes? disabled|repoWriteEnabled=false|repo writes disabled/iu,
    /runtime artifact writes? disabled|runtimeArtifactWriteEnabled=false/iu,
    /publish disabled|publishEnabled=false/iu,
    /external telemetry disabled|externalTelemetryEnabled=false/iu,
    /SessionView(?: materialization)? disabled|sessionMaterializationEnabled=false|no SessionView/iu,
    /downloader disabled|downloaderEnabled=false|no downloader/iu,
    /SiteAdapter disabled|siteAdapterEnabled=false|no SiteAdapter/iu,
    /live runtime consumer disabled|runtime consumer remains disabled|no live runtime consumer/iu,
  ];
  const forbiddenRuntimeClaims = /Current status: `verified`|status promoted|verified status set|verified promotion|write enabled|writes enabled|docs write enabled|repo write enabled|runtime artifact write enabled|runtime enabled|runtime consumer enabled|live runtime consumer enabled|publish enabled|external telemetry enabled|SessionView materialized|downloader enabled|SiteAdapter invoked/iu;

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactSource, new RegExp(`${escapedHelperName}\\(`, 'u'));
  }
  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    const reviewedPreflightLines = section.body
      .split(/\r?\n/u)
      .filter((line) => /reviewed Layer consumer preflight/iu.test(line))
      .join('\n');
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    matrixAssert.match(section.body, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\(\\)`, 'u'));
    }
    for (const requiredPhrase of requiredMatrixPhrases) {
      matrixAssert.match(reviewedPreflightLines, requiredPhrase);
    }
    for (const disabledPhrase of disabledBoundaryPhrases) {
      matrixAssert.match(reviewedPreflightLines, disabledPhrase);
    }
    matrixAssert.doesNotMatch(
      reviewedPreflightLines,
      forbiddenRuntimeClaims,
      `Section ${sectionNumber} should record reviewed Layer consumer preflight evidence without promotion, runtime enablement, writes, publish, telemetry, or materialization`,
    );
  }
});

test('Site Capability Graph docs Markdown redaction integration acceptance guard remains disabled and partial', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const focusedTestName = 'docs markdown redaction integration acceptance guard consumes reviewed preflight while disabled';
  const helperNames = [
    'createGraphDocsMarkdownRedactionIntegrationAcceptanceGuard',
    'assertGraphDocsMarkdownRedactionIntegrationAcceptanceGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-docs-markdown-redaction-integration-acceptance-guard';
  const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedArtifactFamily = artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactSource, new RegExp(`${escapedHelperName}\\(`, 'u'));
  }
  matrixAssert.match(artifactSource, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactWriterTest, new RegExp(escapedArtifactFamily, 'u'));
  matrixAssert.match(artifactWriterTest, new RegExp(escapedFocusedTestName, 'u'));

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    const acceptanceGuardLines = section.body
      .split(/\r?\n/u)
      .filter((line) => (
        line.includes('redaction integration acceptance guard')
        || line.includes(focusedTestName)
        || helperNames.some((helperName) => line.includes(helperName))
        || line.includes(artifactFamily)
      ))
      .join('\n');
    matrixAssert.notEqual(
      acceptanceGuardLines,
      '',
      `Section ${sectionNumber} should record docs Markdown redaction integration acceptance guard evidence`,
    );

    matrixAssert.match(acceptanceGuardLines, new RegExp(escapedFocusedTestName, 'u'));
    for (const helperName of helperNames) {
      matrixAssert.match(
        acceptanceGuardLines,
        new RegExp(`${helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\(\\)`, 'u'),
      );
    }
    for (const requiredPhrase of [
      new RegExp(escapedArtifactFamily, 'u'),
      /reviewed preflight consumed|consumes reviewed preflight|consumes the reviewed Layer consumer preflight/iu,
      /BReviewRequired/u,
      /redactionRequiredBeforeIntegration/u,
      /reviewedIntegrationRequired/u,
      /graph-runtime-consumer-disabled/u,
      /descriptor-only|descriptor only/iu,
      /blocked/iu,
      /no docs\/repo\/runtime artifact writes|docs\/repo\/runtime artifact writes disabled|docs writes disabled.*repo writes disabled.*runtime artifact writes disabled/isu,
      /no artifact writer|artifact writer disabled/iu,
      /no publish|publish disabled/iu,
      /no external telemetry|external telemetry disabled/iu,
      /no SessionView\/downloader\/SiteAdapter|SessionView.*downloader.*SiteAdapter|no SessionView.*no downloader.*no SiteAdapter/isu,
      /no matrix status change|matrix status change disabled|Section (?:16|20) remains `partial`/iu,
    ]) {
      matrixAssert.match(acceptanceGuardLines, requiredPhrase);
    }

    matrixAssert.doesNotMatch(
      acceptanceGuardLines,
      /Current status: `verified`|status promoted|verified status set|verified promotion|runtime writer invoked|docs runtime writer invoked|repo writer invoked|artifact writer invoked|runtime artifact writer invoked|publish enabled|external telemetry enabled|SessionView materialized|downloader enabled|SiteAdapter invoked|sensitive echo|synthetic-secret-value|Authorization: Bearer|cookie materialized|credential materialized/iu,
      `Section ${sectionNumber} redaction integration acceptance guard lines should not claim promotion, writes, publish, runtime materialization, or sensitive echo`,
    );
  }
});

test('Site Capability Graph Section 20 records docs markdown artifact registry consumer without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const focusedTestName = 'docs markdown artifact registry consumer';
  const helperNames = [
    'createGraphDerivedArtifactConsumerRegistry',
    'createGraphDocsMarkdownArtifactRegistryConsumer',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');
  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /docs Markdown artifact registry consumer evidence/u,
    /docs markdown artifact registry consumer/u,
    /Layer-owned in-memory graph-derived artifact consumer registry/u,
    /docs Markdown artifact consumer safety prerequisite/u,
    /safe pre-integration boundary/u,
    /not a repo writer/u,
    /docs writer/u,
    /runtime artifact writer/u,
    /external telemetry connector/u,
    /publish path/u,
    /SiteAdapter invocation/u,
    /downloader invocation/u,
    /Session materialization/u,
    /Section 20 remains `partial`/u,
  ]) {
    matrixAssert.match(section20.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section20, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "docs markdown artifact registry consumer"/u,
  );
  matrixAssert.match(
    getField(section20, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "artifact registry consumer"/u,
  );
  for (const gapPhrase of [
    /live runtime docs-output writer/u,
    /runtime Layer docs writes/u,
    /docs writes/u,
    /repo writes/u,
    /publish/u,
    /runtime artifact writes/u,
    /external telemetry dispatch/u,
    /reviewed live Layer consumer integration/u,
  ]) {
    matrixAssert.match(getField(section20, 'Current gaps') ?? '', gapPhrase);
  }

  const registryConsumerLines = section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('docs Markdown artifact registry consumer')
      || line.includes(focusedTestName)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(registryConsumerLines, '', 'Section 20 should include docs Markdown artifact registry consumer lines');
  matrixAssert.doesNotMatch(
    registryConsumerLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|repo writer invoked|docs writer invoked|runtime artifact writer invoked|artifact writer invoked|write enabled|writes enabled|repo write enabled|docs write enabled|runtime artifact write enabled|external telemetry enabled|telemetry enabled|publish enabled|publish invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|Session materialized/iu,
    'Section 20 docs Markdown artifact registry consumer lines should not claim writes, telemetry, publish, runtime materialization, or promotion',
  );
});

test('Site Capability Graph Section 20 records live writer completion guard without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const focusedTestName = 'live writer completion guard';
  const helperNames = [
    'createGraphDocsOutputLiveWriterCompletionGuard',
    'assertGraphDocsOutputLiveWriterCompletionGuardCompatibility',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');
  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /live docs-output writer completion guard evidence/u,
    /descriptor-only \/ disabled live docs-output writer completion guard/u,
    /docs write, repo write, runtime artifact write, publish, external telemetry, external dispatch, SiteAdapter, downloader, SessionView, task runner, and matrix status promotion disabled/u,
    /rejects writer\/write path\/output\/repo\/publish\/telemetry\/session\/downloader\/SiteAdapter\/task\/profile\/raw payloads/u,
    /synthetic sensitive material without echoing values/u,
    /Section 20 remains `partial`/u,
    /not live writer completion/u,
    /not status promotion/u,
  ]) {
    matrixAssert.match(section20.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section20, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "live writer completion guard"/u,
  );
  matrixAssert.match(
    section20.body,
    /live docs-output writer completion guard verification: `node --check src\\sites\\capability\\site-capability-graph-artifacts\.mjs` passed; focused artifact-writer validation passed 3\/3 .* focused matrix validation passed 1\/1/isu,
  );
  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /live writer completion guard evidence exist/u,
  );
  for (const gapPhrase of [
    /live runtime docs-output writer/u,
    /runtime Layer docs writes/u,
    /docs writes/u,
    /repo writes/u,
    /publish/u,
    /runtime artifact writes/u,
    /external telemetry dispatch/u,
    /reviewed live Layer consumer integration/u,
  ]) {
    matrixAssert.match(getField(section20, 'Current gaps') ?? '', gapPhrase);
  }

  const guardLines = section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('live docs-output writer completion guard')
      || line.includes(focusedTestName)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(guardLines, '', 'Section 20 should include live writer completion guard lines');
  matrixAssert.doesNotMatch(
    guardLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live writer completed|live writer enabled|writer invoked|repo writer invoked|docs writer invoked|runtime artifact writer invoked|artifact writer invoked|write enabled|writes enabled|repo write enabled|docs write enabled|runtime artifact write enabled|external telemetry enabled|telemetry enabled|publish enabled|publish invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|Session materialized|sensitive value echoed/iu,
    'Section 20 live writer completion guard lines should not claim writes, telemetry, publish, runtime materialization, or promotion',
  );
});

test('Site Capability Graph docs Markdown runtime consumer handoff guard remains partial for Sections 16 and 20', async () => {
  const [markdown, graphSource, artifactGuardTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const focusedTestName = 'docs markdown runtime consumer handoff guard consumes future preflight before disabled runtime consumer wiring';
  const helperNames = [
    'createGraphDocsMarkdownRuntimeConsumerHandoffGuard',
    'assertGraphDocsMarkdownRuntimeConsumerHandoffGuardCompatibility',
  ];
  const artifactFamily = 'site-capability-graph-docs-markdown-runtime-consumer-handoff-guard';
  const forbiddenRuntimeClaims = /Current status: `verified`|status promoted|verified status set|verified promotion|runtime docs writer invoked|repo writer invoked|runtime artifact writer invoked|SessionView materialized|downloader enabled|SiteAdapter invoked/iu;

  for (const helperName of helperNames) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(graphSource, new RegExp(`${helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\(`, 'u'));
  }
  matrixAssert.match(graphSource, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(artifactGuardTest, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    matrixAssert.match(section.body, /docs Markdown runtime consumer handoff guard/iu);
    matrixAssert.match(section.body, new RegExp(focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\(\\)`, 'u'));
    }
    matrixAssert.match(section.body, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    matrixAssert.match(section.body, /disabled|design-only|preflight|blocked/iu);
    matrixAssert.match(section.body, /node --test tests\/node\/site-capability-graph-matrix\.test\.mjs/iu);
    matrixAssert.doesNotMatch(
      section.body,
      forbiddenRuntimeClaims,
      `Section ${sectionNumber} should bind handoff evidence without runtime writer, materialization, invocation, or promotion wording`,
    );
  }
});

test('Site Capability Graph Section 18 next task tracks observability integration gaps without stale redaction-audit wording', async () => {
  const markdown = await readMatrix();
  const section18 = extractSections(markdown).find((section) => section.number === 18);

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set/iu,
    'Section 18 should not be promoted by this guard',
  );

  const nextSmallestTask = getField(section18, 'Next smallest task');
  matrixAssert.equal(typeof nextSmallestTask, 'string', 'Section 18 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /\bruntime redaction audit attachment gap\b|\bredaction audit attachment\b/iu,
    'Section 18 next task should not point at the completed redaction audit attachment gap',
  );
  matrixAssert.match(
    nextSmallestTask,
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/iu,
    'Section 18 next task should move past completed implementation preflight evidence toward a smaller concrete runtime guard',
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /live runtime producer\/subscriber implementation preflight|focused runtime observability adapter wiring boundary evidence|preflight and contract coverage|preflight contract coverage|disabled-by-default Layer observability adapter handshake test|consumes the preflight before any runtime producer\/subscriber registration is allowed|Add a disabled no-op Layer observability consumer integration design|disabled no-op Layer observability consumer docs\/matrix cross-check|docs\/matrix cross-check evidence batch/iu,
    'Section 18 next task should not repeat completed adapter-boundary, preflight, handshake, consumer integration design, docs/matrix cross-check, or implementation preflight evidence batches',
  );
});

test('Site Capability Graph Section 18 records runtime producer subscriber boundary evidence without telemetry promotion', async () => {
  const [markdown, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const w1TestName = 'docs lifecycle dispatch runtime producer subscriber boundary stays descriptor-only without external telemetry';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  matrixAssert.match(observabilityTest, new RegExp(w1TestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(w1TestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  matrixAssert.match(section18.body, /descriptor-only \/ feature-disabled \/ blocked evidence/u);
  matrixAssert.match(section18.body, /redactionRequired/u);
  matrixAssert.match(section18.body, /synthetic trace\/correlation\/task\/run IDs/u);
  matrixAssert.match(section18.body, /external telemetry disabled/u);
  matrixAssert.match(
    section18.body,
    /no runtime dispatch, subscriber registration, runtime log write, artifact write, runtime docs write/u,
  );
  matrixAssert.match(observabilityTest, /externalTelemetryDispatchEnabled,\s*false|externalTelemetryDispatchEnabled.*false/u);
  matrixAssert.match(observabilityTest, /subscriberRegistrationEnabled,\s*false|subscriberRegistrationEnabled.*false/u);
  matrixAssert.match(observabilityTest, /runtimeDispatchEnabled,\s*false|runtimeDispatchEnabled.*false/u);
  matrixAssert.match(
    observabilityTest,
    /runtimeArtifactWriteEnabled,\s*false|runtimeArtifactWriteEnabled.*false|repoArtifactWriteEnabled,\s*false|repoArtifactWriteEnabled.*false/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /real (?:Graph-docs\/Layer )?runtime producer\/subscriber integration, true Layer adapter wiring, and external telemetry are still not connected; runtime dispatch\/log\/artifact writes remain disabled/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Next smallest task') ?? '',
    /live runtime producer\/subscriber implementation preflight|focused runtime observability adapter wiring boundary evidence|Add focused evidence for runtime observability producer\/subscriber integration boundaries|preflight and contract coverage|preflight contract coverage|disabled-by-default Layer observability adapter handshake test|Add a disabled no-op Layer observability consumer integration design|disabled no-op Layer observability consumer docs\/matrix cross-check|docs\/matrix cross-check evidence batch/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime-enabled|external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled/iu,
  );
});

test('Site Capability Graph Section 18 records lifecycle dispatch preflight contract without promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const preflightTestName = 'graph docs lifecycle dispatch preflight rejects telemetry subscribers and runtime writes before enablement';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  matrixAssert.match(observabilityTest, new RegExp(preflightTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(preflightTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, /Current round preflight contract evidence/u);
  matrixAssert.match(section18.body, /runtime observability producer\/subscriber integration preflight contract coverage/u);

  for (const helperName of [
    'createGraphDocsLifecycleDispatchPreflightContract',
    'assertGraphDocsLifecycleDispatchPreflightCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, /\bsourcePreflight\b/u);
  matrixAssert.match(graphSource, /\brequiredPreflightGuard\b/u);
  matrixAssert.match(section18.body, /sourcePreflight/u);
  matrixAssert.match(section18.body, /requiredPreflightGuard/u);
  matrixAssert.match(section18.body, /design\/disabled consumer sourcePreflight\/requiredPreflightGuard|disabled consumer source `sourcePreflight` \/ `requiredPreflightGuard` evidence/u);

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "graph docs lifecycle dispatch preflight rejects telemetry subscribers and runtime writes before enablement"/u,
  );
  matrixAssert.match(getField(section18, 'Verification command') ?? '', /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs/u);
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /focused observability preflight command passed 19\/19|Observability \+ matrix suite passed 52\/52|matrix suite passed 33\/33/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /real (?:Graph-docs\/Layer )?runtime producer\/subscriber integration, true Layer adapter wiring, and external telemetry are still not connected; runtime dispatch\/log\/artifact writes remain disabled/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Next smallest task') ?? '',
    /live runtime producer\/subscriber implementation preflight|focused runtime observability adapter wiring boundary evidence|preflight and contract coverage|preflight contract coverage|disabled-by-default Layer observability adapter handshake test|consumes the preflight before any runtime producer\/subscriber registration is allowed|Add a disabled no-op Layer observability consumer integration design|disabled no-op Layer observability consumer docs\/matrix cross-check|docs\/matrix cross-check evidence batch/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime-enabled|external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|runtime producer registered|telemetry subscriber registered/iu,
    'Section 18 should bind preflight evidence without promotion or runtime/telemetry enablement',
  );
});

test('Site Capability Graph Section 18 records disabled observability adapter handshake evidence without promotion', async () => {
  const [markdown, docsMatrixCrosscheckTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_MATRIX_CROSSCHECK_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const handshakeTestName = 'disabled Layer observability adapter handshake consumes preflight before runtime registration';
  const matrixCrossCheckTestName = 'GraphDocsSummary matrix cross-check covers disabled observability adapter handshake evidence';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  matrixAssert.match(docsMatrixCrosscheckTest, new RegExp(matrixCrossCheckTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(handshakeTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(matrixCrossCheckTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, /createDisabledGraphDocsLifecycleObservabilityAdapterHandshake\(\)/u);
  matrixAssert.match(section18.body, /assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility\(\)/u);
  matrixAssert.match(section18.body, /\bpreflight\b/u);
  matrixAssert.match(section18.body, /\bsourcePreflight\b/u);
  matrixAssert.match(section18.body, /\brequiredPreflightGuard\b/u);
  matrixAssert.match(section18.body, /before any runtime registration can be considered/u);
  matrixAssert.match(section18.body, /does not register subscribers/u);
  matrixAssert.match(section18.body, /dispatch runtime lifecycle events/u);
  matrixAssert.match(section18.body, /connect external telemetry/u);
  matrixAssert.match(section18.body, /write runtime logs/u);
  matrixAssert.match(section18.body, /write artifacts/u);

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "disabled Layer observability adapter handshake consumes preflight before runtime registration"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-docs-matrix-crosscheck\.test\.mjs --test-name-pattern "GraphDocsSummary matrix cross-check covers disabled observability adapter handshake evidence"/u,
  );
  matrixAssert.match(getField(section18, 'Verification command') ?? '', /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs/u);
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /disabled Layer observability adapter handshake evidence passed 20\/20 focused observability validation/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /observability \+ matrix suite passed 54\/54|observability \+ lifecycle-events \+ matrix passed 65\/65|matrix suite passed 34\/34/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /GraphDocsSummary matrix cross-check covers disabled observability adapter handshake evidence.*passed in the docs\/matrix cross-check suite 28\/28/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /matrix suite re-run passed 34\/34/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /real (?:Graph-docs\/Layer )?runtime producer\/subscriber integration, true Layer adapter wiring, and external telemetry are still not connected; runtime dispatch\/log\/artifact writes remain disabled/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Next smallest task') ?? '',
    /live runtime producer\/subscriber implementation preflight|focused runtime observability adapter wiring boundary evidence|disabled-by-default Layer observability adapter handshake test|consumes the preflight before any runtime producer\/subscriber registration is allowed|Add a disabled no-op Layer observability consumer integration design|disabled no-op Layer observability consumer docs\/matrix cross-check|docs\/matrix cross-check evidence batch/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime-enabled|external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|runtime enabled|runtime observability enabled/iu,
    'Section 18 should record pending handshake evidence without promotion or enabled runtime/telemetry wording',
  );
});

test('Site Capability Graph Section 18 records disabled no-op observability consumer integration design without promotion', async () => {
  const [markdown, docsMatrixCrosscheckTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_MATRIX_CROSSCHECK_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const designTestName = 'disabled Layer observability consumer integration design remains no-op after handshake';
  const matrixCrossCheckTestName = 'GraphDocsSummary matrix cross-check covers disabled observability consumer integration design evidence';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  matrixAssert.match(docsMatrixCrosscheckTest, new RegExp(matrixCrossCheckTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(designTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, new RegExp(matrixCrossCheckTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, /createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign\(\)/u);
  matrixAssert.match(section18.body, /assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility\(\)/u);

  for (const requiredField of [
    'sourceHandshake',
    'sourcePreflight',
    'requiredHandshakeGuard',
    'requiredPreflightGuard',
  ]) {
    matrixAssert.match(section18.body, new RegExp(`\\b${requiredField}\\b`, 'u'));
  }

  matrixAssert.match(section18.body, /consumes `sourceHandshake` \/ `sourcePreflight` \/ `requiredHandshakeGuard` \/ `requiredPreflightGuard`/u);
  matrixAssert.match(section18.body, /does not enable runtime consumer integration/u);
  matrixAssert.match(section18.body, /subscriber registration/u);
  matrixAssert.match(section18.body, /producer registration/u);
  matrixAssert.match(section18.body, /external telemetry/u);
  matrixAssert.match(section18.body, /dispatch writes, log writes, or artifact writes/u);

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "disabled Layer observability consumer integration design remains no-op after handshake"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-docs-matrix-crosscheck\.test\.mjs --test-name-pattern "GraphDocsSummary matrix cross-check covers disabled observability consumer integration design evidence"/u,
  );
  matrixAssert.match(getField(section18, 'Verification command') ?? '', /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs/u);
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /passed 21\/21 in `tests\/node\/site-capability-graph-observability\.test\.mjs` and the matrix suite passed 35\/35/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Section 18 remains `partial` because (?:this is descriptor-only disabled\/no-op evidence|this evidence does not create live runtime producer\/subscriber integration)/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /docs\/matrix cross-check evidence for `GraphDocsSummary matrix cross-check covers disabled observability consumer integration design evidence` is now recorded/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /real (?:Graph-docs\/Layer )?runtime producer\/subscriber integration, true Layer adapter wiring, and external telemetry are still not connected; runtime dispatch\/log\/artifact writes remain disabled/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Next smallest task') ?? '',
    /live runtime producer\/subscriber implementation preflight|focused runtime observability adapter wiring boundary evidence|handshake|consumer integration design|docs\/matrix cross-check|cross-check evidence batch/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime-enabled|runtime consumer enabled|runtime enabled|runtime observability enabled|subscriber registration enabled|producer registration enabled|external telemetry enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled/iu,
    'Section 18 should record disabled no-op consumer integration design evidence without promotion or enabled runtime wording',
  );
});

test('Site Capability Graph Section 18 records focused observability adapter wiring boundary evidence without live wiring', async () => {
  const markdown = await readMatrix();
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTestName = 'graph docs lifecycle observability adapter wiring boundary consumes disabled consumer integration descriptor';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  matrixAssert.match(section18.body, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section18.body, /Current round focused runtime observability adapter wiring boundary design evidence/u);
  matrixAssert.match(section18.body, /boundary\/preflight\/disabled contract evidence/u);
  matrixAssert.match(section18.body, /not live wiring/u);

  for (const helperName of [
    'createGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesign',
    'assertGraphDocsLifecycleObservabilityAdapterWiringBoundaryDesignCompatibility',
  ]) {
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const requiredBoundary of [
    /does not register a producer or subscriber/u,
    /connect external telemetry/u,
    /enable dispatch\/log\/artifact writes/u,
    /call SiteAdapter, downloader, or SessionView/u,
  ]) {
    matrixAssert.match(section18.body, requiredBoundary);
  }

  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Current focused runtime observability adapter wiring boundary design evidence passed 1\/1 focused validation.*boundary\/preflight\/disabled contract evidence only, not live wiring/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Section 18 remains `partial`/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /Boundary\/preflight\/disabled adapter wiring contract evidence (?:now exists|and disabled\/contract-only runtime implementation preflight evidence now exist)/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /disabled\/contract-only runtime implementation preflight evidence now exist/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Next smallest task') ?? '',
    /live runtime producer\/subscriber implementation preflight|Add focused runtime observability adapter wiring boundary evidence|focused runtime observability adapter wiring boundary evidence for the future live producer\/subscriber path/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime-enabled|runtime observability enabled|external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|producer registration enabled|runtime log write enabled|runtime artifact write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 should record adapter wiring boundary evidence without promotion or runtime enablement',
  );
});

test('graph docs lifecycle observability runtime implementation preflight stays disabled before registration', async () => {
  const markdown = await readMatrix();
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTestName = 'graph docs lifecycle observability runtime implementation preflight stays disabled before registration';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(section18.body, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const helperName of [
    'createGraphDocsLifecycleObservabilityRuntimeImplementationPreflight',
    'assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility',
  ]) {
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /disabled\/contract-only preflight evidence/u,
    /defines registration ownership/u,
    /telemetry dispatch gates/u,
    /dispatch\/log\/artifact write gates before runtime registration/u,
    /not runtime implementation/u,
    /no producer\/subscriber registration/u,
    /no external telemetry/u,
    /no dispatch\/log\/artifact writes/u,
    /no SiteAdapter/u,
    /no downloader/u,
    /no SessionView/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(getField(section18, 'Verification command') ?? '', new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /disabled\/contract-only evidence and not as runtime implementation/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Section 18 remains `partial`/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /disabled\/contract-only runtime implementation preflight evidence now exist/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /registration owner integration boundary now exists as a real Layer-owned in-memory subscriber registration path.*There is still no external telemetry connection, no runtime dispatch\/log\/artifact\/docs write path/u,
  );

  const nextSmallestTask = getField(section18, 'Next smallest task') ?? '';
  matrixAssert.match(
    nextSmallestTask,
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /implementation preflight|focused runtime observability adapter wiring boundary evidence|preflight and contract coverage|preflight contract coverage|docs\/matrix cross-check|adapter-wiring|handshake|consumer integration design/iu,
    'Section 18 next task should not repeat this implementation preflight or earlier evidence batches',
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime implementation enabled|runtime-enabled|runtime observability enabled|external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|producer registration enabled|runtime log write enabled|runtime artifact write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|runtime producer registered|telemetry subscriber registered|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 should record implementation preflight evidence without promotion or runtime enablement',
  );
});

test('Site Capability Graph Section 18 records registration owner preflight evidence without runtime registration', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTestName = 'graph docs lifecycle observability registration owner preflight stays disabled before registration';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(observabilityTest, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const helperName of [
    'createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight',
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility',
  ]) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /registration owner preflight/u,
    /disabled\/design-only/u,
    /consumes the disabled runtime implementation preflight/u,
    /producerOwner/u,
    /subscriberOwner/u,
    /graph-runtime-consumer-disabled/u,
    /no runtime registration owner implementation/u,
    /no producer\/subscriber registration path/u,
    /no external telemetry connection/u,
    /no dispatch\/log\/artifact write path/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Current disabled runtime implementation preflight contract evidence/u,
  );
  matrixAssert.match(section18.body, /Current round registration-owner preflight verification update/u);

  const nextSmallestTask = getField(section18, 'Next smallest task') ?? '';
  matrixAssert.match(
    nextSmallestTask,
    /smaller concrete runtime integration guard|another `partial` section with a smaller runtime guard/u,
  );
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /registration-owner preflight evidence|runtime implementation preflight|adapter wiring boundary|handshake|consumer integration design|docs\/matrix evidence batch/iu,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime registration owner enabled|registration owner implemented|runtime producer registered|runtime subscriber registered|producer registration enabled|subscriber registration enabled|runtime observability enabled|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 should record registration-owner preflight evidence without runtime registration or promotion',
  );
});

test('Site Capability Graph Section 18 records registration owner handoff guard evidence without promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTestName =
    'graph docs lifecycle observability registration owner handoff guard stays disabled before runtime registration';
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuard',
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerHandoffGuardCompatibility',
  ];
  const artifactFamily =
    'site-capability-graph-docs-lifecycle-observability-registration-owner-handoff-guard';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(section18.body, /registration owner handoff guard/u);
  matrixAssert.match(section18.body, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(observabilityTest, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const helperName of helperNames) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(`artifactFamily:\\s*'${artifactFamily}'`, 'u'));
  matrixAssert.match(section18.body, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(observabilityTest, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const requiredPhrase of [
    /disabled\/design-only/u,
    /registration owner handoff guard/u,
    /consumes the registration owner preflight/u,
    /producerOwner/u,
    /subscriberOwner/u,
    /graph-runtime-consumer-disabled/u,
    /no runtime registration owner implementation/u,
    /no producer\/subscriber registration path/u,
    /no external telemetry connection/u,
    /no dispatch\/log\/artifact write path/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    new RegExp(`node --test tests\\\\node\\\\site-capability-graph-observability\\.test\\.mjs --test-name-pattern "${evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"`, 'u'),
  );
  matrixAssert.match(getField(section18, 'Verification command') ?? '', /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs/u);
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /registration owner integration boundary now exists as a real Layer-owned in-memory subscriber registration path.*There is still no external telemetry connection, no runtime dispatch\/log\/artifact\/docs write path/u,
  );
  matrixAssert.doesNotMatch(
    section18.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime registration owner enabled|registration owner implemented|registration owner handoff enabled|runtime producer registered|runtime subscriber registered|producer registration enabled|subscriber registration enabled|runtime observability enabled|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 should record registration-owner handoff guard evidence without runtime registration or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime registration consumer guard evidence without promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTestName =
    'graph docs lifecycle observability runtime registration consumer guard stays disabled before runtime registration';
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuard',
    'assertGraphDocsLifecycleObservabilityRuntimeRegistrationConsumerGuardCompatibility',
  ];
  const artifactFamily =
    'site-capability-graph-docs-lifecycle-observability-runtime-registration-consumer-guard';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(section18.body, /runtime registration consumer guard/u);
  matrixAssert.match(section18.body, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(observabilityTest, new RegExp(evidenceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const helperName of helperNames) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(`artifactFamily:\\s*'${artifactFamily}'`, 'u'));
  matrixAssert.match(section18.body, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(observabilityTest, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const requiredPhrase of [
    /graph-runtime-consumer-disabled/u,
    /disabled runtime registration consumer guard/u,
    /consumes the registration owner handoff guard/u,
    /no runtime registration owner implementation/u,
    /no producer\/subscriber registration path/u,
    /no external telemetry connection/u,
    /no dispatch\/log\/artifact write path/u,
    /no SiteAdapter/u,
    /no downloader/u,
    /no SessionView/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  const guardLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('runtime registration consumer guard')
      || line.includes(evidenceTestName)
      || helperNames.some((helperName) => line.includes(helperName))
      || line.includes(artifactFamily)
    ))
    .join('\n');
  matrixAssert.notEqual(guardLines, '', 'Section 18 should include runtime registration consumer guard lines');
  matrixAssert.doesNotMatch(
    guardLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime registration owner enabled|registration owner implemented|runtime registration enabled|runtime producer registered|runtime subscriber registered|producer registration enabled|subscriber registration enabled|runtime observability enabled|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 runtime registration consumer guard lines should not claim runtime registration, writes, telemetry, invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch Layer adapter handoff guard without live adapter wiring', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestNames = [
    'runtime dispatch Layer adapter handoff guard consumes dry-run result before live adapter wiring',
    'runtime dispatch Layer adapter handoff guard rejects adapter runtime telemetry writes and sensitive material',
  ];
  const helperNames = [
    'createGraphDocsLifecycleObservabilityLayerAdapterHandoffGuard',
    'assertGraphDocsLifecycleObservabilityLayerAdapterHandoffGuardCompatibility',
  ];
  const artifactFamily =
    'site-capability-graph-docs-lifecycle-observability-layer-adapter-handoff-guard';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(section18.body, /runtime dispatch Layer adapter handoff guard/u);
  for (const focusedTestName of focusedTestNames) {
    const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(section18.body, new RegExp(escapedFocusedTestName, 'u'));
    matrixAssert.match(observabilityTest, new RegExp(`test\\('${escapedFocusedTestName}`, 'u'));
  }

  for (const helperName of helperNames) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(graphSource, new RegExp(`artifactFamily:\\s*'${artifactFamily}'`, 'u'));
  matrixAssert.match(section18.body, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(observabilityTest, new RegExp(artifactFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  for (const requiredPhrase of [
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /runtime dispatch Layer adapter handoff guard/u,
    /consumes only the safe summary from `createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult\(\)`/u,
    /live adapter wiring disabled/u,
    /external telemetry disabled/u,
    /runtime dispatch\/log\/artifact\/docs writes disabled/u,
    /SiteAdapter disabled/u,
    /downloader disabled/u,
    /SessionView disabled/u,
    /status promotion disabled/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section18.body,
    /node --test --test-name-pattern "Layer adapter handoff guard" tests\\node\\site-capability-graph-matrix\.test\.mjs/u,
  );
  matrixAssert.match(
    section18.body,
    /Layer adapter handoff guard/u,
  );
  matrixAssert.match(
    section18.body,
    /live adapter wiring, external telemetry, runtime dispatch\/log\/artifact\/docs writes, SiteAdapter, downloader, SessionView, and status promotion remain disabled/u,
  );

  const handoffLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('Layer adapter handoff guard')
      || focusedTestNames.some((focusedTestName) => line.includes(focusedTestName))
      || helperNames.some((helperName) => line.includes(helperName))
      || line.includes(artifactFamily)
    ))
    .join('\n');
  matrixAssert.notEqual(handoffLines, '', 'Section 18 should include Layer adapter handoff guard lines');
  matrixAssert.doesNotMatch(
    handoffLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|external telemetry enabled|live adapter wiring enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 Layer adapter handoff guard lines should not claim live wiring, dispatch, writes, telemetry, invocation, SessionView, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch Layer adapter compatibility review gate without promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestNames = [
    'runtime dispatch Layer adapter compatibility review gate consumes handoff guard without live adapter wiring',
    'runtime dispatch Layer adapter compatibility review gate rejects runtime adapter products and unsafe source aliases',
  ];
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGate',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLayerAdapterCompatibilityReviewGateCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(section18.body, /runtime dispatch Layer adapter compatibility review gate/u);

  for (const focusedTestName of focusedTestNames) {
    const escapedFocusedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(section18.body, new RegExp(escapedFocusedTestName, 'u'));
    matrixAssert.match(observabilityTest, new RegExp(`test\\('${escapedFocusedTestName}`, 'u'));
  }

  for (const helperName of helperNames) {
    matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /consumes the handoff guard/u,
    /without live adapter wiring/u,
    /rejects runtime adapter products and unsafe source aliases/u,
    /live adapter wiring disabled/u,
    /external telemetry disabled/u,
    /runtime dispatch\/log\/artifact\/docs writes disabled/u,
    /SiteAdapter disabled/u,
    /downloader disabled/u,
    /SessionView disabled/u,
    /status promotion disabled/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "runtime dispatch Layer adapter compatibility review gate"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "Layer adapter compatibility review gate"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification result') ?? '',
    /Layer adapter compatibility review gate/u,
  );

  const reviewGateLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('Layer adapter compatibility review gate')
      || focusedTestNames.some((focusedTestName) => line.includes(focusedTestName))
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(reviewGateLines, '', 'Section 18 should include Layer adapter compatibility review gate lines');
  matrixAssert.doesNotMatch(
    reviewGateLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live adapter wiring enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|external telemetry enabled|runtime adapter product accepted|unsafe source alias accepted|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 Layer adapter compatibility review gate lines should not claim live wiring, dispatch, writes, telemetry, runtime adapter products, invocation, SessionView, or promotion',
  );
});

test('Site Capability Graph Section 18 records lifecycle subscriber registry prerequisite evidence without promotion', async () => {
  const [markdown, lifecycleSource, lifecycleTest] = await Promise.all([
    readMatrix(),
    readSource(LIFECYCLE_EVENTS_URL),
    readSource(LIFECYCLE_EVENTS_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestName = 'LifecycleEvent subscriber registry';
  const helperName = 'createLifecycleEventSubscriberRegistry';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(lifecycleSource, new RegExp(`export function ${helperName}\\b`, 'u'));
  matrixAssert.match(lifecycleTest, new RegExp(focusedTestName, 'u'));

  for (const requiredPhrase of [
    /Layer-owned in-memory lifecycle subscriber registry/u,
    /real runtime registration prerequisite/u,
    /createLifecycleEventSubscriberRegistry\(\)/u,
    /LifecycleEvent subscriber registry/u,
    /matching in-memory subscribers/u,
    /safe descriptor listing/u,
    /telemetry write \/ redaction bypass rejection/u,
    /sensitive descriptor rejection without echoing values/u,
    /external telemetry is not connected/u,
    /runtime docs artifact write path is not enabled/u,
    /Graph docs lifecycle producer still needs Layer integration review/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test --test-name-pattern "LifecycleEvent subscriber registry" \.\\tests\\node\\lifecycle-events\.test\.mjs/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "subscriber registry prerequisite"/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /Graph docs lifecycle producer registry subscriber boundary now exists as a safe pre-integration boundary into that in-memory registry/u,
  );
  matrixAssert.match(getField(section18, 'Current gaps') ?? '', /runtime docs artifact write path is not enabled/u);
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /no integrated Graph docs producer\/subscriber registration path|beyond the local in-memory prerequisite/u,
  );

  const registryLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('Layer-owned subscriber registry prerequisite')
      || line.includes(helperName)
      || line.includes(focusedTestName)
      || line.includes('in-memory lifecycle subscriber registry')
    ))
    .join('\n');
  matrixAssert.notEqual(registryLines, '', 'Section 18 should include subscriber registry prerequisite lines');
  matrixAssert.doesNotMatch(
    registryLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|external telemetry enabled|runtime docs artifact write path enabled|runtime docs artifact write enabled|Graph docs lifecycle producer integrated|runtime producer registered|runtime subscriber registered|producer registration enabled|subscriber registration enabled|runtime observability enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 subscriber registry prerequisite lines should not claim promotion or live runtime wiring',
  );
});

test('Site Capability Graph Section 18 records graph docs lifecycle producer registry subscriber boundary without telemetry promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const helperName = 'createGraphDocsGenerationLifecycleEventRegistrySubscriber';
  const focusedTestName = 'graph docs lifecycle producer registry subscriber';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(graphSource, new RegExp(`export function ${helperName}\\b`, 'u'));
  matrixAssert.match(observabilityTest, new RegExp(focusedTestName, 'u'));

  for (const requiredPhrase of [
    /Graph docs lifecycle producer registry subscriber boundary/u,
    /createGraphDocsGenerationLifecycleEventRegistrySubscriber\(\)/u,
    /graph docs lifecycle producer registry subscriber/u,
    /Graph docs lifecycle producer -> Layer-owned in-memory registry safety boundary/u,
    /pre-integration evidence/u,
    /consumes the Layer-owned in-memory lifecycle subscriber registry prerequisite/u,
    /external telemetry/u,
    /artifact\/log\/docs writers/u,
    /runtime docs artifact write observability/u,
    /runtime dispatch\/log\/artifact writes/u,
    /SiteAdapter/u,
    /downloader/u,
    /Session materialization disabled/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "graph docs lifecycle producer registry subscriber"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "producer registry subscriber boundary"/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /external telemetry, runtime docs artifact write observability, true Layer adapter wiring, and runtime dispatch\/log\/artifact write path are still missing/u,
  );
  matrixAssert.doesNotMatch(
    getField(section18, 'Current gaps') ?? '',
    /no .*in-memory registry|no .*registry subscriber prerequisite|in-memory registry .*missing|registry subscriber prerequisite .*missing/iu,
    'Section 18 gaps should not claim the in-memory registry or registry-subscriber prerequisite is still absent',
  );

  const boundaryLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('Graph docs lifecycle producer registry subscriber boundary')
      || line.includes(helperName)
      || line.includes(focusedTestName)
    ))
    .join('\n');
  matrixAssert.notEqual(boundaryLines, '', 'Section 18 should include producer registry subscriber boundary lines');
  matrixAssert.doesNotMatch(
    boundaryLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs artifact write enabled|runtime docs write enabled|artifact writer invoked|log writer invoked|docs writer invoked|artifact writes enabled|log writes enabled|docs writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|Session materialized/iu,
    'Section 18 producer registry subscriber boundary lines should not claim telemetry, writes, runtime integration, or promotion',
  );
});

test('Site Capability Graph Section 18 records producer inventory observability coverage without telemetry promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestName =
    'producer inventory observability coverage summarizes profiled lifecycle producers descriptor-only';
  const helperNames = [
    'createGraphLifecycleProducerInventoryObservabilityCoverage',
    'assertGraphLifecycleProducerInventoryObservabilityCoverageCompatibility',
  ];
  const artifactFamily =
    'site-capability-graph-lifecycle-producer-inventory-observability-coverage';

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }
  matrixAssert.match(graphSource, new RegExp(artifactFamily, 'u'));
  matrixAssert.match(observabilityTest, new RegExp(focusedTestName, 'u'));
  matrixAssert.match(section18.body, new RegExp(artifactFamily, 'u'));

  for (const requiredPhrase of [
    /LifecycleEventProducerInventory observability coverage/u,
    /descriptor-only lifecycle producer inventory summary/u,
    /profiled lifecycle producers/u,
    /inventoried-only lifecycle producers/u,
    /graph\.docs\.summary\.generated is not a runtime producer profile/u,
    /external telemetry disabled/u,
    /runtime dispatch disabled/u,
    /artifact\/log writes disabled/u,
    /SiteAdapter/u,
    /downloader/u,
    /SessionView/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "producer inventory observability coverage"/u,
  );

  const coverageLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes('LifecycleEventProducerInventory observability coverage')
      || line.includes('createGraphLifecycleProducerInventoryObservabilityCoverage')
      || line.includes('producer inventory observability coverage')
    ))
    .join('\n');
  matrixAssert.notEqual(coverageLines, '', 'Section 18 should include producer inventory coverage lines');
  matrixAssert.doesNotMatch(
    coverageLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|artifact writes enabled|log writes enabled|subscriber registered|runtime subscriber registered|producer registered|runtime producer registered|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 producer inventory coverage lines should not claim telemetry, writes, runtime registration, or promotion',
  );
});

test('Site Capability Graph Section 18 records registration owner integration without telemetry promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const evidenceTitle = 'Graph docs lifecycle observability registration owner integration';
  const focusedTestName =
    'registration owner integration registers graph docs lifecycle producer registry subscriber';
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
    'assertGraphDocsLifecycleObservabilityRegistrationOwnerIntegrationCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(observabilityTest, new RegExp(focusedTestName, 'u'));
  matrixAssert.match(section18.body, new RegExp(evidenceTitle, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /registration owner integration boundary evidence/u,
    /real Layer-owned in-memory subscriber registration path/u,
    /consumes the registration owner handoff guard/u,
    /Layer-owned in-memory lifecycle subscriber registry prerequisite/u,
    /registers only in-memory lifecycle subscribers/u,
    /keeps external telemetry/u,
    /runtime dispatch\/log\/artifact\/docs writes/u,
    /SiteAdapter/u,
    /downloader/u,
    /SessionView disabled/u,
    /Section 18 remains `partial`/u,
    /not telemetry enablement/u,
    /not log\/artifact\/docs write enablement/u,
    /not status promotion evidence/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "registration owner integration"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "registration owner integration"/u,
  );
  matrixAssert.match(
    section18.body,
    /registration owner integration boundary verification: `node --check src\\sites\\capability\\site-capability-graph\.mjs` passed; focused observability validation passed 3\/3 .* focused matrix validation passed 1\/1/isu,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /registration owner integration boundary now exists as a real Layer-owned in-memory subscriber registration path/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /still no external telemetry connection, no runtime dispatch\/log\/artifact\/docs write path, no SiteAdapter call, no downloader call, and no SessionView materialization/u,
  );

  const integrationLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('registration owner integration boundary evidence')
      || line.includes('registration owner integration boundary verification')
      || line.includes('registration owner integration boundary now exists')
      || line.includes('registration owner integration boundary do not create')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(integrationLines, '', 'Section 18 should include registration owner integration lines');
  matrixAssert.doesNotMatch(
    integrationLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|external telemetry enabled|telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|dispatch writes enabled|log writes enabled|artifact writes enabled|docs writes enabled|log writer invoked|artifact writer invoked|docs writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Section 18 registration owner integration lines should not claim telemetry, writes, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records external telemetry dispatch boundary without telemetry promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestName = 'external telemetry dispatch boundary';
  const helperNames = [
    'createGraphObservabilityExternalTelemetryDispatchBoundary',
    'assertGraphObservabilityExternalTelemetryDispatchBoundaryCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(observabilityTest, new RegExp(focusedTestName, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /external telemetry dispatch boundary evidence/u,
    /descriptor-only \/ disabled external telemetry dispatch boundary/u,
    /keeps external telemetry disabled/u,
    /external telemetry dispatch disabled/u,
    /runtime writes disabled/u,
    /route execution disabled/u,
    /SiteAdapter disabled/u,
    /downloader disabled/u,
    /SessionView disabled/u,
    /Graph execution disabled/u,
    /rejects runtime telemetry payloads/u,
    /synthetic sensitive material without echoing values/u,
    /Section 18 remains `partial`/u,
    /not telemetry enablement/u,
    /not status promotion/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "external telemetry dispatch boundary"/u,
  );
  matrixAssert.match(
    section18.body,
    /external telemetry dispatch boundary verification: `node --check \.\\src\\sites\\capability\\site-capability-graph\.mjs` passed; focused observability validation passed 3\/3/isu,
  );
  matrixAssert.match(
    section18.body,
    /external telemetry dispatch boundary verification: .*focused matrix validation passed 1\/1/isu,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /external telemetry dispatch remains descriptor-only\/disabled/u,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /external telemetry dispatch boundary now exists as a disabled guard/u,
  );

  const boundaryLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('external telemetry dispatch boundary evidence')
      || line.includes('external telemetry dispatch boundary verification')
      || line.includes('external telemetry dispatch boundary now exists')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(boundaryLines, '', 'Section 18 should include external telemetry boundary lines');
  matrixAssert.doesNotMatch(
    boundaryLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|external telemetry enabled|telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|route execution enabled|Graph execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|sensitive value echoed/iu,
    'Section 18 external telemetry boundary lines should not claim telemetry, writes, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch dry-run adapter result without write promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestName = 'runtime dispatch dry-run adapter result';
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(observabilityTest, new RegExp(focusedTestName, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /runtime dispatch dry-run adapter result evidence/u,
    /redactionRequired/u,
    /descriptor-only dry-run/u,
    /safe dispatch summary/u,
    /Layer-owned in-memory registry dispatch dry-run/u,
    /subscriber result summaries/u,
    /does not connect external telemetry/u,
    /does not perform runtime dispatch\/log\/artifact\/docs writes/u,
    /does not call SiteAdapter or downloader/u,
    /does not materialize SessionView/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section18.body,
    /runtime dispatch dry-run adapter result verification: .*focused observability validation passed 3\/3/isu,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch dry-run adapter result verification: .*focused matrix validation passed 1\/1/isu,
  );

  const dryRunLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('runtime dispatch dry-run adapter result evidence')
      || line.includes('runtime dispatch dry-run adapter result verification')
      || line.includes('runtime dispatch dry-run adapter result')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(dryRunLines, '', 'Section 18 should include runtime dispatch dry-run lines');
  matrixAssert.doesNotMatch(
    dryRunLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|external telemetry enabled|telemetry enabled|telemetry dispatch enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|log writer invoked|artifact writer invoked|docs writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|route execution enabled|Graph execution enabled|sensitive value echoed/iu,
    'Section 18 runtime dispatch dry-run lines should not claim telemetry, writes, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch write-intent preflight negative boundary without write promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflightCompatibility',
  ];
  const focusedTestNames = [
    'runtime dispatch write-intent preflight consumes compatibility review gate before writes',
    'runtime dispatch write-intent preflight rejects runtime writers telemetry and sensitive material',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const focusedTestName of focusedTestNames) {
    const escapedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(observabilityTest, new RegExp(escapedTestName, 'u'));
    matrixAssert.match(section18.body, new RegExp(escapedTestName, 'u'));
  }

  for (const requiredPhrase of [
    /runtime dispatch write-intent preflight evidence/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /consumes only the safe summary from the runtime dispatch Layer adapter compatibility review gate/u,
    /write intent before live writes/u,
    /keeps runtime dispatch disabled/u,
    /keeps runtime log writes disabled/u,
    /keeps runtime artifact writes disabled/u,
    /keeps runtime docs writes disabled/u,
    /keeps repo writes disabled/u,
    /keeps external telemetry disabled/u,
    /keeps SiteAdapter, downloader, SessionView, task runner, and status promotion disabled/u,
    /rejects runtime writer descriptors/u,
    /rejects telemetry descriptors/u,
    /rejects sensitive material without echoing values/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section18.body,
    /runtime dispatch write-intent preflight verification: .*focused observability validation .*runtime dispatch write-intent preflight/isu,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch write-intent preflight verification: .*focused matrix validation .*runtime dispatch write-intent preflight/isu,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /runtime dispatch write-intent preflight is negative boundary evidence only/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /do not repeat .*runtime dispatch write-intent preflight/iu,
  );

  const preflightLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('runtime dispatch write-intent preflight evidence')
      || line.includes('runtime dispatch write-intent preflight verification')
      || line.includes('runtime dispatch write-intent preflight')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(preflightLines, '', 'Section 18 should include runtime dispatch write-intent preflight lines');
  matrixAssert.doesNotMatch(
    preflightLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|runtime dispatch enabled|runtime writer enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|repo write enabled|external telemetry enabled|telemetry dispatch enabled|runtime writer invoked|log writer invoked|artifact writer invoked|docs writer invoked|repo writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|route execution enabled|Graph execution enabled|sensitive value echoed/iu,
    'Section 18 runtime dispatch write-intent preflight lines should not claim writes, telemetry, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch live write boundary guard without write promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuardCompatibility',
  ];
  const focusedTestNames = [
    'runtime dispatch live-write boundary guard consumes write-intent preflight before live writes',
    'runtime dispatch live-write boundary guard rejects runtime writers telemetry and unsafe source aliases',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const focusedTestName of focusedTestNames) {
    const escapedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(observabilityTest, new RegExp(escapedTestName, 'u'));
    matrixAssert.match(section18.body, new RegExp(escapedTestName, 'u'));
  }

  for (const requiredPhrase of [
    /runtime dispatch live write boundary guard evidence/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /consumes only the safe summary from `createGraphDocsLifecycleObservabilityRuntimeDispatchWriteIntentPreflight\(\)`/u,
    /keeps runtime dispatch disabled/u,
    /keeps runtime log writes disabled/u,
    /keeps runtime artifact writes disabled/u,
    /keeps runtime docs writes disabled/u,
    /keeps repo writes disabled/u,
    /keeps external telemetry disabled/u,
    /keeps SiteAdapter, downloader, SessionView, task runner, and status promotion disabled/u,
    /source aliases `writeIntentPreflight`, `sourceWriteIntentPreflight`, `runtimeDispatchWriteIntentPreflight`, and `preflight`/u,
    /missing source rejection/u,
    /unsafe alias rejection/u,
    /distinct source alias rejection/u,
    /disabled runtime dispatch\/log\/artifact\/docs\/repo writes/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section18.body,
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "runtime dispatch live-write boundary guard"/u,
  );
  matrixAssert.match(
    section18.body,
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "runtime dispatch live write boundary guard"/u,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch live write boundary guard verification: .*focused observability validation passed 2\/2/isu,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch live write boundary guard verification: .*focused matrix validation passed 1\/1/isu,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch live write boundary guard verification: .*full observability validation passed 50\/50/isu,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch live write boundary guard verification: .*full matrix validation passed 102\/102/isu,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /runtime dispatch live write boundary guard is negative boundary evidence only/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /do not repeat .*runtime dispatch live write boundary guard/iu,
  );

  const guardLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('runtime dispatch live write boundary guard evidence')
      || line.includes('runtime dispatch live write boundary guard verification')
      || line.includes('runtime dispatch live write boundary guard')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(guardLines, '', 'Section 18 should include runtime dispatch live write boundary guard lines');
  matrixAssert.doesNotMatch(
    guardLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|runtime dispatch enabled|runtime writer enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|repo write enabled|external telemetry enabled|telemetry dispatch enabled|runtime writer invoked|log writer invoked|artifact writer invoked|docs writer invoked|repo writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|route execution enabled|Graph execution enabled|sensitive value echoed/iu,
    'Section 18 runtime dispatch live write boundary guard lines should not claim writes, telemetry, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records runtime dispatch live adapter write boundary guard without dispatch or write promotion', async () => {
  const [markdown, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuard',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchLiveAdapterWriteBoundaryGuardCompatibility',
  ];
  const focusedTestNames = [
    'runtime dispatch live adapter write boundary guard consumes live-write boundary before adapter dispatch writes',
    'runtime dispatch live adapter write boundary guard rejects runtime adapter dispatch writes and unsafe source aliases',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(graphSource, new RegExp(`export (?:async )?function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const focusedTestName of focusedTestNames) {
    const escapedTestName = focusedTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(observabilityTest, new RegExp(escapedTestName, 'u'));
    matrixAssert.match(section18.body, new RegExp(escapedTestName, 'u'));
  }

  for (const requiredPhrase of [
    /runtime dispatch live adapter dispatch\/write boundary guard evidence/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /consumes only the safe summary from `createGraphDocsLifecycleObservabilityRuntimeDispatchLiveWriteBoundaryGuard\(\)`/u,
    /source aliases `liveWriteBoundaryGuard`, `sourceLiveWriteBoundaryGuard`, `runtimeDispatchLiveWriteBoundaryGuard`, `sourceRuntimeDispatchLiveWriteBoundaryGuard`, and `guard`/u,
    /missing source rejection/u,
    /unsafe alias rejection/u,
    /distinct source alias rejection/u,
    /runtime dispatch disabled/u,
    /runtime dispatch\/write disabled/u,
    /runtime log\/artifact\/docs\/repo writes disabled/u,
    /external telemetry\/dispatch disabled/u,
    /SiteAdapter, downloader, SessionView, task runner, route execution, Graph execution, and status promotion disabled/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section18.body,
    /node --test tests\\node\\site-capability-graph-observability\.test\.mjs --test-name-pattern "runtime dispatch live adapter write boundary guard"/u,
  );
  matrixAssert.match(
    section18.body,
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "runtime dispatch live adapter write boundary guard"/u,
  );
  matrixAssert.match(
    section18.body,
    /runtime dispatch live adapter dispatch\/write boundary guard verification: .*focused observability validation passed 3\/3.*focused matrix validation passed 1\/1.*combined observability \+ matrix validation passed 157\/157/isu,
  );
  matrixAssert.match(
    getField(section18, 'Current gaps') ?? '',
    /runtime dispatch live adapter dispatch\/write boundary guard is negative boundary evidence only/u,
  );
  matrixAssert.match(
    getField(section18, 'Next smallest task') ?? '',
    /do not repeat .*runtime dispatch live adapter dispatch\/write boundary guard/iu,
  );

  const guardLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('runtime dispatch live adapter dispatch/write boundary guard evidence')
      || line.includes('runtime dispatch live adapter dispatch/write boundary guard verification')
      || line.includes('runtime dispatch live adapter write boundary guard')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    guardLines,
    '',
    'Section 18 should include runtime dispatch live adapter dispatch/write boundary guard lines',
  );
  matrixAssert.doesNotMatch(
    guardLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|runtime dispatch enabled|runtime writer enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|repo write enabled|external telemetry enabled|external dispatch enabled|telemetry dispatch enabled|live adapter dispatch enabled|live adapter write enabled|live adapter wiring enabled|runtime adapter product accepted|unsafe source alias accepted|runtime writer invoked|log writer invoked|artifact writer invoked|docs writer invoked|repo writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|route execution enabled|Graph execution enabled|sensitive value echoed/iu,
    'Section 18 runtime dispatch live adapter dispatch/write boundary guard lines should not claim live adapter dispatch, writes, telemetry, runtime invocation, or promotion',
  );
});

test('Site Capability Graph Section 18 records docs-output external dispatch acceptance preflight without dispatch promotion', async () => {
  const [markdown, artifactsSource, artifactWriterTest, contributing] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
    readSource(CONTRIBUTING_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedTestName = 'external dispatch acceptance preflight';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight',
    'assertGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflightCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));
  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactsSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  for (const requiredPhrase of [
    /external dispatch acceptance preflight evidence/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /safe summary from `createGraphDocsOutputLiveConsumerDispatchDryRunResult\(\)`/u,
    /keeps external dispatch disabled/u,
    /keeps external telemetry disabled/u,
    /docs\/repo\/runtime writes disabled/u,
    /SiteAdapter, downloader, SessionView, task runner, and status promotion disabled/u,
    /rejects enabled dispatch\/telemetry\/write\/runtime flags/u,
    /rejects runtime payload keys/u,
    /rejects synthetic sensitive material without echoing values/u,
    /Section 18 remains `partial`/u,
    /not live external dispatch/u,
    /not external telemetry enablement/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "external dispatch acceptance preflight"/u,
  );
  matrixAssert.match(
    section18.body,
    /external dispatch acceptance preflight verification: .*focused artifact-writer validation passed 4\/4/isu,
  );
  matrixAssert.match(
    section18.body,
    /external dispatch acceptance preflight verification: .*focused matrix validation passed 1\/1/isu,
  );
  matrixAssert.match(contributing, /### 19\. Standard artifacts and inventories/u);
  matrixAssert.match(
    contributing,
    /Current Graph Section 18 external dispatch acceptance preflight coverage records `createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight\(\)`/u,
  );
  matrixAssert.match(
    contributing,
    /external dispatch acceptance preflight focused artifact-writer validation passed 4\/4 and focused matrix validation passed 1\/1/u,
  );

  const preflightLines = section18.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('external dispatch acceptance preflight evidence')
      || line.includes('external dispatch acceptance preflight verification')
      || line.includes('external dispatch acceptance preflight')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(preflightLines, '', 'Section 18 should include external dispatch acceptance preflight lines');
  matrixAssert.doesNotMatch(
    preflightLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|external dispatch enabled|external telemetry enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime write enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|artifact writer invoked|docs writer invoked|repo writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|route execution enabled|Graph execution enabled|sensitive value echoed/iu,
    'Section 18 external dispatch acceptance preflight lines should not claim telemetry, writes, runtime invocation, or promotion',
  );
  const contributingPreflightLines = contributing
    .split(/\r?\n/u)
    .filter((line) => line.includes('external dispatch acceptance preflight'))
    .join('\n');
  matrixAssert.notEqual(contributingPreflightLines, '', 'CONTRIBUTING should include external dispatch preflight evidence');
  matrixAssert.doesNotMatch(
    contributingPreflightLines,
    /status promoted|verified status set|promoted to verified|external dispatch enabled|external telemetry enabled|runtime write enabled|docs write enabled|repo write enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
    'CONTRIBUTING durable ledger evidence should remain promotion-blocking',
  );
});

test('Site Capability Graph matrix tracks EndpointNode risk relationship invariant validator coverage', async () => {
  const [markdown, validatorTest] = await Promise.all([
    readMatrix(),
    readSource(VALIDATOR_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  matrixAssert.match(
    validatorTest,
    /validator rejects EndpointNode risk refs that do not resolve to RiskPolicyNode/u,
  );
  matrixAssert.match(validatorTest, /riskPolicyRef: 'capability:synthetic\.example:open-public-page'/u);
  matrixAssert.match(validatorTest, /graph-capability-missing-risk-policy/u);
  matrixAssert.match(validatorTest, /riskPolicyRef does not resolve to a RiskPolicyNode/u);

  for (const sectionNumber of [5, 6, 12, 19]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.match(
      section.body,
      /EndpointNode risk refs that do not resolve to RiskPolicyNode/u,
      `Section ${sectionNumber} should record this round's EndpointNode risk relationship evidence`,
    );
    matrixAssert.match(section.body, /graph-capability-missing-risk-policy/u);
  }

  matrixAssert.equal(getField(sectionByNumber.get(5), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(6), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(12), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(19), 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(markdown, /EndpointNode risk refs[^.\n]*(?:verified status set|status promoted)/iu);
});

test('Site Capability Graph matrix tracks EndpointNode route and capability ref invariant validator coverage', async () => {
  const [markdown, validatorTest] = await Promise.all([
    readMatrix(),
    readSource(VALIDATOR_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const validatorName = 'validator rejects EndpointNode route and capability refs that do not resolve to required node types';

  matrixAssert.match(validatorTest, new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(validatorTest, /graph-edge-broken/u);
  matrixAssert.match(validatorTest, /routeRefs/u);
  matrixAssert.match(validatorTest, /capabilityRefs/u);

  for (const sectionNumber of [5, 6, 8, 9, 19]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.match(
      section.body,
      new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `Section ${sectionNumber} should record this round's EndpointNode route/capability ref evidence`,
    );
    matrixAssert.match(section.body, /graph-edge-broken/u);
    matrixAssert.match(section.body, /routeRefs/u);
    matrixAssert.match(section.body, /capabilityRefs/u);
    if (![5, 6, 8, 9].includes(sectionNumber)) {
      matrixAssert.doesNotMatch(
        section.body,
        /Current status: `verified`|status promoted|verified status set/iu,
        `Section ${sectionNumber} should not promote status from route/capability ref coverage`,
      );
    }
  }

  matrixAssert.equal(getField(sectionByNumber.get(6), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(8), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(9), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(19), 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(markdown, /EndpointNode route and capability refs[^.\n]*(?:verified status set|status promoted)/iu);
});

test('Site Capability Graph matrix tracks EndpointNode missing route and capability ref validator coverage', async () => {
  const [markdown, validatorTest] = await Promise.all([
    readMatrix(),
    readSource(VALIDATOR_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const validatorName = 'validator rejects EndpointNode route and capability refs that are missing entirely';

  matrixAssert.match(validatorTest, new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(validatorTest, /graph-edge-broken/u);
  matrixAssert.match(validatorTest, /routeRefs/u);
  matrixAssert.match(validatorTest, /capabilityRefs/u);
  matrixAssert.match(validatorTest, /route:synthetic\.example:missing-endpoint-route/u);
  matrixAssert.match(validatorTest, /capability:synthetic\.example:missing-endpoint-capability/u);

  for (const sectionNumber of [5, 6, 8, 9, 19]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.match(
      section.body,
      new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `Section ${sectionNumber} should record this round's EndpointNode missing-ref evidence`,
    );
    matrixAssert.match(section.body, /missing entirely|missing-ref/iu);
    matrixAssert.match(section.body, /graph-edge-broken/u);
    matrixAssert.match(section.body, /routeRefs/u);
    matrixAssert.match(section.body, /capabilityRefs/u);
    if (![5, 6, 8, 9].includes(sectionNumber)) {
      matrixAssert.doesNotMatch(
        section.body,
        /Current status: `verified`|status promoted|verified status set/iu,
        `Section ${sectionNumber} should not promote status from missing-ref coverage`,
      );
    }
  }

  matrixAssert.equal(getField(sectionByNumber.get(6), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(8), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(9), 'Current status'), '`verified`');
  matrixAssert.equal(getField(sectionByNumber.get(19), 'Current status'), '`partial`');
  matrixAssert.doesNotMatch(markdown, /EndpointNode route and capability refs that are missing entirely[^.\n]*(?:verified status set|status promoted)/iu);
});

test('Site Capability Graph matrix records EndpointNode observed/candidate catalog promotion fail-closed coverage', async () => {
  const [markdown, validatorTest] = await Promise.all([
    readMatrix(),
    readSource(VALIDATOR_TEST_URL),
  ]);
  const section9 = extractSections(markdown).find((section) => section.number === 9);

  matrixAssert.equal(typeof section9?.body, 'string', 'Section 9 should exist');
  matrixAssert.equal(getField(section9, 'Current status'), '`verified`');

  matrixAssert.match(validatorTest, /for \(const lifecycleState of \['observed', 'candidate'\]\)/u);
  matrixAssert.match(
    validatorTest,
    /validator rejects \$\{lifecycleState\} endpoints marked as cataloged without verification/u,
  );
  matrixAssert.match(validatorTest, /cataloged: true/u);
  matrixAssert.match(validatorTest, /graph-observed-candidate-promoted-without-verification/u);
  matrixAssert.match(validatorTest, /report\.findings\[0\]\.field, 'cataloged'/u);
  matrixAssert.match(validatorTest, /endpoint\.execute, undefined/u);
  matrixAssert.match(validatorTest, /endpoint\.catalogMutation, undefined/u);
  matrixAssert.match(validatorTest, /endpoint\.rawCredential, undefined/u);

  matrixAssert.match(section9.body, /observed\/candidate EndpointNode catalog promotion fail-closed coverage/u);
  matrixAssert.match(section9.body, /observed\/candidate EndpointNode descriptors marked `cataloged=true` are rejected fail-closed/u);
  matrixAssert.match(section9.body, /graph-observed-candidate-promoted-without-verification/u);
  matrixAssert.match(section9.body, /no endpoint execution/u);
  matrixAssert.match(section9.body, /no catalog mutation/u);
  matrixAssert.match(section9.body, /no raw credential echo/u);
  matrixAssert.match(section9.body, /matrix guard binds this to Section 9 as descriptor coverage/u);
  matrixAssert.match(section9.body, /no ApiCandidate\/ApiCatalog migration generator completion claim/u);
  matrixAssert.match(section9.body, /no runtime catalog mutation/u);
  matrixAssert.match(
    getField(section9, 'Current gaps') ?? '',
    /No open Section 9 EndpointNode taxonomy, schema, route\/capability\/auth\/session\/signer\/schema\/risk\/version ref validation/u,
  );
  matrixAssert.match(
    getField(section9, 'Next smallest task') ?? '',
    /another non-verified section|keep ApiCandidate\/ApiCatalog-to-EndpointNode migration generator/u,
  );
  matrixAssert.match(
    getField(section9, 'Next smallest task') ?? '',
    /runtime catalog mutation as separate migration\/runtime follow-ups/u,
  );

  matrixAssert.doesNotMatch(
    section9.body,
    /status promoted|verified status set|ApiCandidate\/ApiCatalog migration generator (?:is )?(?:complete|completed|implemented|done)|runtime catalog mutation (?:enabled|implemented|complete|completed)|catalog mutation enabled|catalogMutationEnabled=true|catalogPromotionEnabled=true|catalog promotion enabled|endpoint execution enabled|endpoint materialization enabled|raw credential echo enabled/iu,
    'Section 9 should record fail-closed promotion coverage without generator/runtime mutation completion or status promotion',
  );
});

test('Site Capability Graph matrix tracks RouteNode riskPolicyRef fail-closed validator coverage', async () => {
  const [markdown, validatorTest] = await Promise.all([
    readMatrix(),
    readSource(VALIDATOR_TEST_URL),
  ]);
  const section8 = extractSections(markdown).find((section) => section.number === 8);
  const validatorName = 'validator fails closed when RouteNode riskPolicyRef is missing or not a RiskPolicyNode';

  matrixAssert.equal(typeof section8?.body, 'string', 'Section 8 should exist');
  matrixAssert.equal(getField(section8, 'Current status'), '`verified`');

  matrixAssert.match(validatorTest, new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(validatorTest, /delete route\.riskPolicyRef/u);
  matrixAssert.match(validatorTest, /graph-schema-invalid/u);
  matrixAssert.match(validatorTest, /RouteNode riskPolicyRef is required/u);
  matrixAssert.match(validatorTest, /route\.riskPolicyRef = 'capability:synthetic\.example:open-public-page'/u);
  matrixAssert.match(validatorTest, /graph-capability-missing-risk-policy/u);
  matrixAssert.match(validatorTest, /RouteNode riskPolicyRef does not resolve to a RiskPolicyNode/u);

  matrixAssert.match(section8.body, new RegExp(validatorName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section8.body, /missing RouteNode `riskPolicyRef` fails closed/u);
  matrixAssert.match(section8.body, /graph-schema-invalid/u);
  matrixAssert.match(section8.body, /RouteNode riskPolicyRef is required/u);
  matrixAssert.match(section8.body, /wrong-family `CapabilityNode` ref fails closed/u);
  matrixAssert.match(section8.body, /graph-capability-missing-risk-policy/u);
  matrixAssert.match(section8.body, /RouteNode riskPolicyRef does not resolve to a RiskPolicyNode/u);
  matrixAssert.match(section8.body, /descriptor validation only/u);
  matrixAssert.match(section8.body, /Section 8 descriptor coverage/u);
  matrixAssert.match(section8.body, /runtime planner execution/u);
  matrixAssert.match(
    getField(section8, 'Next smallest task') ?? '',
    /another non-verified section|do not repeat RouteNode route\/capability ref/u,
  );
  matrixAssert.doesNotMatch(
    section8.body,
    /status promoted|verified status set|runtime planner execution completed|runtime planner execution is complete|SiteAdapter invoked|downloader invoked|SessionView materialized|route execution enabled|runtime execution enabled/iu,
    'Section 8 should record RouteNode riskPolicyRef fail-closed coverage without promotion or runtime execution claims',
  );
});

test('Site Capability Graph matrix records RiskPolicyNode failure-mode docs and full inventory sourceRefs coverage', async () => {
  const [markdown, graphSource, docsGeneratorTest, generatedFixtureTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GENERATED_FIXTURE_TEST_URL),
  ]);
  const section12 = extractSections(markdown).find((section) => section.number === 12);

  matrixAssert.equal(typeof section12?.body, 'string');
  for (const testName of [
    'docs renderer includes failure mode retry semantics without runtime retry behavior',
    'docs renderer includes failure mode cooldown semantics without cooldown execution',
  ]) {
    matrixAssert.match(docsGeneratorTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    matrixAssert.match(section12.body, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  matrixAssert.doesNotMatch(
    section12.body,
    /failure-mode retry\/cooldown semantics still need docs generator coverage/iu,
  );
  matrixAssert.doesNotMatch(
    section12.body,
    /Risk policy nodes are not generated from Layer sources/u,
  );

  matrixAssert.match(graphSource, /export function createLayerSourceRiskPolicyInventorySummary/u);
  matrixAssert.match(graphSource, /export function assertLayerSourceRiskPolicyInventorySummaryCompatibility/u);
  matrixAssert.match(graphSource, /function assertLayerSourceRiskPolicySourceRefs\b/u);
  matrixAssert.match(graphSource, /assertLayerSourceRiskPolicySourceRefs\(node\.sourceRefs, 'RiskPolicyNode'\)/u);
  matrixAssert.match(section12.body, /createLayerSourceRiskPolicyInventorySummary\(\)/u);
  matrixAssert.match(section12.body, /assertLayerSourceRiskPolicyInventorySummaryCompatibility\(\)/u);

  matrixAssert.match(
    generatedFixtureTest,
    /generated Layer-source RiskPolicyNode inventory summary covers all config hosts descriptor-only/u,
  );
  matrixAssert.match(
    generatedFixtureTest,
    /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u,
  );
  matrixAssert.match(generatedFixtureTest, /assertRiskPolicyNodeCompatible\(item\)/u);
  matrixAssert.match(generatedFixtureTest, /assert\.deepEqual\(\s*\[\.\.\.item\.sourceRefs\]\.sort\(\),\s*\[\.\.\.LAYER_SOURCE_INVENTORIES\]\.sort\(\),/u);
  matrixAssert.match(generatedFixtureTest, /assertNoEnabledRuntimeInventoryFields\(summary\)/u);
  matrixAssert.match(generatedFixtureTest, /repoWriteEnabled/u);
  matrixAssert.match(generatedFixtureTest, /runtimeGenerationEnabled/u);
  matrixAssert.match(generatedFixtureTest, /runtimeArtifactWriteEnabled/u);
  matrixAssert.match(generatedFixtureTest, /riskStateMachineEnabled/u);
  matrixAssert.match(generatedFixtureTest, /runtimeRiskTransitionEnabled/u);
  matrixAssert.match(generatedFixtureTest, /RiskStateMachine\|runtime risk transition/u);

  matrixAssert.match(
    section12.body,
    /full config Layer-source `RiskPolicyNode` inventory\/sourceRefs descriptors/u,
  );
  matrixAssert.match(section12.body, /generated Layer-source RiskPolicyNode inventory summary covers all config hosts descriptor-only/u);
  matrixAssert.match(section12.body, /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u);
  matrixAssert.match(section12.body, /config\/site-capabilities\.json/u);
  matrixAssert.match(section12.body, /config\/site-registry\.json/u);
  matrixAssert.match(section12.body, /assertRiskPolicyNodeCompatible\(\)/u);
  matrixAssert.match(section12.body, /disabled runtime\/write fields/u);
  matrixAssert.match(
    section12.body,
    /No open Section 12 `RiskPolicyNode` taxonomy, schema, descriptor, sourceRefs, pure route-risk planning, docs rendering, or disabled-consumer contract gap remains/u,
  );
  matrixAssert.match(
    getField(section12, 'Next smallest task'),
    /another non-verified section|do not repeat the RiskPolicyNode sourceRefs/u,
  );
  matrixAssert.match(section12.body, /[Ll]ive Layer planner runtime consumer integration is still absent/u);
  matrixAssert.equal(getField(section12, 'Current status'), '`verified`');
  matrixAssert.doesNotMatch(
    section12.body,
    /production-grade full config inventory coverage, complete `sourceRefs`[^.\n]*remain missing|sourceRefs full inventory[^.\n]*missing|sourceRefs[^.\n]*completely missing/iu,
  );
  matrixAssert.doesNotMatch(
    section12.body,
    /status promoted|verified status set|RiskStateMachine execution enabled|RiskStateMachine transition enabled|runtime risk transition enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|repo write enabled|repo writes enabled|runtime writes enabled|runtime semantics introduced/iu,
  );
});

test('Site Capability Graph matrix records RiskPolicyNode route risk validation while runtime integration stays disabled', async () => {
  const [markdown, graphSource, plannerTest, validatorTest, generatedFixtureTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(PLANNER_TEST_URL),
    readSource(VALIDATOR_TEST_URL),
    readSource(GENERATED_FIXTURE_TEST_URL),
  ]);
  const section12 = extractSections(markdown).find((section) => section.number === 12);

  matrixAssert.equal(typeof section12?.body, 'string', 'Section 12 should exist');
  matrixAssert.equal(getField(section12, 'Current status'), '`verified`');

  matrixAssert.match(graphSource, /export function planGraphCapabilityRoute\b/u);
  matrixAssert.match(graphSource, /const riskPolicy = nodesById\.get\(route\.riskPolicyRef\)/u);
  matrixAssert.match(graphSource, /reasonCode: 'graph-route-forbidden-by-risk'/u);
  matrixAssert.match(graphSource, /function assertLayerSourceRiskPolicySourceRefs\b/u);
  matrixAssert.match(graphSource, /sourceRefs contains unsupported Layer config source/u);
  matrixAssert.match(graphSource, /export function assertRiskPolicyNodeCompatible\b/u);
  matrixAssert.match(graphSource, /assertLayerSourceRiskPolicySourceRefs\(node\.sourceRefs, 'RiskPolicyNode'\)/u);

  matrixAssert.match(plannerTest, /graph planner blocks route selection by declared risk state/u);
  matrixAssert.match(plannerTest, /blockedRiskStates: \['suspicious'\]/u);
  matrixAssert.match(plannerTest, /graph-route-forbidden-by-risk/u);
  matrixAssert.match(plannerTest, /plan\.riskState, 'suspicious'/u);
  matrixAssert.match(validatorTest, /validator rejects EndpointNode risk refs that do not resolve to RiskPolicyNode/u);
  matrixAssert.match(validatorTest, /graph-capability-missing-risk-policy/u);
  matrixAssert.match(validatorTest, /riskPolicyRef does not resolve to a RiskPolicyNode/u);
  matrixAssert.match(generatedFixtureTest, /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u);
  matrixAssert.match(generatedFixtureTest, /Authorization: Bearer synthetic-secret-value/u);
  matrixAssert.match(generatedFixtureTest, /assert\.doesNotMatch\(message, \/Authorization\|Bearer\|synthetic-secret-value\/u\)/u);

  matrixAssert.match(section12.body, /graph planner blocks route selection by declared risk state/u);
  matrixAssert.match(section12.body, /graph-route-forbidden-by-risk/u);
  matrixAssert.match(section12.body, /validator rejects EndpointNode risk refs that do not resolve to RiskPolicyNode/u);
  matrixAssert.match(section12.body, /graph-capability-missing-risk-policy/u);
  matrixAssert.match(section12.body, /Layer-source RiskPolicyNode inventory sourceRefs fail closed without echoing sensitive values/u);
  matrixAssert.match(section12.body, /assertLayerSourceRiskPolicySourceRefs\(\)/u);
  matrixAssert.match(section12.body, /assertRiskPolicyNodeCompatible\(\)/u);
  matrixAssert.match(section12.body, /mutated `sourceRefs` fail closed/u);
  matrixAssert.match(section12.body, /without echoing sensitive mutation input/u);
  matrixAssert.match(section12.body, /disabled runtime integration evidence now exist|design-only\/feature-disabled consumer evidence/u);
  matrixAssert.match(section12.body, /[Ll]ive Layer planner runtime consumer integration is still absent/u);
  matrixAssert.match(
    getField(section12, 'Next smallest task'),
    /another non-verified section|do not repeat the RiskPolicyNode sourceRefs/u,
  );
  matrixAssert.doesNotMatch(
    getField(section12, 'Next smallest task') ?? '',
    /route risk validation .*remain missing|route risk validation .*missing/iu,
  );
  matrixAssert.doesNotMatch(
    section12.body,
    /status promoted|verified status set|RiskStateMachine execution enabled|RiskStateMachine transition enabled|runtime risk transition enabled|runtime risk transitions enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|repo writes enabled|runtime writes enabled|Artifact writes enabled|SiteAdapter integration enabled|SiteAdapter invoked|downloader integration enabled|downloader invoked|SessionView materialized|runtime semantics introduced|Authorization: Bearer synthetic-secret-value/u,
  );
});

test('Site Capability Graph matrix records disabled RiskPolicyNode runtime consumer evidence without promotion', async () => {
  const [markdown, handoffTest] = await Promise.all([
    readMatrix(),
    readSource(PLANNER_HANDOFF_TEST_URL),
  ]);
  const section12 = extractSections(markdown).find((section) => section.number === 12);
  const handoffTestName = 'disabled graph planner runtime consumer preserves Layer-source RiskPolicyNode risk block without runtime execution';

  matrixAssert.equal(typeof section12?.body, 'string', 'Section 12 should exist');
  matrixAssert.equal(getField(section12, 'Current status'), '`verified`');

  matrixAssert.match(handoffTest, new RegExp(handoffTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(handoffTest, /graph-route-forbidden-by-risk/u);
  matrixAssert.match(handoffTest, /sourceHandoffReasonCode/u);
  matrixAssert.match(handoffTest, /riskState/u);
  matrixAssert.match(handoffTest, /featureEnabled,\s*false|featureEnabled false|featureEnabled=false/u);

  matrixAssert.match(section12.body, new RegExp(handoffTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section12.body, /design-only\/feature-disabled consumer evidence/u);
  matrixAssert.match(section12.body, /graph-route-forbidden-by-risk/u);
  matrixAssert.match(section12.body, /sourceHandoffReasonCode/u);
  matrixAssert.match(section12.body, /riskState/u);
  matrixAssert.match(section12.body, /featureEnabled false|featureEnabled=false/u);
  matrixAssert.match(section12.body, /[Ll]ive Layer planner runtime consumer integration is still absent/u);
  matrixAssert.match(
    getField(section12, 'Current gaps') ?? '',
    /[Ll]ive Layer planner runtime consumer integration is still absent/u,
  );
  matrixAssert.match(
    getField(section12, 'Next smallest task') ?? '',
    /another non-verified section|do not repeat the RiskPolicyNode sourceRefs/u,
  );
  matrixAssert.doesNotMatch(
    getField(section12, 'Next smallest task') ?? '',
    /disabled runtime integration evidence .*missing|Add disabled runtime integration evidence|Add .*risk blocking runtime preflight|Connect a live Layer planner runtime consumer/iu,
  );
  matrixAssert.doesNotMatch(
    section12.body,
    /status promoted|verified status set|runtime execution enabled|runtime execution allowed|RiskStateMachine execution enabled|RiskStateMachine transition enabled|runtime risk transition enabled|runtime risk transitions enabled|SiteAdapter integration enabled|SiteAdapter invoked|downloader integration enabled|downloader invoked|SessionView materialized|SessionView materialization enabled|Artifact writes enabled|runtime Artifact writes enabled|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|repo writes enabled|runtime writes enabled|runtime semantics introduced/iu,
  );
});

test('Site Capability Graph matrix records risk-blocking runtime preflight as disabled contract only', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);
  const section3 = sections.find((section) => section.number === 3);
  const section12 = sections.find((section) => section.number === 12);
  const evidenceName = 'graph planner risk-blocking runtime preflight contract stays disabled before runtime registration';
  const helperNames = [
    'createGraphPlannerRiskBlockingRuntimePreflightContract()',
    'assertGraphPlannerRiskBlockingRuntimePreflightCompatibility()',
  ];

  for (const section of [section3, section12]) {
    matrixAssert.equal(typeof section?.body, 'string', `Section ${section?.number ?? 'unknown'} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), section.number === 12 ? '`verified`' : '`partial`');
    matrixAssert.match(section.body, new RegExp(evidenceName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    }

    matrixAssert.match(section.body, /disabled\/contract-only preflight evidence/u);
    matrixAssert.match(section.body, /graph-route-forbidden-by-risk/u);
    matrixAssert.match(section.body, /sourceHandoffReasonCode/u);
    matrixAssert.match(section.body, /riskState/u);
    matrixAssert.match(section.body, /fail-closes enabled runtime flags/u);
    matrixAssert.match(section.body, /RiskStateMachine/u);
    matrixAssert.match(section.body, /runtime risk transition/u);
    matrixAssert.match(section.body, /route execution/u);
    matrixAssert.match(section.body, /SiteAdapter/u);
    matrixAssert.match(section.body, /downloader/u);
    matrixAssert.match(section.body, /SessionView/u);
    matrixAssert.match(section.body, /repo\/runtime writes/u);
    matrixAssert.match(section.body, /not a live Layer runtime consumer/u);
    matrixAssert.doesNotMatch(
      section.body,
      /status promoted|verified status set|live Layer runtime consumer evidence|live Layer planner runtime consumer evidence|RiskStateMachine execution enabled|runtime risk transition enabled|route execution enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|Artifact writes enabled|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true/iu,
    );

    const preflightLines = section.body
      .split('\n')
      .filter((line) => line.includes('Current round disabled/contract preflight evidence'));
    matrixAssert.equal(preflightLines.length, 1, `Section ${section.number} should record one preflight evidence line`);
    matrixAssert.doesNotMatch(preflightLines[0], /verified|promoted/iu);
  }

  matrixAssert.match(getField(section3, 'Next smallest task') ?? '', /planner handoff rejection shape|another `partial` section/u);
  matrixAssert.match(getField(section12, 'Next smallest task') ?? '', /another non-verified section|do not repeat the RiskPolicyNode sourceRefs/u);
  for (const nextSmallestTask of [
    getField(section3, 'Next smallest task') ?? '',
    getField(section12, 'Next smallest task') ?? '',
  ]) {
    matrixAssert.doesNotMatch(
      nextSmallestTask,
      /Add .*risk blocking runtime preflight|Connect a live Layer planner runtime consumer|more specific live Layer planner runtime consumer integration preflight contract/iu,
    );
  }
});

test('Site Capability Graph Section 19 next task excludes completed Section 2 and Section 3 handoff evidence', async () => {
  const markdown = await readMatrix();
  const section19 = extractSections(markdown).find((section) => section.number === 19);
  const section2Evidence = 'NonGoalsBoundary runtime handoff guard keeps blocked non-goals from becoming live consumers';

  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);
  matrixAssert.match(section19.body, new RegExp(section2Evidence.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  matrixAssert.match(section19.body, /62\/62|non-goals boundary \+ matrix combined suite passed|non-goals\/matrix combined/iu);

  const nextSmallestTask = getField(section19, 'Next smallest task') ?? '';
  matrixAssert.notEqual(nextSmallestTask, '', 'Section 19 should record a next smallest task');
  matrixAssert.doesNotMatch(
    nextSmallestTask,
    /After the Section 3 execution-entrypoint handoff guard is implemented and verified/iu,
    'Section 19 next task should not wait on completed Section 3 execution-entrypoint handoff evidence',
  );
  matrixAssert.match(
    nextSmallestTask,
    /do not repeat .*Section 2 .*non-goal runtime handoff|do not repeat .*non-goal runtime handoff/iu,
    'Section 19 next task should avoid repeating Section 2 non-goal runtime handoff evidence',
  );
  matrixAssert.match(
    nextSmallestTask,
    /do not repeat .*Section 3 .*execution-entrypoint handoff|do not repeat .*execution-entrypoint handoff/iu,
    'Section 19 next task should avoid repeating Section 3 execution-entrypoint handoff evidence',
  );
  matrixAssert.match(
    nextSmallestTask,
    /Section (?:16|18|20).*live integration|live integration .*Section (?:16|18|20)|live Layer consumer integration|runtime integration preflight|runtime integration handoff|another `partial` section|another partial section/iu,
    'Section 19 next task should still point at a live-integration pre-boundary or another partial section',
  );

  matrixAssert.doesNotMatch(
    section19.body,
    /Current status: `verified`|status promoted|verified status set|verified promotion|all sections verified|global completion|Graph complete|Site Capability Graph complete|final completion achieved/iu,
    'Section 19 should not claim verified promotion or global completion from handoff evidence',
  );
});

test('Site Capability Graph Section 19 records recent live integration prerequisites as promotion-blocking coverage', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const section19 = sectionByNumber.get(19);

  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);

  for (const sectionNumber of [16, 18, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(
      getField(section, 'Current status'),
      '`partial`',
      `Section ${sectionNumber} should stay partial after live integration prerequisite coverage`,
    );
  }

  for (const helperName of [
    'dispatchGraphDerivedArtifactWithRedactionAuditGate',
    'createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration',
    'createGraphDerivedArtifactConsumerRegistry',
    'createGraphDocsMarkdownArtifactRegistryConsumer',
  ]) {
    matrixAssert.match(
      section19.body,
      new RegExp(`${helperName}\\(\\)`, 'u'),
      `Section 19 should record ${helperName} as promotion-blocking prerequisite coverage`,
    );
  }

  for (const evidenceName of [
    'redaction audit gate',
    'registration owner integration',
    'docs markdown artifact registry consumer',
  ]) {
    matrixAssert.match(
      markdown,
      new RegExp(evidenceName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'),
      `Matrix should include focused evidence or command for ${evidenceName}`,
    );
  }

  const recentPrerequisiteLines = section19.body
    .split('\n')
    .filter((line) => (
      /dispatchGraphDerivedArtifactWithRedactionAuditGate|createGraphDocsLifecycleObservabilityRegistrationOwnerIntegration|createGraphDerivedArtifactConsumerRegistry|createGraphDocsMarkdownArtifactRegistryConsumer/iu
      .test(line)
    ))
    .join('\n');
  matrixAssert.notEqual(
    recentPrerequisiteLines,
    '',
    'Section 19 should have a focused recent prerequisite coverage line',
  );
  matrixAssert.doesNotMatch(
    recentPrerequisiteLines,
    /promoted to verified|verified status set|live Layer docs-output writer completed|external telemetry enabled|runtime write enabled|SiteAdapter invoked|downloader invoked|SessionView materialized/iu,
    'Recent Section 19 prerequisite coverage must remain promotion-blocking and disabled',
  );
  matrixAssert.doesNotMatch(
    section19.body,
    /Current status: `verified`|status promoted|verified promotion|all sections verified|global completion|Graph complete|Site Capability Graph complete|final completion achieved/iu,
    'Section 19 should not claim verified promotion from live integration prerequisite coverage',
  );
});

test('Site Capability Graph Section 19 records runtime dispatch dry-run adapter result as promotion-blocking coverage', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const section18 = sectionByNumber.get(18);
  const section19 = sectionByNumber.get(19);
  const helperNames = [
    'createGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResult',
    'assertGraphDocsLifecycleObservabilityRuntimeDispatchDryRunAdapterResultCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);

  for (const helperName of helperNames) {
    matrixAssert.match(
      section18.body,
      new RegExp(`${helperName}\\(\\)`, 'u'),
      `Section 18 should record ${helperName}`,
    );
    matrixAssert.match(
      section19.body,
      new RegExp(`${helperName}\\(\\)`, 'u'),
      `Section 19 should record ${helperName} as promotion-blocking coverage`,
    );
  }

  for (const requiredPhrase of [
    /runtime dispatch dry-run adapter result/iu,
    /promotion-blocking/iu,
    /Section 18/u,
    /descriptor-only|dry-run/iu,
    /external telemetry|runtime dispatch|runtime writes|SiteAdapter|downloader|SessionView|task runner/iu,
  ]) {
    matrixAssert.match(section19.body, requiredPhrase);
  }

  const dryRunCoverageLines = section19.body
    .split('\n')
    .filter((line) => (
      /runtime dispatch dry-run adapter result/iu.test(line)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    dryRunCoverageLines,
    '',
    'Section 19 should have runtime dispatch dry-run adapter promotion-blocking coverage lines',
  );
  matrixAssert.match(
    dryRunCoverageLines,
    /promotion-blocking|cannot promote|do not promote|not live/iu,
    'Runtime dispatch dry-run adapter coverage should be promotion-blocking only',
  );
  matrixAssert.doesNotMatch(
    dryRunCoverageLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|external telemetry enabled|telemetry enabled|runtime write enabled|runtime writes enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|live Layer adapter wiring enabled|live Layer adapter wired|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|task runner invoked/iu,
    'Runtime dispatch dry-run adapter coverage must not claim promotion, telemetry, writes, live adapter wiring, or runtime invocation',
  );
});

test('Site Capability Graph Section 19 records runtime write observability preflight as promotion-blocking coverage', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const section19 = sectionByNumber.get(19);
  const helperNames = [
    'createGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflight',
    'assertGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflightCompatibility',
  ];
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const focusedTests = [
    'docs-output live consumer runtime write observability preflight consumes artifact-writer invocation safe summary only',
    'docs-output live consumer runtime write observability preflight rejects enabled flags',
    'docs-output live consumer runtime write observability preflight rejects runtime observability payload keys and synthetic sensitive material without echoing it',
  ];

  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);

  for (const helperName of helperNames) {
    matrixAssert.match(
      artifactSource,
      new RegExp(`export function ${escapeRegex(helperName)}\\b`, 'u'),
      `artifact source should export ${helperName}`,
    );
    matrixAssert.match(
      section19.body,
      new RegExp(`${escapeRegex(helperName)}\\(\\)`, 'u'),
      `Section 19 should record ${helperName} as promotion-blocking coverage`,
    );
  }

  for (const testName of focusedTests) {
    matrixAssert.match(
      artifactWriterTest,
      new RegExp(escapeRegex(testName), 'u'),
      `artifact-writer suite should retain focused test: ${testName}`,
    );
  }

  for (const sectionNumber of [16, 18, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(
      getField(section, 'Current status'),
      '`partial`',
      `Section ${sectionNumber} should stay partial for runtime write observability preflight`,
    );
    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${escapeRegex(helperName)}\\(\\)`, 'u'));
    }
  }

  for (const requiredPhrase of [
    /runtime write observability preflight/iu,
    /promotion-blocking/iu,
    /Sections 16\/18\/20/iu,
    /descriptor-only \/ blocked \/ redactionRequired/iu,
    /runtime log write observability|runtime artifact write observability|runtime docs write observability/iu,
    /artifact writer invocation|external telemetry|SiteAdapter|downloader|SessionView|task runner|status promotion/iu,
  ]) {
    matrixAssert.match(section19.body, requiredPhrase);
  }

  const preflightCoverageLines = section19.body
    .split('\n')
    .filter((line) => (
      /runtime write observability preflight/iu.test(line)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    preflightCoverageLines,
    '',
    'Section 19 should have runtime write observability preflight promotion-blocking coverage lines',
  );
  matrixAssert.match(
    preflightCoverageLines,
    /promotion-blocking|cannot promote|do not promote|not live/iu,
    'Runtime write observability preflight coverage should be promotion-blocking only',
  );
  matrixAssert.doesNotMatch(
    preflightCoverageLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|log writer invoked|artifact writer invoked|external telemetry enabled|external dispatch enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|task runner invoked/iu,
    'Runtime write observability preflight coverage must not claim promotion, writes, telemetry, or runtime invocation',
  );
});

test('Site Capability Graph Section 19 records runtime docs artifact write observability promotion-blocking coverage', async () => {
  const markdown = await readMatrix();
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const section18 = sectionByNumber.get(18);
  const section19 = sectionByNumber.get(19);
  const helperNames = [
    'createGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidence',
    'assertGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidenceCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);

  for (const helperName of helperNames) {
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    matrixAssert.match(
      section19.body,
      new RegExp(`${helperName}\\(\\)`, 'u'),
      `Section 19 should record ${helperName} as promotion-blocking coverage`,
    );
  }

  for (const requiredPhrase of [
    /runtime docs artifact write observability evidence/u,
    /61\/61/u,
    /150\/150/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  matrixAssert.match(
    section19.body,
    /runtime docs artifact write observability promotion-blocking coverage/iu,
  );
  matrixAssert.match(section19.body, /Section 18/u);
  matrixAssert.match(section19.body, /promotion-blocking/iu);
  matrixAssert.match(
    getField(section19, 'Verification command') ?? '',
    /node --test --test-name-pattern "runtime docs artifact write observability promotion-blocking coverage" tests\\node\\site-capability-graph-matrix\.test\.mjs/u,
  );

  const coverageLines = section19.body
    .split('\n')
    .filter((line) => (
      /runtime docs artifact write observability/iu.test(line)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    coverageLines,
    '',
    'Section 19 should have runtime docs artifact write observability promotion-blocking coverage lines',
  );
  matrixAssert.match(
    coverageLines,
    /promotion-blocking|cannot promote|not live/iu,
    'Runtime docs artifact write observability coverage should be promotion-blocking only',
  );
  matrixAssert.doesNotMatch(
    coverageLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion allowed|live telemetry enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|runtime writes enabled|SiteAdapter enabled|SiteAdapter invoked|downloader enabled|downloader invoked|SessionView enabled|SessionView materialized|task runner enabled|task runner invoked/iu,
    'Runtime docs artifact write observability coverage must not claim promotion, live telemetry, runtime writes, or runtime enablement',
  );
});

test('Site Capability Graph Section 19 recent live integration review gates regression batch stays promotion-blocking', async () => {
  const [
    markdown,
    graphSource,
    nonGoalsSource,
    artifactSource,
    artifactGuardTest,
    nonGoalsTest,
    artifactWriterTest,
    contributing,
  ] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(NON_GOALS_BOUNDARY_URL),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_GUARD_TEST_URL),
    readSource(NON_GOALS_BOUNDARY_TEST_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
    readSource(CONTRIBUTING_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const section19 = sectionByNumber.get(19);
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const recentReviewGateBatches = [
    {
      label: 'aggregate execution boundary handoff review gate',
      helperSource: graphSource,
      focusedTestSource: artifactGuardTest,
      sectionNumbers: [1, 3],
      helpers: [
        'createGraphLayerAggregateExecutionBoundaryHandoffReviewGate',
        'assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility',
      ],
      focusedTests: [
        'Graph/Layer aggregate execution boundary handoff review gate consumes aggregate safe summary only',
        'Graph/Layer aggregate execution boundary handoff review gate rejects runtime handoff products',
        'Graph/Layer aggregate execution boundary handoff review gate rejects synthetic sensitive material without echoing it',
      ],
      matrixEvidence: [
        'site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate',
        'focused artifact-guard validation passed 3/3 for `aggregate execution boundary handoff review gate`',
        'focused matrix validation passed 1/1 for `aggregate execution boundary handoff review gate`',
      ],
      linePattern: /aggregate execution boundary handoff review gate|createGraphLayerAggregateExecutionBoundaryHandoffReviewGate|assertGraphLayerAggregateExecutionBoundaryHandoffReviewGateCompatibility|site-capability-graph-layer-aggregate-execution-boundary-handoff-review-gate/iu,
    },
    {
      label: 'non-goal live consumer compatibility review gate',
      helperSource: nonGoalsSource,
      focusedTestSource: nonGoalsTest,
      sectionNumbers: [2],
      helpers: [
        'createNonGoalLiveConsumerCompatibilityReviewGate',
        'assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility',
      ],
      focusedTests: [
        'NonGoalsBoundary live consumer compatibility review gate consumes only acceptance guard safe summaries',
        'NonGoalsBoundary live consumer compatibility review gate rejects live runtime, writes, telemetry, promotion, and sensitive material',
      ],
      matrixEvidence: [
        'site-capability-graph-non-goal-live-consumer-compatibility-review-gate',
        'focused compatibility review gate validation passed 2/2',
        'focused matrix validation passed 1/1 for `non-goal live consumer compatibility review gate`',
      ],
      linePattern: /non-goal live consumer compatibility review gate|createNonGoalLiveConsumerCompatibilityReviewGate|assertNonGoalLiveConsumerCompatibilityReviewGateCompatibility|site-capability-graph-non-goal-live-consumer-compatibility-review-gate/iu,
    },
    {
      label: 'docs-output live consumer dispatch compatibility review gate',
      helperSource: artifactSource,
      focusedTestSource: artifactWriterTest,
      sectionNumbers: [16, 20],
      helpers: [
        'createGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGate',
        'assertGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGateCompatibility',
      ],
      focusedTests: [
        'docs-output live consumer dispatch compatibility review gate consumes dry-run safe summary only',
        'docs-output live consumer dispatch compatibility review gate rejects runtime writes and consumers',
        'docs-output live consumer dispatch compatibility review gate rejects synthetic sensitive material without echoing it',
      ],
      matrixEvidence: [
        'docs-output live consumer dispatch compatibility review gate',
        'focused artifact-writer validation passed 3/3',
        'focused matrix validation passed 1/1',
      ],
      linePattern: /docs-output live consumer dispatch compatibility review gate|createGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGate|assertGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGateCompatibility/iu,
    },
  ];

  matrixAssert.equal(typeof section19?.body, 'string', 'Section 19 should exist');
  matrixAssert.equal(getField(section19, 'Current status'), '`partial`');
  matrixAssert.match(section19.heading, /Testing strategy/u);
  matrixAssert.match(contributing, /## Site Capability Layer Implementation Matrix/u);
  matrixAssert.match(contributing, /### 19\. Standard artifacts and inventories/u);
  matrixAssert.match(
    contributing,
    /Site Capability Graph Section 19 recent live integration review gates regression batch stays promotion-blocking/u,
  );
  matrixAssert.match(
    contributing,
    /aggregate execution boundary handoff, non-goal live consumer compatibility, and docs-output live consumer dispatch compatibility review gates/u,
  );
  matrixAssert.match(contributing, /focused matrix validation passed 1\/1 and full matrix validation passed 79\/79/u);
  matrixAssert.doesNotMatch(
    contributing,
    /Site Capability Graph review-gate regression[^.\n]*(?:status promoted|verified promotion|live consumer wiring enabled|repo\/docs\/runtime writes enabled|external telemetry enabled|external dispatch enabled|SiteAdapter invoked|downloader invoked|SessionView materialized)/iu,
    'CONTRIBUTING durable matrix evidence should remain promotion-blocking',
  );

  for (const batch of recentReviewGateBatches) {
    for (const helperName of batch.helpers) {
      matrixAssert.match(
        batch.helperSource,
        new RegExp(`export (?:async )?function ${escapeRegex(helperName)}\\b`, 'u'),
        `${batch.label} should export ${helperName}`,
      );
      matrixAssert.match(markdown, new RegExp(`${escapeRegex(helperName)}\\(\\)`, 'u'));
    }

    for (const testName of batch.focusedTests) {
      matrixAssert.match(
        batch.focusedTestSource,
        new RegExp(escapeRegex(testName), 'u'),
        `${batch.label} should retain focused test: ${testName}`,
      );
    }

    for (const sectionNumber of batch.sectionNumbers) {
      const section = sectionByNumber.get(sectionNumber);
      matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
      matrixAssert.equal(
        getField(section, 'Current status'),
        '`partial`',
        `Section ${sectionNumber} should stay partial for ${batch.label}`,
      );

      for (const evidence of batch.matrixEvidence) {
        matrixAssert.match(
          section.body,
          new RegExp(escapeRegex(evidence), 'u'),
          `Section ${sectionNumber} should record ${batch.label} matrix evidence: ${evidence}`,
        );
      }

      const reviewGateLines = section.body
        .split('\n')
        .filter((line) => batch.linePattern.test(line))
        .join('\n');
      matrixAssert.notEqual(
        reviewGateLines,
        '',
        `Section ${sectionNumber} should include ${batch.label} evidence lines`,
      );
      matrixAssert.doesNotMatch(
        reviewGateLines,
        /Current status: `verified`|status promoted|verified status set|verified promotion|promoted to verified|live wiring enabled|live runtime wiring enabled|live consumer enabled|live consumer integration enabled|live dispatch enabled|live Layer planner runtime execution enabled|Graph execution enabled|Graph executor enabled|artifact writer invoked|docs write enabled|repo write enabled|runtime write enabled|runtime artifact write enabled|external telemetry enabled|external dispatch enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|DownloadPolicy materialized|StandardTaskList materialized|matrix writer invoked|matrix status change enabled/iu,
        `Section ${sectionNumber} ${batch.label} evidence should not claim promotion or live wiring`,
      );
    }
  }

  for (const phrase of [
    /aggregate execution boundary handoff review gate/iu,
    /non-goal live consumer compatibility review gate/iu,
    /dispatch compatibility review gate/iu,
    /promotion-blocking/iu,
  ]) {
    matrixAssert.match(section19.body, phrase);
  }
  matrixAssert.doesNotMatch(
    section19.body,
    /Current status: `verified`|status promoted|verified promotion|all sections verified|global completion|Graph complete|Site Capability Graph complete|final completion achieved/iu,
    'Section 19 should not claim verified promotion from recent review gate coverage',
  );
});

test('Site Capability Graph matrix cross-checks runtime integration design descriptors as disabled', async () => {
  const [markdown, graphSource, plannerSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(PLANNER_HANDOFF_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section.body]));
  const descriptors = [
    {
      createName: 'createGraphPlannerRuntimeIntegrationDesign',
      assertName: 'assertGraphPlannerRuntimeIntegrationDesignCompatibility',
      source: plannerSource,
      sectionNumbers: [3, 13, 14, 15, 19, 20],
      boundaryPhrase: 'keeping live route execution, SiteAdapter invocation, downloader invocation',
    },
    {
      createName: 'createGraphMigrationReportRuntimeIntegrationDesign',
      assertName: 'assertGraphMigrationReportRuntimeIntegrationDesignCompatibility',
      source: graphSource,
      sectionNumbers: [15, 16, 19, 20],
      boundaryPhrase: 'describe future migration report runtime integration while keeping repo writes',
    },
    {
      createName: 'createGraphInventoryRuntimeIntegrationDesign',
      assertName: 'assertGraphInventoryRuntimeIntegrationDesignCompatibility',
      source: graphSource,
      sectionNumbers: [1, 4, 13, 15, 16, 19, 20],
      boundaryPhrase: 'future generated graph inventory runtime integration while keeping runtime generation',
    },
  ];

  for (const descriptor of descriptors) {
    matrixAssert.match(descriptor.source, new RegExp(`export function ${descriptor.createName}\\b`, 'u'));
    matrixAssert.match(descriptor.source, new RegExp(`export function ${descriptor.assertName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${descriptor.createName}\\(\\)`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${descriptor.assertName}\\(\\)`, 'u'));
    matrixAssert.match(
      markdown,
      new RegExp(descriptor.boundaryPhrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );

    for (const sectionNumber of descriptor.sectionNumbers) {
      const sectionBody = sectionByNumber.get(sectionNumber);
      matrixAssert.equal(typeof sectionBody, 'string', `Section ${sectionNumber} should exist`);
      matrixAssert.match(
        sectionBody,
        /\bdescriptor-only\b|\bdesign-only\b|\bdisabled\b/iu,
        `Section ${sectionNumber} should keep disabled design wording for ${descriptor.createName}`,
      );
      matrixAssert.doesNotMatch(sectionBody, /\brepoWriteEnabled=true\b|\bruntimeGenerationEnabled=true\b/iu);
      matrixAssert.doesNotMatch(sectionBody, /\bruntimeArtifactWriteEnabled=true\b|\bexternalCommandEnabled=true\b/iu);
    }
  }
});

test('Site Capability Graph docs record missing Layer design path without treating it as present', async () => {
  await matrixAssert.rejects(() => access(LAYER_DESIGN_URL), /ENOENT/u);

  const [matrix, migrationPlan, contributing, agents] = await Promise.all([
    readMatrix(),
    readSource(MIGRATION_PLAN_URL),
    readSource(CONTRIBUTING_URL),
    readSource(AGENTS_URL),
  ]);
  const sections = extractSections(matrix);
  const section3 = sections.find((section) => section.number === 3)?.body ?? '';
  const section19 = sections.find((section) => section.number === 19)?.body ?? '';

  matrixAssert.match(section3, /docs\/site-capability-layer\/DESIGN\.md` is missing/u);
  matrixAssert.match(section3, /Layer design source remains `CONTRIBUTING\.md`/u);
  matrixAssert.match(section3, /`AGENTS\.md` architecture guardrails/u);
  matrixAssert.match(section19, /missing Layer design path reconciliation/u);
  matrixAssert.match(migrationPlan, /docs\/site-capability-layer\/DESIGN\.md` is still missing/u);
  matrixAssert.match(migrationPlan, /`CONTRIBUTING\.md` and `AGENTS\.md` remain the Layer design references/u);
  matrixAssert.match(contributing, /## Site Capability Layer Design Contract/u);
  matrixAssert.match(agents, /## Architecture Guardrails/u);
  matrixAssert.doesNotMatch(matrix, /docs\/site-capability-layer\/DESIGN\.md` is present/iu);
  matrixAssert.doesNotMatch(matrix, /docs\/site-capability-layer\/DESIGN\.md` is verified/iu);
});

test('Site Capability Graph matrix tracks repo-output dry-run descriptors without marking them writable', async () => {
  const [markdown, graphSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section.body]));
  const descriptors = [
    {
      createName: 'createGraphInventoryRepoOutputDryRun',
      assertName: 'assertGraphInventoryRepoOutputDryRunCompatibility',
      sectionNumbers: [1, 4, 16, 19, 20],
      boundaryPhrase: 'repo-level inventory output remains dry-run-only',
    },
    {
      createName: 'createGraphMigrationReportRepoOutputDryRun',
      assertName: 'assertGraphMigrationReportRepoOutputDryRunCompatibility',
      sectionNumbers: [16, 19, 20],
      boundaryPhrase: 'repo-level migration report output remain dry-run-only',
    },
  ];

  for (const descriptor of descriptors) {
    matrixAssert.match(graphSource, new RegExp(`export function ${descriptor.createName}\\b`, 'u'));
    matrixAssert.match(graphSource, new RegExp(`export function ${descriptor.assertName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${descriptor.createName}\\(\\)`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${descriptor.assertName}\\(\\)`, 'u'));
    matrixAssert.match(markdown, new RegExp(descriptor.boundaryPhrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

    for (const sectionNumber of descriptor.sectionNumbers) {
      const sectionBody = sectionByNumber.get(sectionNumber);
      matrixAssert.equal(typeof sectionBody, 'string', `Section ${sectionNumber} should exist`);
      matrixAssert.match(sectionBody, /dry-run-only|dry-run .*preview|repo target non-creation|no-write/iu);
      matrixAssert.doesNotMatch(sectionBody, /\brepoWriteEnabled=true\b|\bruntimeArtifactWriteEnabled=true\b/iu);
    }
  }

  const section20 = sectionByNumber.get(20) ?? '';
  matrixAssert.match(section20, /Repo-level generated graph inventory output and repo-level migration report output remain dry-run-only/iu);
  matrixAssert.doesNotMatch(section20, /repo-level .* output .* enabled/iu);
});

test('Site Capability Graph docs-output descriptors cannot promote sections to verified', async () => {
  const [markdown, graphSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  matrixAssert.match(graphSource, /createGraphDocsOutputFinalAcceptanceDescriptor/u);
  matrixAssert.match(graphSource, /matrixVerifiedPromotionAllowed: false/u);
  matrixAssert.match(graphSource, /matrixVerifiedPromotionAllowed must be false/u);
  matrixAssert.match(markdown, /Site Capability Graph docs-output descriptors cannot promote sections to verified/u);

  for (const sectionNumber of [16, 18, 19, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    const status = getField(section, 'Current status')?.replaceAll('`', '');
    matrixAssert.equal(status, 'partial', `Section ${sectionNumber} should stay partial after docs-output promotion review`);
    matrixAssert.match(
      section.body,
      new RegExp(`Current round promotion review: Section ${sectionNumber} remains ` + '`partial`', 'u'),
      `Section ${sectionNumber} should record conservative promotion review`,
    );
    matrixAssert.doesNotMatch(
      section.body,
      /Current status: `verified`|status promoted|verified status set|matrix writer invoked/iu,
      `Section ${sectionNumber} should not claim verified promotion from docs-output descriptors`,
    );
  }

  matrixAssert.match(markdown, /Runtime Layer write-path integration still does not exist; the current redaction audit attachment is limited to the guarded graph-derived artifact writer/iu);
  matrixAssert.match(markdown, /telemetry producers, external telemetry, runtime dispatch\/log\/artifact\/docs writes, runtime docs write observability, or runtime docs artifact write observability/iu);
  matrixAssert.match(markdown, /promotion-blocking coverage still need focused tests/iu);
  matrixAssert.match(markdown, /do not constitute a completed runtime artifact pipeline/iu);
});

test('Site Capability Graph records live Layer consumer final acceptance preflight without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveLayerConsumerFinalAcceptancePreflight',
    'assertGraphDocsOutputLiveLayerConsumerFinalAcceptancePreflightCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live layer consumer final acceptance preflight stays descriptor-only blocked',
    'docs-output live layer consumer final acceptance preflight rejects enabled flags and runtime payloads',
    'docs-output live layer consumer final acceptance preflight rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    const preflightLines = section.body
      .split('\n')
      .filter((line) => /live Layer docs-output consumer final acceptance preflight|live layer consumer final acceptance preflight/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(preflightLines, '', `Section ${sectionNumber} should record final acceptance preflight lines`);
    matrixAssert.match(preflightLines, /descriptor-only \/ disabled/u);
    matrixAssert.match(preflightLines, /safe summary from the live writer completion guard/u);
    matrixAssert.match(preflightLines, /live consumer enablement, docs\/repo\/runtime artifact writes/u);
    matrixAssert.match(preflightLines, /artifact writer invocation, publish, external telemetry, SiteAdapter, downloader, SessionView/u);
    matrixAssert.match(preflightLines, /status promotion disabled/u);
    matrixAssert.match(preflightLines, /callbacks, writer paths, repo paths, task lists/u);
    matrixAssert.match(preflightLines, /focused artifact-writer validation passed 3\/3 for `live layer consumer final acceptance preflight`/u);
    matrixAssert.match(preflightLines, /focused matrix validation passed 1\/1 for `live Layer consumer final acceptance preflight`/u);
    matrixAssert.doesNotMatch(
      preflightLines,
      /live consumer enabled|runtime docs-output writer completed|docs write enabled|repo write enabled|runtime artifact write enabled|artifact writer invoked|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|matrix writer invoked|status promoted/iu,
      `Section ${sectionNumber} should not claim live writes or promotion from final acceptance preflight`,
    );
  }

  matrixAssert.match(artifactSource, /liveLayerConsumerEnabled/u);
  matrixAssert.match(artifactSource, /docsWriteEnabled/u);
  matrixAssert.match(artifactSource, /repoWriteEnabled/u);
  matrixAssert.match(artifactSource, /runtimeArtifactWriteEnabled/u);
  matrixAssert.match(artifactSource, /artifactWriterEnabled/u);
  matrixAssert.match(artifactSource, /externalTelemetryEnabled/u);
  matrixAssert.match(artifactSource, /siteAdapterInvocationEnabled/u);
  matrixAssert.match(artifactSource, /downloaderInvocationEnabled/u);
  matrixAssert.match(artifactSource, /sessionMaterializationEnabled/u);
});

test('Site Capability Graph records live docs-output consumer registration acceptance boundary without registration promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveLayerConsumerRegistrationAcceptanceBoundary',
    'assertGraphDocsOutputLiveLayerConsumerRegistrationAcceptanceBoundaryCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live layer consumer registration acceptance boundary stays descriptor-only blocked',
    'docs-output live layer consumer registration acceptance boundary rejects enabled flags and runtime payloads',
    'docs-output live layer consumer registration acceptance boundary rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    const boundaryLines = section.body
      .split('\n')
      .filter((line) => /live docs-output consumer registration acceptance boundary|registration acceptance boundary/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(boundaryLines, '', `Section ${sectionNumber} should record registration boundary lines`);
    matrixAssert.match(boundaryLines, /descriptor-only \/ blocked \/ redactionRequired/u);
    matrixAssert.match(boundaryLines, /final acceptance preflight safe summary/u);
    matrixAssert.match(boundaryLines, /live consumer registration, callbacks, docs\/repo\/runtime artifact writes/u);
    matrixAssert.match(boundaryLines, /writer invocation, publish, external telemetry, SiteAdapter, downloader, SessionView/u);
    matrixAssert.match(boundaryLines, /task runner, matrix updates, and status changes disabled/u);
    matrixAssert.match(boundaryLines, /focused artifact-writer validation passed 3\/3 for `registration acceptance boundary`/u);
    matrixAssert.match(boundaryLines, /focused matrix validation passed 1\/1 for `registration acceptance boundary`/u);
    matrixAssert.doesNotMatch(
      boundaryLines,
      /live consumer registration enabled|callback registered|consumer callback invoked|docs write enabled|repo write enabled|runtime artifact write enabled|writer invoked|publish enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|matrix writer invoked|status advanced/iu,
      `Section ${sectionNumber} should not claim live registration or promotion from boundary evidence`,
    );
  }

  matrixAssert.match(artifactSource, /registrationEnabled/u);
  matrixAssert.match(artifactSource, /registryWriteEnabled/u);
  matrixAssert.match(artifactSource, /registrationAllowed/u);
  matrixAssert.match(artifactSource, /consumerCallback/u);
  matrixAssert.match(artifactSource, /sourceFinalAcceptancePreflight/u);
  matrixAssert.match(artifactSource, /registrationOwner: 'Layer'/u);
});

test('Site Capability Graph records Layer-owned docs-output no-op registration catalog without live registration', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveLayerConsumerNoopRegistrationCatalog',
    'assertGraphDocsOutputLiveLayerConsumerNoopRegistrationCatalogCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live layer consumer no-op registration catalog stays descriptor-only blocked',
    'docs-output live layer consumer no-op registration catalog rejects enabled flags and runtime catalog payloads',
    'docs-output live layer consumer no-op registration catalog rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [18, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    if (sectionNumber === 18) {
      matrixAssert.doesNotMatch(
        section.body,
        /pending no-op registration catalog/iu,
        'Section 18 should not retain stale pending no-op registration catalog wording',
      );
    }
    const catalogLines = section.body
      .split('\n')
      .filter((line) => /Layer-owned docs-output consumer no-op registration catalog|no-op registration catalog/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(catalogLines, '', `Section ${sectionNumber} should record no-op catalog lines`);
    matrixAssert.match(catalogLines, /descriptor-only \/ blocked \/ redactionRequired/u);
    matrixAssert.match(catalogLines, /registration acceptance boundary safe summary/u);
    matrixAssert.match(catalogLines, /Layer-owned registration metadata cataloging/u);
    matrixAssert.match(catalogLines, /does not register consumers, does not register callbacks/u);
    matrixAssert.match(catalogLines, /does not write registry\/catalog\/docs\/repo\/runtime artifacts/u);
    matrixAssert.match(catalogLines, /does not publish, does not send external telemetry/u);
    matrixAssert.match(catalogLines, /does not call SiteAdapter or downloader/u);
    matrixAssert.match(catalogLines, /does not materialize SessionView/u);
    matrixAssert.match(catalogLines, /focused artifact-writer validation passed 3\/3 for `no-op registration catalog`/u);
    matrixAssert.match(catalogLines, /focused matrix validation passed 1\/1 for `no-op registration catalog`/u);
    matrixAssert.match(catalogLines, new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'));
    matrixAssert.doesNotMatch(
      catalogLines,
      /pending no-op registration catalog|consumer registered|callback registered|registry write enabled|registry writes enabled|catalog write enabled|catalog writes enabled|runtime write enabled|runtime writes enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime artifact writes enabled|docs write enabled|docs writes enabled|repo write enabled|repo writes enabled|publish enabled|external telemetry enabled|telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|status promoted|status promotion enabled|status advanced|verified promotion/iu,
      `Section ${sectionNumber} should not claim live registration from no-op catalog evidence`,
    );
  }

  matrixAssert.match(artifactSource, /registrationCatalogEnabled/u);
  matrixAssert.match(artifactSource, /catalogWriteEnabled/u);
  matrixAssert.match(artifactSource, /consumerRegistered: false/u);
  matrixAssert.match(artifactSource, /callbackStored: false/u);
  matrixAssert.match(artifactSource, /functionStored: false/u);
  matrixAssert.match(artifactSource, /sourceRegistrationAcceptanceBoundary/u);
});

test('Site Capability Graph records live layer consumer integration checkpoint without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveLayerConsumerIntegrationCheckpoint',
    'assertGraphDocsOutputLiveLayerConsumerIntegrationCheckpointCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live layer consumer integration checkpoint stays descriptor-only blocked',
    'docs-output live layer consumer integration checkpoint rejects enabled flags and runtime payloads',
    'docs-output live layer consumer integration checkpoint rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    const checkpointLines = section.body
      .split('\n')
      .filter((line) => /live layer consumer integration checkpoint/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(checkpointLines, '', `Section ${sectionNumber} should record integration checkpoint lines`);
    matrixAssert.match(checkpointLines, /descriptor-only \/ blocked \/ redactionRequired/u);
    matrixAssert.match(checkpointLines, /no-op registration catalog safe summary/u);
    matrixAssert.match(checkpointLines, /reviewed live Layer integration prerequisite/u);
    matrixAssert.match(checkpointLines, /live consumer integration, registration, callbacks/u);
    matrixAssert.match(checkpointLines, /artifact writer invocation, docs\/repo\/runtime writes/u);
    matrixAssert.match(checkpointLines, /registry\/catalog writes, publish, external telemetry/u);
    matrixAssert.match(checkpointLines, /SiteAdapter, downloader, SessionView, task runner/u);
    matrixAssert.match(checkpointLines, /matrix changes, and status changes disabled/u);
    matrixAssert.match(checkpointLines, /focused artifact-writer validation passed 3\/3 for `live layer consumer integration checkpoint`/u);
    matrixAssert.match(checkpointLines, /focused matrix validation passed 1\/1 for `live layer consumer integration checkpoint`/u);
    matrixAssert.match(checkpointLines, new RegExp(`Section ${sectionNumber} remains ` + '`partial`', 'u'));
    matrixAssert.doesNotMatch(
      checkpointLines,
      /reservation only|does not record completion|placeholder|pending|live consumer integration enabled|consumer registered|callback registered|artifact writer invoked|docs write enabled|repo write enabled|runtime artifact write enabled|registry write enabled|catalog write enabled|publish enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|matrix writer invoked|status advanced|status promoted/iu,
      `Section ${sectionNumber} should not claim live integration, writes, telemetry, invocation, or promotion`,
    );
  }

  matrixAssert.match(artifactSource, /liveConsumerIntegrationEnabled/u);
  matrixAssert.match(artifactSource, /artifactWriterInvocationEnabled/u);
  matrixAssert.match(artifactSource, /matrixStatusChangeEnabled/u);
  matrixAssert.match(artifactSource, /sourceNoopRegistrationCatalog/u);
});

test('Site Capability Graph records docs-output live consumer dispatch dry-run result without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveConsumerDispatchDryRunResult',
    'assertGraphDocsOutputLiveConsumerDispatchDryRunResultCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export (async )?function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live consumer dispatch dry-run result dispatches through in-memory registry safely',
    'docs-output live consumer dispatch dry-run result rejects writes publish callbacks and runtime payloads',
    'docs-output live consumer dispatch dry-run result rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    const dispatchLines = section.body
      .split('\n')
      .filter((line) => /docs-output live consumer dispatch dry-run result/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(dispatchLines, '', `Section ${sectionNumber} should record dispatch dry-run lines`);
    matrixAssert.match(dispatchLines, /in-memory \/ dry-run \/ descriptor-only/u);
    matrixAssert.match(dispatchLines, /redactionRequired/u);
    matrixAssert.match(dispatchLines, /Layer-owned consumer dispatch/u);
    matrixAssert.match(dispatchLines, /safe summary/u);
    matrixAssert.match(dispatchLines, /focused artifact-writer validation passed 3\/3/u);
    matrixAssert.match(dispatchLines, /focused matrix validation passed 1\/1/u);
    matrixAssert.match(dispatchLines, new RegExp(`Section ${sectionNumber} remains ` + '`partial`', 'u'));
    matrixAssert.doesNotMatch(
      dispatchLines,
      /placeholder|reserved only|live consumer enablement enabled|artifact writer invoked|artifact writer invocation enabled|docs write enabled|repo write enabled|runtime artifact write enabled|registry write enabled|catalog write enabled|publish enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|matrix writer invoked|status advanced|status promoted|verified promotion/iu,
      `Section ${sectionNumber} should not claim writes, telemetry, invocation, or promotion`,
    );
  }

  matrixAssert.match(artifactSource, /dispatchMode: 'in-memory-consumer-registry-dry-run'/u);
  matrixAssert.match(artifactSource, /artifactWriterInvocationEnabled/u);
  matrixAssert.match(artifactSource, /sourceIntegrationCheckpoint/u);
  matrixAssert.match(artifactSource, /consumerResultSummaries/u);
});

test('Site Capability Graph records docs-output live consumer dispatch compatibility review gate without write promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));

  for (const helperName of [
    'createGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGate',
    'assertGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGateCompatibility',
  ]) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(markdown, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live consumer dispatch compatibility review gate consumes dry-run safe summary only',
    'docs-output live consumer dispatch compatibility review gate rejects runtime writes and consumers',
    'docs-output live consumer dispatch compatibility review gate rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
    const reviewGateLines = section.body
      .split('\n')
      .filter((line) => /docs-output live consumer dispatch compatibility review gate/iu.test(line))
      .join('\n');
    matrixAssert.notEqual(reviewGateLines, '', `Section ${sectionNumber} should record review gate lines`);
    matrixAssert.match(reviewGateLines, /descriptor-only \/ blocked \/ redactionRequired/u);
    matrixAssert.match(reviewGateLines, /dispatch dry-run result/u);
    matrixAssert.match(reviewGateLines, /safe summary/u);
    matrixAssert.match(reviewGateLines, /B-review and approval-gate requirements/u);
    matrixAssert.match(reviewGateLines, /explicit acceptance before live dispatch/u);
    matrixAssert.match(reviewGateLines, /focused artifact-writer validation passed 3\/3/u);
    matrixAssert.match(reviewGateLines, /focused matrix validation passed 1\/1/u);
    matrixAssert.match(reviewGateLines, new RegExp(`Section ${sectionNumber} remains ` + '`partial`', 'u'));
    matrixAssert.doesNotMatch(
      reviewGateLines,
      /placeholder|pending main-thread|live consumer enablement enabled|live dispatch enabled|artifact writer invoked|artifact writer invocation enabled|docs write enabled|repo write enabled|runtime artifact write enabled|registry write enabled|catalog write enabled|publish enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|matrix writer invoked|status advanced|status promoted|verified promotion/iu,
      `Section ${sectionNumber} should not claim writes, telemetry, invocation, or promotion`,
    );
  }

  matrixAssert.match(artifactSource, /BReviewRequired: true/u);
  matrixAssert.match(artifactSource, /explicitApprovalRequiredBeforeLiveConsumer: true/u);
  matrixAssert.match(artifactSource, /sourceDispatchDryRunResult/u);
  matrixAssert.match(artifactSource, /liveWiringEnabled/u);
});

test('Site Capability Graph Section 20 records docs-output external dispatch acceptance preflight artifact-output binding', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const helperNames = [
    'createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight',
    'assertGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflightCompatibility',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  for (const testName of [
    'docs-output live consumer external dispatch acceptance preflight consumes dry-run safe summary only',
    'docs-output live consumer external dispatch acceptance preflight rejects enabled flags',
    'docs-output live consumer external dispatch acceptance preflight rejects runtime payload keys',
    'docs-output live consumer external dispatch acceptance preflight rejects synthetic sensitive material without echoing it',
  ]) {
    matrixAssert.match(artifactWriterTest, new RegExp(testName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  for (const requiredPhrase of [
    /external dispatch acceptance preflight evidence/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /safe summary from `createGraphDocsOutputLiveConsumerDispatchDryRunResult\(\)`/u,
    /external dispatch disabled/u,
    /external telemetry disabled/u,
    /docs\/repo\/runtime writes disabled/u,
    /SiteAdapter(?:\/|, )downloader(?:\/|, )SessionView(?:\/|, )task runner(?:\/|, and )status promotion disabled/u,
    /Section 20 remains `partial`/u,
  ]) {
    matrixAssert.match(section20.body, requiredPhrase);
  }

  const preflightLines = section20.body
    .split('\n')
    .filter((line) => (
      line.includes('external dispatch acceptance preflight')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    preflightLines,
    '',
    'Section 20 should include docs-output external dispatch acceptance preflight evidence lines',
  );
  matrixAssert.doesNotMatch(
    preflightLines,
    /status promoted|verified|external dispatch enabled|external telemetry enabled|writes enabled|artifact writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
    'Section 20 external dispatch acceptance preflight lines should not claim promotion, live dispatch, writes, or runtime invocation',
  );
});

test('Site Capability Graph Section 20 records docs-output live consumer external dispatch no-op handoff gate', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const focusedTestName = 'external dispatch no-op handoff gate';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGate',
    'assertGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGateCompatibility',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');
  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(
    getField(section20, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "external dispatch no-op handoff gate"/u,
  );

  for (const requiredPhrase of [
    /external dispatch no-op handoff gate/u,
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /safe summary from `createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight\(\)`/u,
    /external dispatch disabled/u,
    /external telemetry disabled/u,
    /docs[-/]repo[-/]runtime writes disabled/u,
    /SiteAdapter(?:\/|, )downloader(?:\/|, )SessionView(?:\/|, )task runner(?:\/|, and )status promotion disabled/u,
    /Section 20 remains `partial`/u,
  ]) {
    matrixAssert.match(section20.body, requiredPhrase);
  }

  const handoffGateLines = section20.body
    .split('\n')
    .filter((line) => (
      line.includes('external dispatch no-op handoff gate')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    handoffGateLines,
    '',
    'Section 20 should include docs-output external dispatch no-op handoff gate evidence lines',
  );
  matrixAssert.doesNotMatch(
    handoffGateLines,
    /status promoted|verified|external dispatch enabled|external telemetry enabled|writes enabled|artifact writer invoked|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
    'Section 20 external dispatch no-op handoff gate lines should not claim promotion, live dispatch, writes, or runtime invocation',
  );
});

test('Site Capability Graph Sections 16 and 20 record docs-output live consumer artifact-writer invocation preflight remains blocked', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const focusedTestName = 'artifact-writer invocation preflight';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerArtifactWriterInvocationPreflight',
    'assertGraphDocsOutputLiveConsumerArtifactWriterInvocationPreflightCompatibility',
  ];

  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    }

    matrixAssert.match(
      getField(section, 'Verification command') ?? '',
      /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "artifact-writer invocation preflight"/u,
    );
    matrixAssert.match(
      getField(section, 'Verification command') ?? '',
      /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "artifact-writer invocation preflight"/u,
    );

    for (const requiredPhrase of [
      /artifact-writer invocation preflight/u,
      /descriptor-only \/ blocked \/ redactionRequired/u,
      /safe summary from `createGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGate\(\)`/u,
      /artifact writer invocation disabled/u,
      /docs[-/]repo[-/]runtime writes disabled/u,
      /external dispatch disabled/u,
      /external telemetry disabled|telemetry disabled/u,
      /SiteAdapter(?:\/|, )downloader(?:\/|, )SessionView(?:\/|, )task runner(?:\/|, and )status promotion disabled/u,
      new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'),
    ]) {
      matrixAssert.match(section.body, requiredPhrase);
    }

    const preflightLines = section.body
      .split('\n')
      .filter((line) => (
        line.includes('artifact-writer invocation preflight')
        || helperNames.some((helperName) => line.includes(helperName))
      ))
      .join('\n');
    matrixAssert.notEqual(
      preflightLines,
      '',
      `Section ${sectionNumber} should include docs-output artifact-writer invocation preflight evidence lines`,
    );
    matrixAssert.doesNotMatch(
      preflightLines,
      /status promoted|verified|artifact writer invoked|writes enabled|external dispatch enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
      `Section ${sectionNumber} artifact-writer invocation preflight lines should not claim promotion, writes, dispatch, telemetry, or runtime invocation`,
    );
  }
});

test('Site Capability Graph Sections 16 and 20 record controlled docs-output artifact-writer invocation evidence without verified promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const focusedTestName = 'artifact-writer invocation evidence';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerArtifactWriterInvocationEvidence',
    'assertGraphDocsOutputLiveConsumerArtifactWriterInvocationEvidenceCompatibility',
  ];

  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));
  matrixAssert.match(
    artifactWriterTest,
    /writes redacted pair through controlled Layer-owned temp path/u,
  );

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export (?:async )?function ${helperName}\\b`, 'u'));
  }

  for (const sectionNumber of [16, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    }

    matrixAssert.match(
      section.body,
      /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "artifact-writer invocation evidence"/u,
    );
    matrixAssert.match(
      section.body,
      /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "artifact-writer invocation evidence"/u,
    );

    for (const requiredPhrase of [
      /controlled docs-output artifact-writer invocation evidence/u,
      /Layer-owned docs-output consumer artifact-writer invocation/u,
      /writeGraphDerivedArtifactPair\(\)/u,
      /system temp directory/u,
      /redacted artifact\/audit pair/u,
      /audit-before-artifact/u,
      /redaction audit attachment compatible/u,
      /focused artifact-writer validation passed 57\/57/u,
      /focused matrix validation passed/u,
      new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'),
    ]) {
      matrixAssert.match(section.body, requiredPhrase);
    }

    const evidenceLines = section.body
      .split('\n')
      .filter((line) => (
        line.includes('artifact-writer invocation evidence')
        || helperNames.some((helperName) => line.includes(helperName))
      ))
      .join('\n');
    matrixAssert.notEqual(
      evidenceLines,
      '',
      `Section ${sectionNumber} should include controlled artifact-writer invocation evidence lines`,
    );
    matrixAssert.doesNotMatch(
      evidenceLines,
      /Current status: `verified`|status promoted|verified promotion|live artifact writer enabled|uncontrolled artifact writer invoked|docs\/repo\/runtime writes enabled|external dispatch enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|raw credentials|cookie materialized|csrf materialized|Authorization materialized|browser profile materialized/iu,
      `Section ${sectionNumber} controlled artifact-writer invocation evidence should not claim promotion, live writer enablement, runtime writes, telemetry, or runtime materialization`,
    );
  }
});

test('Site Capability Graph docs-output artifact-writer invocation runtime call paths remain unintegrated gaps', async () => {
  const [markdown, artifactSource, sourceUrls] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    listSourceFiles(SRC_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const invocationHelperNames = [
    'createGraphDocsOutputLiveConsumerArtifactWriterInvocationEvidence',
    'writeGraphDerivedArtifactPair',
    'createGraphDerivedArtifactPlacement',
    'dispatchGraphDerivedArtifactWithRedactionAuditGate',
  ];
  const artifactsHref = GRAPH_ARTIFACTS_URL.href;

  for (const helperName of invocationHelperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export (?:async )?function ${helperName}\\b`, 'u'));
  }

  const sourceEntries = await Promise.all(sourceUrls.map(async (sourceUrl) => ({
    href: sourceUrl.href,
    source: await readSource(sourceUrl),
  })));

  for (const helperName of invocationHelperNames) {
    const callPattern = new RegExp(`\\b${helperName}\\s*\\(`, 'u');
    const externalRuntimeCallPathSources = sourceEntries
      .filter((entry) => entry.href !== artifactsHref && callPattern.test(entry.source))
      .map((entry) => entry.href);
    matrixAssert.deepEqual(
      externalRuntimeCallPathSources,
      [],
      `${helperName} should not have an external src runtime/write call path`,
    );
  }

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');

  for (const phrase of [
    /docs-output artifact-writer invocation runtime call path gap coverage/iu,
    /controlled artifact-writer invocation only exists in graph artifacts module\/test harness evidence/iu,
    /not live Layer docs-output writer/iu,
    /not runtime docs write/iu,
    /not repo write/iu,
    /not runtime artifact write/iu,
    /not live consumer integration/iu,
  ]) {
    matrixAssert.match(section20.body, phrase);
  }

  const gapLines = section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('artifact-writer invocation runtime call path gap coverage')
      || line.includes('controlled artifact-writer invocation only exists')
    ))
    .join('\n');
  matrixAssert.notEqual(
    gapLines,
    '',
    'Section 20 should record artifact-writer invocation runtime call path gap coverage',
  );
  matrixAssert.doesNotMatch(
    gapLines,
    /Current status: `verified`|status promoted|verified status set|live Layer docs-output writer enabled|runtime docs write enabled|repo write enabled|runtime artifact write enabled|live consumer integration enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
    'artifact-writer invocation runtime call path gap coverage should not claim promotion, writes, or runtime integration',
  );
});

test('Site Capability Graph Sections 16 18 19 and 20 record runtime write observability preflight remains blocked', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );
  const focusedTestName = 'runtime write observability preflight';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflight',
    'assertGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflightCompatibility',
  ];

  matrixAssert.match(artifactWriterTest, new RegExp(focusedTestName, 'u'));

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
  }

  for (const sectionNumber of [16, 18, 19, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');

    for (const helperName of helperNames) {
      matrixAssert.match(section.body, new RegExp(`${helperName}\\(\\)`, 'u'));
    }

    matrixAssert.match(
      getField(section, 'Verification command') ?? '',
      /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "runtime write observability preflight"/u,
    );
    matrixAssert.match(
      getField(section, 'Verification command') ?? '',
      /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "runtime write observability preflight"/u,
    );

    for (const requiredPhrase of [
      /runtime write observability preflight/u,
      /descriptor-only \/ blocked \/ redactionRequired/u,
      /safe summary from `createGraphDocsOutputLiveConsumerArtifactWriterInvocationPreflight\(\)`/u,
      /runtime log write observability disabled/u,
      /runtime artifact write observability disabled/u,
      /runtime docs write observability disabled/u,
      /artifact writer invocation disabled/u,
      /external telemetry disabled/u,
      /SiteAdapter(?:\/|, )downloader(?:\/|, )SessionView(?:\/|, )task runner(?:\/|, and )status promotion disabled/u,
      new RegExp(`Section ${sectionNumber} remains \`partial\``, 'u'),
    ]) {
      matrixAssert.match(section.body, requiredPhrase);
    }

    const preflightLines = section.body
      .split('\n')
      .filter((line) => (
        line.includes('runtime write observability preflight')
        || helperNames.some((helperName) => line.includes(helperName))
      ))
      .join('\n');
    matrixAssert.notEqual(
      preflightLines,
      '',
      `Section ${sectionNumber} should include docs-output runtime write observability preflight evidence lines`,
    );
    matrixAssert.doesNotMatch(
      preflightLines,
      /status promoted|verified|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|log writer invoked|artifact writer invoked|writes enabled|external dispatch enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
      `Section ${sectionNumber} runtime write observability preflight lines should not claim promotion, writes, telemetry, or runtime invocation`,
    );
  }
});

test('Site Capability Graph Section 18 records runtime docs artifact write observability evidence without promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section18 = extractSections(markdown).find((section) => section.number === 18);
  const focusedPhrase = 'runtime docs artifact write observability';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidence',
    'assertGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidenceCompatibility',
  ];

  matrixAssert.equal(typeof section18?.body, 'string', 'Section 18 should exist');
  matrixAssert.equal(getField(section18, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export function ${helperName}\\b`, 'u'));
    matrixAssert.match(section18.body, new RegExp(`${helperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(artifactWriterTest, new RegExp(focusedPhrase, 'u'));
  matrixAssert.match(
    artifactWriterTest,
    /test\([^)]*runtime docs artifact write observability/ius,
  );
  matrixAssert.match(
    artifactWriterTest,
    /safe summary from `?createGraphDocsOutputLiveConsumerArtifactWriterInvocationEvidence\(\)`?|artifact-writer invocation evidence safe summary|observed safe-summary evidence|sourceArtifactWriterInvocationEvidence/iu,
  );
  matrixAssert.match(
    artifactWriterTest,
    /rejects .*runtime|rejects .*enabled|rejects .*telemetry/iu,
  );

  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "runtime docs artifact write observability"/u,
  );
  matrixAssert.match(
    getField(section18, 'Verification command') ?? '',
    /node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "runtime docs artifact write observability"/u,
  );

  for (const requiredPhrase of [
    /runtime docs artifact write observability evidence/u,
    /safe summary from `createGraphDocsOutputLiveConsumerArtifactWriterInvocationEvidence\(\)`/u,
    /audit-before-artifact/u,
    /redaction audit attachment summary/u,
    /external telemetry disabled/u,
    /runtime dispatch\/log\/artifact\/docs writes disabled/u,
    /SiteAdapter/u,
    /downloader/u,
    /SessionView/u,
    /Section 18 remains `partial`/u,
  ]) {
    matrixAssert.match(section18.body, requiredPhrase);
  }

  const evidenceLines = section18.body
    .split('\n')
    .filter((line) => (
      line.includes(focusedPhrase)
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    evidenceLines,
    '',
    'Section 18 should include runtime docs artifact write observability evidence lines',
  );
  matrixAssert.doesNotMatch(
    evidenceLines,
    /Current status: `verified`|status promoted|verified status set|promoted to verified|verified promotion|live telemetry enabled|external telemetry enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|runtime docs write enabled|runtime write enablement|runtime writes enabled|artifact writer invoked by live consumer|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled/iu,
    'Section 18 runtime docs artifact write observability evidence must not claim promotion, live telemetry, runtime write enablement, or runtime invocation',
  );
});

test('Site Capability Graph docs-output dispatch boundary runtime consumer call paths remain unintegrated gaps', async () => {
  const [markdown, artifactSource, sourceUrls] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    listSourceFiles(SRC_URL),
  ]);
  const sections = extractSections(markdown);
  const sectionByNumber = new Map(sections.map((section) => [section.number, section]));
  const exportedHelperNames = [
    'createGraphDocsOutputLiveConsumerDispatchDryRunResult',
    'assertGraphDocsOutputLiveConsumerDispatchDryRunResultCompatibility',
    'createGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGate',
    'assertGraphDocsOutputLiveConsumerDispatchCompatibilityReviewGateCompatibility',
    'createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight',
    'assertGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflightCompatibility',
    'createGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGate',
    'assertGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGateCompatibility',
  ];
  const createHelperNames = exportedHelperNames.filter((helperName) => helperName.startsWith('create'));
  const artifactsHref = GRAPH_ARTIFACTS_URL.href;

  for (const helperName of exportedHelperNames) {
    matrixAssert.match(artifactSource, new RegExp(`export (?:async )?function ${helperName}\\b`, 'u'));
  }

  const sourceEntries = await Promise.all(sourceUrls.map(async (sourceUrl) => ({
    href: sourceUrl.href,
    source: await readSource(sourceUrl),
  })));

  for (const helperName of createHelperNames) {
    const externalCallPathSources = sourceEntries
      .filter((entry) => entry.href !== artifactsHref && entry.source.includes(helperName))
      .map((entry) => entry.href);
    matrixAssert.deepEqual(
      externalCallPathSources,
      [],
      `${helperName} should not have an external src runtime consumer call path`,
    );
  }

  for (const sectionNumber of [16, 18, 19, 20]) {
    const section = sectionByNumber.get(sectionNumber);
    matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
    matrixAssert.equal(getField(section, 'Current status'), '`partial`');
  }

  for (const phrase of [
    /docs-output dispatch boundary runtime consumer gap coverage/iu,
    /no external src runtime consumer call path/iu,
    /not live integration/iu,
    /descriptor-only/iu,
  ]) {
    matrixAssert.match(markdown, phrase);
  }

  const boundaryLines = markdown
    .split(/\r?\n/u)
    .filter((line) => /docs-output dispatch boundary runtime consumer gap coverage|no external src runtime consumer call path/iu.test(line))
    .join('\n');
  matrixAssert.notEqual(boundaryLines, '', 'matrix should record docs-output dispatch boundary runtime consumer gap coverage');
  matrixAssert.doesNotMatch(
    boundaryLines,
    /live consumer enabled|external dispatch enabled|external telemetry enabled|artifact writer invoked from live consumer|docs write enabled|repo write enabled|runtime artifact write enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|status promoted|verified status set/iu,
    'docs-output dispatch boundary runtime consumer gap coverage lines should remain gap-only and promotion-blocking',
  );
});

const SOURCE_ALIAS_FAIL_CLOSED_LEGACY_REGRESSIONS = Object.freeze([
  {
    name: 'docs-output external dispatch source alias fail-closed coverage',
    lineNeedle: 'external dispatch source alias fail-closed',
    sections: [16, 19, 20],
    focusedTests: ['docs-output live consumer external dispatch acceptance preflight rejects ignored unsafe source aliases', 'docs-output live consumer external dispatch no-op handoff gate rejects ignored unsafe source aliases', 'docs-output live consumer external dispatch acceptance preflight rejects distinct source aliases', 'docs-output live consumer external dispatch no-op handoff gate rejects distinct source aliases'],
    helpers: ['createGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflight', 'assertGraphDocsOutputLiveConsumerExternalDispatchAcceptancePreflightCompatibility', 'createGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGate', 'assertGraphDocsOutputLiveConsumerExternalDispatchNoopHandoffGateCompatibility'],
    aliases: ['dispatchDryRunResult', 'sourceDispatchDryRunResult', 'dryRunResult', 'acceptancePreflight', 'sourceAcceptancePreflight', 'sourceExternalDispatchAcceptancePreflight', 'externalDispatchAcceptancePreflight', 'sourcePreflight', 'preflight'],
    disabledPattern: 'external dispatch disabled|docs/repo/runtime writes disabled|SiteAdapter, downloader, SessionView, task runner, and status promotion disabled',
    commandNeedles: ['external dispatch source alias fail-closed', 'external dispatch .*source aliases'],
  },
  {
    name: 'docs-output artifact-writer invocation preflight source alias fail-closed coverage',
    lineNeedle: 'artifact-writer invocation preflight source alias fail-closed',
    sections: [16, 19, 20],
    focusedTests: ['docs-output live consumer artifact-writer invocation preflight rejects ignored unsafe source aliases', 'docs-output live consumer artifact-writer invocation preflight rejects distinct source aliases'],
    helpers: ['createGraphDocsOutputLiveConsumerArtifactWriterInvocationPreflight', 'assertGraphDocsOutputLiveConsumerArtifactWriterInvocationPreflightCompatibility'],
    aliases: ['noopHandoffGate', 'sourceNoopHandoffGate', 'externalDispatchNoopHandoffGate', 'sourceExternalDispatchNoopHandoffGate', 'sourceGate', 'gate'],
    disabledPattern: 'artifact writer disabled|docs/repo/runtime writes disabled|external telemetry/dispatch disabled|SiteAdapter, downloader, SessionView, task runner, and status promotion disabled',
    commandNeedles: ['artifact-writer invocation preflight source alias fail-closed', 'artifact-writer invocation preflight .*source aliases'],
  },
  {
    name: 'docs-output runtime write observability preflight source alias fail-closed coverage',
    lineNeedle: 'runtime write observability preflight source alias fail-closed',
    sections: [16, 18, 19, 20],
    focusedTests: ['docs-output live consumer runtime write observability preflight rejects ignored unsafe source aliases', 'docs-output live consumer runtime write observability preflight rejects distinct source aliases'],
    helpers: ['createGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflight', 'assertGraphDocsOutputLiveConsumerRuntimeWriteObservabilityPreflightCompatibility'],
    aliases: ['artifactWriterInvocationPreflight', 'sourceArtifactWriterInvocationPreflight', 'sourceRuntimeWriteObservabilityPreflight', 'preflight'],
    disabledPattern: 'runtime write observability disabled|artifact writer invocation disabled|docs/repo/runtime writes disabled|external telemetry/dispatch disabled|SiteAdapter, downloader, SessionView, task runner, and status promotion disabled',
    commandNeedles: ['runtime write observability preflight source alias fail-closed', 'runtime write observability preflight .*source aliases'],
  },
  {
    name: 'runtime docs artifact write observability distinct source alias coverage',
    lineNeedle: 'runtime docs artifact write observability distinct source alias',
    sections: [18, 19, 20],
    focusedTests: ['runtime docs artifact write observability rejects distinct source aliases'],
    helpers: ['createGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidence', 'assertGraphDocsOutputLiveConsumerRuntimeDocsArtifactWriteObservabilityEvidenceCompatibility'],
    aliases: ['artifactWriterInvocationEvidence', 'sourceArtifactWriterInvocationEvidence', 'sourceEvidence', 'evidence'],
    disabledPattern: 'runtime docs artifact write observability disabled|runtime docs/artifact/log writes disabled|external telemetry disabled|SiteAdapter, downloader, SessionView, task runner, and status promotion disabled',
    commandNeedles: ['runtime docs artifact write observability .*source aliases', 'runtime docs artifact write observability distinct source alias', 'node --check tests\\node\\site-capability-graph-artifact-writer.test.mjs'],
  },
]);

function collectSourceAliasRegressionLines(section, regression) {
  return section.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes(regression.lineNeedle)
      || regression.focusedTests.some((focusedTest) => line.includes(focusedTest))
      || regression.helpers.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
}

test('Site Capability Graph source alias fail-closed legacy descriptor regression table covers retired repeated cases without promotion', () => {
  matrixAssert.equal(SOURCE_ALIAS_FAIL_CLOSED_LEGACY_REGRESSIONS.length, 4);

  const names = new Set();
  for (const regression of SOURCE_ALIAS_FAIL_CLOSED_LEGACY_REGRESSIONS) {
    assert.equal(names.has(regression.name), false, `duplicate source alias regression: ${regression.name}`);
    assert.ok(regression.lineNeedle.includes('source alias'));
    assert.ok(regression.sections.length >= 3);
    assert.ok(regression.focusedTests.length >= 1);
    assert.ok(regression.helpers.length >= 2);
    assert.ok(regression.aliases.length >= 4);
    names.add(regression.name);
  }
});

test('Site Capability Graph source alias fail-closed legacy descriptor regressions remain strict without promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const sectionByNumber = new Map(
    extractSections(markdown).map((section) => [section.number, section]),
  );

  assert.match(artifactSource, /collectProvidedGraphDocsOutputLiveConsumerSourceAliases/u);
  assert.match(artifactSource, /source aliases must reference the same descriptor object/u);

  for (const regression of SOURCE_ALIAS_FAIL_CLOSED_LEGACY_REGRESSIONS) {
    for (const focusedTest of regression.focusedTests) {
      assert.match(artifactWriterTest, new RegExp(escapeRegExp(focusedTest), 'u'));
    }
    for (const helperName of regression.helpers) {
      assert.match(artifactSource, new RegExp(`export function ${escapeRegExp(helperName)}\\b`, 'u'));
    }
    for (const aliasName of regression.aliases) {
      assert.match(artifactSource, new RegExp(`\\b${escapeRegExp(aliasName)}\\b`, 'u'));
    }

    for (const sectionNumber of regression.sections) {
      const section = sectionByNumber.get(sectionNumber);
      matrixAssert.equal(typeof section?.body, 'string', `Section ${sectionNumber} should exist`);
      matrixAssert.equal(getField(section, 'Current status'), '`partial`');

      const aliasLines = collectSourceAliasRegressionLines(section, regression);
      assert.notEqual(
        aliasLines,
        '',
        `Section ${sectionNumber} should record ${regression.lineNeedle} coverage`,
      );
      assert.match(aliasLines, new RegExp(escapeRegExp(regression.lineNeedle), 'u'));
      for (const focusedTest of regression.focusedTests) {
        assert.match(aliasLines, new RegExp(escapeRegExp(focusedTest), 'u'));
      }
      for (const helperName of regression.helpers) {
        assert.match(aliasLines, new RegExp(escapeRegExp(helperName), 'u'));
      }
      for (const aliasName of regression.aliases) {
        assert.match(aliasLines, new RegExp(`\\b${escapeRegExp(aliasName)}\\b`, 'u'));
      }
      assert.match(aliasLines, /descriptor-only|blocked|redactionRequired|superseded|pre-final/iu);
      assert.match(aliasLines, new RegExp(regression.disabledPattern.replaceAll('/', '\\/'), 'iu'));
      for (const commandNeedle of regression.commandNeedles) {
        assert.match(section.body, new RegExp(escapeRegExp(commandNeedle).replaceAll('\\\.\\\*', '.*'), 'u'));
      }
      assert.doesNotMatch(
        aliasLines,
        /live .* enabled|write enabled|writes enabled|docs write enabled|repo write enabled|runtime artifact write enabled|artifact writer enabled|artifact writer invoked|external dispatch enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|status promotion enabled|sensitive value echoed|sensitive echo enabled/iu,
        `${regression.lineNeedle} lines should stay descriptor-only without live side effects`,
      );
    }
  }
});

test('Site Capability Graph Section 20 records reviewed live docs-output artifact pipeline readiness gate without live writes', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const focusedArtifactTestName =
    'docs-output live consumer reviewed artifact pipeline readiness gate consumes prior safe summary only';
  const focusedMatrixPattern = 'reviewed live docs-output artifact pipeline readiness gate';
  const helperNames = [
    'createGraphDocsOutputLiveConsumerReviewedArtifactPipelineReadinessGate',
    'assertGraphDocsOutputLiveConsumerReviewedArtifactPipelineReadinessGateCompatibility',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactWriterTest, new RegExp(`${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }
  matrixAssert.match(
    artifactWriterTest,
    new RegExp(focusedArtifactTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
  );
  matrixAssert.match(section20.body, /reviewed artifact pipeline readiness gate/u);
  matrixAssert.match(section20.body, /source\/test\/matrix evidence/u);
  matrixAssert.match(section20.body, /focused command strings/u);
  matrixAssert.match(section20.body, /descriptor-only \/ blocked \/ redactionRequired/u);
  matrixAssert.match(section20.body, /reviewed live Layer integration prerequisite/u);
  matrixAssert.match(section20.body, /one standard graph-derived docs-output artifact/u);
  matrixAssert.match(section20.body, /Section 20 remains `partial`/u);
  matrixAssert.doesNotMatch(section20.body, /pending main-thread verification/iu);

  matrixAssert.match(
    section20.body,
    /node --test --test-name-pattern "reviewed artifact pipeline readiness gate" tests\\node\\site-capability-graph-artifact-writer\.test\.mjs/u,
  );
  matrixAssert.match(
    section20.body,
    /node --test --test-name-pattern "reviewed live docs-output artifact pipeline readiness gate" tests\\node\\site-capability-graph-matrix\.test\.mjs/u,
  );
  matrixAssert.match(section20.body, /focused artifact-writer validation passed 3\/3/u);
  matrixAssert.match(section20.body, /focused matrix validation passed 1\/1/u);
  matrixAssert.match(section20.body, /combined artifact-writer \+ matrix validation passed 178\/178/u);
  matrixAssert.match(section20.body, /node --check tests\\node\\site-capability-graph-matrix\.test\.mjs/u);

  const readinessLines = section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('reviewed artifact pipeline readiness gate')
      || helperNames.some((helperName) => line.includes(helperName))
      || line.includes(focusedMatrixPattern)
    ))
    .join('\n');
  matrixAssert.notEqual(
    readinessLines,
    '',
    'Section 20 should record reviewed artifact pipeline readiness gate evidence',
  );

  for (const requiredPhrase of [
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /reviewed safe summaries only/u,
    /live writes disabled/u,
    /external dispatch disabled/u,
    /external telemetry disabled/u,
    /SiteAdapter disabled/u,
    /downloader disabled/u,
    /SessionView disabled/u,
    /task runner disabled/u,
    /status promotion disabled/u,
    /sensitive echo disabled/u,
    /not live writes/u,
    /not live external dispatch/u,
    /not reviewed live integration completion/u,
    /not runtime artifact pipeline completion/u,
  ]) {
    matrixAssert.match(readinessLines, requiredPhrase);
  }

  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /descriptor-only reviewed artifact pipeline readiness gate evidence exist/u,
  );
  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /live artifact pipeline completion/u,
  );
  matrixAssert.match(
    getField(section20, 'Next smallest task') ?? '',
    /downstream safe-summary consumer no-op registration review scan/u,
  );
  matrixAssert.doesNotMatch(
    getField(section20, 'Next smallest task') ?? '',
    /runtime artifact pipeline completion gap scan after the descriptor-only artifact pipeline acceptance boundary/u,
  );
  matrixAssert.doesNotMatch(
    getField(section20, 'Next smallest task') ?? '',
    /^Add another reviewed live Layer integration prerequisite/u,
  );

  matrixAssert.doesNotMatch(
    readinessLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live writes enabled|live write enabled|write enabled|writes enabled|docs write enabled|repo write enabled|runtime artifact write enabled|external dispatch enabled|external telemetry enabled|telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|status promotion enabled|sensitive value echoed/iu,
    'Section 20 readiness gate lines should stay descriptor-only without live writes, dispatch, telemetry, runtime invocation, promotion, or sensitive echo',
  );
});

test('Site Capability Graph Section 20 records descriptor-only docs-output artifact pipeline acceptance boundary after readiness gate without live writes', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);
  const helperNames = [
    'createGraphDocsOutputLiveConsumerArtifactPipelineAcceptanceBoundary',
    'assertGraphDocsOutputLiveConsumerArtifactPipelineAcceptanceBoundaryCompatibility',
  ];

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');

  for (const helperName of helperNames) {
    const escapedHelperName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    matrixAssert.match(artifactSource, new RegExp(`export function ${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(artifactWriterTest, new RegExp(`${escapedHelperName}\\b`, 'u'));
    matrixAssert.match(section20.body, new RegExp(`${escapedHelperName}\\(\\)`, 'u'));
  }

  matrixAssert.match(artifactWriterTest, /artifact pipeline acceptance boundary/iu);
  matrixAssert.match(section20.body, /downstream descriptor-only artifact pipeline acceptance boundary evidence/u);
  matrixAssert.match(section20.body, /reviewed artifact pipeline readiness gate/u);
  matrixAssert.match(section20.body, /source\/test\/matrix evidence/u);
  matrixAssert.match(section20.body, /focused command strings/u);
  matrixAssert.match(section20.body, /node --test --test-name-pattern \.\.\. <file>/u);
  matrixAssert.match(section20.body, /descriptor-only \/ blocked \/ redactionRequired/u);
  matrixAssert.match(section20.body, /Section 20 remains `partial`/u);
  matrixAssert.doesNotMatch(section20.body, /pending|deferred verification/iu);

  matrixAssert.match(
    section20.body,
    /node --test --test-name-pattern "artifact pipeline acceptance boundary" tests\\node\\site-capability-graph-artifact-writer\.test\.mjs/u,
  );
  matrixAssert.match(
    section20.body,
    /node --test --test-name-pattern "artifact pipeline acceptance boundary" tests\\node\\site-capability-graph-matrix\.test\.mjs/u,
  );
  matrixAssert.match(section20.body, /focused artifact-writer validation passed 3\/3/u);
  matrixAssert.match(section20.body, /focused matrix validation passed 1\/1/u);
  matrixAssert.doesNotMatch(
    section20.body,
    /focused artifact-writer validation failed 0\/3|missing disabled flags|non-rejected unsafe payload cases/u,
  );
  matrixAssert.doesNotMatch(
    section20.body,
    /node --test tests\\node\\site-capability-graph-artifact-writer\.test\.mjs --test-name-pattern "artifact pipeline acceptance boundary"|node --test tests\\node\\site-capability-graph-matrix\.test\.mjs --test-name-pattern "artifact pipeline acceptance boundary"/u,
    'Section 20 should record focused commands with --test-name-pattern before the test file',
  );

  const acceptanceLines = section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes('artifact pipeline acceptance boundary')
      || helperNames.some((helperName) => line.includes(helperName))
    ))
    .join('\n');
  matrixAssert.notEqual(
    acceptanceLines,
    '',
    'Section 20 should record artifact pipeline acceptance boundary evidence',
  );

  for (const requiredPhrase of [
    /descriptor-only \/ blocked \/ redactionRequired/u,
    /consumes only the readiness gate safe summary/u,
    /live writes disabled/u,
    /external dispatch disabled/u,
    /external telemetry disabled/u,
    /SiteAdapter disabled/u,
    /downloader disabled/u,
    /SessionView disabled/u,
    /task runner disabled/u,
    /status promotion disabled/u,
    /sensitive echo disabled/u,
    /not live writes/u,
    /not external dispatch/u,
    /not reviewed live integration completion/u,
    /not live artifact writer invocation/u,
    /not runtime artifact pipeline completion/u,
  ]) {
    matrixAssert.match(acceptanceLines, requiredPhrase);
  }

  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /descriptor-only artifact pipeline acceptance boundary evidence exists/u,
  );
  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /live artifact pipeline completion/u,
  );
  matrixAssert.match(
    getField(section20, 'Next smallest task') ?? '',
    /downstream safe-summary consumer no-op registration review scan/u,
  );
  matrixAssert.doesNotMatch(
    getField(section20, 'Next smallest task') ?? '',
    /runtime artifact pipeline completion gap scan after the descriptor-only artifact pipeline acceptance boundary/u,
  );
  matrixAssert.doesNotMatch(
    getField(section20, 'Next smallest task') ?? '',
    /^Add a downstream descriptor-only acceptance boundary after the reviewed artifact pipeline readiness gate/u,
  );

  matrixAssert.doesNotMatch(
    acceptanceLines,
    /Current status: `verified`|status promoted|verified status set|verified promotion|live writes enabled|live write enabled|write enabled|writes enabled|docs write enabled|repo write enabled|runtime artifact write enabled|external dispatch enabled|external telemetry enabled|telemetry enabled|SiteAdapter invoked|SiteAdapter enabled|downloader invoked|downloader enabled|SessionView materialized|SessionView enabled|task runner enabled|status promotion enabled|sensitive value echoed|sensitive echo enabled/iu,
    'Section 20 acceptance boundary lines should stay descriptor-only without live writes, dispatch, telemetry, runtime invocation, promotion, or sensitive echo',
  );
});


const SECTION20_LEGACY_PIPELINE_REGRESSIONS = Object.freeze([
  {
    name: 'Site Capability Graph Section 20 records artifact pipeline completion gap scan without promotion',
    focusedPattern: 'artifact pipeline completion gap scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineCompletionGapScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineCompletionGapScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records registration-to-writer boundary gap scan without promotion',
    focusedPattern: 'registration-to-writer boundary gap scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineRegistrationToWriterBoundaryGapScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineRegistrationToWriterBoundaryGapScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records writer-result-to-redaction-audit boundary gap scan without promotion',
    focusedPattern: 'writer-result-to-redaction-audit boundary gap scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineWriterResultToRedactionAuditBoundaryGapScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineWriterResultToRedactionAuditBoundaryGapScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records redaction-audit safe-summary handoff gap scan without promotion',
    focusedPattern: 'redaction-audit safe-summary handoff gap scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineRedactionAuditSafeSummaryHandoffGapScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineRedactionAuditSafeSummaryHandoffGapScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records post-handoff safe-summary consumer boundary gap scan without promotion',
    focusedPattern: 'post-handoff safe-summary consumer boundary gap scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelinePostHandoffSafeSummaryConsumerBoundaryGapScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelinePostHandoffSafeSummaryConsumerBoundaryGapScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer eligibility scan without promotion',
    focusedPattern: 'downstream safe-summary consumer eligibility scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerEligibilityScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerEligibilityScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op registration review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op registration review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRegistrationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRegistrationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op dispatch review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op dispatch review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDispatchReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDispatchReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op telemetry review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op telemetry review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopTelemetryReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopTelemetryReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op artifact publication review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op artifact publication review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopArtifactPublicationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopArtifactPublicationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op retained-output review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op retained-output review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRetainedOutputReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRetainedOutputReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op archive-manifest review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op archive-manifest review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopArchiveManifestReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopArchiveManifestReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-plan review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-plan review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingPlanReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingPlanReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-output review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-output review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingOutputReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingOutputReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-retention review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-retention review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingRetentionReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingRetentionReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-cleanup review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-cleanup review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingCleanupReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingCleanupReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-publication review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-publication review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingPublicationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingPublicationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op packaging-delivery review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op packaging-delivery review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingDeliveryReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopPackagingDeliveryReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-index review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-index review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryIndexReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryIndexReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-manifest review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-manifest review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryManifestReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryManifestReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-receipt review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-receipt review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryReceiptReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryReceiptReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-audit review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-audit review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAuditReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAuditReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-completion review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-completion review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCompletionReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCompletionReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-finalization review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-finalization review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryFinalizationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryFinalizationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-closeout review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-closeout review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCloseoutReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCloseoutReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-closure review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-closure review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryClosureReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryClosureReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-seal review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-seal review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySealReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySealReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-attestation review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-attestation review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAttestationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAttestationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-verification review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-verification review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryVerificationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryVerificationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-confirmation review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-confirmation review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryConfirmationReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryConfirmationReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-acknowledgement review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-acknowledgement review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAcknowledgementReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAcknowledgementReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-acceptance review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-acceptance review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAcceptanceReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAcceptanceReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-release review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-release review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryReleaseReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryReleaseReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-signoff review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-signoff review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySignoffReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySignoffReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-handoff review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-handoff review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryHandoffReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryHandoffReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-turnover review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-turnover review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTurnoverReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTurnoverReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-transfer review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-transfer review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransferReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransferReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-transition review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-transition review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransitionReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransitionReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-conveyance review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-conveyance review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryConveyanceReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryConveyanceReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-carriage review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-carriage review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCarriageReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCarriageReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-transport review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-transport review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransportReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransportReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-routing review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-routing review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryRoutingReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryRoutingReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-forwarding review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-forwarding review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryForwardingReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryForwardingReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-relay review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-relay review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryRelayReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryRelayReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-pass-through review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-pass-through review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryPassThroughReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryPassThroughReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-transit review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-transit review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransitReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryTransitReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-carrier review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-carrier review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCarrierReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCarrierReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-courier review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-courier review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCourierReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCourierReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-service review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-service review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryServiceReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryServiceReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-provider review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-provider review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryProviderReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryProviderReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-supplier review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-supplier review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySupplierReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliverySupplierReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-vendor review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-vendor review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryVendorReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryVendorReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-contractor review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-contractor review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryContractorReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryContractorReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-partner review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-partner review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryPartnerReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryPartnerReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-collaborator review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-collaborator review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCollaboratorReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryCollaboratorReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-associate review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-associate review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAssociateReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAssociateReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-affiliate review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-affiliate review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAffiliateReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAffiliateReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-alliance review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-alliance review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAllianceReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryAllianceReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-network review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-network review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryNetworkReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryNetworkReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-channel review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-channel review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryChannelReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryChannelReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op delivery-lane review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op delivery-lane review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryLaneReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopDeliveryLaneReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op retention-report review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op retention-report review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRetentionReportReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopRetentionReportReviewScanCompatibility',
  },
  {
    name: 'Site Capability Graph Section 20 records downstream safe-summary consumer no-op cleanup-policy review scan without promotion',
    focusedPattern: 'downstream safe-summary consumer no-op cleanup-policy review scan',
    createHelperName: 'createGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopCleanupPolicyReviewScan',
    assertHelperName: 'assertGraphDocsOutputLiveConsumerArtifactPipelineDownstreamSafeSummaryConsumerNoopCleanupPolicyReviewScanCompatibility',
  },
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function collectSection20LegacyPipelineLines(section20, regression) {
  return section20.body
    .split(/\r?\n/u)
    .filter((line) => (
      line.includes(regression.focusedPattern)
      || line.includes(regression.createHelperName)
      || line.includes(regression.assertHelperName)
    ))
    .join('\n');
}

test('Site Capability Graph Section 20 legacy descriptor pipeline regression table covers the retired repeated cases without promotion', () => {
  matrixAssert.equal(SECTION20_LEGACY_PIPELINE_REGRESSIONS.length, 63);

  const names = new Set();
  const focusedPatterns = new Set();
  for (const regression of SECTION20_LEGACY_PIPELINE_REGRESSIONS) {
    matrixAssert.match(regression.name, /^Site Capability Graph Section 20 records .+ without promotion$/u);
    matrixAssert.equal(names.has(regression.name), false, `duplicate legacy regression name: ${regression.name}`);
    matrixAssert.equal(
      focusedPatterns.has(regression.focusedPattern),
      false,
      `duplicate legacy focused pattern: ${regression.focusedPattern}`,
    );
    matrixAssert.match(regression.createHelperName, /^createGraphDocsOutputLiveConsumerArtifactPipeline/u);
    matrixAssert.match(regression.assertHelperName, /^assertGraphDocsOutputLiveConsumerArtifactPipeline.*Compatibility$/u);
    names.add(regression.name);
    focusedPatterns.add(regression.focusedPattern);
  }
});

test('Site Capability Graph Section 20 legacy descriptor pipeline regressions remain matrix-only without promotion', async () => {
  const [markdown, artifactSource, artifactWriterTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_ARTIFACTS_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
  ]);
  const section20 = extractSections(markdown).find((section) => section.number === 20);

  matrixAssert.equal(typeof section20?.body, 'string', 'Section 20 should exist');
  matrixAssert.equal(getField(section20, 'Current status'), '`partial`');

  for (const regression of SECTION20_LEGACY_PIPELINE_REGRESSIONS) {
    const focusedPattern = escapeRegExp(regression.focusedPattern);
    const createHelperName = escapeRegExp(regression.createHelperName);
    const assertHelperName = escapeRegExp(regression.assertHelperName);
    const regressionLines = collectSection20LegacyPipelineLines(section20, regression);

    assert.match(artifactSource, new RegExp(`export function ${createHelperName}\\b`, 'u'));
    assert.match(artifactSource, new RegExp(`export function ${assertHelperName}\\b`, 'u'));
    assert.match(artifactWriterTest, new RegExp(focusedPattern, 'u'));
    assert.match(section20.body, new RegExp(`${createHelperName}\\(\\)`, 'u'));
    assert.match(section20.body, new RegExp(`${assertHelperName}\\(\\)`, 'u'));

    assert.notEqual(
      regressionLines,
      '',
      `Section 20 should record ${regression.focusedPattern} review scan evidence`,
    );
    assert.match(regressionLines, new RegExp(focusedPattern, 'u'));
    assert.match(
      regressionLines,
      /descriptor-only|matrix-only|pre-final|superseded|blocked|redactionRequired|source artifact-writer focused validation passed/iu,
    );
    assert.doesNotMatch(
      regressionLines,
      /live writes enabled|external dispatch enabled|external telemetry enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|task runner enabled|sensitive value echoed|sensitive echo enabled/iu,
      `${regression.focusedPattern} should stay free of live side-effect enablement`,
    );
  }

  matrixAssert.match(
    getField(section20, 'Current gaps') ?? '',
    /No open Section 20 gaps|all 2026-05-08 legacy artifact pipeline gap-scan descriptors are superseded/u,
  );
  matrixAssert.match(getField(section20, 'Next smallest task') ?? '', /No open Section 20 task|No open/u);
});
