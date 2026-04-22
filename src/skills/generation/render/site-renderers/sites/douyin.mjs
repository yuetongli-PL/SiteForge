import {
  buildIntentCoverageRows,
  dedupeSampleList,
  renderFlowsTemplate,
  renderIndexTemplate,
  renderInteractionTemplate,
  renderNlIntentsTemplate,
  renderReadingOrder,
  renderReferenceNavigation,
  renderSkillTemplate,
} from '../shared.mjs';

function normalizeDouyinIntentType(intentType) {
  switch (intentType) {
    case 'search-book':
    case 'search-work':
      return 'search-video';
    case 'open-book':
    case 'open-work':
      return 'open-video';
    case 'open-up':
    case 'open-model':
    case 'open-actress':
      return 'open-author';
    default:
      return String(intentType ?? '');
  }
}

function normalizeDouyinVideoLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  return raw
    .replace(/\s*-\s*抖音$/u, '')
    .replace(/\s*-\s*Douyin$/iu, '')
    .trim() || raw;
}

function normalizeDouyinUserLabel(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  return raw
    .replace(/的主页$/u, '')
    .replace(/用户主页$/u, '')
    .trim() || raw;
}

function normalizeDouyinCategoryEntry(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  return raw
    .replace(/^https?:\/\/www\.douyin\.com/iu, '')
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\?.*$/u, '')
    .trim() || raw;
}

function formatDouyinUserExample(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '`open a user homepage`';
  }
  return `\`open ${normalized}\``;
}

function buildDouyinSamples(samples) {
  return {
    ...samples,
    videos: dedupeSampleList(samples.videos, normalizeDouyinVideoLabel),
    users: dedupeSampleList(samples.users, normalizeDouyinUserLabel),
    searchQueries: dedupeSampleList(samples.searchQueries, (value) => String(value ?? '').trim() || null),
    categoryEntries: dedupeSampleList(samples.categoryEntries, normalizeDouyinCategoryEntry),
    publicAuthorSubpages: dedupeSampleList(samples.publicAuthorSubpages, (value) => String(value ?? '').trim() || null),
    authenticatedSubpages: dedupeSampleList(samples.authenticatedSubpages, (value) => String(value ?? '').trim() || null),
  };
}

function buildDouyinSyntheticIntents(intentTypes) {
  const intents = [];
  if (intentTypes.has('list-followed-users')) {
    intents.push({
      intentId: 'douyin-followed-users',
      intentType: 'list-followed-users',
      actionId: 'query-followed-users',
      elementId: 'follow-users-query',
      stateField: 'followUsers',
      synthetic: true,
      targetDomain: {
        actionableValues: [],
        candidateValues: [],
      },
    });
  }
  if (intentTypes.has('list-followed-updates')) {
    intents.push({
      intentId: 'douyin-followed-updates',
      intentType: 'list-followed-updates',
      actionId: 'query-followed-updates',
      elementId: 'follow-updates-query',
      stateField: 'followUpdates',
      synthetic: true,
      targetDomain: {
        actionableValues: [],
        candidateValues: [],
      },
    });
  }
  return intents;
}

function renderDouyinSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const samples = buildDouyinSamples(helpers.collectDouyinSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')
      ? '搜索视频'
      : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')
      ? '打开视频'
      : null,
    intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')
      ? '打开用户主页'
      : null,
    intentTypes.has('open-category')
      ? '打开分类页'
      : null,
    intentTypes.has('list-followed-users')
      ? '查询关注用户列表'
      : null,
    intentTypes.has('list-followed-updates')
      ? '按自然日查询关注更新视频'
      : null,
    samples.authenticatedSubpages.length
      ? '复用本地登录态查看只读子页'
      : null,
  ].filter(Boolean);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search videos, open verified video pages, open verified user homepages, navigate approved douyin category pages, or inspect authenticated read-only douyin surfaces inside the douyin URL family.`,
    heading: 'douyin Skill',
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified `www.douyin.com` URL family.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      `- Supported tasks: ${supportedTasks.join('、') || '在已观测 Douyin 状态空间内查询和导航'}.`,
      '- Public navigation model: home, search, video detail, user homepage, and approved category pages remain public read-only surfaces.',
      '- Follow-query entrypoint: `node src/entrypoints/sites/douyin-query-follow.mjs https://www.douyin.com/?recommend=1 --intent list-followed-updates --window 今天`.',
    ],
    sampleCoverageLines: [
      `- 视频样本: ${samples.videos.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 分类样本: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- 公开用户子页: ${samples.publicAuthorSubpages.join(', ') || 'none'}`,
      `- 登录态只读子页: ${samples.authenticatedSubpages.join(', ') || 'none'}`,
    ],
    executionPolicyLines: [
      '- Public Douyin pages MUST use the built-in browser.',
      '- Authenticated Douyin pages MUST use the local-profile browser with a reusable persisted session.',
      '- Login bootstrap MUST run through `node .\\src\\entrypoints\\sites\\site-login.mjs https://www.douyin.com/ --profile-path profiles/www.douyin.com.json --no-headless --reuse-login-state --no-auto-login`.',
      '- The first Douyin login is always manual in a visible browser; do not save or submit account credentials automatically.',
      '- Authenticated read-only subpages include `/user/self?showTab=post|like|collect|history` and `/follow?tab=feed|user`.',
      '- `list-followed-users` and `list-followed-updates` are cache-first authenticated read-only queries backed by the local persisted profile.',
      '- Query filters: support followed-user filtering, title keywords, global limits, and updated-only output over the authenticated follow cache.',
      '- Query outputs: support `summary`, `users`, `groups`, `videos`, plus Markdown summaries for operator-friendly reads.',
      '- Optional prewarm: `site-keepalive --refresh-follow-cache` refreshes recent active followed-user caches after a healthy keepalive.',
      '- Routing table: public pages -> `builtin-browser`; authenticated read-only pages -> `local-profile-browser`; login bootstrap -> `site-login`.',
    ],
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- Search, public navigation, and authenticated read-only inspection are low-risk actions.',
      '- `喜欢`、`收藏`、`观看历史`、`关注` stay as authenticated read-only subpages and are not promoted into new public intents.',
      '- Followed-update extraction is strict per user homepage and does not use `/follow?tab=feed` as the final correctness source.',
      '- No like, favorite, follow, comment, private message, upload, or publish mutation is in scope.',
    ],
    doNotDoLines: [
      '- Do not leave the verified douyin URL family.',
      '- Do not invent unobserved engagement or publishing workflows.',
      '- Do not open authenticated Douyin surfaces in the built-in browser.',
      '- Do not submit auth forms or any unknown side-effect action without approval.',
    ],
  });
}

