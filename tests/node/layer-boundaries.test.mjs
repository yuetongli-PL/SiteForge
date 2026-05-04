import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYER_BOUNDARY_SCHEMA_VERSION,
  LAYER_IDS,
  assertLayerBoundary,
  assertLayerBoundaryRegistryComplete,
  assertLayerCrossing,
  assertLayerResponsibility,
  getLayerBoundary,
  listLayerBoundaries,
  listLayerCrossings,
  normalizeLayerCrossing,
} from '../../src/sites/capability/layer-boundaries.mjs';
import {
  LAYER_BOUNDARY_READINESS_SCHEMA_VERSION,
  assertLayerBoundaryReadiness,
} from '../../src/sites/capability/layer-boundary-readiness.mjs';

test('LayerBoundary registry declares the required Section 3 layers', () => {
  assert.equal(LAYER_BOUNDARY_SCHEMA_VERSION, 1);
  assert.equal(assertLayerBoundaryRegistryComplete(), true);
  assert.deepEqual(
    listLayerBoundaries().map((boundary) => boundary.id),
    LAYER_IDS,
  );
  assert.deepEqual(LAYER_IDS, [
    'Kernel',
    'CapabilityService',
    'SiteAdapter',
    'downloader',
  ]);

  for (const layerId of LAYER_IDS) {
    const boundary = getLayerBoundary(layerId);
    assert.equal(assertLayerBoundary(boundary), true);
    assert.equal(boundary.schemaVersion, LAYER_BOUNDARY_SCHEMA_VERSION);
    assert.ok(boundary.owner);
    assert.ok(boundary.role);
    assert.ok(boundary.allowedResponsibilities.length > 0);
    assert.ok(boundary.forbiddenResponsibilities.length > 0);
    assert.ok(boundary.crossingControls.length > 0);
  }
});

test('downloader boundary forbids concrete site semantics and raw session material', () => {
  const downloader = getLayerBoundary('downloader');
  assert.equal(downloader.siteSemanticsPolicy, 'forbidden');
  assert.match(
    downloader.forbiddenResponsibilities.join('\n'),
    /concrete site page interpretation/u,
  );
  assert.match(
    downloader.forbiddenResponsibilities.join('\n'),
    /raw credential or browser profile handling/u,
  );

  assert.throws(
    () => assertLayerResponsibility({
      layerId: 'downloader',
      responsibility: 'validate bilibili endpoint semantics before executing a download',
    }),
    /crosses a forbidden boundary/u,
  );
  assert.throws(
    () => assertLayerResponsibility({
      layerId: 'downloader',
      responsibility: 'handle raw session cookies for transfer retry',
    }),
    /crosses a forbidden boundary/u,
  );
});

test('Kernel boundary forbids concrete site logic', () => {
  const kernel = getLayerBoundary('Kernel');
  assert.equal(kernel.siteSemanticsPolicy, 'forbidden');
  assert.match(
    kernel.forbiddenResponsibilities.join('\n'),
    /concrete site page interpretation/u,
  );

  assert.throws(
    () => assertLayerResponsibility({
      layerId: 'Kernel',
      responsibility: 'inline douyin page type detection in the orchestrator',
    }),
    /crosses a forbidden boundary/u,
  );
  assert.throws(
    () => assertLayerBoundary({
      ...kernel,
      allowedResponsibilities: [
        ...kernel.allowedResponsibilities,
        'bilibili endpoint validation',
      ],
    }),
    /crosses a forbidden boundary/u,
  );
});

test('LayerBoundary crossing helper records required controls for downloader handoff', () => {
  const crossing = assertLayerCrossing({
    from: 'Kernel',
    to: 'downloader',
    purpose: 'standard task list download handoff',
    controls: [
      'schema-compatible',
      'policy-gated',
      'permission-checked',
      'minimized',
    ],
  });

  assert.deepEqual(crossing, {
    schemaVersion: 1,
    from: 'Kernel',
    to: 'downloader',
    purpose: 'standard task list download handoff',
    controls: [
      'minimized',
      'permission-checked',
      'policy-gated',
      'schema-compatible',
    ],
    requiredControls: [
      'minimized',
      'permission-checked',
      'policy-gated',
      'schema-compatible',
    ],
    allowedMaterial: [
      'StandardTaskList',
      'DownloadPolicy',
      'SessionView',
      'resolved resource reference',
    ],
  });
});

test('LayerBoundary crossings fail closed for unknown routes and missing controls', () => {
  assert.throws(
    () => normalizeLayerCrossing({
      from: 'downloader',
      to: 'SiteAdapter',
      controls: ['schema-compatible'],
    }),
    /Unknown LayerBoundary crossing/u,
  );
  assert.throws(
    () => normalizeLayerCrossing({
      from: 'UnknownLayer',
      to: 'Kernel',
      controls: ['schema-compatible'],
    }),
    /Unknown LayerBoundary from/u,
  );
  assert.throws(
    () => assertLayerCrossing({
      from: 'CapabilityService',
      to: 'downloader',
      controls: ['schema-compatible'],
    }),
    /missing required controls: minimized, permission-checked, redacted/u,
  );
  assert.throws(
    () => normalizeLayerCrossing({
      from: 'Kernel',
      to: 'CapabilityService',
      controls: ['trusted'],
    }),
    /Unsupported LayerBoundary crossing control/u,
  );
});

test('LayerBoundary readiness gate consumes layer registry, crossings, and CapabilityService evidence', () => {
  const readiness = assertLayerBoundaryReadiness();

  assert.equal(readiness.schemaVersion, LAYER_BOUNDARY_READINESS_SCHEMA_VERSION);
  assert.equal(readiness.status, 'ready');
  assert.deepEqual(readiness.layers, LAYER_IDS);
  assert.ok(readiness.crossings.includes('Kernel->downloader'));
  assert.ok(readiness.crossings.includes('CapabilityService->downloader'));
  assert.ok(readiness.capabilityServices.includes('PolicyService'));
});

test('LayerBoundary readiness fails closed when a required layer is missing', () => {
  assert.throws(
    () => assertLayerBoundaryReadiness({
      boundaries: listLayerBoundaries().filter((boundary) => boundary.id !== 'downloader'),
    }),
    /missing required layer: downloader/u,
  );
});

test('LayerBoundary readiness fails closed when a required crossing control is missing', () => {
  const crossings = listLayerCrossings().map((crossing) => {
    if (crossing.from !== 'CapabilityService' || crossing.to !== 'downloader') {
      return crossing;
    }
    return {
      ...crossing,
      controls: [
        'minimized',
        'permission-checked',
        'schema-compatible',
      ],
    };
  });

  assert.throws(
    () => assertLayerBoundaryReadiness({ crossings }),
    /missing required controls: redacted/u,
  );
});

test('LayerBoundary readiness fails closed for downloader to SiteAdapter reverse crossing', () => {
  assert.throws(
    () => assertLayerBoundaryReadiness({
      crossings: [
        ...listLayerCrossings(),
        {
          from: 'downloader',
          to: 'SiteAdapter',
          purpose: 'reverse site interpretation',
          controls: ['schema-compatible'],
        },
      ],
    }),
    /forbids reverse crossing: downloader->SiteAdapter/u,
  );
});
