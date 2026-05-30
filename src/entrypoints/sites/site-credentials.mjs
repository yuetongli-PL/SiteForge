// @ts-check

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { initializeCliUtf8, writeJsonStdout } from '../../infra/cli.mjs';
import { readCliValue } from '../../infra/cli/internal-options.mjs';
import {
  parseProgressCliOption,
  runSingleStageCliWithProgress,
} from '../../infra/cli/progress-cli.mjs';
import { resolveSiteAuthProfile } from '../../infra/auth/site-auth.mjs';
import { resolveProfilePathForUrl } from '../../sites/registry/core/profiles.mjs';
import {
  deleteWindowsCredential,
  getWindowsCredential,
  isWindowsCredentialManagerSupported,
  resolveWindowsCredentialTarget,
  setWindowsCredential,
} from '../../infra/auth/windows-credential-manager.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..');

const HELP = `Internal script usage:
  node src/entrypoints/sites/site-credentials.mjs <set|show|delete> <url> [options]

Public command:
  siteforge build <url>

Notes:
  - Credentials are stored in Windows Credential Manager as Generic Credentials.
  - show only returns target metadata and username; it never prints the stored password.
`;

function mergeOptions(inputUrl, options = /** @type {any} */ ({})) {
  const merged = { ...options };
  merged.profilePath = merged.profilePath
    ? path.resolve(merged.profilePath)
    : resolveProfilePathForUrl(inputUrl, { profilesDir: path.join(REPO_ROOT, 'profiles') });
  merged.username = merged.username ? String(merged.username).trim() : undefined;
  merged.password = merged.password === undefined ? undefined : String(merged.password);
  return merged;
}

export function parseCliArgs(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }

  const [action, inputUrl, ...rest] = argv;
  const options = /** @type {any} */ ({});
  const readValue = (index) => readCliValue(rest, index, rest[index]);

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const progressOption = parseProgressCliOption(rest, token, index, options);
    if (progressOption.handled) {
      index = progressOption.nextIndex;
      continue;
    }
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

export async function siteCredentials(action, inputUrl, options = /** @type {any} */ ({}), deps = /** @type {any} */ ({})) {
  if (!(deps.isWindowsCredentialManagerSupported ?? isWindowsCredentialManagerSupported)()) {
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
        comment: `SiteForge login for ${authProfile?.profile?.host ?? inputUrl}`,
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

export async function runCli(argv = process.argv.slice(2), deps = /** @type {any} */ ({})) {
  (deps.initializeCliUtf8 ?? initializeCliUtf8)();
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    (deps.stdout ?? process.stdout).write(`${HELP}\n`);
    return;
  }
  const report = await (deps.runSingleStageCliWithProgress ?? runSingleStageCliWithProgress)({
    inputUrl: parsed.inputUrl,
    options: parsed.options,
    taskId: 'siteCredentials',
    title: 'Site credentials',
    stageId: 'siteCredentials',
    stageTitle: `Credential ${parsed.action}`,
    run: (stageOptions) => (deps.siteCredentials ?? siteCredentials)(parsed.action, parsed.inputUrl, stageOptions),
    successMessage: (result) => result?.action,
    isFailureResult: (result) => (
      parsed.action === 'set' && result?.stored !== true
    ) || (
      parsed.action === 'delete' && result?.deleted !== true && result?.found !== false
    ),
    failureReason: (result) => result?.action ?? 'credential action failed',
    failureTitle: 'Site credential action failed',
  });
  (deps.writeJsonStdout ?? writeJsonStdout)(report);
  if ((parsed.action === 'set' && report.stored !== true) || (parsed.action === 'delete' && report.deleted !== true && report.found !== false)) {
    process.exitCode = 1;
  }
  return report;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  });
}
