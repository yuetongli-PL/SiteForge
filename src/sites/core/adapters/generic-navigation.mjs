// @ts-check

import { cleanText, hostFromUrl } from '../../../shared/normalize.mjs';
import {
  normalizeSiteAdapterCandidateDecision,
  normalizeSiteAdapterCatalogUpgradePolicy,
} from '../../capability/api-candidates.mjs';
import { redactValue } from '../../capability/security-guard.mjs';

export const GENERIC_NAVIGATION_ADAPTER_VERSION = '2026-05-03';
export const SITE_ADAPTER_SEMANTIC_ENTRY_VERSION = 1;

export const GENERIC_TERMINOLOGY = Object.freeze({
  entityLabel: '书籍',
  entityPlural: '书籍',
  personLabel: '作者',
  personPlural: '作者',
  searchLabel: '搜索书籍',
  openEntityLabel: '打开书籍',
  openPersonLabel: '打开作者页',
  downloadLabel: '下载书籍',
  verifiedTaskLabel: '书籍/作者',
});

function resolveHost(input = {}) {
  return String(
    input.host
      ?? input.siteContext?.host
      ?? hostFromUrl(input.candidateUrl)
      ?? hostFromUrl(input.inputUrl)
      ?? ''
  ).toLowerCase();
}

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function normalizeSafeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? redactValue(value).value
    : {};
}

function normalizeRequired(value) {
  return Boolean(value);
}

function resolveAdapterSiteKey(adapter, input = {}) {
  if (typeof adapter?.siteKey === 'function') {
    return normalizeText(adapter.siteKey(input));
  }
  return normalizeText(adapter?.siteKey);
}

export function normalizeSiteAdapterSemanticEntry({
  candidate,
  semantics = {},
  scope = {},
} = {}, {
  adapterId,
  adapterVersion,
  siteKey,
} = {}) {
  const resolvedSiteKey = normalizeText(candidate?.siteKey ?? siteKey);
  return {
    contractVersion: SITE_ADAPTER_SEMANTIC_ENTRY_VERSION,
    adapterId: normalizeText(adapterId) ?? 'generic-navigation',
    ...(normalizeText(adapterVersion) ? { adapterVersion: normalizeText(adapterVersion) } : {}),
    ...(normalizeText(candidate?.id) ? { candidateId: normalizeText(candidate.id) } : {}),
    ...(resolvedSiteKey ? { siteKey: resolvedSiteKey } : {}),
    scope: normalizeSafeObject(scope),
    auth: normalizeSafeObject(semantics.auth ?? candidate?.auth),
    pagination: normalizeSafeObject(semantics.pagination ?? candidate?.pagination),
    fieldMapping: normalizeSafeObject(semantics.fieldMapping ?? candidate?.fieldMapping),
    risk: normalizeSafeObject(semantics.risk ?? candidate?.risk),
  };
}

export const genericNavigationAdapter = Object.freeze({
  id: 'generic-navigation',
  siteKey: 'generic-navigation',
  version: GENERIC_NAVIGATION_ADAPTER_VERSION,
  matches() {
    return true;
  },
  inferPageType() {
    return null;
  },
  terminology() {
    return { ...GENERIC_TERMINOLOGY };
  },
  displayIntentName({ intentType }) {
    return String(intentType ?? '');
  },
  normalizeDisplayLabel({ value }) {
    return cleanText(value);
  },
  classifyPath() {
    return { kind: null, detail: null };
  },
  classifyNode(node = {}) {
    return {
      classification: 'unknown',
      required: normalizeRequired(node.required),
    };
  },
  classifyApi(api = {}) {
    return {
      classification: 'unknown',
      required: normalizeRequired(api.required),
    };
  },
  describeApiCandidateSemantics(input = {}) {
    return normalizeSiteAdapterSemanticEntry(input, {
      adapterId: this?.id ?? 'generic-navigation',
      adapterVersion: this?.version,
      siteKey: resolveAdapterSiteKey(this, input),
    });
  },
  validateApiCandidate({
    candidate,
    evidence = {},
    scope = {},
    validatedAt,
  } = {}) {
    const siteKey = String(candidate?.siteKey ?? '').trim();
    const accepted = siteKey === 'generic-navigation';
    return normalizeSiteAdapterCandidateDecision({
      adapterId: 'generic-navigation',
      adapterVersion: GENERIC_NAVIGATION_ADAPTER_VERSION,
      decision: accepted ? 'accepted' : 'rejected',
      reasonCode: accepted ? undefined : 'api-verification-failed',
      validatedAt,
      scope: {
        validationMode: 'synthetic-non-auth',
        ...scope,
      },
      evidence,
    }, {
      candidate,
    });
  },
  getApiCatalogUpgradePolicy({
    candidate,
    siteAdapterDecision,
    evidence = {},
    scope = {},
    decidedAt,
  } = {}) {
    const candidateStatus = String(candidate?.status ?? '').trim();
    const accepted = siteAdapterDecision?.decision === 'accepted' && candidateStatus === 'verified';
    const policy = normalizeSiteAdapterCatalogUpgradePolicy({
      adapterId: 'generic-navigation',
      allowCatalogUpgrade: accepted,
      reasonCode: accepted ? undefined : 'api-catalog-entry-blocked',
      decidedAt,
      scope: {
        policyMode: 'synthetic-non-auth',
        ...scope,
      },
      evidence,
    }, {
      candidate,
      siteAdapterDecision,
    });
    return {
      ...policy,
      adapterVersion: GENERIC_NAVIGATION_ADAPTER_VERSION,
    };
  },
  runtimePolicy({ host, profile } = {}) {
    return {
      host: resolveHost({ host, profile }),
      allowedHosts: toList(profile?.navigation?.allowedHosts),
      sampling: profile?.sampling ?? null,
      pageTypes: profile?.pageTypes ?? null,
    };
  },
});
