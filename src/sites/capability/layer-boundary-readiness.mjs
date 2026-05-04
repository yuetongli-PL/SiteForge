// @ts-check

import {
  LAYER_IDS,
  assertLayerBoundary,
  assertLayerBoundaryRegistryComplete,
  assertLayerCrossing,
  listLayerBoundaries,
  listLayerCrossings,
} from './layer-boundaries.mjs';
import {
  assertCapabilityServiceInventoryArchitecture,
  listCapabilityServiceInventory,
} from './service-inventory.mjs';

export const LAYER_BOUNDARY_READINESS_SCHEMA_VERSION = 1;

export const REQUIRED_LAYER_BOUNDARY_CROSSINGS = Object.freeze([
  'Kernel->CapabilityService',
  'CapabilityService->Kernel',
  'Kernel->SiteAdapter',
  'SiteAdapter->Kernel',
  'CapabilityService->SiteAdapter',
  'SiteAdapter->CapabilityService',
  'Kernel->downloader',
  'CapabilityService->downloader',
]);

const FORBIDDEN_LAYER_BOUNDARY_CROSSINGS = Object.freeze([
  'downloader->SiteAdapter',
]);

function crossingKey(crossing) {
  return `${String(crossing?.from ?? crossing?.source ?? '').trim()}->${String(crossing?.to ?? crossing?.target ?? '').trim()}`;
}

function indexById(records, fieldName) {
  const index = new Map();
  for (const record of records) {
    const id = String(record?.[fieldName] ?? '').trim();
    if (!id) {
      throw new Error(`LayerBoundary readiness ${fieldName} is required`);
    }
    if (index.has(id)) {
      throw new Error(`LayerBoundary readiness duplicate ${fieldName}: ${id}`);
    }
    index.set(id, record);
  }
  return index;
}

function assertRequiredLayers(boundaries, requiredLayers) {
  const boundaryById = indexById(boundaries, 'id');
  for (const layerId of requiredLayers) {
    const boundary = boundaryById.get(layerId);
    if (!boundary) {
      throw new Error(`LayerBoundary readiness is missing required layer: ${layerId}`);
    }
    assertLayerBoundary(boundary);
  }
  return boundaryById;
}

function readinessCrossingForAssertion(crossing) {
  return {
    from: crossing.from ?? crossing.source,
    to: crossing.to ?? crossing.target,
    purpose: crossing.purpose,
    controls: crossing.controls ?? crossing.requiredControls ?? [],
  };
}

function assertRequiredCrossings(crossings, requiredCrossings) {
  const crossingByKey = new Map();
  for (const crossing of crossings) {
    const key = crossingKey(crossing);
    if (FORBIDDEN_LAYER_BOUNDARY_CROSSINGS.includes(key)) {
      throw new Error(`LayerBoundary readiness forbids reverse crossing: ${key}`);
    }
    if (crossingByKey.has(key)) {
      throw new Error(`LayerBoundary readiness duplicate crossing: ${key}`);
    }
    crossingByKey.set(key, crossing);
  }

  for (const key of requiredCrossings) {
    const crossing = crossingByKey.get(key);
    if (!crossing) {
      throw new Error(`LayerBoundary readiness is missing required crossing: ${key}`);
    }
    assertLayerCrossing(readinessCrossingForAssertion(crossing));
  }
}

function assertCapabilityServiceBoundaryEvidence(boundaryById, capabilityServices) {
  assertCapabilityServiceInventoryArchitecture(capabilityServices);
  const capabilityServiceBoundary = boundaryById.get('CapabilityService');
  const evidenceNames = capabilityServiceBoundary?.evidence?.serviceInventoryNames;
  if (!Array.isArray(evidenceNames) || evidenceNames.length === 0) {
    throw new Error('LayerBoundary readiness requires CapabilityService inventory evidence');
  }

  const inventoryNames = capabilityServices.map((entry) => entry.stableName).sort();
  const sortedEvidenceNames = [...evidenceNames].sort();
  if (JSON.stringify(sortedEvidenceNames) !== JSON.stringify(inventoryNames)) {
    throw new Error('LayerBoundary readiness CapabilityService inventory evidence is stale');
  }
}

export function assertLayerBoundaryReadiness({
  boundaries = listLayerBoundaries(),
  crossings = listLayerCrossings(),
  capabilityServices = listCapabilityServiceInventory(),
  requiredLayers = LAYER_IDS,
  requiredCrossings = REQUIRED_LAYER_BOUNDARY_CROSSINGS,
} = {}) {
  assertLayerBoundaryRegistryComplete(requiredLayers);
  if (!Array.isArray(boundaries) || boundaries.length === 0) {
    throw new Error('LayerBoundary readiness requires layer boundaries');
  }
  if (!Array.isArray(crossings) || crossings.length === 0) {
    throw new Error('LayerBoundary readiness requires layer crossings');
  }

  const boundaryById = assertRequiredLayers(boundaries, requiredLayers);
  assertRequiredCrossings(crossings, requiredCrossings);
  assertCapabilityServiceBoundaryEvidence(boundaryById, capabilityServices);

  return Object.freeze({
    schemaVersion: LAYER_BOUNDARY_READINESS_SCHEMA_VERSION,
    status: 'ready',
    layers: Object.freeze([...requiredLayers]),
    crossings: Object.freeze([...requiredCrossings]),
    capabilityServices: Object.freeze(capabilityServices.map((entry) => entry.stableName).sort()),
  });
}
