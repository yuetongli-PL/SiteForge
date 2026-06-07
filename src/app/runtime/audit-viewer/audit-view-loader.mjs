// @ts-check

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  safeAuditViewRef,
} from './audit-view-sanitizer.mjs';

function digestText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24)}`;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Runtime audit bundle JSON is malformed'), {
      code: 'runtime.audit_view_input_invalid',
      sourceRef: safeAuditViewRef(label, 'runtime-audit-source'),
    });
  }
}

async function loadJsonFile(filePath, kind, { maxBytes = 1_000_000 } = {}) {
  const fileStat = await stat(filePath);
  if (fileStat.size > maxBytes) {
    throw Object.assign(new Error('Runtime audit bundle JSON exceeds size limit'), {
      code: 'runtime.audit_view_input_too_large',
      sourceRef: safeAuditViewRef(path.basename(filePath), 'runtime-audit-source'),
    });
  }
  const text = await readFile(filePath, 'utf8');
  return {
    value: parseJson(text, filePath),
    sourceSummary: {
      sourceRef: safeAuditViewRef(path.basename(filePath), 'runtime-audit-source'),
      kind,
      byteLength: Buffer.byteLength(text),
      digest: digestText(text),
    },
  };
}

export async function loadRuntimeAuditBundle(options = {}) {
  const {
    reportPath = null,
    auditEventsPath = null,
    providerResultPath = null,
    browserTracePath = null,
    artifactMetadataPath = null,
    maxBytes = 1_000_000,
  } = options;
  const bundle = {
    sourceSummaries: [],
  };
  if (reportPath) {
    const loaded = await loadJsonFile(reportPath, 'runtime_execution_report', { maxBytes });
    bundle.report = loaded.value;
    bundle.sourceSummaries.push(loaded.sourceSummary);
  }
  if (auditEventsPath) {
    const loaded = await loadJsonFile(auditEventsPath, 'runtime_audit_events', { maxBytes });
    bundle.auditEvents = Array.isArray(loaded.value) ? loaded.value : loaded.value.events;
    bundle.sourceSummaries.push(loaded.sourceSummary);
  }
  if (providerResultPath) {
    const loaded = await loadJsonFile(providerResultPath, 'provider_result_envelope', { maxBytes });
    bundle.providerResult = loaded.value;
    bundle.sourceSummaries.push(loaded.sourceSummary);
  }
  if (browserTracePath) {
    const loaded = await loadJsonFile(browserTracePath, 'browser_trace_summary', { maxBytes });
    bundle.browserTrace = loaded.value;
    bundle.sourceSummaries.push(loaded.sourceSummary);
  }
  if (artifactMetadataPath) {
    const loaded = await loadJsonFile(artifactMetadataPath, 'artifact_metadata', { maxBytes });
    bundle.artifactMetadata = Array.isArray(loaded.value) ? loaded.value : loaded.value.artifacts;
    bundle.sourceSummaries.push(loaded.sourceSummary);
  }
  assertNoExecutionSensitiveMaterial({
    sourceSummaries: bundle.sourceSummaries,
  });
  return bundle;
}
