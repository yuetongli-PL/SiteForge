import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';

import { generateSkill } from '../../generate-skill.mjs';

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

test('generateSkill produces stable jable skill documents from the checked-in knowledge base', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);

    const result = await generateSkill('https://jable.tv/', {
      kbDir: path.join(repoRoot, 'knowledge-base', 'jable.tv'),
      outDir: path.join(workspace, 'out', 'jable'),
      skillName: 'jable',
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
    assert.match(skillMd, /Ranking query entrypoint: `node query-jable-ranking\.mjs <url> --query "<自然语言请求>"`\./u);
    assert.match(skillMd, /## Sample coverage/u);
    assert.match(skillMd, /## Safety boundary/u);
    assert.match(skillMd, /搜索影片、打开影片页、打开演员页、打开分类或标签页、按分类或标签提取前 N 条榜单/u);

    assert.match(indexMd, /^# jable Index\n/su);
    assert.match(indexMd, /## Sample intent coverage/u);
    assert.match(indexMd, /当前站点 Skill 以导航为主：覆盖搜索、影片页、演员页、分类\/标签页和功能页。/u);
    assert.match(indexMd, /node query-jable-ranking\.mjs https:\/\/jable\.tv\/ --query "<请求>"/u);
    assert.match(indexMd, /\| 打开演员页 \| \[[^\]]+\]\([^)]+knowledge-base\/jable\.tv\/raw\/step-6-docs\/[^)]+\) \|/u);
    assert.match(indexMd, /\| 分类榜单查询 \| \[[^\]]+\]\([^)]+knowledge-base\/jable\.tv\/raw\/step-6-docs\/[^)]+\) \|/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /## 搜索影片/u);
    assert.match(flowsMd, /## 分类榜单查询/u);
    assert.match(flowsMd, /Sort semantics: “推荐\/最佳\/近期最佳” => 综合排序/u);
    assert.match(flowsMd, /Group aggregation: when the user targets a first-level category group/u);

    const checkedInFlows = normalizeEol(
      await readFile(path.join(repoRoot, 'skills', 'jable', 'references', 'flows.md'), 'utf8'),
    );
    assert.equal(flowsMd, checkedInFlows);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill produces stable moodyz skill documents from the checked-in knowledge base', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-moodyz-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);

    const result = await generateSkill('https://moodyz.com/works/date', {
      kbDir: path.join(repoRoot, 'knowledge-base', 'moodyz.com'),
      outDir: path.join(workspace, 'out', 'moodyz-works'),
      skillName: 'moodyz-works',
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
    assert.match(skillMd, /search 作品, open 作品 pages, open 女优 pages, open category and list pages, open utility pages/u);

    assert.match(indexMd, /^# moodyz Index\n/su);
    assert.match(indexMd, /## Reference navigation/u);
    assert.match(indexMd, /## Download notes/u);
    assert.match(indexMd, /There is no verified chapter-reading or full-download flow in the current observed moodyz model\./u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /## 搜索作品/u);
    assert.match(flowsMd, /## 打开女优页/u);
    assert.match(flowsMd, /This site flow set is currently navigation-first, not chapter-download oriented\./u);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill produces stable 22biqu skill documents from the checked-in knowledge base', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-22biqu-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);

    const result = await generateSkill('https://www.22biqu.com/', {
      kbDir: path.join(repoRoot, 'knowledge-base', 'www.22biqu.com'),
      outDir: path.join(workspace, 'out', '22biqu'),
      skillName: '22biqu',
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

    const skillMd = normalizeEol(await readFile(path.join(result.skillDir, 'SKILL.md'), 'utf8'));
    const indexMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'index.md'), 'utf8'));
    const flowsMd = normalizeEol(await readFile(path.join(result.skillDir, 'references', 'flows.md'), 'utf8'));

    assert.match(skillMd, /^---\nname: 22biqu\n/su);
    assert.match(skillMd, /\n# 22biqu Skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/www\.22biqu\.com\//u);
    assert.match(skillMd, /Download entrypoint: `pypy3 download_book\.py`\./u);
    assert.match(skillMd, /search books, open book directories, open author pages, open chapter pages, and download full public novels/u);

    assert.match(indexMd, /^# 22biqu Index\n/su);
    assert.match(indexMd, /## Site summary/u);
    assert.match(indexMd, /## Download notes/u);
    assert.match(indexMd, /Latest full-book coverage: \d+ book\(s\), \d+ chapter\(s\)/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /## Download full book/u);
    assert.match(flowsMd, /Main path: check local artifact -> if missing, run `pypy3 download_book\.py`/u);
    assert.match(flowsMd, /## Search book/u);
    assert.match(flowsMd, /Freshness rule: search results are only for discovery/u);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill fails at the boundary when the knowledge base sources index is missing', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-missing-sources-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);

    const kbDir = path.join(workspace, 'kb-missing-sources');
    await cp(path.join(repoRoot, 'knowledge-base', 'jable.tv'), kbDir, { recursive: true });
    await rm(path.join(kbDir, 'index', 'sources.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir,
        outDir: path.join(workspace, 'out', 'missing'),
        skillName: 'missing',
      }),
      /Knowledge base sources index not found:/u,
    );
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateSkill fails at the boundary when required indexes or structured inputs are missing', async () => {
  const repoRoot = process.cwd();
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-missing-inputs-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(workspace);

    const missingPagesKbDir = path.join(workspace, 'kb-missing-pages');
    await cp(path.join(repoRoot, 'knowledge-base', 'jable.tv'), missingPagesKbDir, { recursive: true });
    await rm(path.join(missingPagesKbDir, 'index', 'pages.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir: missingPagesKbDir,
        outDir: path.join(workspace, 'out', 'missing-pages'),
        skillName: 'missing-pages',
      }),
      /Knowledge base pages index not found:/u,
    );

    const missingStructuredKbDir = path.join(workspace, 'kb-missing-structured');
    await cp(path.join(repoRoot, 'knowledge-base', 'jable.tv'), missingStructuredKbDir, { recursive: true });
    const sourcesDocument = JSON.parse(await readFile(path.join(missingStructuredKbDir, 'index', 'sources.json'), 'utf8'));
    const abstractionSource = sourcesDocument.activeSources.find((source) => source.step === 'step-4-abstraction');
    await rm(path.join(missingStructuredKbDir, abstractionSource.rawDir, 'intents.json'), { force: true });

    await assert.rejects(
      () => generateSkill('https://jable.tv/', {
        kbDir: missingStructuredKbDir,
        outDir: path.join(workspace, 'out', 'missing-structured'),
        skillName: 'missing-structured',
      }),
      /Required structured input missing: intents/u,
    );
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});

