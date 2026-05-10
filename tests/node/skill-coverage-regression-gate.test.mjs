import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import {
  evaluateSkillCoverageRegressionGate,
  enforceSkillCoverageRegressionGate,
  SkillCoverageRegressionError,
} from '../../src/skills/generation/coverage-regression-gate.mjs';

const BASELINE_SKILL_MD = [
  '---',
  'name: 22biqu',
  '---',
  '',
  '# 22biqu Skill',
  '',
  '## Scope',
  '',
  '- Safe actions: `download-book`, `navigate`, `search-submit`',
  '- Capability families: download-content, navigate-to-chapter, navigate-to-content, search-content',
  '',
  '## Site Capability Graph status',
  '',
  '- Repo Graph status: Site Capability Graph final validation passed.',
  '',
  '## Site Capability Compiler status',
  '',
  '- Compiler status: Site Capability Compiler / Executor validation covers sections 1-20 verified.',
  '- Compile summary artifact: site `22biqu`, graph validation `passed`, plan `ready`, Layer consumer ready `true`.',
  '- Site-specific evidence summary: site `22biqu`, API evidence 1, capability evidence 1, observed API auto-promotion `false`, executable capability auto-promotion `false`.',
].join('\n');

const BASELINE_FLOWS_MD = [
  '# Flows',
  '',
  '## Table of contents',
  '',
  '- [Download full book](#download-full-book)',
  '- [Search book](#search-book)',
  '',
  '## Download full book',
  '',
  '- Intent Type: `download-book`',
  '- Action: `download-book`',
  '- Main path: check local artifact -> run downloader -> write TXT.',
  '- Success signal: TXT exists.',
  '',
  '## Search book',
  '',
  '- Intent Type: `search-book`',
  '- Action: `search-submit`',
  '- Main path: submit query and open the matching result.',
  '- Success signal: result page is visible.',
].join('\n');

const BASELINE_INDEX_MD = [
  '# 22biqu Index',
  '',
  '## Site summary',
  '',
  '- Latest full-book coverage: 1 book(s), 12 chapter(s)',
].join('\n');

async function writeBaselineSkill(workspace) {
  const skillDir = path.join(workspace, 'skills', '22biqu');
  await mkdir(path.join(skillDir, 'references'), { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), BASELINE_SKILL_MD, 'utf8');
  await writeFile(path.join(skillDir, 'references', 'flows.md'), BASELINE_FLOWS_MD, 'utf8');
  await writeFile(path.join(skillDir, 'references', 'index.md'), BASELINE_INDEX_MD, 'utf8');
  return skillDir;
}

