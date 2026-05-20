// @ts-check

import { createBilibiliSiteDoctorScenarioSuite } from '../../known-sites/bilibili/doctor/scenarios.mjs';
import { createDouyinSiteDoctorScenarioSuite } from '../../known-sites/douyin/doctor/scenarios.mjs';
import { createInstagramSiteDoctorScenarioSuite } from '../../known-sites/instagram/doctor/scenarios.mjs';
import { createXSiteDoctorScenarioSuite } from '../../known-sites/x/doctor/scenarios.mjs';
import { createXiaohongshuSiteDoctorScenarioSuite } from '../../known-sites/xiaohongshu/doctor/scenarios.mjs';

export function resolveSiteDoctorScenarioSuite({
  siteKey = null,
  profile = null,
  helpers = {},
} = {}) {
  switch (String(siteKey ?? '')) {
    case 'bilibili':
      return createBilibiliSiteDoctorScenarioSuite({ profile, helpers });
    case 'douyin':
      return createDouyinSiteDoctorScenarioSuite({ helpers });
    case 'instagram':
      return createInstagramSiteDoctorScenarioSuite({ helpers });
    case 'x':
      return createXSiteDoctorScenarioSuite({ helpers });
    case 'xiaohongshu':
      return createXiaohongshuSiteDoctorScenarioSuite({ profile, helpers });
    default:
      return null;
  }
}
