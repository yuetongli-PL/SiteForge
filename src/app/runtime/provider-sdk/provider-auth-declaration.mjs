// @ts-check

import {
  createProviderSdkFinding,
} from './provider-sdk-errors.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';

const ALLOWED_AUTH_MATERIAL_TYPES = Object.freeze(new Set([
  'redacted-login-state-descriptor',
  'ephemeral-http-auth',
  'browser-context-cookie-descriptor',
]));

export function validateProviderAuthDeclaration(manifest = {}, options = {}) {
  const report = validateProviderManifest(manifest, options);
  const findings = [...report.findings];
  if (report.manifest.runtimeServices.requiresSessionMaterial === true) {
    findings.push(createProviderSdkFinding(
      'provider.auth_direct_session_material_forbidden',
      'Provider must use runtime auth adapter declarations instead of direct SessionVault material.',
    ));
  }
  for (const materialType of report.manifest.riskProfile.allowedAuthMaterialTypes) {
    if (!ALLOWED_AUTH_MATERIAL_TYPES.has(materialType)) {
      findings.push(createProviderSdkFinding(
        'provider.auth_material_type_forbidden',
        'Provider auth material declaration is unsupported.',
        { materialType },
      ));
    }
  }
  return {
    ok: findings.length === 0,
    findings,
    authRequired: report.manifest.riskProfile.requiresAuthAdapter,
  };
}

