import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';

import { generateSkill } from '../../src/entrypoints/pipeline/generate-skill.mjs';
import {
  build22BiquStageSpec,
  buildJableStageSpec,
  buildMoodyzStageSpec,
  compileFixtureKnowledgeBase,
} from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

test('generateSkill produces stable jable skill documents from a self-contained compiled knowledge base', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildJableStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', 'jable'),
      skillName: 'jable',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(result.skillName, 'jable');
    assert.deepEqual(result.references, [
      'references/index.md',
      'references/flows.md',
      'references/recovery.md',
      'references/approval.md',
      'references/nl-intents.md',
      'references/interaction-model.md',
    ]);
    assert.deepEqual(result.warnings, []);

    const skillMd = normalizeEol(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'));
    const indexMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'index.md'), 'utf8'));
    const flowsMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'flows.md'), 'utf8'));

    assert.match(skillMd, /^---\nname: jable\n/su);
    assert.match(skillMd, /\n# jable Skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/jable\.tv\//u);
    assert.match(skillMd, /Ranking query entrypoint: `node src\/entrypoints\/sites\/jable-ranking\.mjs <url> --query/u);
    assert.match(skillMd, /## Sample coverage/u);
    assert.match(skillMd, /JUR-652/u);
    assert.match(skillMd, /Aoi Tsukasa/u);

    assert.match(indexMd, /^# jable Index\n/su);
    assert.match(indexMd, /## Notes/u);
    assert.match(indexMd, /node src\/entrypoints\/sites\/jable-ranking\.mjs https:\/\/jable\.tv\/ --query/u);
    assert.match(indexMd, /JUR-652/u);
    assert.match(indexMd, /big-tits/u);
    assert.match(indexMd, /(knowledge-base|compiled-kb)[\\/].+raw[\\/]step-6-docs[\\/]/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /JUR-652/u);
    assert.match(flowsMd, /Sort semantics:/u);
    assert.match(flowsMd, /Group aggregation: when the user targets a first-level category group/u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill produces stable moodyz skill documents from a self-contained compiled knowledge base', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-moodyz-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildMoodyzStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', 'moodyz-works'),
      skillName: 'moodyz-works',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(result.skillName, 'moodyz-works');
    assert.deepEqual(result.references, [
      'references/index.md',
      'references/flows.md',
      'references/recovery.md',
      'references/approval.md',
      'references/nl-intents.md',
      'references/interaction-model.md',
    ]);
    assert.deepEqual(result.warnings, []);

    const skillMd = normalizeEol(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'));
    const indexMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'index.md'), 'utf8'));
    const flowsMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'flows.md'), 'utf8'));

    assert.match(skillMd, /^---\nname: moodyz-works\n/su);
    assert.match(skillMd, /\n# moodyz Skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/moodyz\.com\/works\/date/u);
    assert.match(skillMd, /MIAA-001/u);
    assert.match(skillMd, /Alice/u);

    assert.match(indexMd, /^# moodyz Index\n/su);
    assert.match(indexMd, /## Reference navigation/u);
    assert.match(indexMd, /## Download notes/u);
    assert.match(indexMd, /There is no verified chapter-reading or full-download flow in the current observed moodyz model\./u);
    assert.match(indexMd, /MIAA-001/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /MIAA-001/u);
    assert.match(flowsMd, /Alice/u);
    assert.match(flowsMd, /This site flow set is currently navigation-first, not chapter-download oriented\./u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill produces stable 22biqu skill documents from a self-contained compiled knowledge base', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-22biqu-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = build22BiquStageSpec(workspace);
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', '22biqu'),
      skillName: '22biqu',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(result.skillName, '22biqu');
    assert.deepEqual(result.references, [
      'references/index.md',
      'references/flows.md',
      'references/recovery.md',
      'references/approval.md',
      'references/nl-intents.md',
      'references/interaction-model.md',
    ]);
    assert.deepEqual(result.warnings, []);

    const skillMd = normalizeEol(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'));
    const indexMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'index.md'), 'utf8'));
    const flowsMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'flows.md'), 'utf8'));

    assert.match(skillMd, /^---\nname: 22biqu\n/su);
    assert.match(skillMd, /\n# 22biqu Skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/www\.22biqu\.com\//u);
    assert.match(skillMd, /Download entrypoint: `pypy3 src\/sites\/chapter-content\/download\/python\/book\.py`\./u);
    assert.match(skillMd, /search books, open book directories, open author pages, open chapter pages, and download full public novels/u);

    assert.match(indexMd, /^# 22biqu Index\n/su);
    assert.match(indexMd, /## Site summary/u);
    assert.match(indexMd, /## Download notes/u);
    assert.match(indexMd, /Latest full-book coverage: 1 book\(s\), 12 chapter\(s\)/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /## Download full book/u);
    assert.match(flowsMd, /Main path: check local artifact -> if missing, run `pypy3 src\/sites\/chapter-content\/download\/python\/book\.py`/u);
    assert.match(flowsMd, /## Search book/u);
    assert.match(flowsMd, /Freshness rule: search results are only for discovery/u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill fails at the boundary when the knowledge base sources index is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-missing-sources-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const fixture = await compileFixtureKnowledgeBase(workspace, buildJableStageSpec());
    process.chdir(workspace);

    const kbDir = path.join(workspace, 'kb-missing-sources');
    await cp(fixture.kbDir, kbDir, { recursive: true });
    await rm(path.join(kbDir, 'index', 'sources.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir,
        outDir: path.join(workspace, 'out', 'missing'),
        skillName: 'missing',
        siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
      }),
      /Knowledge base sources index not found:/u,
    );
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill fails at the boundary when required indexes or structured inputs are missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-missing-inputs-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const fixture = await compileFixtureKnowledgeBase(workspace, buildJableStageSpec());
    process.chdir(workspace);

    const missingPagesKbDir = path.join(workspace, 'kb-missing-pages');
    await cp(fixture.kbDir, missingPagesKbDir, { recursive: true });
    await rm(path.join(missingPagesKbDir, 'index', 'pages.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir: missingPagesKbDir,
        outDir: path.join(workspace, 'out', 'missing-pages'),
        skillName: 'missing-pages',
        siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
      }),
      /Knowledge base pages index not found:/u,
    );

    const missingStructuredKbDir = path.join(workspace, 'kb-missing-structured');
    await cp(fixture.kbDir, missingStructuredKbDir, { recursive: true });
    const sourcesDocument = JSON.parse(await readFile(path.join(missingStructuredKbDir, 'index', 'sources.json'), 'utf8'));
    const abstractionSource = sourcesDocument.activeSources.find((source) => source.step === 'step-4-abstraction');
    await rm(path.join(missingStructuredKbDir, abstractionSource.rawDir, 'intents.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir: missingStructuredKbDir,
        outDir: path.join(workspace, 'out', 'missing-structured'),
        skillName: 'missing-structured',
        siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
      }),
      /Required structured input missing: intents/u,
    );
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
