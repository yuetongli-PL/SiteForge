// @ts-check

import {
  createProviderSdkFinding,
} from './provider-sdk-errors.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';

export function validateProviderRiskProfile(manifest = {}, options = {}) {
  const report = validateProviderManifest(manifest, options);
  const findings = [...report.findings];
  const sideEffects = report.manifest.riskProfile.sideEffects;
  if (options.production === true && ['payment', 'destructive'].includes(sideEffects)) {
    findings.push(createProviderSdkFinding(
      `provider.${sideEffects}_side_effect_forbidden`,
      `Provider with ${sideEffects} side effects cannot be registered in production by default.`,
    ));
  }
  return {
    ok: findings.length === 0,
    sideEffects,
    findings,
  };
}