function renderDouyinIndexReference(input) {
  const { context, outputs, docsByIntent, helpers } = input;
  const samples = buildDouyinSamples(helpers.collectDouyinSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const intents = [
    ...(context.intentsDocument.intents ?? []),
    ...buildDouyinSyntheticIntents(intentTypes),
  ];
  const displayTargetsByIntent = new Map([
    ['search-video', samples.searchQueries],
    ['open-video', samples.videos],
    ['open-author', samples.users],
    ['open-category', samples.categoryEntries],
    ['list-followed-users', ['我的关注用户列表']],
    ['list-followed-updates', ['今天', '昨天', '本周']],
  ]);
  const rows = buildIntentCoverageRows(
    intents,
    docsByIntent,
    outputs.indexMd,
    helpers.markdownLink,
    (intentType) => helpers.displayIntentLabel(context, intentType),
    (intent, flowLink) => {
      const normalizedIntentType = normalizeDouyinIntentType(intent.intentType);
      return {
        intent: helpers.displayIntentLabel(context, intent.intentType),
        flow: flowLink,
        actionableTargets: (
          displayTargetsByIntent.get(normalizedIntentType)
          ?? (intent.targetDomain?.actionableValues ?? []).map((value) => value.label)
        ).join(', ') || '-',
        recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
          .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
          .map((value) => value.label)
          .join(', ') || '-',
      };
    },
  );
  return renderIndexTemplate({
    title: 'douyin Index',
    siteSummaryLines: [
      `- Entry URL: \`${context.url}\``,
      '- Site type: video catalog + user homepage navigation + authenticated read-only subpages.',
      `- 视频样本: ${samples.videos.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 分类样本: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- 公开用户子页: ${samples.publicAuthorSubpages.join(', ') || 'none'}`,
      `- 登录态只读子页: ${samples.authenticatedSubpages.join(', ') || 'none'}`,
    ],
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    sampleCoverageTable: helpers.renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    notesTitle: '## Notes',
    notesLines: [
      '- `open-author` covers public `www.douyin.com/user/<id>` user homepages.',
      '- `我的作品`、`喜欢`、`收藏`、`观看历史`、`关注` remain authenticated read-only subpages and are not exposed as new public intents.',
      '- `list-followed-users` and `list-followed-updates` are authenticated read-only query surfaces layered on top of `/follow?tab=user` and `user/<id>?showTab=post`.',
      '- Query responses can be projected as `summary`, `users`, `groups`, or `videos`, and Markdown output is available for operator-facing reviews.',
      '- Video rows expose provenance and confidence fields such as `source`, `timeSource`, and `timeConfidence`.',
      '- The reusable local profile is bootstrapped through `site-login` in a visible browser and reused by later local-profile runs.',
    ],
  });
}

function renderDouyinFlowsReference(input) {
  const { context, helpers } = input;
  const samples = buildDouyinSamples(helpers.collectDouyinSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const entries = [
    ...(context.intentsDocument.intents ?? []),
    ...buildDouyinSyntheticIntents(intentTypes),
  ]
    .sort((left, right) => String(left.intentType).localeCompare(String(right.intentType), 'en'))
    .map((intent) => {
      const normalizedIntentType = normalizeDouyinIntentType(intent.intentType);
      const bodyLines = [];
      if (normalizedIntentType === 'search-video') {
        bodyLines.push(`- Example user requests: ${samples.searchQueries.map((item) => `\`搜索视频 ${item}\``).join(', ') || '`搜索视频 抖音`'}`);
        bodyLines.push('- Start state: any verified public Douyin page.');
        bodyLines.push('- Target state: a Douyin search results page under `www.douyin.com/search/...`.');
        bodyLines.push('- Main path: fill the visible search box or navigate directly with the query parameter.');
        bodyLines.push('- Success signal: the result page preserves the query and exposes at least one verified video card.');
      } else if (normalizedIntentType === 'open-video') {
        bodyLines.push(`- Example user requests: ${samples.videos.map((item) => `\`打开视频 ${item}\``).join(', ') || '`打开视频`'}`);
        bodyLines.push('- Start state: the home page, a search results page, a user homepage, or an approved category page.');
        bodyLines.push('- Target state: a video detail page on `www.douyin.com/video/<id>`.');
        bodyLines.push('- Main path: open a verified video card from search, category, or user-homepage results.');
        bodyLines.push('- Success signal: the final page is a video detail page with a stable title and owner link when present.');
      } else if (normalizedIntentType === 'open-author') {
        bodyLines.push(`- Example user requests: ${samples.users.map((item) => formatDouyinUserExample(item)).join(', ') || '`open a user homepage`'}`);
        bodyLines.push('- Start state: a verified video detail page, search result page, or another public page with creator links.');
        bodyLines.push('- Target state: a public user homepage on `www.douyin.com/user/<id>`.');
        bodyLines.push('- Main path: open the creator link from a video card or detail page.');
        bodyLines.push('- Authenticated note: `/user/self?showTab=post|like|collect|history` and `/follow?tab=feed|user` remain read-only subpages in the same family, not new public intents.');
        bodyLines.push('- Success signal: the final page is a user homepage and the requested target matches the visible user identity when present.');
      } else if (normalizedIntentType === 'open-category') {
        bodyLines.push(`- Example user requests: ${samples.categoryEntries.map((item) => `\`打开分类 ${item}\``).join(', ') || '`打开分类 /shipin/`'}`);
        bodyLines.push('- Start state: any verified public Douyin page.');
        bodyLines.push('- Target state: an approved category page under `/shipin/`, `/discover/`, `/zhuanti/`, or `/vs`.');
        bodyLines.push('- Main path: navigate directly to a verified category entrypoint.');
        bodyLines.push('- Success signal: the final URL remains inside the approved Douyin path family.');
      } else if (normalizedIntentType === 'list-followed-users') {
        bodyLines.push('- Example user requests: `列出我关注的用户`, `查看关注用户列表`.');
        bodyLines.push('- Start state: a valid persisted authenticated Douyin profile on the local-profile browser.');
        bodyLines.push('- Target state: a complete `/follow?tab=user` extraction result with `name`, `url`, and `userId`.');
        bodyLines.push('- Main path: prefer the 24h cached follow index; otherwise exhaust `/follow?tab=user` and refresh the cache.');
        bodyLines.push('- Output modes: `summary`, `users`, or Markdown summaries for operator-facing listings.');
        bodyLines.push('- Success signal: the result returns full `users[]` and `totalFollowedUsers` without treating `/follow?tab=feed` as a substitute.');
      } else if (normalizedIntentType === 'list-followed-updates') {
        bodyLines.push('- Example user requests: `列出我关注的用户今天更新的视频`, `列出我关注的用户昨天更新的视频`, `列出我关注的用户本周更新的视频`.');
        bodyLines.push('- Slots: `timeWindow`, defaulting to `今天` when omitted.');
        bodyLines.push('- Main path: enumerate followed users from `/follow?tab=user`, then scan each `user/<id>?showTab=post` page strictly in read-only mode.');
        bodyLines.push('- Time semantics: normalize to Asia/Shanghai natural-day windows and sort matched videos by `publishedAt` descending.');
        bodyLines.push('- Query filters: `--user`, `--keyword`, `--limit`, and `--updated-only` narrow the final result without changing the authenticated read-only boundary.');
        bodyLines.push('- Provenance: each video can expose `source`, `timeSource`, and `timeConfidence`, with `detail-fallback` preferred over DOM-derived timing.');
        bodyLines.push('- Success signal: grouped `groups[]` plus flat `videos[]`, with `partial=true` only when some user scans fail.');
      } else {
        bodyLines.push('- Navigation-only flow inside the verified Douyin URL family.');
      }
      return {
        title: helpers.displayIntentLabel(context, intent.intentType),
        anchorHint: normalizedIntentType,
        intentId: intent.intentId,
        intentType: normalizedIntentType,
        actionId: intent.actionId,
        summary: helpers.displayIntentLabel(context, intent.intentType),
        bodyLines,
      };
    });
  return renderFlowsTemplate(entries, [
    '- Douyin public routing stays on `www.douyin.com` for home, search, detail, user, and category pages.',
    '- Authenticated read-only subpages (`我的作品`、`喜欢`、`收藏`、`观看历史`、`关注`) are preserved as sub-scenarios and are not promoted to new public intents.',
    '- `list-followed-users` and `list-followed-updates` are authenticated read-only query flows backed by the local persisted profile and follow cache.',
    '- The current Douyin skill surface is intentionally read-only and excludes any engagement or publishing action.',
  ], helpers.slugifyAscii);
}

function renderDouyinNlIntentsReference(input) {
  const { context, helpers } = input;
  const samples = buildDouyinSamples(helpers.collectDouyinSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const entries = [];
  if (intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')) {
    entries.push({
      title: 'Search videos',
      bodyLines: [
        '- Slots: `queryText`',
        `- Examples: ${samples.searchQueries.map((item) => `\`搜索视频 ${item}\``).join(', ') || '`搜索视频 抖音`'}`,
        '- Notes: use 视频 phrasing, not 书籍 / 作品 phrasing, when the request is routed to Douyin.',
      ],
    });
  }
  if (intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')) {
    entries.push({
      title: 'Open video pages',
      bodyLines: [
        '- Slots: `videoTitle` or `videoId`',
        `- Examples: ${samples.videos.map((item) => `\`打开视频 ${item}\``).join(', ') || '`打开视频`'}`,
        '- Detail-family note: keep `/video/<id>` on the existing public `open-video` surface.',
      ],
    });
  }
  if (intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')) {
    entries.push({
      title: 'Open user homepages',
      bodyLines: [
        '- Slots: `userName`',
        `- Examples: ${samples.users.map((item) => `\`打开用户主页 ${item}\``).join(', ') || '`打开用户主页`'}`,
        `- Public homepage samples: ${samples.publicAuthorSubpages.join(', ') || 'none'}`,
        `- Authenticated read-only subpages: ${samples.authenticatedSubpages.join(', ') || 'none'}`,
        '- Author-family note: `喜欢`、`收藏`、`观看历史`、`关注` stay inside the same user-navigation family as read-only subpages.',
      ],
    });
  }
  if (intentTypes.has('open-category')) {
    entries.push({
      title: 'Open category pages',
      bodyLines: [
        '- Slots: `categoryName`',
        `- Examples: ${samples.categoryEntries.map((item) => `\`打开分类 ${item}\``).join(', ') || '`打开分类 /shipin/`'}`,
      ],
    });
  }
  if (intentTypes.has('list-followed-users')) {
    entries.push({
      title: 'List followed users',
      bodyLines: [
        '- Slots: none.',
        '- Examples: `列出我关注的用户`, `查看关注用户列表`.',
        '- Notes: requires the local persisted authenticated Douyin profile and returns a read-only `users[]` result.',
        '- Output modes: `summary`, `users`, and Markdown summaries are supported by the query entrypoint.',
      ],
    });
  }
  if (intentTypes.has('list-followed-updates')) {
    entries.push({
      title: 'List followed updates',
      bodyLines: [
        '- Slots: `timeWindow`.',
        '- Examples: `列出我关注的用户今天更新的视频`, `列出我关注的用户昨天更新的视频`, `列出我关注的用户本周更新的视频`.',
        '- Time window values: `今天`, `昨天`, `本周`, `上周`, `本月`, `上月`, `最近N天`, `YYYY-MM-DD`, `YYYY-MM-DD 到 YYYY-MM-DD`.',
        '- Notes: defaults to `今天`, scans user `showTab=post` pages strictly, and falls back to cached observations when fresh.',
        '- Query filters: `userFilter`, `titleKeyword`, `limit`, and `updatedOnly` are supported at the query layer.',
        '- Result provenance: rows may expose `source`, `timeSource`, and `timeConfidence` to distinguish API, DOM, and detail fallbacks.',
      ],
    });
  }
  return renderNlIntentsTemplate(entries);
}

function renderDouyinInteractionModelReference(input) {
  const { context, helpers } = input;
  const samples = buildDouyinSamples(helpers.collectDouyinSamples(context));
  const elementsById = helpers.buildElementsById(context);
  const rows = [
    ...(context.intentsDocument.intents ?? []),
    ...buildDouyinSyntheticIntents(helpers.getIntentTypes(context)),
  ].map((intent) => ({
    intent: helpers.displayIntentLabel(context, intent.intentType),
    element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
    action: intent.actionId,
    stateField: intent.stateField,
  }));
  return renderInteractionTemplate({
    summaryTitle: '## Capability summary',
    summaryLines: [
      `- 视频样本: ${samples.videos.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 分类样本: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- 公开用户子页: ${samples.publicAuthorSubpages.join(', ') || 'none'}`,
      `- 登录态只读子页: ${samples.authenticatedSubpages.join(', ') || 'none'}`,
    ],
    table: helpers.renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
    extraSections: [
      {
        title: '## Boundary notes',
        lines: [
          '- Public search, detail, author, and category pages stay on the verified `www.douyin.com` family.',
          '- `/user/self?showTab=post|like|collect|history` and `/follow?tab=feed|user` are authenticated read-only sub-scenarios.',
          '- `list-followed-users` and `list-followed-updates` execute against the same authenticated read-only surfaces and persist cache under the local Douyin browser profile.',
          '- Follow-query results support projection into `summary`, `users`, `groups`, and `videos`, with Markdown summaries for compact reporting.',
          '- Cached rows may carry `source`, `timeSource`, and `timeConfidence` to surface result provenance and timestamp quality.',
          '- The interaction model is read-only and excludes like, favorite, follow, comment, messaging, and publishing actions.',
        ],
      },
    ],
  });
}

export const DOUYIN_SITE_RENDERER = Object.freeze({
  skill: renderDouyinSkillMd,
  index: renderDouyinIndexReference,
  flows: renderDouyinFlowsReference,
  nlIntents: renderDouyinNlIntentsReference,
  interactionModel: renderDouyinInteractionModelReference,
});
