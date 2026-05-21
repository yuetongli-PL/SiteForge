import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  assertCapability,
  assertSiteNode,
  assertUserIntent,
  buildArtifactDir,
  createBuildSource,
  lookupSkillIntent,
  readFixtureUrl,
  renderSiteForgeBuildSummary,
  resolveLiveFetchProxy,
  resolveFixtureForUrl,
  runSiteForgeBuild,
  validateCapabilitySafetyForVerification,
} from '../../src/app/pipeline/build/index.mjs';
import {
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

function fixtureEvidence(source = 'tests/fixtures/sites/simple-shop/index.html') {
  return [{ type: 'fixture', source, confidence: 1 }];
}

function createWritableBuffer() {
  let value = '';
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    value() {
      return value;
    },
  };
}

function assertRobotsSetupGuidance(text) {
  assert.match(text, /通用采集器被 robots\.txt 阻止/u);
  assert.match(text, /不会基于这次通用采集生成 Skill/u);
  assert.match(text, /不会基于这次通用采集更新 current\/ 或 registry\.json/u);
  assert.match(text, /已知站点适配器\/API/u);
  assert.match(text, /fixture 证据路径/u);
}

async function assertNoSetupSkillRegistration(setupPlanPath) {
  const siteRoot = path.dirname(path.dirname(setupPlanPath));
  assert.equal(await pathExists(path.join(siteRoot, 'current', 'skill.yaml')), false);
  const registryPath = path.join(siteRoot, 'registry.json');
  if (await pathExists(registryPath)) {
    assert.deepEqual((await readJson(registryPath)).skills, []);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test('SiteForge build keeps two sites isolated by site id and build id', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-isolation-'));
  try {
    const buildId = 'shared-build-id';
    const simple = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId,
      now: new Date('2026-05-16T03:00:00.000Z'),
    });
    const news = await runSiteForgeBuild('https://news.qq.com/', {
      cwd: workspace,
      fixture: 'news-qq-com',
      buildId,
      now: new Date('2026-05-16T03:01:00.000Z'),
      maxDepth: 2,
      maxPages: 20,
      maxSeeds: 20,
      fetchDelayMs: 0,
    });

    assert.notEqual(simple.siteId, news.siteId);
    assert.notEqual(simple.skillId, news.skillId);
    assert.equal(
      simple.artifactDir,
      path.join(workspace, '.siteforge', 'sites', simple.siteId, 'builds', buildId),
    );
    assert.equal(
      news.artifactDir,
      path.join(workspace, '.siteforge', 'sites', news.siteId, 'builds', buildId),
    );
    assert.equal(simple.artifactDir, simple.workspace.buildDir);
    assert.equal(news.artifactDir, news.workspace.buildDir);

    const simpleSite = await readJson(path.join(simple.artifactDir, 'site.json'));
    const newsSite = await readJson(path.join(news.artifactDir, 'site.json'));
    assert.equal(simpleSite.id, simple.siteId);
    assert.equal(newsSite.id, news.siteId);
    assert.equal(simpleSite.normalizedUrl, 'https://fixture.local/');
    assert.equal(newsSite.normalizedUrl, 'https://news.qq.com/');

    const simpleGraph = await readJson(path.join(simple.artifactDir, 'graph.json'));
    const newsGraph = await readJson(path.join(news.artifactDir, 'graph.json'));
    assert.equal(simpleGraph.nodes.every((node) => node.siteId === simple.siteId), true);
    assert.equal(newsGraph.nodes.every((node) => node.siteId === news.siteId), true);
    assert.equal(simpleGraph.nodes.some((node) => node.siteId === news.siteId), false);
    assert.equal(newsGraph.nodes.some((node) => node.siteId === simple.siteId), false);

    const simpleRegistry = await readJson(simple.workspace.registryPath);
    const newsRegistry = await readJson(news.workspace.registryPath);
    const simpleRecord = simpleRegistry.skills.find((skill) => skill.skillId === simple.skillId);
    const newsRecord = newsRegistry.skills.find((skill) => skill.skillId === news.skillId);
    assert.ok(simpleRecord);
    assert.ok(newsRecord);
    assert.equal(simpleRecord.siteId, simple.siteId);
    assert.equal(newsRecord.siteId, news.siteId);
    assert.equal(simpleRecord.skillDir, `.siteforge/sites/${simple.siteId}/current`);
    assert.equal(newsRecord.skillDir, `.siteforge/sites/${news.siteId}/current`);
    assert.equal(simpleRecord.artifactDir, `.siteforge/sites/${simple.siteId}/builds/${buildId}`);
    assert.equal(newsRecord.artifactDir, `.siteforge/sites/${news.siteId}/builds/${buildId}`);

    const simpleCapabilities = await readJson(path.join(simple.skillDir, 'capabilities.json'));
    const newsCapabilities = await readJson(path.join(news.skillDir, 'capabilities.json'));
    const simpleActiveIds = new Set(
      simpleCapabilities.capabilities
        .filter((capability) => capability.status === 'active')
        .map((capability) => capability.id),
    );
    const newsActiveIds = new Set(
      newsCapabilities.capabilities
        .filter((capability) => capability.status === 'active')
        .map((capability) => capability.id),
    );
    assert.equal(simpleRecord.intents.every((intent) => simpleActiveIds.has(intent.capabilityId)), true);
    assert.equal(newsRecord.intents.every((intent) => newsActiveIds.has(intent.capabilityId)), true);

    const unsupported = simpleCapabilities.capabilities.find((capability) => capability.name === 'capture network APIs');
    assert.ok(unsupported);
    assert.equal(unsupported.status, 'candidate');
    assert.equal(unsupported.evidence.length, 0);
    assert.equal(Object.hasOwn(unsupported, 'executionPlan'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge live source fetch honors HTTP_PROXY for HTTP targets', async () => {
  const seenRequests = /** @type {any[]} */ ([]);
  const proxy = createServer((request, response) => {
    seenRequests.push({
      method: request.method,
      url: request.url,
      host: request.headers.host,
      userAgent: request.headers['user-agent'],
    });
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html><title>proxied</title></html>');
  });
  const address = await listen(proxy);
  try {
    const source = createBuildSource('http://upstream.test/', {
      fixture: false,
      fetchDelayMs: 0,
      env: {
        HTTP_PROXY: `http://127.0.0.1:${address.port}`,
      },
    });
    const result = await source.read('http://upstream.test/index.html?b=2&a=1');

    assert.equal(result.fixtureName, null);
    assert.equal(result.sourcePath, 'http://upstream.test/index.html?a=1&b=2');
    assert.equal(result.body, '<html><title>proxied</title></html>');
    assert.deepEqual(result.request, {
      method: 'GET',
      statusCode: 200,
      requestHeaders: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'accept-encoding': 'identity',
        'user-agent': 'SiteForgeBuildStaticCrawler/1.0',
      },
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: address.port,
      },
    });
    assert.deepEqual(seenRequests, [{
      method: 'GET',
      url: 'http://upstream.test/index.html?a=1&b=2',
      host: 'upstream.test',
      userAgent: 'SiteForgeBuildStaticCrawler/1.0',
    }]);
  } finally {
    await closeServer(proxy);
  }
});

