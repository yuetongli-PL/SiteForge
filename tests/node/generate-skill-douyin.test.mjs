import test from 'node:test';
import assert from 'node:assert/strict';

import { remapSupportedIntent } from '../../src/entrypoints/pipeline/generate-skill.mjs';
import { renderKnownSiteSkillMd, resolveKnownSiteKey } from '../../src/skills/generation/site-render-inputs.mjs';

const context = {
  url: 'https://www.douyin.com/',
  siteContext: { host: 'www.douyin.com' },
};

test('generate-skill remaps douyin intents to video and user surfaces', () => {
  assert.equal(remapSupportedIntent('search-book', context), 'search-video');
  assert.equal(remapSupportedIntent('search-work', context), 'search-video');
  assert.equal(remapSupportedIntent('open-book', context), 'open-video');
  assert.equal(remapSupportedIntent('open-work', context), 'open-video');
  assert.equal(remapSupportedIntent('open-up', context), 'open-author');
  assert.equal(remapSupportedIntent('open-model', context), 'open-author');
  assert.equal(remapSupportedIntent('open-actress', context), 'open-author');
});

test('generate-skill routes douyin through the known-site renderer path', () => {
  const renderContext = {
    ...context,
    skillName: 'douyin',
    statesDocument: { states: [] },
    intentsDocument: {
      intents: [
        { intentType: 'search-video', actionId: 'search-submit', targetDomain: { actionableValues: [] } },
        { intentType: 'list-followed-users', actionId: 'query-followed-users', targetDomain: { actionableValues: [] } },
        { intentType: 'list-followed-updates', actionId: 'query-followed-updates', targetDomain: { actionableValues: [] } },
      ],
    },
    actionsDocument: { actions: [] },
    searchResultsDocument: [],
    siteProfileDocument: { search: { defaultQueries: ['热点'] }, safeActionKinds: ['search-submit', 'open-link'] },
    liveSiteProfileDocument: null,
  };
  const outputs = {
    skillMd: 'skills/douyin/SKILL.md',
    indexMd: 'skills/douyin/references/index.md',
    flowsMd: 'skills/douyin/references/flows.md',
    nlIntentsMd: 'skills/douyin/references/nl-intents.md',
    recoveryMd: 'skills/douyin/references/recovery.md',
    approvalMd: 'skills/douyin/references/approval.md',
    interactionModelMd: 'skills/douyin/references/interaction-model.md',
  };

  assert.equal(resolveKnownSiteKey(renderContext), 'douyin');
  const markdown = renderKnownSiteSkillMd(renderContext, outputs);
  assert.match(markdown, /Follow-query entrypoint/u);
  assert.match(markdown, /查询关注用户列表/u);
});
