import path from 'node:path';

import { compileKnowledgeBase } from '../../src/entrypoints/pipeline/compile-wiki.mjs';
import { createSiteKnowledgeBaseFixture } from './helpers/site-kb-fixtures.mjs';
import { createSiteMetadataSandbox } from './helpers/site-metadata-sandbox.mjs';

const FIXTURE_TIMESTAMP = '2026-04-18T00:00:00.000Z';

function rawDirsFromFixture(fixture) {
  return Object.fromEntries(
    fixture.sources.map((source) => [
      source.step,
      path.join(fixture.kbDir, source.rawDir),
    ]),
  );
}

function stateRecord({
  stateId,
  stateName,
  pageType,
  finalUrl,
  title,
  pageFacts = null,
}) {
  return {
    stateId,
    stateName,
    pageType,
    semanticPageType: pageType,
    finalUrl,
    title,
    capturedAt: FIXTURE_TIMESTAMP,
    sourceStatus: 'captured',
    elementStates: [],
    pageFacts,
  };
}

function doc(intentId, title, file, content) {
  return { intentId, title, file, content };
}

function buildStageSpec(host, inputUrl, createSourceFixture) {
  return {
    host,
    inputUrl,
    createSourceFixture,
  };
}

async function createExampleSourceFixture(rootDir) {
  const url = 'https://example.com/';
  const host = 'example.com';
  const fixture = await createSiteKnowledgeBaseFixture(rootDir, {
    host,
    inputUrl: url,
    baseUrl: url,
    siteProfile: {
      host,
      archetype: 'navigation-catalog',
      search: {
        defaultQueries: ['example query'],
      },
    },
    pageIndex: [
      { pageId: 'page_readme', kind: 'readme', path: 'wiki/README.md' },
    ],
    capture: {
      inputUrl: url,
      finalUrl: url,
      title: 'Example Home',
    },
    expandedStates: {
      inputUrl: url,
      baseUrl: url,
      states: [
        {
          stateId: 's0001',
          slug: 'detail',
          stateName: 'Open Detail',
          finalUrl: 'https://example.com/works/detail/alpha-001',
          title: 'Alpha 001',
          pageType: 'book-detail-page',
          pageFacts: {
            contentTitle: 'Alpha 001',
          },
        },
      ],
    },
    states: [
      stateRecord({
        stateId: 's_home',
        stateName: 'Home',
        pageType: 'home',
        finalUrl: url,
        title: 'Example Home',
      }),
      stateRecord({
        stateId: 's_detail',
        stateName: 'Detail',
        pageType: 'book-detail-page',
        finalUrl: 'https://example.com/works/detail/alpha-001',
        title: 'Alpha 001',
      }),
    ],
    intents: [
      {
        intentId: 'intent-search-work',
        intentType: 'search-work',
        actionId: 'search',
        elementId: 'search-form',
        targetDomain: {
          actionableValues: [{ value: 'query', label: 'Alpha 001' }],
          candidateValues: [],
        },
      },
      {
        intentId: 'intent-open-work',
        intentType: 'open-work',
        actionId: 'open-work',
        elementId: 'work-link',
        targetDomain: {
          actionableValues: [{ value: 'work', label: 'Alpha 001' }],
          candidateValues: [],
        },
      },
    ],
    actions: [
      { actionId: 'search', actionKind: 'search-submit' },
      { actionId: 'open-work', actionKind: 'safe-nav-link' },
    ],
    decisionRules: [
      { ruleId: 'rule-search-work', intentId: 'intent-search-work' },
      { ruleId: 'rule-open-work', intentId: 'intent-open-work' },
    ],
    capabilityFamilies: ['search-content', 'navigate-to-content'],
    slotSchemaIntents: [
      { intentId: 'intent-search-work', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-work', slots: [{ slotId: 'selectedWork', required: true }] },
    ],
    utterancePatterns: [
      { patternId: 'pattern-search', intentId: 'intent-search-work', patternType: 'example', examples: ['search Alpha 001'] },
      { patternId: 'pattern-open', intentId: 'intent-open-work', patternType: 'example', examples: ['open Alpha 001'] },
    ],
    docs: [
      doc('intent-search-work', 'Search work', 'intent-search-work.md', '# Search work\n'),
      doc('intent-open-work', 'Open work', 'intent-open-work.md', '# Open work\n'),
    ],
    wikiReadme: '# Example Wiki',
  });
  return {
    ...fixture,
    rawDirs: rawDirsFromFixture(fixture),
  };
}

async function createJableSourceFixture(rootDir) {
  const url = 'https://jable.tv/';
  const host = 'jable.tv';
  const fixture = await createSiteKnowledgeBaseFixture(rootDir, {
    host,
    inputUrl: url,
    baseUrl: url,
    siteProfile: {
      host,
      search: {
        defaultQueries: ['JUR-652'],
      },
    },
    pageIndex: [
      { pageId: 'page_readme', kind: 'readme', path: 'wiki/README.md' },
    ],
    capture: {
      inputUrl: url,
      finalUrl: url,
      title: 'jable Home',
    },
    expandedStates: {
      inputUrl: url,
      baseUrl: url,
      states: [
        {
          stateId: 's0001',
          slug: 'detail',
          stateName: 'Open Video',
          finalUrl: 'https://jable.tv/videos/jur-652/',
          title: 'JUR-652',
          pageType: 'book-detail-page',
          pageFacts: {
            contentTitle: 'JUR-652',
          },
        },
      ],
    },
    states: [
      stateRecord({
        stateId: 's_search',
        stateName: 'Search Results',
        pageType: 'search-results-page',
        finalUrl: 'https://jable.tv/search/JUR-652/',
        title: 'Search JUR-652',
        pageFacts: {
          queryText: 'JUR-652',
        },
      }),
      stateRecord({
        stateId: 's_detail',
        stateName: 'Video Detail',
        pageType: 'book-detail-page',
        finalUrl: 'https://jable.tv/videos/jur-652/',
        title: 'JUR-652',
      }),
      stateRecord({
        stateId: 's_actor',
        stateName: 'Actor Page',
        pageType: 'author-page',
        finalUrl: 'https://jable.tv/models/aoi-tsukasa/',
        title: 'Aoi Tsukasa',
      }),
      stateRecord({
        stateId: 's_category',
        stateName: 'Tag Page',
        pageType: 'category-page',
        finalUrl: 'https://jable.tv/tags/big-tits/',
        title: 'big-tits',
        pageFacts: {
          categoryTaxonomy: [
            {
              groupLabel: 'Body',
              tags: [
                { label: 'big-tits' },
                { label: 'stockings' },
              ],
            },
          ],
        },
      }),
    ],
    intents: [
      { intentId: 'intent-search-video', intentType: 'search-video', actionId: 'search', elementId: 'search-form', targetDomain: { actionableValues: [{ value: 'query', label: 'JUR-652' }], candidateValues: [] } },
      { intentId: 'intent-open-video', intentType: 'open-video', actionId: 'open-video', elementId: 'video-link', targetDomain: { actionableValues: [{ value: 'video', label: 'JUR-652' }], candidateValues: [] } },
      { intentId: 'intent-open-model', intentType: 'open-model', actionId: 'open-model', elementId: 'model-link', targetDomain: { actionableValues: [{ value: 'model', label: 'Aoi Tsukasa' }], candidateValues: [] } },
      { intentId: 'intent-open-category', intentType: 'open-category', actionId: 'open-category', elementId: 'category-link', targetDomain: { actionableValues: [{ value: 'category', label: 'big-tits' }], candidateValues: [] } },
      { intentId: 'intent-list-category-videos', intentType: 'list-category-videos', actionId: 'list-category-videos', elementId: 'category-link', targetDomain: { actionableValues: [{ value: 'category', label: 'big-tits' }], candidateValues: [] } },
    ],
    actions: [
      { actionId: 'search', actionKind: 'search-submit' },
      { actionId: 'open-video', actionKind: 'safe-nav-link' },
      { actionId: 'open-model', actionKind: 'safe-nav-link' },
      { actionId: 'open-category', actionKind: 'safe-nav-link' },
      { actionId: 'list-category-videos', actionKind: 'safe-nav-link' },
    ],
    decisionRules: [
      { ruleId: 'rule-search-video', intentId: 'intent-search-video' },
      { ruleId: 'rule-open-video', intentId: 'intent-open-video' },
      { ruleId: 'rule-open-model', intentId: 'intent-open-model' },
      { ruleId: 'rule-open-category', intentId: 'intent-open-category' },
      { ruleId: 'rule-list-category-videos', intentId: 'intent-list-category-videos' },
    ],
    capabilityFamilies: ['search-content', 'navigate-to-content', 'navigate-to-author', 'navigate-to-category'],
    slotSchemaIntents: [
      { intentId: 'intent-search-video', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-video', slots: [{ slotId: 'videoTitle', required: true }] },
      { intentId: 'intent-open-model', slots: [{ slotId: 'actorName', required: true }] },
      { intentId: 'intent-open-category', slots: [{ slotId: 'targetLabel', required: true }] },
      { intentId: 'intent-list-category-videos', slots: [{ slotId: 'taxonomyTarget', required: true }] },
    ],
    docs: [
      doc('intent-search-video', 'Search video', 'intent-search-video.md', '# Search video\n'),
      doc('intent-open-video', 'Open video', 'intent-open-video.md', '# Open video\n'),
      doc('intent-open-model', 'Open actor', 'intent-open-model.md', '# Open actor\n'),
      doc('intent-open-category', 'Open category', 'intent-open-category.md', '# Open category\n'),
      doc('intent-list-category-videos', 'Category ranking', 'intent-list-category-videos.md', '# Category ranking\n'),
    ],
    wikiReadme: '# Jable Wiki',
  });
  return {
    ...fixture,
    rawDirs: rawDirsFromFixture(fixture),
  };
}

async function createMoodyzSourceFixture(rootDir) {
  const url = 'https://moodyz.com/works/date';
  const host = 'moodyz.com';
  const fixture = await createSiteKnowledgeBaseFixture(rootDir, {
    host,
    inputUrl: url,
    baseUrl: url,
    siteProfile: {
      host,
      search: {
        defaultQueries: ['MIAA-001'],
      },
    },
    pageIndex: [
      { pageId: 'page_readme', kind: 'readme', path: 'wiki/README.md' },
    ],
    capture: {
      inputUrl: url,
      finalUrl: url,
      title: 'moodyz Home',
    },
    expandedStates: {
      inputUrl: url,
      baseUrl: url,
      states: [
        {
          stateId: 's0001',
          slug: 'work',
          stateName: 'Open Work',
          finalUrl: 'https://moodyz.com/works/detail/miaa001',
          title: 'MIAA-001',
          pageType: 'book-detail-page',
        },
      ],
    },
    states: [
      stateRecord({
        stateId: 's_search',
        stateName: 'Search',
        pageType: 'search-results-page',
        finalUrl: 'https://moodyz.com/search/list?keyword=MIAA-001',
        title: 'Search MIAA-001',
        pageFacts: { queryText: 'MIAA-001' },
      }),
      stateRecord({
        stateId: 's_work',
        stateName: 'Work',
        pageType: 'book-detail-page',
        finalUrl: 'https://moodyz.com/works/detail/miaa001',
        title: 'MIAA-001',
      }),
      stateRecord({
        stateId: 's_actress',
        stateName: 'Actress',
        pageType: 'author-page',
        finalUrl: 'https://moodyz.com/actress/detail/alice',
        title: 'Alice',
      }),
    ],
    intents: [
      { intentId: 'intent-search-work', intentType: 'search-work', actionId: 'search', elementId: 'search-form', targetDomain: { actionableValues: [{ value: 'query', label: 'MIAA-001' }], candidateValues: [] } },
      { intentId: 'intent-open-work', intentType: 'open-work', actionId: 'open-work', elementId: 'work-link', targetDomain: { actionableValues: [{ value: 'work', label: 'MIAA-001' }], candidateValues: [] } },
      { intentId: 'intent-open-actress', intentType: 'open-actress', actionId: 'open-actress', elementId: 'actress-link', targetDomain: { actionableValues: [{ value: 'actress', label: 'Alice' }], candidateValues: [] } },
      { intentId: 'intent-open-category', intentType: 'open-category', actionId: 'open-category', elementId: 'category-link', targetDomain: { actionableValues: [{ value: 'category', label: 'recommended works' }], candidateValues: [] } },
      { intentId: 'intent-open-utility', intentType: 'open-utility-page', actionId: 'open-utility', elementId: 'utility-link', targetDomain: { actionableValues: [{ value: 'utility', label: 'WEB special' }], candidateValues: [] } },
    ],
    actions: [
      { actionId: 'search', actionKind: 'search-submit' },
      { actionId: 'open-work', actionKind: 'safe-nav-link' },
      { actionId: 'open-actress', actionKind: 'safe-nav-link' },
      { actionId: 'open-category', actionKind: 'safe-nav-link' },
      { actionId: 'open-utility', actionKind: 'safe-nav-link' },
    ],
    slotSchemaIntents: [
      { intentId: 'intent-search-work', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-work', slots: [{ slotId: 'workTitle', required: true }] },
      { intentId: 'intent-open-actress', slots: [{ slotId: 'actressName', required: true }] },
    ],
    docs: [
      doc('intent-search-work', 'Search works', 'intent-search-work.md', '# Search works\n'),
      doc('intent-open-work', 'Open work', 'intent-open-work.md', '# Open work\n'),
      doc('intent-open-actress', 'Open actress', 'intent-open-actress.md', '# Open actress\n'),
    ],
    wikiReadme: '# Moodyz Wiki',
  });
  return {
    ...fixture,
    rawDirs: rawDirsFromFixture(fixture),
  };
}

async function create22BiquSourceFixture(rootDir) {
  const url = 'https://www.22biqu.com/';
  const host = 'www.22biqu.com';
  const fixture = await createSiteKnowledgeBaseFixture(rootDir, {
    host,
    inputUrl: url,
    baseUrl: url,
    siteProfile: {
      host,
      search: {
        defaultQueries: ['Xuanjian Xianzu'],
      },
    },
    pageIndex: [
      { pageId: 'page_readme', kind: 'readme', path: 'wiki/README.md' },
    ],
    capture: {
      inputUrl: url,
      finalUrl: url,
      title: '22biqu Home',
    },
    expandedStates: {
      inputUrl: url,
      baseUrl: url,
      states: [
        {
          stateId: 's0001',
          slug: 'book',
          stateName: 'Open Book',
          finalUrl: 'https://www.22biqu.com/biqu123/',
          title: 'Xuanjian Xianzu',
          pageType: 'book-detail-page',
        },
      ],
    },
    states: [
      stateRecord({
        stateId: 's_search',
        stateName: 'Search',
        pageType: 'search-results-page',
        finalUrl: 'https://www.22biqu.com/ss/XuanjianXianzu.html',
        title: 'Search Xuanjian Xianzu',
        pageFacts: { queryText: 'Xuanjian Xianzu' },
      }),
      stateRecord({
        stateId: 's_book',
        stateName: 'Book Directory',
        pageType: 'book-detail-page',
        finalUrl: 'https://www.22biqu.com/biqu123/',
        title: 'Xuanjian Xianzu',
      }),
      stateRecord({
        stateId: 's_author',
        stateName: 'Author Page',
        pageType: 'author-page',
        finalUrl: 'https://www.22biqu.com/author/jiyueren/',
        title: 'Ji Yueren',
      }),
      stateRecord({
        stateId: 's_chapter',
        stateName: 'Chapter Page',
        pageType: 'chapter-page',
        finalUrl: 'https://www.22biqu.com/biqu123/1.html',
        title: 'Chapter 1',
      }),
    ],
    intents: [
      { intentId: 'intent-search-book', intentType: 'search-book', actionId: 'search', elementId: 'search-form', targetDomain: { actionableValues: [{ value: 'query', label: 'Xuanjian Xianzu' }], candidateValues: [] } },
      { intentId: 'intent-open-book', intentType: 'open-book', actionId: 'open-book', elementId: 'book-link', targetDomain: { actionableValues: [{ value: 'book', label: 'Xuanjian Xianzu' }], candidateValues: [] } },
      { intentId: 'intent-open-author', intentType: 'open-author', actionId: 'open-author', elementId: 'author-link', targetDomain: { actionableValues: [{ value: 'author', label: 'Ji Yueren' }], candidateValues: [] } },
      { intentId: 'intent-open-chapter', intentType: 'open-chapter', actionId: 'open-chapter', elementId: 'chapter-link', targetDomain: { actionableValues: [{ value: 'chapter', label: 'Chapter 1' }], candidateValues: [] } },
      { intentId: 'intent-download-book', intentType: 'download-book', actionId: 'download-book', elementId: 'book-link', targetDomain: { actionableValues: [{ value: 'book', label: 'Xuanjian Xianzu' }], candidateValues: [] } },
      { intentId: 'intent-open-category', intentType: 'open-category', actionId: 'open-category', elementId: 'category-link', targetDomain: { actionableValues: [{ value: 'category', label: 'xuanhuan' }], candidateValues: [] } },
      { intentId: 'intent-open-utility', intentType: 'open-utility-page', actionId: 'open-utility', elementId: 'utility-link', targetDomain: { actionableValues: [{ value: 'utility', label: 'reading history' }], candidateValues: [] } },
      { intentId: 'intent-open-auth', intentType: 'open-auth-page', actionId: 'open-auth', elementId: 'auth-link', targetDomain: { actionableValues: [{ value: 'auth', label: 'login' }], candidateValues: [] } },
    ],
    actions: [
      { actionId: 'search', actionKind: 'search-submit' },
      { actionId: 'open-book', actionKind: 'safe-nav-link' },
      { actionId: 'open-author', actionKind: 'safe-nav-link' },
      { actionId: 'open-chapter', actionKind: 'safe-nav-link' },
      { actionId: 'download-book', actionKind: 'download' },
      { actionId: 'open-category', actionKind: 'safe-nav-link' },
      { actionId: 'open-utility', actionKind: 'safe-nav-link' },
      { actionId: 'open-auth', actionKind: 'safe-nav-link' },
    ],
    slotSchemaIntents: [
      { intentId: 'intent-search-book', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-book', slots: [{ slotId: 'bookTitle', required: true }] },
      { intentId: 'intent-open-author', slots: [{ slotId: 'authorName', required: true }] },
      { intentId: 'intent-open-chapter', slots: [{ slotId: 'chapterRef', required: true }] },
      { intentId: 'intent-download-book', slots: [{ slotId: 'bookTitle', required: true }] },
    ],
    docs: [
      doc('intent-search-book', 'Search book', 'intent-search-book.md', '# Search book\n'),
      doc('intent-open-book', 'Open book directory', 'intent-open-book.md', '# Open book directory\n'),
      doc('intent-open-author', 'Open author page', 'intent-open-author.md', '# Open author page\n'),
      doc('intent-open-chapter', 'Open chapter text', 'intent-open-chapter.md', '# Open chapter text\n'),
      doc('intent-download-book', 'Download full book', 'intent-download-book.md', '# Download full book\n'),
    ],
    bookContent: {
      books: [
        {
          bookTitle: 'Xuanjian Xianzu',
          authorName: 'Ji Yueren',
          chapterCount: 12,
          downloadFile: 'book-content/downloads/xuanjianxianzu.txt',
        },
      ],
      authors: [
        { authorName: 'Ji Yueren' },
      ],
      searchResults: [
        { queryText: 'Xuanjian Xianzu', resultCount: 1 },
      ],
    },
    wikiReadme: '# 22biqu Wiki',
  });
  return {
    ...fixture,
    rawDirs: rawDirsFromFixture(fixture),
  };
}

async function createBilibiliSourceFixture(rootDir) {
  const url = 'https://www.bilibili.com/';
  const host = 'www.bilibili.com';
  const fixture = await createSiteKnowledgeBaseFixture(rootDir, {
    host,
    inputUrl: url,
    baseUrl: url,
    siteProfile: {
      host,
      navigation: {
        allowedHosts: ['www.bilibili.com', 'search.bilibili.com', 'space.bilibili.com'],
        categoryPathPrefixes: ['/v/popular/', '/anime/'],
      },
      search: {
        defaultQueries: ['BV1WjDDBGE3p'],
      },
      validationSamples: {
        videoSearchQuery: 'BV1WjDDBGE3p',
        videoDetailUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
        authorUrl: 'https://space.bilibili.com/1202350411',
        authorVideosUrl: 'https://space.bilibili.com/1202350411/video',
        categoryPopularUrl: 'https://www.bilibili.com/v/popular/all/',
        categoryAnimeUrl: 'https://www.bilibili.com/anime/',
        bangumiDetailUrl: 'https://www.bilibili.com/bangumi/play/ep508404',
      },
    },
    pageIndex: [
      { pageId: 'page_readme', kind: 'readme', path: 'wiki/README.md' },
    ],
    capture: {
      inputUrl: url,
      finalUrl: url,
      title: 'bilibili',
    },
    expandedStates: {
      inputUrl: url,
      baseUrl: url,
      states: [
        {
          stateId: 's_home',
          slug: 'home',
          stateName: 'Home',
          finalUrl: url,
          title: 'bilibili',
          pageType: 'home',
          pageFacts: {
            featuredContentCount: 1,
            featuredContentCards: [
              {
                title: 'BV1WjDDBGE3p',
                url: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
                bvid: 'BV1WjDDBGE3p',
                authorMid: '1202350411',
                contentType: 'video',
              },
            ],
            featuredAuthorCount: 1,
            featuredAuthorCards: [
              {
                name: 'UP 1202350411',
                url: 'https://space.bilibili.com/1202350411',
                mid: '1202350411',
                authorSubpage: 'video',
              },
            ],
          },
        },
        {
          stateId: 's_search',
          slug: 'search',
          stateName: 'Search Results',
          finalUrl: 'https://search.bilibili.com/all?keyword=BV1WjDDBGE3p',
          title: 'Search BV1WjDDBGE3p',
          pageType: 'search-results-page',
          pageFacts: {
            searchFamily: 'all',
            queryText: 'BV1WjDDBGE3p',
            resultCount: 1,
          },
        },
        {
          stateId: 's_detail',
          slug: 'detail',
          stateName: 'Video Detail',
          finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
          title: 'BV1WjDDBGE3p',
          pageType: 'content-detail-page',
          pageFacts: {
            bvid: 'BV1WjDDBGE3p',
            authorMid: '1202350411',
            authorUrl: 'https://space.bilibili.com/1202350411',
            contentTitle: 'BV1WjDDBGE3p',
            contentType: 'video',
          },
        },
        {
          stateId: 's_author',
          slug: 'author',
          stateName: 'Author Page',
          finalUrl: 'https://space.bilibili.com/1202350411',
          title: 'UP 1202350411',
          pageType: 'author-page',
          pageFacts: {
            authorMid: '1202350411',
            authorUrl: 'https://space.bilibili.com/1202350411',
            featuredContentCount: 1,
            featuredContentCards: [
              {
                title: 'BV1WjDDBGE3p',
                url: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
                bvid: 'BV1WjDDBGE3p',
                authorMid: '1202350411',
                contentType: 'video',
              },
            ],
          },
        },
      ],
    },
    states: [
      stateRecord({
        stateId: 's_home',
        stateName: 'Home',
        pageType: 'home',
        finalUrl: url,
        title: 'bilibili',
        pageFacts: {
          featuredContentCount: 1,
          featuredContentCards: [
            {
              title: 'BV1WjDDBGE3p',
              url: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
              bvid: 'BV1WjDDBGE3p',
              authorMid: '1202350411',
              contentType: 'video',
            },
          ],
          featuredAuthorCount: 1,
          featuredAuthorCards: [
            {
              name: 'UP 1202350411',
              url: 'https://space.bilibili.com/1202350411',
              mid: '1202350411',
              authorSubpage: 'video',
            },
          ],
        },
      }),
      stateRecord({
        stateId: 's_search',
        stateName: 'Search Results',
        pageType: 'search-results-page',
        finalUrl: 'https://search.bilibili.com/all?keyword=BV1WjDDBGE3p',
        title: 'Search BV1WjDDBGE3p',
        pageFacts: {
          searchFamily: 'all',
          queryText: 'BV1WjDDBGE3p',
          resultCount: 1,
        },
      }),
      stateRecord({
        stateId: 's_detail',
        stateName: 'Video Detail',
        pageType: 'content-detail-page',
        finalUrl: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
        title: 'BV1WjDDBGE3p',
        pageFacts: {
          bv: 'BV1WjDDBGE3p',
          bvid: 'BV1WjDDBGE3p',
          authorMid: '1202350411',
          authorUrl: 'https://space.bilibili.com/1202350411',
          contentTitle: 'BV1WjDDBGE3p',
          contentType: 'video',
        },
      }),
      stateRecord({
        stateId: 's_author',
        stateName: 'Author Page',
        pageType: 'author-page',
        finalUrl: 'https://space.bilibili.com/1202350411',
        title: 'UP 1202350411',
        pageFacts: {
          authorMid: '1202350411',
          authorUrl: 'https://space.bilibili.com/1202350411',
          featuredContentCount: 1,
          featuredContentCards: [
            {
              title: 'BV1WjDDBGE3p',
              url: 'https://www.bilibili.com/video/BV1WjDDBGE3p/',
              bvid: 'BV1WjDDBGE3p',
              authorMid: '1202350411',
              contentType: 'video',
            },
          ],
        },
      }),
      stateRecord({
        stateId: 's_bangumi',
        stateName: 'Bangumi Detail',
        pageType: 'content-detail-page',
        finalUrl: 'https://www.bilibili.com/bangumi/play/ep508404',
        title: 'Bangumi Detail',
        pageFacts: {
          contentType: 'bangumi',
        },
      }),
      stateRecord({
        stateId: 's_author_video',
        stateName: 'Author Video',
        pageType: 'author-page',
        finalUrl: 'https://space.bilibili.com/1202350411/video',
        title: 'UP 1202350411 video',
        pageFacts: {
          authorMid: '1202350411',
        },
      }),
      stateRecord({
        stateId: 's_category',
        stateName: 'Category',
        pageType: 'category-page',
        finalUrl: 'https://www.bilibili.com/v/popular/all/',
        title: 'popular',
        pageFacts: {
          categoryPath: '/v/popular/',
        },
      }),
    ],
    intents: [
      { intentId: 'intent-search-video', intentType: 'search-video', actionId: 'search', elementId: 'search-form', targetDomain: { actionableValues: [{ value: 'query', label: 'BV1WjDDBGE3p' }], candidateValues: [] } },
      { intentId: 'intent-open-video', intentType: 'open-video', actionId: 'open-video', elementId: 'video-link', targetDomain: { actionableValues: [{ value: 'video', label: 'BV1WjDDBGE3p' }], candidateValues: [] } },
      { intentId: 'intent-open-author', intentType: 'open-author', actionId: 'open-author', elementId: 'author-link', targetDomain: { actionableValues: [{ value: 'author', label: 'UP 1202350411' }], candidateValues: [] } },
      { intentId: 'intent-open-category', intentType: 'open-category', actionId: 'open-category', elementId: 'category-link', targetDomain: { actionableValues: [{ value: 'category', label: 'anime' }], candidateValues: [] } },
    ],
    actions: [
      { actionId: 'search', actionKind: 'search-submit' },
      { actionId: 'open-video', actionKind: 'safe-nav-link' },
      { actionId: 'open-author', actionKind: 'safe-nav-link' },
      { actionId: 'open-category', actionKind: 'safe-nav-link' },
    ],
    slotSchemaIntents: [
      { intentId: 'intent-search-video', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-video', slots: [{ slotId: 'videoCode', required: true }] },
      { intentId: 'intent-open-author', slots: [{ slotId: 'upName', required: true }] },
      { intentId: 'intent-open-category', slots: [{ slotId: 'categoryName', required: true }] },
    ],
    docs: [
      doc('intent-search-video', 'Search videos', 'intent-search-video.md', '# Search videos\n'),
      doc('intent-open-video', 'Open video pages', 'intent-open-video.md', '# Open video pages\n'),
      doc('intent-open-author', 'Open UP profiles', 'intent-open-author.md', '# Open UP profiles\n'),
      doc('intent-open-category', 'Open category pages', 'intent-open-category.md', '# Open category pages\n'),
    ],
    wikiReadme: '# bilibili Wiki',
  });
  return {
    ...fixture,
    rawDirs: rawDirsFromFixture(fixture),
  };
}

export function buildExampleStageSpec() {
  return buildStageSpec('example.com', 'https://example.com/', createExampleSourceFixture);
}

export function buildJableStageSpec() {
  return buildStageSpec('jable.tv', 'https://jable.tv/', createJableSourceFixture);
}

export function buildMoodyzStageSpec() {
  return buildStageSpec('moodyz.com', 'https://moodyz.com/works/date', createMoodyzSourceFixture);
}

export function build22BiquStageSpec() {
  return buildStageSpec('www.22biqu.com', 'https://www.22biqu.com/', create22BiquSourceFixture);
}

export function buildBilibiliStageSpec() {
  return buildStageSpec('www.bilibili.com', 'https://www.bilibili.com/', createBilibiliSourceFixture);
}

export async function createStageFixtures(rootDir, spec) {
  const sourceRoot = path.join(rootDir, 'fixture-source', spec.host);
  const fixture = await spec.createSourceFixture(sourceRoot);
  const metadataSandbox = createSiteMetadataSandbox(rootDir);
  return {
    fixture,
    metadataSandbox,
    captureDir: fixture.rawDirs['step-1-capture'] ?? null,
    expandedStatesDir: fixture.rawDirs['step-2-expanded'] ?? null,
    bookContentDir: fixture.rawDirs['step-book-content'] ?? null,
    analysisDir: fixture.rawDirs['step-3-analysis'],
    abstractionDir: fixture.rawDirs['step-4-abstraction'],
    nlEntryDir: fixture.rawDirs['step-5-nl-entry'],
    docsDir: fixture.rawDirs['step-6-docs'],
    governanceDir: fixture.rawDirs['step-7-governance'],
  };
}

export async function compileFixtureKnowledgeBase(rootDir, spec) {
  const stageFixtures = await createStageFixtures(rootDir, spec);
  const kbDir = path.join(rootDir, 'compiled-kb', spec.host);
  await compileKnowledgeBase(spec.inputUrl, {
    kbDir,
    captureDir: stageFixtures.captureDir,
    expandedStatesDir: stageFixtures.expandedStatesDir,
    bookContentDir: stageFixtures.bookContentDir,
    analysisDir: stageFixtures.analysisDir,
    abstractionDir: stageFixtures.abstractionDir,
    nlEntryDir: stageFixtures.nlEntryDir,
    docsDir: stageFixtures.docsDir,
    governanceDir: stageFixtures.governanceDir,
    strict: false,
    siteMetadataOptions: stageFixtures.metadataSandbox.siteMetadataOptions,
  });
  return {
    kbDir,
    ...stageFixtures,
  };
}
