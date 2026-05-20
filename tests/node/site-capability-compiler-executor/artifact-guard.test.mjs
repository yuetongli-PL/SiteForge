import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareCompilerDerivedArtifact,
} from '../../../src/app/compiler/index.mjs';
import {
  createSyntheticCompileManifest,
} from './helpers.mjs';

test('compiler artifact guard prepares redacted JSON and audit JSON', () => {
  const prepared = prepareCompilerDerivedArtifact({
    artifactType: 'SITE_COMPILE_MANIFEST',
    value: createSyntheticCompileManifest(),
  });

  assert.equal(prepared.redactionRequired, true);
  assert.equal(prepared.redactionApplied, true);
  assert.doesNotMatch(prepared.artifactJson, /SESSDATA|access_token|Authorization/u);
  assert.doesNotMatch(prepared.auditJson, /SESSDATA|access_token|Authorization/u);
});

test('compiler artifact guard rejects unredacted sensitive material', () => {
  const manifest = createSyntheticCompileManifest();
  manifest.cookie = 'SESSDATA=synthetic-secret-value';
  assert.throws(
    () => prepareCompilerDerivedArtifact({
      artifactType: 'SITE_COMPILE_MANIFEST',
      value: manifest,
    }),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('compiler artifact guard rejects unsafe evidence refs before writes', () => {
  const manifest = createSyntheticCompileManifest();
  manifest.coverageReport.evidenceRefs = ['https://example.test/api/catalog'];
  assert.throws(
    () => prepareCompilerDerivedArtifact({
      artifactType: 'SITE_COMPILE_MANIFEST',
      value: manifest,
    }),
    (error) => {
      assert.equal(error.code, 'compiler.raw_sensitive_material_rejected');
      assert.doesNotMatch(error.message, /example\.test/u);
      return true;
    },
  );
});
