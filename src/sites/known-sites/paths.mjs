// @ts-check

import path from 'node:path';

import { resolveRepoPath } from '../../infra/paths/repo-root.mjs';

const KNOWN_SITE_DOWNLOADERS = Object.freeze({
  bilibili: Object.freeze({
    siteDir: 'bilibili',
    fileName: 'bilibili.py',
  }),
  douyin: Object.freeze({
    siteDir: 'douyin',
    fileName: 'douyin.py',
  }),
  xiaohongshu: Object.freeze({
    siteDir: 'xiaohongshu',
    fileName: 'xiaohongshu.py',
  }),
});

export function knownSiteDownloaderRelativePath(siteKey) {
  const spec = KNOWN_SITE_DOWNLOADERS[siteKey];
  if (!spec) {
    throw new Error(`Unknown known-site downloader: ${siteKey}`);
  }
  return path.posix.join(
    'src',
    'sites',
    'known-sites',
    spec.siteDir,
    'download',
    'python',
    spec.fileName,
  );
}

export function knownSiteDownloaderPath(siteKey) {
  return resolveRepoPath(...knownSiteDownloaderRelativePath(siteKey).split('/'));
}

export const BILIBILI_DOWNLOAD_PYTHON_ENTRY_LABEL = knownSiteDownloaderRelativePath('bilibili');
export const BILIBILI_DOWNLOAD_PYTHON_ENTRY = knownSiteDownloaderPath('bilibili');
export const DOUYIN_DOWNLOAD_PYTHON_ENTRY_LABEL = knownSiteDownloaderRelativePath('douyin');
export const DOUYIN_DOWNLOAD_PYTHON_ENTRY = knownSiteDownloaderPath('douyin');
export const XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY_LABEL = knownSiteDownloaderRelativePath('xiaohongshu');
export const XIAOHONGSHU_DOWNLOAD_PYTHON_ENTRY = knownSiteDownloaderPath('xiaohongshu');
