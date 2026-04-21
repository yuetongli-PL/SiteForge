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

function normalizeBilibiliIntentType(intentType) {
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

const BILIBILI_CATEGORY_LABELS = Object.freeze({
  c: 'channels',
  anime: 'anime',
  movie: 'movie',
  guochuang: 'guochuang',
  tv: 'tv',
  variety: 'variety',
  documentary: 'documentary',
  knowledge: 'knowledge',
  music: 'music',
  game: 'game',
  food: 'food',
  sports: 'sports',
});

function normalizeBilibiliVideoTitle(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const cleaned = raw
    .replace(/_哔哩哔哩_bilibili$/u, '')
    .replace(/[-_ ]*哔哩哔哩(?:视频)?$/u, '')
    .trim();
  return cleaned || raw;
}

function normalizeBilibiliUpProfile(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(.+?)的个人空间(?:-.+)?$/u);
  if (match?.[1]) {
    return match[1].trim();
  }
  return raw
    .replace(/-哔哩哔哩视频$/u, '')
    .replace(/个人主页$/u, '')
    .trim();
}

function normalizeBilibiliCategoryEntry(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const normalized = raw
    .replace(/^\/+|\/+$/gu, '')
    .replace(/^v\/popular(?:\/all)?$/u, 'popular')
    .toLowerCase();
  return BILIBILI_CATEGORY_LABELS[normalized] ?? normalized;
}

function formatBilibiliUpExample(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '`open a UP profile`';
  }
  return /^UP\s+/u.test(normalized)
    ? `\`open ${normalized}\``
    : `\`open UP ${normalized}\``;
}

function buildBilibiliScenarioLines(samples) {
  return [
    '- Verified scenario families:',
    '- home -> search results -> video detail -> UP profile',
    samples.validatedCategoryUrls?.length
      ? `- category/channel entrypoints -> content detail (${samples.validatedCategoryUrls.join(', ')})`
      : '- category/channel entrypoints -> content detail',
    samples.bangumiEntries?.length
      ? `- bangumi detail family (${samples.bangumiEntries.join(', ')})`
      : '- bangumi detail family',
    samples.authorSubpages?.length
      ? `- UP video subpages -> content detail (${samples.authorSubpages.join(', ')})`
      : '- UP video subpages -> content detail',
  ].filter(Boolean);
}

function buildBilibiliSamples(samples) {
  return {
    ...samples,
    videos: dedupeSampleList(samples.videos, normalizeBilibiliVideoTitle),
    upProfiles: dedupeSampleList(samples.upProfiles, normalizeBilibiliUpProfile),
    categoryEntries: dedupeSampleList(samples.categoryEntries, normalizeBilibiliCategoryEntry),
    bangumiEntries: dedupeSampleList(samples.bangumiEntries, (value) => String(value ?? '').trim() || null),
    authorSubpages: dedupeSampleList(samples.authorSubpages, (value) => String(value ?? '').trim() || null),
    validatedCategoryUrls: dedupeSampleList(samples.validatedCategoryUrls, (value) => String(value ?? '').trim() || null),
    allowedHosts: dedupeSampleList(samples.allowedHosts, (value) => String(value ?? '').trim() || null),
    searchQueries: dedupeSampleList(samples.searchQueries, (value) => String(value ?? '').trim() || null),
  };
}

function renderBilibiliSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const samples = buildBilibiliSamples(helpers.collectBilibiliSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')
      ? 'search videos by title, BV code, or keyword'
      : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')
      ? 'open verified video detail pages'
      : null,
    intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')
      ? 'open verified UP profiles'
      : null,
    samples.categoryEntries.length
      ? 'navigate approved category and channel entry pages'
      : null,
    intentTypes.has('open-utility-page')
      ? 'open utility/help pages'
      : null,
  ].filter(Boolean);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search videos, open verified video pages, open verified UP profiles, and navigate approved bilibili category/channel pages inside the bilibili URL family.`,
    heading: 'bilibili Skill',
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified bilibili URL family: `www.bilibili.com`, `search.bilibili.com`, and `space.bilibili.com`.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      `- Supported tasks: ${supportedTasks.join(', ') || 'query and navigate within the observed bilibili state space'}.`,
      '- Cross-host navigation model: home and video pages on `www.bilibili.com`, search results on `search.bilibili.com/all`, UP profiles on `space.bilibili.com/<mid>`.',
    ],
    sampleCoverageLines: [
      `- Video samples: ${samples.videos.join(', ') || 'none'}`,
      `- UP profile samples: ${samples.upProfiles.join(', ') || 'none'}`,
      `- Search query samples: ${samples.searchQueries.join(', ') || 'none'}`,
      `- Approved category/channel families: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- Verified bangumi detail entrypoints: ${samples.bangumiEntries.join(', ') || 'none'}`,
      `- Verified UP video subpages: ${samples.authorSubpages.join(', ') || 'none'}`,
      ...buildBilibiliScenarioLines(samples),
    ],
    executionPolicyLines: [
      '- Public bilibili pages MUST use the built-in browser.',
      '- Authenticated bilibili pages MUST use the local opener: `node .\\scripts\\bilibili-action.mjs open <bilibili-authenticated-url>`.',
      '- Download requests MUST use the local downloader through the action router: `node .\\scripts\\bilibili-action.mjs download <url-or-bv>...`.',
      '- The built-in browser NEVER carries bilibili login state.',
      '- Authenticated bilibili surfaces include `space/<mid>/dynamic`, `space/<mid>/fans/follow`, `space/<mid>/fans/fans`, `https://www.bilibili.com/watchlater/#/list`, and `https://space.bilibili.com/<mid>/favlist?...`.',
      '- If an authenticated surface needs a reusable local session, the router MUST trigger the local login helper before continuing.',
      '- Routing table: public home/search/video/bangumi/UP/category pages -> `builtin-browser`; authenticated read-only pages -> `local-profile-browser`; login bootstrap -> `site-login`; downloads -> `src/sites/bilibili/download/python/bilibili.py` via the action router.',
    ],
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- Search and public navigation are low-risk actions.',
      '- Treat video pages, bangumi detail pages, UP profiles, UP video subpages, search results, and approved category/channel pages as read-only navigation surfaces.',
      '- Login bootstrap is allowed only through the local helper path, and authenticated surfaces must stay read-only after login.',
      '- No follow, like, coin, favorite mutation, post, or upload action is in scope.',
    ],
    doNotDoLines: [
      '- Do not leave the verified bilibili URL family.',
      '- Do not invent unobserved engagement flows such as commenting, following, or purchasing.',
      '- Do not open authenticated bilibili surfaces in the built-in browser.',
      '- Do not route downloads through browser navigation when the action router or downloader applies.',
      '- Do not submit auth forms or any unknown side-effect action without approval.',
    ],
  });
}

