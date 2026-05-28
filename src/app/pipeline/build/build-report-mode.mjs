// @ts-check

import { siteForgeReportModeSet } from './artifact-contract.mjs';

const REPORT_MODES = siteForgeReportModeSet();

export function normalizeReportMode(value, fallback = 'user') {
  const mode = String(value ?? fallback).trim().toLowerCase();
  return REPORT_MODES.has(mode) ? mode : fallback;
}

export function buildReportPayloadForMode(result, options = /** @type {any} */ ({})) {
  const mode = normalizeReportMode(options.reportMode ?? options.report);
  if (mode === 'user') {
    return result.user_report ?? result.userReport ?? result;
  }
  if (mode === 'debug') {
    return result.debug_report ?? result.debugReport ?? result;
  }
  return {
    result_status: result.result_status ?? result.status ?? null,
    build_id: result.build_id ?? result.buildId ?? null,
    skill_id: result.skill_id ?? result.skillId ?? null,
    user: result.user_report ?? result.userReport ?? null,
    debug: result.debug_report ?? result.debugReport ?? null,
    index: result,
  };
}
