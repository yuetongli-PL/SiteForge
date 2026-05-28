import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  parseArgs,
  runSiteRecompilePreviewSummary,
} from '../../src/entrypoints/sites/site-recompile-preview-summary.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeSkill(workspace, skillName) {
  const skillDir = path.join(workspace, 'skills', skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${skillName}\n---\n`, 'utf8');
}

test('site recompile preview summary parses CLI options', () => {
  const parsed = parseArgs(['--out-dir', 'runs/preview/recompile', '--json']);
  assert.equal(parsed.outDir, 'runs/preview/recompile');
  assert.equal(parsed.json, true);
});

test('site recompile preview summary writes guarded descriptor-only matrix', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-recompile-summary-'));
  const calls = /** @type {any[]} */ ([]);

  try {
    await writeJson(path.join(workspace, 'config', 'site-registry.json'), {
      version: 1,
      generatedAt: null,
      sites: {
        'www.22biqu.com': {
          siteKey: '22biqu',
          repoSkillDir: 'skills/22biqu',
        },
        'blocked.example': {
          siteKey: 'blocked-site',
          repoSkillDir: 'skills/blocked-site',
        },
      },
    });
    await writeSkill(workspace, '22biqu');
    await writeSkill(workspace, 'blocked-site');

    const result = await runSiteRecompilePreviewSummary({
      outDir: 'runs/preview/recompile',
    }, {
      cwd: workspace,
      async runSiteCapabilityCompile(options) {
        calls.push(options);
        if (options.site === 'blocked-site') {
          return {
            siteKey: options.site,
            descriptorOnly: true,
            graphValidationResult: 'passed',
            planStatus: 'blocked',
            plannerHandoffReady: false,
            layerRuntimeConsumerReady: false,
            reasonCode: 'compiler.capability_inventory_invalid',
            capabilityCount: 0,
            routeCount: 0,
            executionPathCount: 0,
            liveCaptureAttempted: false,
            executionAttempted: false,
            downloaderInvocationAllowed: false,
            siteAdapterInvocationAllowed: false,
            sessionMaterializationAllowed: false,
          };
        }
        return {
          siteKey: options.site,
          descriptorOnly: true,
          graphValidationResult: 'passed',
          planStatus: 'ready',
          plannerHandoffReady: true,
          layerRuntimeConsumerReady: true,
          reasonCode: null,
          capabilityCount: 3,
          routeCount: 2,
          executionPathCount: 1,
          artifactWrite: {
            outDir: options.outDir,
            artifactRefs: ['site-compile-result-summary.json'],
            auditRefs: ['site-compile-result-summary.audit.json'],
          },
          liveCaptureAttempted: false,
          executionAttempted: false,
          downloaderInvocationAllowed: false,
          siteAdapterInvocationAllowed: false,
          sessionMaterializationAllowed: false,
        };
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.writeArtifacts === true), true);
    assert.equal(result.summary.totalSites, 2);
    assert.equal(result.summary.ready, 1);
    assert.equal(result.summary.blocked, 1);
    assert.equal(result.safety.repoSkillsOverwritten, false);
    assert.equal(result.safety.downloaderInvoked, false);

    const persisted = JSON.parse(await readFile(result.artifactWrite.artifactPath, 'utf8'));
    assert.equal(persisted.artifactFamily, 'site-recompile-preview-summary');
    assert.equal(persisted.sites.find((site) => site.siteKey === '22biqu').status, 'ready');
    assert.equal(persisted.sites.find((site) => site.siteKey === '22biqu').repoSkillDir, 'skills/22biqu');
    assert.equal(persisted.sites.find((site) => site.siteKey === '22biqu').reasonCode, 'site-recompile-ready');
    assert.equal(persisted.sites.find((site) => site.siteKey === 'blocked-site').reasonCode, 'compiler.capability_inventory_invalid');
    const audit = JSON.parse(await readFile(result.artifactWrite.auditPath, 'utf8'));
    assert.deepEqual(audit.findings, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