function renderBilibiliIndexReference(input) {
  const { context, outputs, docsByIntent, helpers } = input;
  const samples = buildBilibiliSamples(helpers.collectBilibiliSamples(context));
  const intents = context.intentsDocument.intents ?? [];
  const displayTargetsByIntent = new Map([
    ['search-video', samples.searchQueries],
    ['open-video', samples.videos],
    ['open-author', samples.upProfiles],
    ['open-category', samples.categoryEntries],
  ]);
  const rows = buildIntentCoverageRows(
    intents,
    docsByIntent,
    outputs.indexMd,
    helpers.markdownLink,
    (intentType) => helpers.displayIntentLabel(context, intentType),
    (intent, flowLink) => {
      const normalizedIntentType = normalizeBilibiliIntentType(intent.intentType);
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
    title: 'bilibili Index',
    siteSummaryLines: [
      `- Entry URL: \`${context.url}\``,
      '- Site type: video catalog + search hub + UP profile navigation.',
      `- Verified hosts: ${samples.allowedHosts.join(', ') || 'none'}`,
      `- Video samples: ${samples.videos.join(', ') || 'none'}`,
      `- UP profile samples: ${samples.upProfiles.join(', ') || 'none'}`,
      `- Search query samples: ${samples.searchQueries.join(', ') || 'none'}`,
      `- Approved category/channel families: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- Verified category URLs: ${samples.validatedCategoryUrls.join(', ') || 'none'}`,
      `- Verified bangumi detail URLs: ${samples.bangumiEntries.join(', ') || 'none'}`,
      `- Verified UP video subpages: ${samples.authorSubpages.join(', ') || 'none'}`,
    ],
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    sampleCoverageTable: helpers.renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    notesTitle: '## Notes',
    notesLines: [
      '- Search traffic is expected to land on `search.bilibili.com/all`.',
      '- Verified creator navigation is expected to land on `space.bilibili.com/<mid>`.',
      '- The current observed bilibili model is navigation-first: search videos, open video pages, open bangumi detail pages, open UP profiles, and traverse verified UP video subpages / category entrypoints.',
      '- `open-video` intentionally covers both ordinary video detail pages and `bangumi/play` detail pages.',
      '- `open-author` covers both UP home pages and verified `space/<mid>/video` author subpages as read-only navigation surfaces.',
      '- No verified download, follow, coin, favorite, or publishing flow is included in the current skill output.',
    ],
  });
}

