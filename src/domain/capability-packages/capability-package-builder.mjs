// @ts-check

import {
  createCapabilityGraphDigest,
  sanitizeCapabilityGraphForRegistry,
} from '../capabilities/graph-registry/index.mjs';
import { createCapabilityPackageDigest } from './capability-package-digest.mjs';
import { createCapabilityPackageProvenance } from './capability-package-provenance.mjs';
import {
  assertCapabilityPackageManifestValid,
  sanitizeCapabilityPackageManifest,
} from './capability-package-validator.mjs';
import { CAPABILITY_PACKAGE_SCHEMA_VERSION } from './capability-package-schema.mjs';

function cleanSegment(value, fallback = 'unknown') {
  return String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/^site:/u, '')
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || fallback;
}

function siteKeyFromGraph(graph = {}) {
  const siteNode = (graph.nodes ?? []).find((node) => node.type === 'SiteNode');
  return cleanSegment(siteNode?.siteKey ?? graph.manifest?.siteKey ?? graph.graphVersion, 'unknown');
}

function siteOriginFromGraph(graph = {}, options = {}) {
  if (options.siteOrigin) return String(options.siteOrigin);
  return `https://${siteKeyFromGraph(graph)}`;
}

function providerCompatibilityForContract(contract = {}) {
  if (Array.isArray(contract.providerCompatibility) && contract.providerCompatibility.length > 0) {
    return contract.providerCompatibility;
  }
  if (Array.isArray(contract.providerCompatibilityHints) && contract.providerCompatibilityHints.length > 0) {
    return contract.providerCompatibilityHints;
  }
  if (contract.operationKind === 'download') return ['download_provider'];
  if (contract.operationKind === 'form_or_action') return ['browser_action_provider'];
  return ['api_read_provider'];
}

function riskLevelFor(capability = {}, contract = {}, governance = {}) {
  if (contract.paymentOrFundsAction === true || governance.paymentConfirmationRequired === true) return 'payment';
  if (contract.destructiveAction === true || governance.destructiveConfirmationRequired === true) return 'destructive';
  if (contract.highRiskAction === true || capability.requiresApproval === true || contract.operationKind === 'form_or_action') return 'ordinary_write';
  if (capability.requiresAuth === true || contract.authRequirementRef) return 'auth_read';
  return 'public_read';
}

function completionSignalsFor(contract = {}) {
  if (Array.isArray(contract.completionSignals)) return contract.completionSignals;
  if (contract.completionSignal?.kind) return [contract.completionSignal.kind];
  if (Array.isArray(contract.completionSignalRefs)) return contract.completionSignalRefs;
  return [];
}

function requiredSlotNamesFor(contract = {}) {
  if (Array.isArray(contract.payloadTemplate?.requiredSlotNames)) return contract.payloadTemplate.requiredSlotNames;
  if (Array.isArray(contract.browserActionDescriptor?.requiredSlots)) return contract.browserActionDescriptor.requiredSlots;
  if (Array.isArray(contract.slotSchema)) return contract.slotSchema.map((slot) => slot.name).filter(Boolean);
  if (Array.isArray(contract.payloadTemplate?.slotBindings)) {
    return contract.payloadTemplate.slotBindings.map((slot) => slot.slotName ?? slot.name).filter(Boolean);
  }
  return [];
}

function packageContractRef(packageId, version, capabilityKey) {
  return `${packageId}/contract/${capabilityKey}@${version}`;
}

function packageCapabilityRef(packageId, version, capabilityKey) {
  return `${packageId}/${capabilityKey}@${version}`;
}

