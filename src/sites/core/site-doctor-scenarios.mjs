// @ts-check

import { createBilibiliSiteDoctorScenarioSuite } from '../bilibili/doctor/scenarios.mjs';
import { createDouyinSiteDoctorScenarioSuite } from '../douyin/doctor/scenarios.mjs';

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
    default:
      return null;
  }
}
