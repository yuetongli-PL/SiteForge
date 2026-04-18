import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildRunManifest,
  getManifestArtifact,
  getManifestArtifactDir,
  getManifestArtifactPath,
  getManifestArtifactValue,
  getManifestRunContext,
} from '../../lib/pipeline/run-manifest.mjs';

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
