// @ts-check

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathExists } from '../io.mjs';
import { validateProfileFile } from '../profile-validation.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILES_DIR = path.resolve(MODULE_DIR, '..', '..', 'profiles');

function resolveHostname(hostOrUrl) {
  if (!hostOrUrl) {
    return null;
  }
  try {
    return new URL(hostOrUrl).hostname;
  } catch {
    return String(hostOrUrl).trim() || null;
  }
}

function createProfileHash(raw) {
  return createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

export function resolveProfilesDir(options = {}) {
  return path.resolve(options.profilesDir ?? DEFAULT_PROFILES_DIR);
}

export function resolveProfilePathForHost(host, options = {}) {
  const hostname = resolveHostname(host);
  if (!hostname) {
    return null;
  }
  if (options.profilePath) {
    return path.resolve(options.profilePath);
  }
  return path.join(resolveProfilesDir(options), `${hostname}.json`);
}

export function resolveProfilePathForUrl(inputUrl, options = {}) {
  return resolveProfilePathForHost(inputUrl, options);
}

export async function loadValidatedProfile(profilePath) {
  const validation = await validateProfileFile(profilePath);
  return {
    ...validation,
    json: validation.profile,
    hash: createProfileHash(validation.raw),
  };
}

export async function maybeLoadValidatedProfileForHost(host, options = {}) {
  const profilePath = resolveProfilePathForHost(host, options);
  if (!profilePath || !await pathExists(profilePath)) {
    return null;
  }
  return loadValidatedProfile(profilePath);
}

export async function maybeLoadValidatedProfileForUrl(inputUrl, options = {}) {
  return maybeLoadValidatedProfileForHost(inputUrl, options);
}

export async function loadValidatedProfileForHost(host, options = {}) {
  const profilePath = resolveProfilePathForHost(host, options);
  if (!profilePath) {
    throw new Error(`Missing site profile host: ${host}`);
  }
  if (!await pathExists(profilePath)) {
    throw new Error(`Missing site profile: ${profilePath}`);
  }
  return loadValidatedProfile(profilePath);
}

export async function loadValidatedProfileForUrl(inputUrl, options = {}) {
  return loadValidatedProfileForHost(inputUrl, options);
}
