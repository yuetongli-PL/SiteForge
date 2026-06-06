import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  SITEFORGE_DEBUG_REPORT_FILE,
  SITEFORGE_DEBUG_REPORT_JSON_ALIAS,
  SITEFORGE_INDEX_REPORT_FILE,
  SITEFORGE_REQUIRED_ARTIFACTS,
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS,
  SITEFORGE_REPORT_ALIASES,
  SITEFORGE_USER_REPORT_FILE,
  SITEFORGE_USER_REPORT_JSON_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_ALIAS,
  SITEFORGE_USER_REPORT_MARKDOWN_FILE,
} from '../../src/app/pipeline/build/artifact-contract.mjs';
import {
  SITEFORGE_REQUIRED_FINAL_ARTIFACTS as VALIDATION_FINAL_ARTIFACTS,
  SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS as VALIDATION_PRE_PROMOTION_ARTIFACTS,
} from '../../src/app/pipeline/build/output-validation.mjs';
import {
  SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES,
  assertNoCompiledArtifactSensitiveMaterial,
  scanCompiledArtifactSensitiveMaterial,
} from '../../src/app/pipeline/build/compilation-artifact-guard.mjs';

test('build pipeline and output validation share one required artifact contract', () => {
  assert.deepEqual(SITEFORGE_REQUIRED_ARTIFACTS, SITEFORGE_REQUIRED_FINAL_ARTIFACTS);
  assert.deepEqual(VALIDATION_PRE_PROMOTION_ARTIFACTS, SITEFORGE_REQUIRED_PRE_PROMOTION_ARTIFACTS);
  assert.deepEqual(VALIDATION_FINAL_ARTIFACTS, SITEFORGE_REQUIRED_FINAL_ARTIFACTS);
});

test('build report filenames and aliases are contract-backed', () => {
  assert.equal(SITEFORGE_USER_REPORT_FILE, 'build_report.user.json');
  assert.equal(SITEFORGE_USER_REPORT_MARKDOWN_FILE, 'build_report.user.md');
  assert.equal(SITEFORGE_DEBUG_REPORT_FILE, 'build_report.debug.json');
  assert.equal(SITEFORGE_INDEX_REPORT_FILE, 'build_report.json');
  assert.deepEqual(SITEFORGE_REPORT_ALIASES[SITEFORGE_USER_REPORT_FILE], [
    SITEFORGE_USER_REPORT_JSON_ALIAS,
    SITEFORGE_USER_REPORT_MARKDOWN_ALIAS,
  ]);
  assert.deepEqual(SITEFORGE_REPORT_ALIASES[SITEFORGE_DEBUG_REPORT_FILE], [
    SITEFORGE_DEBUG_REPORT_JSON_ALIAS,
  ]);
});

test('README does not carry drifted legacy build artifact names', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(readme, /run-manifest|pipeline runtime/u);
  assert.match(readme, /build_report\.user\.json|Site workspace/u);
});

test('compiled artifact guard allows descriptor fields and rejects raw runtime material', () => {
  assert.equal(SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES.includes('skill.yaml'), true);
  assert.equal(SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES.includes('execution_contracts.json'), true);
  assert.equal(SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES.includes('runtime_execution_report.json'), true);
  assert.equal(SITEFORGE_COMPILED_ARTIFACT_SECRET_SCAN_FILES.includes('audit_log.json'), true);

  const descriptorOnly = {
    schemaVersion: 1,
    capability: 'submit support request',
    headerNames: ['authorization', 'cookie', 'content-type'],
    authType: 'runtime_session',
    bodySchema: {
      type: 'object',
      properties: {
        message: { type: 'string', maxLength: 500 },
      },
    },
    payloadTemplate: {
      material: 'template_only',
      slotBindings: [{ name: 'message', required: true }],
    },
    sessionRequirementRef: 'session-requirement:support-request',
    cookieMaterialPersisted: false,
    credentialMaterialPolicy: 'no_raw_material',
  };

  assert.equal(assertNoCompiledArtifactSensitiveMaterial(descriptorOnly, { artifactName: 'execution_contracts.json' }), true);

  const rawRuntimeMaterial = {
    schemaVersion: 1,
    request: {
      headers: {
        authorization: 'Bearer synthetic-compiled-artifact-token',
        cookie: 'sid=synthetic-session-cookie',
      },
      body: {
        message: 'safe field',
      },
    },
    storageState: {
      cookies: [],
    },
    profileMaterial: 'synthetic-browser-profile-material',
  };

  const findings = scanCompiledArtifactSensitiveMaterial(rawRuntimeMaterial, {
    artifactName: 'capabilities.json',
  });
  assert.equal(findings.some((finding) => finding.reason === 'raw-headers-container'), true);
  assert.equal(findings.some((finding) => finding.reason === 'runtime-session-material'), true);
  assert.equal(findings.some((finding) => finding.reason === 'browser-profile-material'), true);
  assert.equal(findings.some((finding) => finding.reason === 'forbidden-sensitive-value-pattern'), true);
  assert.throws(
    () => assertNoCompiledArtifactSensitiveMaterial(rawRuntimeMaterial, { artifactName: 'capabilities.json' }),
    /Compiled SiteForge artifact contains forbidden sensitive material/u,
  );
});
