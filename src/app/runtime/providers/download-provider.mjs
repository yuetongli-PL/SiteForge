// @ts-check

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assertNoExecutionSensitiveMaterial,
} from '../../../domain/policies/execution/index.mjs';
import {
  inferRuntimeCapabilityKind,
} from '../provider-registry.mjs';

const DOWNLOAD_PROVIDER_ID = 'download_provider';
const DEFAULT_DOWNLOAD_FILENAME = 'siteforge-controlled-download.txt';
const DEFAULT_DOWNLOAD_MIME = 'text/plain';
const BLOCKED_TEXT_PATTERN = /\b(?:delete|destroy|clear|reset|cancel|revoke|pay|payment|purchase|checkout|billing|write|submit|update|create|post)\b/iu;

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function descriptorKind(descriptor = {}) {
  const kind = inferRuntimeCapabilityKind(descriptor);
  if (kind === 'generic') {
    for (const value of [
      descriptor.executionContract?.operationKind,
      descriptor.executionContract?.runtimeBinding?.kind,
      descriptor.runtimeContext?.operationKind,
    ]) {
      const direct = normalizeKind(value);
      if (direct === 'export') return 'download';
      if (direct) return direct;
    }
  }
  return kind === 'export' ? 'download' : kind;
}

function descriptorText(descriptor = {}) {
  return [
    descriptor.invocationRequest?.capabilityId,
    descriptor.executionContract?.capabilityId,
    descriptor.executionContract?.contractKind,
    descriptor.executionContract?.operationKind,
    descriptor.executionContract?.runtimeBinding?.kind,
    descriptor.capability?.id,
    descriptor.capability?.name,
    descriptor.capability?.action,
  ].map((value) => String(value ?? '')).join(' ');
}

function isDownloadDescriptor(descriptor = {}) {
  const contract = descriptor.executionContract ?? {};
  const capability = descriptor.capability ?? {};
  if (
    contract.destructiveAction === true
    || contract.paymentOrFundsAction === true
    || capability.destructiveAction === true
    || capability.paymentOrFundsAction === true
  ) {
    return false;
  }
  if (BLOCKED_TEXT_PATTERN.test(descriptorText(descriptor))) {
    return false;
  }
  const kind = descriptorKind(descriptor);
  return kind === 'download' || kind === 'downloader';
}

function gateSatisfied(dispatchReport = null, gate) {
  const status = dispatchReport?.gateEvaluation?.gateStatus?.[gate]
    ?? dispatchReport?.gateStatus?.[gate]
    ?? dispatchReport?.policyDecision?.gateStatus?.[gate]
    ?? null;
  return status === true || status?.satisfied === true;
}

function outputPolicyApproved(options = {}) {
  const policy = options.runtimeContext?.outputPolicy ?? options.executionContract?.outputPolicy ?? null;
  return policy?.approved === true || gateSatisfied(options.dispatchReport, 'output_path_required');
}

function configuredOutputDir(options = {}) {
  return normalizeText(
    options.runtimeContext?.outputDir
      ?? options.runtimeContext?.outputRootDir
      ?? options.runtimeContext?.artifactDir,
  );
}

function requestedFilename(options = {}) {
  return normalizeText(
    options.runtimeContext?.downloadFilename
      ?? options.executionContract?.downloadDescriptor?.filename
      ?? options.executionContract?.runtimeBinding?.downloaderTaskDescriptor?.filename,
    DEFAULT_DOWNLOAD_FILENAME,
  );
}

function hasUnsafeFilename(value) {
  const text = String(value ?? '');
  return !text
    || path.isAbsolute(text)
    || text.includes('..')
    || /[\\/]/u.test(text)
    || /[\0<>:"|?*]/u.test(text);
}

function safeFilename(value) {
  const text = String(value ?? '').trim();
  if (hasUnsafeFilename(text)) {
    return null;
  }
  return text;
}

function resolveOutputTarget(outputDir, filename) {
  const root = path.resolve(outputDir);
  const target = path.resolve(root, filename);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    return null;
  }
  return { root, target };
}

function artifactRefForFilename(filename) {
  const safePart = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'download';
  return `artifact:runtime-download:${safePart}`;
}

function downloadContent(options = {}) {
  const text = normalizeText(
    options.runtimeContext?.fixtureText,
    'SiteForge controlled runtime download fixture\n',
  );
  return Buffer.from(text, 'utf8');
}

function buildDownloadSummary({ filename, checksum, byteSize, mimeType, artifactRef }) {
  const summary = {
    outcome: 'download_completed',
    providerId: DOWNLOAD_PROVIDER_ID,
    artifactRefs: [artifactRef],
    downloads: [
      {
        artifactRef,
        filename,
        hash: checksum,
        checksum,
        byteSize,
        mimeType,
      },
    ],
    savedMaterial: 'sanitized_summary_only',
    redactionRequired: true,
  };
  assertNoExecutionSensitiveMaterial(summary);
  return summary;
}

export function createDownloadProvider() {
  return {
    id: DOWNLOAD_PROVIDER_ID,
    providerKind: 'download_provider',
    capabilityKinds: ['download', 'export'],
    supports(descriptor = {}) {
      return isDownloadDescriptor(descriptor);
    },
    canExecute(options = {}) {
      if (!isDownloadDescriptor(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.download_provider_unsupported',
        };
      }
      if (!outputPolicyApproved(options)) {
        return {
          allowed: false,
          reasonCode: 'runtime.download_output_policy_required',
        };
      }
      const outputDir = configuredOutputDir(options);
      if (!outputDir) {
        return {
          allowed: false,
          reasonCode: 'runtime.download_output_directory_required',
        };
      }
      const filename = safeFilename(requestedFilename(options));
      if (!filename) {
        return {
          allowed: false,
          reasonCode: 'runtime.download_path_traversal_rejected',
        };
      }
      if (!resolveOutputTarget(outputDir, filename)) {
        return {
          allowed: false,
          reasonCode: 'runtime.download_path_traversal_rejected',
        };
      }
      return { allowed: true };
    },
    async run(options = {}) {
      const outputDir = configuredOutputDir(options);
      const filename = safeFilename(requestedFilename(options));
      const target = filename ? resolveOutputTarget(outputDir, filename) : null;
      if (!target) {
        throw Object.assign(new Error('Controlled output target is unavailable'), {
          code: 'runtime.download_target_unavailable',
        });
      }
      await mkdir(target.root, { recursive: true });
      const content = downloadContent(options);
      await writeFile(target.target, content);
      const checksum = createHash('sha256').update(content).digest('hex');
      const artifactRef = artifactRefForFilename(filename);
      const mimeType = normalizeText(options.runtimeContext?.mimeType, DEFAULT_DOWNLOAD_MIME);
      return {
        providerId: DOWNLOAD_PROVIDER_ID,
        providerKind: 'download_provider',
        status: 'completed',
        runtimeExecuted: true,
        sideEffectAttempted: true,
        sideEffectSucceeded: true,
        sideEffectFailed: false,
        artifactRefs: [artifactRef],
        resultSummary: buildDownloadSummary({
          filename,
          checksum,
          byteSize: content.byteLength,
          mimeType,
          artifactRef,
        }),
      };
    },
  };
}

export { DOWNLOAD_PROVIDER_ID };