export function buildCapabilityPackageFromGraph(graph = {}, options = {}) {
  const safeGraph = sanitizeCapabilityGraphForRegistry(graph);
  const siteKey = cleanSegment(options.siteKey ?? siteKeyFromGraph(safeGraph), 'unknown');
  const packageId = cleanSegment(options.packageId, `sitepkg:${siteKey}`);
  const version = String(options.version ?? '1.0.0');
  const graphDigest = createCapabilityGraphDigest(safeGraph);
  const nodeById = new Map((safeGraph.nodes ?? []).map((node) => [node.id, node]));
  const contractsByCapability = new Map();
  for (const node of safeGraph.nodes ?? []) {
    if (node.type === 'ExecutionContractNode' && node.capabilityRef) {
      contractsByCapability.set(node.capabilityRef, node);
    }
  }

  const capabilities = [];
  const executionContracts = [];
  for (const capability of (safeGraph.nodes ?? []).filter((node) => node.type === 'CapabilityNode')) {
    const capabilityKey = cleanSegment(capability.capabilityKey ?? capability.id, 'capability');
    const capabilityRef = packageCapabilityRef(packageId, version, capabilityKey);
    const contract = contractsByCapability.get(capability.id) ?? {};
    const contractRef = packageContractRef(packageId, version, capabilityKey);
    const governance = nodeById.get(contract.governancePolicyRef) ?? {};
    const authRequired = capability.requiresAuth === true || Boolean(contract.authRequirementRef);
    const risk = riskLevelFor(capability, contract, governance);
    const providerCompatibility = providerCompatibilityForContract(contract);
    const policyRequirements = {
      executionGates: contract.executionGates ?? governance.executionGates ?? [],
      auditRequired: contract.auditPolicy?.required === true || governance.auditRequired === true,
      confirmationRequired: contract.confirmationPolicy?.required === true || governance.confirmationRequired === true,
      strongConfirmationRequired: contract.confirmationPolicy?.strongConfirmationRequired === true || governance.strongConfirmationRequired === true,
      sitePolicyExplicitAllowRequired: contract.executionPrerequisites?.sitePolicyExplicitAllowRequired === true || governance.sitePolicyExplicitAllowRequired === true,
    };
    capabilities.push({
      capabilityRef,
      capabilityId: capabilityKey,
      sourceCapabilityId: capability.id,
      kind: contract.operationKind === 'navigate' ? 'navigate' : contract.operationKind ?? (capability.mode === 'download' ? 'download' : 'api_read'),
      risk,
      executionContractRef: contractRef,
      providerCompatibility,
      authRequirement: {
        required: authRequired,
        scopes: contract.authScopes ?? capability.authScopes ?? [],
      },
      riskClassification: {
        level: risk,
        destructive: risk === 'destructive',
        payment: risk === 'payment',
        sideEffecting: ['ordinary_write', 'destructive', 'payment'].includes(risk),
      },
      policyRequirements,
      runtimeCallable: contract.runtimeCallable === true && !['destructive', 'payment'].includes(risk),
      executableByDefault: contract.autoExecutable === true && !['destructive', 'payment'].includes(risk),
      skillCallable: true,
    });
    executionContracts.push({
      executionContractRef: contractRef,
      sourceExecutionContractId: contract.id,
      capabilityRef,
      kind: contract.operationKind === 'navigate' ? 'navigate' : contract.operationKind ?? 'api_read',
      concreteEnough: contract.executionContractConcrete === true || contract.concreteEnough === true || contract.runtimeCallable === true,
      selectorConfidence: contract.selectorConfidence ?? contract.selectorStabilityScore ?? null,
      completionSignals: completionSignalsFor(contract),
      providerCompatibility,
      payloadTemplate: {
        requiredSlotNames: requiredSlotNamesFor(contract),
      },
      policyRequirements,
      runtimeBindingRef: contract.runtimeBindingRef,
    });
  }
  const provenance = createCapabilityPackageProvenance(safeGraph, {
    ...options,
    graphDigest,
  });
  const manifest = sanitizeCapabilityPackageManifest({
    schemaVersion: CAPABILITY_PACKAGE_SCHEMA_VERSION,
    packageId,
    version,
    siteOrigin: siteOriginFromGraph(safeGraph, options),
    graphDigest,
    capabilities,
    executionContracts,
    provenance,
    auditMetadata: {
      packageId,
      version,
      graphDigest,
      redactionRequired: true,
    },
  });
  const packageDigest = createCapabilityPackageDigest(manifest);
  return assertCapabilityPackageManifestValid({
    ...manifest,
    packageDigest,
    auditMetadata: {
      ...manifest.auditMetadata,
      packageDigest,
    },
  });
}
