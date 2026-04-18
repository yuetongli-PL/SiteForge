function joinLines(lines) {
  return lines.join('\n');
}

function pushSection(lines, title, bodyLines) {
  if (!bodyLines || !bodyLines.length) {
    return;
  }
  lines.push(title, '', ...bodyLines, '');
}

function renderReferenceNavigation(outputs, currentFilePath, markdownLink) {
  return [
    `- ${markdownLink('flows.md', currentFilePath, outputs.flowsMd)}`,
    `- ${markdownLink('recovery.md', currentFilePath, outputs.recoveryMd)}`,
    `- ${markdownLink('approval.md', currentFilePath, outputs.approvalMd)}`,
    `- ${markdownLink('nl-intents.md', currentFilePath, outputs.nlIntentsMd)}`,
    `- ${markdownLink('interaction-model.md', currentFilePath, outputs.interactionModelMd)}`,
  ];
}

function renderReadingOrder(outputs, currentFilePath, markdownLink) {
  return [
    `1. Start with ${markdownLink('references/index.md', currentFilePath, outputs.indexMd)}.`,
    `2. For task execution details, read ${markdownLink('references/flows.md', currentFilePath, outputs.flowsMd)}.`,
    `3. For user utterances and slot mapping, read ${markdownLink('references/nl-intents.md', currentFilePath, outputs.nlIntentsMd)}.`,
    `4. For failure handling, read ${markdownLink('references/recovery.md', currentFilePath, outputs.recoveryMd)}.`,
    `5. For approval boundaries, read ${markdownLink('references/approval.md', currentFilePath, outputs.approvalMd)}.`,
    `6. For the structured site model, read ${markdownLink('references/interaction-model.md', currentFilePath, outputs.interactionModelMd)}.`,
  ];
}

