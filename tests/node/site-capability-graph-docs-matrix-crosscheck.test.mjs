import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  assertGraphDerivedArtifactWriteAllowed,
  assertGraphDocsMarkdownArtifactConsumerCompatibility,
  createGraphDocsMarkdownArtifact,
  generateGraphDocsSummary,
} from '../../src/sites/capability/site-capability-graph.mjs';

const MINIMAL_GRAPH_URL = new URL('./fixtures/site-capability-graph/minimal-v1.json', import.meta.url);
const MATRIX_URL = new URL('../../docs/site-capability-graph/IMPLEMENTATION_MATRIX.md', import.meta.url);
const GRAPH_URL = new URL('../../src/sites/capability/site-capability-graph.mjs', import.meta.url);
const GRAPH_ARTIFACTS_URL = new URL('../../src/sites/capability/site-capability-graph-artifacts.mjs', import.meta.url);
const PLANNER_HANDOFF_URL = new URL('../../src/sites/capability/planner-policy-handoff.mjs', import.meta.url);
const DOCS_GENERATOR_TEST_URL = new URL('./site-capability-graph-docs-generator.test.mjs', import.meta.url);
const MATRIX_TEST_URL = new URL('./site-capability-graph-matrix.test.mjs', import.meta.url);
const ARTIFACT_WRITER_TEST_URL = new URL('./site-capability-graph-artifact-writer.test.mjs', import.meta.url);
const OBSERVABILITY_TEST_URL = new URL('./site-capability-graph-observability.test.mjs', import.meta.url);
const LAYER_DESIGN_URL = new URL('../../docs/site-capability-layer/DESIGN.md', import.meta.url);

async function readMinimalGraphFixture() {
  return JSON.parse(await readFile(MINIMAL_GRAPH_URL, 'utf8'));
}

async function readMatrix() {
  return readFile(MATRIX_URL, 'utf8');
}

async function readSource(url) {
  return readFile(url, 'utf8');
}

