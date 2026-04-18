import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { analyzeStates } from '../../analyze-states.mjs';
import { abstractInteractions } from '../../abstract-interactions.mjs';
import { buildNlEntry } from '../../nl-entry.mjs';

test('analyzeStates fails fast at the boundary when expanded states input is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-analyze-states-contract-'));

  try {
    await assert.rejects(
      () => analyzeStates('https://jable.tv/', {
        expandedStatesDir: path.join(workspace, 'missing-expanded'),
        outDir: path.join(workspace, 'analysis-out'),
      }),
      /Expanded states directory not found:/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('abstractInteractions fails fast at the boundary when analysis input is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-abstract-interactions-contract-'));

  try {
    await assert.rejects(
      () => abstractInteractions('https://jable.tv/', {
        analysisDir: path.join(workspace, 'missing-analysis'),
        outDir: path.join(workspace, 'abstraction-out'),
      }),
      /Analysis directory not found:/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('buildNlEntry fails fast at the boundary when abstraction input is missing', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-nl-entry-contract-'));

  try {
    await assert.rejects(
      () => buildNlEntry('https://jable.tv/', {
        abstractionDir: path.join(workspace, 'missing-abstraction'),
        outDir: path.join(workspace, 'nl-entry-out'),
      }),
      /Abstraction directory not found:/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
