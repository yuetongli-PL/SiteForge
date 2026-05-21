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

const DISCOVER_ENTRY_FALLBACK = '发现';
const LOGIN_ENTRY_FALLBACK = '登录页';
const NOTIFICATION_ENTRY_FALLBACK = '通知页';
const FOLLOW_QUERY_EXAMPLES = Object.freeze([
  '查询关注用户列表',
  '列出我关注的用户',
  '我关注了哪些用户',
]);

function normalizeXiaohongshuIntentType(intentType) {
  switch (intentType) {
    case 'search-book':
    case 'search-work':
    case 'search-video':
      return 'search-note';
    case 'open-book':
    case 'open-work':
    case 'open-video':
      return 'open-note';
    case 'download-book':
    case 'download-work':
    case 'download-video':
      return 'download-note';
    case 'open-up':
    case 'open-model':
    case 'open-actress':
    case 'open-author':
      return 'open-user';
    case 'open-category':
      return 'browse-discover';
    default:
      return String(intentType ?? '');
  }
}

function normalizeTextSample(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  if (['undefined', 'null', 'none', 'n/a', '-'].includes(raw.toLowerCase())) {
    return null;
  }
  return raw;
}

function normalizeXiaohongshuNoteTitle(value) {
  const raw = normalizeTextSample(value);
  if (!raw) {
    return null;
  }
  return raw
    .replace(/\s*-\s*小红书$/u, '')
    .replace(/\s*-\s*灏忕孩涔?$/u, '')
    .replace(/^\s*笔记[:：]?\s*/u, '')
    .replace(/^\s*绗旇[:：]?\s*/u, '')
    .trim() || raw;
}

function normalizeXiaohongshuUserLabel(value) {
  const raw = normalizeTextSample(value);
  if (!raw) {
    return null;
  }
  return raw
    .replace(/\s*-\s*小红书$/u, '')
    .replace(/\s*-\s*灏忕孩涔?$/u, '')
    .replace(/的主页$/u, '')
    .replace(/用户主页$/u, '')
    .replace(/作者主页$/u, '')
    .replace(/鐨勪富椤?$/u, '')
    .replace(/鐢ㄦ埛涓婚〉$/u, '')
    .replace(/浣滆€呬富椤?$/u, '')
    .trim() || raw;
}

function normalizeXiaohongshuDiscoverEntry(value) {
  const raw = normalizeTextSample(value);
  if (!raw) {
    return null;
  }
  if (
    raw === DISCOVER_ENTRY_FALLBACK
    || raw === '发现页'
    || raw === '鍙戠幇'
    || raw === '鍙戠幇椤?'
    || raw === '/explore'
    || raw === 'explore'
    || raw === 'https://www.xiaohongshu.com/explore'
  ) {
    return DISCOVER_ENTRY_FALLBACK;
  }
  return raw;
}

function normalizeXiaohongshuAuthEntry(value) {
  const raw = normalizeTextSample(value);
  if (!raw) {
    return null;
  }
  if (/register|注册|娉ㄥ唽/u.test(raw)) {
    return '注册页';
  }
  if (/login|登录|鐧诲綍|认证|璁よ瘉/u.test(raw)) {
    return LOGIN_ENTRY_FALLBACK;
  }
  return raw;
}

function normalizeXiaohongshuUtilityEntry(value) {
  const raw = normalizeTextSample(value);
  if (!raw) {
    return null;
  }
  if (/notification|通知|消息|閫氱煡|娑堟伅/u.test(raw)) {
    return NOTIFICATION_ENTRY_FALLBACK;
  }
  if (/livelist|直播|鐩存挱/u.test(raw)) {
    return '直播列表';
  }
  return raw;
}

function buildXiaohongshuSamples(samples) {
  return {
    ...samples,
    notes: dedupeSampleList(samples.notes, normalizeXiaohongshuNoteTitle),
    users: dedupeSampleList(samples.users, normalizeXiaohongshuUserLabel),
    searchQueries: dedupeSampleList(samples.searchQueries, normalizeTextSample),
    discoverEntries: dedupeSampleList(samples.discoverEntries, normalizeXiaohongshuDiscoverEntry),
    authEntries: dedupeSampleList(samples.authEntries, normalizeXiaohongshuAuthEntry),
    utilityEntries: dedupeSampleList(samples.utilityEntries, normalizeXiaohongshuUtilityEntry),
  };
}