function renderSkillTemplate({
  skillName,
  description,
  heading,
  scopeLines,
  sampleCoverageLines = [],
  executionPolicyLines = [],
  readingOrderLines,
  safetyBoundaryLines,
  doNotDoLines,
}) {
  const lines = [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${heading}`,
    '',
  ];
  pushSection(lines, '## Scope', scopeLines);
  pushSection(lines, '## Sample coverage', sampleCoverageLines);
  pushSection(lines, '## Execution policy', executionPolicyLines);
  pushSection(lines, '## Reading order', readingOrderLines);
  pushSection(lines, '## Safety boundary', safetyBoundaryLines);
  pushSection(lines, '## Do not do', doNotDoLines);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

function renderIndexTemplate({
  title,
  siteSummaryLines,
  referenceNavigationLines,
  sampleCoverageTable,
  notesTitle,
  notesLines,
}) {
  const lines = [`# ${title}`, ''];
  pushSection(lines, '## Site summary', siteSummaryLines);
  pushSection(lines, '## Reference navigation', referenceNavigationLines);
  if (sampleCoverageTable) {
    pushSection(lines, '## Sample intent coverage', [sampleCoverageTable]);
  }
  pushSection(lines, notesTitle, notesLines);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

function renderFlowsTemplate(entries, notes, slugifyAscii) {
  const lines = ['# Flows', '', '## Table of contents', ''];
  for (const entry of entries) {
    lines.push(`- [${entry.title}](#${slugifyAscii(entry.title, entry.anchorHint ?? entry.title)})`);
  }
  lines.push('');
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push('');
    lines.push(`- Intent ID: \`${entry.intentId}\``);
    lines.push(`- Intent Type: \`${entry.intentType}\``);
    lines.push(`- Action: \`${entry.actionId}\``);
    lines.push(`- Summary: ${entry.summary}`);
    lines.push('');
    lines.push(...entry.bodyLines);
    lines.push('');
  }
  pushSection(lines, '## Notes', notes);
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

function renderNlIntentsTemplate(entries) {
  const lines = ['# NL Intents', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.title}`);
    lines.push('');
    lines.push(...entry.bodyLines);
    lines.push('');
  }
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

function renderInteractionTemplate({ summaryTitle, summaryLines, table, extraSections = [] }) {
  const lines = ['# Interaction Model', ''];
  pushSection(lines, summaryTitle, summaryLines);
  if (table) {
    lines.push(table, '');
  }
  for (const section of extraSections) {
    pushSection(lines, section.title, section.lines);
  }
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return joinLines(lines);
}

function buildIntentCoverageRows(intents, docsByIntent, currentFilePath, markdownLink, displayIntentLabel, buildRow) {
  return intents.map((intent) => {
    const flowDoc = docsByIntent.get(intent.intentId);
    return buildRow(intent, flowDoc ? markdownLink(
      flowDoc.title ?? displayIntentLabel(intent.intentType),
      currentFilePath,
      flowDoc.mappedPath
    ) : '-');
  });
}

function renderMoodyzSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const terms = helpers.siteTerminology(context);
  const samples = helpers.collectMoodyzSamples(context);
  const intentTypes = helpers.getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-work') || intentTypes.has('search-book') ? `search ${terms.entityPlural}` : null,
    intentTypes.has('open-work') || intentTypes.has('open-book') ? `open ${terms.entityLabel} pages` : null,
    intentTypes.has('open-actress') || intentTypes.has('open-author') ? `open ${terms.personLabel} pages` : null,
    intentTypes.has('open-category') ? 'open category and list pages' : null,
    intentTypes.has('open-utility-page') ? 'open utility pages' : null,
  ].filter(Boolean);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search works, open verified work or actress pages, and navigate the approved moodyz URL family.`,
    heading: 'moodyz Skill',
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified `moodyz.com` URL family.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      `- Supported tasks: ${supportedTasks.join(', ') || 'query and navigate within the observed site space'}.`,
    ],
    sampleCoverageLines: [
      `- Works: ${samples.works.join(', ') || 'none'}`,
      `- Actresses: ${samples.actresses.join(', ') || 'none'}`,
      `- Search queries: ${samples.searchQueries.join(', ') || 'none'}`,
    ],
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- Search and public navigation are low-risk actions.',
      '- Login or register pages may be opened, but credential submission is out of scope.',
    ],
    doNotDoLines: [
      '- Do not leave the verified moodyz URL family.',
      '- Do not invent unobserved actions or side-effect flows.',
      '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
    ],
  });
}

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
      '- Ranking query entrypoint: `node query-jable-ranking.mjs <url> --query "<自然语言请求>"`.',
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

function render22BiquSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  return renderSkillTemplate({
    skillName: context.skillName,
    description: `Instruction-only Skill for ${context.url}. Use when Codex needs to search books, open verified book or author pages, read chapter text, or download a full public novel while staying inside the approved 22biqu URL family.`,
    heading: '22biqu Skill',
    scopeLines: [
      `- Site: \`${context.url}\``,
      '- Stay inside the verified `www.22biqu.com` URL family.',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
      '- Supported tasks: search books, open book directories, open author pages, open chapter pages, and download full public novels.',
      '- Download entrypoint: `pypy3 download_book.py`.',
    ],
    readingOrderLines: renderReadingOrder(outputs, outputs.skillMd, helpers.markdownLink),
    safetyBoundaryLines: [
      '- Search and public chapter fetching are low-risk actions.',
      '- Login or register pages may be opened, but credential submission is out of scope.',
      '- Prefer returning a local full-book TXT if one already exists.',
      '- If no valid local artifact exists, reuse or generate the host crawler and download again.',
    ],
    doNotDoLines: [
      '- Do not leave the verified 22biqu URL family.',
      '- Do not invent unobserved actions or side-effect flows.',
      '- Do not submit auth forms, uploads, payments, or unknown forms without approval.',
    ],
  });
}

