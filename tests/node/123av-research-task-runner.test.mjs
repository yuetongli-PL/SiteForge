import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  runOneTwoThreeAvResearchTask,
} from '../../scripts/123av-research-task-runner.mjs';

const execFileAsync = promisify(execFile);
const RUNNER_PATH = fileURLToPath(new URL('../../scripts/123av-research-task-runner.mjs', import.meta.url));
const PUBLIC_METADATA_AUTHORIZED_FIELDS = [
  'schemaVersion',
  'siteKey',
  'taskId',
  'itemId',
  'publicTitle',
  'publicDetailUrl',
  'routeTemplate',
  'sourceNodeId',
  'sourceNodeType',
  'sourceFieldMap',
  'publicUrlHash',
  'evidenceHash',
  'rank',
  'observedAt',
  'exportPolicy',
  'authorizationScope',
  'rawHtmlSaved',
  'rawBodySaved',
  'mediaAssetsWritten',
  'authMaterialSaved',
];
const DEFAULT_ARTIFACT_FORBIDDEN_PATTERN =
  /https:\/\/123av\.com\/|sensitive-title-slug|sensitive-tag-slug|sensitive-name|sensitive body|sensitive title must not be serialized|Synthetic public metadata item|synthetic-public-metadata-item/u;
const DEFAULT_TEXT_ARTIFACTS = [
  'task-plan.json',
  'task-state.json',
  'task-summary.json',
  'task-report.md',
  'raw-items.jsonl',
  'deduped-items.jsonl',
  path.join('authors', 'items.jsonl'),
  path.join('accounts', 'items.jsonl'),
  'cache-index.json',
  'cache-index.jsonl',
  path.join('archive', 'index.md'),
  path.join('archive', 'keyword-trend.md'),
  path.join('archive', 'route-samples.md'),
];

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createBuildFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-123av-task-'));
  await writeJson(path.join(dir, 'graph.json'), {
    schemaVersion: 1,
    buildId: 'fixture-build',
    nodes: [
      {
        id: 'node:search',
        type: 'operation',
        pageType: 'search_control_group',
        structureType: 'search_control_group',
        linkSemanticKind: 'search',
        routeTemplate: '/search',
        url: 'https://123av.com/search?keyword=sensitive-query',
      },
      {
        id: 'node:ranking',
        type: 'component',
        pageType: 'ranking_link_group',
        structureType: 'ranking_link_group',
        linkSemanticKind: 'ranking',
        routeTemplate: '/dm9/trending',
        url: 'https://123av.com/dm9/trending',
      },
      {
        id: 'node:tag',
        type: 'component',
        pageType: 'tag_link_group',
        structureType: 'tag_link_group',
        linkSemanticKind: 'tag',
        routeTemplate: '/tags/sensitive-tag-slug',
        url: 'https://123av.com/tags/sensitive-tag-slug',
      },
      {
        id: 'node:detail',
        type: 'component',
        pageType: 'detail_link_group',
        structureType: 'detail_link_group',
        linkSemanticKind: 'detail',
        routeTemplate: '/zh/v/sensitive-title-slug',
        url: 'https://123av.com/zh/v/sensitive-title-slug',
      },
      {
        id: 'node:profile',
        type: 'component',
        pageType: 'profile_link_group',
        structureType: 'profile_link_group',
        linkSemanticKind: 'profile',
        routeTemplate: '/zh/actresses/sensitive-name',
        url: 'https://123av.com/zh/actresses/sensitive-name',
      },
      {
        id: 'node:private-list',
        type: 'component',
        pageType: 'profile_link_group',
        structureType: 'profile_link_group',
        linkSemanticKind: 'profile',
        routeTemplate: '/user/collection',
        url: 'https://123av.com/user/collection',
      },
      {
        id: 'node:raw-content',
        type: 'content',
        title: 'sensitive title must not be serialized',
        text: 'sensitive body must not be serialized',
      },
      {
        id: 'node:public-metadata-content',
        type: 'content',
        routeTemplate: '/zh/v/synthetic-public-metadata-item',
        url: 'https://123av.com/zh/v/synthetic-public-metadata-item',
        title: 'Synthetic public metadata item',
      },
    ],
  });
  await writeJson(path.join(dir, 'capabilities.json'), {
    schemaVersion: 1,
    buildId: 'fixture-build',
    capabilities: [
      { id: 'capability:test:search-catalog-content', name: 'search catalog content' },
      { id: 'capability:test:search-public-content', name: 'search public content' },
      { id: 'capability:test:browse-public-rankings', name: 'browse public rankings' },
      { id: 'capability:test:browse-public-tags', name: 'browse public tags' },
      { id: 'capability:test:browse-public-categories', name: 'browse public categories' },
      { id: 'capability:test:open-public-detail-pages', name: 'open public detail pages' },
      { id: 'capability:test:open-public-profiles', name: 'open public profiles' },
      { id: 'capability:test:disabled-delete-action', name: 'disabled delete action' },
    ],
  });
  await writeJson(path.join(dir, 'execution_plans.json'), {
    schemaVersion: 1,
    buildId: 'fixture-build',
    executionPlans: [],
  });
  await writeJson(path.join(dir, 'execution_contracts.json'), {
    schemaVersion: 1,
    buildId: 'fixture-build',
    executionContracts: [],
  });
  await writeJson(path.join(dir, 'verification_report.json'), {
    schemaVersion: 1,
    buildId: 'fixture-build',
    status: 'passed',
  });
  return dir;
}

