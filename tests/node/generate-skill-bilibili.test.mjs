import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { generateSkill } from '../../src/entrypoints/pipeline/generate-skill.mjs';
import { buildBilibiliStageSpec, compileFixtureKnowledgeBase } from './kb-test-fixtures.mjs';
import { assertRepoMetadataUnchanged, captureRepoMetadataSnapshot } from './helpers/site-metadata-sandbox.mjs';

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

test('generateSkill produces bilibili skill documents with stronger execution constraints', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-bilibili-'));
  const previousCwd = process.cwd();
  const repoMetadataSnapshot = await captureRepoMetadataSnapshot();

  try {
    const spec = buildBilibiliStageSpec();
    const fixture = await compileFixtureKnowledgeBase(workspace, spec);
    process.chdir(workspace);

    const result = await generateSkill(spec.inputUrl, {
      kbDir: fixture.kbDir,
      outDir: path.join(workspace, 'out', 'bilibili'),
      skillName: 'bilibili',
      siteMetadataOptions: fixture.metadataSandbox.siteMetadataOptions,
    });

    assert.equal(result.skillName, 'bilibili');
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

    assert.match(skillMd, /^---\nname: bilibili\n/su);
    assert.match(skillMd, /Instruction-only Skill for https:\/\/www\.bilibili\.com\/\. Use when Codex needs to search videos, open verified video pages, open verified UP profiles/u);
    assert.match(skillMd, /Cross-host navigation model: home and video pages on `www\.bilibili\.com`, search results on `search\.bilibili\.com\/all`, UP profiles on `space\.bilibili\.com\/<mid>`\./u);
    assert.match(skillMd, /Approved category\/channel families:/u);
    assert.match(skillMd, /UP profile samples: UP 1202350411/u);
    assert.match(skillMd, /Search query samples: BV1WjDDBGE3p/u);
    assert.match(skillMd, /Video samples: BV1WjDDBGE3p/u);
    assert.match(skillMd, /Verified bangumi detail entrypoints:/u);
    assert.match(skillMd, /Verified UP video subpages:/u);
    assert.match(skillMd, /Verified scenario families:/u);
    assert.match(skillMd, /home -> search results -> video detail -> UP profile/u);
    assert.match(skillMd, /category\/channel entrypoints -> content detail/u);
    assert.match(skillMd, /## Execution policy/u);
    assert.match(skillMd, /Public bilibili pages MUST use the built-in browser\./u);
    assert.match(skillMd, /Authenticated bilibili pages MUST use the local opener/u);
    assert.match(skillMd, /Download requests MUST use the local downloader through the action router/u);
    assert.match(skillMd, /node \.\\scripts\\bilibili-action\.mjs open/u);
    assert.match(skillMd, /node \.\\scripts\\bilibili-action\.mjs download/u);
    assert.doesNotMatch(skillMd, /涓汉绌洪棿/u);
    assert.doesNotMatch(skillMd, /_鍝斿摡鍝斿摡_bilibili/u);
    assert.doesNotMatch(skillMd, /鐧诲綍 B/u);
    assert.doesNotMatch(skillMd, /UP 鎶曠/u);

    assert.match(indexMd, /^# bilibili Index\n/su);
    assert.match(indexMd, /Site type: video catalog \+ search hub \+ UP profile navigation\./u);
    assert.match(indexMd, /Verified hosts: .*www\.bilibili\.com/u);
    assert.match(indexMd, /Verified hosts: .*search\.bilibili\.com/u);
    assert.match(indexMd, /Verified hosts: .*space\.bilibili\.com/u);
    assert.match(indexMd, /Video samples: BV1WjDDBGE3p/u);
    assert.match(indexMd, /UP profile samples: UP 1202350411/u);
    assert.match(indexMd, /Approved category\/channel families:/u);
    assert.match(indexMd, /Verified category URLs: .*\/v\/popular\/all\/?/u);
    assert.match(indexMd, /Verified category URLs: .*\/anime\/?/u);
    assert.match(indexMd, /Verified bangumi detail URLs: .*\/bangumi\/play\//u);
    assert.match(indexMd, /Verified UP video subpages: .*space\.bilibili\.com\/1202350411\/video/u);
    assert.match(indexMd, /open-video.*bangumi\/play/u);
    assert.match(indexMd, /open-author.*space.*video/u);
    assert.match(indexMd, /No verified download, follow, coin, favorite, or publishing flow is included in the current skill output\./u);
    assert.doesNotMatch(indexMd, /涓汉绌洪棿/u);
    assert.doesNotMatch(indexMd, /_鍝斿摡鍝斿摡_bilibili/u);

    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /search\.bilibili\.com\/all/u);
    assert.match(flowsMd, /space\.bilibili\.com\/<mid>/u);
    assert.match(flowsMd, /space\/<mid>\/video/u);
    assert.match(flowsMd, /bangumi\/play/u);
    assert.match(flowsMd, /Example user requests: `search BV1WjDDBGE3p`/u);
    assert.match(flowsMd, /Example user requests: .*`open UP 1202350411`/u);
    assert.match(flowsMd, /Example user requests: .*`open anime`/u);
    assert.match(flowsMd, /Result semantics: treat `\/all`, `\/video`, `\/bangumi`, and `\/upuser` as the same search family/u);
    assert.match(flowsMd, /Slot guidance: accept either `videoCode` \(preferred BV code\) or `videoTitle`/u);
    assert.match(flowsMd, /Slot guidance: prefer stable UP identifiers or exact display names/u);
    assert.match(flowsMd, /Query guidance: prefer exact BV codes first, then full titles, then short distinctive keywords\./u);
    assert.match(flowsMd, /The current bilibili skill surface is intentionally navigation-first and excludes follow, comment, coin, favorite, and upload actions\./u);
    assert.doesNotMatch(flowsMd, /涓汉绌洪棿/u);
    assert.doesNotMatch(flowsMd, /_鍝斿摡鍝斿摡_bilibili/u);

    assert.match(nlIntentsMd, /^# NL Intents\n/su);
    assert.match(nlIntentsMd, /## Search videos/u);
    assert.match(nlIntentsMd, /## Open video pages/u);
    assert.match(nlIntentsMd, /## Open UP profiles/u);
    assert.match(nlIntentsMd, /`open UP 1202350411`/u);
    assert.match(nlIntentsMd, /`open anime`/u);
    assert.match(nlIntentsMd, /Search-family note: `\/all`, `\/video`, `\/bangumi`, and `\/upuser` are treated as one verified search-results family\./u);
    assert.match(nlIntentsMd, /Detail-family note: ordinary videos and `bangumi\/play` pages stay on the same public `open-video` surface\./u);
    assert.match(nlIntentsMd, /Author-family note: `space\/<mid>` and `space\/<mid>\/video` are both verified read-only author surfaces\./u);
    assert.doesNotMatch(nlIntentsMd, /涓汉绌洪棿/u);

    assert.match(interactionModelMd, /^# Interaction Model\n/su);
    assert.match(interactionModelMd, /Hosts: .*www\.bilibili\.com/u);
    assert.match(interactionModelMd, /Hosts: .*search\.bilibili\.com/u);
    assert.match(interactionModelMd, /Hosts: .*space\.bilibili\.com/u);
    assert.match(interactionModelMd, /Approved category\/channel families:/u);
    assert.match(interactionModelMd, /Verified bangumi detail URLs: .*\/bangumi\/play\//u);
    assert.match(interactionModelMd, /Verified UP video subpages: .*space\.bilibili\.com\/1202350411\/video/u);
    assert.match(interactionModelMd, /space\.bilibili\.com\/<mid>\/video/u);
    assert.match(interactionModelMd, /carry bilibili-specific page facts such as BV, UP mid, content type, and featured content cards/u);
    assert.match(interactionModelMd, /The interaction model is read-only and excludes engagement or account workflows\./u);
    assert.doesNotMatch(interactionModelMd, /涓汉绌洪棿/u);
    assert.doesNotMatch(interactionModelMd, /_鍝斿摡鍝斿摡_bilibili/u);
    await assertRepoMetadataUnchanged(repoMetadataSnapshot);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
