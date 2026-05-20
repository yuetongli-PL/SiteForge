import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDouyinDownloadTaskSeed,
  buildDouyinMediaShapeDiagnostics,
  normalizeDouyinVideoDownloadMetadata,
  selectBestDouyinFormat,
  shouldRetryDouyinUnresolvedResult,
} from '../../src/sites/known-sites/douyin/queries/media-resolver.mjs';

test('normalizeDouyinVideoDownloadMetadata prefers highest resolution and bitrate direct play url', () => {
  const metadata = normalizeDouyinVideoDownloadMetadata({
    aweme_detail: {
      aweme_id: '7627403877511417129',
      desc: '示例视频',
      create_time: 1775893963,
      author: {
        nickname: '作者A',
        sec_uid: 'MS4wLjABAAAATEST',
      },
      video: {
        width: 1920,
        height: 1080,
        bit_rate: [
          {
            bit_rate: 4000,
            width: 1920,
            height: 1080,
            gear_name: '1080p',
            play_addr: {
              url_list: ['https://v.example.com/high.mp4'],
            },
          },
          {
            bit_rate: 1200,
            width: 1280,
            height: 720,
            gear_name: '720p',
            play_addr: {
              url_list: ['https://v.example.com/medium.mp4'],
            },
          },
        ],
        download_addr: {
          url_list: ['https://v.example.com/download.mp4'],
        },
      },
    },
  }, {
    requestedUrl: 'https://www.douyin.com/video/7627403877511417129',
  });

  assert.equal(metadata?.videoId, '7627403877511417129');
  assert.equal(metadata?.authorName, '作者A');
  assert.equal(metadata?.authorUrl, 'https://www.douyin.com/user/MS4wLjABAAAATEST');
  assert.equal(metadata?.bestUrl, 'https://v.example.com/high.mp4');
  assert.equal(metadata?.bestFormat?.height, 1080);
  assert.equal(metadata?.formats?.length, 3);
});

test('selectBestDouyinFormat falls back to play source before download source at same quality', () => {
  const best = selectBestDouyinFormat([
    {
      sourceType: 'download-addr',
      height: 1080,
      bitRate: 2500,
      dataSize: 100,
      formatId: 'download',
      url: 'https://v.example.com/download.mp4',
    },
    {
      sourceType: 'play-addr',
      height: 1080,
      bitRate: 2500,
      dataSize: 100,
      formatId: 'play',
      url: 'https://v.example.com/play.mp4',
    },
  ]);

  assert.equal(best?.url, 'https://v.example.com/play.mp4');
});

test('normalizeDouyinVideoDownloadMetadata accepts compact page detail payloads with play_addr_265', () => {
  const metadata = normalizeDouyinVideoDownloadMetadata({
    aweme_id: '7616581336639212800',
    desc: 'Compact page payload',
    create_time: 1776616702,
    author: {
      nickname: 'Page Author',
      sec_uid: 'MS4wLjABAAAAPAGE',
    },
    video: {
      width: 1080,
      height: 1920,
      play_addr_265: {
        url_list: ['https://v26-web.douyinvod.com/example/h265.mp4'],
      },
      bit_rate: [
        {
          bit_rate: 3201,
          width: 1080,
          height: 1920,
          gear_name: '1080p-h265',
          is_h265: 1,
          play_addr_265: {
            url_list: ['https://v26-web.douyinvod.com/example/high-h265.mp4'],
          },
        },
      ],
    },
  }, {
    requestedUrl: 'https://www.douyin.com/video/7616581336639212800',
    videoId: '7616581336639212800',
  });

  assert.equal(metadata?.videoId, '7616581336639212800');
  assert.equal(metadata?.bestUrl, 'https://v26-web.douyinvod.com/example/high-h265.mp4');
  assert.equal(metadata?.bestFormat?.codec, 'h265');
  assert.equal(metadata?.authorUrl, 'https://www.douyin.com/user/MS4wLjABAAAAPAGE');
  assert.equal(metadata?.formats?.some((format) => format.url.includes('h265.mp4')), true);
});

