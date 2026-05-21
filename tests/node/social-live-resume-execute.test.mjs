import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getNextCooldownMs,
  parseArgs,
  runResumeLoop,
} from '../../scripts/social-live-resume.mjs';

async function withTempDir(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'bwk-social-resume-execute-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function manifest(overrides = /** @type {any} */ ({})) {
  return {
    runId: 'run-1',
    results: [{
      id: 'x-full-archive',
      site: 'x',
      status: 'passed',
      command: 'node src/entrypoints/sites/x-action.mjs full-archive openai --run-dir runs/x',
      finishedAt: '2026-04-26T00:00:00.000Z',
      artifactSummary: {
        verdict: 'passed',
        reason: 'max-items',
        archive: { complete: false, reason: 'max-items' },
      },
      ...overrides,
    }],
  };
}

test('social-live-resume execute loop waits cooldown then rereads completed manifest', async (t) => {
  const rootDir = await withTempDir(t);
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');

  const sleeps = /** @type {any[]} */ ([]);
  const commands = /** @type {any[]} */ ([]);
  const result = await runResumeLoop(parseArgs([
    '--state',
    manifestPath,
    '--auto-execute',
    '--cooldown-minutes',
    '30',
    '--max-attempts',
    '3',
    '--max-cycles',
    '5',
    '--run-root',
    path.join(rootDir, 'resume-runs'),
  ]), {
    now: (() => {
      const dates = [
        new Date('2026-04-26T00:10:00.000Z'),
        new Date('2026-04-26T00:31:00.000Z'),
        new Date('2026-04-26T00:32:00.000Z'),
      ];
      return () => dates.shift() ?? new Date('2026-04-26T00:33:00.000Z');
    })(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    commandRunner: async (command) => {
      commands.push(command);
      await writeFile(manifestPath, `${JSON.stringify(manifest({
        status: 'passed',
        artifactSummary: {
          verdict: 'passed',
          reason: 'complete',
          archive: { complete: true, reason: 'complete' },
        },
      }), null, 2)}\n`, 'utf8');
      return { manifestPath };
    },
  });

  assert.deepEqual(sleeps, [20 * 60_000]);
  assert.equal(commands.length, 1);
  assert.match(commands[0], /full-archive openai/u);
  assert.match(commands[0], /--session-health-plan/u);
  assert.equal(result.stopReason, 'complete');
  assert.equal(result.attempts, 1);
  assert.equal(result.cycles, 3);
});

test('social-live-resume execute loop stops at max attempts without rerunning stale state forever', async (t) => {
  const rootDir = await withTempDir(t);
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');

  const commands = /** @type {any[]} */ ([]);
  const result = await runResumeLoop(parseArgs([
    '--state',
    manifestPath,
    '--auto-execute',
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '2',
    '--max-cycles',
    '5',
    '--run-root',
    path.join(rootDir, 'resume-runs'),
  ]), {
    now: () => new Date('2026-04-26T00:31:00.000Z'),
    commandRunner: async (command) => {
      commands.push(command);
      return {};
    },
    sleep: async () => {
      throw new Error('sleep should not be called');
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(result.stopReason, 'max-attempts');
  assert.equal(result.attempts, 1);
});

test('social-live-resume execute loop stops at max cycles for repeatedly incomplete state', async (t) => {
  const rootDir = await withTempDir(t);
  const manifestPath = path.join(rootDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest(), null, 2)}\n`, 'utf8');

  const commands = /** @type {any[]} */ ([]);
  const result = await runResumeLoop(parseArgs([
    '--state',
    manifestPath,
    '--auto-execute',
    '--cooldown-minutes',
    '0',
    '--max-attempts',
    '5',
    '--max-cycles',
    '2',
    '--run-root',
    path.join(rootDir, 'resume-runs'),
  ]), {
    now: () => new Date('2026-04-26T00:31:00.000Z'),
    commandRunner: async (command) => {
      commands.push(command);
      return {};
    },
  });

  assert.equal(commands.length, 2);
  assert.equal(result.stopReason, 'max-cycles');
  assert.equal(result.attempts, 2);
});

test('social-live-resume exposes cooldown calculation as a pure helper', () => {
  assert.equal(getNextCooldownMs([
    { cooldownRemainingMs: 30_000 },
    { cooldownRemainingMs: 10_000 },
    { cooldownRemainingMs: 0 },
  ]), 10_000);
});
