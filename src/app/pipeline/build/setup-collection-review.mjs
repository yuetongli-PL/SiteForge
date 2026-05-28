// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import {
  knownPolicyAllowsUserAuthorizedSetup,
  knownPolicyRecommendedCapabilities,
} from './known-site-policy.mjs';
import { COLLECTION_OUTCOME_LIMIT } from './collection-outcomes.mjs';
import {
  SANITIZED_SUMMARY_ONLY,
  sanitizeEvidenceRef,
} from './risk-policy.mjs';
import { normalizeCapabilityId } from './capability-id.mjs';

export const SETUP_COLLECTION_REVIEW_SCHEMA_VERSION = 1;

const clone = jsonClone;

const COLLECTION_REVIEW_KINDS = Object.freeze([
  'seeds',
  'nodes',
  'affordances',
  'capabilities',
  'intents',
]);

const COLLECTION_REVIEW_GENERIC_TOKENS = Object.freeze(new Set([
  'a',
  'an',
  'and',
  'by',
  'candidate',
  'capability',
  'content',
  'for',
  'from',
  'list',
  'navigate',
  'open',
  'page',
  'pages',
  'policy',
  'public',
  'query',
  'read',
  'site',
  'to',
  'use',
  'view',
  'with',
]));

function compactText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/gu, ' ').trim();
}