test('buildDouyinDownloadTaskSeed returns direct media seed for aweme payloads', () => {
  const seed = buildDouyinDownloadTaskSeed({
    aweme_id: '7630414422725268971',
    desc: 'Valid Douyin video',
    create_time: 1776616702,
    author: {
      nickname: 'Author',
      sec_uid: 'MS4wLjABAAAAVALID',
    },
    video: {
      width: 1080,
      height: 1920,
      bit_rate: [
        {
          bit_rate: 3201,
          width: 1080,
          height: 1920,
          gear_name: '1080p',
          play_addr: {
            url_list: ['https://v26-web.douyinvod.com/example/high.mp4'],
          },
        },
      ],
      play_addr: {
        url_list: ['https://v26-web.douyinvod.com/example/fallback.mp4'],
      },
    },
  }, {
    requestedUrl: 'https://www.douyin.com/video/7630414422725268971',
  });

  assert.equal(seed?.finalUrl, 'https://www.douyin.com/video/7630414422725268971');
  assert.equal(seed?.videoId, '7630414422725268971');
  assert.equal(seed?.resolvedMediaUrl, 'https://v26-web.douyinvod.com/example/high.mp4');
  assert.equal(seed?.resolvedTitle, 'Valid Douyin video');
  assert.equal(seed?.resolvedAuthorUrl, 'https://www.douyin.com/user/MS4wLjABAAAAVALID');
});

test('buildDouyinMediaShapeDiagnostics records safe shape counts without raw URLs', () => {
  const diagnostics = buildDouyinMediaShapeDiagnostics({
    aweme_detail: {
      aweme_id: '7630414422725268971',
      video: {
        play_addr: {
          url_list: [
            'https://v26-web.douyinvod.com/secret-token/high.mp4?msToken=raw',
            'https://v26-web.douyinvod.com/secret-token/high-backup.mp4?a_bogus=raw',
          ],
        },
        play_addr_265: {
          url_list: ['https://v26-web.douyinvod.com/secret-token/h265.mp4'],
        },
        bit_rate: [
          {
            play_addr: {
              url_list: ['https://v26-web.douyinvod.com/secret-token/bitrate.mp4'],
            },
          },
          {
            gear_name: 'metadata-only',
          },
        ],
      },
    },
  }, {
    sourceType: 'detail-api',
    formatCount: 3,
  });

  assert.deepEqual(diagnostics, {
    sourceType: 'detail-api',
    payloadPresent: true,
    awemeIdPresent: true,
    videoPresent: true,
    containerNames: ['play_addr', 'play_addr_h265'],
    containerCount: 2,
    urlCount: 4,
    bitRateCount: 2,
    bitRateWithUrls: 1,
    formatCount: 3,
  });
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('msToken'), false);
  assert.equal(serialized.includes('a_bogus'), false);
});

test('shouldRetryDouyinUnresolvedResult retries only empty non-terminal media misses', () => {
  assert.equal(shouldRetryDouyinUnresolvedResult({
    resolved: false,
    error: 'video-not-found-in-author-posts',
    phaseDiagnostics: [
      { phase: 'detail-api', status: 'unresolved', reason: 'media-url-missing' },
      { phase: 'author-posts', status: 'unresolved', reason: 'video-not-found-in-author-posts' },
    ],
    structuralDiagnostics: [
      { sourceType: 'detail-api', payloadPresent: false, urlCount: 0, formatCount: 0 },
      { sourceType: 'page-detail-payload', payloadPresent: false, urlCount: 0, formatCount: 0 },
    ],
  }), true);

  assert.equal(shouldRetryDouyinUnresolvedResult({
    resolved: false,
    error: 'video-unavailable',
    phaseDiagnostics: [
      { phase: 'availability-check', status: 'blocked', reason: 'video-unavailable' },
    ],
  }), false);

  assert.equal(shouldRetryDouyinUnresolvedResult({
    resolved: true,
    bestUrl: 'https://v.example.com/video.mp4',
  }), false);
});
