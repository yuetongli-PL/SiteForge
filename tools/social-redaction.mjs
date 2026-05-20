// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  prepareRedactedArtifactJsonWithAudit,
  REDACTION_PLACEHOLDER,
} from '../src/domain/sessions/security-guard.mjs';

const WINDOWS_ABSOLUTE_PATH_RE = /(?:^|[\s"'=])[A-Za-z]:[\\/]/u;
const UNC_PATH_RE = /\\\\[^\\/\s]+[\\/][^\\/\s]+/u;
const POSIX_LOCAL_PATH_RE = /\/(?:Users|home|var|tmp|private|mnt|Volumes)\//u;

export function socialManifestRedactionAuditPath(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (/\.json$/iu.test(resolvedPath)) {
    return resolvedPath.replace(/\.json$/iu, '.redaction-audit.json');
  }
  return `${resolvedPath}.redaction-audit.json`;
}

function pathToString(pathSegments = []) {
  return pathSegments.length ? pathSegments.join('.') : '$';
}

function containsLocalPath(value) {
  const text = String(value ?? '');
  return WINDOWS_ABSOLUTE_PATH_RE.test(text)
    || UNC_PATH_RE.test(text)
    || POSIX_LOCAL_PATH_RE.test(text);
}

export function redactSocialManifestValue(value, pathSegments = [], audit = {
  redactedPaths: [],
  redactions: [],
}) {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSocialManifestValue(item, [...pathSegments, String(index)], audit));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = redactSocialManifestValue(child, [...pathSegments, key], audit);
    }
    return output;
  }
  if (typeof value === 'string' && containsLocalPath(value)) {
    const redactionPath = pathToString(pathSegments);
    audit.redactedPaths.push(redactionPath);
    audit.redactions.push({
      path: redactionPath,
      reason: 'local-path',
    });
    return REDACTION_PLACEHOLDER;
  }
  return value;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function prepareSocialManifestJsonWithAudit(value) {
  const localPathAudit = {
    redactedPaths: [],
    redactions: [],
  };
  const localPathRedactedValue = redactSocialManifestValue(value, [], localPathAudit);
  const prepared = prepareRedactedArtifactJsonWithAudit(localPathRedactedValue);
  const auditValue = {
    ...prepared.auditValue,
    redactedPaths: uniqueStrings([
      ...(prepared.auditValue.redactedPaths ?? []),
      ...localPathAudit.redactedPaths,
    ]),
    redactions: [
      ...(prepared.auditValue.redactions ?? []),
      ...localPathAudit.redactions,
    ],
  };
  return {
    json: prepared.json,
    value: prepared.value,
    auditJson: `${JSON.stringify(auditValue, null, 2)}\n`,
    auditValue,
  };
}

export async function writeSocialManifestJsonWithAudit(filePath, value) {
  const auditPath = socialManifestRedactionAuditPath(filePath);
  const prepared = prepareSocialManifestJsonWithAudit(value);
  await mkdir(path.dirname(filePath), { recursive: true });
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, prepared.auditJson, 'utf8');
  await writeFile(filePath, prepared.json, 'utf8');
  return {
    filePath,
    redactionAuditPath: auditPath,
    value: prepared.value,
    audit: prepared.auditValue,
  };
}
