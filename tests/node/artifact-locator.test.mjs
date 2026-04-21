import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  artifactUrlMatchesLocator,
  buildHostKeyedDirCandidates,
  resolveArtifactLocatorContext,
} from '../../src/sites/core/artifact-locator.mjs';

test('artifact locator resolves host-key candidates from canonical site context without renaming directories', async () => {
  const locator = await resolveArtifactLocatorContext({
    workspaceRoot: 'C:\\workspace',
    inputUrl: 'https://example.invalid/',
    siteContext: {
      host: 'example.invalid',
      registryRecord: {
        canonicalBaseUrl: 'https://www.douyin.com/?recommend=1',
      },
      capabilitiesRecord: {
        siteKey: 'douyin',
        adapterId: 'douyin',
        baseUrl: 'https://www.douyin.com/?recommend=1',
      },
    },
  });

  const candidates = buildHostKeyedDirCandidates(locator, 'knowledge-base', { includeRoot: true });
  assert.ok(candidates.some((candidate) => candidate.hostKey === 'example.invalid'));
  assert.ok(candidates.some((candidate) => candidate.hostKey === 'www.douyin.com'));
  assert.equal(candidates.at(-1).dirPath, path.join('C:\\workspace', 'knowledge-base'));
});

test('artifact locator host matching accepts any resolved host-key candidate', async () => {
  const locator = await resolveArtifactLocatorContext({
    workspaceRoot: 'C:\\workspace',
    inputUrl: 'https://example.invalid/',
    siteContext: {
      host: 'example.invalid',
      capabilitiesRecord: {
        siteKey: 'bilibili',
        adapterId: 'bilibili',
        baseUrl: 'https://www.bilibili.com/',
      },
    },
  });

  assert.equal(artifactUrlMatchesLocator(locator, 'https://example.invalid/anything'), true);
  assert.equal(artifactUrlMatchesLocator(locator, 'https://www.bilibili.com/video/BV1WjDDBGE3p'), true);
  assert.equal(artifactUrlMatchesLocator(locator, 'https://jable.tv/videos/ipx-001/'), false);
});
