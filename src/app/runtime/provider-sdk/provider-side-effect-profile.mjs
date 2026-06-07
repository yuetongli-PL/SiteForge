// @ts-check

import {
  createProviderSdkFinding,
} from './provider-sdk-errors.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';

export function validateProviderSideEffectProfile(manifest = {}, options = {}) {
  const report = validateProviderManifest(manifest, options);
  const findings = [...report.findings];
  const sideEffects = report.manifest.riskProfile.sideEffects;
  if (report.manifest.runtimeServices.requiresSessionMaterial === true) {
    findings.push(createProviderSdkFinding(
      'provider.session_material_service_forbidden',
      'Provider SDK does not expose direct session material services.',
    ));
  }
  if (options.production === true && ['payment', 'destructive'].includes(sideEffects)) {
    findings.push(createProviderSdkFinding(
      `provider.${sideEffects}_production_registration_forbidden`,
      `${sideEffects} providers are not production-registered by default.`,
    ));
  }
  return {
    ok: findings.length === 0,
    sideEffects,
    findings,
  };
}

