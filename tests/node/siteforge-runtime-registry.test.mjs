import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  createEmptySkillRegistry,
  lookupSkillIntent,
  lookupSkillIntentFromRegistry,
  runSiteForgeBuild,
  upsertSkillRegistryRecord,
} from '../../src/app/pipeline/build/index.mjs';
import {
  buildSetupAssistantPaths,
  prepareSiteForgeBuildSetup,
} from '../../src/app/pipeline/build/setup-assistant.mjs';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function passedRecord(overrides = /** @type {any} */ ({})) {
  return {
    skillId: 'simple-shop',
    siteId: 'fixture-local',
    domains: ['fixture.local'],
    skillDir: '.siteforge/sites/fixture-local/current',
    artifactDir: '.siteforge/sites/fixture-local/builds/success-build',
    verificationStatus: 'passed',
    intents: [{
      intentId: 'intent:fixture-local:search-products',
      name: 'search products',
      capabilityId: 'capability:fixture-local:search-products',
      capabilityName: 'search products',
      capabilityAction: 'search',
      executionPlanId: 'plan:fixture-local:search-products',
      canonicalUtterance: 'search products',
      utteranceExamples: ['search for wireless headphones'],
      safetyLevel: 'read_only',
      invocationScore: 1,
    }],
    ...overrides,
  };
}

test('runtime registry lookup ignores stale failed generated skill records', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:00.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord(), '2026-05-16T00:00:01.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    skillId: 'failed-draft-shop',
    skillDir: '.siteforge/sites/fixture-local/builds/failed-build/skill',
    artifactDir: '.siteforge/sites/fixture-local/builds/failed-build',
    verificationStatus: 'failed',
    intents: [{
      intentId: 'intent:fixture-local:failed-search-products',
      name: 'search products',
      capabilityId: 'capability:fixture-local:failed-search-products',
      capabilityName: 'failed search products',
      capabilityAction: 'search',
      executionPlanId: 'plan:fixture-local:failed-search-products',
      canonicalUtterance: 'search products',
      utteranceExamples: ['search for wireless headphones'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:02.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'FIXTURE.LOCAL',
    utterance: 'search for wireless headphones',
  });

  assert.equal(lookup.status, 'found');
  assert.equal(lookup.skillId, 'simple-shop');
  // @ts-ignore
  assert.equal(lookup.skillDir, '.siteforge/sites/fixture-local/current');
  assert.equal(lookup.capabilityId, 'capability:fixture-local:search-products');
  // @ts-ignore
  assert.equal(lookup.executionPlanId, 'plan:fixture-local:search-products');

  const failedOnly = createEmptySkillRegistry('2026-05-16T00:00:03.000Z');
  failedOnly.skills.push(passedRecord({
    skillId: 'failed-only',
    verificationStatus: 'failed',
  }));
  assert.equal(
    lookupSkillIntentFromRegistry(failedOnly, {
      domain: 'fixture.local',
      utterance: 'search for wireless headphones',
    }).status,
    'not_found',
  );
});

