// @ts-check

import {
  CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION,
  CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION,
} from './capability-package-schema.mjs';
import { assertCapabilityPackageManifestValid } from './capability-package-validator.mjs';

const RISK_RANK = Object.freeze({
  public_read: 0,
  auth_read: 1,
  ordinary_write: 2,
  destructive: 3,
  payment: 4,
});

function addedValues(previous = [], next = []) {
  const previousSet = new Set(previous);
  return next.filter((value) => !previousSet.has(value));
}

function byCapabilityId(manifest) {
  return new Map(manifest.capabilities.map((capability) => [capability.capabilityId, capability]));
}

function change(kind, severity, capabilityId, details = {}) {
  return {
    kind,
    severity,
    capabilityId,
    details,
  };
}

export function diffCapabilityPackages(previousManifest = {}, nextManifest = {}) {
  const previous = assertCapabilityPackageManifestValid(previousManifest);
  const next = assertCapabilityPackageManifestValid(nextManifest);
  const previousById = byCapabilityId(previous);
  const changes = [];
  for (const nextCapability of next.capabilities) {
    const previousCapability = previousById.get(nextCapability.capabilityId);
    if (!previousCapability) {
      changes.push(change('capability_added', 'low', nextCapability.capabilityId));
      continue;
    }
    if (RISK_RANK[nextCapability.risk] > RISK_RANK[previousCapability.risk]) {
      changes.push(change('risk_widened', ['destructive', 'payment'].includes(nextCapability.risk) ? 'critical' : 'high', nextCapability.capabilityId, {
        from: previousCapability.risk,
        to: nextCapability.risk,
      }));
    }
    if (previousCapability.authRequirement.required !== true && nextCapability.authRequirement.required === true) {
      changes.push(change('auth_requirement_widened', 'high', nextCapability.capabilityId, {
        from: 'not_required',
        to: 'required',
      }));
    }
    const addedScopes = addedValues(previousCapability.authRequirement.scopes, nextCapability.authRequirement.scopes);
    if (addedScopes.length > 0) {
      changes.push(change('auth_scope_widened', 'high', nextCapability.capabilityId, { addedScopes }));
    }
    const providerAdded = addedValues(previousCapability.providerCompatibility, nextCapability.providerCompatibility);
    const providerRemoved = addedValues(nextCapability.providerCompatibility, previousCapability.providerCompatibility);
    if (providerAdded.length > 0 || providerRemoved.length > 0) {
      changes.push(change('provider_compatibility_changed', 'medium', nextCapability.capabilityId, {
        added: providerAdded,
        removed: providerRemoved,
      }));
    }
  }
  return {
    schemaVersion: CAPABILITY_PACKAGE_DIFF_SCHEMA_VERSION,
    previousPackageId: previous.packageId,
    nextPackageId: next.packageId,
    previousDigest: previous.packageDigest,
    nextDigest: next.packageDigest,
    changes,
    highRiskChangeCount: changes.filter((entry) => ['high', 'critical'].includes(entry.severity)).length,
    redactionRequired: true,
  };
}

export function assessCapabilityPackageCompatibility(previousManifest = {}, nextManifest = {}) {
  const diff = diffCapabilityPackages(previousManifest, nextManifest);
  const blockingChanges = diff.changes.filter((entry) => ['risk_widened', 'auth_requirement_widened', 'auth_scope_widened'].includes(entry.kind));
  return {
    schemaVersion: CAPABILITY_PACKAGE_COMPATIBILITY_SCHEMA_VERSION,
    compatible: blockingChanges.length === 0,
    result: blockingChanges.length === 0 ? 'compatible' : 'review_required',
    blockingChanges,
    diff,
    redactionRequired: true,
  };
}
