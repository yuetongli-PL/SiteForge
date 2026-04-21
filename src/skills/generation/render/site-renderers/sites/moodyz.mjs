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

function moodyzIntentLabel(intentType) {
  switch (intentType) {
    case 'search-work':
    case 'search-book':
      return '搜索作品';
    case 'open-work':
    case 'open-book':
      return '打开作品';
    case 'open-actress':
    case 'open-author':
      return '打开女优页';
    case 'open-category':
      return '打开分类页';
    case 'open-utility-page':
      return '打开功能页';
    default:
      return String(intentType ?? '');
  }
}

function renderMoodyzSkillMd(input) {
  const { context, outputs, helpers } = input;
  const safeActions = helpers.resolveSafeActions(context);
  const samples = helpers.collectMoodyzSamples(context);
  const intentTypes = helpers.getIntentTypes(context);
  const supportedTasks = [
    intentTypes.has('search-work') || intentTypes.has('search-book') ? 'search 作品' : null,
    intentTypes.has('open-work') || intentTypes.has('open-book') ? 'open 作品 pages' : null,
    intentTypes.has('open-actress') || intentTypes.has('open-author') ? 'open 女优 pages' : null,
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
    }),
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

function renderMoodyzFlowsReference(input) {
  const { context, helpers } = input;
  const samples = helpers.collectMoodyzSamples(context);
  const intents = [...(context.intentsDocument.intents ?? [])].sort((left, right) => String(left.intentId).localeCompare(String(right.intentId), 'en'));
  const entries = intents.map((intent) => {
    const label = moodyzIntentLabel(intent.intentType);
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
  ], helpers.slugifyAscii)
    .replaceAll('鎼滅储浣滃搧', '搜索作品')
    .replaceAll('鎵撳紑濂充紭椤?', '打开女优页')
    .replaceAll('鎵撳紑浣滃搧', '打开作品')
    .replaceAll('鎵撳紑鍒嗙被椤?', '打开分类页')
    .replaceAll('鎵撳紑鍔熻兘椤?', '打开功能页');
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

export const MOODYZ_SITE_RENDERER = Object.freeze({
  skill: renderMoodyzSkillMd,
  index: renderMoodyzIndexReference,
  flows: renderMoodyzFlowsReference,
  nlIntents: renderMoodyzNlIntentsReference,
  interactionModel: renderMoodyzInteractionModelReference,
});
