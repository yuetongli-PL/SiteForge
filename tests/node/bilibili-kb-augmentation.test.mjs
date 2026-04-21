import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bilibiliKnowledgeBaseAugmentation,
  buildBilibiliStateAttributeFacts,
  renderBilibiliOverviewSections,
  renderBilibiliStateSections,
} from '../../src/sites/bilibili/kb/augmentation.mjs';

test('bilibili KB augmentation builds overview and state attributes from surfaced page facts', () => {
  const state = {
    pageFacts: {
      bv: 'BV1WjDDBGE3p',
      authorMid: '1202350411',
      searchFamily: 'all',
      queryText: 'BV1WjDDBGE3p',
      featuredAuthorCards: [
        { name: 'UP A', url: 'https://space.bilibili.com/1202350411', mid: '1202350411', cardKind: 'author' },
      ],
      featuredContentCards: [
        { title: 'Video A', url: 'https://www.bilibili.com/video/BV1WjDDBGE3p', bvid: 'BV1WjDDBGE3p', authorMid: '1202350411', contentType: 'video' },
      ],
    },
  };
  const model = { states: [state] };

  const stateFacts = buildBilibiliStateAttributeFacts(state.pageFacts);
  assert.equal(stateFacts.bv, 'BV1WjDDBGE3p');
  assert.equal(stateFacts.authorMid, '1202350411');
  assert.equal(stateFacts.featuredContentCount, 1);

  const overviewAttributes = bilibiliKnowledgeBaseAugmentation.buildOverviewAttributes(model);
  assert.deepEqual(overviewAttributes.bilibiliFacts.videoCodes, ['BV1WjDDBGE3p']);

  const stateAttributes = bilibiliKnowledgeBaseAugmentation.buildStateAttributes(state);
  assert.equal(stateAttributes.bilibiliFacts.bv, 'BV1WjDDBGE3p');
  assert.equal(typeof bilibiliKnowledgeBaseAugmentation.renderStateSections, 'function');
});

test('bilibili KB augmentation renders overview sections with surfaced facts summary', () => {
  const sections = renderBilibiliOverviewSections({
    model: {
      states: [
        {
          pageFacts: {
            bv: 'BV1WjDDBGE3p',
            authorMid: '1202350411',
            searchFamily: 'all',
            authenticatedReadOnlySurface: true,
            loginStateDetected: true,
            authorSubpage: 'follow',
            featuredAuthorCards: [
              { name: 'UP A', url: 'https://space.bilibili.com/1202350411', mid: '1202350411', authorSubpage: 'follow', cardKind: 'author' },
            ],
            featuredContentCards: [
              { title: 'Video A', url: 'https://www.bilibili.com/video/BV1WjDDBGE3p', bvid: 'BV1WjDDBGE3p', authorMid: '1202350411', contentType: 'video' },
            ],
          },
          stateId: 's0001',
        },
      ],
    },
    renderTable(headers, rows) {
      return JSON.stringify({ headers, rows });
    },
    mdEscape(value) {
      return String(value);
    },
  });

  const rendered = sections.join('\n');
  assert.match(rendered, /Surfaced bilibili facts/u);
  assert.match(rendered, /BV1WjDDBGE3p/u);
  assert.match(rendered, /Authenticated session active during compilation: yes/u);
  assert.match(rendered, /Authenticated surface summaries/u);
});

test('bilibili KB augmentation renderStateSections returns empty sections without surfaced bilibili facts', () => {
  const sections = renderBilibiliStateSections({
    model: { states: [] },
    state: { pageFacts: null },
    edge: null,
    page: { attributes: {} },
    pagesById: new Map(),
    renderTable() {
      throw new Error('renderTable should not be called when no sections render');
    },
    mdEscape(value) {
      return String(value);
    },
  });

  assert.deepEqual(sections, []);
});

test('bilibili KB augmentation renders state sections from bilibili facts and featured cards', () => {
  const tableCalls = [];
  const sections = bilibiliKnowledgeBaseAugmentation.renderStateSections({
    model: { states: [] },
    state: {
      stateId: 's0001',
      pageFacts: {
        queryText: 'should-not-be-needed-when-page-attributes-exist',
      },
    },
    edge: { observedStateId: 's0001' },
    page: {
      attributes: {
        bilibiliFacts: {
          bv: 'BV1WjDDBGE3p',
          authorMid: '1202350411',
          searchFamily: 'all',
          contentType: 'video',
          firstResultContentType: 'video',
          authorSubpage: 'follow',
          authenticatedReadOnlySurface: true,
          featuredAuthorCount: 1,
          featuredAuthors: [
            { name: 'UP A', mid: '1202350411' },
          ],
          featuredContentCount: 1,
          categoryName: '动画',
          categoryPath: '/v/anime',
          featuredContentCards: [
            {
              title: 'Video A',
              url: 'https://www.bilibili.com/video/BV1WjDDBGE3p',
              bvid: 'BV1WjDDBGE3p',
              authorMid: '1202350411',
              contentType: 'video',
            },
          ],
          featuredAuthorCards: [
            {
              name: 'UP A',
              url: 'https://space.bilibili.com/1202350411',
              mid: '1202350411',
              authorSubpage: 'follow',
            },
          ],
        },
      },
    },
    pagesById: new Map(),
    renderTable(headers, rows) {
      tableCalls.push({ headers, rows });
      return `TABLE_${tableCalls.length}`;
    },
    mdEscape(value) {
      return String(value);
    },
  });

  assert.equal(tableCalls.length, 3);
  assert.deepEqual(tableCalls[0].headers, ['Field', 'Value']);
  assert.deepEqual(tableCalls[1].headers, ['Title', 'Content Type', 'BV', 'UP Mid']);
  assert.deepEqual(tableCalls[2].headers, ['Name', 'MID', 'Author URL', 'Author Subpage']);

  assert.deepEqual(tableCalls[1].rows, [
    {
      title: 'Video A',
      contentType: 'video',
      bvid: 'BV1WjDDBGE3p',
      authorMid: '1202350411',
    },
  ]);
  assert.deepEqual(tableCalls[2].rows, [
    {
      name: 'UP A',
      mid: '1202350411',
      url: 'https://space.bilibili.com/1202350411',
      authorSubpage: 'follow',
    },
  ]);

  const rendered = sections.join('\n');
  assert.match(rendered, /Surfaced bilibili facts/u);
  assert.match(rendered, /Featured Content Cards/u);
  assert.match(rendered, /Featured Author Cards/u);
  assert.match(rendered, /TABLE_1/u);
  assert.match(rendered, /TABLE_2/u);
  assert.match(rendered, /TABLE_3/u);

  const factRows = tableCalls[0].rows;
  assert.ok(factRows.some((row) => row.field === 'Search Family' && row.value === '`all`'));
  assert.ok(factRows.some((row) => row.field === 'BV' && row.value === '`BV1WjDDBGE3p`'));
  assert.ok(factRows.some((row) => row.field === 'UP Mid' && row.value === '`1202350411`'));
  assert.ok(factRows.some((row) => row.field === 'Authenticated Read-only Surface' && row.value === 'yes'));
  assert.ok(factRows.some((row) => row.field === 'Featured Authors' && row.value === 'UP A | MID 1202350411'));
  assert.ok(factRows.some((row) => row.field === 'Category Path' && row.value === '`/v/anime`'));
});
