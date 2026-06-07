// @ts-check

import { assertCapabilityPackageManifestValid } from './capability-package-validator.mjs';

export function resolvePackageExecutionContractRef(manifest = {}, executionContractRef) {
  const safeManifest = assertCapabilityPackageManifestValid(manifest);
  const ref = String(executionContractRef ?? '').trim();
  const contract = safeManifest.executionContracts.find((entry) => (
    entry.executionContractRef === ref || entry.sourceExecutionContractId === ref
  ));
  return contract ? { found: true, contract, packageId: safeManifest.packageId, version: safeManifest.version } : {
    found: false,
    reasonCode: 'capability_package.execution_contract_ref_not_found',
    packageId: safeManifest.packageId,
    version: safeManifest.version,
  };
}
