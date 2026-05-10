import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import {
  generateSkill,
  parseCliArgs as parseSkillCliArgs,
} from '../../src/entrypoints/pipeline/generate-skill.mjs';
import {
  runSiteCapabilityCompile,
} from '../../src/entrypoints/sites/site-capability-compile.mjs';
import {
  build22BiquStageSpec,
  buildBilibiliStageSpec,
  buildJableStageSpec,
  buildMoodyzStageSpec,
  buildXiaohongshuStageSpec,
  compileFixtureKnowledgeBase,
} from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

test('generateSkill auto-discovers the latest machine-readable compile result summary artifact', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-compile-summary-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildBilibiliStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const compileOutDir = path.join(
      workspace,
      'runs',
      'sites',
      'site-capability-compile',
      'bilibili',
      '20260510T000000Z',
    );
    const compileResult = await runSiteCapabilityCompile({
      site: 'bilibili',
      intent: 'navigate-to-content',
      writeArtifacts: true,
      outDir: compileOutDir,
    });
    assert.equal(compileResult.artifactWrite.artifactRefs.includes('site-compile-result-summary.json'), true);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', 'bilibili'),
      skillName: 'bilibili',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    const skillMd = normalizeEol(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'));
    assert.match(skillMd, /Compile summary artifact: site `bilibili`, graph validation `passed`, plan `ready`, Layer consumer ready `true`\./u);
    assert.match(skillMd, /Layer consumer artifact: owner `site-capability-layer`, result `LayerOwnedRuntimeConsumerResult`, runtime executed `false`, direct downloader `false`, direct SiteAdapter `false`\./u);
    assert.match(skillMd, /Site-specific evidence summary: site `bilibili`, API evidence 1, capability evidence 1, observed API auto-promotion `false`, executable capability auto-promotion `false`\./u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill CLI accepts an explicit compile summary artifact path', () => {
  const parsed = parseSkillCliArgs([
    'https://www.bilibili.com/',
    '--compile-summary',
    'runs/sites/site-capability-compile/bilibili/site-compile-result-summary.json',
    '--metadata-config-dir',
    'runs/preview/site-metadata/config',
    '--metadata-runtime-dir',
    'runs/preview/site-metadata/runtime',
  ]);

  assert.equal(parsed.command, 'generate');
  assert.equal(
    parsed.options.compileSummaryPath,
    'runs/sites/site-capability-compile/bilibili/site-compile-result-summary.json',
  );
  assert.deepEqual(parsed.options.siteMetadataOptions, {
    configDir: 'runs/preview/site-metadata/config',
    runtimeDir: 'runs/preview/site-metadata/runtime',
  });
});

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
    assert.match(skillMd, /Ranking query entrypoint: `node src\/entrypoints\/cli\.mjs catalog jable-ranking <url> --query/u);
    assert.match(skillMd, /## Sample coverage/u);
    assert.match(skillMd, /JUR-652/u);
    assert.match(skillMd, /Aoi Tsukasa/u);

    assert.match(indexMd, /^# jable Index\n/su);
    assert.match(indexMd, /## Notes/u);
    assert.match(indexMd, /node src\/entrypoints\/cli\.mjs catalog jable-ranking https:\/\/jable\.tv\/ --query/u);
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
    assert.match(skillMd, /node src\/entrypoints\/cli\.mjs catalog moodyz-month --month YYYY-MM/u);
    assert.match(skillMd, /Probe every day in the requested month with `\/works\/list\/date\/YYYY-MM-DD`/u);
    assert.match(skillMd, /MIAA-001/u);
    assert.match(skillMd, /Alice/u);

    assert.match(indexMd, /^# moodyz Index\n/su);
    assert.match(indexMd, /## Reference navigation/u);
    assert.match(indexMd, /## Download notes/u);
    assert.match(indexMd, /Month-level release catalogs are resolved by daily `\/works\/list\/date\/YYYY-MM-DD` probes/u);
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

test('generateSkill produces stable xiaohongshu skill documents from a self-contained compiled knowledge base', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-xiaohongshu-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildXiaohongshuStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', 'xiaohongshu'),
      skillName: 'xiaohongshu',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(result.skillName, 'xiaohongshu');
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
    const nlIntentsMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'nl-intents.md'), 'utf8'));
    const interactionModelMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'interaction-model.md'), 'utf8'));

    assert.match(skillMd, /^---\nname: xiaohongshu\n/su);
    assert.match(skillMd, /\n# xiaohongshu Skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/www\.xiaohongshu\.com\/explore/u);
    assert.match(skillMd, /search_result\?keyword=\.\.\./u);
    assert.match(skillMd, /\/explore\/<noteId>/u);
    assert.match(skillMd, /browse the discover page/u);
    assert.match(skillMd, /query followed users with a reusable authenticated profile/u);
    assert.match(skillMd, /node src\/entrypoints\/cli\.mjs xiaohongshu follow/u);
    assert.match(skillMd, /login\/register pages without submitting credentials automatically/u);
    assert.match(skillMd, /credential input and submission are always manual and never automatic/u);

    assert.match(indexMd, /^# xiaohongshu Index\n/su);
    assert.match(indexMd, /search_result\?keyword=\.\.\./u);
    assert.match(indexMd, /\/user\/profile\/<userId>/u);
    assert.match(indexMd, /browse-discover/u);
    assert.match(indexMd, /open-auth-page/u);
    assert.match(indexMd, /read-only navigation to login\/register entrypoints/u);
    assert.match(indexMd, /list-followed-users/u);
    assert.match(indexMd, /official frontend follow-list runtime/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /Target state: a search results page on `www\.xiaohongshu\.com\/search_result`\./u);
    assert.match(flowsMd, /Target state: a note detail page on `www\.xiaohongshu\.com\/explore\/<noteId>`\./u);
    assert.match(flowsMd, /Target state: a public user homepage on `www\.xiaohongshu\.com\/user\/profile\/<userId>`\./u);
    assert.match(flowsMd, /Target state: the discover surface rooted at `https:\/\/www\.xiaohongshu\.com\/explore`\./u);
    assert.match(flowsMd, /Target state: a login or register page under `www\.xiaohongshu\.com\/login` or `www\.xiaohongshu\.com\/register`\./u);
    assert.match(flowsMd, /40122\.tF\(\)/u);
    assert.match(flowsMd, /\/api\/sns\/web\/v1\/intimacy\/intimacy_list/u);
    assert.match(flowsMd, /do not auto-fill or auto-submit credentials/u);

    assert.match(nlIntentsMd, /Search notes/u);
    assert.match(nlIntentsMd, /Open note pages/u);
    assert.match(nlIntentsMd, /Open user homepages/u);
    assert.match(nlIntentsMd, /Browse discover page/u);
    assert.match(nlIntentsMd, /Open login\/register pages/u);
    assert.match(nlIntentsMd, /List followed users/u);
    assert.match(nlIntentsMd, /我关注了哪些用户/u);

    assert.match(interactionModelMd, /www\.xiaohongshu\.com/u);
    assert.match(interactionModelMd, /read-only/u);
    assert.match(interactionModelMd, /follow-users-query/u);
    assert.match(interactionModelMd, /official frontend follow-list runtime/u);
    assert.match(interactionModelMd, /Login\/register entrypoints are navigation-only targets/u);

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

test('generateSkill blocks low-coverage repo-local 22biqu promotion before overwrite', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-22biqu-gate-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = build22BiquStageSpec(workspace);
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    const repoSkillDir = path.join(workspace, 'skills', '22biqu');
    const referencesDir = path.join(repoSkillDir, 'references');
    const baselineSkillMd = [
      '---',
      'name: 22biqu',
      '---',
      '',
      '# 22biqu Skill',
      '',
      '## Scope',
      '',
      '- Safe actions: `download-book`, `navigate`, `search-submit`',
      '',
      '## Site Capability Graph status',
      '',
      '- Repo Graph status: Site Capability Graph final validation passed.',
      '',
      '## Site Capability Compiler status',
      '',
      '- Compiler status: Site Capability Compiler / Executor validation covers sections 1-20 verified.',
    ].join('\n');
    const baselineFlowsMd = [
      '# Flows',
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
      '',
      '## Critical retained flow',
      '',
      '- Intent Type: `live-book-metadata`',
      '- Action: `navigate`',
      '- Main path: fetch the live directory page.',
      '- Success signal: update metadata is visible.',
    ].join('\n');
    const baselineIndexMd = [
      '# 22biqu Index',
      '',
      '- Latest full-book coverage: 1 book(s), 999 chapter(s)',
    ].join('\n');

    await mkdir(referencesDir, { recursive: true });
    await writeFile(path.join(repoSkillDir, 'SKILL.md'), baselineSkillMd, 'utf8');
    await writeFile(path.join(referencesDir, 'flows.md'), baselineFlowsMd, 'utf8');
    await writeFile(path.join(referencesDir, 'index.md'), baselineIndexMd, 'utf8');

    process.chdir(workspace);

    await assert.rejects(
      () => generateSkill(spec.inputUrl, {
        kbDir: fixture.kbDir,
        outDir: repoSkillDir,
        skillName: '22biqu',
        siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
      }),
      (error) => {
        assert.equal(error.code, 'skill_coverage_regression');
        assert.equal(error.report.allowed, false);
        assert.equal(error.report.reasons.some((reason) => reason.type === 'missing_flow'), true);
        assert.equal(error.report.reasons.some((reason) => reason.type === 'lower_sample_coverage'), true);
        return true;
      },
    );

    assert.equal(await readFile(path.join(repoSkillDir, 'SKILL.md'), 'utf8'), baselineSkillMd);
    assert.equal(await readFile(path.join(referencesDir, 'flows.md'), 'utf8'), baselineFlowsMd);
    assert.equal(await readFile(path.join(referencesDir, 'index.md'), 'utf8'), baselineIndexMd);
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
