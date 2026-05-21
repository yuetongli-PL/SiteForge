import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertNoPlannerSensitiveMaterial,
} from '../../../src/app/planner/index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLANNER_DIR = path.join(REPO_ROOT, 'src', 'app', 'planner');

const FORBIDDEN_IMPORT_PATTERNS = [
  /(?:^|\/|\.\.\/)downloads?\//u,
  /(?:^|\/|\.\.\/)sessions?\/(?:runner|runtime|manager)/u,
  /site-adapter|siteAdapter|adapters\//iu,
  /downloader|download-runner|download-native/iu,
  /browser|playwright|selenium|puppeteer/iu,
  /artifact-service|artifactService/iu,
  /site-capability-graph-artifact|site-capability-graph-final-validation/iu,
  /entrypoints\//u,
];

const FORBIDDEN_IMPORT_FIXTURES = [
  '../planner-policy-handoff.mjs',
  '../download-policy.mjs',
  '../lifecycle-events.mjs',
  '../site-capability-graph.mjs',
  '../site-capability-graph-artifacts.mjs',
  '../core/adapters/generic-navigation.mjs',
  '../../downloads/executor.mjs',
  '../../sessions/runner.mjs',
  '../../entrypoints/cli/index.mjs',
];

async function readPlannerSources() {
  const entries = await readdir(PLANNER_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join(PLANNER_DIR, entry.name));
  return await Promise.all(files.map(async (filePath) => ({
    filePath,
    source: await readFile(filePath, 'utf8'),
  })));
}

function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bexport\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].map((match) => match[1]);
}

function isAllowedPlannerImportSpecifier(specifier) {
  return specifier.startsWith('./')
    || specifier.startsWith('../../domain/')
    || specifier === '../security-guard.mjs'
    || specifier.startsWith('node:');
}

test('Planner modules do not import execution-side boundaries', async () => {
  const sources = await readPlannerSources();
  assert.ok(sources.length > 0);
  for (const { filePath, source } of sources) {
    for (const specifier of importSpecifiers(source)) {
      assert.equal(
        isAllowedPlannerImportSpecifier(specifier),
        true,
        `${path.relative(REPO_ROOT, filePath)} imports non-allowlisted boundary ${specifier}`,
      );
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        assert.doesNotMatch(
          specifier,
          pattern,
          `${path.relative(REPO_ROOT, filePath)} imports forbidden boundary ${specifier}`,
        );
      }
    }
  }
});

test('Planner import allowlist rejects known execution-side modules', () => {
  for (const specifier of FORBIDDEN_IMPORT_FIXTURES) {
    assert.equal(isAllowedPlannerImportSpecifier(specifier), false, specifier);
  }
});

test('Planner sensitive guard rejects explicit non-goal bypass fields', () => {
  for (const [field, value] of Object.entries({
    captchaBypass: true,
    captchaSolver: true,
    solveCaptcha: true,
    antiBotBypass: true,
    accessControlBypass: true,
    bypassAccessControl: true,
    mfaBypass: true,
    platformRiskEvasion: true,
    riskControlBypass: true,
    permissionBypass: true,
    paywallBypass: true,
    vipBypass: true,
    credentialExtraction: true,
    privilegeExpansion: true,
    silentPrivilegeExpansion: true,
    privilegeEscalation: true,
  })) {
    assert.throws(
      () => assertNoPlannerSensitiveMaterial({
        schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
        [field]: value,
      }),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'planner.sensitive_material_forbidden');
        return true;
      },
      field,
    );
  }
});

test('Planner non-goal guard allows safe blocked/manual-recovery descriptors', () => {
  assert.equal(assertNoPlannerSensitiveMaterial({
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    riskState: {
      state: 'captcha_required',
      manualInterventionRequired: true,
      allowed: false,
    },
    plannerDecision: {
      status: 'blocked',
      reasonCode: 'planner.route_forbidden_by_risk',
    },
    redactionRequired: true,
    descriptorOnly: true,
  }), true);
});

test('Planner non-goal guard still rejects raw runtime payloads without secret echo', () => {
  for (const { name, value } of [
    {
      name: 'authorization header',
      value: {
        headers: {
          authorization: 'Bearer synthetic-secret-value',
        },
      },
    },
    {
      name: 'runtime downloader payload',
      value: {
        downloaderPayload: {
          token: 'synthetic-secret-value',
        },
      },
    },
    {
      name: 'browser profile',
      value: {
        browserProfilePath: 'C:/synthetic/secret-profile',
      },
    },
  ]) {
    assert.throws(
      () => assertNoPlannerSensitiveMaterial({
        schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
        ...value,
      }),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'planner.sensitive_material_forbidden');
        // @ts-ignore
        assert.doesNotMatch(error.message, /synthetic-secret-value/u, name);
        return true;
      },
      name,
    );
  }
});
