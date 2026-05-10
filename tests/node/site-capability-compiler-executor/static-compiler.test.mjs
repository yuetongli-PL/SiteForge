import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertCompileCoverageReportConsistent,
  assertSiteCompileManifestCompatible,
  createCapabilityIntake,
  createStaticSiteCompileManifest,
} from '../../../src/sites/capability/compiler/index.mjs';
import {
  createCompileRequest,
  createSyntheticCapabilityConfig,
  createSyntheticCompileManifest,
} from './helpers.mjs';

test('static compiler emits descriptor-only manifest inventories from synthetic static inputs', () => {
  const manifest = createSyntheticCompileManifest();

  assert.equal(assertSiteCompileManifestCompatible(manifest), true);
  assert.equal(manifest.redactionRequired, true);
  assert.equal(manifest.siteId, 'site:synthetic.example');
  assert.equal(manifest.inventories.capabilities.length, 1);
  assert.equal(manifest.inventories.executionPaths.length, 1);
  assert.equal(manifest.inventories.requirements.length, 1);
  assert.ok(manifest.inventories.nodes.some((node) => node.type === 'SiteNode'));
  assert.ok(manifest.inventories.nodes.some((node) => node.type === 'RouteNode'));
  assert.ok(manifest.inventories.nodes.some((node) => node.type === 'RiskPolicyNode'));
  assert.equal(manifest.coverageReport.coverageCompleteness, 'partial');
});

test('static compiler records unknown report instead of overclaiming empty capability coverage', () => {
  const manifest = createStaticSiteCompileManifest({
    request: createCompileRequest(),
    registrySite: {
      siteKey: 'synthetic.example',
      adapterId: 'synthetic-adapter',
    },
    capabilityConfig: createSyntheticCapabilityConfig({
      capabilities: [],
    }),
  });

  assert.equal(manifest.inventories.capabilities.length, 0);
  assert.equal(manifest.unknownNodeReport.unknownNodes.length, 1);
  assert.deepEqual(manifest.coverageReport.blockedReasonCodes, ['compiler.coverage_incomplete']);
  assert.equal(assertCompileCoverageReportConsistent(manifest.compileScope, manifest.coverageReport), true);
});

test('static compiler prioritizes requested capabilities and records unconfirmed coverage', () => {
  const manifest = createStaticSiteCompileManifest({
    request: createCompileRequest({
      capabilityIntake: createCapabilityIntake({
        requestedCapabilities: ['open-page', 'download-content'],
        candidateCapabilities: ['open-page', 'download-content', 'search'],
      }),
    }),
    registrySite: {
      siteKey: 'synthetic.example',
      adapterId: 'synthetic-adapter',
    },
    capabilityConfig: createSyntheticCapabilityConfig(),
  });

  assert.equal(assertSiteCompileManifestCompatible(manifest), true);
  assert.deepEqual(manifest.capabilityIntake.requestedCapabilities, ['open-page', 'download-content']);
  assert.deepEqual(manifest.capabilityIntake.unconfirmedCapabilities, ['search']);
  assert.deepEqual(manifest.capabilityCoverageSummary.missingRequestedCapabilities, ['download-content']);
  assert.equal(manifest.capabilityCoverageSummary.missingRequestedCapabilityCount, 1);
  assert.equal(manifest.capabilityCoverageSummary.capabilityGapStatus, 'missing_requested_capability');
  assert.equal(manifest.capabilityCoverageSummary.targetedCapabilityCount, 1);
  assert.equal(manifest.capabilityCoverageSummary.bestEffortUnconfirmedCount, 1);
  assert.deepEqual(
    manifest.coverageReport.capabilityCoverageSummary.missingRequestedCapabilities,
    ['download-content'],
  );
  assert.equal(manifest.coverageReport.capabilityCoverageSummary.targetedCapabilityCount, 1);
  assert.equal(manifest.inventories.capabilities[0].intakeStatus, 'requested');
  assert.equal(manifest.inventories.capabilities[0].targetedByCapabilityIntake, true);
  assert.ok(
    manifest.unknownNodeReport.unknownNodes.some((node) => (
      node.requestedCapability === 'download-content'
        && node.reasonCode === 'compiler.capability_inventory_invalid'
    )),
  );
  assert.deepEqual(manifest.coverageReport.blockedReasonCodes, ['compiler.coverage_incomplete']);
});

test('static compiler rejects raw sensitive static source material before manifest output', () => {
  assert.throws(
    () => createStaticSiteCompileManifest({
      request: createCompileRequest({
        cookie: 'SESSDATA=synthetic-secret-value',
      }),
      capabilityConfig: createSyntheticCapabilityConfig(),
    }),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});
