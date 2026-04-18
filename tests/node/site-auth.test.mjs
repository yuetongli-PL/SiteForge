import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { readJsonFile } from '../../lib/io.mjs';
import {
  derivePersistentProfileKey,
  inspectPersistentProfileHealth,
  resolvePersistentUserDataDir,
} from '../../lib/browser-runtime/profile-store.mjs';
import { resolveSiteBrowserSessionOptions } from '../../lib/site-auth.mjs';

test('derivePersistentProfileKey groups bilibili subdomains under the same persistent profile key', () => {
  assert.equal(derivePersistentProfileKey('https://www.bilibili.com/'), 'bilibili.com');
  assert.equal(derivePersistentProfileKey('https://search.bilibili.com/video?keyword=BV1WjDDBGE3p'), 'bilibili.com');
  assert.equal(derivePersistentProfileKey('https://space.bilibili.com/1202350411/video'), 'bilibili.com');
});

test('resolvePersistentUserDataDir keeps bilibili subdomains on one shared directory', () => {
  const rootDir = path.resolve('tmp-browser-profiles');
  assert.equal(
    resolvePersistentUserDataDir('https://www.bilibili.com/', { rootDir }),
    path.join(rootDir, 'bilibili.com'),
  );
  assert.equal(
    resolvePersistentUserDataDir('https://space.bilibili.com/1202350411/fans/follow', { rootDir }),
    path.join(rootDir, 'bilibili.com'),
  );
});

test('resolveSiteBrowserSessionOptions honors bilibili authSession defaults', async () => {
  const siteProfile = await readJsonFile(path.resolve('profiles/www.bilibili.com.json'));
  const sessionOptions = await resolveSiteBrowserSessionOptions('https://www.bilibili.com/', {
    browserProfileRoot: path.resolve('tmp-browser-profiles'),
  }, {
    siteProfile,
    profilePath: path.resolve('profiles/www.bilibili.com.json'),
  });

  assert.equal(sessionOptions.reuseLoginState, true);
  assert.equal(sessionOptions.userDataDir, path.resolve('tmp-browser-profiles', 'bilibili.com'));
  assert.equal(sessionOptions.cleanupUserDataDirOnShutdown, false);
  assert.equal(sessionOptions.authConfig.loginUrl, 'https://passport.bilibili.com/login');
});

test('inspectPersistentProfileHealth flags crashed Chrome profiles as unhealthy', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'bwk-profile-health-'));

  try {
    await mkdir(path.join(workspace, 'Default', 'Network'), { recursive: true });
    await mkdir(path.join(workspace, 'Default', 'Sessions'), { recursive: true });
    await writeFile(path.join(workspace, 'Local State'), '{}', 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Preferences'), JSON.stringify({
      profile: {
        exit_type: 'Crashed',
      },
      sessions: {
        session_data_status: 1,
      },
    }), 'utf8');
    await writeFile(path.join(workspace, 'Default', 'Network', 'Cookies'), 'cookie-db', 'utf8');

    const health = await inspectPersistentProfileHealth(workspace);
    assert.equal(health.healthy, false);
    assert.equal(health.lastExitType, 'Crashed');
    assert.match(health.warnings.join('\n'), /last exit type was Crashed/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
