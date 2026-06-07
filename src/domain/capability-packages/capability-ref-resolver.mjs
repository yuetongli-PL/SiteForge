// @ts-check

import { assertCapabilityPackageManifestValid } from './capability-package-validator.mjs';

export function resolvePackageCapabilityRef(manifest = {}, capabilityRef) {
  const safeManifest = assertCapabilityPackageManifestValid(manifest);
  const ref = String(capabilityRef ?? '').trim();
  const capability = safeManifest.capabilities.find((entry) => (
    entry.capabilityRef === ref || entry.capabilityId === ref || entry.sourceCapabilityId === ref
  ));
  return capability ? { found: true, capability, packageId: safeManifest.packageId, version: safeManifest.version } : {
    found: false,
    reasonCode: 'capability_package.capability_ref_not_found',
    packageId: safeManifest.packageId,
    version: safeManifest.version,
  };
}
