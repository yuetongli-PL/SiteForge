// @ts-check

export const DEFAULT_PROGRESS_LANGUAGE = 'zh';

export const STATUS_COPY = Object.freeze({
  pending: { zh: '\u7b49\u5f85\u4e2d', en: 'pending' },
  running: { zh: '\u8fd0\u884c\u4e2d', en: 'running' },
  success: { zh: '\u6210\u529f', en: 'success' },
  warning: { zh: '\u8b66\u544a', en: 'warning' },
  failed: { zh: '\u5931\u8d25', en: 'failed' },
  skipped: { zh: '\u5df2\u8df3\u8fc7', en: 'skipped' },
  cancelled: { zh: '\u5df2\u53d6\u6d88', en: 'cancelled' },
});

export const SAFETY_STOP_COPY = Object.freeze({
  zh: '\u7cfb\u7edf\u5df2\u5b89\u5168\u505c\u6b62\uff0c\u672a\u5c1d\u8bd5\u7ed5\u8fc7 CAPTCHA\u3001MFA\u3001\u5e73\u53f0\u98ce\u63a7\u3001\u9650\u6d41\u3001\u6743\u9650\u6216\u8bbf\u95ee\u63a7\u5236\u3002',
  en: 'Automation stopped safely. No CAPTCHA, MFA, platform-risk, rate-limit, permission, or access-control bypass was attempted.',
});

export function progressText(entry, language = DEFAULT_PROGRESS_LANGUAGE) {
  if (!entry) {
    return '';
  }
  if (typeof entry === 'string') {
    return entry;
  }
  return entry[language] ?? entry.en ?? entry.zh ?? '';
}

export function statusTitle(status, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(STATUS_COPY[status], language) || String(status ?? '');
}
