// @ts-check

export const DEFAULT_PROGRESS_LANGUAGE = 'zh';

export const PROGRESS_STAGE_COPY = Object.freeze({
  capture: {
    zh: '\u89c2\u5bdf\u7f51\u7ad9\u7ed3\u6784',
    en: 'Observing website structure',
  },
  expanded: {
    zh: '\u63a2\u7d22\u9875\u9762\u72b6\u6001',
    en: 'Exploring page states',
  },
  bookContent: {
    zh: '\u91c7\u96c6\u5185\u5bb9\u6837\u672c',
    en: 'Collecting content samples',
  },
  analysis: {
    zh: '\u5206\u6790\u9875\u9762\u7c7b\u578b',
    en: 'Analyzing page types',
  },
  abstraction: {
    zh: '\u6574\u7406\u4ea4\u4e92\u6a21\u578b',
    en: 'Building interaction model',
  },
  nlEntry: {
    zh: '\u751f\u6210\u81ea\u7136\u8bed\u8a00\u5165\u53e3',
    en: 'Building natural-language entry points',
  },
  docs: {
    zh: '\u751f\u6210\u8bf4\u660e\u6587\u6863',
    en: 'Generating documentation',
  },
  governance: {
    zh: '\u751f\u6210\u5b89\u5168\u8fb9\u754c\u4e0e\u6062\u590d\u7b56\u7565',
    en: 'Building safety and recovery rules',
  },
  knowledgeBase: {
    zh: '\u7f16\u8bd1\u7ad9\u70b9\u77e5\u8bc6\u5e93',
    en: 'Compiling site knowledge base',
  },
  capabilityCompile: {
    zh: '\u7f16\u8bd1 Graph \u4e0e Planner Layer',
    en: 'Compiling Graph and Planner Layer',
  },
  skill: {
    zh: '\u751f\u6210 Agent Skill',
    en: 'Generating Agent Skill',
  },
});

export const DOCTOR_STAGE_COPY = Object.freeze({
  profile: { zh: '\u68c0\u67e5\u7ad9\u70b9 profile', en: 'Checking site profile' },
  adapter: { zh: '\u68c0\u67e5 SiteAdapter', en: 'Checking SiteAdapter' },
  crawler: { zh: '\u68c0\u67e5\u91c7\u96c6\u811a\u672c', en: 'Checking crawler script' },
  capture: { zh: '\u68c0\u67e5\u9875\u9762\u91c7\u96c6', en: 'Checking capture' },
  expand: { zh: '\u68c0\u67e5\u72b6\u6001\u63a2\u7d22', en: 'Checking expansion' },
  capabilityCompile: { zh: '\u7f16\u8bd1 Capability \u5e72\u8dd1\u8bc1\u636e', en: 'Compiling capability dry-run evidence' },
  session: { zh: '\u68c0\u67e5 session \u5065\u5eb7', en: 'Checking session health' },
  risk: { zh: '\u68c0\u67e5\u98ce\u9669\u4fe1\u53f7', en: 'Checking risk signals' },
  download: { zh: '\u68c0\u67e5\u4e0b\u8f7d\u5c31\u7eea\u5ea6', en: 'Checking download readiness' },
});

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

export function pipelineStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(PROGRESS_STAGE_COPY[stageId], language) || String(stageId ?? '');
}

export function doctorStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(DOCTOR_STAGE_COPY[stageId], language) || String(stageId ?? '');
}

export function statusTitle(status, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(STATUS_COPY[status], language) || String(status ?? '');
}
