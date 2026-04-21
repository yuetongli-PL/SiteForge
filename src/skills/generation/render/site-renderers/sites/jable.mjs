import {
  buildIntentCoverageRows,
  renderFlowsTemplate,
  renderIndexTemplate,
  renderInteractionTemplate,
  renderNlIntentsTemplate,
  renderReadingOrder,
  renderReferenceNavigation,
  renderSkillTemplate,
} from '../shared.mjs';

function renderJableSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const samples = helpers.collectJableSamples(context);
  const intentTypes = helpers.getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') ? '搜索影片' : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') ? '打开影片页' : null,
    intentTypes.has('open-model') || intentTypes.has('open-author') ? '打开演员页' : null,
    intentTypes.has('open-category') ? '打开分类或标签页' : null,
    intentTypes.has('list-category-videos') ? '按分类或标签提取前 N 条榜单' : null,
    intentTypes.has('open-utility-page') ? '打开功能页' : null,
  ].filter(Boolean);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search videos, open verified video or actor pages, navigate the approved jable URL family, or extract objective top-N lists from verified category and tag pages.`,
    heading: 'jable Skill',
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified `jable.tv` URL family.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      `- Supported tasks: ${supportedTasks.join('、') || '在已观测站点空间内查询和导航'}.`,
      '- Ranking query entrypoint: `node src/entrypoints/sites/jable-ranking.mjs <url> --query "<自然语言请求>"`.',
    ],
    sampleCoverageLines: [
      `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
      `- 演员样本: ${samples.models.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 分类组: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、') || 'none'}`,
    ],
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- Search and public navigation are low-risk actions.',
      '- “推荐 / 最佳 / 近期最佳”统一解释为站内公开排序结果，不做主观推荐。',
      '- 一级分类组查询默认按组内所有标签页聚合、去重后取前 N 条。',
      '- Keep answers inside verified video, actor, category, tag, and search pages.',
      '- No downloads, purchases, auth submission, or off-site navigation are in scope.',
    ],
    doNotDoLines: [
      '- Do not leave the verified jable URL family.',
      '- Do not invent unobserved actions or side-effect flows.',
      '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
    ],
  });
}