function renderMoodyzIndexReference(input) {
  const { context, outputs, docsByIntent, helpers } = input;
  const samples = helpers.collectMoodyzSamples(context);
  const intents = context.intentsDocument.intents ?? [];
  const intentTypes = helpers.getIntentTypes(context);
  const verifiedTasks = [
    intentTypes.has('search-work') || intentTypes.has('search-book') ? 'search works' : null,
    intentTypes.has('open-work') || intentTypes.has('open-book') ? 'open work pages' : null,
    intentTypes.has('open-actress') || intentTypes.has('open-author') ? 'open actress pages' : null,
    intentTypes.has('open-category') ? 'open category and list pages' : null,
    intentTypes.has('open-utility-page') ? 'open utility pages' : null,
  ].filter(Boolean);
  const rows = buildIntentCoverageRows(
    intents,
    docsByIntent,
    outputs.indexMd,
    helpers.markdownLink,
    (intentType) => helpers.displayIntentLabel(context, intentType),
    (intent, flowLink) => ({
      intent: helpers.displayIntentLabel(context, intent.intentType),
      flow: flowLink,
      actionableTargets: (intent.targetDomain?.actionableValues ?? []).map((value) => value.label).join(', ') || '-',
      recognitionOnly: (intent.targetDomain?.candidateValues ?? [])
        .filter((value) => !(intent.targetDomain?.actionableValues ?? []).some((candidate) => candidate.value === value.value))
        .map((value) => value.label)
        .join(', ') || '-',
    })
  );
  return renderIndexTemplate({
    title: 'moodyz Index',
    siteSummaryLines: [
      `- Entry URL: \`${context.url}\``,
      '- Site type: navigation hub + catalog detail.',
      `- Verified tasks: ${verifiedTasks.join(', ') || 'query and navigate within the observed site space'}.`,
      `- Work samples: ${samples.works.join(', ') || 'none'}`,
      `- Actress samples: ${samples.actresses.join(', ') || 'none'}`,
      `- Search samples: ${samples.searchQueries.join(', ') || 'none'}`,
    ],
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    sampleCoverageTable: helpers.renderTable(['Intent', 'Flow Source', 'Actionable Targets', 'Recognition-only Targets'], rows),
    notesTitle: '## Download notes',
    notesLines: [
      '- This site skill is currently navigation-centric: it covers search, work pages, actress pages, category/list pages, and utility pages.',
      '- There is no verified chapter-reading or full-download flow in the current observed moodyz model.',
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
    })
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
      '- 实际执行入口：`node query-jable-ranking.mjs https://jable.tv/ --query "<请求>"`。',
      '- “推荐/最佳/近期最佳”默认解释为站内综合排序，不输出主观推荐话术。',
      '- 当前已观测的 jable 模型里，没有已验证的下载或长文本阅读流程。',
    ],
  });
}

function render22BiquIndexReference(input) {
  const { context, outputs, helpers } = input;
  const books = helpers.collect22biquKnownBooks(context);
  const authors = helpers.collect22biquKnownAuthors(context);
  const categories = helpers.collect22biquCategoryLabels();
  const utility = helpers.collect22biquUtilityLabels();
  const auth = helpers.collect22biquAuthLabels();
  const bookContent = helpers.summarizeBookContent(context);
  return renderIndexTemplate({
    title: '22biqu Index',
    siteSummaryLines: [
      `- Entry URL: \`${context.url}\``,
      '- Site type: navigation hub + catalog detail.',
      '- Verified tasks: search books, open directories, open author pages, open chapter text, download full public novels.',
      `- Category examples: ${categories.join(', ')}`,
      `- Utility pages: ${utility.join(', ')}`,
      `- Auth pages: ${auth.join(', ')}`,
      `- Known books: ${books.join(', ') || 'none'}`,
      `- Known authors: ${authors.join(', ') || 'none'}`,
      `- Latest full-book coverage: ${bookContent.books.length ? `${bookContent.books.length} book(s), ${bookContent.chapterCount} chapter(s)` : 'none'}`,
    ],
    referenceNavigationLines: renderReferenceNavigation(outputs, outputs.indexMd, helpers.markdownLink),
    notesTitle: '## Download notes',
    notesLines: [
      '- First try a local full-book TXT.',
      '- If no valid local artifact exists, reuse or generate `crawler-scripts/www.22biqu.com/crawler.py`.',
      '- Download now uses full paginated directory parsing plus concurrent chapter fetches.',
      '- The downloader writes `.part` files during execution and finalizes the TXT and JSON files at the end.',
    ],
  });
}

function renderMoodyzFlowsReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectMoodyzSamples(context);
  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const entries = intents.map((intent) => {
    const label = helpers.displayIntentLabel(context, intent.intentType);
    const bodyLines = [];
    if (['search-work', 'search-book', '搜索作品'].includes(label)) {
      const queries = samples.searchQueries.length ? samples.searchQueries : samples.works.slice(0, 3);
      bodyLines.push(`- Example user requests: ${queries.map((query) => `\`搜索「${query}」\``).join(', ') || '`搜索作品`'}`);
      bodyLines.push('- Start state: any verified public page.');
      bodyLines.push('- Target state: a `/search/list` results page or a directly resolved work page.');
      bodyLines.push('- Main path: fill the search box -> submit -> open the matching result if needed.');
      bodyLines.push('- Success signal: the result page mentions the query or the final URL is a `/works/detail/...` page.');
    } else if (['open-work', 'open-book', '打开作品页'].includes(label)) {
      const works = samples.works.slice(0, 4);
      bodyLines.push(`- Example user requests: ${works.map((work) => `\`打开「${work}」\``).join(', ') || '`打开作品`'}`);
      bodyLines.push('- Start state: home page, search results page, category page, or any verified public page.');
      bodyLines.push('- Target state: a work detail page.');
      bodyLines.push('- Main path: open the matching work link.');
      bodyLines.push('- Success signal: the URL matches `/works/detail/...` and the page shows the work metadata.');
    } else if (['open-actress', 'open-author', '打开女优页'].includes(label)) {
      const actresses = samples.actresses.slice(0, 4);
      bodyLines.push(`- Example user requests: ${actresses.map((actress) => `\`打开${actress}女优页\``).join(', ') || '`打开女优页`'}`);
      bodyLines.push('- Start state: a work detail page or a verified public page.');
      bodyLines.push('- Target state: the linked actress page.');
      bodyLines.push('- Main path: read the actress link -> open the actress page.');
      bodyLines.push('- Success signal: the actress name and URL match the selected actress.');
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
    '- This site flow set is currently navigation-first, not chapter-download oriented.',
    '- For live metadata questions, trust the current work detail HTML over search-engine snippets or stale cached result pages.',
    '- Search disambiguation should separate work titles from actress names before opening a result.',
  ], helpers.slugifyAscii);
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

function render22BiquFlowsReference(input) {
  const { context, helpers } = input;
  const intents = [...(context.intentsDocument.intents ?? [])]
    .sort((left, right) => String(left.intentType).localeCompare(String(right.intentType), 'en'));
  const books = helpers.collect22biquKnownBooks(context);
  const authors = helpers.collect22biquKnownAuthors(context);
  const categories = helpers.collect22biquCategoryLabels();
  const bookExample = books[0] ?? '凡人修仙传';
  const authorExample = authors[0] ?? '忘语';
  const entries = intents.map((intent) => {
    const bodyLines = [];
    if (intent.intentType === 'search-book') {
      bodyLines.push(`- Example user requests: \`搜索「${bookExample}」\`, \`搜索${authorExample}\``);
      bodyLines.push('- Start state: any verified public page.');
      bodyLines.push('- Target state: a `/ss/` search results page or a directly resolved book directory.');
      bodyLines.push('- Main path: fill the search box -> submit -> open the matching result if needed.');
      bodyLines.push('- Success signal: the result page mentions the query or the final URL is a `/biqu.../` directory page.');
      bodyLines.push('- Freshness rule: search results are only for discovery; if the user asks for author, latest chapter, update time, or "多久更新", fetch the live `/biqu.../` directory page before answering.');
    } else if (intent.intentType === 'open-book') {
      bodyLines.push(`- Example user requests: \`打开「${bookExample}」\``);
      bodyLines.push('- Start state: home page, search results page, or any verified public page.');
      bodyLines.push('- Target state: a book directory page.');
      bodyLines.push('- Main path: open the matching book link.');
      bodyLines.push('- Success signal: the URL matches `/biqu.../` and the page shows a chapter directory.');
    } else if (intent.intentType === 'open-author') {
      bodyLines.push(`- Example user requests: \`打开${authorExample}作者页\``);
      bodyLines.push(`- Start state: the directory page for \`${bookExample}\`.`);
      bodyLines.push('- Target state: the linked author page.');
      bodyLines.push('- Main path: read the author link -> open the author page.');
      bodyLines.push('- Success signal: the author name and URL match the selected author.');
    } else if (intent.intentType === 'open-chapter') {
      bodyLines.push(`- Example user requests: \`打开「${bookExample}」第一章\`, \`读取「${bookExample}」第1454章正文\``);
      bodyLines.push(`- Start state: the directory page for \`${bookExample}\`.`);
      bodyLines.push('- Target state: a chapter page with readable public text.');
      bodyLines.push('- Main path: locate the chapter link -> open the chapter page -> read the body text.');
      bodyLines.push('- Success signal: chapter title matches the target and body text length is positive.');
    } else if (intent.intentType === 'download-book') {
      bodyLines.push(`- Example user requests: \`下载「${bookExample}」\``);
      bodyLines.push('- Start state: any verified public page, or a known book directory page.');
      bodyLines.push('- Target state: a local full-book TXT exists.');
      bodyLines.push('- Main path: check local artifact -> if missing, run `pypy3 download_book.py` -> parse the paginated directory -> fetch chapters concurrently -> output a pretty TXT.');
      bodyLines.push('- No-op rule: if a complete local TXT already exists, return it directly.');
      bodyLines.push('- Success signal: `book-content/<run>/downloads/<book-title>.txt` exists.');
    } else if (intent.intentType === 'open-category') {
      bodyLines.push(`- Example user requests: \`打开${categories[0]}\`, \`进入${categories[1]}\``);
      bodyLines.push('- Start state: home page.');
      bodyLines.push('- Target state: a category page.');
      bodyLines.push('- Main path: click the category navigation link.');
      bodyLines.push('- Success signal: the final URL matches the chosen category path.');
    } else if (intent.intentType === 'open-utility-page') {
      bodyLines.push('- Example user requests: `打开阅读记录`');
      bodyLines.push('- Start state: home page.');
      bodyLines.push('- Target state: a low-risk utility page.');
      bodyLines.push('- Main path: click the utility link.');
      bodyLines.push('- Success signal: the utility page is open without triggering auth submission.');
    } else if (intent.intentType === 'open-auth-page') {
      bodyLines.push('- Example user requests: `打开登录页`, `打开注册页`');
      bodyLines.push('- Start state: home page.');
      bodyLines.push('- Target state: a login or register page.');
      bodyLines.push('- Main path: navigate only; do not submit credentials.');
      bodyLines.push('- Success signal: the auth page opens.');
    }
    return {
      title: helpers.intentTitle22Biqu(intent.intentType),
      anchorHint: intent.intentType,
      intentId: intent.intentId,
      intentType: intent.intentType,
      actionId: intent.actionId,
      summary: helpers.intentSummary22Biqu(intent.intentType),
      bodyLines,
    };
  });
  return renderFlowsTemplate(entries, [
    '- Download now prefers full paginated directory parsing and concurrent chapter fetches.',
    '- `.part` files are written during download so progress is visible before finalization.',
    '- For live metadata questions, trust the current book directory HTML over search-engine snippets or cached result pages.',
    '- Prefer `og:novel:lastest_chapter_name` and `og:novel:update_time` from the directory page when present.',
  ], helpers.slugifyAscii);
}

function renderMoodyzNlIntentsReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectMoodyzSamples(context);
  const intentTypes = helpers.getIntentTypes(context);
  const workExamples = samples.works.slice(0, 4);
  const actressExamples = samples.actresses.slice(0, 4);
  const searchExamples = samples.searchQueries.slice(0, 4);
  const entries = [];
  if (intentTypes.has('search-work') || intentTypes.has('search-book')) {
    entries.push({
      title: '搜索作品',
      bodyLines: [
        '- Slots: `queryText`',
        `- Examples: ${searchExamples.map((item) => `\`搜索「${item}」\``).join(', ') || workExamples.map((item) => `\`搜索「${item}」\``).join(', ') || '`搜索作品`'}`,
      ],
    });
  }
  if (intentTypes.has('open-work') || intentTypes.has('open-book')) {
    entries.push({
      title: '打开作品页',
      bodyLines: [
        '- Slots: `workTitle`',
        `- Examples: ${workExamples.map((item) => `\`打开「${item}」\``).join(', ') || '`打开作品`'}`,
      ],
    });
  }
  if (intentTypes.has('open-actress') || intentTypes.has('open-author')) {
    entries.push({
      title: '打开女优页',
      bodyLines: [
        '- Slots: `actressName`',
        `- Examples: ${actressExamples.map((item) => `\`打开${item}女优页\``).join(', ') || '`打开女优页`'}`,
      ],
    });
  }
  if (intentTypes.has('open-category')) {
    entries.push({
      title: '打开分类页',
      bodyLines: [
        '- Slots: `targetLabel`',
        '- Examples: `打开推荐作品`, `打开作品搜索`, `进入女优列表`',
      ],
    });
  }
  if (intentTypes.has('open-utility-page')) {
    entries.push({
      title: '打开功能页',
      bodyLines: [
        '- Slots: `targetLabel`',
        '- Examples: `打开首页`, `打开 WEB 特集页`',
      ],
    });
  }
  return renderNlIntentsTemplate(entries);
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
        '- Execution: `node query-jable-ranking.mjs https://jable.tv/ --query "<请求>"`.',
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

function render22BiquNlIntentsReference(input) {
  const { context, helpers } = input;
  const books = helpers.collect22biquKnownBooks(context);
  const authors = helpers.collect22biquKnownAuthors(context);
  const bookExample = books[0] ?? '凡人修仙传';
  const authorExample = authors[0] ?? '忘语';
  const categories = helpers.collect22biquCategoryLabels();
  return renderNlIntentsTemplate([
    {
      title: 'search-book',
      bodyLines: [
        '- Slots: `queryText`',
        `- Examples: \`搜索「${bookExample}」\`, \`搜索夜无疆\`, \`搜索${authorExample}\``,
      ],
    },
    {
      title: 'open-book',
      bodyLines: [
        '- Slots: `bookTitle`',
        `- Examples: \`打开「${bookExample}」\``,
      ],
    },
    {
      title: 'open-author',
      bodyLines: [
        '- Slots: `authorName`',
        `- Examples: \`打开${authorExample}作者页\``,
      ],
    },
    {
      title: 'open-chapter',
      bodyLines: [
        '- Slots: `bookTitle` + `chapterRef`',
        `- Examples: \`打开「${bookExample}」第一章\`, \`读取「${bookExample}」第1454章正文\``,
      ],
    },
    {
      title: 'download-book',
      bodyLines: [
        '- Slots: `bookTitle`',
        `- Examples: \`下载「${bookExample}」\``,
        '- Behavior: return a local full-book TXT when available; otherwise call the PyPy downloader.',
      ],
    },
    {
      title: 'open-category',
      bodyLines: [
        `- Examples: \`打开${categories[0]}\`, \`进入${categories[1]}\``,
      ],
    },
    {
      title: 'open-utility-page',
      bodyLines: [
        '- Examples: `打开阅读记录`',
      ],
    },
    {
      title: 'open-auth-page',
      bodyLines: [
        '- Examples: `打开登录页`, `打开注册页`',
        '- Navigation only; auth form submission is out of scope.',
      ],
    },
  ]);
}

function renderMoodyzInteractionModelReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectMoodyzSamples(context);
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
      `- Works: ${samples.works.join(', ') || 'none'}`,
      `- Actresses: ${samples.actresses.join(', ') || 'none'}`,
      `- Search queries: ${samples.searchQueries.join(', ') || 'none'}`,
    ],
    table: helpers.renderTable(['Intent', 'Element', 'Action', 'State Field'], rows),
  });
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

