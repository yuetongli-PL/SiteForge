import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { capture } from '../../src/pipeline/stages/capture.mjs';
import { analyzeStates } from '../../src/pipeline/stages/analyze.mjs';
import { collectBookContent, parseCliArgs as parseCollectCliArgs } from '../../src/pipeline/stages/collect-content.mjs';

const REPO_ROOT = process.cwd();

const STAGE_CONTRACTS = [
  ['src/entrypoints/pipeline/capture.mjs', 'src/pipeline/stages/capture.mjs'],
  ['src/entrypoints/pipeline/expand-states.mjs', 'src/pipeline/stages/expand.mjs'],
  ['src/entrypoints/pipeline/collect-book-content.mjs', 'src/pipeline/stages/collect-content.mjs'],
  ['src/entrypoints/pipeline/analyze-states.mjs', 'src/pipeline/stages/analyze.mjs'],
  ['src/entrypoints/pipeline/abstract-interactions.mjs', 'src/pipeline/stages/abstract.mjs'],
  ['src/entrypoints/pipeline/nl-entry.mjs', 'src/pipeline/stages/nl.mjs'],
  ['src/entrypoints/pipeline/generate-docs.mjs', 'src/pipeline/stages/docs.mjs'],
  ['src/entrypoints/pipeline/govern-interactions.mjs', 'src/pipeline/stages/governance.mjs'],
  ['src/entrypoints/pipeline/compile-wiki.mjs', 'src/pipeline/stages/kb/index.mjs'],
  ['src/entrypoints/pipeline/generate-skill.mjs', 'src/pipeline/stages/skill.mjs'],
];

test('pipeline stage implementations no longer depend on entrypoint modules', async () => {
  for (const [, stage] of STAGE_CONTRACTS) {
    const source = await readFile(path.join(REPO_ROOT, stage), 'utf8');
    assert.equal(
      /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"][^'"]*entrypoints\/pipeline/iu.test(source),
      false,
      `${stage} should not import pipeline entrypoints`,
    );
  }
});