test('SiteForge live source fetch fails closed when HTTP proxy leaves request pending', async () => {
  const proxy = createServer(() => {
    // Intentionally keep the request open; SiteForge must not leave the build promise unsettled.
  });
  const address = await listen(proxy);
  const startedAt = Date.now();
  try {
    const source = createBuildSource('http://upstream.test/', {
      fixture: false,
      fetchDelayMs: 0,
      fetchTimeoutMs: 50,
      env: {
        HTTP_PROXY: `http://127.0.0.1:${address.port}`,
        ALL_PROXY: '',
        all_proxy: '',
      },
    });
    await assert.rejects(
      () => source.read('http://upstream.test/sitemap.xml'),
      (error) => {
        // @ts-ignore
        assert.equal(error.code, 'static-fetch-proxy-timeout');
        // @ts-ignore
        assert.equal(error.reasonCode, 'static-fetch-proxy-timeout');
        // @ts-ignore
        assert.match(error.message, /timed out/u);
        return true;
      },
    );
    assert.equal(Date.now() - startedAt < 5000, true);
  } finally {
    await closeServer(proxy);
  }
});

test('SiteForge live source fetch fails early for unsupported proxy protocols without leaking credentials', async () => {
  const env = {
    HTTPS_PROXY: 'ftp://proxy-user:proxy-secret@127.0.0.1:65535',
  };
  assert.equal(resolveLiveFetchProxy('https://upstream.test/', { NO_PROXY: 'upstream.test', ...env }), null);

  const source = createBuildSource('https://upstream.test/', {
    fixture: false,
    fetchDelayMs: 0,
    env,
  });
  await assert.rejects(
    () => source.read('https://upstream.test/'),
    (error) => {
      // @ts-ignore
      assert.equal(error.code, 'static-fetch-proxy-unsupported');
      // @ts-ignore
      assert.equal(error.reasonCode, 'static-fetch-proxy-unsupported');
      // @ts-ignore
      assert.match(error.message, /Unsupported proxy protocol/u);
      // @ts-ignore
      assert.doesNotMatch(error.message, /proxy-secret/u);
      // @ts-ignore
      assert.doesNotMatch(error.message, /proxy-user/u);
      return true;
    },
  );
});

test('SiteForge build rejects artifact and fixture path traversal attempts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-traversal-'));
  try {
    assert.throws(
      () => buildArtifactDir({ cwd: workspace, siteId: '..', buildId: 'safe-build' }),
      /siteId must be a safe path segment/u,
    );
    assert.throws(
      () => buildArtifactDir({ cwd: workspace, siteId: 'fixture-local', buildId: '..\\escape' }),
      /buildId must be a safe path segment/u,
    );
    await assert.rejects(
      () => runSiteForgeBuild('https://fixture.local/', {
        cwd: workspace,
        buildId: '../escape',
        now: new Date('2026-05-16T03:02:00.000Z'),
      }),
      /buildId must be a safe path segment/u,
    );
    assert.equal(await pathExists(path.join(workspace, 'escape')), false);

    const fixture = resolveFixtureForUrl('https://fixture.local/');
    await assert.rejects(
      () => readFixtureUrl('https://fixture.local/%2e%2e/simple-shop/index.html', fixture),
      /Fixture path traversal is not allowed/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('failed SiteForge build preserves failed artifacts and does not replace current success, last success, or registry', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-failure-'));
  try {
    const success = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'successful-build',
      now: new Date('2026-05-16T03:03:00.000Z'),
    });
    const siteRoot = path.dirname(path.dirname(success.artifactDir));
    const currentDir = path.join(siteRoot, 'current');
    const lastSuccessfulPath = path.join(siteRoot, 'last_successful_build.json');
    const registryPath = path.join(siteRoot, 'registry.json');
    const currentVerificationBefore = await readJson(path.join(currentDir, 'verification_report.json'));
    const lastSuccessfulBefore = await readJson(lastSuccessfulPath);
    const registryBefore = await readJson(registryPath);

    assert.equal(lastSuccessfulBefore.buildId, 'successful-build');
    assert.equal(lastSuccessfulBefore.buildDir, `.siteforge/sites/${success.siteId}/builds/successful-build`);
    assert.equal(lastSuccessfulBefore.currentDir, `.siteforge/sites/${success.siteId}/current`);
    assert.equal(currentVerificationBefore.buildId, 'successful-build');

    const emptyFixtureDir = path.join(workspace, 'empty-fixture');
    await mkdir(emptyFixtureDir);
    let failure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild('https://fixture.local/', {
            cwd: workspace,
            fixturePath: emptyFixtureDir,
            buildId: 'failed-build',
            now: new Date('2026-05-16T03:04:00.000Z'),
            maxPages: 1,
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
    assert.equal(failure.artifactDir, path.join(siteRoot, 'builds', 'failed-build'));
    // @ts-ignore
    const failedReport = await readJson(path.join(failure.artifactDir, 'build_report.json'));
    assert.equal(failedReport.status, 'blocked');
    assert.equal(failedReport.failedStage, 'crawlStatic');
    assert.equal(failedReport.reasonCode, 'empty-crawl');
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'site.json')), true);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'seeds.json')), true);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'crawl_static.json')), true);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'verification_report.json')), false);
    // @ts-ignore
    assert.equal(await pathExists(path.join(failure.artifactDir, 'skill', 'skill.yaml')), false);

    assert.deepEqual(await readJson(path.join(currentDir, 'verification_report.json')), currentVerificationBefore);
    assert.deepEqual(await readJson(lastSuccessfulPath), lastSuccessfulBefore);
    assert.deepEqual(await readJson(registryPath), registryBefore);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('validation gates fail closed for missing evidence, missing capability, and unsafe auto execution', () => {
  assert.throws(
    () => assertSiteNode({
      id: 'node:missing-evidence',
      siteId: 'fixture-local',
      type: 'page',
      discoveredBy: 'fixture',
      parentNodeIds: [],
      childNodeIds: [],
      confidence: 1,
      evidence: [],
    }),
    /requires non-empty evidence/u,
  );

  const disabledUnsafeCapability = {
    schemaVersion: 1,
    id: 'capability:fixture-local:dangerous-submit',
    siteId: 'fixture-local',
    name: 'dangerous submit',
    description: 'Disabled unsafe candidate.',
    action: 'submit',
    object: 'account mutation',
    entryNodeIds: [],
    requiredNodeIds: [],
    inputs: [],
    outputs: [],
    safetyLevel: 'destructive',
    confidence: 0,
    status: 'candidate',
    evidence: [],
  };
  assert.doesNotThrow(() => assertCapability(disabledUnsafeCapability));
  assert.deepEqual(validateCapabilitySafetyForVerification(disabledUnsafeCapability), []);

  assert.throws(
    () => assertCapability({
      ...disabledUnsafeCapability,
      status: 'active',
      entryNodeIds: ['node:form'],
      confidence: 0.9,
      executionPlan: {
        id: 'plan:dangerous-submit',
        capabilityId: disabledUnsafeCapability.id,
        mode: 'dry_run',
        dryRunOnly: true,
        requiresConfirmation: true,
        autoExecute: false,
        steps: [],
      },
    }),
    /requires non-empty evidence/u,
  );

  const unsafeActive = {
    ...disabledUnsafeCapability,
    status: 'active',
    entryNodeIds: ['node:form'],
    confidence: 0.9,
    safetyLevel: 'requires_confirmation',
    evidence: fixtureEvidence(),
    executionPlan: {
      id: 'plan:dangerous-submit',
      capabilityId: disabledUnsafeCapability.id,
      mode: 'read_only',
      dryRunOnly: false,
      requiresConfirmation: false,
      autoExecute: true,
      steps: [],
    },
  };
  const unsafeErrors = validateCapabilitySafetyForVerification(unsafeActive);
  assert.equal(unsafeErrors.some((error) => /lacks dry-run or confirmation/u.test(error)), true);
  assert.equal(unsafeErrors.some((error) => /unsafe auto-execution/u.test(error)), true);

  assert.throws(
    () => assertUserIntent({
      schemaVersion: 1,
      id: 'intent:fixture-local:missing',
      capabilityId: 'capability:fixture-local:missing',
      skillId: 'simple-shop',
      name: 'missing capability intent',
      canonicalUtterance: 'open missing capability',
      utteranceExamples: ['open missing capability'],
      negativeExamples: [],
      slots: [],
      safetyLevel: 'read_only',
      evidence: fixtureEvidence(),
    }, new Set(['capability:fixture-local:other'])),
    /references missing capability/u,
  );
});