test('skill coverage regression gate accepts an equal repo-local candidate', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-skill-gate-pass-'));
  try {
    const skillDir = await writeBaselineSkill(workspace);
    const report = await evaluateSkillCoverageRegressionGate({
      cwd: workspace,
      skillName: '22biqu',
      targetDir: skillDir,
      candidateDocuments: {
        skillMd: BASELINE_SKILL_MD,
        flowsMd: BASELINE_FLOWS_MD,
        indexMd: BASELINE_INDEX_MD,
      },
      candidateCoverage: {
        safeActionKinds: ['download-book', 'navigate', 'search-submit'],
        approvalActionKinds: ['search-submit'],
        supportedIntents: ['download-book', 'search-book'],
        capabilityFamilies: ['download-content', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
      },
      baselineCoverage: {
        safeActionKinds: ['download-book', 'navigate', 'search-submit'],
        approvalActionKinds: ['search-submit'],
        supportedIntents: ['download-book', 'search-book'],
        capabilityFamilies: ['download-content', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
      },
    });

    assert.equal(report.allowed, true);
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.reasons, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('skill coverage regression gate reports missing capability flow status and sample coverage', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-skill-gate-fail-'));
  try {
    const skillDir = await writeBaselineSkill(workspace);
    const weakSkillMd = [
      '---',
      'name: 22biqu',
      '---',
      '',
      '# 22biqu Skill',
      '',
      '## Scope',
      '',
      '- Safe actions: `navigate`',
      '',
      '## Site Capability Graph status',
      '',
      '- Repo Graph status: Site Capability Graph final validation passed.',
    ].join('\n');
    const weakFlowsMd = [
      '# Flows',
      '',
      '## Search book',
      '',
      '- Intent Type: `search-book`',
      '- Action: `navigate`',
    ].join('\n');
    const weakIndexMd = [
      '# 22biqu Index',
      '',
      '- Latest full-book coverage: 0 book(s), 0 chapter(s)',
    ].join('\n');

    const report = await evaluateSkillCoverageRegressionGate({
      cwd: workspace,
      skillName: '22biqu',
      targetDir: skillDir,
      candidateDocuments: {
        skillMd: weakSkillMd,
        flowsMd: weakFlowsMd,
        indexMd: weakIndexMd,
      },
      candidateCoverage: {
        safeActionKinds: ['navigate'],
        approvalActionKinds: [],
        supportedIntents: ['search-book'],
        capabilityFamilies: ['search-content'],
      },
      baselineCoverage: {
        safeActionKinds: ['download-book', 'navigate', 'search-submit'],
        approvalActionKinds: ['search-submit'],
        supportedIntents: ['download-book', 'search-book'],
        capabilityFamilies: ['download-content', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
      },
    });

    assert.equal(report.allowed, false);
    assert.equal(report.status, 'failed');
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_capability' && reason.field === 'safeActionKinds'), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_capability' && reason.field === 'approvalActionKinds'), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_capability' && reason.field === 'supportedIntents'), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_capability' && reason.field === 'capabilityFamilies'), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_flow' && reason.missing.includes('Download full book')), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_status_block' && reason.missing.includes('## Site Capability Compiler status')), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'missing_status_block' && reason.missing.includes('compileSummary')), true);
    assert.equal(report.reasons.some((reason) => reason.type === 'lower_sample_coverage' && reason.field === 'references/index.md'), true);

    await assert.rejects(
      () => enforceSkillCoverageRegressionGate({
        cwd: workspace,
        skillName: '22biqu',
        targetDir: skillDir,
        candidateDocuments: {
          skillMd: weakSkillMd,
          flowsMd: weakFlowsMd,
          indexMd: weakIndexMd,
        },
        candidateCoverage: {
          safeActionKinds: ['navigate'],
          approvalActionKinds: [],
          supportedIntents: ['search-book'],
          capabilityFamilies: ['search-content'],
        },
        baselineCoverage: {
          safeActionKinds: ['download-book', 'navigate', 'search-submit'],
          approvalActionKinds: ['search-submit'],
          supportedIntents: ['download-book', 'search-book'],
          capabilityFamilies: ['download-content', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
        },
      }),
      SkillCoverageRegressionError,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('skill coverage regression gate skips non repo-local preview targets', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'siteforge-skill-gate-preview-'));
  try {
    await writeBaselineSkill(workspace);
    const report = await evaluateSkillCoverageRegressionGate({
      cwd: workspace,
      skillName: '22biqu',
      targetDir: path.join(workspace, 'runs', 'preview', '22biqu', 'skills', '22biqu'),
      candidateDocuments: {
        skillMd: '# weak preview',
        flowsMd: '',
        indexMd: '',
      },
      candidateCoverage: {},
      baselineCoverage: {
        safeActionKinds: ['download-book', 'navigate', 'search-submit'],
        approvalActionKinds: ['search-submit'],
        supportedIntents: ['download-book', 'search-book'],
        capabilityFamilies: ['download-content', 'navigate-to-chapter', 'navigate-to-content', 'search-content'],
      },
    });

    assert.equal(report.allowed, true);
    assert.equal(report.status, 'skipped');
    assert.equal(report.reason, 'not-repo-local-skill-promotion');
    assert.deepEqual(report.reasons, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
