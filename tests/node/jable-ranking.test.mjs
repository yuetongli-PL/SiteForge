import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { queryJableRanking } from '../../src/entrypoints/sites/jable-ranking.mjs';
import {
  buildJableTaxonomyIndex,
  normalizeJableRankingLabel,
  parseJableVideoCardsFromHtml,
  resolveJableRankingTarget,
  resolveJableSortMode,
} from '../../src/sites/known-sites/jable/queries/ranking.mjs';

async function assertMissing(filePath) {
  await assert.rejects(access(filePath), /ENOENT/u);
}

test('normalizeJableRankingLabel folds simplified and traditional labels', () => {
  assert.equal(normalizeJableRankingLabel('黑丝分类'), '黑丝');
  assert.equal(normalizeJableRankingLabel('#黑絲'), '黑丝');
  assert.equal(normalizeJableRankingLabel('衣著分類'), '衣着');
});

test('resolveJableSortMode maps recommendation phrases to combined ranking', () => {
  assert.equal(resolveJableSortMode('近期最佳推荐三部').sortMode, 'combined');
  assert.equal(resolveJableSortMode('最近更新前五条').sortMode, 'recent');
  assert.equal(resolveJableSortMode('最多观看前三').sortMode, 'most-viewed');
  assert.equal(resolveJableSortMode('最高收藏前三').sortMode, 'most-favourited');
});

test('resolveJableRankingTarget prefers concrete tags over category groups', () => {
  const taxonomyIndex = buildJableTaxonomyIndex([
    {
      groupLabel: '衣著',
      tags: [
        { label: '黑絲', href: 'https://jable.tv/tags/black-pantyhose/' },
        { label: 'Cosplay', href: 'https://jable.tv/tags/Cosplay/' },
      ],
    },
    {
      groupLabel: '身材',
      tags: [
        { label: '巨乳', href: 'https://jable.tv/tags/big-tits/' },
      ],
    },
  ]);

  const tagResolution = resolveJableRankingTarget('黑丝分类，近期最佳推荐三部', taxonomyIndex);
  assert.equal(tagResolution.target?.scopeType, 'tag');
  assert.equal(tagResolution.target?.displayLabel, '黑絲');

  const groupResolution = resolveJableRankingTarget('衣着分类最高收藏前三', taxonomyIndex);
  assert.equal(groupResolution.target?.scopeType, 'group');
  assert.equal(groupResolution.target?.displayLabel, '衣著');
});

test('parseJableVideoCardsFromHtml extracts title, url, views and favourites', () => {
  const html = `
    <div class="video-img-box mb-e-20">
      <div class="detail">
        <h6 class="title"><a href="https://jable.tv/videos/ipx-238-c/">IPX-238 測試標題</a></h6>
        <p class="sub-title">
          <svg><use xlink:href="#icon-eye"></use></svg>249 488
          <svg><use xlink:href="#icon-heart-inline"></use></svg>1006
        </p>
      </div>
    </div>
    <div class="video-img-box mb-e-20">
      <div class="detail">
        <h6 class="title"><a href="https://jable.tv/videos/jur-652/">JUR-652 第二條</a></h6>
        <p class="sub-title">
          <svg><use xlink:href="#icon-eye"></use></svg>152 790
          <svg><use xlink:href="#icon-heart-inline"></use></svg>539
        </p>
      </div>
    </div>
  `;

  const rows = parseJableVideoCardsFromHtml(html, 'https://jable.tv/tags/Cosplay/?sort_by=video_viewed');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'IPX-238 測試標題');
  assert.equal(rows[0].views, 249488);
  assert.equal(rows[0].favourites, 1006);
  assert.equal(rows[1].videoUrl, 'https://jable.tv/videos/jur-652/');
});

test('queryJableRanking can plan without registry or capability metadata writes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'jable-ranking-no-metadata-'));
  try {
    const kbDir = path.join(workspace, 'kb', 'jable.tv');
    const statesDir = path.join(kbDir, 'raw', 'analysis');
    const configDir = path.join(workspace, 'config');
    await mkdir(path.join(kbDir, 'index'), { recursive: true });
    await mkdir(statesDir, { recursive: true });
    await mkdir(configDir, { recursive: true });

    await writeFile(path.join(kbDir, 'index', 'sources.json'), JSON.stringify({
      activeSources: [{
        step: 'step-3-analysis',
        runId: 'fixture-analysis',
        rawDir: 'raw/analysis',
      }],
    }), 'utf8');
    await writeFile(path.join(statesDir, 'states.json'), JSON.stringify({
      baseUrl: 'https://jable.tv/',
      states: [{
        pageFacts: {
          categoryTaxonomy: [{
            groupLabel: 'Costume',
            tags: [{
              label: 'Cosplay',
              href: 'https://jable.tv/tags/Cosplay/',
            }],
          }],
        },
      }],
    }), 'utf8');

    const registryPath = path.join(configDir, 'site-registry.json');
    const originalRegistryText = JSON.stringify({
      version: 1,
      generatedAt: null,
      sites: {
        'jable.tv': {
          host: 'jable.tv',
          canonicalBaseUrl: 'https://jable.tv/',
          knowledgeBaseDir: kbDir,
        },
      },
    }, null, 2);
    await writeFile(registryPath, `${originalRegistryText}\n`, 'utf8');

    const result = await queryJableRanking('https://jable.tv/', {
      workspaceRoot: workspace,
      targetLabel: 'cosplay',
      limit: 1,
      writeSiteMetadata: false,
      fetchHtml: async () => `
        <div class="video-img-box mb-e-20">
          <div class="detail">
            <h6 class="title"><a href="https://jable.tv/videos/fixture-001/">Fixture 001</a></h6>
            <p class="sub-title">
              <svg><use xlink:href="#icon-eye"></use></svg>1 234
              <svg><use xlink:href="#icon-heart-inline"></use></svg>56
            </p>
          </div>
        </div>
      `,
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteMetadata.written, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, 'Fixture 001');
    assert.equal(await readFile(registryPath, 'utf8'), `${originalRegistryText}\n`);
    await assertMissing(path.join(configDir, 'site-capabilities.json'));
    await assertMissing(path.join(workspace, 'runs', 'site-metadata', 'site-registry.runtime.json'));
    await assertMissing(path.join(workspace, 'runs', 'site-metadata', 'site-capabilities.runtime.json'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('queryJableRanking can live-read a direct tag URL without a local taxonomy KB', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'jable-ranking-direct-url-'));
  try {
    const result = await queryJableRanking('https://jable.tv/tags/Cosplay/', {
      workspaceRoot: workspace,
      limit: 1,
      writeSiteMetadata: false,
      fetchHtml: async () => `
        <div class="video-img-box mb-e-20">
          <div class="detail">
            <h6 class="title"><a href="https://jable.tv/videos/fixture-002/">Fixture 002</a></h6>
            <p class="sub-title">
              <svg><use xlink:href="#icon-eye"></use></svg>2 345
              <svg><use xlink:href="#icon-heart-inline"></use></svg>67
            </p>
          </div>
        </div>
      `,
    });

    assert.equal(result.ok, true);
    assert.equal(result.siteMetadata.written, false);
    assert.equal(result.resolvedTarget.source, 'direct-url');
    assert.equal(result.resolvedTarget.targetUrl, 'https://jable.tv/tags/Cosplay/');
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].title, 'Fixture 002');
    await assertMissing(path.join(workspace, 'config', 'site-registry.json'));
    await assertMissing(path.join(workspace, 'config', 'site-capabilities.json'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
