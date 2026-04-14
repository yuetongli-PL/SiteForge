import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJableTaxonomyIndex,
  normalizeJableRankingLabel,
  parseJableVideoCardsFromHtml,
  resolveJableRankingTarget,
  resolveJableSortMode,
} from '../../lib/jable-ranking.mjs';

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

