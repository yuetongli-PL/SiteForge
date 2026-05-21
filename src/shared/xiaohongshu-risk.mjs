// @ts-check

import { cleanText, normalizeUrlNoFragment, uniqueSortedStrings } from './normalize.mjs';

const XIAOHONGSHU_HOSTS = new Set([
  'www.xiaohongshu.com',
  'xiaohongshu.com',
]);

function parseUrl(input = '') {
  try {
    const normalized = normalizeUrlNoFragment(input);
    return normalized ? new URL(normalized) : null;
  } catch {
    return null;
  }
}

function decodeQueryValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function isXiaohongshuHost(hostname = '') {
  return XIAOHONGSHU_HOSTS.has(String(hostname ?? '').toLowerCase());
}

export function isXiaohongshuUrl(input = '') {
  return isXiaohongshuHost(parseUrl(input)?.hostname ?? '');
}

export function detectXiaohongshuRestrictionPage({
  inputUrl = '',
  finalUrl = '',
  title = '',
  pageType = '',
  pageFacts = null,
  runtimeEvidence = null,
} = /** @type {any} */ ({})) {
  const parsedFinalUrl = parseUrl(finalUrl || inputUrl);
  const parsedInputUrl = parseUrl(inputUrl);
  const hostname = parsedFinalUrl?.hostname ?? parsedInputUrl?.hostname ?? '';
  if (!isXiaohongshuHost(hostname)) {
    return null;
  }

  const pathname = parsedFinalUrl?.pathname ?? parsedInputUrl?.pathname ?? '';
  const searchParams = parsedFinalUrl?.searchParams ?? parsedInputUrl?.searchParams ?? new URLSearchParams();
  const riskPageCode = cleanText(pageFacts?.riskPageCode ?? searchParams.get('error_code') ?? '') || null;
  const riskPageTitle = cleanText(pageFacts?.riskPageTitle ?? title ?? '') || null;
  const riskPageMessage = cleanText(
    pageFacts?.riskPageMessage
    ?? decodeQueryValue(searchParams.get('error_msg') ?? '')
    ?? '',
  ) || null;
  const redirectPath = cleanText(pageFacts?.redirectPath ?? decodeQueryValue(searchParams.get('redirectPath') ?? '') ?? '') || null;
  const antiCrawlSignals = uniqueSortedStrings([
    ...(Array.isArray(pageFacts?.antiCrawlSignals) ? pageFacts.antiCrawlSignals : []),
    ...(Array.isArray(runtimeEvidence?.antiCrawlSignals) ? runtimeEvidence.antiCrawlSignals : []),
    ...(Array.isArray(runtimeEvidence?.antiCrawlEvidence?.signals) ? runtimeEvidence.antiCrawlEvidence.signals : []),
  ]);
  const joinedSource = cleanText([
    riskPageTitle,
    riskPageMessage,
    pageFacts?.riskPageMessage,
    pageFacts?.riskPageTitle,
    title,
  ].filter(Boolean).join(' '));
  const restrictionDetected = (
    pageFacts?.riskPageDetected === true
    || pageFacts?.antiCrawlDetected === true
    || runtimeEvidence?.antiCrawlDetected === true
    || pathname === '/website-login/error'
    || riskPageCode === '300012'
    || String(pageType ?? '') === 'auth-page' && /安全限制/u.test(joinedSource)
    || /IP存在风险|请切换可靠网络环境后重试|安全限制/u.test(joinedSource)
  );
  if (!restrictionDetected) {
    return null;
  }

  return {
    restrictionDetected: true,
    antiCrawlDetected: true,
    antiCrawlSignals: uniqueSortedStrings([
      ...antiCrawlSignals,
      'risk-control',
      'verify',
      ...(riskPageCode === '300012' || /IP存在风险/u.test(joinedSource) ? ['ip-risk'] : []),
    ]),
    antiCrawlReasonCode: cleanText(pageFacts?.antiCrawlReasonCode ?? runtimeEvidence?.antiCrawlReasonCode ?? '') || 'anti-crawl-verify',
    riskPageDetected: true,
    riskPageCode,
    riskPageMessage,
    riskPageTitle,
    redirectPath,
    riskCauseCode: 'browser-fingerprint-risk',
    riskAction: 'use-visible-browser-warmup',
    finalUrl: normalizeUrlNoFragment(parsedFinalUrl?.toString?.() ?? finalUrl ?? inputUrl) ?? null,
    pageType: String(pageType ?? '') || null,
  };
}