function formatUserExample(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '`打开用户主页`';
  }
  return `\`打开用户主页 ${normalized}\``;
}

function buildAuthExamples(entries) {
  const samples = entries.length ? entries : [LOGIN_ENTRY_FALLBACK];
  const examples = samples.flatMap((item) => {
    if (item === '注册页') {
      return ['`打开注册页`', '`进入注册页`'];
    }
    return ['`打开登录页`', '`打开登录页但不自动提交凭证`'];
  });
  return [...new Set(examples)];
}

function buildUtilityExamples(entries) {
  const samples = entries.length ? entries : [NOTIFICATION_ENTRY_FALLBACK];
  const examples = samples.flatMap((item) => {
    if (item === NOTIFICATION_ENTRY_FALLBACK) {
      return ['`打开通知页`', '`查看消息页`'];
    }
    return [`\`打开${item}\``];
  });
  return [...new Set(examples)];
}

function resolveSupportedIntentTypes(context, helpers) {
  const supported = new Set(helpers.getIntentTypes(context));
  for (const intentType of context.siteCapabilitiesRecord?.supportedIntents ?? []) {
    supported.add(String(intentType));
  }
  for (const intentType of context.siteContext?.capabilitiesRecord?.supportedIntents ?? []) {
    supported.add(String(intentType));
  }
  const host = String(
    context.siteContext?.host
    ?? context.siteContext?.registryRecord?.host
    ?? '',
  ).toLowerCase();
  if (host === 'www.xiaohongshu.com') {
    supported.add('open-utility-page');
    supported.add('list-followed-users');
  }
  return supported;
}

