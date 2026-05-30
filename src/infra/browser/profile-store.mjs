import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { existsSync } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';

import { sanitizeHost } from '../../shared/normalize.mjs';

function resolveHostname(input) {
  if (!input) {
    return null;
  }
  try {
    return new URL(String(input)).hostname || null;
  } catch {
    return String(input).trim() || null;
  }
}

function isIpLikeHost(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(String(hostname || ''))
    || String(hostname || '').includes(':');
}

export function derivePersistentProfileKey(input) {
  const hostname = resolveHostname(input);
  if (!hostname) {
    return 'default';
  }

  const normalized = hostname.toLowerCase();
  if (isIpLikeHost(normalized)) {
    return sanitizeHost(normalized);
  }

  const labels = normalized.split('.').filter(Boolean);
  if (labels.length >= 2) {
    return sanitizeHost(labels.slice(-2).join('.'));
  }
  return sanitizeHost(normalized);
}

function resolvePersistentBrowserRootBrandPaths({
  platform = process.platform,
  homeDir = os.homedir(),
  localAppData = process.env.LOCALAPPDATA,
  xdgStateHome = process.env.XDG_STATE_HOME,
} = /** @type {any} */ ({})) {
  if (platform === 'win32') {
    const appDataRoot = localAppData || path.win32.join(homeDir, 'AppData', 'Local');
    return {
      preferred: path.win32.join(appDataRoot, 'SiteForge', 'browser-profiles'),
      legacy: path.win32.join(appDataRoot, 'Browser-Wiki-Skill', 'browser-profiles'),
    };
  }
  if (platform === 'darwin') {
    const appSupportRoot = path.posix.join(homeDir, 'Library', 'Application Support');
    return {
      preferred: path.posix.join(appSupportRoot, 'SiteForge', 'browser-profiles'),
      legacy: path.posix.join(appSupportRoot, 'Browser-Wiki-Skill', 'browser-profiles'),
    };
  }
  const stateRoot = xdgStateHome || path.posix.join(homeDir, '.local', 'state');
  return {
    preferred: path.posix.join(stateRoot, 'siteforge', 'browser-profiles'),
    legacy: path.posix.join(stateRoot, 'browser-wiki-skill', 'browser-profiles'),
  };
}

export function resolvePersistentUserDataDir(input, {
  rootDir,
  brandPaths = resolvePersistentBrowserRootBrandPaths(),
} = /** @type {any} */ ({})) {
  const profileKey = derivePersistentProfileKey(input);
  if (rootDir !== undefined && rootDir !== null) {
    return path.resolve(rootDir, profileKey);
  }

  const { preferred, legacy } = brandPaths;
  const preferredProfileDir = path.resolve(preferred, profileKey);
  const legacyProfileDir = path.resolve(legacy, profileKey);
  if (existsSync(legacyProfileDir) && !existsSync(preferredProfileDir)) {
    return legacyProfileDir;
  }

  return preferredProfileDir;
}

const PROFILE_HEALTH_TARGETS = [
  ['Local State'],
  ['Default', 'Preferences'],
  ['Default', 'Network', 'Cookies'],
  ['Default', 'Sessions'],
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileOrNull(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function collectPathSnapshot(rootDir, segments) {
  const filePath = path.join(rootDir, ...segments);
  try {
    const fileStat = await stat(filePath);
    return {
      path: filePath,
      exists: true,
      isDirectory: fileStat.isDirectory(),
      size: Number(fileStat.size ?? 0),
      mtimeMs: Number(fileStat.mtimeMs ?? 0),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      isDirectory: false,
      size: null,
      mtimeMs: null,
    };
  }
}

function buildSnapshotSignature(entries) {
  return entries
    .map((entry) => `${entry.path}:${entry.exists ? '1' : '0'}:${entry.isDirectory ? 'd' : 'f'}:${entry.size ?? 'x'}:${entry.mtimeMs ?? 'x'}`)
    .join('|');
}

function classifyPersistentProfileLifecycle({ exists, missingPaths = /** @type {any[]} */ ([]), suspiciousExit = false } = /** @type {any} */ ({})) {
  if (!exists) {
    return 'missing';
  }
  if (suspiciousExit) {
    return 'crashed';
  }
  if (missingPaths.length > 0) {
    return 'uninitialized';
  }
  return 'healthy';
}

export async function inspectPersistentProfileHealth(userDataDir) {
  const resolvedDir = path.resolve(userDataDir);
  const exists = await pathExists(resolvedDir);
  const snapshots = await Promise.all(
    PROFILE_HEALTH_TARGETS.map((segments) => collectPathSnapshot(resolvedDir, segments)),
  );
  const missingPaths = snapshots.filter((entry) => !entry.exists).map((entry) => entry.path);
  const preferences = await readJsonFileOrNull(path.join(resolvedDir, 'Default', 'Preferences'));
  const exitType = String(preferences?.profile?.exit_type ?? '').trim() || null;
  const sessionDataStatus = preferences?.sessions?.session_data_status ?? null;
  const suspiciousExit = Boolean(exitType && !/^normal$/iu.test(exitType));
  const profileLifecycle = classifyPersistentProfileLifecycle({ exists, missingPaths, suspiciousExit });
  const warnings = /** @type {any[]} */ ([]);

  if (!exists) {
    warnings.push(`Persistent browser profile directory does not exist yet: ${resolvedDir}`);
  }
  if (missingPaths.length > 0) {
    warnings.push(`Persistent browser profile is missing expected paths: ${missingPaths.join(', ')}`);
  }
  if (suspiciousExit) {
    warnings.push(`Persistent browser profile last exit type was ${exitType}.`);
  }

  return {
    userDataDir: resolvedDir,
    exists,
    healthy: exists && missingPaths.length === 0 && !suspiciousExit,
    profileLifecycle,
    requiresProfileRebuild: profileLifecycle === 'crashed',
    missingPaths,
    lastExitType: exitType,
    sessionDataStatus,
    warnings,
    snapshots,
  };
}

export async function waitForPersistentProfileFlush(
  userDataDir,
  {
    timeoutMs = 3_000,
    settleMs = 600,
    pollMs = 150,
  } = /** @type {any} */ ({}),
) {
  const resolvedDir = path.resolve(userDataDir);
  const exists = await pathExists(resolvedDir);
  if (!exists) {
    return {
      userDataDir: resolvedDir,
      stable: false,
      timedOut: false,
      reason: 'profile-missing',
      snapshots: [],
    };
  }

  const deadline = Date.now() + timeoutMs;
  let snapshots = await Promise.all(
    PROFILE_HEALTH_TARGETS.map((segments) => collectPathSnapshot(resolvedDir, segments)),
  );
  let signature = buildSnapshotSignature(snapshots);
  let lastChangedAt = Date.now();

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    snapshots = await Promise.all(
      PROFILE_HEALTH_TARGETS.map((segments) => collectPathSnapshot(resolvedDir, segments)),
    );
    const nextSignature = buildSnapshotSignature(snapshots);
    if (nextSignature !== signature) {
      signature = nextSignature;
      lastChangedAt = Date.now();
      continue;
    }
    if (Date.now() - lastChangedAt >= settleMs) {
      return {
        userDataDir: resolvedDir,
        stable: true,
        timedOut: false,
        reason: 'stable',
        snapshots,
      };
    }
  }

  return {
    userDataDir: resolvedDir,
    stable: false,
    timedOut: true,
    reason: 'timeout',
    snapshots,
  };
}
