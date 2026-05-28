// @ts-check

import {
  DEFAULT_PROGRESS_LANGUAGE,
  progressText,
} from '../../infra/cli/progress-copy.mjs';

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

export function doctorStageTitle(stageId, language = DEFAULT_PROGRESS_LANGUAGE) {
  return progressText(DOCTOR_STAGE_COPY[stageId], language) || String(stageId ?? '');
}