function renderJableIndexReference(input) {
  const { context, outputs, docsByIntent, helpers } = input;
  const samples = helpers.collectJableSamples(context);
  const intents = context.intentsDocument.intents ?? [];
  const intentTypes = helpers.getIntentTypes(context);
  const verifiedTasks = [
    intentTypes.has('search-video') || intentTypes.has('search-book') ? '搜索影片' : null,
    intentTypes.has('open-video') || intentTypes.has('open-book') ? '打开影片页' : null,
    intentTypes.has('open-model') || intentTypes.has('open-author') ? '打开演员页' : null,
    intentTypes.has('open-category') ? '打开分类或标签页' : null,
    intentTypes.has('list-category-videos') ? '分类榜单查询' : null,
    intentTypes.has('open-utility-page') ? '打开功能页' : null,
  ].filter(Boolean);
  const displayTargetsByIntent = new Map([
    ['open-video', samples.videos],
    ['open-book', samples.videos],
    ['open-work', samples.videos],
    ['open-model', samples.models],
    ['open-author', samples.models],
    ['open-actress', samples.models],
    ['open-category', samples.categories],
    ['list-category-videos', samples.categories],
    ['search-video', samples.searchQueries],
    ['search-book', samples.searchQueries],
    ['search-work', samples.searchQueries],
  ]);
  const rows = buildIntentCoverageRows(
    intents,
    docsByIntent,
    outputs.indexMd,
    helpers.markdownLink,
    (intentType) => helpers.displayIntentLabel(context, intentType),
    (intent, flowLink) => ({
      intent: helpers.displayIntentLabel(context, intent.intentType),
      flow: flowLink,
      actionableTargets: (
        displayTargetsByIntent.get(intent.intentType)
        ?? (intent.targetDomain?.actionableValues ?? []).map((value) => helpers.normalizeDisplayLabel(value.label, {
          siteContext: context.siteContext,
          inputUrl: context.url,
        }))
      ).join(', ') || '-',
      recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
        .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
        .map((value) => helpers.normalizeDisplayLabel(value.label, {
          siteContext: context.siteContext,
          inputUrl: context.url,
        }))
        .join(', ') || '-',
    }),
  );
  const siteSummaryLines = [
    `- Entry URL: \`${context.url}\``,
    '- Site type: navigation hub + catalog detail.',
    `- Verified tasks: ${verifiedTasks.join('、') || '在已观测站点空间内查询和导航'}.`,
    `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
    `- 演员样本: ${samples.models.join(', ') || 'none'}`,
    `- 分类样本: ${samples.categories.join(', ') || 'none'}`,
    ...(
      samples.categoryGroups.length > 0
        ? [
            '- 分类树摘要:',
            ...samples.categoryGroups.map((group) => `  - ${group.groupLabel}: ${group.tags.slice(0, 8).join(', ')}${group.tags.length > 8 ? ` 等 ${group.tags.length} 个标签` : ''}`),
          ]
        : []
    ),
    `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
  ];
  return renderIndexTemplate({
    title: 'jable Index',
    siteSummaryLines,
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    sampleCoverageTable: helpers.renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    notesTitle: '## Notes',
    notesLines: [
      '- 当前站点 Skill 以导航为主：覆盖搜索、影片页、演员页、分类/标签页和功能页。',
      '- 新增榜单型查询：可以按任一已抽取 taxonomy 标签或一级分类组，返回站内前 N 条公开结果。',
      '- 实际执行入口：`node src/entrypoints/sites/jable-ranking.mjs https://jable.tv/ --query "<请求>"`。',
      '- “推荐/最佳/近期最佳”默认解释为站内综合排序，不输出主观推荐话术。',
      '- 当前已观测的 jable 模型里，没有已验证的下载或长文本阅读流程。',
    ],
  });
}

function renderJableFlowsReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectJableSamples(context);
  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const entries = intents.map((intent) => {
    const label = helpers.displayIntentLabel(context, intent.intentType);
    const bodyLines = [];
    if (label === '搜索影片') {
      const queries = samples.searchQueries.length ? samples.searchQueries : samples.videos.slice(0, 3);
      bodyLines.push(`- Example user requests: ${queries.map((query) => `\`搜索${query}\``).join(', ') || '`搜索影片`'}`);
      bodyLines.push('- Start state: any verified public page.');
      bodyLines.push('- Target state: a `/search/` results page or a directly resolved `/videos/...` page.');
      bodyLines.push('- Main path: fill the search box -> submit -> open the matching video result if needed.');
      bodyLines.push('- Success signal: the result page mentions the query or the final URL matches `/videos/...`.');
      bodyLines.push('- Disambiguation rule: prefer exact code matches such as `JUR-652` over fuzzy title fragments.');
    } else if (label === '打开影片' || label === '打开影片页') {
      const videos = samples.videos.slice(0, 4);
      bodyLines.push(`- Example user requests: ${videos.map((video) => `\`打开${video}\``).join(', ') || '`打开影片`'}`);
      bodyLines.push('- Start state: home page, search results page, category page, or any verified public page.');
      bodyLines.push('- Target state: a `/videos/...` detail page.');
      bodyLines.push('- Main path: open the matching video link.');
      bodyLines.push('- Success signal: the final URL matches `/videos/...` and the page shows video metadata.');
    } else if (label === '打开演员页') {
      const models = samples.models.slice(0, 4);
      bodyLines.push(`- Example user requests: ${models.map((model) => `\`打开${model}演员页\``).join(', ') || '`打开演员页`'}`);
      bodyLines.push('- Start state: a video detail page or a verified public page.');
      bodyLines.push('- Target state: the linked `/models/...` page.');
      bodyLines.push('- Main path: read the model link -> open the model page.');
      bodyLines.push('- Success signal: the model name and URL match the selected model.');
    } else if (label === '打开分类页') {
      const categories = samples.categories.slice(0, 4);
      bodyLines.push(`- Example user requests: ${categories.map((item) => `\`打开${item}\``).join(', ') || '`打开标签页`, `进入热门列表`, `打开分类页`'}`);
      bodyLines.push('- Start state: home page or a verified public page.');
      bodyLines.push('- Target state: a category, tag, hot, or list page.');
      bodyLines.push('- Main path: open the matching navigation link.');
      bodyLines.push('- Success signal: the final URL stays inside `/categories/`, `/tags/`, `/hot/`, or `/latest-updates/`.');
      if (samples.categoryGroups.length > 0) {
        bodyLines.push(`- Known taxonomy groups: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、')}`);
      }
    } else if (label === '分类榜单查询') {
      const groups = samples.categoryGroups.slice(0, 3).map((group) => group.groupLabel);
      const tags = samples.categories.slice(0, 3);
      bodyLines.push(`- Example user requests: ${[
        tags[0] ? `\`${tags[0]}分类，近期最佳推荐三部\`` : null,
        tags[1] ? `\`${tags[1]}标签最近更新前五条\`` : null,
        groups[0] ? `\`${groups[0]}分类最高收藏前三\`` : null,
      ].filter(Boolean).join(', ') || '`黑丝分类，近期最佳推荐三部`'}`);
      bodyLines.push('- Start state: home page, category page, tag page, or any verified public page.');
      bodyLines.push('- Target state: a ranked result list extracted from a verified tag page or a taxonomy group aggregate.');
      bodyLines.push('- Main path: resolve the taxonomy target -> open the visible tag or category page -> switch to the requested on-site sort mode -> extract the top N cards.');
      bodyLines.push('- Sort semantics: “推荐/最佳/近期最佳” => 综合排序; “最近/近期” => 最近更新; “最多观看/最热” => 最多觀看; “最高收藏/收藏最多” => 最高收藏。');
      bodyLines.push('- Group aggregation: when the user targets a first-level category group, aggregate the visible top cards from all tags in that group, dedupe by video URL, then rank the merged set.');
      bodyLines.push('- Success signal: return the requested number of ranked cards with title, link, actor names, and any visible metric.');
    } else if (label === '打开功能页') {
      bodyLines.push('- Example user requests: `打开搜索页`, `进入搜索结果页`');
      bodyLines.push('- Start state: any verified public page.');
      bodyLines.push('- Target state: a low-risk utility page such as `/search/`.');
      bodyLines.push('- Main path: open the utility link.');
      bodyLines.push('- Success signal: the requested utility page opens without side effects.');
    }
    return {
      title: label,
      anchorHint: intent.intentType,
      intentId: intent.intentId,
      intentType: label,
      actionId: intent.actionId,
      summary: label,
      bodyLines,
    };
  });
  return renderFlowsTemplate(entries, [
    '- 这组流程以导航为主，不包含下载动作。',
    '- 搜索消歧时，优先区分番号、影片标题和演员名称。',
    '- 询问元数据时，以实时 `/videos/...` 和 `/models/...` 页面为准。',
  ], helpers.slugifyAscii);
}

function renderJableNlIntentsReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectJableSamples(context);
  const intentTypes = helpers.getIntentTypes(context);
  const videoExamples = samples.videos.slice(0, 4);
  const modelExamples = samples.models.slice(0, 4);
  const searchExamples = samples.searchQueries.slice(0, 4);
  const entries = [];
  if (intentTypes.has('search-video') || intentTypes.has('search-book')) {
    entries.push({
      title: '搜索影片',
      bodyLines: [
        '- Slots: `queryText`',
        `- Examples: ${searchExamples.map((item) => `\`搜索${item}\``).join(', ') || videoExamples.map((item) => `\`搜索${item}\``).join(', ') || '`搜索影片`'}`,
        '- Notes: prefer exact video codes or exact titles when available.',
      ],
    });
  }
  if (intentTypes.has('open-video') || intentTypes.has('open-book')) {
    entries.push({
      title: '打开影片页',
      bodyLines: [
        '- Slots: `videoTitle`',
        `- Examples: ${videoExamples.map((item) => `\`打开${item}\``).join(', ') || '`打开影片`'}`,
      ],
    });
  }
  if (intentTypes.has('open-model') || intentTypes.has('open-author')) {
    entries.push({
      title: '打开演员页',
      bodyLines: [
        '- Slots: `actorName`',
        `- Examples: ${modelExamples.map((item) => `\`打开${item}演员页\``).join(', ') || '`打开演员页`'}`,
      ],
    });
  }
  if (intentTypes.has('open-category')) {
    const bodyLines = [
      '- Slots: `targetLabel`',
      `- Examples: ${samples.categories.slice(0, 4).map((item) => `\`打开${item}\``).join(', ') || '`打开热门列表`, `进入标签页`, `打开分类页`'}`,
    ];
    if (samples.categoryGroups.length > 0) {
      bodyLines.push(`- Groups: ${samples.categoryGroups.map((group) => `${group.groupLabel}（${group.tags.slice(0, 5).join('、')}）`).join('；')}`);
    }
    entries.push({
      title: '打开分类页',
      bodyLines,
    });
  }
  if (intentTypes.has('list-category-videos')) {
    entries.push({
      title: '分类榜单查询',
      bodyLines: [
        '- Slots: `taxonomyTarget` + `sortMode?` + `limit?`',
        `- Examples: ${[
          samples.categories[0] ? `\`${samples.categories[0]}分类，近期最佳推荐三部\`` : null,
          samples.categories[1] ? `\`${samples.categories[1]}标签最近更新前五条\`` : null,
          samples.categoryGroups[0] ? `\`${samples.categoryGroups[0].groupLabel}分类最高收藏前三\`` : null,
        ].filter(Boolean).join(', ') || '`黑丝分类，近期最佳推荐三部`'}`,
        '- Sort defaults: `推荐/最佳/近期最佳 => 综合排序`; `最近/近期 => 最近更新`; `最多观看/最热 => 最多观看`; `最高收藏/收藏最多 => 最高收藏`.',
        '- Scope: supports all extracted taxonomy tags and all first-level category groups.',
        '- Execution: `node src/entrypoints/sites/jable-ranking.mjs https://jable.tv/ --query "<请求>"`.',
      ],
    });
  }
  if (intentTypes.has('open-utility-page')) {
    entries.push({
      title: '打开功能页',
      bodyLines: [
        '- Slots: `targetLabel`',
        '- Examples: `打开搜索页`, `进入搜索结果页`',
      ],
    });
  }
  return renderNlIntentsTemplate(entries);
}

function renderJableInteractionModelReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectJableSamples(context);
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
      `- 影片样本: ${samples.videos.join(', ') || 'none'}`,
      `- 演员样本: ${samples.models.join(', ') || 'none'}`,
      `- 搜索样本: ${samples.searchQueries.join(', ') || 'none'}`,
      `- 分类组: ${samples.categoryGroups.map((group) => `${group.groupLabel}(${group.tags.length})`).join('、') || 'none'}`,
    ],
    table: helpers.renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
  });
}

export const JABLE_SITE_RENDERER = Object.freeze({
  skill: renderJableSkillMd,
  index: renderJableIndexReference,
  flows: renderJableFlowsReference,
  nlIntents: renderJableNlIntentsReference,
  interactionModel: renderJableInteractionModelReference,
});
