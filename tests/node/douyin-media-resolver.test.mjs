import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDouyinDownloadTaskSeed,
  normalizeDouyinVideoDownloadMetadata,
  selectBestDouyinFormat,
} from '../../src/sites/douyin/queries/media-resolver.mjs';

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
