// @ts-check

import path from 'node:path';
import { pathExists, readJsonFile, writeJsonFile } from './io.mjs';
import { sanitizeHost, uniqueSortedStrings } from './normalize.mjs';

export const SITE_CAPABILITIES_FILE_NAME = 'site-capabilities.json';

export function buildSiteCapabilitiesPath(workspaceRoot = process.cwd()) {
  return path.resolve(workspaceRoot, SITE_CAPABILITIES_FILE_NAME);
}

export async function readSiteCapabilities(workspaceRoot = process.cwd()) {
  const capabilitiesPath = buildSiteCapabilitiesPath(workspaceRoot);
  if (!await pathExists(capabilitiesPath)) {
    return {
      version: 1,
      generatedAt: null,
      sites: {},
    };
  }
  const document = await readJsonFile(capabilitiesPath);
  document.version ??= 1;
  document.generatedAt ??= null;
  document.sites ??= {};
  return document;
}

export async function upsertSiteCapabilities(workspaceRoot, host, patch) {
  const capabilitiesPath = buildSiteCapabilitiesPath(workspaceRoot);
  const document = await readSiteCapabilities(workspaceRoot);
  const hostKey = sanitizeHost(host);
  const previous = document.sites?.[hostKey] ?? {};
  const next = {
    ...previous,
    ...patch,
    host: hostKey,
    pageTypes: uniqueSortedStrings([...(previous.pageTypes ?? []), ...(patch?.pageTypes ?? [])]),
    capabilityFamilies: uniqueSortedStrings([...(previous.capabilityFamilies ?? []), ...(patch?.capabilityFamilies ?? [])]),
    supportedIntents: uniqueSortedStrings([...(previous.supportedIntents ?? []), ...(patch?.supportedIntents ?? [])]),
    safeActionKinds: uniqueSortedStrings([...(previous.safeActionKinds ?? []), ...(patch?.safeActionKinds ?? [])]),
    approvalActionKinds: uniqueSortedStrings([...(previous.approvalActionKinds ?? []), ...(patch?.approvalActionKinds ?? [])]),
    updatedAt: new Date().toISOString(),
  };
  document.generatedAt = next.updatedAt;
  document.sites = {
    ...(document.sites ?? {}),
    [hostKey]: next,
  };
  await writeJsonFile(capabilitiesPath, document);
  return {
    capabilitiesPath,
    record: next,
  };
}
