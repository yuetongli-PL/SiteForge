// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { resolveSiteAuthProfile } from '../../infra/auth/site-auth.mjs';
import { resolveProfilePathForUrl } from '../../sites/core/profiles.mjs';
import {
  deleteWindowsCredential,
  getWindowsCredential,
  isWindowsCredentialManagerSupported,
  resolveWindowsCredentialTarget,
  setWindowsCredential,
} from '../../infra/auth/windows-credential-manager.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const HELP = `Usage:
  node src/entrypoints/sites/site-credentials.mjs <set|show|delete> <url> [--profile-path <path>] [--username <value>] [--password <value>]

Notes:
  - Credentials are stored in Windows Credential Manager as Generic Credentials.
  - show only returns target metadata and username; it never prints the stored password.
`;

function mergeOptions(inputUrl, options = {}) {
  const merged = { ...options };
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.join(REPO_ROOT, 'profiles') });
  merged.username = merged.username ? String(merged.username).trim() : undefined;
  merged.password = merged.password === undefined ? undefined : String(merged.password);
  return merged;
}

function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }

  const [action, inputUrl, ...rest] = argv;
  const options = {};
  const readValue = (index) => {
    if (index + 1 >= rest.length) {
      throw new Error(`Missing value for ${rest[index]}`);
    }
    return { value: rest[index + 1], nextIndex: index + 1 };
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    switch (token) {
      case '--profile-path': {
        const { value, nextIndex } = readValue(index);
        options.profilePath = value;
        index = nextIndex;
        break;
      }
      case '--username': {
        const { value, nextIndex } = readValue(index);
        options.username = value;
        index = nextIndex;
        break;
      }
      case '--password': {
        const { value, nextIndex } = readValue(index);
        options.password = value;
        index = nextIndex;
        break;
      }
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return { help: false, action, inputUrl, options };
}

export async function siteCredentials(action, inputUrl, options = {}, deps = {}) {
  if (!isWindowsCredentialManagerSupported()) {
    throw new Error('Windows Credential Manager is only supported on Windows.');
  }

  const normalizedAction = String(action ?? '').trim().toLowerCase();
  if (!['set', 'show', 'delete'].includes(normalizedAction)) {
    throw new Error(`Unsupported credential action: ${action}`);
  }

  const settings = mergeOptions(inputUrl, options);
  const authProfile = await (deps.resolveSiteAuthProfile ?? resolveSiteAuthProfile)(inputUrl, {
    profilePath: settings.profilePath,
  });
  const target = resolveWindowsCredentialTarget(authProfile?.profile?.host ?? inputUrl, {
    credentialTarget: authProfile?.profile?.authSession?.credentialTarget ?? null,
  });

  if (normalizedAction === 'set') {
    if (!settings.username) {
      throw new Error('Missing --username for credential set.');
    }
    if (!settings.password) {
      throw new Error('Missing --password for credential set.');
    }
    const stored = await (deps.setWindowsCredential ?? setWindowsCredential)(
      target,
      {
        username: settings.username,
        password: settings.password,
        comment: `Browser-Wiki-Skill login for ${authProfile?.profile?.host ?? inputUrl}`,
      },
      deps.credentialManagerDeps ?? {},
    );
    return {
      action: 'set',
      target,
      host: authProfile?.profile?.host ?? null,
      profilePath: settings.profilePath,
      stored: stored.stored === true,
      username: stored.username ?? settings.username,
    };
  }

  if (normalizedAction === 'show') {
    const credential = await (deps.getWindowsCredential ?? getWindowsCredential)(
      target,
      deps.credentialManagerDeps ?? {},
    );
    return {
      action: 'show',
      target,
      host: authProfile?.profile?.host ?? null,
      profilePath: settings.profilePath,
      found: credential.found === true,
      username: credential.username ?? null,
      comment: credential.comment ?? null,
    };
  }

  const removed = await (deps.deleteWindowsCredential ?? deleteWindowsCredential)(
    target,
    deps.credentialManagerDeps ?? {},
  );
  return {
    action: 'delete',
    target,
    host: authProfile?.profile?.host ?? null,
    profilePath: settings.profilePath,
    deleted: removed.deleted === true,
    found: removed.found !== false,
  };
}

async function runCli() {
  initializeCliUtf8();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const report = await siteCredentials(parsed.action, parsed.inputUrl, parsed.options);
  writeJsonStdout(report);
  if ((parsed.action === 'set' && report.stored !== true) || (parsed.action === 'delete' && report.deleted !== true && report.found !== false)) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
