import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

import { generateSkill } from '../../generate-skill.mjs';

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${String(value).trimEnd()}\n`, 'utf8');
}

async function createGenericKnowledgeBaseFixture(rootDir) {
  const kbDir = path.join(rootDir, 'knowledge-base', 'example.com');
  const step3Dir = path.join(kbDir, 'raw', 'step-3-analysis', 'run');
  const step4Dir = path.join(kbDir, 'raw', 'step-4-abstraction', 'run');
  const step5Dir = path.join(kbDir, 'raw', 'step-5-nl-entry', 'run');
  const step6Dir = path.join(kbDir, 'raw', 'step-6-docs', 'run');
  const step7Dir = path.join(kbDir, 'raw', 'step-7-governance', 'run');

  await writeJson(path.join(kbDir, 'index', 'sources.json'), {
    inputUrl: 'https://example.com/',
    baseUrl: 'https://example.com/',
    activeSources: [
      { step: 'step-3-analysis', rawDir: path.relative(kbDir, step3Dir) },
      { step: 'step-4-abstraction', rawDir: path.relative(kbDir, step4Dir) },
      { step: 'step-5-nl-entry', rawDir: path.relative(kbDir, step5Dir) },
      { step: 'step-6-docs', rawDir: path.relative(kbDir, step6Dir) },
      { step: 'step-7-governance', rawDir: path.relative(kbDir, step7Dir) },
    ],
  });
  await writeJson(path.join(kbDir, 'index', 'pages.json'), {
    pages: [
      { pageId: 'page-home', kind: 'home', url: 'https://example.com/' },
      { pageId: 'page-detail', kind: 'book-detail-page', url: 'https://example.com/works/detail/abc-001' },
    ],
  });
  await writeText(path.join(kbDir, 'wiki', 'README.md'), '# Example Wiki');
  await writeText(path.join(kbDir, 'wiki', 'concepts', 'interaction-model.md'), '# Interaction Model\n');
  await writeText(path.join(kbDir, 'wiki', 'concepts', 'nl-entry.md'), '# NL Entry\n');
  await writeText(path.join(kbDir, 'schema', 'AGENTS.md'), '# Agents\n');
  await writeJson(path.join(kbDir, 'schema', 'naming-rules.json'), { rules: [] });
  await writeJson(path.join(kbDir, 'schema', 'evidence-rules.json'), { rules: [] });

  await writeJson(path.join(step3Dir, 'elements.json'), {
    elements: [
      { elementId: 'search-form', kind: 'search-form', label: 'Search form' },
      { elementId: 'work-link', kind: 'content-link', label: 'Work link' },
    ],
  });
  await writeJson(path.join(step3Dir, 'states.json'), {
    states: [
      { stateId: 's0000', stateName: 'Home', finalUrl: 'https://example.com/' },
      { stateId: 's0001', stateName: 'Detail', finalUrl: 'https://example.com/works/detail/abc-001' },
    ],
  });
  await writeJson(path.join(step3Dir, 'transitions.json'), { transitions: [] });
  await writeJson(path.join(step3Dir, 'site-profile.json'), {
    host: 'example.com',
    archetype: 'navigation-catalog',
    schemaVersion: 1,
    primaryArchetype: 'catalog-detail',
    capabilityFamilies: ['search-content', 'navigate-to-content'],
  });

  await writeJson(path.join(step4Dir, 'intents.json'), {
    intents: [
      {
        intentId: 'intent-search-work',
        intentName: 'Search work',
        intentType: 'search-work',
        actionId: 'submit-search',
        elementId: 'search-form',
        stateField: 'queryText',
        targetDomain: {
          actionableValues: [{ value: 'work', label: 'Works' }],
          candidateValues: [{ value: 'author', label: 'Authors' }],
        },
      },
      {
        intentId: 'intent-open-work',
        intentName: 'Open work',
        intentType: 'open-work',
        actionId: 'open-link',
        elementId: 'work-link',
        stateField: 'selectedWork',
        targetDomain: {
          actionableValues: [{ value: 'work', label: 'Works' }],
          candidateValues: [],
        },
      },
    ],
  });
  await writeJson(path.join(step4Dir, 'actions.json'), {
    actions: [
      { actionId: 'submit-search', actionKind: 'search-submit' },
      { actionId: 'open-link', actionKind: 'safe-nav-link' },
    ],
  });
  await writeJson(path.join(step4Dir, 'decision-table.json'), {
    rules: [
      { ruleId: 'rule-search', intentId: 'intent-search-work' },
      { ruleId: 'rule-open', intentId: 'intent-open-work' },
    ],
  });
  await writeJson(path.join(step4Dir, 'capability-matrix.json'), {
    capabilityFamilies: ['search-content', 'navigate-to-content'],
  });

  await writeJson(path.join(step5Dir, 'alias-lexicon.json'), { entries: [] });
  await writeJson(path.join(step5Dir, 'slot-schema.json'), {
    intents: [
      { intentId: 'intent-search-work', slots: [{ slotId: 'queryText', required: true }] },
      { intentId: 'intent-open-work', slots: [{ slotId: 'selectedWork', required: true }] },
    ],
  });
  await writeJson(path.join(step5Dir, 'utterance-patterns.json'), {
    patterns: [
      { patternId: 'pattern-search', intentId: 'intent-search-work', patternType: 'example', examples: ['find Aoi'], regex: 'find (.+)', priority: 1 },
      { patternId: 'pattern-open', intentId: 'intent-open-work', patternType: 'example', examples: ['open work'], regex: 'open (.+)', priority: 1 },
    ],
  });
  await writeJson(path.join(step5Dir, 'entry-rules.json'), { rules: [] });
  await writeJson(path.join(step5Dir, 'clarification-rules.json'), { rules: [] });

  await writeText(path.join(step6Dir, 'intent-search-work.md'), '# Search work\n\nUse the site search form.');
  await writeText(path.join(step6Dir, 'intent-open-work.md'), '# Open work\n\nOpen a verified work detail page.');
  await writeJson(path.join(step6Dir, 'docs-manifest.json'), {
    documents: [
      {
        intentId: 'intent-search-work',
        title: 'Search work',
        path: path.join(step6Dir, 'intent-search-work.md'),
      },
      {
        intentId: 'intent-open-work',
        title: 'Open work',
        path: path.join(step6Dir, 'intent-open-work.md'),
      },
    ],
  });

  await writeText(path.join(step7Dir, 'recovery.md'), '# Recovery\n\n- Retry search.\n');
  await writeText(path.join(step7Dir, 'approval-checkpoints.md'), '# Approval\n\n- No approval needed for safe navigation.\n');

  return kbDir;
}

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

test('generateSkill produces a generic navigation skill without site-specific renderers', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-generate-skill-generic-'));
  const previousCwd = process.cwd();

  try {
    const kbDir = await createGenericKnowledgeBaseFixture(workspace);
    process.chdir(workspace);

    const result = await generateSkill('https://example.com/', {
      kbDir,
      outDir: path.join(workspace, 'out', 'example-skill'),
      skillName: 'example-skill',
    });

    assert.equal(result.skillName, 'example-skill');
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

    assert.match(skillMd, /^---\nname: example-skill\n/su);
    assert.match(skillMd, /Instruction-only Skill for the observed https:\/\/example\.com\/ navigation space\./u);
    assert.match(skillMd, /Primary archetype: `catalog-detail`/u);
    assert.match(indexMd, /^# example-skill Index\n/su);
    assert.match(indexMd, /\| Search work \| \[Search work\]/u);
    assert.match(flowsMd, /^# Flows\n/su);
    assert.match(flowsMd, /## Search work/u);
    assert.match(flowsMd, /## Open work/u);
  } finally {
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
