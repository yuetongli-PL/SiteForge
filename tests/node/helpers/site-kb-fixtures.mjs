import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const FIXTURE_TIMESTAMP = '2026-04-18T00:00:00.000Z';

export async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${String(value).trimEnd()}\n`, 'utf8');
}

export function createMinimalSnapshot() {
  return {
    strings: ['#document', 'HTML', 'BODY', ''],
    documents: [
      {
        nodes: {
          nodeName: [0, 1, 2],
          nodeValue: [3, 3, 3],
          parentIndex: [-1, 0, 1],
          attributes: [[], [], []],
        },
      },
    ],
  };
}

export async function createCaptureFixture(rootDir, {
  inputUrl,
  finalUrl = inputUrl,
  title = 'Fixture Capture',
  capturedAt = FIXTURE_TIMESTAMP,
} = {}) {
  await mkdir(rootDir, { recursive: true });
  await writeText(path.join(rootDir, 'page.html'), '<!doctype html><html><body>fixture</body></html>');
  await writeJson(path.join(rootDir, 'dom-snapshot.json'), createMinimalSnapshot());
  await writeFile(path.join(rootDir, 'screenshot.png'), '');
  await writeJson(path.join(rootDir, 'manifest.json'), {
    inputUrl,
    finalUrl,
    title,
    capturedAt,
    files: {
      html: 'page.html',
      snapshot: 'dom-snapshot.json',
      screenshot: 'screenshot.png',
      manifest: 'manifest.json',
    },
  });
  return rootDir;
}

export async function createExpandedStatesFixture(rootDir, {
  inputUrl,
  baseUrl = inputUrl,
  generatedAt = FIXTURE_TIMESTAMP,
  states = [],
} = {}) {
  const statesDir = path.join(rootDir, 'states');
  await mkdir(statesDir, { recursive: true });

  const manifestStates = [];
  for (const [index, state] of states.entries()) {
    const stateId = state.stateId ?? `s${String(index + 1).padStart(4, '0')}`;
    const slug = state.slug ?? stateId;
    const stateDir = path.join(statesDir, `${stateId}_${slug}`);
    await mkdir(stateDir, { recursive: true });
    await writeText(path.join(stateDir, 'page.html'), state.html ?? `<html><body>${state.title ?? state.finalUrl ?? stateId}</body></html>`);
    await writeJson(path.join(stateDir, 'dom-snapshot.json'), state.snapshot ?? createMinimalSnapshot());
    await writeFile(path.join(stateDir, 'screenshot.png'), '');
    await writeJson(path.join(stateDir, 'manifest.json'), {
      state_id: stateId,
      state_name: state.stateName ?? state.title ?? stateId,
      final_url: state.finalUrl,
      title: state.title ?? stateId,
      captured_at: state.capturedAt ?? generatedAt,
      status: state.status ?? 'captured',
      page_type: state.pageType ?? null,
      page_facts: state.pageFacts ?? null,
      files: {
        html: 'page.html',
        snapshot: 'dom-snapshot.json',
        screenshot: 'screenshot.png',
        manifest: 'manifest.json',
      },
    });
    manifestStates.push({
      state_id: stateId,
      state_name: state.stateName ?? state.title ?? stateId,
      final_url: state.finalUrl,
      title: state.title ?? stateId,
      captured_at: state.capturedAt ?? generatedAt,
      status: state.status ?? 'captured',
      page_type: state.pageType ?? null,
      page_facts: state.pageFacts ?? null,
      files: {
        html: path.join('states', `${stateId}_${slug}`, 'page.html'),
        snapshot: path.join('states', `${stateId}_${slug}`, 'dom-snapshot.json'),
        screenshot: path.join('states', `${stateId}_${slug}`, 'screenshot.png'),
        manifest: path.join('states', `${stateId}_${slug}`, 'manifest.json'),
      },
    });
  }

  await writeJson(path.join(rootDir, 'states-manifest.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    states: manifestStates,
  });
  return rootDir;
}

export async function createSiteKnowledgeBaseFixture(rootDir, {
  host,
  inputUrl,
  baseUrl = inputUrl,
  generatedAt = FIXTURE_TIMESTAMP,
  pageIndex = [],
  siteProfile = {},
  elements = [],
  states = [],
  transitions = { nodes: [], edges: [] },
  intents = [],
  actions = [],
  decisionRules = [],
  capabilityFamilies = [],
  slotSchemaIntents = [],
  utterancePatterns = [],
  docs = [],
  wikiReadme = '# Fixture Wiki',
  interactionModelMd = '# Interaction Model',
  nlEntryMd = '# NL Entry',
  recoveryMd = '# Recovery\n',
  approvalMd = '# Approval\n',
  capture = null,
  expandedStates = null,
  bookContent = null,
} = {}) {
  const kbDir = path.join(rootDir, 'knowledge-base', host);
  const sources = [];

  const rawDirFor = (...parts) => path.join(kbDir, 'raw', ...parts, 'run');
  const step3Dir = rawDirFor('step-3-analysis');
  const step4Dir = rawDirFor('step-4-abstraction');
  const step5Dir = rawDirFor('step-5-nl-entry');
  const step6Dir = rawDirFor('step-6-docs');
  const step7Dir = rawDirFor('step-7-governance');

  if (capture) {
    const step1Dir = rawDirFor('step-1-capture');
    await createCaptureFixture(step1Dir, {
      inputUrl: capture.inputUrl ?? inputUrl,
      finalUrl: capture.finalUrl ?? baseUrl,
      title: capture.title ?? 'Fixture Capture',
      capturedAt: capture.capturedAt ?? generatedAt,
    });
    sources.push({
      step: 'step-1-capture',
      runId: 'run',
      rawDir: path.relative(kbDir, step1Dir),
    });
  }

  if (expandedStates) {
    const step2Dir = rawDirFor('step-2-expanded');
    await createExpandedStatesFixture(step2Dir, {
      inputUrl: expandedStates.inputUrl ?? inputUrl,
      baseUrl: expandedStates.baseUrl ?? baseUrl,
      generatedAt: expandedStates.generatedAt ?? generatedAt,
      states: expandedStates.states ?? [],
    });
    sources.push({
      step: 'step-2-expanded',
      runId: 'run',
      rawDir: path.relative(kbDir, step2Dir),
    });
  }

  await writeJson(path.join(step3Dir, 'elements.json'), { elements });
  await writeJson(path.join(step3Dir, 'states.json'), { states });
  await writeJson(path.join(step3Dir, 'transitions.json'), transitions);
  await writeJson(path.join(step3Dir, 'site-profile.json'), siteProfile);
  await writeJson(path.join(step3Dir, 'analysis-manifest.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    files: {
      elements: 'elements.json',
      states: 'states.json',
      transitions: 'transitions.json',
      siteProfile: 'site-profile.json',
      manifest: 'analysis-manifest.json',
    },
  });
  sources.push({
    step: 'step-3-analysis',
    runId: 'run',
    rawDir: path.relative(kbDir, step3Dir),
  });

  await writeJson(path.join(step4Dir, 'intents.json'), { intents });
  await writeJson(path.join(step4Dir, 'actions.json'), { actions });
  await writeJson(path.join(step4Dir, 'decision-table.json'), { rules: decisionRules });
  await writeJson(path.join(step4Dir, 'capability-matrix.json'), { capabilityFamilies });
  await writeJson(path.join(step4Dir, 'abstraction-manifest.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    files: {
      intents: 'intents.json',
      actions: 'actions.json',
      decisionTable: 'decision-table.json',
      capabilityMatrix: 'capability-matrix.json',
      manifest: 'abstraction-manifest.json',
    },
  });
  sources.push({
    step: 'step-4-abstraction',
    runId: 'run',
    rawDir: path.relative(kbDir, step4Dir),
  });

  await writeJson(path.join(step5Dir, 'alias-lexicon.json'), { entries: [] });
  await writeJson(path.join(step5Dir, 'slot-schema.json'), { intents: slotSchemaIntents });
  await writeJson(path.join(step5Dir, 'utterance-patterns.json'), { patterns: utterancePatterns });
  await writeJson(path.join(step5Dir, 'entry-rules.json'), { rules: [] });
  await writeJson(path.join(step5Dir, 'clarification-rules.json'), { rules: [] });
  await writeJson(path.join(step5Dir, 'nl-entry-manifest.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    files: {
      aliasLexicon: 'alias-lexicon.json',
      slotSchema: 'slot-schema.json',
      utterancePatterns: 'utterance-patterns.json',
      entryRules: 'entry-rules.json',
      clarificationRules: 'clarification-rules.json',
      manifest: 'nl-entry-manifest.json',
    },
  });
  sources.push({
    step: 'step-5-nl-entry',
    runId: 'run',
    rawDir: path.relative(kbDir, step5Dir),
  });

  await writeText(path.join(step6Dir, 'README.md'), '# Site README\n');
  await writeText(path.join(step6Dir, 'glossary.md'), '# Glossary\n');
  await writeText(path.join(step6Dir, 'state-map.md'), '# State Map\n');
  await writeText(path.join(step6Dir, 'actions.md'), '# Actions\n');
  await writeText(path.join(step6Dir, 'recovery.md'), '# Recovery\n');
  for (const doc of docs) {
    await writeText(path.join(step6Dir, doc.file), doc.content);
  }
  await writeJson(path.join(step6Dir, 'docs-manifest.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    files: {
      readme: 'README.md',
      glossary: 'glossary.md',
      stateMap: 'state-map.md',
      actions: 'actions.md',
      recovery: 'recovery.md',
      manifest: 'docs-manifest.json',
    },
    documents: docs.map((doc) => ({
      intentId: doc.intentId ?? null,
      title: doc.title,
      path: path.join(step6Dir, doc.file),
    })),
  });
  sources.push({
    step: 'step-6-docs',
    runId: 'run',
    rawDir: path.relative(kbDir, step6Dir),
  });

  await writeJson(path.join(step7Dir, 'risk-taxonomy.json'), { generatedAt, categories: [] });
  await writeJson(path.join(step7Dir, 'approval-rules.json'), { generatedAt, rules: [] });
  await writeJson(path.join(step7Dir, 'recovery-rules.json'), { generatedAt, rules: [] });
  await writeText(path.join(step7Dir, 'recovery.md'), recoveryMd);
  await writeText(path.join(step7Dir, 'approval-checkpoints.md'), approvalMd);
  sources.push({
    step: 'step-7-governance',
    runId: 'run',
    rawDir: path.relative(kbDir, step7Dir),
  });

  if (bookContent) {
    const stepBookDir = rawDirFor('step-book-content');
    await writeJson(path.join(stepBookDir, 'book-content-manifest.json'), {
      inputUrl,
      baseUrl,
      generatedAt,
      files: {
        books: 'books.json',
        authors: 'authors.json',
        searchResults: 'search-results.json',
        manifest: 'book-content-manifest.json',
      },
    });
    await writeJson(path.join(stepBookDir, 'books.json'), bookContent.books ?? []);
    await writeJson(path.join(stepBookDir, 'authors.json'), bookContent.authors ?? []);
    await writeJson(path.join(stepBookDir, 'search-results.json'), bookContent.searchResults ?? []);
    sources.push({
      step: 'step-book-content',
      runId: 'run',
      rawDir: path.relative(kbDir, stepBookDir),
    });
  }

  await writeJson(path.join(kbDir, 'index', 'sources.json'), {
    inputUrl,
    baseUrl,
    generatedAt,
    activeSources: sources,
  });
  await writeJson(path.join(kbDir, 'index', 'pages.json'), {
    pages: pageIndex,
  });
  await writeText(path.join(kbDir, 'wiki', 'README.md'), wikiReadme);
  await writeText(path.join(kbDir, 'wiki', 'concepts', 'interaction-model.md'), interactionModelMd);
  await writeText(path.join(kbDir, 'wiki', 'concepts', 'nl-entry.md'), nlEntryMd);
  await writeText(path.join(kbDir, 'schema', 'AGENTS.md'), '# Agents');
  await writeJson(path.join(kbDir, 'schema', 'naming-rules.json'), { rules: [] });
  await writeJson(path.join(kbDir, 'schema', 'evidence-rules.json'), { rules: [] });

  return {
    kbDir,
    sources,
  };
}
