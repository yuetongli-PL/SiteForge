import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMoodyzDateListUrl,
  buildMoodyzMonthDateListUrls,
  collectMoodyzMonthCatalog,
  parseMoodyzDateListHtml,
} from '../../src/sites/known-sites/moodyz/queries/month-catalog.mjs';

function card({ code, title }) {
  return `
    <div class="item">
      <a class="img hover" href="https://moodyz.com/works/detail/${code}">
        <p class="text">${title}</p>
      </a>
    </div>
  `;
}

test('Moodyz month catalog builds one date-list URL per calendar day', () => {
  assert.equal(
    buildMoodyzDateListUrl({ year: 2026, month: 5, day: 7 }),
    'https://moodyz.com/works/list/date/2026-05-07',
  );

  const urls = buildMoodyzMonthDateListUrls({ year: 2026, month: 5 });
  assert.equal(urls.length, 31);
  assert.equal(urls[0], 'https://moodyz.com/works/list/date/2026-05-01');
  assert.equal(urls[6], 'https://moodyz.com/works/list/date/2026-05-07');
  assert.equal(urls.at(-1), 'https://moodyz.com/works/list/date/2026-05-31');
});

test('Moodyz date-list parser extracts detail URLs and decodes titles', () => {
  const rows = parseMoodyzDateListHtml(
    card({ code: 'MDVR423', title: 'Sample &lt;&lt;VR&gt;&gt; Work' }),
    { sourceUrl: 'https://moodyz.com/works/list/date/2026-05-07' },
  );

  assert.deepEqual(rows, [{
    date: '2026-05-07',
    title: 'Sample <<VR>> Work',
    url: 'https://moodyz.com/works/detail/MDVR423',
    sourceUrl: 'https://moodyz.com/works/list/date/2026-05-07',
  }]);
});

test('Moodyz month collector probes every day and keeps sparse single-work dates', async () => {
  const pages = new Map([
    ['2026-05-05', card({ code: 'MIDA492', title: 'May 5 Work' })],
    ['2026-05-07', card({ code: 'MDVR423', title: 'May 7 Single Work' })],
    ['2026-05-14', [
      card({ code: 'MIHD001', title: 'May 14 Work' }),
      card({ code: 'MIHD001', title: 'May 14 Work Duplicate' }),
    ].join('\n')],
  ]);
  const fetched = [];

  const catalog = await collectMoodyzMonthCatalog({
    year: 2026,
    month: 5,
    fetchHtml: async (url) => {
      fetched.push(url);
      const date = url.split('/').at(-1);
      return pages.get(date) ?? '<main>全0作品</main>';
    },
  });

  assert.equal(fetched.length, 31);
  assert.equal(catalog.strategy, 'daily-date-list-probe');
  assert.equal(catalog.total, 3);
  assert.deepEqual(catalog.dates, {
    '2026-05-05': 1,
    '2026-05-07': 1,
    '2026-05-14': 1,
  });
  assert.deepEqual(
    catalog.works.map((work) => `${work.date} ${work.url.split('/').at(-1)}`),
    [
      '2026-05-05 MIDA492',
      '2026-05-07 MDVR423',
      '2026-05-14 MIHD001',
    ],
  );
});

test('Moodyz month collector refuses incomplete daily probes by default', async () => {
  await assert.rejects(
    collectMoodyzMonthCatalog({
      year: 2026,
      month: 5,
      fetchHtml: async (url) => {
        if (url.endsWith('/2026-05-07')) {
          throw new Error('network failed');
        }
        return '<main>全0作品</main>';
      },
    }),
    /Moodyz month catalog incomplete: 1 daily probes failed/u,
  );

  const partial = await collectMoodyzMonthCatalog({
    year: 2026,
    month: 5,
    allowPartial: true,
    fetchHtml: async (url) => {
      if (url.endsWith('/2026-05-07')) {
        throw new Error('network failed');
      }
      return '<main>全0作品</main>';
    },
  });
  assert.equal(partial.probes.find((probe) => probe.date === '2026-05-07')?.ok, false);
});