function buildXiaohongshuSyntheticIntents(context, helpers) {
  const supportedIntentTypes = resolveSupportedIntentTypes(context, helpers);
  const intents = /** @type {any[]} */ ([]);
  if (supportedIntentTypes.has('list-followed-users')) {
    intents.push({
      intentId: 'xiaohongshu-followed-users',
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
  return intents;
}

function renderXiaohongshuSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const samples = buildXiaohongshuSamples(helpers.collectXiaohongshuSamples(context));
  const intentTypes = resolveSupportedIntentTypes(context, helpers);
  const supportedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')
      ? '搜索笔记'
      : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')
      ? '打开笔记'
      : null,
    intentTypes.has('download-video') || intentTypes.has('download-book') || intentTypes.has('download-work')
      ? '下载图文笔记'
      : null,
    intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')
      ? '打开用户主页'
      : null,
    intentTypes.has('open-category')
      ? '浏览发现页'
      : null,
    intentTypes.has('open-auth-page')
      ? '打开登录 / 注册页'
      : null,
    intentTypes.has('open-utility-page')
      ? '打开通知 / 功能页'
      : null,
    intentTypes.has('list-followed-users')
      ? '查询关注用户列表'
      : null,
  ].filter(Boolean);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search Xiaohongshu notes, open verified note pages, download image-first note bundles, open verified user homepages, browse the discover page, query followed users with a reusable authenticated profile, open notification-style utility pages, or open login/register pages without submitting credentials automatically.`,
    heading: 'xiaohongshu Skill',
    compileResultSummary: context.compileResultSummary,
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified `www.xiaohongshu.com` URL family.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      `- Supported tasks: ${supportedTasks.join('、') || '在已观测的小红书状态空间内做只读查询和导航'}.`,
      '- Verified navigation model: `/explore` -> `/search_result?keyword=...` -> `/explore/<noteId>` -> `/user/profile/<userId>`.',
      intentTypes.has('list-followed-users')
        ? '- Follow-query execution is internal; public onboarding and regeneration use `siteforge build <url>`.'
        : null,
    ].filter(Boolean),
    sampleCoverageLines: [
      `- 笔记样本: ${samples.notes.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 发现页样本: ${samples.discoverEntries.join(', ') || DISCOVER_ENTRY_FALLBACK}`,
      `- 登录页样本: ${samples.authEntries.join(', ') || LOGIN_ENTRY_FALLBACK}`,
      `- 功能页样本: ${samples.utilityEntries.join(', ') || NOTIFICATION_ENTRY_FALLBACK}`,
      intentTypes.has('list-followed-users')
        ? `- 关注查询样本: ${FOLLOW_QUERY_EXAMPLES.join(', ')}`
        : null,
    ].filter(Boolean),
    executionPolicyLines: [
      '- Public Xiaohongshu pages MUST use the built-in browser.',
      '- Authenticated Xiaohongshu queries MUST reuse the local persisted profile in a visible browser when required.',
      '- Search requests should land on `/search_result` and preserve the `keyword` query parameter.',
      '- Discover-page navigation should resolve to `/explore`; note detail pages stay on `/explore/<noteId>`.',
      '- Login or register pages may be opened for manual inspection or bootstrap, but credential input and submission are always manual and never automatic.',
      '- Notification-style utility pages and follow queries are authenticated read-only surfaces when reusable login state exists.',
      intentTypes.has('list-followed-users')
        ? '- `list-followed-users` prefers the official frontend runtime module and falls back to existing self-profile heuristics only when the official path is unavailable.'
        : null,
      '- Routing table: public discover/search/note/user pages -> `builtin-browser`; notification/follow-query pages -> `local-profile-browser`; login/register pages -> manual auth bootstrap only.',
    ].filter(Boolean),
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- 搜索笔记、浏览发现页、打开笔记详情、打开用户主页、打开通知页、查询关注用户列表都属于低风险只读动作。',
      '- 打开登录页或注册页是允许的，但 automation 只能停在页面打开这一步，不能自动提交凭证。',
      '- `list-followed-users` 只返回只读的 `users[]` 结果，不会触发关注、取关、私信或其他账号状态变更。',
      '- 不包含点赞、收藏、关注、评论、私信、发布、购买或任何未知副作用动作。',
    ],
    doNotDoLines: [
      '- Do not leave the verified Xiaohongshu URL family.',
      '- Do not invent unobserved engagement, publishing, or transaction workflows.',
      '- Do not auto-fill or auto-submit auth forms without explicit approval.',
      '- Do not treat discover/search/user/notification navigation or follow queries as permission to mutate account state.',
    ],
  });
}

function renderXiaohongshuIndexReference(input) {
  const { context, outputs, docsByIntent, helpers } = input;
  const samples = buildXiaohongshuSamples(helpers.collectXiaohongshuSamples(context));
  const supportedIntentTypes = resolveSupportedIntentTypes(context, helpers);
  const intents = [
    ...(context.intentsDocument.intents ?? []),
    ...buildXiaohongshuSyntheticIntents(context, helpers),
  ];
  const displayTargetsByIntent = new Map([
    ['search-note', samples.searchQueries],
    ['open-note', samples.notes],
    ['download-note', samples.notes],
    ['open-user', samples.users],
    ['browse-discover', samples.discoverEntries],
    ['open-auth-page', samples.authEntries],
    ['open-utility-page', samples.utilityEntries],
    ['list-followed-users', ['我的关注用户列表']],
  ]);
  const rows = buildIntentCoverageRows(
    intents,
    docsByIntent,
    outputs.indexMd,
    helpers.markdownLink,
    (intentType) => helpers.displayIntentLabel(context, intentType),
    (intent, flowLink) => {
      const normalizedIntentType = normalizeXiaohongshuIntentType(intent.intentType);
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
    title: 'xiaohongshu Index',
    siteSummaryLines: [
      `- Entry URL: \`${context.url}\``,
      '- Site type: discover hub + search results + note detail + user homepage + authenticated read-only query surfaces.',
      `- 笔记样本: ${samples.notes.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 发现页样本: ${samples.discoverEntries.join(', ') || DISCOVER_ENTRY_FALLBACK}`,
      `- 登录页样本: ${samples.authEntries.join(', ') || LOGIN_ENTRY_FALLBACK}`,
      `- 功能页样本: ${samples.utilityEntries.join(', ') || NOTIFICATION_ENTRY_FALLBACK}`,
      supportedIntentTypes.has('list-followed-users')
        ? `- 关注查询样本: ${FOLLOW_QUERY_EXAMPLES.join(', ')}`
        : null,
    ].filter(Boolean),
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    sampleCoverageTable: helpers.renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    notesTitle: '## Notes',
    notesLines: [
      '- Search traffic is expected to land on `https://www.xiaohongshu.com/search_result?keyword=...`.',
      '- `open-note` and `download-note` both operate on the verified `/explore/<noteId>` note detail family.',
      '- `open-user` covers the verified `/user/profile/<userId>` homepage family.',
      '- `browse-discover` is the discover surface rooted at `/explore`, not the search results family.',
      '- `open-auth-page` is read-only navigation to login/register entrypoints; it does not imply auto-login or auto-submit.',
      '- `open-utility-page` is currently used for verified utility surfaces such as `/notification`.',
      supportedIntentTypes.has('list-followed-users')
        ? '- `list-followed-users` is an authenticated read-only query surface layered on top of a reusable persisted profile and the official frontend follow-list runtime.'
        : null,
    ].filter(Boolean),
  });
}

