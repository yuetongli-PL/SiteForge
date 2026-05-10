import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readdir, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderKnownSiteSkillMd } from '../../src/skills/generation/site-render-inputs.mjs';
import {
  renderSiteCapabilityCompilerStatusLines,
  renderSiteCapabilityGraphStatusLines,
} from '../../src/skills/generation/render/site-renderers/shared.mjs';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, 'skills');
const GRAPH_SECTION_HEADING = '## Site Capability Graph status';
const GRAPH_STATUS_LINES = renderSiteCapabilityGraphStatusLines();
const COMPILER_SECTION_HEADING = '## Site Capability Compiler status';
const COMPILER_STATUS_LINES = renderSiteCapabilityCompilerStatusLines();

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizePath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.?\//u, '');
}

async function readRepoSkillDirs() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMdPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (await pathExists(skillMdPath)) {
      dirs.push(`skills/${entry.name}`);
    }
  }
  return dirs.sort();
}

function buildKnownSiteRenderContext(site) {
  return {
    url: site.url,
    skillName: site.skillName,
    siteContext: { host: site.host },
    statesDocument: { states: [] },
    intentsDocument: { intents: [] },
    actionsDocument: { actions: [] },
    searchResultsDocument: [],
    siteProfileDocument: {},
    liveSiteProfileDocument: null,
    mapToKbPath: (value) => value,
  };
}

const knownSiteRenderCases = [
  { skillName: '22biqu', url: 'https://www.22biqu.com/', host: 'www.22biqu.com' },
  { skillName: 'bilibili', url: 'https://www.bilibili.com/', host: 'www.bilibili.com' },
  { skillName: 'douyin', url: 'https://www.douyin.com/', host: 'www.douyin.com' },
  { skillName: 'jable', url: 'https://jable.tv/', host: 'jable.tv' },
  { skillName: 'moodyz-works', url: 'https://moodyz.com/works/date', host: 'moodyz.com' },
  { skillName: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore', host: 'www.xiaohongshu.com' },
];

const knownSiteOutputs = {
  skillMd: 'skills/site/SKILL.md',
  indexMd: 'skills/site/references/index.md',
  flowsMd: 'skills/site/references/flows.md',
  nlIntentsMd: 'skills/site/references/nl-intents.md',
  recoveryMd: 'skills/site/references/recovery.md',
  approvalMd: 'skills/site/references/approval.md',
  interactionModelMd: 'skills/site/references/interaction-model.md',
};

test('repo-local skill registry mappings are bidirectionally consistent', async () => {
  const registry = JSON.parse(await readFile(path.join(WORKSPACE_ROOT, 'config', 'site-registry.json'), 'utf8'));
  const skillDirs = await readRepoSkillDirs();
  const actualSkillSet = new Set(skillDirs);

  assert.equal(skillDirs.length, 21);

  const referencedSkillDirs = [];
  for (const [host, record] of Object.entries(registry.sites ?? {})) {
    if (!record.repoSkillDir) {
      continue;
    }
    assert.equal(
      typeof record.repoSkillDir,
      'string',
      `${host} repoSkillDir must be a relative skills/<name> string`,
    );
    const repoSkillDir = normalizePath(record.repoSkillDir);
    assert.match(repoSkillDir, /^skills\/[^/]+$/u, `${host} repoSkillDir must stay repo-local: ${repoSkillDir}`);
    assert.equal(
      await pathExists(path.join(WORKSPACE_ROOT, repoSkillDir, 'SKILL.md')),
      true,
      `${host} repoSkillDir must contain a SKILL.md: ${repoSkillDir}`,
    );
    referencedSkillDirs.push(repoSkillDir);
  }

  assert.deepEqual(
    [...new Set(referencedSkillDirs)].sort(),
    skillDirs,
    'every repo-local skill directory must be referenced by exactly one registry skill mapping',
  );
  assert.equal(referencedSkillDirs.length, skillDirs.length, 'registry must not duplicate repoSkillDir mappings');
  for (const repoSkillDir of referencedSkillDirs) {
    assert.equal(actualSkillSet.has(repoSkillDir), true, `${repoSkillDir} must exist under skills/`);
  }
});

test('all repo-local skills carry the shared Site Capability Graph status block', async () => {
  for (const repoSkillDir of await readRepoSkillDirs()) {
    const skillMdPath = path.join(WORKSPACE_ROOT, repoSkillDir, 'SKILL.md');
    const skillMd = await readFile(skillMdPath, 'utf8');
    const graphHeadingCount = skillMd.split(GRAPH_SECTION_HEADING).length - 1;
    assert.equal(graphHeadingCount, 1, `${repoSkillDir} must contain exactly one Graph status section`);
    for (const line of GRAPH_STATUS_LINES) {
      assert.match(skillMd, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `${repoSkillDir} is missing Graph line: ${line}`);
    }
  }
});

test('known-site renderers retain the shared Site Capability Graph status block', () => {
  for (const site of knownSiteRenderCases) {
    const skillMd = renderKnownSiteSkillMd(buildKnownSiteRenderContext(site), knownSiteOutputs);
    assert.equal(typeof skillMd, 'string', `${site.skillName} renderer must produce a skill`);
    assert.equal(skillMd.split(GRAPH_SECTION_HEADING).length - 1, 1);
    for (const line of GRAPH_STATUS_LINES) {
      assert.match(skillMd, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `${site.skillName} renderer is missing Graph line: ${line}`);
    }
  }
});

test('known-site renderers expose the shared Site Capability Compiler status block', () => {
  for (const site of knownSiteRenderCases) {
    const skillMd = renderKnownSiteSkillMd(buildKnownSiteRenderContext(site), knownSiteOutputs);
    assert.equal(typeof skillMd, 'string', `${site.skillName} renderer must produce a skill`);
    assert.equal(skillMd.split(COMPILER_SECTION_HEADING).length - 1, 1);
    for (const line of COMPILER_STATUS_LINES) {
      assert.match(skillMd, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `${site.skillName} renderer is missing Compiler line: ${line}`);
    }
  }
});