test('123av research task runner writes sanitized resumable artifacts with API fallback policy', async () => {
  const buildDir = await createBuildFixture();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-123av-task-out-'));
  try {
    const result = await runOneTwoThreeAvResearchTask({
      task: 'keyword-trend',
      query: 'sensitive-query',
      buildDir,
      outDir,
      execute: true,
      now: '2026-06-09',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.summary.apiFirst.activeApiCapabilities, 0);
    assert.equal(result.summary.apiFirst.apiAttempted, false);
    assert.equal(result.summary.apiFirst.fallbackUsed, true);
    assert.equal(result.summary.execution.verificationStatus, 'passed');
    assert.equal(result.summary.safety.publicMetadataExport.status, 'not_enabled');
    assert.equal(result.summary.safety.publicMetadataExport.reasonCode, 'authorized-public-metadata-contract-required');

    const plan = JSON.parse(await readFile(path.join(outDir, 'task-plan.json'), 'utf8'));
    assert.equal(plan.buckets[0].primary.verified, false);
    assert.equal(plan.buckets[0].primary.reasonCode, 'no-verified-public-api');
    assert.equal(plan.buckets[0].siteFallback.verified, true);
    assert.equal(plan.artifactContract.fieldPolicy.publicMetadataExport.status, 'not_enabled');
    assert.equal(plan.artifactContract.optional.publicMetadataItems, null);

    const dedupedText = await readFile(path.join(outDir, 'deduped-items.jsonl'), 'utf8');
    assert.doesNotMatch(dedupedText, DEFAULT_ARTIFACT_FORBIDDEN_PATTERN);
    assert.match(dedupedText, /\/tags\/:tagSlug/u);
    assert.match(dedupedText, /\/zh\/v\/:contentSlug/u);

    for (const artifactPath of DEFAULT_TEXT_ARTIFACTS) {
      const artifactText = await readFile(path.join(outDir, artifactPath), 'utf8');
      assert.doesNotMatch(artifactText, DEFAULT_ARTIFACT_FORBIDDEN_PATTERN, artifactPath);
      assert.doesNotMatch(artifactText, /Bearer\s+[A-Za-z0-9._-]+|Set-Cookie:|Cookie:/iu, artifactPath);
    }
    const reportText = await readFile(path.join(outDir, 'task-report.md'), 'utf8');
    assert.match(reportText, /Public metadata export: not_enabled \(authorized-public-metadata-contract-required\)/u);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test('123av public metadata export is explicit opt-in and writes a separate artifact', async () => {
  await assert.rejects(
    () => runOneTwoThreeAvResearchTask({
      task: 'list-history-collection',
      allowPublicMetadataExport: true,
    }),
    /publicMetadataScope is required/u,
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      RUNNER_PATH,
      '--task',
      'list-history-collection',
      '--allow-public-metadata-export',
      '--json',
    ]),
    /--public-metadata-scope is required with --allow-public-metadata-export/u,
  );

  const buildDir = await createBuildFixture();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-123av-public-metadata-out-'));
  try {
    const result = await runOneTwoThreeAvResearchTask({
      task: 'list-history-collection',
      route: '/zh/dm9/weekly-hot',
      buildDir,
      outDir,
      execute: true,
      allowPublicMetadataExport: true,
      publicMetadataScope: 'public-title-detail-url',
      now: '2026-06-09',
    });

    assert.equal(result.summary.safety.publicMetadataExport.status, 'enabled');
    assert.equal(result.summary.safety.publicMetadataExport.savedMaterial, 'authorized_public_metadata');
    assert.equal(result.summary.execution.publicMetadataItemCount, 1);
    assert.equal(result.summary.artifacts.publicMetadataItems, path.join(outDir, 'public-metadata-items.jsonl'));

    const metadataRows = (await readFile(path.join(outDir, 'public-metadata-items.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(metadataRows.length, 1);
    assert.deepEqual(Object.keys(metadataRows[0]), PUBLIC_METADATA_AUTHORIZED_FIELDS);
    assert.deepEqual(
      result.summary.safety.publicMetadataExport.allowedFieldsWhenAuthorized,
      PUBLIC_METADATA_AUTHORIZED_FIELDS,
    );
    assert.equal(metadataRows[0].publicTitle, 'Synthetic public metadata item');
    assert.equal(metadataRows[0].publicDetailUrl, 'https://123av.com/zh/v/synthetic-public-metadata-item');
    assert.equal(metadataRows[0].routeTemplate, '/zh/v/:contentSlug');
    assert.equal(metadataRows[0].exportPolicy, 'authorized_public_metadata');
    assert.equal(metadataRows[0].authorizationScope, 'public-title-detail-url');
    assert.equal(metadataRows[0].rawHtmlSaved, false);
    assert.equal(metadataRows[0].rawBodySaved, false);
    assert.equal(metadataRows[0].mediaAssetsWritten, false);
    assert.equal(metadataRows[0].authMaterialSaved, false);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test('123av production catalog documents explicit public metadata export contract', async () => {
  const catalog = JSON.parse(await readFile(
    new URL('../../skills/123av/references/123av-live-catalog.json', import.meta.url),
    'utf8',
  ));
  const optional = catalog.standardArtifactContract.optional.find((entry) => entry.path === 'public-metadata-items.jsonl');
  assert.equal(optional.enabledBy, '--allow-public-metadata-export --public-metadata-scope <scope>');
  assert.equal(optional.savedMaterial, 'authorized_public_metadata');
  assert.deepEqual(optional.allowedFields, PUBLIC_METADATA_AUTHORIZED_FIELDS);
  assert.equal(catalog.safety.optionalPublicMetadataSavedMaterial, 'authorized_public_metadata');
});

test('123av list/history task records private account list routes as blocked boundaries', async () => {
  const buildDir = await createBuildFixture();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'siteforge-123av-list-out-'));
  try {
    const result = await runOneTwoThreeAvResearchTask({
      task: 'list-history-collection',
      route: '/zh/dm9/trending',
      buildDir,
      outDir,
      execute: true,
      now: '2026-06-09',
    });
    assert.equal(result.summary.execution.blockedBoundaryItemCount, 1);
    assert.equal(result.summary.safety.mutationActionsBlocked, true);
    const accountItems = await readFile(path.join(outDir, 'accounts', 'items.jsonl'), 'utf8');
    assert.match(accountItems, /blocked-account-or-private-list-route/u);
    assert.doesNotMatch(accountItems, /https:\/\/123av\.com\/user\/collection/u);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});
