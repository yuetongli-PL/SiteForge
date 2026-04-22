import test from 'node:test';
import assert from 'node:assert/strict';

import { renderKnownSiteDocument } from '../../src/skills/generation/render/site-renderers.mjs';

function renderTable(headers, rows) {
  const normalizedRows = rows.map((row) => headers.map((header) => {
    const key = header.toLowerCase().replace(/[^a-z]+/g, '');
    return row[key] ?? row[header] ?? Object.values(row)[0] ?? '';
  }));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function buildInput() {
  const context = {
    skillName: 'douyin',
    url: 'https://www.douyin.com/',
    siteContext: { host: 'www.douyin.com' },
    intentsDocument: {
      intents: [
        { intentId: 'i1', intentType: 'search-video', actionId: 'search-submit', elementId: 'search', stateField: 'queryText', targetDomain: { actionableValues: [{ value: 'q1', label: '\u65c5\u884c' }], candidateValues: [] } },
        { intentId: 'i2', intentType: 'open-video', actionId: 'navigate', elementId: 'videos', stateField: 'videoTitle', targetDomain: { actionableValues: [{ value: 'v1', label: '\u6d77\u8fb9\u65e5\u843d' }], candidateValues: [] } },
        { intentId: 'i3', intentType: 'open-author', actionId: 'navigate', elementId: 'users', stateField: 'userName', targetDomain: { actionableValues: [{ value: 'u1', label: '\u57ce\u5e02\u89c2\u5bdf\u5458' }], candidateValues: [] } },
        { intentId: 'i4', intentType: 'open-category', actionId: 'navigate', elementId: 'categories', stateField: 'categoryName', targetDomain: { actionableValues: [{ value: 'c1', label: '/shipin/' }], candidateValues: [] } },
      ],
    },
  };
  const outputs = {
    skillMd: '/tmp/SKILL.md',
    indexMd: '/tmp/references/index.md',
    flowsMd: '/tmp/references/flows.md',
    recoveryMd: '/tmp/references/recovery.md',
    approvalMd: '/tmp/references/approval.md',
    nlIntentsMd: '/tmp/references/nl-intents.md',
    interactionModelMd: '/tmp/references/interaction-model.md',
  };
  const docsByIntent = new Map([
    ['i1', { title: '\u641c\u7d22\u89c6\u9891', mappedPath: '/tmp/references/flows.md' }],
    ['i2', { title: '\u6253\u5f00\u89c6\u9891', mappedPath: '/tmp/references/flows.md' }],
    ['i3', { title: '\u6253\u5f00\u7528\u6237\u4e3b\u9875', mappedPath: '/tmp/references/flows.md' }],
    ['i4', { title: '\u6253\u5f00\u5206\u7c7b\u9875', mappedPath: '/tmp/references/flows.md' }],
  ]);
  const helpers = {
    markdownLink: (label) => `[${label}](/tmp/link.md)`,
    renderTable,
    slugifyAscii: (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveSafeActions: () => ['navigate', 'open-link', 'search-submit'],
    getIntentTypes: (value) => new Set([
      ...(value.intentsDocument?.intents ?? []).map((intent) => intent.intentType),
      'list-followed-users',
      'list-followed-updates',
    ]),
    collectDouyinSamples: () => ({
      videos: ['\u6d77\u8fb9\u65e5\u843d'],
      users: ['\u57ce\u5e02\u89c2\u5bdf\u5458'],
      searchQueries: ['\u65c5\u884c'],
      categoryEntries: ['/shipin/', '/discover/'],
      publicAuthorSubpages: ['https://www.douyin.com/user/<id>', 'https://www.douyin.com/user/<id>?showTab=post'],
      authenticatedSubpages: [
        'https://www.douyin.com/user/self?showTab=post',
        'https://www.douyin.com/user/self?showTab=like',
        'https://www.douyin.com/user/self?showTab=collect',
        'https://www.douyin.com/user/self?showTab=history',
        'https://www.douyin.com/follow?tab=feed',
        'https://www.douyin.com/follow?tab=user',
      ],
    }),
    displayIntentLabel: (value, intentType) => ({
      'search-video': '\u641c\u7d22\u89c6\u9891',
      'open-video': '\u6253\u5f00\u89c6\u9891',
      'open-author': '\u6253\u5f00\u7528\u6237\u4e3b\u9875',
      'open-category': '\u6253\u5f00\u5206\u7c7b\u9875',
      'list-followed-users': '\u67e5\u8be2\u5173\u6ce8\u7528\u6237\u5217\u8868',
      'list-followed-updates': '\u67e5\u8be2\u5173\u6ce8\u66f4\u65b0\u89c6\u9891',
    }[intentType] ?? intentType),
    buildElementsById: () => new Map([
      ['search', { kind: 'search-form-group' }],
      ['videos', { kind: 'content-link-group' }],
      ['users', { kind: 'author-link-group' }],
      ['categories', { kind: 'category-link-group' }],
    ]),
  };
  return { context, outputs, docsByIntent, helpers };
}

test('douyin renderer documents follow-user and follow-update extraction without book wording', () => {
  const input = buildInput();
  const skillMd = renderKnownSiteDocument('douyin', 'skill', input);
  const indexMd = renderKnownSiteDocument('douyin', 'index', input);
  const flowsMd = renderKnownSiteDocument('douyin', 'flows', input);
  const nlIntentsMd = renderKnownSiteDocument('douyin', 'nlIntents', input);
  const interactionModelMd = renderKnownSiteDocument('douyin', 'interactionModel', input);

  assert.match(skillMd, /\u67e5\u8be2\u5173\u6ce8\u7528\u6237\u5217\u8868/u);
  assert.match(skillMd, /douyin-query-follow\.mjs/u);
  assert.match(skillMd, /cache-first authenticated read-only queries/u);
  assert.match(skillMd, /Query outputs: support `summary`, `users`, `groups`, `videos`/u);
  assert.doesNotMatch(skillMd, /open verified book pages/iu);

  assert.match(indexMd, /list-followed-users/u);
  assert.match(indexMd, /list-followed-updates/u);
  assert.match(indexMd, /authenticated read-only query surfaces/u);
  assert.match(indexMd, /timeConfidence/u);

  assert.match(flowsMd, /query-followed-users/u);
  assert.match(flowsMd, /query-followed-updates/u);
  assert.match(flowsMd, /showTab=post/u);

  assert.match(nlIntentsMd, /List followed users/u);
  assert.match(nlIntentsMd, /List followed updates/u);
  assert.match(nlIntentsMd, /\u4eca\u5929/u);
  assert.match(nlIntentsMd, /titleKeyword/u);
  assert.doesNotMatch(nlIntentsMd, /Search books/iu);

  assert.match(interactionModelMd, /query-followed-users/u);
  assert.match(interactionModelMd, /query-followed-updates/u);
  assert.match(interactionModelMd, /persist cache under the local Douyin browser profile/u);
});
