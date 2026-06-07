// @ts-check

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContentDigest } from './run-store-integrity.mjs';
import { createRunStoreManifest } from './run-store-manifest.mjs';
import { resolveRunStorePath } from './run-store-paths.mjs';
import { createRunStoreQueryIndex } from './run-store-query-index.mjs';
import { assertNoRunStoreRawMaterial } from './run-store-sanitizer.mjs';

async function writeJson(rootDir, relativePath, payload) {
  assertNoRunStoreRawMaterial(payload);
  const filePath = resolveRunStorePath(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(filePath, content, 'utf8');
  return {
    path: relativePath,
    digest: createContentDigest(content),
    sizeBytes: Buffer.byteLength(content),
  };
}

export async function writeRuntimeRunStore(rootDir, run = {}, options = {}) {
  const runId = run.runId ?? options.runId ?? 'run:runtime';
  const runDir = runId.replace(/[^a-z0-9._-]+/giu, '-');
  const report = run.runtimeExecutionReport ?? {
    status: run.status,
    providerId: run.providerId,
    redactionRequired: true,
  };
  const auditEvents = Array.isArray(run.auditEvents) ? run.auditEvents : [];
  const auditView = run.auditView ?? {
    runId,
    status: run.status,
    providerId: run.providerId,
    redactionRequired: true,
  };
  const reportFile = await writeJson(rootDir, `${runDir}/runtime_execution_report.json`, report);
  const auditEventsFile = await writeJson(rootDir, `${runDir}/audit_events.json`, auditEvents);
  const auditViewFile = await writeJson(rootDir, `${runDir}/audit_view.json`, auditView);
  const manifest = createRunStoreManifest({
    ...run,
    runId,
    files: [
      { kind: 'runtime_execution_report', ...reportFile },
      { kind: 'audit_events', ...auditEventsFile },
      { kind: 'audit_view', ...auditViewFile },
      ...(run.files ?? []),
    ],
  }, options);
  const queryIndex = createRunStoreQueryIndex([manifest]);
  const queryIndexFile = await writeJson(rootDir, `${runDir}/query_index.json`, queryIndex);
  const finalManifest = createRunStoreManifest({
    ...manifest,
    files: [
      ...manifest.files,
      { kind: 'query_index', ...queryIndexFile },
    ],
  }, options);
  await writeJson(rootDir, `${runDir}/run_manifest.json`, finalManifest);
  return finalManifest;
}