function renderXiaohongshuFlowsReference(input) {
  const { context, helpers } = input;
  const samples = buildXiaohongshuSamples(helpers.collectXiaohongshuSamples(context));
  const entries = [
    ...(context.intentsDocument.intents ?? []),
    ...buildXiaohongshuSyntheticIntents(context, helpers),
  ]
    .sort((left, right) => String(left.intentType).localeCompare(String(right.intentType), 'en'))
    .map((intent) => {
      const normalizedIntentType = normalizeXiaohongshuIntentType(intent.intentType);
      const bodyLines = /** @type {any[]} */ ([]);
      if (normalizedIntentType === 'search-note') {
        bodyLines.push(`- Example user requests: ${samples.searchQueries.map((item) => `\`搜索笔记 ${item}\``).join(', ') || '`搜索笔记 穿搭`'}`);
        bodyLines.push('- Start state: any verified public Xiaohongshu page.');
        bodyLines.push('- Target state: a search results page on `www.xiaohongshu.com/search_result`.');
        bodyLines.push('- Main path: fill the visible search box or navigate directly with `keyword=<query>`.');
        bodyLines.push('- Success signal: the final page preserves the query and exposes at least one verified note card.');
      } else if (normalizedIntentType === 'open-note') {
        bodyLines.push(`- Example user requests: ${samples.notes.map((item) => `\`打开笔记 ${item}\``).join(', ') || '`打开笔记`'}`);
        bodyLines.push('- Start state: discover page, search results page, or a user homepage with note cards.');
        bodyLines.push('- Target state: a note detail page on `www.xiaohongshu.com/explore/<noteId>`.');
        bodyLines.push('- Main path: open a verified note card from discover, search, or user-homepage results.');
        bodyLines.push('- Success signal: the final page is a note detail page with a stable title and owner link when present.');
      } else if (normalizedIntentType === 'download-note') {
        bodyLines.push(`- Example user requests: ${samples.notes.map((item) => `\`下载笔记 ${item}\``).join(', ') || '`下载笔记`'}`);
        bodyLines.push('- Start state: search results, note detail, or user homepage pages with verified note cards.');
        bodyLines.push('- Target state: a resolved image-first note bundle prepared for the shared downloader.');
        bodyLines.push('- Main path: rank image-first notes, resolve the verified note detail page, then hand off to the shared downloader.');
        bodyLines.push('- Success signal: the output bundle retains the note URL, note metadata, and resolved image assets.');
      } else if (normalizedIntentType === 'open-user') {
        bodyLines.push(`- Example user requests: ${samples.users.map((item) => formatUserExample(item)).join(', ') || '`打开用户主页`'}`);
        bodyLines.push('- Start state: a note detail page, search results page, or another public page with creator links.');
        bodyLines.push('- Target state: a public user homepage on `www.xiaohongshu.com/user/profile/<userId>`.');
        bodyLines.push('- Main path: open the creator link from a note card or note detail page.');
        bodyLines.push('- Success signal: the final page is a user homepage and the requested user identity matches when present.');
      } else if (normalizedIntentType === 'browse-discover') {
        bodyLines.push(`- Example user requests: ${samples.discoverEntries.map((item) => item === DISCOVER_ENTRY_FALLBACK ? '`浏览发现页`' : `\`打开发现页 ${item}\``).join(', ') || '`浏览发现页`'}`);
        bodyLines.push('- Start state: any verified Xiaohongshu page.');
        bodyLines.push('- Target state: the discover surface rooted at `https://www.xiaohongshu.com/explore`.');
        bodyLines.push('- Main path: navigate directly to `/explore` or use a verified discover entrypoint.');
        bodyLines.push('- Success signal: the final URL remains on the discover family rather than `/search_result` or `/user/profile/...`.');
      } else if (normalizedIntentType === 'open-auth-page') {
        bodyLines.push(`- Example user requests: ${buildAuthExamples(samples.authEntries).join(', ')}`);
        bodyLines.push('- Start state: any verified Xiaohongshu page.');
        bodyLines.push('- Target state: a login or register page under `www.xiaohongshu.com/login` or `www.xiaohongshu.com/register`.');
        bodyLines.push('- Main path: navigate directly to the requested auth entrypoint.');
        bodyLines.push('- Safety note: stop after the auth page opens; do not auto-fill or auto-submit credentials.');
        bodyLines.push('- Success signal: the final page is the requested auth page and no credential submission occurs.');
      } else if (normalizedIntentType === 'open-utility-page') {
        bodyLines.push(`- Example user requests: ${buildUtilityExamples(samples.utilityEntries).join(', ')}`);
        bodyLines.push('- Start state: any verified Xiaohongshu page with reusable authenticated state when required.');
        bodyLines.push('- Target state: a verified utility page such as `/notification` or another approved utility entrypoint.');
        bodyLines.push('- Main path: navigate directly to a verified utility entrypoint.');
        bodyLines.push('- Success signal: the final URL remains inside the approved Xiaohongshu utility path family.');
      } else if (normalizedIntentType === 'list-followed-users') {
        bodyLines.push(`- Example user requests: ${FOLLOW_QUERY_EXAMPLES.map((item) => `\`${item}\``).join(', ')}.`);
        bodyLines.push('- Start state: a valid persisted authenticated Xiaohongshu profile on the local-profile browser.');
        bodyLines.push('- Target state: a read-only follow-list result with `users[]`, `name`, `userId`, and `url`.');
        bodyLines.push('- Main path: verify authenticated state, then reuse the official frontend runtime module `40122.tF()` to request `/api/sns/web/v1/intimacy/intimacy_list`.');
        bodyLines.push('- Fallback path: if the official runtime path is unavailable, reuse existing self-profile/state heuristics and report `partial`, `captcha-gated`, or `unauthenticated` precisely.');
        bodyLines.push('- Success signal: the result returns followed-user rows without requiring manual DOM-only enumeration from the self profile page.');
      } else {
        bodyLines.push('- Navigation-only flow inside the verified Xiaohongshu URL family.');
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
    '- Xiaohongshu public routing stays on `www.xiaohongshu.com` for discover, search, note detail, and user homepage pages.',
    '- Discover browsing and search are different surfaces: `/explore` is discover, `/search_result` is keyword search.',
    '- Login or register pages may be opened as read-only navigation targets, but credential submission is always manual.',
    '- Notification-style utility pages and follow queries are authenticated read-only surfaces and should never imply account mutation.',
    '- `list-followed-users` uses the same reusable persisted profile boundary as other authenticated Xiaohongshu utilities.',
    '- The current Xiaohongshu skill surface is intentionally read-only and excludes like, favorite, follow mutation, comment, message composition, publish, and purchase actions.',
  ], helpers.slugifyAscii);
}

function renderXiaohongshuNlIntentsReference(input) {
  const { context, helpers } = input;
  const samples = buildXiaohongshuSamples(helpers.collectXiaohongshuSamples(context));
  const intentTypes = resolveSupportedIntentTypes(context, helpers);
  const entries = /** @type {any[]} */ ([]);
  if (intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')) {
    entries.push({
      title: 'Search notes',
      bodyLines: [
        '- Slots: `queryText`.',
        `- Examples: ${samples.searchQueries.map((item) => `\`搜索笔记 ${item}\``).join(', ') || '`搜索笔记 穿搭`'}`,
        '- Notes: prefer “笔记 / 图文 / 帖子” phrasing over 书籍 / 作品 wording when the request routes to Xiaohongshu.',
      ],
    });
  }
  if (intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')) {
    entries.push({
      title: 'Open note pages',
      bodyLines: [
        '- Slots: `noteTitle` or `noteId`.',
        `- Examples: ${samples.notes.map((item) => `\`打开笔记 ${item}\``).join(', ') || '`打开笔记`'}`,
        '- Detail-family note: keep `/explore/<noteId>` on the same public `open-note` surface.',
      ],
    });
  }
  if (intentTypes.has('download-video') || intentTypes.has('download-book') || intentTypes.has('download-work')) {
    entries.push({
      title: 'Download note bundles',
      bodyLines: [
        '- Slots: `noteTitle`, `noteId`, or resolved note URLs.',
        `- Examples: ${samples.notes.map((item) => `\`下载笔记 ${item}\``).join(', ') || '`下载笔记`'}`,
        '- Notes: user phrasing may prefer “下载图文”“下载图片帖子”; both should map to the same image-note download flow.',
      ],
    });
  }
  if (intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')) {
    entries.push({
      title: 'Open user homepages',
      bodyLines: [
        '- Slots: `userName` or `userId`.',
        `- Examples: ${samples.users.map((item) => formatUserExample(item)).join(', ') || '`打开用户主页`'}`,
        '- User-family note: `/user/profile/<userId>` remains the verified public homepage family.',
      ],
    });
  }
  if (intentTypes.has('open-category')) {
    entries.push({
      title: 'Browse discover page',
      bodyLines: [
        '- Slots: `targetMemberId`.',
        `- Examples: ${samples.discoverEntries.map((item) => item === DISCOVER_ENTRY_FALLBACK ? '`浏览发现页`' : `\`打开发现页 ${item}\``).join(', ') || '`浏览发现页`'}`,
        '- Notes: discover routing should resolve to `/explore`, not `/search_result`.',
      ],
    });
  }
  if (intentTypes.has('open-auth-page')) {
    entries.push({
      title: 'Open login/register pages',
      bodyLines: [
        '- Slots: `targetMemberId`.',
        `- Examples: ${buildAuthExamples(samples.authEntries).join(', ')}`,
        '- Notes: opening the page is allowed, but filling or submitting credentials is out of scope for automation.',
      ],
    });
  }
  if (intentTypes.has('open-utility-page')) {
    entries.push({
      title: 'Open utility pages',
      bodyLines: [
        '- Slots: `targetMemberId`.',
        `- Examples: ${buildUtilityExamples(samples.utilityEntries).join(', ')}`,
        '- Notes: the current verified authenticated utility surface is notification-oriented.',
      ],
    });
  }
  if (intentTypes.has('list-followed-users')) {
    entries.push({
      title: 'List followed users',
      bodyLines: [
        '- Slots: none.',
        `- Examples: ${FOLLOW_QUERY_EXAMPLES.map((item) => `\`${item}\``).join(', ')}`,
        '- Notes: requires the local persisted authenticated Xiaohongshu profile and returns a read-only `users[]` result.',
        '- Output modes: `summary`, `users`, JSON, and Markdown summaries are supported by the query entrypoint.',
      ],
    });
  }
  return renderNlIntentsTemplate(entries);
}

function renderXiaohongshuInteractionModelReference(input) {
  const { context, helpers } = input;
  const samples = buildXiaohongshuSamples(helpers.collectXiaohongshuSamples(context));
  const elementsById = helpers.buildElementsById(context);
  const rows = [
    ...(context.intentsDocument.intents ?? []),
    ...buildXiaohongshuSyntheticIntents(context, helpers),
  ].map((intent) => ({
    intent: helpers.displayIntentLabel(context, intent.intentType),
    element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
    action: intent.actionId,
    stateField: intent.stateField,
  }));
  return renderInteractionTemplate({
    summaryTitle: '## Capability summary',
    summaryLines: [
      `- 笔记样本: ${samples.notes.join(', ') || 'none'}`,
      `- 用户样本: ${samples.users.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 发现页样本: ${samples.discoverEntries.join(', ') || DISCOVER_ENTRY_FALLBACK}`,
      `- 登录页样本: ${samples.authEntries.join(', ') || LOGIN_ENTRY_FALLBACK}`,
      `- 功能页样本: ${samples.utilityEntries.join(', ') || NOTIFICATION_ENTRY_FALLBACK}`,
    ],
    table: helpers.renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
    extraSections: [
      {
        title: '## Boundary notes',
        lines: [
          '- Public discover, search, note detail, and user homepage pages stay on the verified `www.xiaohongshu.com` family.',
          '- Search pages, note detail pages, and user homepages should expose Xiaohongshu-specific labels such as 笔记、用户主页、发现页 and 通知页 when applicable.',
          '- Login/register entrypoints are navigation-only targets; automation must not auto-fill or auto-submit credentials.',
          '- `list-followed-users` runs against the same authenticated read-only profile boundary and prefers the official frontend follow-list runtime.',
          '- The interaction model is read-only and excludes engagement, publishing, or transaction workflows.',
        ],
      },
    ],
  });
}

export const XIAOHONGSHU_SITE_RENDERER = Object.freeze({
  skill: renderXiaohongshuSkillMd,
  index: renderXiaohongshuIndexReference,
  flows: renderXiaohongshuFlowsReference,
  nlIntents: renderXiaohongshuNlIntentsReference,
  interactionModel: renderXiaohongshuInteractionModelReference,
});