test('runtime registry lookup does not resolve unrelated utterances from invocation score alone', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:04.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    intents: [{
      intentId: 'intent:fixture-local:view-homepage',
      name: 'view homepage',
      capabilityId: 'capability:fixture-local:view-homepage',
      capabilityName: 'view homepage',
      capabilityAction: 'view',
      executionPlanId: 'plan:fixture-local:view-homepage',
      canonicalUtterance: 'view homepage',
      utteranceExamples: ['open homepage'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:05.000Z');

  const lookup = lookupSkillIntentFromRegistry(registry, {
    domain: 'fixture.local',
    utterance: 'list followed users',
  });

  assert.equal(lookup.status, 'not_found');
});

test('runtime registry lookup does not map profile-edit write intents to read-profile capability', () => {
  let registry = createEmptySkillRegistry('2026-05-16T00:00:06.000Z');
  registry = upsertSkillRegistryRecord(registry, passedRecord({
    intents: [{
      intentId: 'intent:fixture-local:list-profile-content',
      name: 'list profile content',
      capabilityId: 'capability:fixture-local:list-profile-content',
      capabilityName: 'list profile content',
      capabilityAction: 'view',
      executionPlanId: 'plan:fixture-local:list-profile-content',
      canonicalUtterance: 'list profile content',
      utteranceExamples: ['show account posts', 'open profile posts'],
      safetyLevel: 'read_only',
      invocationScore: 100,
    }],
  }), '2026-05-16T00:00:07.000Z');

  for (const utterance of ['edit profile', 'change account profile', '修改个人资料', '编辑账号主页信息']) {
    const lookup = lookupSkillIntentFromRegistry(registry, {
      domain: 'fixture.local',
      utterance,
    });
    assert.equal(lookup.status, 'not_found', utterance);
    // @ts-ignore
    assert.equal(lookup.reason, 'action_mismatch', utterance);
  }
});

test('generated skill is callable from domain and utterance through active current registry', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-registry-'));
  try {
    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'runtime-registry-success',
      now: new Date('2026-05-16T03:10:00.000Z'),
    });

    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'registered');
    assert.equal(result.summary.highRiskAutoExecuted, false);

    const lookup = await lookupSkillIntent({
      registryPath: result.workspace.registryPath,
      domain: 'FIXTURE.LOCAL',
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    // @ts-ignore
    assert.equal(lookup.intentName, 'search products');
    // @ts-ignore
    assert.equal(lookup.capabilityName, 'search products');
    assert.ok(lookup.intentId);
    assert.ok(lookup.capabilityId);
    // @ts-ignore
    assert.ok(lookup.executionPlanId);

    const registry = await readJson(result.workspace.registryPath);
    const record = registry.skills.find((skill) => skill.skillId === lookup.skillId);
    assert.ok(record);
    assert.equal(record.verificationStatus, 'passed');
    assert.equal(record.siteId, result.siteId);
    assert.equal(record.skillDir, `.siteforge/sites/${result.siteId}/current`);
    assert.equal(record.artifactDir, `.siteforge/sites/${result.siteId}/builds/runtime-registry-success`);
    assert.equal(record.domains.includes('fixture.local'), true);
    assert.equal(record.skillDir.includes('/builds/'), false);

    const activeSkillDir = path.join(workspace, record.skillDir);
    const intents = await readJson(path.join(activeSkillDir, 'intents.json'));
    const capabilities = await readJson(path.join(activeSkillDir, 'capabilities.json'));
    const plans = await readJson(path.join(activeSkillDir, 'execution_plans.json'));
    const safetyPolicy = await readJson(path.join(activeSkillDir, 'safety_policy.json'));
    const invocationTest = await readJson(path.join(activeSkillDir, 'tests', 'invocation.test.json'));
    const verificationReport = await readJson(path.join(activeSkillDir, 'verification_report.json'));

    const intent = intents.intents.find((candidate) => candidate.id === lookup.intentId);
    assert.ok(intent);
    assert.equal(intent.capabilityId, lookup.capabilityId);
    // @ts-ignore
    assert.equal(intent.safetyLevel, lookup.safetyLevel);

    const capability = capabilities.capabilities.find((candidate) => candidate.id === intent.capabilityId);
    assert.ok(capability);
    assert.equal(capability.status, 'active');
    // @ts-ignore
    assert.equal(capability.executionPlan.id, lookup.executionPlanId);

    // @ts-ignore
    const plan = plans.executionPlans.find((candidate) => candidate.id === lookup.executionPlanId);
    assert.ok(plan);
    assert.equal(plan.capabilityId, capability.id);
    assert.equal(plan.autoExecute, false);
    assert.equal(plan.steps.every((step) => step.autoExecute !== true), true);

    assert.equal(safetyPolicy.policy.submitForms, false);
    assert.equal(safetyPolicy.policy.allowDestructiveActions, false);
    assert.equal(safetyPolicy.policy.allowPayment, false);
    assert.equal(safetyPolicy.policy.allowAccountMutation, false);
    assert.match(safetyPolicy.riskPolicy.highRiskRule, /High-risk capabilities/u);
    assert.equal(safetyPolicy.riskPolicy.rawContentSaved, false);
    assert.equal(safetyPolicy.riskPolicy.privateContentSaved, false);

    assert.equal(invocationTest.domain, 'fixture.local');
    assert.equal(invocationTest.skillId ?? invocationTest.expectedSkill, 'simple-shop');
    assert.equal(invocationTest.capabilityId, lookup.capabilityId);
    assert.equal(verificationReport.status, 'passed');
    assert.equal(verificationReport.gates.safety.passed, true);
    assert.equal(verificationReport.gates.registryLookup.status, 'found');
    // @ts-ignore
    assert.equal(verificationReport.gates.registryLookup.executionPlanId, lookup.executionPlanId);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('failed verification is not registered and does not replace active current skill', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-runtime-failure-'));
  try {
    const success = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'runtime-success',
      now: new Date('2026-05-16T03:11:00.000Z'),
    });
    const registryBefore = await readJson(success.workspace.registryPath);
    const siteDir = success.workspace.siteDir;
    const currentVerificationBefore = await readJson(path.join(siteDir, 'current', 'verification_report.json'));
    const lastSuccessfulBefore = await readJson(path.join(siteDir, 'last_successful_build.json'));

    const emptyFixtureDir = path.join(workspace, 'empty-fixture');
    await mkdir(emptyFixtureDir);
    let failure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild('https://fixture.local/', {
            cwd: workspace,
            fixturePath: emptyFixtureDir,
            buildId: 'runtime-failed',
            now: new Date('2026-05-16T03:12:00.000Z'),
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /Static crawl produced no pages with evidence/u,
    );

    // @ts-ignore
    assert.ok(failure?.artifactDir);
    // @ts-ignore
    assert.equal(failure.artifactDir, path.join(siteDir, 'builds', 'runtime-failed'));
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'skill', 'skill.yaml')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'verification_report.json')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'crawl_static.json')), true);

    // @ts-ignore
    const failedBuildReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(failedBuildReport.status, 'blocked');
    assert.equal(failedBuildReport.failedStage, 'crawlStatic');
    assert.equal(failedBuildReport.reasonCode, 'empty-crawl');
    assert.equal(failedBuildReport.summary.registryStatus, null);

    assert.deepEqual(await readJson(success.workspace.registryPath), registryBefore);
    assert.deepEqual(await readJson(path.join(siteDir, 'current', 'verification_report.json')), currentVerificationBefore);
    assert.deepEqual(await readJson(path.join(siteDir, 'last_successful_build.json')), lastSuccessfulBefore);

    const lookup = await lookupSkillIntent({
      registryPath: success.workspace.registryPath,
      domain: 'fixture.local',
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    // @ts-ignore
    assert.equal(lookup.skillDir, `.siteforge/sites/${success.siteId}/current`);
    // @ts-ignore
    assert.equal(lookup.skillDir.includes('runtime-failed'), false);

    const registryAfter = await readJson(success.workspace.registryPath);
    assert.equal(
      registryAfter.skills.some((skill) => JSON.stringify(skill).includes('runtime-failed')),
      false,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com robots-blocked setup cannot create runtime-loadable current skill or registry record', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-robots-setup-'));
  const fixtureDir = path.join(workspace, 'x-robots-blocked-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'index.html'), '<title>X blocked</title><main>Public content is blocked by robots policy.</main>', 'utf8');

    const setupPaths = buildSetupAssistantPaths('https://x.com/', {
      cwd: workspace,
      buildId: 'x-robots-setup',
      now: new Date('2026-05-16T04:00:00.000Z'),
    });

    let setupFailure = null;
    await assert.rejects(
      () => prepareSiteForgeBuildSetup('https://x.com/', {
        cwd: workspace,
        fixturePath: fixtureDir,
        buildId: 'x-robots-setup',
        now: new Date('2026-05-16T04:00:00.000Z'),
        setupInteractive: true,
        setupOutput: { write() {} },
        setupPrompt: async () => '',
        noUserAuthorizedSetup: true,
      }),
      (error) => {
        setupFailure = error;
        // @ts-ignore
        return error?.code === 'setup-evidence-not-buildable'
          // @ts-ignore
          && error?.reasonCode === 'setup-known-policy-robots-disallowed';
      },
    );

    // @ts-ignore
    assert.equal(setupFailure.setupPlanPath, setupPaths.setupPlanPath);
    assert.equal(await pathExists(setupPaths.setupPlanPath), true);
    assert.equal(await pathExists(setupPaths.savedBuildProfilePath), true);

    const setupPlan = await readJson(setupPaths.setupPlanPath);
    const savedProfile = await readJson(setupPaths.savedBuildProfilePath);
    assert.equal(setupPlan.site.rootUrl, 'https://x.com/');
    assert.equal(setupPlan.buildReadiness.buildable, false);
    assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(savedProfile.profileUsability.buildable, false);
    assert.equal(savedProfile.profileUsability.reasonCode, 'setup-known-policy-robots-disallowed');

    const registry = await readJson(path.join(setupPaths.siteArtifactDir, 'registry.json'));
    const lastSuccessful = await readJson(path.join(setupPaths.siteArtifactDir, 'last_successful_build.json'));
    assert.deepEqual(registry.skills, []);
    assert.equal(lastSuccessful.status, 'none');
    assert.equal(lastSuccessful.buildId, null);

    assert.equal(await pathExists(path.join(setupPaths.siteArtifactDir, 'current', 'skill.yaml')), false);
    assert.equal(await pathExists(path.join(setupPaths.siteArtifactDir, 'current', 'verification_report.json')), false);
    assert.equal(await pathExists(path.join(setupPaths.artifactDir, 'skill.yaml')), false);
    assert.equal(await pathExists(path.join(setupPaths.artifactDir, 'verification_report.json')), false);
    assert.equal(await pathExists(path.join(setupPaths.artifactDir, 'build_report.json')), false);

    const lookup = await lookupSkillIntent({
      registryPath: path.join(setupPaths.siteArtifactDir, 'registry.json'),
      domain: 'x.com',
      utterance: 'open x home',
    });
    assert.equal(lookup.status, 'not_found');
    assert.equal(lookup.skillId, null);
    assert.equal(lookup.capabilityId, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('x.com robots-blocked build preserves blocked artifacts without promotion or runtime lookup', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-x-robots-build-'));
  const fixtureDir = path.join(workspace, 'x-robots-blocked-fixture');
  try {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
    await writeFile(path.join(fixtureDir, 'index.html'), '<title>X blocked</title><main>Public content is blocked by robots policy.</main>', 'utf8');

    let buildFailure = null;
    await assert.rejects(
      () => runSiteForgeBuild('https://x.com/', {
        cwd: workspace,
        fixturePath: fixtureDir,
        buildId: 'x-robots-build',
        now: new Date('2026-05-16T04:05:00.000Z'),
        fetchDelayMs: 0,
      }),
      (error) => {
        buildFailure = error;
        // @ts-ignore
        return error?.reasonCode === 'robots-disallowed'
          // @ts-ignore
          && /robots-disallowed/u.test(error?.message ?? '');
      },
    );

    // @ts-ignore
    const buildReport = await readJson(path.join(buildFailure.artifactDir, 'build_report.json'));
    const siteDir = buildReport.workspace.siteDir;
    assert.equal(buildReport.status, 'blocked');
    assert.equal(buildReport.failureClass, 'robots');
    assert.equal(buildReport.reasonCode, 'robots-disallowed');
    assert.equal(buildReport.summary.registryStatus, null);
    assert.equal(buildReport.summary.verificationStatus, null);

    // @ts-ignore
    const seeds = await readJson(path.join(buildFailure.artifactDir, 'seeds.json'));
    assert.equal(seeds.status, 'blocked');
    assert.equal(seeds.robots.status, 'parsed');
    assert.deepEqual(seeds.robots.disallowPaths, ['/']);
    assert.deepEqual(seeds.seeds, []);

    // @ts-ignore
    assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'skill.yaml')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'skill', 'skill.yaml')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(buildFailure.artifactDir, 'verification_report.json')), false);
    assert.equal(await pathExists(path.join(siteDir, 'current', 'skill.yaml')), false);
    assert.equal(await pathExists(path.join(siteDir, 'current', 'capabilities.json')), false);
    assert.equal(await pathExists(path.join(siteDir, 'current', 'verification_report.json')), false);

    const registry = await readJson(buildReport.workspace.registryPath);
    const lastSuccessful = await readJson(buildReport.workspace.lastSuccessfulBuildPath);
    assert.deepEqual(registry.skills, []);
    assert.equal(lastSuccessful.status, 'none');
    assert.equal(lastSuccessful.buildId, null);
    assert.equal(JSON.stringify(registry).includes('x-robots-build'), false);
    assert.equal(JSON.stringify(lastSuccessful).includes('x-robots-build'), false);

    const lookup = await lookupSkillIntent({
      registryPath: buildReport.workspace.registryPath,
      domain: 'x.com',
      utterance: 'open x home',
    });
    assert.equal(lookup.status, 'not_found');
    assert.equal(lookup.skillId, null);
    assert.equal(lookup.intentId, null);
    assert.equal(lookup.capabilityId, null);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
