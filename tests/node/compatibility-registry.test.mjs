import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSchemaCompatible,
  getCompatibilitySchema,
  listCompatibilitySchemas,
} from '../../src/sites/capability/compatibility-registry.mjs';
import {
  getSchemaInventoryEntry,
  listMissingSchemas,
} from '../../src/sites/capability/schema-inventory.mjs';
import {
  CAPABILITY_HOOK_EVENT_TYPES,
  CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
  createCapabilityHookEventTypeRegistry,
  createCapabilityHookProducerDescriptorRegistry,
  createCapabilityHookRegistrySnapshot,
} from '../../src/sites/capability/capability-hook.mjs';
import { createFocusedRegressionBatchDefinitionFixture } from '../../src/sites/capability/focused-regression-batches.mjs';
import {
  normalizeArtifactReferenceSet,
  normalizeManifestArtifactBundle,
} from '../../src/sites/capability/artifact-schema.mjs';
import { listReasonCodeDefinitions } from '../../src/sites/capability/reason-codes.mjs';

const REGISTERED_SCHEMA_NAMES = [
  'ApiCandidate',
  'ApiCatalogEntry',
  'ApiCatalog',
  'ApiCatalogIndex',
  'ApiResponseCaptureSummary',
  'SiteAdapterCandidateDecision',
  'SiteAdapterCatalogUpgradePolicy',
  'reasonCode',
  'SessionView',
  'DownloadPolicy',
  'StandardTaskList',
  'RiskState',
  'CapabilityHook',
  'CapabilityHookEventTypeRegistry',
  'CapabilityHookProducerDescriptorRegistry',
  'CapabilityHookRegistrySnapshot',
  'LifecycleEvent',
  'FocusedRegressionBatchDefinition',
  'ArtifactReferenceSet',
  'ManifestArtifactBundle',
];

function compatiblePayloadFor(schema) {
  if (schema.name === 'CapabilityHookEventTypeRegistry') {
    return createCapabilityHookEventTypeRegistry();
  }
  if (schema.name === 'CapabilityHookProducerDescriptorRegistry') {
    return createCapabilityHookProducerDescriptorRegistry();
  }
  if (schema.name === 'CapabilityHookRegistrySnapshot') {
    return createCapabilityHookRegistrySnapshot([{
      phase: 'on_completion',
      subscriber: {
        name: 'synthetic-completion-observer',
      },
    }]);
  }
  if (schema.name === 'FocusedRegressionBatchDefinition') {
    return createFocusedRegressionBatchDefinitionFixture();
  }
  if (schema.name === 'ArtifactReferenceSet') {
    return normalizeArtifactReferenceSet({
      manifest: 'runs/synthetic/manifest.json',
      source: {
        diagnostic: 'runs/synthetic/diagnostic.json',
      },
    });
  }
  if (schema.name === 'ManifestArtifactBundle') {
    return normalizeManifestArtifactBundle({
      manifestName: 'SyntheticManifest',
      manifestSchemaVersion: 1,
      manifestPath: 'runs/synthetic/manifest.json',
      artifacts: {
        manifest: 'runs/synthetic/manifest.json',
        redactionAudit: 'runs/synthetic/redaction-audit.json',
      },
    });
  }
  if (schema.name === 'reasonCode') {
    return {
      schemaVersion: schema.version,
      entries: listReasonCodeDefinitions(),
    };
  }
  return { schemaVersion: schema.version };
}

