import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import {
  cleanupUserDataDir,
  parseDevToolsActivePortContent,
  shutdownBrowser,
} from '../../lib/browser-runtime/launcher.mjs';
import { waitForPersistentProfileFlush } from '../../lib/browser-runtime/profile-store.mjs';

test('cleanupUserDataDir retries transient lock errors and does not throw', async () => {
  let attempts = 0;

  await cleanupUserDataDir('C:\\temp\\browser-runtime-lock', async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('resource busy');
      error.code = 'EBUSY';
      throw error;
    }
  });

  assert.equal(attempts, 3);
});

test('cleanupUserDataDir ignores persistent transient cleanup errors', async () => {
  let attempts = 0;

  await cleanupUserDataDir('C:\\temp\\browser-runtime-stuck', async () => {
    attempts += 1;
    const error = new Error('permission denied');
    error.code = 'EPERM';
    throw error;
  });

  assert.equal(attempts, 6);
});

function createFakeBrowserProcess() {
  const emitter = new EventEmitter();
  emitter.exitCode = null;
  emitter.killCalls = [];
  emitter.kill = (signal) => {
    emitter.killCalls.push(signal ?? 'SIGTERM');
    emitter.exitCode = signal === 'SIGKILL' ? 137 : 0;
    queueMicrotask(() => emitter.emit('exit', emitter.exitCode));
  };
  return emitter;
}

test('shutdownBrowser prefers graceful Browser.close exit before forcing kill', async () => {
  const browserProcess = createFakeBrowserProcess();

  const result = await shutdownBrowser(browserProcess, null, {
    cleanupUserDataDirOnShutdown: false,
    waitForProfileFlushOnShutdown: false,
    gracefulClose: async () => {
      browserProcess.exitCode = 0;
      queueMicrotask(() => browserProcess.emit('exit', 0));
    },
  });

  assert.equal(result.shutdownMode, 'graceful');
  assert.deepEqual(browserProcess.killCalls, []);
});

test('shutdownBrowser falls back to forced termination when graceful close stalls', async () => {
  const browserProcess = createFakeBrowserProcess();

  const result = await shutdownBrowser(browserProcess, null, {
    cleanupUserDataDirOnShutdown: false,
    waitForProfileFlushOnShutdown: false,
    gracefulClose: async () => {},
    gracefulExitTimeoutMs: 10,
    forceKillTimeoutMs: 50,
  });

  assert.equal(result.shutdownMode, 'forced');
  assert.deepEqual(browserProcess.killCalls, ['SIGTERM']);
});

test('waitForPersistentProfileFlush reports stable persistent profile files', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-flush-'));

  try {
    await mkdir(path.join(workspace, 'Default', 'Network'), { recursive: true });
    await mkdir(path.join(workspace, 'Default', 'Sessions'), { recursive: true });
    await writeFile(path.join(workspace, 'Local State'), '{}', 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Preferences'), '{"profile":{"exit_type":"Normal"}}', 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Network', 'Cookies'), 'cookie-db', 'utf8');

    const result = await waitForPersistentProfileFlush(workspace, {
      timeoutMs: 1_000,
      settleMs: 100,
      pollMs: 25,
    });

    assert.equal(result.stable, true);
    assert.equal(result.reason, 'stable');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('parseDevToolsActivePortContent prefers websocket path from DevToolsActivePort file', () => {
  const parsed = parseDevToolsActivePortContent('64623\n/devtools/browser/8210564c-0faa-4d3e-8c3a-9c19d40fafb3\n');
  assert.deepEqual(parsed, {
    port: 64623,
    wsUrl: 'ws://127.0.0.1:64623/devtools/browser/8210564c-0faa-4d3e-8c3a-9c19d40fafb3',
  });
});