function renderBilibiliFlowsReference(input) {
  const { context, helpers } = input;
  const samples = buildBilibiliSamples(helpers.collectBilibiliSamples(context));
  const entries = [...(context.intentsDocument.intents ?? [])]
    .sort((left, right) => String(left.intentType).localeCompare(String(right.intentType), 'en'))
    .map((intent) => {
      const normalizedIntentType = normalizeBilibiliIntentType(intent.intentType);
      const bodyLines = [];
      if (normalizedIntentType === 'search-video') {
        bodyLines.push(`- Example user requests: ${samples.searchQueries.map((item) => `\`search ${item}\``).join(', ') || '`search bilibili videos`'}`);
        bodyLines.push('- Start state: any verified public bilibili page.');
        bodyLines.push('- Target state: a bilibili search results page on `search.bilibili.com/all`.');
        bodyLines.push('- Main path: fill the top search form or navigate directly with the query parameter.');
        bodyLines.push('- Result semantics: treat `/all`, `/video`, `/bangumi`, and `/upuser` as the same search family with different visible result mixes.');
        bodyLines.push('- Query guidance: prefer exact BV codes first, then full titles, then short distinctive keywords.');
        bodyLines.push('- Success signal: the result page preserves the query and exposes at least one verified video card.');
      } else if (normalizedIntentType === 'open-video') {
        bodyLines.push(`- Example user requests: ${samples.videos.map((item) => `\`open ${item}\``).join(', ') || '`open a bilibili video`'}`);
        bodyLines.push('- Start state: the home page, a search results page, or another verified public navigation page.');
        bodyLines.push('- Target state: a video detail page on `www.bilibili.com/video/...` or `www.bilibili.com/bangumi/play/...`.');
        bodyLines.push('- Main path: open a verified video card or resolve the exact BV code from search.');
        bodyLines.push('- Slot guidance: accept either `videoCode` (preferred BV code) or `videoTitle`; bangumi requests stay on the same `open-video` surface.');
        bodyLines.push(`- Verified bangumi detail examples: ${samples.bangumiEntries.join(', ') || 'none'}`);
        bodyLines.push('- Success signal: the final page is a video or bangumi detail page with a stable title and an owner link when present.');
      } else if (normalizedIntentType === 'open-author') {
        bodyLines.push(`- Example user requests: ${samples.upProfiles.map((item) => formatBilibiliUpExample(item)).join(', ') || '`open a UP profile`'}`);
        bodyLines.push('- Start state: a verified video detail page or another public page with creator links.');
        bodyLines.push('- Target state: a UP profile on `space.bilibili.com/<mid>`.');
        bodyLines.push('- Main path: open the owner link from the video card or detail page.');
        bodyLines.push('- Slot guidance: prefer stable UP identifiers or exact display names; keep `space/<mid>/video` as a read-only author subpage, not a separate public intent.');
        bodyLines.push(`- Verified UP video subpages: ${samples.authorSubpages.join(', ') || 'none'}`);
        bodyLines.push('- Success signal: the final page is a creator profile and the UP display name matches the requested target.');
      } else if (normalizedIntentType === 'open-category') {
        bodyLines.push(`- Example user requests: ${samples.categoryEntries.map((item) => `\`open ${item}\``).join(', ') || '`open a category page`'}`);
        bodyLines.push('- Start state: any verified public bilibili page.');
        bodyLines.push('- Target state: an approved category or channel page under the configured path prefixes.');
        bodyLines.push('- Main path: navigate directly to a verified category/channel entrypoint.');
        bodyLines.push('- Slot guidance: map user category language onto approved channel families or validated category URLs.');
        bodyLines.push(`- Verified category URLs: ${samples.validatedCategoryUrls.join(', ') || 'none'}`);
        bodyLines.push('- Success signal: the final URL remains inside the approved bilibili path family.');
      } else {
        bodyLines.push('- Navigation-only flow inside the verified bilibili URL family.');
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
  if (!entries.some((entry) => entry.intentType === 'open-category') && samples.categoryEntries.length > 0) {
    entries.push({
      title: '打开分类和频道页',
      anchorHint: 'open-category',
      intentId: 'synthetic-open-category',
      intentType: 'open-category',
      actionId: 'open-category',
      summary: '打开分类和频道页',
      bodyLines: [
        '- Slots: `categoryName`',
        `- Examples: ${samples.categoryEntries.map((item) => `\`open ${item}\``).join(', ') || '`open a category page`'}`,
        '- Start state: any verified public bilibili page.',
        '- Target state: an approved category or channel page under the configured path prefixes.',
        '- Main path: navigate directly to a verified category/channel entrypoint.',
        `- Verified category URLs: ${samples.validatedCategoryUrls.join(', ') || 'none'}`,
        '- Success signal: the final URL remains inside the approved bilibili path family.',
      ],
    });
  }
  return renderFlowsTemplate(entries, [
    '- Cross-host navigation is expected: search can move to `search.bilibili.com`, while UP profiles open on `space.bilibili.com`.',
    '- Treat category/channel pages and `space/<mid>/video` subpages as read-only navigation entrypoints, not as engagement workflows.',
    '- `www.bilibili.com/bangumi/play/...` is a verified detail family and remains mapped onto the existing `open-video` surface.',
    '- The current bilibili skill surface is intentionally navigation-first and excludes follow, comment, coin, favorite, and upload actions.',
  ], helpers.slugifyAscii);
}

function renderBilibiliNlIntentsReference(input) {
  const { context, helpers } = input;
  const samples = buildBilibiliSamples(helpers.collectBilibiliSamples(context));
  const intentTypes = helpers.getIntentTypes(context);
  const entries = [];
  if (intentTypes.has('search-video') || intentTypes.has('search-book') || intentTypes.has('search-work')) {
    entries.push({
      title: 'Search videos',
      bodyLines: [
        '- Slots: `queryText`',
        `- Examples: ${samples.searchQueries.map((item) => `\`search ${item}\``).join(', ') || '`search bilibili videos`'}`,
        '- Notes: prefer exact BV codes, then full video titles, then short distinctive keywords.',
        '- Search-family note: `/all`, `/video`, `/bangumi`, and `/upuser` are treated as one verified search-results family.',
      ],
    });
  }
  if (intentTypes.has('open-video') || intentTypes.has('open-book') || intentTypes.has('open-work')) {
    entries.push({
      title: 'Open video pages',
      bodyLines: [
        '- Slots: `videoTitle` or `videoCode`',
        `- Examples: ${samples.videos.map((item) => `\`open ${item}\``).join(', ') || '`open a bilibili video`'}`,
        `- Verified bangumi detail entrypoints: ${samples.bangumiEntries.join(', ') || 'none'}`,
        '- Detail-family note: ordinary videos and `bangumi/play` pages stay on the same public `open-video` surface.',
      ],
    });
  }
  if (intentTypes.has('open-author') || intentTypes.has('open-up') || intentTypes.has('open-model') || intentTypes.has('open-actress')) {
    entries.push({
      title: 'Open UP profiles',
      bodyLines: [
        '- Slots: `upName`',
        `- Examples: ${samples.upProfiles.map((item) => formatBilibiliUpExample(item)).join(', ') || '`open a UP profile`'}`,
        `- Verified UP video subpages: ${samples.authorSubpages.join(', ') || 'none'}`,
        '- Author-family note: `space/<mid>` and `space/<mid>/video` are both verified read-only author surfaces.',
      ],
    });
  }
  if (intentTypes.has('open-category') || samples.categoryEntries.length > 0) {
    entries.push({
      title: '打开分类和频道页',
      bodyLines: [
        '- Slots: `categoryName`',
        `- Examples: ${samples.categoryEntries.map((item) => `\`open ${item}\``).join(', ') || '`open a category page`'}`,
        `- Verified category URLs: ${samples.validatedCategoryUrls.join(', ') || 'none'}`,
        '- Category-family note: map user language to approved category/channel families before navigating.',
      ],
    });
  }
  return renderNlIntentsTemplate(entries);
}

function renderBilibiliInteractionModelReference(input) {
  const { context, helpers } = input;
  const samples = buildBilibiliSamples(helpers.collectBilibiliSamples(context));
  const elementsById = helpers.buildElementsById(context);
  const rows = (context.intentsDocument.intents ?? []).map((intent) => ({
    intent: helpers.displayIntentLabel(context, intent.intentType),
    element: `${intent.elementId} (${elementsById.get(intent.elementId)?.kind ?? '-'})`,
    action: intent.actionId,
    stateField: intent.stateField,
  }));
  return renderInteractionTemplate({
    summaryTitle: '## Capability summary',
    summaryLines: [
      `- Hosts: ${samples.allowedHosts.join(', ') || 'none'}`,
      `- Video samples: ${samples.videos.join(', ') || 'none'}`,
      `- UP profile samples: ${samples.upProfiles.join(', ') || 'none'}`,
      `- Search query samples: ${samples.searchQueries.join(', ') || 'none'}`,
      `- Approved category/channel families: ${samples.categoryEntries.join(', ') || 'none'}`,
      `- Verified bangumi detail URLs: ${samples.bangumiEntries.join(', ') || 'none'}`,
      `- Verified UP video subpages: ${samples.authorSubpages.join(', ') || 'none'}`,
    ],
    table: helpers.renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
    extraSections: [
      {
        title: '## Boundary notes',
        lines: [
          '- Search requests should remain inside `search.bilibili.com/all`.',
          '- Verified creator navigation should resolve to `space.bilibili.com/<mid>`.',
          '- `space.bilibili.com/<mid>/video` and `www.bilibili.com/bangumi/play/...` are verified read-only sub-scenarios.',
          '- Search pages, detail pages, author pages, and category/channel pages carry bilibili-specific page facts such as BV, UP mid, content type, and featured content cards.',
          '- The interaction model is read-only and excludes engagement or account workflows.',
        ],
      },
    ],
  });
}

export const BILIBILI_SITE_RENDERER = Object.freeze({
  skill: renderBilibiliSkillMd,
  index: renderBilibiliIndexReference,
  flows: renderBilibiliFlowsReference,
  nlIntents: renderBilibiliNlIntentsReference,
  interactionModel: renderBilibiliInteractionModelReference,
});