test('pipeline entrypoints point at the canonical stage modules', async () => {
  for (const [entrypoint, stage] of STAGE_CONTRACTS) {
    const source = await readFile(path.join(REPO_ROOT, entrypoint), 'utf8');
    const normalizedStage = stage.replace(/^src\//u, '').replaceAll('\\', '/');
    assert.match(
      source,
      new RegExp(normalizedStage.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      `${entrypoint} should reference ${stage}`,
    );
  }
});

test('capture returns an INVALID_INPUT manifest from the canonical stage when url parsing fails', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-capture-contract-'));

  try {
    const manifest = await capture('not-a-url', {
      outDir: path.join(workspace, 'capture-out'),
    });
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.error?.code, 'INVALID_INPUT');
    assert.match(manifest.outDir, /capture-out/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collectBookContent returns an empty summary from the canonical stage when no expanded input exists and fallback is disabled', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-collect-content-contract-'));

  try {
    const result = await collectBookContent('https://jable.tv/', {
      expandedStatesDir: path.join(workspace, 'missing-expanded'),
      outDir: path.join(workspace, 'book-content-out'),
      skipFallback: true,
    });
    assert.equal(result.summary.books, 0);
    assert.equal(result.summary.authors, 0);
    assert.equal(result.summary.queries, 0);
    assert.match(result.outDir, /book-content-out/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collect-content stage CLI parser remains available from the canonical stage module', () => {
  const parsed = parseCollectCliArgs([
    'https://jable.tv/',
    '--expanded-dir',
    'expanded',
    '--search-query',
    'keyword',
    '--stage-timeout',
    '1234',
    '--chapter-fetch-concurrency',
    '7',
  ]);
  assert.equal(parsed.command, 'collect');
  assert.equal(parsed.inputUrl, 'https://jable.tv/');
  assert.equal(parsed.options.expandedStatesDir, 'expanded');
  assert.deepEqual(parsed.options.searchQueries, ['keyword']);
  assert.equal(parsed.options.stageTimeoutMs, 1234);
  assert.equal(parsed.options.chapterFetchConcurrency, 7);
});

test('collectBookContent returns a redacted partial manifest when the stage deadline expires', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-collect-content-timeout-'));
  const expandedDir = path.join(workspace, 'expanded');
  const originalFetch = globalThis.fetch;

  try {
    await mkdir(expandedDir, { recursive: true });
    await writeFile(path.join(expandedDir, 'states-manifest.json'), JSON.stringify({
      states: [
        {
          finalUrl: 'https://www.22biqu.com/biqu1/',
          title: 'Fixture Book',
          pageFacts: {
            bookTitle: 'Fixture Book',
          },
        },
      ],
    }));

    globalThis.fetch = async (_url, { signal } = {}) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
    });

    const result = await collectBookContent('https://www.22biqu.com/', {
      expandedStatesDir: expandedDir,
      outDir: path.join(workspace, 'book-content-out'),
      stageTimeoutMs: 5,
      requestTimeoutMs: 10_000,
      maxFallbackBooks: 1,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.reasonCode, 'book-content-collection-timeout');
    assert.equal(result.retryable, true);
    assert.equal(result.redactionRequired, true);
    assert.equal(result.summary.books, 0);
    assert.equal(result.summary.failedCollections, 1);
    assert.equal(result.timeoutPolicy.timedOut, true);
    assert.equal(result.failures[0].scope, 'book');
    assert.equal(result.gaps[0].stage, 'bookContent');

    const persistedManifest = JSON.parse(await readFile(result.files.manifest, 'utf8'));
    assert.equal(persistedManifest.status, 'partial');
    assert.equal(persistedManifest.reasonCode, 'book-content-collection-timeout');

    const audit = JSON.parse(await readFile(`${result.files.manifest}.redaction-audit.json`, 'utf8'));
    assert.equal(audit.schemaVersion, 1);
    assert.deepEqual(audit.findings, []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collectBookContent uses 22biqu paginated directories with bounded concurrent chapter fetches', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-collect-content-paginated-'));
  const originalFetch = globalThis.fetch;
  const requested = [];
  let activeChapterFetches = 0;
  let maxActiveChapterFetches = 0;

  function htmlResponse(url, text) {
    return {
      status: 200,
      url,
      async text() {
        return text;
      },
    };
  }

  function chapterHtml(index) {
    return [
      '<html><body>',
      `<h1>Chapter ${index}</h1>`,
      `<div id="content">Body ${index}</div>`,
      '</body></html>',
    ].join('');
  }

  try {
    globalThis.fetch = async (url) => {
      const normalizedUrl = String(url);
      requested.push(normalizedUrl);
      if (normalizedUrl === 'https://www.22biqu.com/biqu123/') {
        return htmlResponse(normalizedUrl, [
          '<html><head>',
          '<meta property="og:novel:book_name" content="Fixture Book">',
          '<meta property="og:novel:author" content="Fixture Author">',
          '<meta property="og:novel:author_link" content="https://www.22biqu.com/author/fixture/">',
          '<meta property="og:novel:lastest_chapter_url" content="https://www.22biqu.com/biqu123/1006.html">',
          '</head><body><h1>Fixture Book</h1></body></html>',
        ].join(''));
      }
      if (normalizedUrl === 'https://www.22biqu.com/author/fixture/') {
        return htmlResponse(normalizedUrl, '<html><body><h1>Fixture Author</h1></body></html>');
      }
      if (normalizedUrl === 'https://www.22biqu.com/biqu123/1/') {
        return htmlResponse(normalizedUrl, [
          '<div class="section-box"><div class="section-list">',
          '<a href="/biqu123/1001.html">Chapter 1</a>',
          '<a href="/biqu123/1002.html">Chapter 2</a>',
          '<a href="/biqu123/1003.html">Chapter 3</a>',
          '</div></div>',
        ].join(''));
      }
      if (normalizedUrl === 'https://www.22biqu.com/biqu123/2/') {
        return htmlResponse(normalizedUrl, [
          '<div class="section-box"><div class="section-list">',
          '<a href="/biqu123/1004.html">Chapter 4</a>',
          '<a href="/biqu123/1005.html">Chapter 5</a>',
          '<a href="/biqu123/1006.html">Chapter 6</a>',
          '</div></div>',
        ].join(''));
      }
      if (normalizedUrl === 'https://www.22biqu.com/biqu123/3/') {
        return htmlResponse(normalizedUrl, '<div class="section-box"><div class="section-list"></div></div>');
      }
      if (/\/biqu123\/100\d\.html$/u.test(normalizedUrl)) {
        activeChapterFetches += 1;
        maxActiveChapterFetches = Math.max(maxActiveChapterFetches, activeChapterFetches);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeChapterFetches -= 1;
        const index = normalizedUrl.match(/100(\d)\.html$/u)?.[1] ?? '0';
        return htmlResponse(normalizedUrl, chapterHtml(index));
      }
      throw new Error(`Unexpected fetch ${normalizedUrl}`);
    };

    const result = await collectBookContent('https://www.22biqu.com/', {
      outDir: path.join(workspace, 'book-content-out'),
      targetBookUrl: 'https://www.22biqu.com/biqu123/',
      skipFallback: true,
      chapterFetchConcurrency: 3,
      stageTimeoutMs: 30_000,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.books, 1);
    assert.equal(result.summary.chapters, 6);
    assert.equal(result.timeoutPolicy.timedOut, false);
    assert.equal(requested.includes('https://www.22biqu.com/biqu123/1/'), true);
    assert.equal(requested.includes('https://www.22biqu.com/biqu123/2/'), true);
    assert.equal(maxActiveChapterFetches > 1, true);

    const books = JSON.parse(await readFile(result.files.books, 'utf8'));
    assert.equal(books[0].chapterCount, 6);
    const chapters = JSON.parse(await readFile(books[0].chaptersFile, 'utf8'));
    assert.deepEqual(chapters.map((chapter) => chapter.chapterIndex), [1, 2, 3, 4, 5, 6]);
    assert.equal(chapters.every((chapter) => chapter.bodyTextLength > 0), true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('collectBookContent rejects out-of-scope target book URLs before fetching', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-collect-content-target-scope-'));
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  try {
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('fetch should not run for out-of-scope targets');
    };

    await assert.rejects(
      () => collectBookContent('https://www.22biqu.com/', {
        outDir: path.join(workspace, 'external-out'),
        targetBookUrl: 'https://example.com/biqu123/',
        skipFallback: true,
      }),
      /target host does not match pipeline input host/u,
    );

    await assert.rejects(
      () => collectBookContent('https://www.22biqu.com/', {
        outDir: path.join(workspace, 'wrong-shape-out'),
        targetBookUrl: 'https://www.22biqu.com/user/login/',
        skipFallback: true,
      }),
      /site adapter book-detail scope/u,
    );

    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('analyzeStates only reads bounded book download excerpts for chapter facts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-analysis-book-excerpt-'));
  const expandedDir = path.join(workspace, 'expanded');
  const stateDir = path.join(expandedDir, 'states', 'state_home_home');
  const bookContentDir = path.join(workspace, 'book-content');
  const bookDir = path.join(bookContentDir, 'books', 'fixture-book');
  const downloadsDir = path.join(bookContentDir, 'downloads');
  const downloadFile = path.join(downloadsDir, 'fixture-book.txt');
  const lateMarker = 'LATE_MARKER_AFTER_BOUNDARY';

  try {
    await mkdir(stateDir, { recursive: true });
    await mkdir(bookDir, { recursive: true });
    await mkdir(downloadsDir, { recursive: true });
    await writeFile(path.join(stateDir, 'page.html'), '<html><body>Fixture</body></html>');
    await writeFile(path.join(stateDir, 'screenshot.png'), '');
    await writeFile(path.join(stateDir, 'dom-snapshot.json'), JSON.stringify({
      strings: ['HTML', 'BODY', '#text', 'Fixture'],
      documents: [
        {
          nodes: {
            nodeName: [0, 1, 2],
            nodeValue: [-1, -1, 3],
            parentIndex: [-1, 0, 1],
            attributes: [[], [], []],
          },
        },
      ],
    }));
    await writeFile(path.join(stateDir, 'manifest.json'), JSON.stringify({
      state_id: 'state_home',
      state_name: 'Home',
      final_url: 'https://www.22biqu.com/',
      title: '22biqu',
      captured_at: '2026-05-10T00:00:00.000Z',
      status: 'captured',
      files: {
        html: 'page.html',
        snapshot: 'dom-snapshot.json',
        screenshot: 'screenshot.png',
      },
    }));
    await writeFile(path.join(expandedDir, 'states-manifest.json'), JSON.stringify({
      inputUrl: 'https://www.22biqu.com/',
      baseUrl: 'https://www.22biqu.com/',
      generatedAt: '2026-05-10T00:00:00.000Z',
      states: [
        {
          state_id: 'state_home',
          state_name: 'Home',
          final_url: 'https://www.22biqu.com/',
          title: '22biqu',
          captured_at: '2026-05-10T00:00:00.000Z',
          status: 'captured',
          files: {
            html: path.join('states', 'state_home_home', 'page.html'),
            snapshot: path.join('states', 'state_home_home', 'dom-snapshot.json'),
            screenshot: path.join('states', 'state_home_home', 'screenshot.png'),
            manifest: path.join('states', 'state_home_home', 'manifest.json'),
          },
        },
      ],
    }));

    await writeFile(downloadFile, [
      '# Chapter 1',
      '',
      'Visible excerpt near the start.',
      'x'.repeat(9_000),
      lateMarker,
    ].join('\n'));
    const chaptersFile = path.join(bookDir, 'chapters.json');
    await writeFile(chaptersFile, JSON.stringify([
      {
        chapterIndex: 1,
        href: 'https://www.22biqu.com/biqu123/1001.html',
        title: 'Chapter 1',
        pageCount: 1,
        finalUrl: 'https://www.22biqu.com/biqu123/1001.html',
        bodyTextLength: 9000,
      },
    ]));
    await writeFile(path.join(bookContentDir, 'books.json'), JSON.stringify([
      {
        bookId: 'biqu123',
        finalUrl: 'https://www.22biqu.com/biqu123/',
        title: 'Fixture Book',
        authorName: 'Fixture Author',
        chapterCount: 1,
        chaptersFile,
        downloadFile,
      },
    ]));
    await writeFile(path.join(bookContentDir, 'authors.json'), '[]');
    await writeFile(path.join(bookContentDir, 'search-results.json'), '[]');
    await writeFile(path.join(bookContentDir, 'book-content-manifest.json'), JSON.stringify({
      status: 'success',
      files: {
        books: path.join(bookContentDir, 'books.json'),
        authors: path.join(bookContentDir, 'authors.json'),
        searchResults: path.join(bookContentDir, 'search-results.json'),
        manifest: path.join(bookContentDir, 'book-content-manifest.json'),
      },
    }));

    const analysis = await analyzeStates('https://www.22biqu.com/', {
      expandedStatesDir: expandedDir,
      bookContentDir,
      outDir: path.join(workspace, 'analysis'),
    });
    const statesDocumentText = await readFile(analysis.files.states, 'utf8');
    const statesDocument = JSON.parse(statesDocumentText);
    const chapterState = statesDocument.states.find((state) => state.pageType === 'chapter-page');

    assert.ok(chapterState);
    assert.match(chapterState.pageFacts.bodyExcerpt, /Visible excerpt/u);
    assert.equal(statesDocumentText.includes(lateMarker), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
