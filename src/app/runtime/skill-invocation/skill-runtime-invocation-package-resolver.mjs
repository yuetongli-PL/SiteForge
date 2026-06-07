// @ts-check

import {
  resolvePackageCapabilityRef,
  resolvePackageExecutionContractRef,
} from '../../../domain/capability-packages/index.mjs';
import {
  assertNoSkillInvocationRawMaterial,
  safeSkillInvocationRef,
} from './skill-runtime-invocation-sanitizer.mjs';
import {
  assertSkillRuntimeInvocationRequestValid,
} from './skill-runtime-invocation-validator.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {Record<string, any>} options */
export function resolveSkillInvocationPackageRefs({ packageManifest = null, request } = {}) {
  const safeRequest = assertSkillRuntimeInvocationRequestValid(request);
  if (!packageManifest) {
    return {
      ok: false,
      found: false,
      reasonCode: 'skill_invocation.package_manifest_required',
      capabilityRef: safeRequest.capabilityRef,
      executionContractRef: safeRequest.executionContractRef,
      redactionRequired: true,
    };
  }
  const capabilityResult = resolvePackageCapabilityRef(packageManifest, safeRequest.capabilityRef);
  const contractResult = resolvePackageExecutionContractRef(packageManifest, safeRequest.executionContractRef);
  const contractMatchesCapability = capabilityResult.found === true
    && contractResult.found === true
    && contractResult.contract.capabilityRef === capabilityResult.capability.capabilityRef;
  const resolved = {
    ok: capabilityResult.found === true && contractResult.found === true && contractMatchesCapability,
    found: capabilityResult.found === true && contractResult.found === true && contractMatchesCapability,
    reasonCode: capabilityResult.found !== true
      ? capabilityResult.reasonCode
      : contractResult.found !== true
        ? contractResult.reasonCode
        : contractMatchesCapability
          ? 'skill_invocation.package_refs_resolved'
          : 'skill_invocation.contract_capability_mismatch',
    packageId: safeSkillInvocationRef(packageManifest.packageId, capabilityResult.packageId ?? ''),
    packageVersion: safeSkillInvocationRef(packageManifest.version, capabilityResult.version ?? ''),
    siteOrigin: packageManifest.siteOrigin ?? '',
    capabilityRef: safeRequest.capabilityRef,
    executionContractRef: safeRequest.executionContractRef,
    capability: capabilityResult.found === true ? clone(capabilityResult.capability) : null,
    executionContract: contractResult.found === true ? clone(contractResult.contract) : null,
    redactionRequired: true,
  };
  assertNoSkillInvocationRawMaterial(resolved);
  return resolved;
}