function render22BiquInteractionModelReference(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const books = helpers.collect22biquKnownBooks(context);
  const authors = helpers.collect22biquKnownAuthors(context);
  const bookContent = helpers.summarizeBookContent(context);
  const latestDownload = bookContent.books.length
    ? helpers.markdownLink('latest full-book artifact', outputs.interactionModelMd, helpers.resolveContentArtifactPath(context, bookContent.books[0].downloadFile))
    : 'none';
  return renderInteractionTemplate({
    summaryTitle: '## Site profile',
    summaryLines: [
      '- Archetype: `navigation-hub` + `catalog-detail`',
      '- URL family: `https://www.22biqu.com/`',
      `- Safe actions: \`${safeActions.join('`, `')}\``,
    ],
    extraSections: [
      {
        title: '## Verified capabilities',
        lines: [
          '| Capability | Description |',
          '| --- | --- |',
          '| search-book | Submit a site search and enter the `/ss/` result page. |',
          '| open-book | Open a `/biqu.../` book directory page. |',
          '| open-author | Open the linked author page from a book directory. |',
          '| open-chapter | Open a chapter page and read the body text. |',
          '| download-book | Download a full public novel and emit a pretty TXT. |',
          '| live-book-metadata | Read author/latest chapter/update time from the live directory HTML. |',
        ],
      },
      {
        title: '## Download path',
        lines: [
          '- Entrypoint: `pypy3 download_book.py`',
          '- Metadata path: `pypy3 download_book.py <url> --book-title "<title>" --metadata-only`',
          '- Directory strategy: parse paginated directory pages first, then fetch chapters concurrently.',
          '- Concurrency: chapter fetch concurrency is currently `64`; chapter sub-pages are still ordered serially inside each chapter.',
          '- Output strategy: write `.part` files during execution, then finalize TXT and JSON outputs.',
          '- Freshness rule: for author/latest chapter/update time, trust the live `/biqu.../` directory page and its `og:novel:*` metadata over search-engine snippets.',
        ],
      },
      {
        title: '## Verified examples',
        lines: [
          `- Books: ${books.join(', ') || 'none'}`,
          `- Authors: ${authors.join(', ') || 'none'}`,
          `- Latest download: ${latestDownload}`,
        ],
      },
    ],
  });
}

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

