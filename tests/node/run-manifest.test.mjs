import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';

import {
  buildRunManifest,
  getManifestArtifact,
  getManifestArtifactDir,
  getManifestArtifactPath,
  getManifestArtifactValue,
  getManifestRunContext,
} from '../../src/pipeline/engine/run-manifest.mjs';
import {
  resolveLinkedArtifactManifest,
  resolveNamedManifest,
  resolveStageInput,
} from '../../src/pipeline/artifacts/index.mjs';

test('buildRunManifest preserves legacy source compatibility from upstream artifacts', () => {
  const manifest = buildRunManifest({
    inputUrl: 'https://jable.tv/',
    baseUrl: 'https://jable.tv/',
    generatedAt: '2026-04-15T00:00:00.000Z',
    outDir: 'C:\\tmp\\docs',
    summary: { documents: 3 },
    files: { manifest: 'docs-manifest.json' },
    upstream: {
      analysis: {
        manifest: 'analysis-manifest.json',
        dir: 'state-analysis\\run-1',
      },
      expandedStates: {
        manifest: 'states-manifest.json',
        dir: 'expanded-states\\run-1',
      },
    },
  });

  assert.equal(manifest.run.inputUrl, 'https://jable.tv/');
  assert.equal(manifest.source.analysisManifest, 'analysis-manifest.json');
  assert.equal(manifest.source.analysisDir, 'state-analysis\\run-1');
  assert.equal(manifest.source.statesManifest, 'states-manifest.json');
  assert.equal(manifest.source.expandedStatesDir, 'expanded-states\\run-1');
});

test('run-manifest resolves legacy source-only artifacts', () => {
  const manifest = {
    inputUrl: 'https://jable.tv/',
    baseUrl: 'https://jable.tv/',
    generatedAt: '2026-04-15T00:00:00.000Z',
    source: {
      analysisManifest: 'artifacts\\analysis-manifest.json',
      analysisDir: 'artifacts\\analysis',
    },
  };

  const artifact = getManifestArtifact(manifest, 'analysis');
  assert.deepEqual(artifact, {
    manifest: 'artifacts\\analysis-manifest.json',
    dir: 'artifacts\\analysis',
  });
  assert.equal(getManifestArtifactValue(manifest, 'analysis', 'manifest'), 'artifacts\\analysis-manifest.json');
});

test('run-manifest prefers new upstream fields and falls back to legacy source fields when mixed', () => {
  const manifest = {
    run: {
      inputUrl: 'https://moodyz.com/works/date',
      baseUrl: 'https://moodyz.com/works/date',
      generatedAt: '2026-04-15T10:00:00.000Z',
    },
    inputUrl: 'https://old.example.invalid/',
    upstream: {
      analysis: {
        dir: 'upstream\\analysis',
        manifest: 'upstream\\analysis-manifest.json',
      },
    },
    source: {
      analysisDir: 'legacy\\analysis',
      analysisManifest: 'legacy\\analysis-manifest.json',
      abstractionDir: 'legacy\\abstraction',
    },
  };

  assert.deepEqual(getManifestRunContext(manifest, { inputUrl: 'fallback' }), {
    inputUrl: 'https://moodyz.com/works/date',
    baseUrl: 'https://moodyz.com/works/date',
    generatedAt: '2026-04-15T10:00:00.000Z',
  });

  assert.deepEqual(getManifestArtifact(manifest, 'analysis'), {
    dir: 'upstream\\analysis',
    manifest: 'upstream\\analysis-manifest.json',
  });
  assert.deepEqual(getManifestArtifact(manifest, 'abstraction'), {
    dir: 'legacy\\abstraction',
  });
});

test('run-manifest resolves artifact paths relative to a base directory', () => {
  const baseDir = path.join('C:\\tmp', 'docs-run');
  const manifest = {
    upstream: {
      nlEntry: {
        manifest: 'nl-entry\\nl-entry-manifest.json',
      },
    },
    source: {
      docsDir: 'docs\\run-1',
    },
  };

  assert.equal(
    getManifestArtifactPath(manifest, 'nlEntry', 'manifest', baseDir),
    path.resolve(baseDir, 'nl-entry\\nl-entry-manifest.json'),
  );
  assert.equal(
    getManifestArtifactDir(manifest, 'docs', baseDir),
    path.resolve(baseDir, 'docs\\run-1'),
  );
});

test('resolveNamedManifest dual-reads a legacy pipeline dir when caller provides runs path', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-runs-dual-read-manifest-'));

  try {
    const legacyDir = path.join(workspace, 'captures', 'run-1');
    await mkdir(legacyDir, { recursive: true });
    const legacyManifestPath = path.join(legacyDir, 'capture-manifest.json');
    await writeFile(legacyManifestPath, '{}');

    const resolved = await resolveNamedManifest(
      path.join(workspace, 'runs', 'pipeline', 'captures', 'run-1'),
      ['capture-manifest.json'],
    );

    assert.equal(resolved, legacyManifestPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveStageInput dual-reads a runs pipeline dir when caller provides legacy path', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-runs-dual-read-input-'));

  try {
    const runsDir = path.join(workspace, 'runs', 'pipeline', 'expanded-states', 'run-1');
    await mkdir(runsDir, { recursive: true });
    const runsManifestPath = path.join(runsDir, 'states-manifest.json');
    await writeFile(runsManifestPath, '{}');

    const resolved = await resolveStageInput({
      expandedStatesDir: path.join(workspace, 'expanded-states', 'run-1'),
    }, {
      manifestOption: 'expandedStatesManifest',
      dirOption: 'expandedStatesDir',
      manifestName: 'states-manifest.json',
      missingArgsMessage: 'missing',
      missingManifestMessagePrefix: 'manifest:',
      missingDirMessagePrefix: 'dir:',
    });

    assert.equal(resolved.dir, runsDir);
    assert.equal(resolved.manifestPath, runsManifestPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('resolveLinkedArtifactManifest dual-reads opposite runs/legacy layouts from manifest source paths', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-runs-dual-read-linked-'));

  try {
    const runsDir = path.join(workspace, 'runs', 'pipeline', 'state-analysis', 'run-1');
    await mkdir(runsDir, { recursive: true });
    const runsManifestPath = path.join(runsDir, 'analysis-manifest.json');
    await writeFile(runsManifestPath, '{}');

    const manifest = {
      source: {
        analysisDir: path.join('state-analysis', 'run-1'),
        analysisManifest: path.join('state-analysis', 'run-1', 'analysis-manifest.json'),
      },
    };

    const resolved = await resolveLinkedArtifactManifest({
      manifest,
      artifactName: 'analysis',
      baseDir: workspace,
      artifactDir: path.join(workspace, 'state-analysis', 'run-1'),
      manifestName: 'analysis-manifest.json',
    });

    assert.equal(resolved, runsManifestPath);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