function firstWords(value, maxLength = 80) {
  const text = compactText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}...` : text;
}

function sanitizeEvidenceText(value) {
  return String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/giu, (urlValue) => sanitizeEvidenceRef(urlValue) ?? 'redacted-url');
}

function sanitizeCollectionReviewExtraValue(key, value) {
  if (typeof value === 'string') {
    return /(?:url|href|ref|path|route)/iu.test(key) ? sanitizeEvidenceText(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? sanitizeEvidenceText(entry) : entry));
  }
  return value;
}

export function normalizeUserAuthorizedCapabilityProofs(proofs) {
  if (!Array.isArray(proofs)) {
    return [];
  }
  return proofs.map((proof) => ({
    status: proof?.status === 'verified' ? 'verified' : 'candidate',
    capabilityId: firstWords(proof?.capabilityId, 80),
    setupCapabilityId: firstWords(proof?.setupCapabilityId, 80),
    intentType: firstWords(proof?.intentType, 80),
    action: firstWords(proof?.action, 80),
    evidenceType: firstWords(proof?.evidenceType ?? proof?.type ?? 'summary', 80),
    sampleCount: Math.max(0, Number(proof?.sampleCount ?? proof?.itemCount ?? proof?.evidenceCount ?? 0) || 0),
    source: firstWords(sanitizeEvidenceRef(proof?.source) ?? 'user-authorized-capability-proof', 160),
    rawMaterialPersisted: false,
  })).filter((proof) => (
    proof.status === 'verified'
    && proof.sampleCount > 0
    && [proof.capabilityId, proof.setupCapabilityId, proof.intentType, proof.action].some(Boolean)
  ));
}

function collectionReviewBucket() {
  return {
    collected: [],
    missing: [],
  };
}

export function collectionReviewLabel(value) {
  const text = sanitizeEvidenceText(value).trim();
  if (/^https?:\/\//iu.test(text)) {
    return firstWords(sanitizeEvidenceRef(text) ?? 'route-template', 120);
  }
  return firstWords(text
    .replace(/^policy-(?:family|intent)-/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim(), 120);
}

function collectionReviewTokens(value) {
  return normalizeCapabilityId(value)
    .split('-')
    .filter((token) => token.length > 1);
}

function collectionReviewDistinctiveTokens(value) {
  const tokens = collectionReviewTokens(value);
  const distinctive = tokens.filter((token) => !COLLECTION_REVIEW_GENERIC_TOKENS.has(token));
  return distinctive.length ? distinctive : tokens;
}

function collectionReviewSignalCovers(value, signals) {
  const target = normalizeCapabilityId(value);
  if (!target) {
    return false;
  }
  const normalizedSignals = signals
    .map(normalizeCapabilityId)
    .filter(Boolean);
  if (normalizedSignals.some((signal) => signal === target || signal.includes(target) || target.includes(signal))) {
    return true;
  }
  const targetTokens = collectionReviewDistinctiveTokens(target);
  return normalizedSignals.some((signal) => {
    const signalTokens = new Set(collectionReviewTokens(signal));
    return targetTokens.some((token) => signalTokens.has(token));
  });
}

function addCollectionReviewItem(bucket, status, item) {
  const list = status === 'missing' ? bucket.missing : bucket.collected;
  const normalizedId = normalizeCapabilityId(sanitizeEvidenceText(item.id ?? item.label));
  if (!normalizedId) {
    return;
  }
  if (list.some((existing) => existing.id === normalizedId)) {
    return;
  }
  const next = {
    id: normalizedId,
    label: collectionReviewLabel(item.label ?? item.id),
    status,
    source: item.source ?? null,
    reasonCode: item.reasonCode ?? null,
    reason: item.reason ? firstWords(item.reason, 180) : null,
    evidenceRefs: uniqueSortedStrings((item.evidenceRefs ?? [])
      .map((ref) => sanitizeEvidenceRef(ref))
      .filter(Boolean)),
    evidence_status: item.evidenceStatus ?? 'observed_sanitized',
    saved_material: SANITIZED_SUMMARY_ONLY,
    raw_content_saved: false,
    private_content_saved: false,
    requiresUserGrant: item.requiresUserAuthorization === true,
    requiresCapabilityEvidence: item.requiresCapabilityEvidence === true,
    rawMaterialPersisted: false,
  };
  for (const [key, value] of Object.entries(item.extra ?? {})) {
    if (value !== undefined) {
      next[key] = sanitizeCollectionReviewExtraValue(key, value);
    }
  }
  list.push(next);
}

function finalizeCollectionReviewBucket(bucket) {
  const sortEntries = (entries) => entries.sort((left, right) => (
    `${left.label}:${left.id}`.localeCompare(`${right.label}:${right.id}`, 'en')
  ));
  return {
    collected: sortEntries(bucket.collected),
    missing: sortEntries(bucket.missing),
  };
}

function collectionReviewVerifiedProofs(userAuthorizedEvidence = null) {
  return normalizeUserAuthorizedCapabilityProofs(userAuthorizedEvidence?.capabilityProofs);
}

function collectionReviewProofCovers(value, proofs) {
  const target = normalizeCapabilityId(value);
  return proofs.some((proof) => [
    proof.capabilityId,
    proof.setupCapabilityId,
    proof.intentType,
    proof.action,
  ].map(normalizeCapabilityId).some((id) => id && (id === target || id.includes(target) || target.includes(id))));
}

export function capabilityProofMatches(proof, capability = /** @type {any} */ ({})) {
  const targets = [
    capability.id,
    capability.name,
    capability.action,
    capability.intentType,
  ].filter(Boolean);
  return targets.some((target) => collectionReviewProofCovers(target, [proof]));
}

export function hasVerifiedCapabilityProof(setupPlan, capability = /** @type {any} */ ({})) {
  const proofs = collectionReviewVerifiedProofs(setupPlan?.userAuthorizedEvidence);
  return proofs.some((proof) => capabilityProofMatches(proof, capability));
}

function collectionReviewCount(review, kind, status) {
  const explicit = review?.summary?.[kind]?.[status];
  if (Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }
  const bucket = review?.[kind]?.[status];
  return Array.isArray(bucket) ? bucket.length : 0;
}

function collectionReviewBucketSummary(review = null) {
  return Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
    collected: collectionReviewCount(review, kind, 'collected'),
    missing: collectionReviewCount(review, kind, 'missing'),
  }]));
}

function collectionReviewMissingRecords(review = null) {
  const records = /** @type {any[]} */ ([]);
  for (const kind of ['capabilities', 'intents']) {
    for (const item of review?.[kind]?.missing ?? []) {
      records.push({
        kind,
        id: normalizeCapabilityId(item?.id ?? item?.label),
        label: item?.label ?? item?.id ?? null,
        source: item?.source ?? null,
        reasonCode: item?.reasonCode ?? null,
        requiresUserAuthorization: item?.requiresUserAuthorization === true,
        requiresCapabilityEvidence: item?.requiresCapabilityEvidence === true,
        evidenceRequirement: item?.extra?.evidenceRequirement ?? null,
        recommended: item?.extra?.recommended === true,
      });
    }
  }
  return records.filter((record) => record.id || record.label);
}

const FINAL_REVIEW_GENERIC_TOKENS = new Set([
  'a',
  'an',
  'and',
  'browse',
  'capability',
  'content',
  'list',
  'navigate',
  'open',
  'page',
  'pages',
  'policy',
  'public',
  'read',
  'site',
  'to',
  'view',
]);

function finalReviewTokens(value) {
  return normalizeCapabilityId(value)
    .split('-')
    .filter((token) => token.length > 1);
}

function finalReviewDistinctiveTokens(value) {
  const tokens = finalReviewTokens(value);
  const distinctive = tokens.filter((token) => !FINAL_REVIEW_GENERIC_TOKENS.has(token));
  return distinctive.length ? distinctive : tokens;
}

function finalReviewAliases(record = /** @type {any} */ ({})) {
  const id = normalizeCapabilityId(record.id ?? record.label);
  const aliases = [finalReviewDistinctiveTokens(id)];
  if (/categor/u.test(id)) aliases.push(['category'], ['categories']);
  if (/chapter/u.test(id)) aliases.push(['chapter']);
  if (/book/u.test(id)) aliases.push(['book']);
  if (/search/u.test(id)) aliases.push(['search']);
  if (/rank/u.test(id)) aliases.push(['ranking'], ['rank']);
  if (/profile|author/u.test(id)) aliases.push(['profile'], ['author']);
  if (/repository|repo/u.test(id)) aliases.push(['repository'], ['repositories']);
  if (/article|news/u.test(id)) aliases.push(['article'], ['news']);
  if (/utility|navigation/u.test(id)) aliases.push(['navigation'], ['route']);
  if (/content/u.test(id)) aliases.push(['detail'], ['book'], ['work'], ['article'], ['repository'], ['content']);
  return aliases.filter((tokens) => Array.isArray(tokens) && tokens.length > 0);
}

function finalReviewSignalRecords(capabilities = /** @type {any[]} */ ([]), intents = /** @type {any[]} */ ([])) {
  const callableCapabilityIds = new Set((intents ?? [])
    .filter((intent) => intent.callable !== false)
    .map((intent) => normalizeCapabilityId(intent.capabilityId))
    .filter(Boolean));
  const capabilitySignals = (capabilities ?? [])
    .filter((capability) => (
      capability.status === 'active'
      || capability.enabled_status === 'enabled'
      || capability.enabled_status === 'limited_enabled'
      || callableCapabilityIds.has(normalizeCapabilityId(capability.id))
    ))
    .flatMap((capability) => [
      capability.id,
      capability.name,
      capability.user_facing_name,
      capability.userFacingName,
      capability.userValue,
      capability.action,
      capability.object,
      capability.category,
      capability.setupCapabilityId,
      capability.intentAction,
      capability.routeTemplate,
      capability.routePath,
      ...(capability.intents ?? []),
    ]);
  const intentSignals = (intents ?? [])
    .filter((intent) => intent.callable !== false)
    .flatMap((intent) => [
      intent.id,
      intent.name,
      intent.capabilityId,
      intent.canonicalUtterance,
      ...(intent.utteranceExamples ?? []),
    ]);
  return uniqueSortedStrings([...capabilitySignals, ...intentSignals]
    .map(normalizeCapabilityId)
    .filter(Boolean));
}

function finalReviewSignalCovers(record, signals = /** @type {any[]} */ ([])) {
  const target = normalizeCapabilityId(record?.id ?? record?.label);
  if (!target || !signals.length) {
    return false;
  }
  if (signals.some((signal) => signal === target || signal.includes(target) || target.includes(signal))) {
    return true;
  }
  return finalReviewAliases(record).some((aliasTokens) => signals.some((signal) => {
    const signalTokens = new Set(finalReviewTokens(signal));
    return aliasTokens.every((token) => signalTokens.has(token) || signal.includes(token));
  }));
}

export function reconcileSetupCollectionReviewWithBuildOutputs(
  review = null,
  capabilities = /** @type {any[]} */ ([]),
  intents = /** @type {any[]} */ ([]),
) {
  if (!review || typeof review !== 'object') {
    return review;
  }
  const signals = finalReviewSignalRecords(capabilities, intents);
  if (!signals.length) {
    return review;
  }
  const next = clone(review);
  for (const kind of ['capabilities', 'intents']) {
    const bucket = next?.[kind];
    if (!bucket || !Array.isArray(bucket.missing)) {
      continue;
    }
    const collected = Array.isArray(bucket.collected) ? bucket.collected : [];
    const missing = [];
    for (const item of bucket.missing) {
      if (finalReviewSignalCovers(item, signals)) {
        collected.push({
          ...item,
          status: 'collected',
          reasonCode: null,
          reason: null,
          collectedBy: 'final-build-capability-or-intent',
          evidence_status: item.evidence_status ?? 'observed_sanitized',
        });
      } else {
        missing.push(item);
      }
    }
    bucket.collected = collected;
    bucket.missing = missing;
  }
  next.summary = {
    ...(next.summary ?? {}),
    ...Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
      collected: Array.isArray(next?.[kind]?.collected) ? next[kind].collected.length : 0,
      missing: Array.isArray(next?.[kind]?.missing) ? next[kind].missing.length : 0,
    }])),
  };
  return next;
}

export function setupCollectionReviewReport(review = null, sourcePath = null) {
  if (!review || typeof review !== 'object') {
    return null;
  }
  const missingRecords = collectionReviewMissingRecords(review);
  const summary = collectionReviewBucketSummary(review);
  return {
    schemaVersion: review.schemaVersion ?? null,
    artifactFamily: review.artifactFamily ?? 'siteforge-collection-review',
    buildId: review.buildId ?? null,
    siteId: review.siteId ?? null,
    sourceRef: sanitizeEvidenceRef(sourcePath),
    knownSitePolicy: review.knownSitePolicy ? {
      status: review.knownSitePolicy.status ?? null,
      siteKey: review.knownSitePolicy.siteKey ?? null,
      adapterId: review.knownSitePolicy.adapterId ?? null,
      sources: clone(review.knownSitePolicy.sources ?? []),
    } : null,
    userAuthorizedEvidence: review.userAuthorizedEvidence ? {
      status: review.userAuthorizedEvidence.status ?? null,
      pageCount: review.userAuthorizedEvidence.pageCount ?? 0,
      browserSeedCount: review.userAuthorizedEvidence.browserSeedCount ?? 0,
      capabilityProofCount: review.userAuthorizedEvidence.capabilityProofCount ?? 0,
      sessionMaterialPersisted: review.userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: review.userAuthorizedEvidence.browserProfilePersisted === true,
      pageSourcePersisted: review.userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    summary,
    missingRecordCount: missingRecords.length,
    missingRecords: missingRecords.slice(0, COLLECTION_OUTCOME_LIMIT),
    truncated: missingRecords.length > COLLECTION_OUTCOME_LIMIT,
    limit: COLLECTION_OUTCOME_LIMIT,
    safetyBoundary: review.safetyBoundary
      ?? 'Collection review is report-only; candidate capabilities still require verified capability-specific proof before activation.',
  };
}

export function renderSetupCollectionReviewLines(review = null) {
  if (!review) {
    return [];
  }
  const summary = review.summary ?? {};
  const capabilityMissing = summary.capabilities?.missing ?? 0;
  const intentMissing = summary.intents?.missing ?? 0;
  const lines = [
    'Collection review:',
    `  Collected: seeds=${summary.seeds?.collected ?? 0} nodes=${summary.nodes?.collected ?? 0} affordances=${summary.affordances?.collected ?? 0} capabilities=${summary.capabilities?.collected ?? 0} intents=${summary.intents?.collected ?? 0}`,
    `  Needs more evidence: capabilities=${capabilityMissing} intents=${intentMissing}`,
  ];
  const missingRecords = review.missingRecords ?? [];
  if (missingRecords.length) {
    lines.push('  Missing evidence:');
    for (const record of missingRecords.slice(0, 5)) {
      lines.push(`    - ${record.kind}:${record.label ?? record.id ?? '-'} (${record.reasonCode ?? 'missing-evidence'})`);
    }
    if (review.truncated || missingRecords.length > 5) {
      lines.push('    - See build_report.json for the full collection review.');
    }
  }
  return lines;
}

function collectionReviewPolicyCapabilities(knownSitePolicy, userAuthorizedEvidence = null) {
  if (!knownSitePolicy) {
    return [];
  }
  const knownPolicyCapabilities = knownPolicyRecommendedCapabilities(knownSitePolicy, {
    userAuthorized: true,
    userAuthorizedEvidence,
  });
  const genericCapabilities = [
    ...(knownSitePolicy.capabilityFamilies ?? []).map((family) => ({
      id: family,
      name: collectionReviewLabel(family),
      reason: 'Known site policy declares this capability family; setup must collect matching evidence before activation.',
      safety: 'read_only',
      recommended: false,
      status: 'candidate',
      evidenceRequirement: 'policy-evidence',
      disabledReason: 'policy-evidence-required',
      policyValue: family,
    })),
    ...(knownSitePolicy.downloadTaskTypes ?? []).map((taskType) => ({
      id: `download-${taskType}`,
      name: collectionReviewLabel(`download ${taskType}`),
      reason: 'Known site policy declares this download task type; downloader activation requires a separate bounded evidence path.',
      safety: 'requires_confirmation',
      recommended: false,
      status: 'candidate',
      evidenceRequirement: 'policy-evidence',
      disabledReason: 'policy-evidence-required',
      policyValue: taskType,
    })),
  ];
  const byId = new Map();
  for (const capability of [...knownPolicyCapabilities, ...genericCapabilities]) {
    const id = normalizeCapabilityId(capability.id ?? capability.name);
    if (!id || byId.has(id)) {
      continue;
    }
    byId.set(id, capability);
  }
  return [...byId.values()];
}

function collectionReviewCapabilityEvidenceStatus(setupPlan, capability, collectedSignals, proofs) {
  const id = capability.id ?? capability.name;
  const requiresCapabilityEvidence = capability.evidenceRequirement === 'capability-specific-evidence';
  const verified = collectionReviewProofCovers(id, proofs) || hasVerifiedCapabilityProof(setupPlan, capability);
  const coveredBySignal = collectionReviewSignalCovers(id, collectedSignals);
  if (verified) {
    return {
      collected: true,
      reasonCode: null,
      requiresCapabilityEvidence,
    };
  }
  if (requiresCapabilityEvidence) {
    return {
      collected: false,
      reasonCode: 'capability-specific-evidence-required',
      requiresCapabilityEvidence: true,
    };
  }
  if (capability.recommended === true || capability.status === 'recommended' || coveredBySignal) {
    return {
      collected: true,
      reasonCode: null,
      requiresCapabilityEvidence: false,
    };
  }
  return {
    collected: false,
    reasonCode: capability.disabledReason ?? setupPlan?.buildReadiness?.reasonCode ?? 'policy-evidence-required',
    requiresCapabilityEvidence,
  };
}

/** @returns {any} */
export function buildCollectionReviewModel({
  setupPlan = /** @type {any} */ ({}),
  userAuthorizedEvidence = setupPlan?.userAuthorizedEvidence ?? null,
  knownSitePolicy = setupPlan?.knownSitePolicy ?? null,
} = /** @type {any} */ ({})) {
  const buckets = Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, collectionReviewBucket()]));
  const proofs = collectionReviewVerifiedProofs(userAuthorizedEvidence);
  const collectedSignals = /** @type {any[]} */ ([]);
  const addSignal = (...values) => {
    collectedSignals.push(...values.filter(Boolean));
  };

  for (const group of setupPlan.pageGroups ?? []) {
    if (Number(group?.count ?? 0) < 1) {
      continue;
    }
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: `page-group-${group.id}`,
      label: group.name ?? group.id,
      source: 'setup-plan-page-group',
      evidenceRefs: group.sampleUrls ?? [],
      extra: {
        count: Number(group.count ?? 0),
        groupId: group.id ?? null,
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: `navigate-${group.id}`,
      label: `Navigate ${group.name ?? group.id}`,
      source: 'setup-plan-page-group',
      evidenceRefs: group.sampleUrls ?? [],
      extra: {
        affordanceType: 'navigation',
        groupId: group.id ?? null,
      },
    });
    addSignal(group.id, group.name, ...(group.sampleLabels ?? []));
    for (const sampleUrl of group.sampleUrls ?? []) {
      addCollectionReviewItem(buckets.seeds, 'collected', {
        id: `setup-page-${sampleUrl}`,
        label: sampleUrl,
        source: 'setup-plan-page-sample',
        evidenceRefs: [sampleUrl],
        extra: {
          url: sampleUrl,
          groupId: group.id ?? null,
        },
      });
      addSignal(sampleUrl);
    }
  }

  for (const page of userAuthorizedEvidence?.pages ?? []) {
    const pageUrl = page.normalizedUrl ?? page.url;
    addCollectionReviewItem(buckets.seeds, 'collected', {
      id: `user-authorized-page-${pageUrl}`,
      label: pageUrl,
      source: 'user-authorized-browser-page',
      evidenceRefs: [pageUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        url: pageUrl ?? null,
      },
    });
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: `user-authorized-node-${pageUrl}`,
      label: page.title ?? pageUrl ?? 'User-authorized browser page',
      source: 'user-authorized-browser-page',
      evidenceRefs: [pageUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        nodeType: 'user-authorized-page',
        url: pageUrl ?? null,
      },
    });
    addSignal(pageUrl, page.title, page.textSummary);
  }

  for (const seed of userAuthorizedEvidence?.browserSeeds ?? []) {
    const seedUrl = seed.normalizedUrl ?? seed.url;
    const capabilityIds = uniqueSortedStrings([
      ...(seed.capabilityIds ?? []),
      seed.capabilityId,
      seed.setupCapabilityId,
      seed.intentType,
      seed.action,
    ].map(normalizeCapabilityId).filter(Boolean));
    addCollectionReviewItem(buckets.seeds, 'collected', {
      id: `user-authorized-seed-${seed.routeKind || seed.seedType}-${seedUrl}`,
      label: `${seed.routeKind || seed.seedType || 'authorized route'} ${seedUrl ?? ''}`,
      source: seed.source ?? 'user-authorized-browser-seed',
      evidenceRefs: [seedUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        url: seedUrl ?? null,
        routeKind: seed.routeKind ?? null,
        seedType: seed.seedType ?? null,
        capabilityIds,
        visibleItemCount: Number(seed.visibleItemCount ?? 0) || 0,
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: `authorized-route-${seed.routeKind || seed.seedType || seedUrl}`,
      label: seed.routeKind || seed.seedType || 'authorized route',
      source: seed.source ?? 'user-authorized-browser-seed',
      evidenceRefs: [seedUrl].filter(Boolean),
      requiresUserAuthorization: true,
      extra: {
        affordanceType: 'authorized-route',
        capabilityIds,
        visibleItemCount: Number(seed.visibleItemCount ?? 0) || 0,
      },
    });
    if (Number(seed.visibleItemCount ?? 0) < 1 && capabilityIds.length) {
      for (const capabilityId of capabilityIds) {
        addCollectionReviewItem(buckets.nodes, 'missing', {
          id: `authorized-content-${capabilityId}`,
          label: capabilityId,
          source: seed.source ?? 'user-authorized-browser-seed',
          reasonCode: 'authorized-route-seed-only',
          reason: 'A bounded authorized route seed exists, but setup has not collected visible item evidence for this capability.',
          requiresUserAuthorization: true,
          requiresCapabilityEvidence: true,
          evidenceRefs: [seedUrl].filter(Boolean),
        });
      }
    }
    addSignal(seedUrl, seed.routeKind, seed.seedType, ...capabilityIds);
  }

  const autoDiscoverySummary = userAuthorizedEvidence?.autoDiscovery?.summary;
  if (autoDiscoverySummary) {
    addCollectionReviewItem(buckets.nodes, 'collected', {
      id: 'auto-discovery-structure-summary',
      label: 'auto discovery structure summary',
      source: userAuthorizedEvidence.autoDiscovery?.source ?? 'auto-discovery',
      requiresUserAuthorization: true,
      extra: {
        nodeType: 'auto-discovery-summary',
        nodesTotal: Number(autoDiscoverySummary.nodes_total ?? 0) || 0,
        routeTemplates: Number(autoDiscoverySummary.route_templates ?? 0) || 0,
        evidenceStatus: autoDiscoverySummary.evidenceStatus ?? 'modeled_structure',
      },
    });
    addCollectionReviewItem(buckets.affordances, 'collected', {
      id: 'auto-discovery-actionable-summary',
      label: 'auto discovery actionable summary',
      source: userAuthorizedEvidence.autoDiscovery?.source ?? 'auto-discovery',
      requiresUserAuthorization: true,
      extra: {
        affordanceType: 'auto-discovery-summary',
        actionableElements: Number(autoDiscoverySummary.actionable_elements ?? 0) || 0,
        evidenceStatus: autoDiscoverySummary.evidenceStatus ?? 'modeled_structure',
      },
    });
    addSignal('auto-discovery', 'route-template', 'spa-state', 'structure-summary');
  }

  for (const proof of proofs) {
    const proofIds = uniqueSortedStrings([
      proof.capabilityId,
      proof.setupCapabilityId,
      proof.intentType,
      proof.action,
    ].map(normalizeCapabilityId).filter(Boolean));
    for (const proofId of proofIds) {
      addCollectionReviewItem(buckets.affordances, 'collected', {
        id: `capability-proof-${proofId}`,
        label: proofId,
        source: proof.source ?? 'user-authorized-capability-proof',
        requiresUserAuthorization: true,
        requiresCapabilityEvidence: true,
        extra: {
          affordanceType: 'capability-proof',
          evidenceType: proof.evidenceType,
          sampleCount: proof.sampleCount,
        },
      });
      addSignal(proofId, proof.evidenceType, proof.source);
    }
  }

  const expectedCapabilities = [
    ...(setupPlan.recommendedCapabilities ?? []),
    ...collectionReviewPolicyCapabilities(knownSitePolicy, userAuthorizedEvidence),
  ];
  const seenCapabilities = new Set();
  for (const capability of expectedCapabilities) {
    const id = normalizeCapabilityId(capability.id ?? capability.name);
    if (!id || seenCapabilities.has(id)) {
      continue;
    }
    seenCapabilities.add(id);
    const evidenceStatus = collectionReviewCapabilityEvidenceStatus(setupPlan, capability, collectedSignals, proofs);
    const targetStatus = evidenceStatus.collected ? 'collected' : 'missing';
    addCollectionReviewItem(buckets.capabilities, targetStatus, {
      id,
      label: capability.name ?? capability.id,
      source: capability.policyValue ? 'known-site-policy' : 'setup-plan-recommendation',
      reasonCode: evidenceStatus.reasonCode,
      reason: evidenceStatus.reasonCode ? capability.reason : null,
      requiresUserAuthorization: capability.evidenceRequirement === 'capability-specific-evidence',
      requiresCapabilityEvidence: evidenceStatus.requiresCapabilityEvidence,
      extra: {
        safety: capability.safety ?? null,
        recommended: capability.recommended === true,
        evidenceRequirement: capability.evidenceRequirement ?? null,
        policyValue: capability.policyValue ?? null,
      },
    });
    if (evidenceStatus.collected) {
      addSignal(id, capability.name, capability.policyValue);
    }
  }

  const expectedIntents = uniqueSortedStrings([
    ...(knownSitePolicy?.supportedIntents ?? []),
    ...proofs.flatMap((proof) => [proof.intentType, proof.action]),
    ...(setupPlan.recommendedCapabilities ?? [])
      .filter((capability) => capability.recommended === true)
      .map((capability) => capability.id ?? capability.name),
  ].map(normalizeCapabilityId).filter(Boolean));
  for (const intent of expectedIntents) {
    const proofed = collectionReviewProofCovers(intent, proofs);
    const covered = proofed || collectionReviewSignalCovers(intent, collectedSignals);
    addCollectionReviewItem(buckets.intents, covered ? 'collected' : 'missing', {
      id: intent,
      label: intent,
      source: proofed ? 'user-authorized-capability-proof' : 'known-site-policy',
      reasonCode: covered ? null : (
        userAuthorizedEvidence?.status === 'captured'
          ? 'capability-specific-evidence-required'
          : setupPlan.buildReadiness?.reasonCode ?? 'policy-intent-not-collected'
      ),
      reason: covered ? null : 'Known site policy or user request advertises this intent, but setup has not collected matching sanitized evidence.',
      requiresUserAuthorization: Boolean(knownSitePolicy),
      requiresCapabilityEvidence: !covered,
    });
  }

  if (buckets.seeds.collected.length === 0) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: 'setup-page-evidence',
      label: 'setup page evidence',
      source: 'setup-readiness',
      reasonCode: setupPlan.buildReadiness?.reasonCode ?? 'setup-no-page-evidence',
      reason: setupPlan.buildReadiness?.reason ?? 'Setup did not collect public page or bounded user-authorized evidence.',
    });
  }
  for (const excludedUrl of setupPlan.evidenceQuality?.robotsExcludedPageEvidenceUrls ?? []) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: `robots-excluded-${excludedUrl}`,
      label: excludedUrl,
      source: 'robots.txt',
      reasonCode: 'robots-disallowed',
      reason: 'robots.txt excluded this candidate setup seed; SiteForge did not crawl it.',
      evidenceRefs: [excludedUrl],
    });
  }
  if (
    knownSitePolicy
    && userAuthorizedEvidence?.status !== 'captured'
    && knownPolicyAllowsUserAuthorizedSetup(knownSitePolicy)
  ) {
    addCollectionReviewItem(buckets.seeds, 'missing', {
      id: 'user-authorized-browser-evidence',
      label: 'user-authorized browser evidence',
      source: 'known-site-policy',
      reasonCode: 'user-authorized-evidence-required',
      reason: 'Known site policy allows a bounded user-authorized setup path, but no sanitized browser evidence was collected.',
      requiresUserAuthorization: true,
    });
  }

  const finalized = Object.fromEntries(Object.entries(buckets)
    .map(([kind, bucket]) => [kind, finalizeCollectionReviewBucket(bucket)]));
  return {
    schemaVersion: SETUP_COLLECTION_REVIEW_SCHEMA_VERSION,
    artifactFamily: 'siteforge-collection-review',
    buildId: setupPlan.buildId ?? null,
    siteId: setupPlan.site?.id ?? null,
    knownSitePolicy: knownSitePolicy ? {
      status: knownSitePolicy.status ?? null,
      siteKey: knownSitePolicy.siteKey ?? null,
      adapterId: knownSitePolicy.adapterId ?? null,
      sources: clone(knownSitePolicy.sources ?? []),
    } : null,
    userAuthorizedEvidence: userAuthorizedEvidence ? {
      status: userAuthorizedEvidence.status ?? null,
      pageCount: userAuthorizedEvidence.pages?.length ?? 0,
      browserSeedCount: userAuthorizedEvidence.browserSeeds?.length ?? 0,
      capabilityProofCount: proofs.length,
      sessionMaterialPersisted: userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: userAuthorizedEvidence.browserProfilePersisted === true,
      rawHtmlPersisted: userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    safetyBoundary: 'Collection review uses sanitized setup summaries only; it does not persist sensitive browser or session material, and it does not bypass robots, login, or access controls.',
    summary: Object.fromEntries(COLLECTION_REVIEW_KINDS.map((kind) => [kind, {
      collected: finalized[kind].collected.length,
      missing: finalized[kind].missing.length,
    }])),
    ...finalized,
  };
}

export const createCollectionReviewModel = buildCollectionReviewModel;
