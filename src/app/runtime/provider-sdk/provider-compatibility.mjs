// @ts-check

import {
  createProviderSdkFinding,
} from './provider-sdk-errors.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';

export function validateProviderRuntimeCompatibility(manifest = {}, services = {}, options = {}) {
  const report = validateProviderManifest(manifest, options);
  const findings = [...report.findings];
  if (report.manifest.runtimeServices.requiresBrowserRuntime === true && services.controlledBrowserRuntime !== true) {
    findings.push(createProviderSdkFinding(
      'provider.controlled_browser_runtime_required',
      'Provider requiring browser runtime can only run with controlled browser runtime service.',
    ));
  }
  if (report.manifest.riskProfile.requiresAuthAdapter === true && services.authAdapter !== true) {
    findings.push(createProviderSdkFinding(
      'provider.auth_adapter_required',
      'Provider requiring auth material can only run through the runtime auth adapter.',
    ));
  }
  if (report.manifest.runtimeServices.requiresOutputWriter === true && services.outputWriter !== true) {
    findings.push(createProviderSdkFinding(
      'provider.output_writer_required',
      'Provider requiring output writes needs a runtime output writer service.',
    ));
  }
  return {
    ok: findings.length === 0,
    findings,
  };
}

