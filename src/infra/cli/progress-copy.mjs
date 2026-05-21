// @ts-check

export const DEFAULT_PROGRESS_LANGUAGE = 'zh';

export const SITEFORGE_BUILD_STAGE_COPY = Object.freeze({
  registerSite: { zh: '注册站点', en: 'Registering site' },
  discoverSeeds: { zh: '发现种子页面', en: 'Discovering seed pages' },
  crawlStatic: { zh: '采集静态页面', en: 'Crawling static pages' },
  crawlRendered: { zh: '处理渲染页面采集', en: 'Handling rendered-page crawl' },
  discoverInteractions: { zh: '发现页面交互', en: 'Discovering interactions' },
  captureNetworkTraces: { zh: '处理网络摘要', en: 'Handling network summary' },
  buildSiteGraph: { zh: '构建站点图谱', en: 'Building site graph' },
  classifyNodes: { zh: '分类站点节点', en: 'Classifying site nodes' },
  extractAffordances: { zh: '提取可操作项', en: 'Extracting affordances' },
  discoverCapabilities: { zh: '发现站点能力', en: 'Discovering capabilities' },
  generateIntents: { zh: '生成意图入口', en: 'Generating intents' },
  generateSkill: { zh: '生成 SiteForge Skill', en: 'Generating SiteForge Skill' },
  verifySkill: { zh: '验证 Skill', en: 'Verifying Skill' },
  registerSkill: { zh: '注册 Skill', en: 'Registering Skill' },
  writeBuildReport: { zh: '写入构建报告', en: 'Writing build report' },
});

export const DOCTOR_STAGE_COPY = Object.freeze({
  profile: { zh: '\u68c0\u67e5\u7ad9\u70b9 profile', en: 'Checking site profile' },
  adapter: { zh: '\u68c0\u67e5 SiteAdapter', en: 'Checking SiteAdapter' },
  crawler: { zh: '\u68c0\u67e5\u91c7\u96c6\u811a\u672c', en: 'Checking crawler script' },
  capture: { zh: '\u68c0\u67e5\u9875\u9762\u91c7\u96c6', en: 'Checking capture' },
  expand: { zh: '\u68c0\u67e5\u72b6\u6001\u63a2\u7d22', en: 'Checking expansion' },
  capabilityDryRun: { zh: '\u7f16\u8bd1 Capability \u5e72\u8dd1\u8bc1\u636e', en: 'Compiling capability dry-run evidence' },
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

export function siteForgeBuildStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(SITEFORGE_BUILD_STAGE_COPY[stageId], language) || String(stageId ?? '');
}

export function doctorStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(DOCTOR_STAGE_COPY[stageId], language) || String(stageId ?? '');
}

export function statusTitle(status, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(STATUS_COPY[status], language) || String(status ?? '');
}