function dedupeSampleList(values, normalizer) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = normalizer(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
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
      '- Routing table: public home/search/video/bangumi/UP/category pages -> `builtin-browser`; authenticated read-only pages -> `local-profile-browser`; login bootstrap -> `site-login`; downloads -> `download_bilibili.py` via the action router.',
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
const KNOWN_SITE_RENDERERS = {
  moodyz: {
    skill: renderMoodyzSkillMd,
    index: renderMoodyzIndexReference,
    flows: renderMoodyzFlowsReference,
    nlIntents: renderMoodyzNlIntentsReference,
    interactionModel: renderMoodyzInteractionModelReference,
  },
  jable: {
    skill: renderJableSkillMd,
    index: renderJableIndexReference,
    flows: renderJableFlowsReference,
    nlIntents: renderJableNlIntentsReference,
    interactionModel: renderJableInteractionModelReference,
  },
  '22biqu': {
    skill: render22BiquSkillMd,
    index: render22BiquIndexReference,
    flows: render22BiquFlowsReference,
    nlIntents: render22BiquNlIntentsReference,
    interactionModel: render22BiquInteractionModelReference,
  },
  bilibili: {
    skill: renderBilibiliSkillMd,
    index: renderBilibiliIndexReference,
    flows: renderBilibiliFlowsReference,
    nlIntents: renderBilibiliNlIntentsReference,
    interactionModel: renderBilibiliInteractionModelReference,
  },
};

export function renderKnownSiteDocument(siteKey, kind, input) {
  return KNOWN_SITE_RENDERERS[siteKey]?.[kind]?.(input) ?? null;
}

