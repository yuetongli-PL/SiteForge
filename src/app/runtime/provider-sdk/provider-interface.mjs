// @ts-check

import {
  createProviderSdkFinding,
} from './provider-sdk-errors.mjs';
import {
  validateProviderManifest,
} from './provider-manifest.mjs';

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateRuntimeProviderInterface(provider = {}, options = {}) {
  const findings = [];
  if (!isPlainObject(provider)) {
    findings.push(createProviderSdkFinding('provider.interface.object_required', 'Runtime provider must be a plain object.'));
    return { ok: false, findings };
  }
  if (!provider.id && !provider.providerId) {
    findings.push(createProviderSdkFinding('provider.interface.provider_id_required', 'Runtime provider id/providerId is required.'));
  }
  for (const methodName of ['supports', 'canExecute', 'run']) {
    if (typeof provider[methodName] !== 'function') {
      findings.push(createProviderSdkFinding(
        'provider.interface.method_required',
        `Runtime provider must expose ${methodName}().`,
        { methodName },
      ));
    }
  }
  if (options.requireManifest === true || provider.manifest !== undefined) {
    const manifestReport = validateProviderManifest(provider.manifest, options);
    findings.push(...manifestReport.findings);
    if (manifestReport.manifest.providerId && provider.id && manifestReport.manifest.providerId !== provider.id) {
      findings.push(createProviderSdkFinding(
        'provider.interface.provider_id_mismatch',
        'Provider id must match manifest providerId.',
      ));
    }
  }
  return {
    ok: findings.length === 0,
    findings,
  };
}

