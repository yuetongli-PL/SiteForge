// @ts-check

import {
  DEFAULT_PROGRESS_LANGUAGE,
  progressText,
} from '../../../infra/cli/progress-copy.mjs';

export const SITEFORGE_BUILD_STAGE_COPY = Object.freeze({
  registerSite: { zh: '\u6ce8\u518c\u7ad9\u70b9', en: 'Registering site' },
  discoverSeeds: { zh: '\u53d1\u73b0\u79cd\u5b50\u9875\u9762', en: 'Discovering seed pages' },
  crawlStatic: { zh: '\u91c7\u96c6\u9759\u6001\u9875\u9762', en: 'Crawling static pages' },
  authStateCheck: { zh: '\u68c0\u67e5\u8ba4\u8bc1\u72b6\u6001', en: 'Checking auth state' },
  crawlAuthenticated: { zh: '\u91c7\u96c6\u8ba4\u8bc1\u9875\u9762', en: 'Crawling authenticated pages' },
  crawlRendered: { zh: '\u5904\u7406\u6e32\u67d3\u9875\u9762\u91c7\u96c6', en: 'Handling rendered-page crawl' },
  discoverInteractions: { zh: '\u53d1\u73b0\u9875\u9762\u4ea4\u4e92', en: 'Discovering interactions' },
  captureNetworkTraces: { zh: '\u5904\u7406\u7f51\u7edc\u6458\u8981', en: 'Handling network summary' },
  apiAdapterReplay: { zh: '\u9a8c\u8bc1 API adapter replay', en: 'Verifying API adapter replay' },
  buildSiteGraph: { zh: '\u6784\u5efa\u7ad9\u70b9\u56fe\u8c31', en: 'Building site graph' },
  classifyNodes: { zh: '\u5206\u7c7b\u7ad9\u70b9\u8282\u70b9', en: 'Classifying site nodes' },
  extractAffordances: { zh: '\u63d0\u53d6\u53ef\u64cd\u4f5c\u9879', en: 'Extracting affordances' },
  discoverCapabilities: { zh: '\u53d1\u73b0\u7ad9\u70b9\u80fd\u529b', en: 'Discovering capabilities' },
  generateIntents: { zh: '\u751f\u6210\u610f\u56fe\u5165\u53e3', en: 'Generating intents' },
  compileExecutionContracts: { zh: '\u7f16\u8bd1\u6267\u884c\u5951\u7ea6', en: 'Compiling execution contracts' },
  evaluateExecutionGovernance: { zh: '\u8bc4\u4f30\u6267\u884c\u6cbb\u7406', en: 'Evaluating execution governance' },
  dispatchGovernedRuntime: { zh: '\u51c6\u5907\u53d7\u6cbb\u7406\u8fd0\u884c\u65f6', en: 'Preparing governed runtime' },
  generateSkill: { zh: '\u751f\u6210 SiteForge Skill', en: 'Generating SiteForge Skill' },
  verifySkill: { zh: '\u9a8c\u8bc1 Skill', en: 'Verifying Skill' },
  registerSkill: { zh: '\u6ce8\u518c Skill', en: 'Registering Skill' },
  writeBuildReport: { zh: '\u5199\u5165\u6784\u5efa\u62a5\u544a', en: 'Writing build report' },
});

export function siteForgeBuildStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(SITEFORGE_BUILD_STAGE_COPY[stageId], language) || String(stageId ?? '');
}