test('generated skill lookup resolves domain and utterance to skill intent capability and execution plan', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-build-lookup-'));
  try {
    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'lookup-build',
      now: new Date('2026-05-16T03:05:00.000Z'),
    });
    assert.equal(result.status, 'success');

    const registryPath = result.workspace.registryPath;
    const lookup = await lookupSkillIntent({
      registryPath,
      domain: 'fixture.local',
      utterance: 'search for wireless headphones',
    });
    assert.equal(lookup.status, 'found');
    assert.equal(lookup.skillId, 'simple-shop');
    // @ts-ignore
    assert.equal(lookup.intentName, 'search products');
    // @ts-ignore
    assert.equal(lookup.capabilityName, 'search products');
    // @ts-ignore
    assert.ok(lookup.executionPlanId);

    const registry = await readJson(registryPath);
    const skillRecord = registry.skills.find((skill) => skill.skillId === lookup.skillId);
    const intentRecord = skillRecord.intents.find((intent) => intent.intentId === lookup.intentId);
    assert.equal(intentRecord.capabilityId, lookup.capabilityId);
    // @ts-ignore
    assert.equal(intentRecord.executionPlanId, lookup.executionPlanId);

    // @ts-ignore
    const skillDir = path.join(workspace, lookup.skillDir);
    const capabilities = await readJson(path.join(skillDir, 'capabilities.json'));
    const capability = capabilities.capabilities.find((candidate) => candidate.id === lookup.capabilityId);
    assert.equal(capability.status, 'active');
    assert.equal(capability.evidence.length > 0, true);

    const plans = await readJson(path.join(skillDir, 'execution_plans.json'));
    // @ts-ignore
    const plan = plans.executionPlans.find((candidate) => candidate.id === lookup.executionPlanId);
    assert.equal(plan.capabilityId, lookup.capabilityId);
    assert.equal(plan.steps.length > 0, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant interactive auto first run creates setup artifacts', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-interactive-'));
  try {
    const output = createWritableBuffer();
    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-first-run',
      now: new Date('2026-05-16T03:06:00.000Z'),
      setupInteractive: true,
      setupPrompt: async () => '',
      setupOutput: output,
      fetchDelayMs: 0,
    });

    assert.equal(setup.status, 'created');
    assert.equal(setup.setupPlan.artifactFamily, 'siteforge-setup-plan');
    assert.equal(setup.userChoices.mode, 'auto');
    assert.equal(setup.userChoices.acceptedDefaultRecommendation, true);
    assert.equal(setup.profile.artifactFamily, 'siteforge-build-profile');
    assert.equal(setup.profile.safety.allowPayment, false);
    assert.equal(setup.profile.safety.allowAccountMutation, false);
    assert.equal(setup.profile.safety.unsafeActions.checkout, false);
    assert.equal(setup.profile.safety.unsafeActions.upload, false);
    assert.equal(await pathExists(setup.paths.setupPlanPath), true);
    assert.equal(await pathExists(setup.paths.userChoicesPath), true);
    assert.equal(await pathExists(setup.paths.capabilityHintsPath), true);
    assert.equal(await pathExists(setup.paths.buildProfilePath), true);
    assert.equal(await pathExists(setup.paths.savedBuildProfilePath), true);
    assert.equal(setup.setupPlan.recommendedCapabilities.some((capability) => capability.id === 'draft-contact' && capability.recommended === false), true);
    assert.equal(setup.setupPlan.recommendedCapabilities.some((capability) => capability.id === 'search-site' && capability.recommended === true), true);
    assert.equal(setup.capabilityHints.disabledUnsafeActions.payment, false);
    assert.match(output.value(), /准备开始自动构建/u);
    assert.match(output.value(), /当前配置/u);
    assert.match(output.value(), /可修改配置/u);
    assert.match(output.value(), /安全限制/u);
    assert.match(output.value(), /操作说明/u);
    assert.match(output.value(), /快捷示例/u);
    assert.match(output.value(), /输入 项=值 快速修改/u);
    assert.doesNotMatch(output.value(), /\n能力摘要\n|\n结果\n/u);
    assert.doesNotMatch(output.value(), /能力候选与默认选择|默认构建会启用/u);
    assert.doesNotMatch(output.value(), /\b(?:DAG|registerSite|discoverSeeds|crawlStatic|buildSiteGraph|discoverCapabilities|generateSkill|stage dependency)\b/iu);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant accepts quick configuration assignment commands', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-quick-config-'));
  try {
    const answers = ['1=2', '2=4', '5=1', ''];
    const output = createWritableBuffer();
    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-quick-config',
      now: new Date('2026-05-16T03:06:30.000Z'),
      setupInteractive: true,
      setupPrompt: async () => answers.shift() ?? '',
      setupOutput: output,
      fetchDelayMs: 0,
    });

    assert.equal(setup.userChoices.setupConfiguration.explorationMode, 'safe_interaction');
    assert.equal(setup.userChoices.setupConfiguration.sensitiveCapabilityStrategy, 'batch_select');
    assert.equal(setup.userChoices.setupConfiguration.writeMode, 'preview_only');
    assert.equal(setup.userChoices.scope.explorationMode, 'safe_interaction');
    assert.equal(setup.userChoices.scope.dynamicControls, 'low_risk_only');
    assert.equal(setup.profile.setupConfiguration.explorationMode, 'safe_interaction');
    assert.match(output.value(), /已更新配置/u);
    assert.match(output.value(), /探索模式：安全交互/u);
    assert.match(output.value(), /敏感能力：批量选择/u);
    assert.match(output.value(), /写入方式：仅预览，不写入/u);

    const result = await runSiteForgeBuild('https://fixture.local/', setup.buildOptions);
    assert.equal(result.status, 'success');
    assert.equal(result.summary.verificationStatus, 'passed');
    assert.equal(result.summary.registryStatus, 'preview');
    assert.equal(result.summary.registryRegistered, false);
    assert.equal(result.summary.currentUpdated, false);
    const siteDir = path.dirname(path.dirname(setup.paths.setupPlanPath));
    assert.equal(await pathExists(path.join(siteDir, 'current', 'skill.yaml')), false);
    assert.deepEqual((await readJson(path.join(siteDir, 'registry.json'))).skills, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant saved profile reuse is validated without persisting profile material', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-reuse-'));
  try {
    await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-create-profile',
      now: new Date('2026-05-16T03:07:00.000Z'),
      setupInteractive: true,
      setupPrompt: async () => 'search',
      setupOutput: createWritableBuffer(),
      fetchDelayMs: 0,
    });

    const reused = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-reuse-profile',
      now: new Date('2026-05-16T03:08:00.000Z'),
      setupInteractive: false,
      interactive: false,
      noTty: true,
      fetchDelayMs: 0,
    });

    assert.equal(reused.status, 'reused');
    assert.equal(reused.userChoices.mode, 'reuse-saved-profile');
    assert.equal(reused.profile.artifactFamily, 'siteforge-build-profile');
    assert.equal(await pathExists(reused.paths.userChoicesPath), true);
    assert.equal(await pathExists(reused.paths.capabilityHintsPath), true);
    assert.equal(await pathExists(reused.paths.buildProfilePath), true);

    const persisted = [
      await readFile(reused.paths.userChoicesPath, 'utf8'),
      await readFile(reused.paths.capabilityHintsPath, 'utf8'),
      await readFile(reused.paths.buildProfilePath, 'utf8'),
      await readFile(reused.paths.savedBuildProfilePath, 'utf8'),
    ].join('\n');
    assert.doesNotMatch(persisted, /cookie|csrf|access[_-]?token|refresh[_-]?token|authorization|bearer|session[_-]?id|profilePath|userDataDir/iu);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant records known site policy without hardcoding domains', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-known-policy-'));
  try {
    const configDir = path.join(workspace, 'config');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
      version: 1,
      sites: {
        'fixture.local': {
          canonicalBaseUrl: 'https://fixture.local/',
          host: 'fixture.local',
          siteKey: 'fixture',
          adapterId: 'fixture-adapter',
          repoSkillDir: 'skills/fixture',
          siteArchetype: 'catalog-detail',
          downloadSessionRequirement: 'optional',
          capabilityFamilies: ['query-content'],
          routingNotes: ['Fixture policy must stay evidence-backed.'],
        },
      },
    }, null, 2)}\n`);
    await writeFile(path.join(configDir, 'site-capabilities.json'), `${JSON.stringify({
      version: 1,
      sites: {
        'fixture.local': {
          baseUrl: 'https://fixture.local/',
          host: 'fixture.local',
          siteKey: 'fixture',
          adapterId: 'fixture-adapter',
          primaryArchetype: 'catalog-detail',
          capabilityFamilies: ['search-content'],
          supportedIntents: ['search-fixture'],
          safeActionKinds: ['navigate'],
          approvalActionKinds: ['search-submit'],
        },
      },
    }, null, 2)}\n`);

    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-known-policy',
      now: new Date('2026-05-16T03:08:40.000Z'),
      setupInteractive: true,
      setupPrompt: async () => '',
      setupOutput: createWritableBuffer(),
      fetchDelayMs: 0,
    });

    assert.equal(setup.setupPlan.knownSitePolicy.status, 'matched');
    assert.equal(setup.setupPlan.knownSitePolicy.siteKey, 'fixture');
    assert.equal(setup.setupPlan.knownSitePolicy.adapterId, 'fixture-adapter');
    assert.deepEqual(setup.setupPlan.knownSitePolicy.capabilityFamilies, ['query-content', 'search-content']);
    assert.deepEqual(setup.setupPlan.knownSitePolicy.supportedIntents, ['search-fixture']);
    assert.equal(setup.setupPlan.knownSitePolicy.setupConstraints.userChoicesBypassPolicy, false);
    assert.equal(setup.setupPlan.warnings.some((warning) => warning.includes('known site policy loaded')), true);
    assert.equal(setup.setupPlan.collectionReview.artifactFamily, 'siteforge-collection-review');
    assert.equal(setup.setupPlan.collectionReview.knownSitePolicy.siteKey, 'fixture');
    assert.equal(setup.setupPlan.collectionReview.summary.seeds.collected > 0, true);
    assert.equal(setup.setupPlan.collectionReview.summary.capabilities.collected > 0, true);
    assert.equal(setup.profile.collectionReview.artifactFamily, 'siteforge-collection-review');
    assert.equal(setup.profile.knownSitePolicy.siteKey, 'fixture');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant regenerates legacy saved profiles without reusing missing evidence gates', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-legacy-profile-'));
  try {
    const created = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-create-current-profile',
      now: new Date('2026-05-16T03:08:30.000Z'),
      setupInteractive: true,
      setupPrompt: async () => '',
      setupOutput: createWritableBuffer(),
      fetchDelayMs: 0,
    });
    const legacyProfile = await readJson(created.paths.savedBuildProfilePath);
    delete legacyProfile.evidenceQuality;
    delete legacyProfile.buildReadiness;
    delete legacyProfile.profileUsability;
    await writeFile(created.paths.savedBuildProfilePath, `${JSON.stringify(legacyProfile, null, 2)}\n`);

    const regenerated = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-legacy-profile-regenerated',
      now: new Date('2026-05-16T03:08:45.000Z'),
      setupInteractive: false,
      interactive: false,
      noTty: true,
      fetchDelayMs: 0,
    });
    assert.equal(regenerated.status, 'created');
    assert.equal(regenerated.userChoices.mode, 'auto');
    assert.equal(regenerated.profile.artifactFamily, 'siteforge-build-profile');
    assert.ok(regenerated.profile.evidenceQuality);
    assert.ok(regenerated.profile.buildReadiness);
    assert.ok(regenerated.profile.profileUsability);
    assert.equal(await pathExists(regenerated.paths.setupPlanPath), true);
    assert.equal(await pathExists(regenerated.paths.buildProfilePath), true);
    assert.equal(await pathExists(regenerated.paths.savedBuildProfilePath), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant treats robots-disallowed setup evidence as not buildable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-robots-disallowed-'));
  const requests = /** @type {any[]} */ ([]);
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /\nSitemap: /sitemap.xml\n');
      return;
    }
    if (request.url === '/sitemap.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end('<urlset><url><loc>/public</loc></url></urlset>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Should not be setup evidence</title>');
  });

  try {
    const address = await listen(server);
    const rootUrl = `http://${address.address}:${address.port}/`;
    const output = createWritableBuffer();
    let prompted = false;
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(rootUrl, {
            cwd: workspace,
            buildId: 'setup-robots-disallowed',
            now: new Date('2026-05-16T03:08:50.000Z'),
            setupInteractive: true,
            setupPrompt: async () => {
              prompted = true;
              return '';
            },
            setupOutput: output,
            fixture: false,
            fetchDelayMs: 0,
            fetchTimeoutMs: 1000,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(prompted, false);
    // @ts-ignore
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.equal(failure.reasonCode, 'setup-robots-disallowed');
    assert.deepEqual(requests.sort(), ['/robots.txt', '/sitemap.xml']);
    // @ts-ignore
    const setupPlan = await readJson(failure.setupPlanPath);
    assert.equal(setupPlan.summary.buildable, false);
    assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-robots-disallowed');
    assert.equal(setupPlan.evidenceQuality.actualPageEvidenceCount, 0);
    assert.equal(setupPlan.evidenceQuality.sourceStatus.homepage, 'robots_disallowed');
    assert.equal(setupPlan.evidenceQuality.robotsExcludedAllCandidateEvidence, true);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedPageEvidenceUrls.includes(rootUrl), true);
    assert.equal(setupPlan.robots.excludedUrls.includes(rootUrl), true);
    assert.equal(setupPlan.recommendedCapabilities.every((capability) => capability.recommended === false), true);
    assert.match(output.value(), /当前不可构建/u);
    assertRobotsSetupGuidance(output.value());
    // @ts-ignore
    assertRobotsSetupGuidance(failure.message);
    // @ts-ignore
    assert.deepEqual(failure.guidance, setupPlan.buildReadiness.guidance);
  } finally {
    await closeServer(server).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant x.com robots-disallowed guidance is explicit in non-interactive and interactive modes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-x-robots-guidance-'));
  try {
    const fixtureDir = path.join(workspace, 'fixtures', 'x-robots-disallowed');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      path.join(fixtureDir, 'robots.txt'),
      'User-agent: *\nDisallow: /\nSitemap: /sitemap.xml\n',
      'utf8',
    );
    await writeFile(
      path.join(fixtureDir, 'sitemap.xml'),
      '<urlset><url><loc>https://x.com/public</loc></url></urlset>',
      'utf8',
    );

    let nonInteractiveFailure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup('https://x.com/', {
            cwd: workspace,
            buildId: 'setup-x-robots-noninteractive',
            now: new Date('2026-05-16T03:08:51.000Z'),
            setupInteractive: false,
            interactive: false,
            noTty: true,
            fixturePath: fixtureDir,
            fetchDelayMs: 0,
          });
        } catch (error) {
          nonInteractiveFailure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    // @ts-ignore
    assert.equal(nonInteractiveFailure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.equal(nonInteractiveFailure.reasonCode, 'setup-known-policy-robots-disallowed');
    // @ts-ignore
    assertRobotsSetupGuidance(nonInteractiveFailure.message);
    // @ts-ignore
    const nonInteractivePlan = await readJson(nonInteractiveFailure.setupPlanPath);
    assert.equal(nonInteractivePlan.site.rootUrl, 'https://x.com/');
    assert.equal(nonInteractivePlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    assertRobotsSetupGuidance(nonInteractivePlan.buildReadiness.guidance.join(' '));
    // @ts-ignore
    await assertNoSetupSkillRegistration(nonInteractiveFailure.setupPlanPath);

    const output = createWritableBuffer();
    let prompted = false;
    let interactiveFailure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup('https://x.com/', {
            cwd: workspace,
            buildId: 'setup-x-robots-interactive',
            now: new Date('2026-05-16T03:08:52.000Z'),
            setupInteractive: true,
            setupPrompt: async () => {
              prompted = true;
              return '';
            },
            setupOutput: output,
            fixturePath: fixtureDir,
            fetchDelayMs: 0,
            noUserAuthorizedSetup: true,
          });
        } catch (error) {
          interactiveFailure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(prompted, false);
    // @ts-ignore
    assert.equal(interactiveFailure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.equal(interactiveFailure.reasonCode, 'setup-known-policy-robots-disallowed');
    assertRobotsSetupGuidance(output.value());
    // @ts-ignore
    assertRobotsSetupGuidance(interactiveFailure.message);
    // @ts-ignore
    await assertNoSetupSkillRegistration(interactiveFailure.setupPlanPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant blocks known policy capabilities when live robots disallow evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-known-policy-robots-'));
  const requests = /** @type {any[]} */ ([]);
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /\nSitemap: /sitemap.xml\n');
      return;
    }
    if (request.url === '/sitemap.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end('<urlset><url><loc>/profile</loc></url></urlset>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Blocked social site</title>');
  });

  try {
    const configDir = path.join(workspace, 'config');
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, 'site-registry.json'), `${JSON.stringify({
      version: 1,
      sites: {
        '127.0.0.1': {
          canonicalBaseUrl: 'http://127.0.0.1/',
          host: '127.0.0.1',
          siteKey: 'blocked-social',
          adapterId: 'blocked-social-adapter',
          repoSkillDir: 'skills/blocked-social',
          capabilityFamilies: ['download-content', 'query-social-content'],
          downloadTaskTypes: ['social-archive'],
        },
      },
    }, null, 2)}\n`);
    await writeFile(path.join(configDir, 'site-capabilities.json'), `${JSON.stringify({
      version: 1,
      sites: {
        '127.0.0.1': {
          baseUrl: 'http://127.0.0.1/',
          host: '127.0.0.1',
          siteKey: 'blocked-social',
          adapterId: 'blocked-social-adapter',
          capabilityFamilies: ['query-social-relations'],
          supportedIntents: ['query-social-content'],
          safeActionKinds: ['navigate'],
        },
      },
    }, null, 2)}\n`);

    const address = await listen(server);
    const rootUrl = `http://${address.address}:${address.port}/`;
    const output = createWritableBuffer();
    let prompted = false;
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup(rootUrl, {
            cwd: workspace,
            buildId: 'setup-known-policy-robots',
            now: new Date('2026-05-16T03:08:55.000Z'),
            setupInteractive: true,
            setupPrompt: async () => {
              prompted = true;
              return '';
            },
            setupOutput: output,
            fixture: false,
            fetchDelayMs: 0,
            fetchTimeoutMs: 1000,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(prompted, false);
    // @ts-ignore
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.equal(failure.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.deepEqual(requests.sort(), ['/robots.txt', '/sitemap.xml']);
    // @ts-ignore
    const setupPlan = await readJson(failure.setupPlanPath);
    assert.equal(setupPlan.knownSitePolicy.siteKey, 'blocked-social');
    assert.equal(setupPlan.knownSitePolicy.adapterId, 'blocked-social-adapter');
    assert.deepEqual(setupPlan.knownSitePolicy.sources, ['config/site-registry.json', 'config/site-capabilities.json']);
    assert.deepEqual(setupPlan.knownSitePolicy.capabilityFamilies, [
      'download-content',
      'query-social-content',
      'query-social-relations',
    ]);
    assert.equal(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.hasPolicyCapabilities, true);
    assert.equal(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.siteKey, 'blocked-social');
    assert.equal(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.adapterId, 'blocked-social-adapter');
    assert.deepEqual(setupPlan.evidenceQuality.knownPolicyCapabilityPressure.sources, [
      'config/site-registry.json',
      'config/site-capabilities.json',
    ]);
    assert.equal(setupPlan.evidenceQuality.robotsExcludedAllCandidateEvidence, true);
    assert.equal(setupPlan.buildReadiness.buildable, false);
    assert.equal(setupPlan.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(setupPlan.buildReadiness.knownPolicy.siteKey, 'blocked-social');
    assert.equal(setupPlan.recommendedCapabilities.every((capability) => capability.recommended === false), true);

    // @ts-ignore
    const buildProfile = await readJson(failure.buildProfilePath);
    assert.equal(buildProfile.profileUsability.buildable, false);
    assert.equal(buildProfile.profileUsability.reasonCode, 'setup-known-policy-robots-disallowed');
    assert.equal(buildProfile.knownSitePolicy.adapterId, 'blocked-social-adapter');
    assert.deepEqual(buildProfile.capabilityScope.selectedCapabilities, []);

    let buildFailure;
    await assert.rejects(
      async () => {
        try {
          await runSiteForgeBuild(rootUrl, {
            cwd: workspace,
            buildId: 'known-policy-profile-block',
            setupProfile: buildProfile,
            fixture: false,
            fetchDelayMs: 0,
            fetchTimeoutMs: 1000,
          });
        } catch (error) {
          buildFailure = error;
          throw error;
        }
      },
      /Setup profile is not buildable/u,
    );

    // @ts-ignore
    assert.equal(buildFailure.code, 'robots-disallowed');
    // @ts-ignore
    assert.equal(buildFailure.reasonCode, 'robots-disallowed');
    // @ts-ignore
    assert.equal(buildFailure.buildReport.status, 'blocked');
    // @ts-ignore
    assert.equal(buildFailure.buildReport.summary.capabilities.active, 0);
    // @ts-ignore
    assert.equal(buildFailure.buildReport.summary.activeCapabilities, 0);
    // @ts-ignore
    assert.equal(buildFailure.buildReport.setupProfile.knownSitePolicy.siteKey, 'blocked-social');
    // @ts-ignore
    assert.equal(buildFailure.buildReport.setupProfile.knownSitePolicy.adapterId, 'blocked-social-adapter');
    // @ts-ignore
    assert.deepEqual(buildFailure.buildReport.setupProfile.knownSitePolicy.sources, [
      'config/site-registry.json',
      'config/site-capabilities.json',
    ]);
    // @ts-ignore
    assert.equal(buildFailure.buildReport.setupProfile.buildReadiness.reasonCode, 'setup-known-policy-robots-disallowed');
    // @ts-ignore
    assert.equal(buildFailure.buildReport.stages.registerSite.status, 'blocked');
    // @ts-ignore
    assert.equal(buildFailure.buildReport.stages.discoverCapabilities.status, 'skipped');
  } finally {
    await closeServer(server).catch(() => {});
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant non-interactive first run writes setup artifacts without hanging when evidence is available', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-noninteractive-'));
  try {
    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-noninteractive',
      now: new Date('2026-05-16T03:09:00.000Z'),
      setupInteractive: false,
      interactive: false,
      noTty: true,
      fetchDelayMs: 0,
    });

    assert.equal(setup.status, 'created');
    assert.equal(setup.userChoices.mode, 'auto');
    assert.equal(await pathExists(setup.paths.setupPlanPath), true);
    assert.equal(await pathExists(setup.paths.userChoicesPath), true);
    assert.equal(await pathExists(setup.paths.capabilityHintsPath), true);
    assert.equal(await pathExists(setup.paths.buildProfilePath), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant marks fallback-only setup profiles unusable and not buildable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-fallback-only-'));
  const emptyFixtureDir = path.join(workspace, 'empty-fixture');
  try {
    await mkdir(emptyFixtureDir);
    const output = createWritableBuffer();
    let prompted = false;
    let failure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup('https://fallback.local/', {
            cwd: workspace,
            fixturePath: emptyFixtureDir,
            buildId: 'setup-fallback-only',
            now: new Date('2026-05-16T03:10:00.000Z'),
            setupInteractive: true,
            setupPrompt: async () => {
              prompted = true;
              return '';
            },
            setupOutput: output,
            fetchDelayMs: 0,
          });
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );

    assert.equal(prompted, false);
    // @ts-ignore
    assert.equal(failure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.equal(failure.reasonCode, 'setup-primary-sources-unavailable');
    assert.match(output.value(), /当前不可构建/u);

    // @ts-ignore
    const setupPlan = await readJson(failure.setupPlanPath);
    assert.equal(setupPlan.evidenceQuality.sourceAvailability.robots, false);
    assert.equal(setupPlan.evidenceQuality.sourceAvailability.homepage, false);
    assert.equal(setupPlan.evidenceQuality.sourceAvailability.sitemap, false);
    assert.equal(setupPlan.evidenceQuality.allPrimarySourcesUnavailable, true);
    assert.equal(setupPlan.evidenceQuality.syntheticFallbackOnly, true);
    assert.equal(setupPlan.evidenceQuality.actualPageEvidenceCount, 0);
    assert.equal(setupPlan.evidenceQuality.syntheticPageEvidenceCount, 1);
    assert.equal(setupPlan.buildReadiness.status, 'not_ready');
    assert.equal(setupPlan.buildReadiness.buildable, false);
    assert.equal(setupPlan.summary.buildable, false);
    assert.equal(setupPlan.recommendedCapabilities.every((capability) => capability.recommended === false), true);

    // @ts-ignore
    const buildProfile = await readJson(failure.buildProfilePath);
    // @ts-ignore
    const savedProfile = await readJson(failure.savedBuildProfilePath);
    for (const profile of [buildProfile, savedProfile]) {
      assert.equal(profile.artifactFamily, 'siteforge-build-profile');
      assert.equal(profile.buildReadiness.buildable, false);
      assert.equal(profile.profileUsability.status, 'unusable');
      assert.equal(profile.profileUsability.buildable, false);
      assert.equal(profile.evidenceQuality.syntheticFallbackOnly, true);
      assert.deepEqual(profile.capabilityScope.selectedCapabilities, []);
      assert.equal(profile.safety.allowPayment, false);
      assert.equal(profile.safety.allowAccountMutation, false);
    }

    let reuseFailure;
    await assert.rejects(
      async () => {
        try {
          await prepareSiteForgeBuildSetup('https://fallback.local/', {
            cwd: workspace,
            fixturePath: emptyFixtureDir,
            buildId: 'setup-fallback-reuse',
            now: new Date('2026-05-16T03:11:00.000Z'),
            setupInteractive: false,
            interactive: false,
            noTty: true,
            fetchDelayMs: 0,
          });
        } catch (error) {
          reuseFailure = error;
          throw error;
        }
      },
      /setup-evidence-not-buildable/u,
    );
    // @ts-ignore
    assert.equal(reuseFailure.code, 'setup-evidence-not-buildable');
    // @ts-ignore
    assert.notEqual(reuseFailure.artifactDir, failure.artifactDir);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Setup Assistant hints cannot activate unsupported or unsafe capabilities without evidence', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-capability-gates-'));
  try {
    const setup = await prepareSiteForgeBuildSetup('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-risky-hints',
      now: new Date('2026-05-16T03:10:00.000Z'),
      setupInteractive: true,
      setupPrompt: async () => 'capture network APIs login payment upload delete contact support',
      setupOutput: createWritableBuffer(),
      fetchDelayMs: 0,
    });

    assert.equal(setup.status, 'created');
    assert.equal(setup.userChoices.hints[0], 'unmatched-user-hint');
    const persistedSetupArtifacts = [
      await readFile(setup.paths.userChoicesPath, 'utf8'),
      await readFile(setup.paths.capabilityHintsPath, 'utf8'),
      await readFile(setup.paths.buildProfilePath, 'utf8'),
      await readFile(setup.paths.savedBuildProfilePath, 'utf8'),
    ].join('\n');
    assert.doesNotMatch(persistedSetupArtifacts, /capture network APIs login payment upload delete contact support/u);
    assert.equal(setup.profile.safety.allowPayment, false);
    assert.equal(setup.profile.safety.allowAccountMutation, false);
    assert.equal(setup.profile.safety.allowContactSubmit, false);
    assert.equal(setup.profile.safety.unsafeActions.login, false);
    assert.equal(setup.profile.safety.unsafeActions.payment, false);
    assert.equal(setup.profile.safety.unsafeActions.upload, false);
    assert.equal(setup.profile.safety.unsafeActions.delete, false);

    const result = await runSiteForgeBuild('https://fixture.local/', {
      ...setup.buildOptions,
      cwd: workspace,
      buildId: 'build-risky-hints',
      now: new Date('2026-05-16T03:11:00.000Z'),
      fetchDelayMs: 0,
    });

    assert.equal(result.status, 'success');
    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const active = capabilities.capabilities.filter((capability) => capability.status === 'active');
    assert.equal(active.every((capability) => capability.evidence?.length > 0), true);

    const unsupported = capabilities.capabilities.find((capability) => capability.name === 'capture network APIs');
    assert.ok(unsupported);
    assert.equal(unsupported.status, 'candidate');
    assert.equal(unsupported.evidence.length, 0);
    assert.equal(Object.hasOwn(unsupported, 'executionPlan'), false);

    const unsafeAutoActivated = active.filter((capability) => (
      ['payment', 'destructive'].includes(capability.safetyLevel)
      || /login|payment|checkout|upload|delete|account mutation/iu.test(`${capability.name} ${capability.object}`)
      || capability.executionPlan?.autoExecute === true
    ));
    assert.deepEqual(unsafeAutoActivated.map((capability) => capability.name), []);

    const contact = active.find((capability) => capability.name === 'contact support');
    assert.ok(contact);
    assert.equal(contact.safetyLevel, 'requires_confirmation');
    assert.equal(contact.executionPlan.dryRunOnly, true);
    assert.equal(contact.executionPlan.requiresConfirmation, true);
    assert.equal(contact.executionPlan.autoExecute, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('SiteForge build reports setup collection review without activating candidate supplemental proofs', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-setup-review-report-'));
  try {
    const collectionReview = {
      schemaVersion: 1,
      artifactFamily: 'siteforge-collection-review',
      buildId: 'setup-review-profile',
      siteId: 'fixture-local',
      userAuthorizedEvidence: {
        status: 'captured',
        pageCount: 1,
        browserSeedCount: 0,
        capabilityProofCount: 1,
        sessionMaterialPersisted: false,
        browserProfilePersisted: false,
        rawHtmlPersisted: false,
      },
      summary: {
        seeds: { collected: 1, missing: 0 },
        nodes: { collected: 1, missing: 0 },
        affordances: { collected: 0, missing: 0 },
        capabilities: { collected: 0, missing: 1 },
        intents: { collected: 0, missing: 1 },
      },
      capabilities: {
        collected: [],
        missing: [{
          id: 'list-followed-users',
          label: 'list followed users',
          source: 'known-site-policy',
          reasonCode: 'capability-specific-evidence-required',
          requiresUserAuthorization: true,
          requiresCapabilityEvidence: true,
          extra: {
            evidenceRequirement: 'capability-specific-evidence',
            recommended: false,
          },
        }],
      },
      intents: {
        collected: [],
        missing: [{
          id: 'list-followed-users',
          label: 'list followed users',
          source: 'known-site-policy',
          reasonCode: 'capability-specific-evidence-required',
          requiresUserAuthorization: true,
          requiresCapabilityEvidence: true,
        }],
      },
      safetyBoundary: 'Collection review is report-only for this test fixture.',
    };
    const setupProfile = {
      schemaVersion: 1,
      artifactFamily: 'siteforge-build-profile',
      source: 'setup-assistant',
      scope: {
        maxDepth: 1,
        maxPages: 20,
        maxSeeds: 50,
      },
      safety: {
        submitForms: false,
        allowDestructiveActions: false,
        allowPayment: false,
        allowAccountMutation: false,
        allowContactSubmit: false,
      },
      knownSitePolicy: {
        status: 'known',
        host: 'fixture.local',
        siteKey: 'fixture-social',
        adapterId: 'fixture-social',
        sources: ['test'],
        capabilityFamilies: [],
        supportedIntents: ['list-followed-users'],
      },
      buildReadiness: {
        status: 'ready',
        buildable: true,
      },
      profileUsability: {
        status: 'usable',
        buildable: true,
      },
      capabilityScope: {
        selectedCapabilities: [],
        disabledCapabilities: [],
      },
      userAuthorizedEvidence: {
        status: 'captured',
        pages: [{
          normalizedUrl: 'https://fixture.local/',
          title: 'Authorized fixture surface',
          textSummary: 'User-authorized fixture evidence summary.',
        }],
        capabilityProofs: [{
          setupCapabilityId: 'list-followed-users',
          intentType: 'followed-users',
          action: 'followed-users',
          status: 'candidate',
          evidenceType: 'supplemental-collection-prompt',
          sampleCount: 3,
        }],
        sessionMaterialPersisted: false,
        browserProfilePersisted: false,
        rawHtmlPersisted: false,
      },
      collectionReview,
    };

    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      buildId: 'setup-review-build',
      now: new Date('2026-05-16T08:00:00.000Z'),
      setupProfile,
      fetchDelayMs: 0,
    });

    const capabilities = await readJson(path.join(result.artifactDir, 'capabilities.json'));
    const followedUsers = capabilities.capabilities.find((capability) => capability.name === 'list followed users');
    assert.ok(followedUsers);
    assert.equal(followedUsers.status, 'candidate');
    assert.equal(followedUsers.capabilityVerified, false);
    assert.equal(Object.hasOwn(followedUsers, 'executionPlan'), false);
    assert.equal(capabilities.capabilities
      .filter((capability) => capability.status === 'active')
      .some((capability) => capability.name === 'list followed users'), false);

    const intents = await readJson(path.join(result.artifactDir, 'intents.json'));
    assert.equal(intents.intents.some((intent) => intent.name === 'list followed users'), false);

    const buildReport = await readJson(path.join(result.artifactDir, 'build_report.json'));
    assert.equal(buildReport.setupCollectionReview.summary.capabilities.missing, 1);
    assert.equal(buildReport.setupCollectionReview.summary.intents.missing, 1);
    assert.equal(buildReport.setupCollectionReview.missingRecords[0].id, 'list-followed-users');
    assert.equal(buildReport.summary.setupCollectionReviewCapabilitiesMissing, 1);

    const summaryText = renderSiteForgeBuildSummary(result, { cwd: workspace });
    assert.match(summaryText, /✓ 构建完成/u);
    assert.match(summaryText, /▶ 能力统计/u);
    assert.doesNotMatch(summaryText, /(?:Setup collection review:|采集复核：|逐项补采)/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('static crawl artifacts redact page text, form values, and sensitive URLs', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-static-redaction-'));
  try {
    const fixtureDir = path.join(workspace, 'sensitive-fixture');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, 'index.html'), `
      <!doctype html>
      <html>
        <head>
          <title>Fixture synthetic-private-body-token</title>
          <link rel="canonical" href="/?access_token=synthetic-query-token">
        </head>
        <body>
          <h1>Private fixture synthetic-private-body-token</h1>
          <a href="/next.html?csrf_token=synthetic-csrf-token&access_token=synthetic-query-token">open token link</a>
          <form action="/submit?csrf_token=synthetic-csrf-token" method="post" aria-label="synthetic secret form">
            <input type="hidden" name="csrf_token" value="synthetic-input-token">
            <input type="text" name="email" value="private@example.test">
            <button type="submit">Submit synthetic-secret-token</button>
          </form>
        </body>
      </html>
    `, 'utf8');
    await writeFile(path.join(fixtureDir, 'next.html'), `
      <!doctype html>
      <html><head><title>Next token page</title></head><body>next synthetic-private-body-token</body></html>
    `, 'utf8');

    const result = await runSiteForgeBuild('https://fixture.local/', {
      cwd: workspace,
      fixturePath: fixtureDir,
      buildId: 'static-redaction-build',
      now: new Date('2026-05-17T09:00:00.000Z'),
      maxDepth: 1,
      maxPages: 4,
      maxSeeds: 10,
      fetchDelayMs: 0,
    });

    const scannedFiles = [
      'seeds.json',
      'crawl_static.json',
      'graph.json',
      'classified_graph.json',
      'affordances.json',
      'capabilities.json',
      'build_report.user.json',
      'build_report.debug.json',
      'build_report.json',
    ];
    const forbidden = [
      'synthetic-private-body-token',
      'synthetic-csrf-token',
      'synthetic-input-token',
      'synthetic-query-token',
      'access_token=',
      'csrf_token=',
      'private@example.test',
    ];
    for (const file of scannedFiles) {
      const text = await readFile(path.join(result.artifactDir, file), 'utf8');
      for (const value of forbidden) {
        assert.equal(text.includes(value), false, `${file} leaked ${value}`);
      }
    }

    const crawlStatic = await readJson(path.join(result.artifactDir, 'crawl_static.json'));
    assert.equal(crawlStatic.pages.some((page) => JSON.stringify(page).includes('[REDACTED]')), true);
    assert.equal(crawlStatic.pages.every((page) => page.links.every((link) => !String(link.href).includes('access_token='))), true);
    assert.equal(crawlStatic.pages.every((page) => page.forms.every((form) => !String(form.action).includes('csrf_token='))), true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
