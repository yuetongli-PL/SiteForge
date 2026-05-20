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
    skillName: 'xiaohongshu',
    url: 'https://www.xiaohongshu.com/explore',
    siteContext: { host: 'www.xiaohongshu.com' },
    siteCapabilitiesRecord: {
      supportedIntents: [
        'search-book',
        'open-book',
        'download-book',
        'open-author',
        'open-category',
        'open-auth-page',
        'open-utility-page',
        'list-followed-users',
      ],
    },
    intentsDocument: {
      intents: [
        { intentId: 'i1', intentType: 'search-book', actionId: 'search-submit', elementId: 'search', stateField: 'queryText', targetDomain: { actionableValues: [{ value: 'q1', label: '春日穿搭' }], candidateValues: [] } },
        { intentId: 'i2', intentType: 'open-book', actionId: 'navigate', elementId: 'notes', stateField: 'noteTitle', targetDomain: { actionableValues: [{ value: 'n1', label: '春日穿搭模板' }], candidateValues: [] } },
        { intentId: 'i3', intentType: 'download-book', actionId: 'download-book', elementId: 'notes', stateField: 'noteTitle', targetDomain: { actionableValues: [{ value: 'n2', label: '春日穿搭模板' }], candidateValues: [] } },
        { intentId: 'i4', intentType: 'open-author', actionId: 'navigate', elementId: 'users', stateField: 'userName', targetDomain: { actionableValues: [{ value: 'u1', label: '穿搭研究所' }], candidateValues: [] } },
        { intentId: 'i5', intentType: 'open-category', actionId: 'navigate', elementId: 'discover', stateField: 'targetMemberId', targetDomain: { actionableValues: [{ value: 'c1', label: '发现' }], candidateValues: [] } },
        { intentId: 'i6', intentType: 'open-auth-page', actionId: 'navigate', elementId: 'auth', stateField: 'targetMemberId', targetDomain: { actionableValues: [{ value: 'a1', label: '登录页' }], candidateValues: [] } },
        { intentId: 'i7', intentType: 'open-utility-page', actionId: 'navigate', elementId: 'utility', stateField: 'targetMemberId', targetDomain: { actionableValues: [{ value: 'u2', label: '通知页' }], candidateValues: [] } },
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
    ['i1', { title: '搜索笔记', mappedPath: '/tmp/references/flows.md' }],
    ['i2', { title: '打开笔记', mappedPath: '/tmp/references/flows.md' }],
    ['i3', { title: '下载笔记', mappedPath: '/tmp/references/flows.md' }],
    ['i4', { title: '打开用户主页', mappedPath: '/tmp/references/flows.md' }],
    ['i5', { title: '浏览发现页', mappedPath: '/tmp/references/flows.md' }],
    ['i6', { title: '打开登录页', mappedPath: '/tmp/references/flows.md' }],
    ['i7', { title: '打开通知页', mappedPath: '/tmp/references/flows.md' }],
  ]);
  const helpers = {
    markdownLink: (label) => `[${label}](/tmp/link.md)`,
    renderTable,
    slugifyAscii: (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    resolveSafeActions: () => ['navigate', 'search-submit'],
    getIntentTypes: (value) => new Set((value.intentsDocument?.intents ?? []).map((intent) => intent.intentType)),
    collectXiaohongshuSamples: () => ({
      notes: ['春日穿搭模板'],
      users: ['穿搭研究所'],
      searchQueries: ['春日穿搭'],
      discoverEntries: ['发现'],
      authEntries: ['登录页'],
      utilityEntries: ['通知页'],
    }),
    displayIntentLabel: (_value, intentType) => ({
      'search-book': '搜索笔记',
      'open-book': '打开笔记',
      'download-book': '下载笔记',
      'open-author': '打开用户主页',
      'open-category': '浏览发现页',
      'open-auth-page': '打开登录页',
      'open-utility-page': '打开通知页',
      'list-followed-users': '查询关注用户列表',
    }[intentType] ?? intentType),
    buildElementsById: () => new Map([
      ['search', { kind: 'search-form-group' }],
      ['notes', { kind: 'content-link-group' }],
      ['users', { kind: 'author-link-group' }],
      ['discover', { kind: 'category-link-group' }],
      ['auth', { kind: 'auth-link-group' }],
      ['utility', { kind: 'utility-link-group' }],
    ]),
  };
  return { context, outputs, docsByIntent, helpers };
}

test('xiaohongshu renderer documents note download, follow queries, notification, and auth boundaries', () => {
  const input = buildInput();
  const skillMd = renderKnownSiteDocument('xiaohongshu', 'skill', input);
  const indexMd = renderKnownSiteDocument('xiaohongshu', 'index', input);
  const flowsMd = renderKnownSiteDocument('xiaohongshu', 'flows', input);
  const nlIntentsMd = renderKnownSiteDocument('xiaohongshu', 'nlIntents', input);
  const interactionModelMd = renderKnownSiteDocument('xiaohongshu', 'interactionModel', input);

  assert.match(skillMd, /search_result\?keyword=\.\.\./u);
  assert.match(skillMd, /\/explore\/<noteId>/u);
  assert.match(skillMd, /download image-first note bundles/u);
  assert.match(skillMd, /notification-style utility pages/u);
  assert.match(skillMd, /query followed users with a reusable authenticated profile/u);
  assert.match(skillMd, /查询关注用户列表/u);
  assert.match(skillMd, /Follow-query execution is internal; public onboarding and regeneration use `siteforge build <url>`/u);
  assert.doesNotMatch(skillMd, /open verified book pages/iu);

  assert.match(indexMd, /open-auth-page/u);
  assert.match(indexMd, /\/user\/profile\/<userId>/u);
  assert.match(indexMd, /search_result\?keyword=\.\.\./u);
  assert.match(indexMd, /`open-utility-page` is currently used for verified utility surfaces such as `\/notification`/u);
  assert.match(indexMd, /list-followed-users/u);
  assert.match(indexMd, /official frontend follow-list runtime/u);

  assert.match(flowsMd, /Target state: a search results page on `www\.xiaohongshu\.com\/search_result`/u);
  assert.match(flowsMd, /Target state: a note detail page on `www\.xiaohongshu\.com\/explore\/<noteId>`/u);
  assert.match(flowsMd, /resolved image-first note bundle prepared for the shared downloader/u);
  assert.match(flowsMd, /Target state: a verified utility page such as `\/notification`/u);
  assert.match(flowsMd, /40122\.tF\(\)/u);
  assert.match(flowsMd, /\/api\/sns\/web\/v1\/intimacy\/intimacy_list/u);
  assert.match(flowsMd, /read-only follow-list result/u);
  assert.match(flowsMd, /do not auto-fill or auto-submit credentials/u);

  assert.match(nlIntentsMd, /Search notes/u);
  assert.match(nlIntentsMd, /Download note bundles/u);
  assert.match(nlIntentsMd, /Browse discover page/u);
  assert.match(nlIntentsMd, /Open login\/register pages/u);
  assert.match(nlIntentsMd, /Open utility pages/u);
  assert.match(nlIntentsMd, /List followed users/u);
  assert.match(nlIntentsMd, /我关注了哪些用户/u);

  assert.match(interactionModelMd, /www\.xiaohongshu\.com/u);
  assert.match(interactionModelMd, /read-only/u);
  assert.match(interactionModelMd, /通知页/u);
  assert.match(interactionModelMd, /follow-users-query/u);
  assert.match(interactionModelMd, /official frontend follow-list runtime/u);
  assert.match(interactionModelMd, /Login\/register entrypoints are navigation-only targets/u);
});
