// @ts-check

import path from 'node:path';

import { normalizeArtifactReferenceSet } from '../../../../domain/artifacts/schema.mjs';
import { assertSchemaCompatible } from '../../../../domain/schemas/compatibility-registry.mjs';
import { compactSlug } from '../../../../shared/normalize.mjs';

export function createArtifactSlug(plan) {
  return compactSlug([
    plan.action,
    plan.account || plan.query || 'current',
    plan.contentType || '',
    plan.date || plan.fromDate || '',
  ].filter(Boolean).join('-'), 'social-run');
}

export function artifactPathSummary(layout) {
  const artifacts = normalizeArtifactReferenceSet({
    runDir: layout.runDir,
    manifest: layout.manifestPath,
    manifestRedactionAudit: layout.manifestRedactionAuditPath,
    items: layout.itemsJsonlPath,
    mediaDir: layout.mediaDir,
    state: layout.statePath,
    report: layout.reportPath,
    reportRedactionAudit: layout.reportRedactionAuditPath,
    apiCapture: layout.apiCapturePath,
    apiCaptureRedactionAudit: layout.apiCaptureRedactionAuditPath,
    apiDriftSamples: layout.apiDriftSamplesPath,
    apiDriftSamplesRedactionAudit: layout.apiDriftSamplesRedactionAuditPath,
    socialRiskBlockedLifecycleEvent: layout.socialRiskBlockedLifecycleEventPath,
    socialRiskBlockedLifecycleEventRedactionAudit: layout.socialRiskBlockedLifecycleEventRedactionAuditPath,
    downloads: layout.downloadsJsonlPath,
    mediaManifest: layout.mediaHashManifestPath,
    mediaQueue: layout.mediaQueuePath,
    indexCsv: layout.indexCsvPath,
    indexHtml: layout.indexHtmlPath,
  });
  assertSchemaCompatible('ArtifactReferenceSet', artifacts);
  return artifacts;
}

export function buildSocialArtifactLayout(plan, settings) {
  const runDir = settings.runDir
    ? path.resolve(settings.runDir)
    : path.join(settings.outputRoot, `${settings.artifactRunId}-${createArtifactSlug(plan)}`);
  return {
    runDir,
    manifestPath: path.join(runDir, 'manifest.json'),
    manifestRedactionAuditPath: path.join(runDir, 'manifest.redaction-audit.json'),
    itemsJsonlPath: path.join(runDir, 'items.jsonl'),
    mediaDir: path.join(runDir, 'media'),
    statePath: path.join(runDir, 'state.json'),
    reportPath: path.join(runDir, 'report.md'),
    reportRedactionAuditPath: path.join(runDir, 'report.redaction-audit.json'),
    apiCapturePath: path.join(runDir, 'api-capture-debug.json'),
    apiCaptureRedactionAuditPath: path.join(runDir, 'api-capture-debug.redaction-audit.json'),
    apiDriftSamplesPath: path.join(runDir, 'api-drift-samples.json'),
    apiDriftSamplesRedactionAuditPath: path.join(runDir, 'api-drift-samples.redaction-audit.json'),
    socialRiskBlockedLifecycleEventPath: path.join(runDir, 'social-action-risk-blocked.lifecycle-event.json'),
    socialRiskBlockedLifecycleEventRedactionAuditPath: path.join(runDir, 'social-action-risk-blocked.lifecycle-event.redaction-audit.json'),
    downloadsJsonlPath: path.join(runDir, 'downloads.jsonl'),
    mediaHashManifestPath: path.join(runDir, 'media-manifest.json'),
    mediaQueuePath: path.join(runDir, 'media-queue.json'),
    indexCsvPath: path.join(runDir, 'index.csv'),
    indexHtmlPath: path.join(runDir, 'index.html'),
  };
}

export function safePlanForArtifact(plan) {
  return {
    siteKey: plan.siteKey,
    host: plan.host,
    action: plan.action,
    contentType: plan.contentType,
    account: plan.account,
    query: plan.query,
    date: plan.date,
    fromDate: plan.fromDate,
    toDate: plan.toDate,
    url: plan.url,
    plannerNotes: plan.plannerNotes,
  };
}

export function safeSettingsForArtifact(settings) {
  return {
    maxItems: settings.maxItems,
    maxScrolls: settings.maxScrolls,
    scrollWaitMs: settings.scrollWaitMs,
    fullArchive: settings.fullArchive,
    apiCursor: settings.apiCursor,
    apiCursorSuppressed: settings.apiCursorSuppressed,
    maxApiPages: settings.maxApiPages,
    maxUsers: settings.maxUsers,
    maxDetailPages: settings.maxDetailPages,
    perUserMaxItems: settings.perUserMaxItems,
    apiRetries: settings.apiRetries,
    riskRetries: settings.riskRetries,
    riskBackoffMs: settings.riskBackoffMs,
    followedDateMode: settings.followedDateMode,
    downloadMedia: settings.downloadMedia,
    resume: settings.resume,
    outputRoot: settings.outputRoot,
    runDir: settings.runDir,
  };
}
