// @ts-check

import {
  createProviderSdkFinding,
  ProviderSdkValidationError,
} from './provider-sdk-errors.mjs';
import {
  validateProviderAuthDeclaration,
} from './provider-auth-declaration.mjs';
import {
  validateRuntimeProviderInterface,
} from './provider-interface.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';
import {
  validateProviderRiskProfile,
} from './provider-risk-profile.mjs';
import {
  validateProviderSideEffectProfile,
} from './provider-side-effect-profile.mjs';

export function validateProviderRegistration(provider = {}, options = {}) {
  const production = options.production === true;
  const findings = [];
  const interfaceReport = validateRuntimeProviderInterface(provider, {
    ...options,
    requireManifest: production || options.requireManifest === true,
  });
  findings.push(...interfaceReport.findings);

  const manifestReport = validateProviderManifest(provider.manifest, { production });
  const riskReport = validateProviderRiskProfile(provider.manifest, { production });
  const sideEffectReport = validateProviderSideEffectProfile(provider.manifest, { production });
  const authReport = validateProviderAuthDeclaration(provider.manifest, { production });
  findings.push(...manifestReport.findings, ...riskReport.findings, ...sideEffectReport.findings, ...authReport.findings);

  const sideEffects = manifestReport.manifest.riskProfile.sideEffects;
  if (production && sideEffects === 'payment' && options.allowPaymentProviders !== true) {
    findings.push(createProviderSdkFinding(
      'provider.payment_production_registration_forbidden',
      'Payment providers are not registered in production by default.',
    ));
  }
  if (production && sideEffects === 'destructive' && options.allowDestructiveProviders !== true) {
    findings.push(createProviderSdkFinding(
      'provider.destructive_production_registration_forbidden',
      'Destructive providers are not registered in production by default.',
    ));
  }

  const uniqueFindings = [...new Map(findings.map((finding) => [finding.reasonCode, finding])).values()];
  return {
    ok: uniqueFindings.length === 0,
    providerId: manifestReport.manifest.providerId || provider.id || provider.providerId || null,
    manifest: manifestReport.manifest,
    findings: uniqueFindings,
  };
}

export function assertProviderRegistrationValid(provider = {}, options = {}) {
  const report = validateProviderRegistration(provider, options);
  if (!report.ok) {
    throw new ProviderSdkValidationError(report.findings[0].message, {
      code: report.findings[0].reasonCode,
      details: { providerId: report.providerId, findings: report.findings },
    });
  }
  return true;
}