test('compatibility registry exposes current core schema versions', () => {
  const schemas = listCompatibilitySchemas();
  assert.deepEqual(schemas.map((entry) => entry.name), REGISTERED_SCHEMA_NAMES);
  for (const schema of schemas) {
    assert.equal(typeof schema.version, 'number');
    assert.match(schema.sourcePath, /^src\/sites\/capability\//u);
    assert.equal(Object.hasOwn(schema, 'assertCompatible'), false);
  }
});

test('compatibility registry accepts current schema payload versions', () => {
  for (const schema of listCompatibilitySchemas()) {
    assert.equal(assertSchemaCompatible(schema.name, compatiblePayloadFor(schema)), true);
  }
});

test('compatibility registry rejects CapabilityHook producer inventory drift centrally', () => {
  const current = createCapabilityHookEventTypeRegistry();
  assert.equal(assertSchemaCompatible('CapabilityHookEventTypeRegistry', current), true);

  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES, 'download.secret.internal'],
    }),
    /Unsupported CapabilityHook eventType/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: CAPABILITY_HOOK_EVENT_TYPES.slice(1),
    }),
    /must match current runtime producer inventory/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookEventTypeRegistry', {
      ...current,
      eventTypes: [...CAPABILITY_HOOK_EVENT_TYPES].reverse(),
    }),
    /must match current runtime producer inventory/u,
  );
});

test('compatibility registry rejects CapabilityHook producer descriptor inventory drift centrally', () => {
  const current = createCapabilityHookProducerDescriptorRegistry();
  assert.equal(assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', current), true);

  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: current.producers.filter((producer) => producer.eventType !== 'download.run.terminal'),
    }),
    /must include high-risk producer descriptor: download\.run\.terminal/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: [
        ...current.producers,
        {
          ...current.producers[0],
          producerId: 'duplicate-session-runner',
        },
      ],
    }),
    /Duplicate CapabilityHook producer descriptor eventType: session\.run\.completed/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      descriptorPolicy: {
        ...CAPABILITY_HOOK_PRODUCER_DESCRIPTOR_POLICY,
        rawSessionPayloadsAllowed: true,
      },
    }),
    /descriptor-only and fail closed/u,
  );
  assert.throws(
    () => assertSchemaCompatible('CapabilityHookProducerDescriptorRegistry', {
      ...current,
      producers: current.producers.map((producer) => (
        producer.eventType === 'social.action.risk_blocked'
          ? { ...producer, browserProfilePath: 'synthetic-profile-path' }
          : producer
      )),
    }),
    /raw sensitive material field/u,
  );
});

test('compatibility registry rejects invalid ArtifactReferenceSet payloads centrally', () => {
  assert.equal(assertSchemaCompatible('ArtifactReferenceSet', normalizeArtifactReferenceSet({
    manifest: 'runs/synthetic/manifest.json',
  })), true);
  assert.throws(
    () => assertSchemaCompatible('ArtifactReferenceSet', {
      schemaVersion: 1,
      manifest: ['runs/synthetic/manifest.json'],
    }),
    /artifacts\.manifest must be a string artifact reference/u,
  );
  assert.throws(
    () => assertSchemaCompatible('ArtifactReferenceSet', {
      schemaVersion: 1,
      source: {
        diagnostic: 123,
      },
    }),
    /artifacts\.source\.diagnostic must be a string artifact reference/u,
  );
});

test('compatibility registry rejects unknown schemas and incompatible versions', () => {
  assert.throws(
    () => assertSchemaCompatible('UnknownSchema', { schemaVersion: 1 }),
    /Unknown compatibility schema/u,
  );
  assert.throws(
    () => assertSchemaCompatible('', { schemaVersion: 1 }),
    /Unknown compatibility schema/u,
  );

  for (const schema of listCompatibilitySchemas()) {
    assert.throws(
      () => assertSchemaCompatible(schema.name, { schemaVersion: schema.version + 1 }),
      /not compatible/u,
    );
    assert.throws(
      () => assertSchemaCompatible(schema.name, {}),
      /schemaVersion is required/u,
    );
  }
});

test('compatibility registry metadata matches schema inventory for core schemas', () => {
  assert.deepEqual(listMissingSchemas(), []);
  for (const schemaName of REGISTERED_SCHEMA_NAMES) {
    const registryEntry = getCompatibilitySchema(schemaName);
    const inventoryEntry = getSchemaInventoryEntry(schemaName);
    assert.notEqual(registryEntry, null);
    assert.notEqual(inventoryEntry, null);
    assert.equal(registryEntry.version, inventoryEntry.version);
    assert.equal(registryEntry.sourcePath, inventoryEntry.sourcePath);
    assert.notEqual(inventoryEntry.status, 'missing');
  }
});
