import {
  renderFlowsTemplate,
  renderIndexTemplate,
  renderInteractionTemplate,
  renderNlIntentsTemplate,
  renderReadingOrder,
  renderReferenceNavigation,
  renderSkillTemplate,
} from '../shared.mjs';

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
      '- Download entrypoint: `pypy3 src/sites/chapter-content/download/python/book.py`.',
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
      bodyLines.push('- Main path: check local artifact -> if missing, run `pypy3 src/sites/chapter-content/download/python/book.py` -> parse the paginated directory -> fetch chapters concurrently -> output a pretty TXT.');
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
          '- Entrypoint: `pypy3 src/sites/chapter-content/download/python/book.py`',
          '- Metadata path: `pypy3 src/sites/chapter-content/download/python/book.py <url> --book-title "<title>" --metadata-only`',
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

export const BIQU_22_SITE_RENDERER = Object.freeze({
  skill: render22BiquSkillMd,
  index: render22BiquIndexReference,
  flows: render22BiquFlowsReference,
  nlIntents: render22BiquNlIntentsReference,
  interactionModel: render22BiquInteractionModelReference,
});
