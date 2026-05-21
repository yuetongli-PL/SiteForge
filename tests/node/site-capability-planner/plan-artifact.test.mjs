import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
  assertPlannerArtifactWriteResultCompatible,
  createPlanManifestFromArtifacts,
  preparePlannerArtifactForWrite,
  preparePlannerManifestForWrite,
  writePlannerArtifact,
  writePlannerManifest,
} from '../../../src/app/planner/index.mjs';

function createArtifact(overrides = /** @type {any} */ ({})) {
  return {
    schemaVersion: SITE_CAPABILITY_PLANNER_SCHEMA_VERSION,
    type: 'PLAN_MANIFEST',
    redactionRequired: true,
    payload: {
      planId: 'plan:synthetic',
      routeId: 'route:synthetic.example:public-page',
      descriptorOnly: true,
    },
    ...overrides,
  };
}

test('Planner artifact governance prepares redacted artifact JSON with audit metadata', () => {
  const prepared = preparePlannerArtifactForWrite(createArtifact());

  assert.equal(prepared.schemaVersion, SITE_CAPABILITY_PLANNER_SCHEMA_VERSION);
  assert.equal(prepared.redactionRequired, true);
  assert.equal(prepared.descriptorOnly, true);
  assert.equal(prepared.securityGuardApplied, true);
  assert.match(prepared.json, /PLAN_MANIFEST/u);
  assert.match(prepared.auditJson, /redactedPaths/u);
  assert.equal(prepared.audit.redactionCount, 0);
});

test('Planner artifact governance writes only through SecurityGuard prepared output', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-artifact-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const artifactPath = path.join(tempDir, 'plan-artifact.json');
  const auditPath = path.join(tempDir, 'plan-artifact.audit.json');

  const result = await writePlannerArtifact({
    artifact: createArtifact(),
    artifactPath,
    auditPath,
  });

  assert.equal(assertPlannerArtifactWriteResultCompatible(result), true);
  assert.equal(result.artifactKind, 'PlanArtifact');
  assert.equal(result.artifactType, 'PLAN_MANIFEST');
  assert.equal(result.artifactFileName, 'plan-artifact.json');
  assert.equal(result.auditFileName, 'plan-artifact.audit.json');
  assert.equal(result.writeOrder, 'audit-before-artifact');
  assert.equal(result.rawArtifactWriteAllowed, false);
  assert.equal(result.runtimePayloadIncluded, false);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.layerHandoffAllowed, false);
  assert.equal(result.siteAdapterInvocationAllowed, false);
  assert.equal(result.downloaderInvocationAllowed, false);
  assert.equal(result.runtimeMaterializationAllowed, false);
  assert.equal(result.artifactServiceInvocationAllowed, false);
  assert.equal(result.graphMutationAllowed, false);
  assert.equal(result.audit.redactionRequired, true);
  assert.equal(Object.hasOwn(result, 'json'), false);
  assert.equal(Object.hasOwn(result, 'auditJson'), false);
  assert.equal(Object.hasOwn(result, 'payload'), false);

  const artifactJson = await readFile(artifactPath, 'utf8');
  const auditJson = await readFile(auditPath, 'utf8');
  assert.doesNotMatch(artifactJson, /SESSDATA|Authorization|access_token|sessionId|browserProfile/iu);
  assert.match(auditJson, /redactions/u);
});

test('Planner artifact governance prepares and writes PlanManifest through the same guard', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-manifest-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const manifest = createPlanManifestFromArtifacts([
    createArtifact({ type: 'CAPABILITY_PLAN' }),
  ]);

  const prepared = preparePlannerManifestForWrite(manifest);
  assert.equal(prepared.securityGuardApplied, true);
  assert.match(prepared.json, /CAPABILITY_PLAN/u);

  const result = await writePlannerManifest({
    manifest,
    manifestPath: path.join(tempDir, 'manifest.json'),
    auditPath: path.join(tempDir, 'manifest.audit.json'),
  });

  assert.equal(assertPlannerArtifactWriteResultCompatible(result), true);
  assert.equal(result.artifactKind, 'PlanManifest');
  assert.equal(result.artifactType, 'PLAN_MANIFEST');
  assert.equal(result.writeOrder, 'audit-before-artifact');
  assert.equal(result.rawArtifactWriteAllowed, false);
  assert.equal(result.layerHandoffAllowed, false);
});

test('Planner artifact governance rejects missing redaction requirement before write', async () => {
  await assert.rejects(
    () => writePlannerArtifact({
      artifact: createArtifact({
        redactionRequired: false,
      }),
      artifactPath: 'unused.json',
      auditPath: 'unused.audit.json',
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.artifact_redaction_required');
      return true;
    },
  );
});

test('Planner artifact governance rejects sensitive artifact payload before persistence', () => {
  assert.throws(
    () => preparePlannerArtifactForWrite(createArtifact({
      payload: {
        evidence: 'https://synthetic.example/?access_token=synthetic-secret-value',
      },
    })),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );
});

test('Planner artifact governance fails before persistence for unsafe write inputs', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-artifact-fail-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const artifactPath = path.join(tempDir, 'unsafe.json');
  const auditPath = path.join(tempDir, 'unsafe.audit.json');

  await assert.rejects(
    () => writePlannerArtifact({
      artifact: createArtifact({
        payload: {
          evidence: 'https://synthetic.example/?access_token=synthetic-secret-value',
        },
      }),
      artifactPath,
      auditPath,
    }),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'planner.sensitive_material_forbidden');
      // @ts-ignore
      assert.doesNotMatch(error.message, /synthetic-secret-value/u);
      return true;
    },
  );

  await assert.rejects(access(artifactPath));
  await assert.rejects(access(auditPath));
});

test('PlanManifest builder accepts only redaction-required artifacts', () => {
  const manifest = createPlanManifestFromArtifacts([
    createArtifact(),
  ]);

  assert.equal(manifest.redactionRequired, true);
  assert.equal(manifest.artifacts.length, 1);

  assert.throws(
    () => createPlanManifestFromArtifacts([
      createArtifact({
        redactionRequired: false,
      }),
    ]),
    /PlanArtifact redactionRequired must be true/u,
  );
});

test('Planner artifact write result rejects unguarded write claims', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'planner-artifact-result-'));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const result = await writePlannerArtifact({
    artifact: createArtifact(),
    artifactPath: path.join(tempDir, 'plan.json'),
    auditPath: path.join(tempDir, 'plan.audit.json'),
  });

  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      securityGuardApplied: false,
    }),
    /redacted descriptor-only artifact evidence/u,
  );
  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      rawArtifactWriteAllowed: true,
    }),
    /redacted descriptor-only artifact evidence/u,
  );
  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      writeOrder: 'artifact-before-audit',
    }),
    /redacted descriptor-only artifact evidence/u,
  );
  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      json: '{"synthetic":"payload"}',
    }),
    /must not expose artifact payload field json/u,
  );
  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      artifact: {
        type: 'PLAN_MANIFEST',
      },
    }),
    /must not expose artifact payload field artifact/u,
  );
  assert.throws(
    () => assertPlannerArtifactWriteResultCompatible({
      ...result,
      audit: {
        ...result.audit,
        redactionRequired: false,
      },
    }),
    /audit metadata is not compatible/u,
  );
});