function extractNumberedSections(markdown) {
  return [...markdown.matchAll(/^## (\d+)\. .+$/gmu)].map((match) => Number(match[1]));
}

function testEvidencePathsByRef(graph) {
  return new Map(
    graph.nodes
      .filter((node) => node.type === 'TestEvidenceNode')
      .map((node) => [node.id, node.testPath]),
  );
}

test('GraphDocsSummary output remains cross-checkable against the implementation matrix', async () => {
  const graph = await readMinimalGraphFixture();
  const matrix = await readMatrix();
  const summary = generateGraphDocsSummary(graph);
  const testPaths = testEvidencePathsByRef(graph);

  assert.deepEqual(extractNumberedSections(matrix), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(summary.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  assert.equal(summary.sections.capabilityList.length > 0, true);
  assert.equal(summary.sections.dependencyMap.length > 0, true);

  const referencedTestPaths = new Set();
  for (const entry of summary.sections.testCoverageSummary) {
    for (const testRef of entry.testEvidenceRefs) {
      const testPath = testPaths.get(testRef);
      assert.equal(typeof testPath, 'string', `${testRef} should resolve to a TestEvidenceNode path`);
      referencedTestPaths.add(testPath);
    }
  }

  assert.deepEqual([...referencedTestPaths], ['tests/node/site-capability-graph-schema.test.mjs']);
  for (const testPath of referencedTestPaths) {
    assert.match(matrix, new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('GraphDocsSummary matrix cross-check covers disabled runtime consumer descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const [matrix, graphSource, plannerSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(PLANNER_HANDOFF_URL),
  ]);
  const summary = generateGraphDocsSummary(graph);
  const descriptors = [
    {
      name: 'createDisabledGraphPlannerRuntimeConsumerResult',
      source: plannerSource,
      boundary: 'no live Layer planner runtime Graph route handoff execution',
    },
    {
      name: 'createDisabledGraphDocsLifecycleDispatchConsumerResult',
      source: graphSource,
      boundary: 'external telemetry dispatch',
    },
    {
      name: 'createDisabledGraphMigrationReportRuntimeConsumerResult',
      source: graphSource,
      boundary: 'disabled migration report runtime consumer result descriptor',
    },
    {
      name: 'createDisabledGraphInventoryRuntimeConsumerResult',
      source: graphSource,
      boundary: 'runtime generation, repo writes',
    },
    {
      name: 'createDisabledGraphDocsMarkdownRuntimeConsumerResult',
      source: graphSource,
      boundary: 'docs/runtime writes',
    },
  ];

  assert.equal(summary.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  for (const descriptor of descriptors) {
    assert.match(descriptor.source, new RegExp(`export function ${descriptor.name}\\b`, 'u'));
    assert.match(matrix, new RegExp(`${descriptor.name}\\(\\)`, 'u'));
    assert.match(
      matrix,
      new RegExp(descriptor.boundary.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  }

  assert.match(matrix, /descriptor-only/u);
  assert.match(matrix, /dry-run-only/u);
  assert.match(matrix, /disabled\/design-only|disabled-feature-flag/u);
  assert.match(matrix, /without enabling|keeps .*disabled/u);
  assert.match(matrix, /does not claim live Layer planner runtime execution/u);
});

test('GraphDocsSummary matrix cross-check covers repo-output approval gate descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const [matrix, graphSource] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
  ]);
  const summary = generateGraphDocsSummary(graph);

  assert.equal(summary.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  for (const descriptorName of [
    'createGraphRepoOutputApprovalGateDesign',
    'assertGraphRepoOutputApprovalGateDesignCompatibility',
  ]) {
    assert.match(graphSource, new RegExp(`export function ${descriptorName}\\b`, 'u'));
    assert.match(matrix, new RegExp(`${descriptorName}\\(\\)`, 'u'));
  }

  assert.match(matrix, /site-capability-graph-repo-output-approval-gate-design/u);
  assert.match(matrix, /redaction-required design-only future approval gate/u);
  assert.match(matrix, /keeps approval gate enablement, repo writes, runtime writes, publish, external command, session, task, and downloader products disabled/u);
  assert.match(graphSource, /approvalRequiredBeforeRepoWrite: true/u);
  assert.match(matrix, /approvalRequiredBeforeRepoWrite/u);
  for (const evidenceName of [
    'explicit-user-request-in-current-task',
    'matrix-section-updated-with-verification',
    'focused-tests-passed',
    'redaction-guard-passed',
    'repo-target-contained',
    'B-review-accepted',
  ]) {
    assert.match(graphSource, new RegExp(evidenceName, 'u'));
    assert.match(matrix, new RegExp(evidenceName, 'u'));
  }
  assert.match(matrix, /approval gate descriptors/u);
  assert.match(matrix, /repo-output approval gate required approval evidence source\/matrix cross-check/u);
  assert.match(matrix, /keeps approval gate enablement, repo writes, runtime writes, publish, external command, session, task, and downloader products disabled/u);
});

test('GraphDocsSummary matrix cross-check covers live-runtime wording guard evidence', async () => {
  const [matrix, graphSource, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(graphSource, /GRAPH_DOCS_FORBIDDEN_LIVE_RUNTIME_WORDINGS/u);
  assert.match(graphSource, /must not describe Graph docs output as live runtime/u);
  assert.match(docsGeneratorTest, /docs summary rejects live runtime wording/u);
  assert.match(docsGeneratorTest, /assert\.doesNotMatch\(rendered, pattern\)/u);
  for (const wording of [
    'live route execution',
    'live runtime',
    'runtime write enabled',
    'runtime artifact write enabled',
    'repo write enabled',
    'external telemetry enabled',
    'route execution enabled',
  ]) {
    assert.match(graphSource, new RegExp(wording, 'u'));
    assert.match(matrix, new RegExp(wording, 'u'));
  }
  assert.match(matrix, /GraphDocsSummary live-runtime wording guard/u);
  assert.match(matrix, /generated summaries and Markdown/u);
  assert.doesNotMatch(matrix, /live runtime docs producer integration[^.\n]*(?:implemented|verified)/iu);
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary catalogAction descriptors', async () => {
  const graph = await readMinimalGraphFixture();
  const matrix = await readMatrix();
  graph.nodes.push(
    {
      schemaVersion: 1,
      id: 'failure:catalog-action-none',
      type: 'FailureModeNode',
      reasonCode: 'graph-catalog-action-none',
      retryable: false,
      cooldownRequired: false,
      isolationRequired: false,
      manualRecoveryRequired: false,
      degradable: true,
      artifactWriteAllowed: true,
      catalogAction: 'none',
    },
    {
      schemaVersion: 1,
      id: 'failure:catalog-action-deprecate',
      type: 'FailureModeNode',
      reasonCode: 'graph-catalog-action-deprecate',
      retryable: false,
      cooldownRequired: true,
      isolationRequired: true,
      manualRecoveryRequired: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'deprecate',
    },
    {
      schemaVersion: 1,
      id: 'failure:catalog-action-block',
      type: 'FailureModeNode',
      reasonCode: 'graph-catalog-action-block',
      retryable: false,
      cooldownRequired: true,
      isolationRequired: true,
      manualRecoveryRequired: true,
      degradable: false,
      artifactWriteAllowed: false,
      catalogAction: 'block',
    },
  );

  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items[0].markdown;
  const catalogActionEntries = summary.sections.failureModeSummary
    .filter((entry) => entry.failureModeId.startsWith('failure:catalog-action-'))
    .map((entry) => ({
      failureModeId: entry.failureModeId,
      reasonCode: entry.reasonCode,
      catalogAction: entry.catalogAction,
      artifactWriteAllowed: entry.artifactWriteAllowed,
    }));

  assert.equal(summary.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  assert.equal(artifact.redactionRequired, true);
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
  assert.deepEqual(catalogActionEntries, [
    {
      failureModeId: 'failure:catalog-action-none',
      reasonCode: 'graph-catalog-action-none',
      catalogAction: 'none',
      artifactWriteAllowed: true,
    },
    {
      failureModeId: 'failure:catalog-action-deprecate',
      reasonCode: 'graph-catalog-action-deprecate',
      catalogAction: 'deprecate',
      artifactWriteAllowed: false,
    },
    {
      failureModeId: 'failure:catalog-action-block',
      reasonCode: 'graph-catalog-action-block',
      catalogAction: 'block',
      artifactWriteAllowed: false,
    },
  ]);

  for (const catalogAction of ['none', 'deprecate', 'block']) {
    assert.match(markdown, new RegExp(`catalogAction: ${catalogAction}`, 'u'));
    assert.match(matrix, new RegExp(`\\b${catalogAction}\\b`, 'u'));
  }
  for (const matrixEvidence of [
    /FailureModeNode optional catalogAction enum coverage/u,
    /`getGraphFailureModesByCatalogAction\(\)` query coverage/u,
    /GraphDocsSummary \/ Markdown catalogAction semantic coverage/u,
    /block\/deprecate rendering guard coverage/u,
    /catalogAction no-mutation guard coverage/u,
    /unsupported-value non-echo guard coverage/u,
    /without catalog mutation/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.match(matrix, /failureModeSummary.*catalogAction/u);
  assert.doesNotMatch(markdown, /catalog mutation|catalog write|catalog promotion|api-candidate promotion|runtime deprecation|endpoint lifecycle mutation|SiteAdapter runtime|downloader|SessionView|Authorization|cookie|sessionId|browserProfile/u);
});

test('GraphDocsSummary matrix cross-check covers catalogAction no-mutation guard wording', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('docs generator does not mutate catalogAction failure mode descriptors'/u,
  );
  assert.match(docsGeneratorTest, /const beforeGeneration = JSON\.stringify\(failureMode\)/u);
  assert.match(docsGeneratorTest, /summaryFailureMode\.catalogAction = 'deprecate'/u);
  assert.match(docsGeneratorTest, /assert\.equal\(JSON\.stringify\(failureMode\), beforeGeneration\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(graph\.nodes\.find\(\(node\) => node\.id === failureMode\.id\)\.catalogAction, 'block'\)/u);
  assert.match(docsGeneratorTest, /catalog mutation\|catalog write\|catalog promotion\|runtime deprecation/u);

  for (const matrixEvidence of [
    /docs generator does not mutate catalogAction failure mode descriptors/u,
    /catalogAction no-mutation guard coverage/u,
    /without catalog mutation/u,
    /without catalog write/u,
    /without catalog promotion/u,
    /without candidate promotion/u,
    /without endpoint lifecycle mutation/u,
    /without runtime deprecation/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /catalogAction no-mutation guard coverage[^.\n]*(?:mutates catalog|writes catalog|promotes candidate|runtime deprecation enabled)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers catalogAction unsupported-value non-echo evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('docs generator rejects unsupported catalogAction without echoing values'/u,
  );
  assert.match(
    docsGeneratorTest,
    /catalogAction: 'Authorization: Bearer synthetic-secret-value'/u,
  );
  assert.match(docsGeneratorTest, /let markdownCreated = false/u);
  assert.match(docsGeneratorTest, /assert\.equal\(markdownCreated, false\)/u);
  assert.match(docsGeneratorTest, /assert\.match\(message, \/FailureModeNode catalogAction is unsupported\/u\)/u);
  assert.match(docsGeneratorTest, /assert\.doesNotMatch\(message, \/Authorization\|synthetic-secret-value\/u\)/u);

  for (const matrixEvidence of [
    /docs generator rejects unsupported catalogAction without echoing values/u,
    /unsupported-value non-echo guard coverage/u,
    /invalid catalogAction fail-closed behavior without echoing synthetic sensitive values/u,
    /without catalog mutation/u,
    /without catalog write/u,
    /without catalog promotion/u,
    /without runtime deprecation/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /unsupported-value non-echo guard coverage[^.\n]*(?:Authorization: Bearer|synthetic-secret-value|echoes unsupported|writes markdown)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary catalogAction redaction guard evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('docs generator redaction guard rejects failureModeSummary catalogAction sensitive values'/u,
  );
  assert.match(
    docsGeneratorTest,
    /renderEntry\.catalogAction = 'Authorization: Bearer synthetic-secret-value'/u,
  );
  assert.match(docsGeneratorTest, /renderGraphDocsSummaryMarkdown\(renderSummary\)/u);
  assert.match(docsGeneratorTest, /assert\.match\(renderMessage, \/Forbidden sensitive pattern\/u\)/u);
  assert.match(
    docsGeneratorTest,
    /artifactEntry\.catalogAction = 'Authorization: Bearer synthetic-secret-value'/u,
  );
  assert.match(docsGeneratorTest, /let artifactCreated = false/u);
  assert.match(docsGeneratorTest, /createGraphDocsMarkdownArtifact\(artifactSummary\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(artifactCreated, false\)/u);
  assert.match(docsGeneratorTest, /assert\.match\(artifactMessage, \/Forbidden sensitive pattern\/u\)/u);
  assert.match(
    docsGeneratorTest,
    /assert\.doesNotMatch\(artifactMessage, \/Authorization\|synthetic-secret-value\/u\)/u,
  );

  for (const matrixEvidence of [
    /docs generator redaction guard rejects failureModeSummary catalogAction sensitive values/u,
    /failureModeSummary catalogAction redaction guard coverage/u,
    /without echoing synthetic sensitive values/u,
    /without artifact write/u,
    /without Authorization/u,
    /without catalog mutation/u,
    /without runtime deprecation/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /failureModeSummary catalogAction redaction guard coverage[^.\n]*(?:Authorization: Bearer|synthetic-secret-value|artifactCreated=true|writes artifact)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary artifact descriptor evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('docs markdown artifact keeps failureModeSummary descriptors redaction-required'/u,
  );
  assert.match(docsGeneratorTest, /assert\.equal\(artifact\.redactionRequired, true\)/u);
  assert.match(
    docsGeneratorTest,
    /assert\.equal\(artifact\.artifactFamily, 'site-capability-graph-docs-markdown'\)/u,
  );
  assert.match(
    docsGeneratorTest,
    /assert\.equal\(artifact\.queryName, 'renderGraphDocsSummaryMarkdown'\)/u,
  );
  assert.match(
    docsGeneratorTest,
    /assert\.equal\(assertGraphDocsMarkdownArtifactConsumerCompatibility\(artifact\), true\)/u,
  );
  assert.match(
    docsGeneratorTest,
    /assert\.equal\(assertGraphDerivedArtifactWriteAllowed\(artifact\), true\)/u,
  );
  assert.match(docsGeneratorTest, /unsafeForConsumer\.redactionRequired = false/u);
  assert.match(docsGeneratorTest, /unsafeForWriter\.redactionRequired = false/u);
  assert.match(docsGeneratorTest, /assert\.match\(consumerMessage, \/redactionRequired must be true\/u\)/u);
  assert.match(docsGeneratorTest, /assert\.match\(writerMessage, \/redactionRequired=true\/u\)/u);
  assert.match(
    docsGeneratorTest,
    /assert\.doesNotMatch\(writerMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  );

  for (const matrixEvidence of [
    /docs markdown artifact keeps failureModeSummary descriptors redaction-required/u,
    /redaction-required GraphDocsSummary Markdown artifact descriptors/u,
    /consumer compatibility/u,
    /pre-writer guard compatibility/u,
    /redactionRequired=false/u,
    /without echoing FailureModeNode ids or synthetic sensitive values/u,
    /without artifact write/u,
    /without runtime docs writes/u,
    /without failure handling/u,
    /without SiteAdapter runtime/u,
    /without downloader/u,
    /without SessionView/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /failureModeSummary descriptors redaction-required[^.\n]*(?:artifact write enabled|runtime docs write enabled|SiteAdapter runtime enabled|downloader enabled|SessionView materialized|echoing synthetic sensitive values)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary disabled runtime consumer evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('disabled docs markdown runtime consumer keeps failureModeSummary artifact descriptor blocked'/u,
  );
  assert.match(docsGeneratorTest, /assert\.equal\(result\.redactionRequired, true\)/u);
  assert.match(
    docsGeneratorTest,
    /assert\.equal\(result\.artifactFamily, 'site-capability-graph-docs-markdown-runtime-consumer-result'\)/u,
  );
  assert.match(docsGeneratorTest, /assert\.equal\(item\.consumerMode, 'disabled-feature-flag'\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(item\.featureEnabled, false\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(item\.result, 'blocked'\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(item\.reasonCode, 'graph-runtime-consumer-disabled'\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(item\.docsArtifact\.redactionRequired, true\)/u);
  assert.match(docsGeneratorTest, /assert\.equal\(item\.sourceArtifact\.queryName, 'renderGraphDocsSummaryMarkdown'\)/u);
  assert.match(docsGeneratorTest, /assert\.match\(markdown, \/## Failure Modes\/u\)/u);
  assert.match(docsGeneratorTest, /\['featureEnabled', true\]/u);
  assert.match(docsGeneratorTest, /\['runtimeDocsWriteEnabled', true\]/u);
  assert.match(docsGeneratorTest, /\['sessionView', \{\}\]/u);
  assert.match(docsGeneratorTest, /\['downloadPolicy', \{\}\]/u);
  assert.match(docsGeneratorTest, /unsafeResult\.items\[0\]\.docsArtifact\.redactionRequired = false/u);
  assert.match(
    docsGeneratorTest,
    /assert\.doesNotMatch\(unsafeMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  );

  for (const matrixEvidence of [
    /disabled docs markdown runtime consumer keeps failureModeSummary artifact descriptor blocked/u,
    /blocked descriptor-only runtime consumer results/u,
    /redaction-required/u,
    /blocked/u,
    /descriptor-only/u,
    /write-guard-compatible/u,
    /enabled runtime\/docs-write\/session\/downloader rejection/u,
    /without artifact writes/u,
    /without runtime output/u,
    /without SiteAdapter runtime/u,
    /without downloader/u,
    /without SessionView/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /disabled-consumer evidence[^.\n]*(?:runtime docs write enabled|artifact write enabled|SiteAdapter runtime enabled|downloader enabled|SessionView materialized|echoing synthetic sensitive values)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary repo-output dry-run evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);
  const sourceTestName = 'docs markdown repo output dry-run keeps failureModeSummary artifact contained without writes';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const repoOutputSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(repoOutputSourceTest, /test\('docs markdown repo output dry-run keeps failureModeSummary artifact contained without writes'/u);
  assert.match(repoOutputSourceTest, /createGraphDocsMarkdownRepoOutputDryRun/u);
  assert.match(repoOutputSourceTest, /assertGraphDocsMarkdownRepoOutputDryRunCompatibility/u);
  assert.match(
    repoOutputSourceTest,
    /targetRelativePath = 'docs\/site-capability-graph\/generated-failuremode-summary-docs\.md'/u,
  );
  assert.match(repoOutputSourceTest, /assert\.equal\(item\.repoWriteEnabled, false\)/u);
  assert.match(repoOutputSourceTest, /assert\.equal\(item\.runtimeArtifactWriteEnabled, false\)/u);
  assert.match(repoOutputSourceTest, /\['repoWriteEnabled', true\]/u);
  assert.match(repoOutputSourceTest, /\['runtimeArtifactWriteEnabled', true\]/u);
  assert.match(repoOutputSourceTest, /\['sessionView', \{\}\]/u);
  assert.match(repoOutputSourceTest, /\['downloadPolicy', \{\}\]/u);
  assert.match(repoOutputSourceTest, /\.\.\/generated-failuremode-summary-docs\.md/u);
  assert.match(
    repoOutputSourceTest,
    /runs\/site-capability-graph\/generated-failuremode-summary-docs\.md/u,
  );
  assert.match(
    repoOutputSourceTest,
    /docs\/site-capability-graph\/generated-failuremode-summary-docs\.json/u,
  );
  assert.equal(
    [...repoOutputSourceTest.matchAll(/await assert\.rejects\(\(\) => access\(targetUrl\), \/ENOENT\/u\)/gu)].length,
    2,
  );
  assert.doesNotMatch(
    repoOutputSourceTest,
    /writeGraphDocsGenerationLifecycleEventArtifact|writeGraphDerivedArtifact|createGraphDerivedArtifactPlacement/u,
  );

  for (const matrixEvidence of [
    /Current round repo-output evidence/u,
    /docs markdown repo output dry-run keeps failureModeSummary artifact contained without writes/u,
    /createGraphDocsMarkdownRepoOutputDryRun\(\).*assertGraphDocsMarkdownRepoOutputDryRunCompatibility\(\)/u,
    /descriptor-only dry-run path/u,
    /docs\/site-capability-graph\/\*\.md/u,
    /repoWriteEnabled=false/u,
    /runtimeArtifactWriteEnabled=false/u,
    /no target file creation/u,
    /unsafe target rejection/u,
    /runtime\/session\/downloader payload rejection/u,
    /no artifact writer invocation/u,
    /no repo file creation/u,
    /no repo file creation/u,
    /no runtime output/u,
    /no adapter invocation/u,
    /no downloader/u,
    /no SessionView/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const repoOutputEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round repo-output(?: matrix)? evidence/u.test(line));
  assert.equal(repoOutputEvidenceLines.length >= 2, true);
  for (const evidenceLine of repoOutputEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /live write|live repo write|runtime output enabled|artifact writer invocation enabled|SiteAdapter runtime enabled|downloader enabled|SessionView materialized|invokes SiteAdapter|calls downloader|creates target file|writes repo file|artifact writer call added/iu,
    );
    if (/runtime output/iu.test(evidenceLine)) {
      assert.match(evidenceLine, /\bno runtime output\b|\bwithout runtime output\b|\bno repo file creation, runtime output\b/iu);
    }
    if (/artifact writer invocation/iu.test(evidenceLine)) {
      assert.match(evidenceLine, /\bno artifact writer invocation\b|\bwithout artifact writer invocation\b|\bno repo file creation, runtime output, artifact writer invocation\b/iu);
    }
    if (/SiteAdapter|adapter invocation/iu.test(evidenceLine)) {
      assert.match(evidenceLine, /\bno SiteAdapter\b|\bwithout SiteAdapter\b|\bno adapter invocation\b|\bwithout adapter invocation\b|\bno repo file creation, runtime output, artifact writer invocation, adapter invocation\b/iu);
    }
    if (/downloader/iu.test(evidenceLine)) {
      assert.match(evidenceLine, /\bno downloader\b|\bwithout downloader\b|downloader payload rejection\b|\bno repo file creation, runtime output, artifact writer invocation, adapter invocation, downloader\b/iu);
    }
    if (/SessionView/iu.test(evidenceLine)) {
      assert.match(evidenceLine, /\bno SessionView\b|\bwithout SessionView\b|session\/downloader payload rejection\b|\bno repo file creation, runtime output, artifact writer invocation, adapter invocation, downloader, or SessionView\b/iu);
    }
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary approval-gate evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary repo output approval gate stays design-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const approvalGateSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    approvalGateSourceTest,
    /test\('docs markdown failureModeSummary repo output approval gate stays design-only'/u,
  );
  assert.match(approvalGateSourceTest, /createGraphRepoOutputApprovalGateDesign\(dryRun\)/u);
  assert.match(
    approvalGateSourceTest,
    /assertGraphRepoOutputApprovalGateDesignCompatibility\(gate\)/u,
  );
  assert.match(approvalGateSourceTest, /assertGraphDerivedArtifactWriteAllowed\(gate\)/u);
  assert.match(
    approvalGateSourceTest,
    /site-capability-graph-docs-markdown-repo-output-dry-run/u,
  );
  assert.match(
    approvalGateSourceTest,
    /site-capability-graph-repo-output-approval-gate-design/u,
  );

  assert.match(approvalGateSourceTest, /assert\.equal\(item\[fieldName\], false\)/u);
  for (const disabledFieldName of [
    'approvalGateEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'runtimeGenerationEnabled',
    'externalCommandEnabled',
    'schedulerPublishEnabled',
    'doctorPublishEnabled',
    'skillPublishEnabled',
    'mcpPublishEnabled',
  ]) {
    assert.match(approvalGateSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
  }

  for (const requiredEvidence of [
    'explicit-user-request-in-current-task',
    'matrix-section-updated-with-verification',
    'focused-tests-passed',
    'redaction-guard-passed',
    'repo-target-contained',
    'B-review-accepted',
  ]) {
    assert.match(approvalGateSourceTest, new RegExp(requiredEvidence, 'u'));
    assert.match(matrix, new RegExp(requiredEvidence, 'u'));
  }
  assert.match(approvalGateSourceTest, /requiredApprovalEvidence\.includes\(requiredEvidence\)/u);

  assert.equal(
    [...approvalGateSourceTest.matchAll(/await assert\.rejects\(\(\) => access\(targetUrl\), \/ENOENT\/u\)/gu)].length,
    2,
  );
  for (const sourceEvidence of [
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeSource\.items\[0\]\.repoWriteEnabled = true/u,
    /unsafeValidationSource\.items\[0\]\.explicitValidationRequired = false/u,
    /unsafeDocsArtifactSource\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /unsafeGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.dryRunOnly = false/u,
    /assert\.doesNotMatch\(sourceMutationMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
    /assert\.doesNotMatch\(validationMutationMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
    /assert\.doesNotMatch\(docsArtifactMutationMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
    /assert\.doesNotMatch\(gateMutationMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(approvalGateSourceTest, sourceEvidence);
  }

  for (const matrixEvidence of [
    /Current round approval-gate evidence/u,
    /docs markdown failureModeSummary repo output approval gate stays design-only/u,
    /createGraphRepoOutputApprovalGateDesign\(\).*assertGraphRepoOutputApprovalGateDesignCompatibility\(\)/u,
    /site-capability-graph-repo-output-approval-gate-design/u,
    /site-capability-graph-docs-markdown-repo-output-dry-run/u,
    /disabled repo\/runtime\/write\/publish flags/u,
    /required approval evidence/u,
    /approvalRequiredBeforeRepoWrite=true/u,
    /repo writes, runtime output, artifact writer invocation, adapter invocation, downloader, SessionView, publish payloads, and source target creation disabled/u,
    /no runtime output/u,
    /no artifact writer invocation/u,
    /no adapter invocation/u,
    /no downloader/u,
    /no SessionView/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const approvalGateEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round approval-gate (?:matrix )?evidence/u.test(line));
  assert.equal(approvalGateEvidenceLines.length >= 2, true);
  for (const evidenceLine of approvalGateEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /live repo write|runtime output enabled|artifact writer invoked|SiteAdapter runtime enabled|downloader enabled|SessionView materialized/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary generated-output manifest evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary generated-output manifest guard stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const manifestGuardSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    graphSource,
    /export function createGraphDocsMarkdownGeneratedOutputManifestGuard/u,
  );
  assert.match(
    graphSource,
    /export function assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility/u,
  );
  assert.match(
    graphSource,
    /site-capability-graph-docs-markdown-generated-output-manifest-guard/u,
  );
  assert.match(
    graphSource,
    /sourceApprovalGate must wrap docs markdown repo output dry-run/u,
  );

  for (const sourceEvidence of [
    /test\('docs markdown failureModeSummary generated-output manifest guard stays descriptor-only'/u,
    /const manifestGuard = createGraphDocsMarkdownGeneratedOutputManifestGuard\(gate, \{/u,
    /assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility\(manifestGuard\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(manifestGuard\)/u,
    /site-capability-graph-docs-markdown-generated-output-manifest-guard/u,
    /manifestKind, 'generated-output-manifest'/u,
    /const manifestRelativePath = 'docs\/site-capability-graph\/generated-failuremode-summary-docs\.manifest\.json'/u,
    /assert\.equal\(item\.manifestRelativePath, manifestRelativePath\)/u,
    /generatedOutputTargetRelativePath, targetRelativePath/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeManifestWrite, true/u,
    /requiredApprovalGate, 'createGraphRepoOutputApprovalGateDesign'/u,
    /requiredArtifactGuard,/u,
    /SecurityGuard\/Redaction before graph-derived artifact writes/u,
    /\['generatedOutputManifest', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['generatedOutputPath', 'docs\/site-capability-graph\/generated-failuremode-summary-docs\.manifest\.json'\]/u,
    /\['manifestPath', manifestRelativePath\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeGuard\.items\[0\]\.manifestWriteEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphMigrationReportRepoOutputDryRun\(graph, \{/u,
    /createGraphDocsMarkdownGeneratedOutputManifestGuard\(wrongGate, \{ manifestRelativePath \}\)/u,
    /assert\.doesNotMatch\(wrongSourceMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(manifestGuardSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'manifestWriteEnabled',
    'repoWriteEnabled',
    'runtimeGenerationEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.match(manifestGuardSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  assert.equal(
    [...manifestGuardSourceTest.matchAll(/await assert\.rejects\(\(\) => access\(targetUrl\), \/ENOENT\/u\)/gu)].length,
    2,
  );
  assert.equal(
    [...manifestGuardSourceTest.matchAll(/await assert\.rejects\(\(\) => access\(manifestUrl\), \/ENOENT\/u\)/gu)].length,
    2,
  );

  for (const matrixEvidence of [
    /Current round generated-output manifest evidence/u,
    /Current round generated-output manifest matrix evidence/u,
    /docs markdown failureModeSummary generated-output manifest guard stays descriptor-only/u,
    /createGraphDocsMarkdownGeneratedOutputManifestGuard\(\)/u,
    /assertGraphDocsMarkdownGeneratedOutputManifestGuardCompatibility\(\)/u,
    /redaction-required descriptor-only generated-output manifest guards/u,
    /redactionRequiredBeforeManifestWrite=true/u,
    /repo-contained `docs\/site-capability-graph\/\*\.manifest\.json` target validation/u,
    /source approval-gate compatibility/u,
    /generatedOutput\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source family rejection/u,
    /target non-creation/u,
    /58\/58/u,
    /82\/82/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const generatedOutputManifestEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round generated-output manifest (?:matrix )?evidence/u.test(line));
  assert.equal(generatedOutputManifestEvidenceLines.length >= 2, true);
  for (const evidenceLine of generatedOutputManifestEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /manifestWriteEnabled=true|repoWriteEnabled=true|runtimeGenerationEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary retained-output index evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary retained-output index guard stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const retainedIndexSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    graphSource,
    /export function createGraphDocsMarkdownRetainedOutputIndexGuard/u,
  );
  assert.match(
    graphSource,
    /export function assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility/u,
  );
  assert.match(
    graphSource,
    /site-capability-graph-docs-markdown-retained-output-index-guard/u,
  );
  assert.match(
    graphSource,
    /sourceManifestGuard must be a generated-output manifest guard/u,
  );

  for (const sourceEvidence of [
    /test\('docs markdown failureModeSummary retained-output index guard stays descriptor-only'/u,
    /const indexGuard = createGraphDocsMarkdownRetainedOutputIndexGuard\(manifestGuard, \{/u,
    /assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility\(indexGuard\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(indexGuard\)/u,
    /site-capability-graph-docs-markdown-retained-output-index-guard/u,
    /indexKind, 'retained-output-index'/u,
    /const indexRelativePath = 'docs\/site-capability-graph\/generated-failuremode-summary-docs\.retained-index\.json'/u,
    /assert\.equal\(item\.indexRelativePath, indexRelativePath\)/u,
    /assert\.equal\(item\.manifestRelativePath, manifestRelativePath\)/u,
    /assert\.equal\(item\.generatedOutputTargetRelativePath, targetRelativePath\)/u,
    /sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard'/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeIndexWrite, true/u,
    /requiredManifestGuard, 'createGraphDocsMarkdownGeneratedOutputManifestGuard'/u,
    /requiredArtifactGuard,/u,
    /SecurityGuard\/Redaction before graph-derived artifact writes/u,
    /\['retainedOutputIndex', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['retainedOutputPath', 'docs\/site-capability-graph\/generated-failuremode-summary-docs\.retained-index\.json'\]/u,
    /\['indexPath', indexRelativePath\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeIndexGuard\.items\[0\]\.indexWriteEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsMarkdownRetainedOutputIndexGuard\(gate, \{ indexRelativePath \}\)/u,
    /assert\.doesNotMatch\(wrongSourceMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(retainedIndexSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeIndexingEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.match(retainedIndexSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const accessTargetName of ['targetUrl', 'manifestUrl', 'indexUrl']) {
    assert.equal(
      [...retainedIndexSourceTest.matchAll(new RegExp(`access\\(${accessTargetName}\\), /ENOENT/u`, 'gu'))].length,
      2,
    );
  }

  for (const matrixEvidence of [
    /Current round retained-output index evidence/u,
    /Current round retained-output index matrix evidence/u,
    /docs markdown failureModeSummary retained-output index guard stays descriptor-only/u,
    /createGraphDocsMarkdownRetainedOutputIndexGuard\(\)/u,
    /assertGraphDocsMarkdownRetainedOutputIndexGuardCompatibility\(\)/u,
    /redaction-required descriptor-only retained-output index guards/u,
    /redactionRequiredBeforeIndexWrite=true/u,
    /repo-contained `docs\/site-capability-graph\/\*\.retained-index\.json` target validation/u,
    /source generated-output manifest guard compatibility/u,
    /retainedOutput\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /59\/59/u,
    /84\/84/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const retainedIndexEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round retained-output index (?:matrix )?evidence/u.test(line));
  assert.equal(retainedIndexEvidenceLines.length >= 2, true);
  for (const evidenceLine of retainedIndexEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /indexWriteEnabled=true|repoWriteEnabled=true|runtimeIndexingEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary cleanup-policy evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary cleanup-policy guard stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const cleanupPolicySourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    graphSource,
    /export function createGraphDocsMarkdownCleanupPolicyGuard/u,
  );
  assert.match(
    graphSource,
    /export function assertGraphDocsMarkdownCleanupPolicyGuardCompatibility/u,
  );
  assert.match(
    graphSource,
    /site-capability-graph-docs-markdown-cleanup-policy-guard/u,
  );
  assert.match(
    graphSource,
    /sourceIndexGuard must be a retained-output index guard/u,
  );

  for (const sourceEvidence of [
    /test\('docs markdown failureModeSummary cleanup-policy guard stays descriptor-only'/u,
    /const cleanupGuard = createGraphDocsMarkdownCleanupPolicyGuard\(indexGuard\)/u,
    /assertGraphDocsMarkdownCleanupPolicyGuardCompatibility\(cleanupGuard\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(cleanupGuard\)/u,
    /site-capability-graph-docs-markdown-cleanup-policy-guard/u,
    /policyKind, 'artifact-descriptor-cleanup-policy'/u,
    /sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard'/u,
    /sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard'/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeCleanup, true/u,
    /cleanupRequiresApproval, true/u,
    /requiredIndexGuard, 'createGraphDocsMarkdownRetainedOutputIndexGuard'/u,
    /requiredArtifactGuard,/u,
    /SecurityGuard\/Redaction before graph-derived artifact cleanup/u,
    /\['cleanupPolicy', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['cleanupPath', indexRelativePath\]/u,
    /\['deletePath', indexRelativePath\]/u,
    /\['retainedOutputIndex', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeCleanup\.items\[0\]\.deleteEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsMarkdownCleanupPolicyGuard\(manifestGuard\)/u,
    /assert\.doesNotMatch\(wrongSourceMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(cleanupPolicySourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'cleanupWriteEnabled',
    'deleteEnabled',
    'indexWriteEnabled',
    'repoWriteEnabled',
    'runtimeCleanupEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.match(cleanupPolicySourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const accessTargetName of ['targetUrl', 'manifestUrl', 'indexUrl']) {
    assert.equal(
      [...cleanupPolicySourceTest.matchAll(new RegExp(`access\\(${accessTargetName}\\), /ENOENT/u`, 'gu'))].length,
      2,
    );
  }

  for (const matrixEvidence of [
    /Current round cleanup-policy evidence/u,
    /Current round cleanup-policy matrix evidence/u,
    /docs markdown failureModeSummary cleanup-policy guard stays descriptor-only/u,
    /createGraphDocsMarkdownCleanupPolicyGuard\(\)/u,
    /assertGraphDocsMarkdownCleanupPolicyGuardCompatibility\(\)/u,
    /redaction-required descriptor-only cleanup-policy guards/u,
    /redactionRequiredBeforeCleanup=true/u,
    /cleanupRequiresApproval=true/u,
    /source retained-output index guard compatibility/u,
    /cleanup\/delete\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const cleanupPolicyEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round cleanup-policy (?:matrix )?evidence/u.test(line));
  assert.equal(cleanupPolicyEvidenceLines.length >= 2, true);
  for (const evidenceLine of cleanupPolicyEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /cleanupWriteEnabled=true|deleteEnabled=true|indexWriteEnabled=true|repoWriteEnabled=true|runtimeCleanupEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary retention-cleanup handoff evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary retention-cleanup handoff stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const handoffSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    graphSource,
    /export function createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff/u,
  );
  assert.match(
    graphSource,
    /export function assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff/u,
  );
  assert.match(
    graphSource,
    /site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff/u,
  );
  assert.match(
    graphSource,
    /sourceCleanupPolicyGuard must be a cleanup-policy guard/u,
  );

  for (const sourceEvidence of [
    /test\('docs markdown failureModeSummary retention-cleanup handoff stays descriptor-only'/u,
    /const handoff = createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff\(cleanupGuard\)/u,
    /assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff\(handoff\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(handoff\)/u,
    /site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff/u,
    /compatibilityKind, 'retention-cleanup-compatibility-handoff'/u,
    /sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard'/u,
    /sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard'/u,
    /sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard'/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeHandoff, true/u,
    /cleanupRequiresApproval, true/u,
    /retainedIndexRequired, true/u,
    /requiredCleanupPolicyGuard, 'createGraphDocsMarkdownCleanupPolicyGuard'/u,
    /requiredLayerConsumer, 'disabled until explicit Layer retention\/cleanup consumer exists'/u,
    /SecurityGuard\/Redaction before graph-derived retention cleanup handoff/u,
    /\['handoffPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['cleanupPolicy', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['retentionPolicy', \{ maxAgeDays: 7 \}\]/u,
    /\['cleanupExecution', \{\}\]/u,
    /\['deletePlan', \{ path: indexRelativePath \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeHandoff\.items\[0\]\.runtimeHandoffEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff\(indexGuard\)/u,
    /assert\.doesNotMatch\(wrongSourceMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(handoffSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'handoffEnabled',
    'runtimeHandoffEnabled',
    'cleanupExecutionEnabled',
    'deleteEnabled',
    'retentionDecisionWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
  ]) {
    assert.match(handoffSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const accessTargetName of ['targetUrl', 'manifestUrl', 'indexUrl']) {
    assert.equal(
      [...handoffSourceTest.matchAll(new RegExp(`access\\(${accessTargetName}\\), /ENOENT/u`, 'gu'))].length,
      2,
    );
  }

  for (const matrixEvidence of [
    /Current round retention-cleanup handoff evidence/u,
    /Current round retention-cleanup handoff matrix evidence/u,
    /docs markdown failureModeSummary retention-cleanup handoff stays descriptor-only/u,
    /createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff\(\)/u,
    /assertGraphDocsMarkdownRetentionCleanupCompatibilityHandoff\(\)/u,
    /redaction-required descriptor-only retention\/cleanup compatibility handoff descriptors/u,
    /redactionRequiredBeforeHandoff=true/u,
    /cleanupRequiresApproval=true/u,
    /retainedIndexRequired=true/u,
    /source cleanup-policy guard compatibility/u,
    /handoff\/cleanup\/retention\/delete\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const handoffEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round retention-cleanup handoff (?:matrix )?evidence/u.test(line));
  assert.equal(handoffEvidenceLines.length >= 2, true);
  for (const evidenceLine of handoffEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /handoffEnabled=true|runtimeHandoffEnabled=true|cleanupExecutionEnabled=true|deleteEnabled=true|retentionDecisionWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers failureModeSummary final docs-output boundary evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'docs markdown failureModeSummary final docs-output boundary summary stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const finalBoundarySourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  assert.match(
    graphSource,
    /export function createGraphDocsMarkdownFinalOutputBoundarySummary/u,
  );
  assert.match(
    graphSource,
    /export function assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility/u,
  );
  assert.match(
    graphSource,
    /site-capability-graph-docs-markdown-final-output-boundary-summary/u,
  );
  assert.match(
    graphSource,
    /sourceHandoff must be a retention-cleanup compatibility handoff/u,
  );

  for (const sourceEvidence of [
    /test\('docs markdown failureModeSummary final docs-output boundary summary stays descriptor-only'/u,
    /const finalSummary = createGraphDocsMarkdownFinalOutputBoundarySummary\(handoff\)/u,
    /assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility\(finalSummary\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(finalSummary\)/u,
    /site-capability-graph-docs-markdown-final-output-boundary-summary/u,
    /summaryKind, 'final-docs-output-boundary-summary'/u,
    /sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff'/u,
    /sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard'/u,
    /sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard'/u,
    /sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard'/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeFinalOutput, true/u,
    /layerConsumerRequired, true/u,
    /requiredHandoff, 'createGraphDocsMarkdownRetentionCleanupCompatibilityHandoff'/u,
    /requiredLayerConsumer, 'disabled until explicit Layer docs output consumer exists'/u,
    /SecurityGuard\/Redaction before graph-derived final docs output/u,
    /\['finalOutput', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['docsOutputPath', targetRelativePath\]/u,
    /\['runtimeOutput', \{\}\]/u,
    /\['handoffPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeSummary\.items\[0\]\.runtimeOutputEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsMarkdownFinalOutputBoundarySummary\(cleanupGuard\)/u,
    /assert\.doesNotMatch\(wrongSourceMessage, \/failure:graph-schema-invalid\|Authorization\|synthetic-secret-value\/u\)/u,
  ]) {
    assert.match(finalBoundarySourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'finalizationEnabled',
    'runtimeOutputEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(finalBoundarySourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const accessTargetName of ['targetUrl', 'manifestUrl', 'indexUrl']) {
    assert.equal(
      [...finalBoundarySourceTest.matchAll(new RegExp(`access\\(${accessTargetName}\\), /ENOENT/u`, 'gu'))].length,
      2,
    );
  }

  for (const matrixEvidence of [
    /Current round final docs-output boundary evidence/u,
    /Current round final docs-output boundary matrix evidence/u,
    /docs markdown failureModeSummary final docs-output boundary summary stays descriptor-only/u,
    /createGraphDocsMarkdownFinalOutputBoundarySummary\(\)/u,
    /assertGraphDocsMarkdownFinalOutputBoundarySummaryCompatibility\(\)/u,
    /redaction-required descriptor-only final docs-output boundary summary descriptors/u,
    /redactionRequiredBeforeFinalOutput=true/u,
    /layerConsumerRequired=true/u,
    /source retention\/cleanup handoff compatibility/u,
    /finalOutput\/docsOutputPath\/runtimeOutput\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const finalBoundaryEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round final docs-output boundary (?:matrix )?evidence/u.test(line));
  assert.equal(finalBoundaryEvidenceLines.length >= 2, true);
  for (const evidenceLine of finalBoundaryEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /finalizationEnabled=true|runtimeOutputEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output completion checklist evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'GraphDocsSummary docs-output completion checklist stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const completionChecklistSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /const GRAPH_DOCS_OUTPUT_COMPLETION_REQUIRED_EVIDENCE = Object\.freeze/u,
    /export function createGraphDocsOutputCompletionChecklist/u,
    /export function assertGraphDocsOutputCompletionChecklistCompatibility/u,
    /function assertGraphDocsOutputCompletionChecklistRequiredEvidence/u,
    /requiredEvidence\.includes\(evidence\)/u,
    /site-capability-graph-docs-output-completion-checklist/u,
    /sourceBoundarySummary must be a final docs-output boundary summary/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const evidenceName of [
    'docs-generator-passed',
    'docs-matrix-cross-check-passed',
    'matrix-updated-with-verification',
    'descriptor-only-boundary-preserved',
    'redaction-required-before-output',
    'B-review-accepted',
  ]) {
    assert.match(graphSource, new RegExp(evidenceName, 'u'));
    assert.match(completionChecklistSourceTest, new RegExp(evidenceName, 'u'));
    assert.match(matrix, new RegExp(evidenceName, 'u'));
  }

  for (const sourceEvidence of [
    /test\('GraphDocsSummary docs-output completion checklist stays descriptor-only'/u,
    /const checklist = createGraphDocsOutputCompletionChecklist\(finalSummary\)/u,
    /assertGraphDocsOutputCompletionChecklistCompatibility\(checklist\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(checklist\)/u,
    /site-capability-graph-docs-output-completion-checklist/u,
    /checklistKind, 'docs-output-completion-checklist'/u,
    /sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary'/u,
    /sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff'/u,
    /redactionRequiredBeforeCompletion, true/u,
    /layerConsumerRequired, true/u,
    /requiredBoundarySummary, 'createGraphDocsMarkdownFinalOutputBoundarySummary'/u,
    /SecurityGuard\/Redaction before graph-derived docs completion output/u,
    /missingEvidenceChecklist\.items\[0\]\.requiredEvidence/u,
    /requiredEvidence must include redaction-required-before-output/u,
    /replacedEvidenceChecklist\.items\[0\]\.requiredEvidence/u,
    /evidence === 'B-review-accepted' \? 'synthetic-secret-value' : evidence/u,
    /assert\.doesNotMatch\(replacedEvidenceMessage, \/synthetic-secret-value\/u\)/u,
    /\['checklistOutput', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['docsOutputPath', targetRelativePath\]/u,
    /\['runtimeChecklist', \{\}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeChecklist\.items\[0\]\.completionEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceBoundarySummary\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsOutputCompletionChecklist\(handoff\)/u,
  ]) {
    assert.match(completionChecklistSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'completionEnabled',
    'runtimeChecklistEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(completionChecklistSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const matrixEvidence of [
    /Current round completion-checklist evidence/u,
    /Current round completion-checklist matrix evidence/u,
    /GraphDocsSummary docs-output completion checklist stays descriptor-only/u,
    /createGraphDocsOutputCompletionChecklist\(\)/u,
    /assertGraphDocsOutputCompletionChecklistCompatibility\(\)/u,
    /fixed requiredEvidence membership gates/u,
    /negative coverage for missing\/replaced requiredEvidence entries/u,
    /redactionRequiredBeforeCompletion=true/u,
    /layerConsumerRequired=true/u,
    /source final-boundary summary compatibility/u,
    /checklistOutput\/completionResult\/docsOutputPath\/runtimeChecklist\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const completionChecklistEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round completion-checklist (?:matrix )?evidence/u.test(line));
  assert.equal(completionChecklistEvidenceLines.length >= 2, true);
  for (const evidenceLine of completionChecklistEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /completionEnabled=true|runtimeChecklistEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|artifact writer invoked|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output completion final matrix handoff evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'GraphDocsSummary docs-output completion final matrix handoff stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const finalMatrixHandoffSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsOutputFinalMatrixHandoff/u,
    /export function assertGraphDocsOutputFinalMatrixHandoffCompatibility/u,
    /function assertGraphDocsOutputFinalMatrixHandoffSourceCompatible/u,
    /site-capability-graph-docs-output-final-matrix-handoff/u,
    /sourceChecklist must be a docs-output completion checklist/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('GraphDocsSummary docs-output completion final matrix handoff stays descriptor-only'/u,
    /const matrixHandoff = createGraphDocsOutputFinalMatrixHandoff\(checklist\)/u,
    /assertGraphDocsOutputFinalMatrixHandoffCompatibility\(matrixHandoff\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(matrixHandoff\)/u,
    /site-capability-graph-docs-output-final-matrix-handoff/u,
    /handoffKind, 'docs-output-completion-final-matrix-handoff'/u,
    /sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist'/u,
    /sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary'/u,
    /sourceHandoffFamily, 'site-capability-graph-docs-markdown-retention-cleanup-compatibility-handoff'/u,
    /sourceCleanupPolicyFamily, 'site-capability-graph-docs-markdown-cleanup-policy-guard'/u,
    /sourceIndexGuardFamily, 'site-capability-graph-docs-markdown-retained-output-index-guard'/u,
    /sourceManifestGuardFamily, 'site-capability-graph-docs-markdown-generated-output-manifest-guard'/u,
    /sourceOutputFamily, 'site-capability-graph-docs-markdown-repo-output-dry-run'/u,
    /sourceGateFamily, 'site-capability-graph-repo-output-approval-gate-design'/u,
    /redactionRequiredBeforeMatrixUpdate, true/u,
    /layerConsumerRequired, true/u,
    /BReviewRequired, true/u,
    /requiredChecklist, 'createGraphDocsOutputCompletionChecklist'/u,
    /SecurityGuard\/Redaction before graph-derived docs matrix handoff output/u,
    /IMPLEMENTATION_MATRIX\.md updated by Agent A and reviewed by Agent B/u,
    /\['finalMatrixHandoff', \{\}\]/u,
    /\['handoffResult', \{\}\]/u,
    /\['matrixPatch', \{ status: 'verified' \}\]/u,
    /\['matrixOutputPath', targetRelativePath\]/u,
    /\['matrixWrite', \{\}\]/u,
    /\['matrixStatusUpdate', \{ status: 'verified' \}\]/u,
    /\['statusPromotion', \{ section: 20 \}\]/u,
    /\['verifiedPromotion', \{ section: 20 \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeHandoff\.items\[0\]\.matrixWriteEnabled = true/u,
    /unsafeSource\.items\[0\]\.sourceChecklist\.items\[0\]\.sourceBoundarySummary\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsOutputFinalMatrixHandoff\(finalSummary\)/u,
  ]) {
    assert.match(finalMatrixHandoffSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'handoffEnabled',
    'runtimeMatrixUpdateEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(finalMatrixHandoffSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const matrixEvidence of [
    /Current round final matrix handoff evidence/u,
    /Current round final matrix handoff matrix evidence/u,
    /GraphDocsSummary docs-output completion final matrix handoff stays descriptor-only/u,
    /createGraphDocsOutputFinalMatrixHandoff\(\)/u,
    /assertGraphDocsOutputFinalMatrixHandoffCompatibility\(\)/u,
    /redaction-required descriptor-only final matrix handoff descriptors/u,
    /redactionRequiredBeforeMatrixUpdate=true/u,
    /layerConsumerRequired=true/u,
    /BReviewRequired=true/u,
    /source completion-checklist compatibility/u,
    /finalMatrixHandoff\/handoffResult\/matrixPatch\/matrixWrite\/matrixStatusUpdate\/statusPromotion\/verifiedPromotion\/session\/downloader\/publish payload rejection/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const finalMatrixHandoffEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round final matrix handoff (?:matrix )?evidence/u.test(line));
  assert.equal(finalMatrixHandoffEvidenceLines.length >= 2, true);
  for (const evidenceLine of finalMatrixHandoffEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /handoffEnabled=true|runtimeMatrixUpdateEnabled=true|matrixWriteEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|matrix writer invoked|status promoted|verified status set|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output completion final acceptance descriptor evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'GraphDocsSummary docs-output completion final acceptance descriptor stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const finalAcceptanceSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsOutputFinalAcceptanceDescriptor/u,
    /export function assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility/u,
    /function assertGraphDocsOutputFinalAcceptanceDescriptorSourceCompatible/u,
    /site-capability-graph-docs-output-final-acceptance-descriptor/u,
    /sourceMatrixHandoff must be a docs-output final matrix handoff/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('GraphDocsSummary docs-output completion final acceptance descriptor stays descriptor-only'/u,
    /const acceptance = createGraphDocsOutputFinalAcceptanceDescriptor\(matrixHandoff\)/u,
    /assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility\(acceptance\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(acceptance\)/u,
    /site-capability-graph-docs-output-final-acceptance-descriptor/u,
    /acceptanceKind, 'docs-output-final-acceptance-descriptor'/u,
    /sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff'/u,
    /sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist'/u,
    /sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary'/u,
    /redactionRequiredBeforeAcceptance, true/u,
    /layerConsumerRequired, true/u,
    /finalBReviewRequired, true/u,
    /matrixVerifiedPromotionAllowed, false/u,
    /requiredMatrixHandoff, 'createGraphDocsOutputFinalMatrixHandoff'/u,
    /SecurityGuard\/Redaction before graph-derived docs final acceptance output/u,
    /Agent B final acceptance remains external to Graph descriptor generation/u,
    /\['finalAcceptance', \{\}\]/u,
    /\['acceptanceResult', \{\}\]/u,
    /\['finalAcceptancePayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['matrixWrite', \{\}\]/u,
    /\['statusPromotion', \{ status: 'verified' \}\]/u,
    /\['verifiedPromotion', \{ section: 20 \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /unsafeAcceptance\.items\[0\]\.matrixVerifiedPromotionAllowed = true/u,
    /unsafeSource\.items\[0\]\.sourceMatrixHandoff\.items\[0\]\.sourceChecklist\.items\[0\]\.sourceBoundarySummary\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsOutputFinalAcceptanceDescriptor\(checklist\)/u,
  ]) {
    assert.match(finalAcceptanceSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'acceptanceEnabled',
    'runtimeAcceptanceEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(finalAcceptanceSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const matrixEvidence of [
    /Current round final acceptance evidence/u,
    /Current round final acceptance matrix evidence/u,
    /GraphDocsSummary docs-output completion final acceptance descriptor stays descriptor-only/u,
    /createGraphDocsOutputFinalAcceptanceDescriptor\(\)/u,
    /assertGraphDocsOutputFinalAcceptanceDescriptorCompatibility\(\)/u,
    /redaction-required descriptor-only final acceptance descriptors/u,
    /redactionRequiredBeforeAcceptance=true/u,
    /layerConsumerRequired=true/u,
    /finalBReviewRequired=true/u,
    /matrixVerifiedPromotionAllowed=false/u,
    /source final-matrix-handoff compatibility/u,
    /finalAcceptance\/acceptanceResult\/finalAcceptancePayload\/matrixWrite\/statusPromotion\/verifiedPromotion\/session\/downloader\/publish payload rejection/u,
    /promotion mutation fail-closed/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const finalAcceptanceEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round final acceptance (?:matrix )?evidence/u.test(line));
  assert.equal(finalAcceptanceEvidenceLines.length >= 2, true);
  for (const evidenceLine of finalAcceptanceEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /acceptanceEnabled=true|runtimeAcceptanceEnabled=true|matrixWriteEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|matrix writer invoked|status promoted|verified status set|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output final acceptance report descriptor evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'GraphDocsSummary docs-output final acceptance report descriptor stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const finalAcceptanceReportSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsOutputFinalAcceptanceReportDescriptor/u,
    /export function assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility/u,
    /function assertGraphDocsOutputFinalAcceptanceReportDescriptorSourceCompatible/u,
    /site-capability-graph-docs-output-final-acceptance-report-descriptor/u,
    /sourceAcceptanceDescriptor must be a docs-output final acceptance descriptor/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('GraphDocsSummary docs-output final acceptance report descriptor stays descriptor-only'/u,
    /const acceptanceReport = createGraphDocsOutputFinalAcceptanceReportDescriptor\(acceptance\)/u,
    /assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility\(acceptanceReport\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(acceptanceReport\)/u,
    /site-capability-graph-docs-output-final-acceptance-report-descriptor/u,
    /reportKind, 'docs-output-final-acceptance-report-descriptor'/u,
    /sourceAcceptanceDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-descriptor'/u,
    /sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff'/u,
    /sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist'/u,
    /sourceBoundarySummaryFamily, 'site-capability-graph-docs-markdown-final-output-boundary-summary'/u,
    /redactionRequiredBeforeReport, true/u,
    /layerConsumerRequired, true/u,
    /finalBReviewRequired, true/u,
    /publishAllowed, false/u,
    /matrixVerifiedPromotionAllowed, false/u,
    /requiredAcceptanceDescriptor, 'createGraphDocsOutputFinalAcceptanceDescriptor'/u,
    /SecurityGuard\/Redaction before graph-derived docs final acceptance report output/u,
    /Agent B final acceptance report remains external to Graph descriptor generation/u,
    /\['finalAcceptanceReport', \{\}\]/u,
    /\['reportOutput', \{\}\]/u,
    /\['reportResult', \{\}\]/u,
    /\['reportPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['publishTarget', 'docs\/site-capability-graph\/final-acceptance-report\.md'\]/u,
    /\['docsOutputPath', 'docs\/site-capability-graph\/final-acceptance-report\.md'\]/u,
    /\['repoPath', 'C:\/Users\/lyt-p\/Desktop\/Browser-Wiki-Skill'\]/u,
    /\['statusPromotion', \{ status: 'verified' \}\]/u,
    /\['verifiedPromotion', \{ section: 20 \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /unsafeReport\.items\[0\]\.publishAllowed = true/u,
    /unsafePromotion\.items\[0\]\.matrixVerifiedPromotionAllowed = true/u,
    /unsafeSource\.items\[0\]\.sourceAcceptanceDescriptor\.items\[0\]\.sourceMatrixHandoff\.items\[0\]\.sourceChecklist\.items\[0\]\.sourceBoundarySummary\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsOutputFinalAcceptanceReportDescriptor\(matrixHandoff\)/u,
  ]) {
    assert.match(finalAcceptanceReportSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'reportEnabled',
    'runtimeReportEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(finalAcceptanceReportSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const matrixEvidence of [
    /Current round final acceptance report evidence/u,
    /Current round final acceptance report matrix evidence/u,
    /GraphDocsSummary docs-output final acceptance report descriptor stays descriptor-only/u,
    /createGraphDocsOutputFinalAcceptanceReportDescriptor\(\)/u,
    /assertGraphDocsOutputFinalAcceptanceReportDescriptorCompatibility\(\)/u,
    /redaction-required descriptor-only final acceptance report descriptors/u,
    /redactionRequiredBeforeReport=true/u,
    /layerConsumerRequired=true/u,
    /finalBReviewRequired=true/u,
    /publishAllowed=false/u,
    /matrixVerifiedPromotionAllowed=false/u,
    /source final-acceptance descriptor compatibility/u,
    /finalAcceptanceReport\/reportOutput\/reportResult\/reportPayload\/publishPayload\/publishTarget\/docsOutputPath\/repoPath\/statusPromotion\/verifiedPromotion\/session\/downloader payload rejection/u,
    /publish mutation fail-closed/u,
    /promotion mutation fail-closed/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const finalAcceptanceReportEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round final acceptance report (?:matrix )?evidence/u.test(line));
  assert.equal(finalAcceptanceReportEvidenceLines.length >= 2, true);
  for (const evidenceLine of finalAcceptanceReportEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /reportEnabled=true|runtimeReportEnabled=true|matrixWriteEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|publishAllowed=true|matrix writer invoked|status promoted|verified status set|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output final B-review checklist evidence', async () => {
  const [matrix, docsGeneratorTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'GraphDocsSummary docs-output final B-review checklist stays descriptor-only';
  const testStart = docsGeneratorTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = docsGeneratorTest.indexOf('\ntest(', testStart + 1);
  const finalBReviewChecklistSourceTest = docsGeneratorTest.slice(
    testStart,
    nextTestStart === -1 ? docsGeneratorTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsOutputFinalBReviewChecklist/u,
    /export function assertGraphDocsOutputFinalBReviewChecklistCompatibility/u,
    /function assertGraphDocsOutputFinalBReviewChecklistSourceCompatible/u,
    /function normalizeFinalBReviewChecklistSections/u,
    /site-capability-graph-docs-output-final-b-review-checklist/u,
    /sourceAcceptanceReportDescriptor must be a docs-output final acceptance report descriptor/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('GraphDocsSummary docs-output final B-review checklist stays descriptor-only'/u,
    /const bReviewChecklist = createGraphDocsOutputFinalBReviewChecklist\(acceptanceReport\)/u,
    /assertGraphDocsOutputFinalBReviewChecklistCompatibility\(bReviewChecklist\)/u,
    /assertGraphDerivedArtifactWriteAllowed\(bReviewChecklist\)/u,
    /site-capability-graph-docs-output-final-b-review-checklist/u,
    /checklistKind, 'docs-output-final-b-review-checklist'/u,
    /sourceAcceptanceReportDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-report-descriptor'/u,
    /sourceAcceptanceDescriptorFamily, 'site-capability-graph-docs-output-final-acceptance-descriptor'/u,
    /sourceMatrixHandoffFamily, 'site-capability-graph-docs-output-final-matrix-handoff'/u,
    /sourceChecklistFamily, 'site-capability-graph-docs-output-completion-checklist'/u,
    /remainingNonVerifiedSections, Array\.from\(\{ length: 20 \}/u,
    /remainingNonVerifiedCount, 20/u,
    /redactionRequiredBeforeReview, true/u,
    /layerConsumerRequired, true/u,
    /BReviewRequired, true/u,
    /reviewResultMaterialized, false/u,
    /matrixVerifiedPromotionAllowed, false/u,
    /requiredAcceptanceReportDescriptor, 'createGraphDocsOutputFinalAcceptanceReportDescriptor'/u,
    /SecurityGuard\/Redaction before graph-derived docs final B-review checklist output/u,
    /Agent B review remains external to Graph descriptor generation/u,
    /\['finalBReviewChecklist', \{\}\]/u,
    /\['reviewOutput', \{\}\]/u,
    /\['reviewResult', \{\}\]/u,
    /\['reviewPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['statusPromotion', \{ status: 'verified' \}\]/u,
    /\['verifiedPromotion', \{ section: 20 \}\]/u,
    /\['matrixWrite', \{\}\]/u,
    /\['publishPayload', \{ authorization: 'Authorization: Bearer synthetic-secret-value' \}\]/u,
    /\['sessionView', \{\}\]/u,
    /\['downloadPolicy', \{\}\]/u,
    /remainingNonVerifiedSections/u,
    /unsafeReview\.items\[0\]\.reviewResultMaterialized = true/u,
    /unsafePromotion\.items\[0\]\.matrixVerifiedPromotionAllowed = true/u,
    /unsafeCount\.items\[0\]\.remainingNonVerifiedCount = 1/u,
    /unsafeSource\.items\[0\]\.sourceAcceptanceReportDescriptor\.items\[0\]\.sourceAcceptanceDescriptor\.items\[0\]\.sourceMatrixHandoff\.items\[0\]\.sourceChecklist\.items\[0\]\.sourceBoundarySummary\.items\[0\]\.sourceHandoff\.items\[0\]\.sourceCleanupPolicyGuard\.items\[0\]\.sourceIndexGuard\.items\[0\]\.sourceManifestGuard\.items\[0\]\.sourceApprovalGate\.items\[0\]\.sourceRepoOutput\.items\[0\]\.docsArtifact\.redactionRequired = false/u,
    /createGraphDocsOutputFinalBReviewChecklist\(acceptance\)/u,
  ]) {
    assert.match(finalBReviewChecklistSourceTest, sourceEvidence);
  }

  for (const disabledFieldName of [
    'reviewEnabled',
    'runtimeReviewEnabled',
    'matrixWriteEnabled',
    'docsWriteEnabled',
    'repoWriteEnabled',
    'runtimeArtifactWriteEnabled',
    'externalCommandEnabled',
    'publishEnabled',
  ]) {
    assert.match(finalBReviewChecklistSourceTest, new RegExp(`'${disabledFieldName}'`, 'u'));
    assert.match(matrix, new RegExp(`${disabledFieldName}=false`, 'u'));
  }

  for (const matrixEvidence of [
    /Current round final B-review checklist evidence/u,
    /Current round final B-review checklist matrix evidence/u,
    /GraphDocsSummary docs-output final B-review checklist stays descriptor-only/u,
    /createGraphDocsOutputFinalBReviewChecklist\(\)/u,
    /assertGraphDocsOutputFinalBReviewChecklistCompatibility\(\)/u,
    /redaction-required descriptor-only final B-review checklist descriptors/u,
    /redactionRequiredBeforeReview=true/u,
    /layerConsumerRequired=true/u,
    /BReviewRequired=true/u,
    /reviewResultMaterialized=false/u,
    /matrixVerifiedPromotionAllowed=false/u,
    /remaining non-verified section list\/count validation/u,
    /source final-acceptance-report descriptor compatibility/u,
    /finalBReviewChecklist\/reviewOutput\/reviewResult\/reviewPayload\/statusPromotion\/verifiedPromotion\/matrixWrite\/publishPayload\/session\/downloader payload rejection/u,
    /invalid remaining section rejection/u,
    /review-result mutation fail-closed/u,
    /promotion mutation fail-closed/u,
    /count mutation fail-closed/u,
    /source redaction mutation fail-closed/u,
    /wrong source rejection/u,
    /target\/manifest\/index non-creation/u,
    /67\/67/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const finalBReviewChecklistEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round final B-review checklist (?:matrix )?evidence/u.test(line));
  assert.equal(finalBReviewChecklistEvidenceLines.length >= 2, true);
  for (const evidenceLine of finalBReviewChecklistEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /reviewEnabled=true|runtimeReviewEnabled=true|matrixWriteEnabled=true|docsWriteEnabled=true|repoWriteEnabled=true|runtimeArtifactWriteEnabled=true|externalCommandEnabled=true|publishEnabled=true|reviewResultMaterialized=true|matrix writer invoked|status promoted|verified status set|downloader enabled|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers runtime docs-output consumer gap evidence', async () => {
  const [matrix, matrixTest, graphSource] = await Promise.all([
    readMatrix(),
    readSource(MATRIX_TEST_URL),
    readSource(GRAPH_URL),
  ]);
  const sourceTestName = 'Site Capability Graph docs-output runtime consumer remains an unintegrated disabled gap';
  const testStart = matrixTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = matrixTest.indexOf('\ntest(', testStart + 1);
  const runtimeConsumerGapSourceTest = matrixTest.slice(
    testStart,
    nextTestStart === -1 ? matrixTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createDisabledGraphDocsMarkdownRuntimeConsumerResult/u,
    /export function assertDisabledGraphDocsMarkdownRuntimeConsumerResultCompatibility/u,
    /featureFlag: 'siteCapabilityGraphDocsMarkdownRuntimeEnabled'/u,
    /featureEnabled: false/u,
    /result: 'blocked'/u,
    /Graph docs Markdown runtime consumer is disabled by feature flag/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('Site Capability Graph docs-output runtime consumer remains an unintegrated disabled gap'/u,
    /listSourceFiles\(SRC_URL\)/u,
    /createDisabledGraphDocsMarkdownRuntimeConsumerResult/u,
    /featureFlag: 'siteCapabilityGraphDocsMarkdownRuntimeEnabled'/u,
    /featureEnabled: false/u,
    /result: 'blocked'/u,
    /Graph docs Markdown runtime consumer is disabled by feature flag/u,
    /runtime Layer docs-output consumer gap test remains disabled until explicit integration exists/u,
    /consumerReferences\.map/u,
    /src\/sites\/capability\/site-capability-graph\.mjs/u,
    /runtime docs-output consumer enabled\|docs runtime writer invoked\|repo docs writer invoked\|status promoted\|verified status set/u,
  ]) {
    assert.match(runtimeConsumerGapSourceTest, sourceEvidence);
  }

  for (const matrixEvidence of [
    /Current round runtime consumer gap evidence/u,
    /Current round runtime consumer gap matrix evidence/u,
    /Site Capability Graph docs-output runtime consumer remains an unintegrated disabled gap/u,
    /runtime Layer docs-output consumer gap test remains disabled until explicit integration exists/u,
    /createDisabledGraphDocsMarkdownRuntimeConsumerResult\(\)/u,
    /featureEnabled=false/u,
    /result=blocked/u,
    /no external `src\/` consumer call path/u,
    /Layer, entrypoints, pipeline, SiteAdapter, downloader, SessionView, repo writer, or Artifact runtime writer/u,
    /10\/10/u,
    /26\/26/u,
    /103\/103/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const runtimeConsumerGapEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round runtime consumer gap (?:matrix )?evidence/u.test(line));
  assert.equal(runtimeConsumerGapEvidenceLines.length >= 2, true);
  for (const evidenceLine of runtimeConsumerGapEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /runtime docs-output consumer enabled|docs runtime writer invoked|repo docs writer invoked|artifact runtime writer invoked|SiteAdapter invoked|downloader enabled|SessionView materialized|status promoted|verified status set|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers redaction audit attachment guard evidence', async () => {
  const [matrix, matrixTest, artifactWriterSource] = await Promise.all([
    readMatrix(),
    readSource(MATRIX_TEST_URL),
    readSource(GRAPH_ARTIFACTS_URL),
  ]);
  const sourceTestName =
    'Site Capability Graph docs-output redaction audit attachment guard remains contained to graph-derived writer';
  const testStart = matrixTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = matrixTest.indexOf('\ntest(', testStart + 1);
  const runtimeRedactionAuditGapSourceTest = matrixTest.slice(
    testStart,
    nextTestStart === -1 ? matrixTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function prepareGraphDerivedArtifactWrite\b/u,
    /export async function writeGraphDerivedArtifactPair\b/u,
    /export function assertGraphDerivedArtifactRedactionAuditAttachmentCompatible\b/u,
    /prepareRedactedArtifactJsonWithAudit/u,
    /redactionAuditAttachment/u,
  ]) {
    assert.match(artifactWriterSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /test\('Site Capability Graph docs-output redaction audit attachment guard remains contained to graph-derived writer'/u,
    /prepareGraphDerivedArtifactWrite/u,
    /writeGraphDerivedArtifactPair/u,
    /assertGraphDerivedArtifactRedactionAuditAttachmentCompatible/u,
    /writeOrder: 'audit-before-artifact'/u,
    /graph artifact writer writes docs markdown output with redaction audit attachment/u,
    /graph artifact writer rejects docs markdown query results that bypass docs-output guard/u,
    /prepareRedactedArtifactJsonWithAudit/u,
    /Runtime Layer write-path integration still does not exist|not yet integrated into a live Layer docs-output consumer/iu,
    /docs runtime writer invoked|status promoted|verified status set|runtime Layer write-path integration complete|SessionView materialized|downloader enabled/u,
  ]) {
    assert.match(runtimeRedactionAuditGapSourceTest, sourceEvidence);
  }

  for (const matrixEvidence of [
    /Current round redaction audit attachment guard evidence/u,
    /Current round redaction audit attachment matrix evidence/u,
    /Site Capability Graph docs-output redaction audit attachment guard remains contained to graph-derived writer/u,
    /assertGraphDerivedArtifactRedactionAuditAttachmentCompatible\(\)/u,
    /redactionAuditAttachment/u,
    /writeOrder: 'audit-before-artifact'/u,
    /site-capability-graph-docs-markdown.*assertGraphDocsMarkdownArtifactConsumerCompatibility\(\)/u,
    /does not add runtime Layer docs-output consumer integration/u,
    /runtime writer, repo writer, SiteAdapter, downloader, SessionView, or publish/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const runtimeRedactionAuditGapEvidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round redaction audit attachment (?:guard|matrix) evidence/u.test(line));
  assert.equal(runtimeRedactionAuditGapEvidenceLines.length >= 2, true);
  for (const evidenceLine of runtimeRedactionAuditGapEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /docs runtime writer invoked|status promoted|verified status set|runtime Layer write-path integration complete|SessionView materialized|downloader enabled|Authorization: Bearer|synthetic-secret-value|cookie|csrf|sessionId|browserProfile/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers docs-output runtime write-path integration guard evidence', async () => {
  const [matrix, matrixTest, artifactWriterTest, artifactWriterSource] = await Promise.all([
    readMatrix(),
    readSource(MATRIX_TEST_URL),
    readSource(ARTIFACT_WRITER_TEST_URL),
    readSource(GRAPH_ARTIFACTS_URL),
  ]);
  const sourceTestName =
    'Site Capability Graph docs-output runtime write-path integration guard remains disabled and audit-bound';
  const testStart = matrixTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = matrixTest.indexOf('\ntest(', testStart + 1);
  const runtimeWritePathGuardSourceTest = matrixTest.slice(
    testStart,
    nextTestStart === -1 ? matrixTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsMarkdownRuntimeWritePathIntegrationGuard\b/u,
    /export function assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility\b/u,
    /GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE/u,
    /redactionRequiredBeforeWrite/u,
  ]) {
    assert.match(artifactWriterSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /docs markdown runtime write-path guard consumes redaction audit attachment while disabled/u,
    /docs markdown runtime write-path guard rejects enabled runtime products and mutated audit attachments/u,
    /createGraphDocsMarkdownRuntimeWritePathIntegrationGuard/u,
    /assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility/u,
    /redactionAuditAttachment/u,
  ]) {
    assert.match(artifactWriterTest, sourceEvidence);
  }

  for (const matrixTestEvidence of [
    /test\('Site Capability Graph docs-output runtime write-path integration guard remains disabled and audit-bound'/u,
    /createGraphDocsMarkdownRuntimeWritePathIntegrationGuard/u,
    /assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility/u,
    /docsWriteEnabled:\\s\*false/u,
    /runtimeArtifactWriteEnabled:\\s\*false/u,
    /SessionView materialized|downloader enabled|publish enabled/u,
  ]) {
    assert.match(runtimeWritePathGuardSourceTest, matrixTestEvidence);
  }

  for (const matrixEvidence of [
    /Current round runtime write-path integration guard evidence/u,
    /Current round runtime write-path integration guard matrix evidence/u,
    /docs markdown runtime write-path guard consumes redaction audit attachment while disabled/u,
    /docs markdown runtime write-path guard rejects enabled runtime products and mutated audit attachments/u,
    /createGraphDocsMarkdownRuntimeWritePathIntegrationGuard\(\)/u,
    /assertGraphDocsMarkdownRuntimeWritePathIntegrationGuardCompatibility\(\)/u,
    /graph-runtime-consumer-disabled/u,
    /disabled\/design-only/u,
    /keeping live runtime docs writes absent|keeps live runtime docs writes absent/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  const evidenceLines = matrix
    .split('\n')
    .filter((line) => /Current round runtime write-path integration guard (?:matrix )?evidence/u.test(line));
  assert.equal(evidenceLines.length >= 2, true);
  for (const evidenceLine of evidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /Authorization: Bearer|synthetic-secret-value|cookie|csrf|sessionId|browserProfile|docs runtime writer invoked|runtime Layer write-path integration complete|downloader enabled|publish enabled|SessionView materialized/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers disabled observability adapter handshake evidence', async () => {
  const graph = await readMinimalGraphFixture();
  const [matrix, graphSource, observabilityTest, matrixTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
    readSource(MATRIX_TEST_URL),
  ]);
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items.map((item) => item.markdown).join('\n');
  const handshakeTestName =
    'disabled Layer observability adapter handshake consumes preflight before runtime registration';

  assert.equal(summary.redactionRequired, true);
  assert.equal(artifact.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);

  for (const sourceDefinition of [
    /export function createDisabledGraphDocsLifecycleObservabilityAdapterHandshake\b/u,
    /export function assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility\b/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  assert.match(
    observabilityTest,
    new RegExp(`test\\('${handshakeTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'`, 'u'),
  );
  for (const sourceEvidence of [
    /\bsourcePreflight\b/u,
    /\brequiredPreflightGuard\b/u,
    /\bregistrationAllowed\b/u,
    /\bproducerRegistrationAllowed\b/u,
    /\bsubscriberRegistrationAllowed\b/u,
    /\btelemetryDispatchAllowed\b/u,
    /\bruntimeDispatchAllowed\b/u,
  ]) {
    assert.match(observabilityTest, sourceEvidence);
  }

  for (const matrixEvidence of [
    /createDisabledGraphDocsLifecycleObservabilityAdapterHandshake\(\)/u,
    /assertDisabledGraphDocsLifecycleObservabilityAdapterHandshakeCompatibility\(\)/u,
    new RegExp(handshakeTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    /\bsourcePreflight\b/u,
    /\brequiredPreflightGuard\b/u,
    /does not register subscribers/u,
    /connect external telemetry/u,
    /write runtime logs/u,
    /write artifacts/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }

  assert.match(
    matrixTest,
    /Site Capability Graph Section 18 records disabled observability adapter handshake evidence without promotion/u,
  );

  assert.doesNotMatch(
    markdown,
    /external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|runtime log write enabled|runtime artifact write enabled|runtime producer registered|telemetry subscriber registered|Authorization|cookie|sessionId|browserProfile/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers disabled observability consumer integration design evidence', async () => {
  const graph = await readMinimalGraphFixture();
  const [matrix, graphSource, observabilityTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
  ]);
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items.map((item) => item.markdown).join('\n');
  const sourceTestName =
    'disabled Layer observability consumer integration design remains no-op after handshake';
  const testStart = observabilityTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = observabilityTest.indexOf('\ntest(', testStart + 1);
  const consumerIntegrationSourceTest = observabilityTest.slice(
    testStart,
    nextTestStart === -1 ? observabilityTest.length : nextTestStart,
  );
  const section18Start = matrix.indexOf('## 18. Observability');
  assert.notEqual(section18Start, -1);
  const section19Start = matrix.indexOf('\n## 19.', section18Start);
  assert.notEqual(section19Start, -1);
  const section18 = matrix.slice(section18Start, section19Start);

  assert.equal(summary.redactionRequired, true);
  assert.equal(artifact.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);

  for (const sourceDefinition of [
    /export function createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign\b/u,
    /export function assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility\b/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    new RegExp(`test\\('${sourceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'`, 'u'),
    /createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign\(/u,
    /assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility\(design\)/u,
    /\bsourceHandshake\b/u,
    /\bsourcePreflight\b/u,
    /\brequiredHandshakeGuard\b/u,
    /\brequiredPreflightGuard\b/u,
    /\bsourceHandshake\.adapterName\b/u,
    /synthetic-observability-adapter-from-source-handshake/u,
    /\bconsumerIntegrationEnabled\b/u,
    /\bruntimeConsumerEnabled\b/u,
    /\bregistrationAllowed\b/u,
    /\bproducerRegistrationAllowed\b/u,
    /\bsubscriberRegistrationAllowed\b/u,
    /\btelemetryDispatchAllowed\b/u,
    /\bruntimeDispatchAllowed\b/u,
  ]) {
    assert.match(consumerIntegrationSourceTest, sourceEvidence);
  }

  for (const matrixEvidence of [
    /Current status: `verified`/u,
    /createDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesign\(\)/u,
    /assertDisabledGraphDocsLifecycleObservabilityConsumerIntegrationDesignCompatibility\(\)/u,
    new RegExp(sourceTestName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    /\bsourceHandshake\b/u,
    /\bsourcePreflight\b/u,
    /\brequiredHandshakeGuard\b/u,
    /\brequiredPreflightGuard\b/u,
    /does not enable runtime consumer integration/u,
    /subscriber registration/u,
    /producer registration/u,
    /external telemetry/u,
    /dispatch writes/u,
    /log writes/u,
    /artifact writes/u,
  ]) {
    assert.match(section18, matrixEvidence);
  }

  const consumerIntegrationEvidenceLines = section18
    .split('\n')
    .filter((line) => /disabled\/no-op Layer observability consumer integration design evidence/u.test(line));
  assert.equal(consumerIntegrationEvidenceLines.length >= 1, true);
  for (const evidenceLine of consumerIntegrationEvidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /runtime consumer integration enabled|runtimeConsumerEnabled=true|consumerIntegrationEnabled=true|producerRegistrationAllowed=true|subscriberRegistrationAllowed=true|telemetryDispatchAllowed=true|runtimeDispatchAllowed=true|external telemetry connected|dispatch write enabled|log write enabled|artifact write enabled|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }

  assert.match(section18, /Section 18 pre-final partial state is superseded by the 2026-05-08 final validation gate/u);
  assert.doesNotMatch(
    markdown,
    /external telemetry enabled|runtime dispatch enabled|subscriber registration enabled|runtime log write enabled|runtime artifact write enabled|runtime producer registered|telemetry subscriber registered|runtime consumer integration enabled|Authorization|cookie|sessionId|browserProfile/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers lifecycle observability registration owner preflight evidence', async () => {
  const [matrix, graphSource, observabilityTest, matrixTest] = await Promise.all([
    readMatrix(),
    readSource(GRAPH_URL),
    readSource(OBSERVABILITY_TEST_URL),
    readSource(MATRIX_TEST_URL),
  ]);
  const section18 = matrix.match(/^## 18\. [\s\S]*?(?=^## 19\. )/mu)?.[0] ?? '';
  const sourceTestName =
    'graph docs lifecycle observability registration owner preflight stays disabled before registration';
  const testStart = observabilityTest.indexOf(`test('${sourceTestName}'`);
  assert.notEqual(testStart, -1);
  const nextTestStart = observabilityTest.indexOf('\ntest(', testStart + 1);
  const registrationOwnerPreflightTest = observabilityTest.slice(
    testStart,
    nextTestStart === -1 ? observabilityTest.length : nextTestStart,
  );

  for (const sourceDefinition of [
    /export function createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight\b/u,
    /export function assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility\b/u,
    /GRAPH_RUNTIME_CONSUMER_DISABLED_REASON_CODE/u,
  ]) {
    assert.match(graphSource, sourceDefinition);
  }

  for (const sourceEvidence of [
    /assertGraphDocsLifecycleObservabilityRuntimeImplementationPreflightCompatibility/u,
    /registrationOwnershipPlan/u,
    /producerOwner/u,
    /subscriberOwner/u,
    /producerRegistrationAllowed/u,
    /subscriberRegistrationAllowed/u,
    /telemetryDispatchAllowed/u,
    /runtimeLogWriteEnabled/u,
    /sessionMaterializationEnabled/u,
    /registerProducer/u,
    /registerSubscriber/u,
    /telemetrySink/u,
    /siteAdapter/u,
    /downloader/u,
    /synthetic-secret-value/u,
  ]) {
    assert.match(registrationOwnerPreflightTest, sourceEvidence);
  }

  assert.match(
    matrixTest,
    /Site Capability Graph Section 18 records registration owner preflight evidence without runtime registration/u,
  );
  assert.match(section18, /Current status: `verified`/u);
  for (const matrixEvidence of [
    /Current round registration-owner preflight evidence/u,
    /Current round registration-owner preflight verification update/u,
    /createGraphDocsLifecycleObservabilityRegistrationOwnerPreflight\(\)/u,
    /assertGraphDocsLifecycleObservabilityRegistrationOwnerPreflightCompatibility\(\)/u,
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
    /Section 18 pre-final partial state is superseded by the 2026-05-08 final validation gate/u,
  ]) {
    assert.match(section18, matrixEvidence);
  }

  const evidenceLines = section18
    .split('\n')
    .filter((line) => /registration-owner preflight (?:evidence|verification update)/u.test(line));
  assert.equal(evidenceLines.length >= 2, true);
  for (const evidenceLine of evidenceLines) {
    assert.doesNotMatch(
      evidenceLine,
      /runtime producer registered|runtime subscriber registered|producer registration enabled|subscriber registration enabled|telemetry dispatch enabled|runtime dispatch enabled|runtime log write enabled|runtime artifact write enabled|artifact writes enabled|SiteAdapter invoked|downloader invoked|SessionView materialized|Authorization: Bearer|synthetic-secret-value/iu,
    );
  }
});

test('GraphDocsSummary matrix cross-check covers legacy catalogAction absence evidence', async () => {
  const [matrix, docsGeneratorTest] = await Promise.all([
    readMatrix(),
    readSource(DOCS_GENERATOR_TEST_URL),
  ]);

  assert.match(
    docsGeneratorTest,
    /test\('docs renderer omits catalogAction for legacy failure modes without catalog descriptors'/u,
  );
  assert.match(
    docsGeneratorTest,
    /\(entry\) => entry\.failureModeId === 'failure:graph-schema-invalid'/u,
  );
  assert.match(docsGeneratorTest, /assert\.equal\('catalogAction' in legacyFailureMode, false\)/u);
  assert.match(docsGeneratorTest, /assert\.doesNotMatch\(legacyMarkdown, \/catalogAction:\/u\)/u);
  assert.match(
    docsGeneratorTest,
    /catalog mutation\|catalog write\|catalog promotion\|deprecating catalog\|blocking catalog\|runtime deprecation/u,
  );

  for (const matrixEvidence of [
    /docs renderer omits catalogAction for legacy failure modes without catalog descriptors/u,
    /legacy catalogAction absence coverage/u,
    /does not synthesize catalogAction/u,
    /Markdown omits `catalogAction:`/u,
    /without catalog mutation/u,
    /without catalog write/u,
    /without catalog promotion/u,
    /without runtime deprecation/u,
    /without SiteAdapter runtime/u,
    /without downloader/u,
    /without SessionView/u,
  ]) {
    assert.match(matrix, matrixEvidence);
  }
  assert.doesNotMatch(
    matrix,
    /legacy catalogAction absence coverage[^.\n]*(?:synthesizes catalogAction|catalogAction default|enables catalog mutation|enables catalog write|enables catalog promotion|runtime deprecation enabled)/iu,
  );
});

test('GraphDocsSummary matrix cross-check covers Layer design source references', async () => {
  const graph = await readMinimalGraphFixture();
  const matrix = await readMatrix();
  const summary = generateGraphDocsSummary(graph);
  const references = summary.sections.layerDesignSourceReferences;

  await assert.rejects(() => access(LAYER_DESIGN_URL), /ENOENT/u);
  assert.equal(summary.redactionRequired, true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(summary), true);
  assert.deepEqual(references.map((entry) => entry.path), [
    'docs/site-capability-layer/DESIGN.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    'README.md',
  ]);

  const missingLayerDesign = references.find((entry) => entry.path === 'docs/site-capability-layer/DESIGN.md');
  assert.equal(missingLayerDesign.status, 'missing');
  assert.equal(missingLayerDesign.verified, false);

  for (const referencePath of [
    'docs/site-capability-layer/DESIGN.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    'README.md',
  ]) {
    assert.match(matrix, new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.match(matrix, /Layer design source references/u);
  assert.match(matrix, /missing Layer design path/u);
  assert.match(matrix, /fallback refs|current fallback references/u);
  assert.doesNotMatch(matrix, /docs\/site-capability-layer\/DESIGN\.md[^.\n]*(?:is present|exists|verified=true)/iu);

  await assert.rejects(() => access(LAYER_DESIGN_URL), /ENOENT/u);
});

test('GraphDocsSummary matrix cross-check covers Markdown artifact Layer source references', async () => {
  const graph = await readMinimalGraphFixture();
  const matrix = await readMatrix();
  const summary = generateGraphDocsSummary(graph);
  const artifact = createGraphDocsMarkdownArtifact(summary);
  const markdown = artifact.items[0].markdown;

  await assert.rejects(() => access(LAYER_DESIGN_URL), /ENOENT/u);
  assert.equal(artifact.redactionRequired, true);
  assert.equal(assertGraphDocsMarkdownArtifactConsumerCompatibility(artifact), true);
  assert.equal(assertGraphDerivedArtifactWriteAllowed(artifact), true);

  for (const referencePath of [
    'docs/site-capability-layer/DESIGN.md',
    'CONTRIBUTING.md',
    'AGENTS.md',
    'README.md',
  ]) {
    assert.match(markdown, new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(matrix, new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.match(markdown, /status: missing/u);
  assert.match(markdown, /verified: false/u);
  assert.match(matrix, /Markdown artifact descriptor coverage for Layer source references/u);
  assert.match(matrix, /GraphDocsSummary Markdown artifact descriptors/u);
  assert.match(matrix, /without writing artifacts/u);
  assert.doesNotMatch(markdown, /runtime docs writes enabled|repo writes enabled|external telemetry enabled/iu);

  await assert.rejects(() => access(LAYER_DESIGN_URL), /ENOENT/u);
});
