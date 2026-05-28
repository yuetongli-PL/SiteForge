// @ts-check

import { jsonClone } from '../../../shared/clone.mjs';
import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { sanitizeReportPublicValue } from './user-report-values.mjs';

const clone = jsonClone;

function cloneReportValue(value) {
  return sanitizeReportPublicValue(clone(value));
}

export function setupProfileSummary(profile = null) {
  if (!profile) {
    return null;
  }
  const knownSitePolicy = profile.knownSitePolicy ? {
    status: sanitizeReportPublicValue(profile.knownSitePolicy.status ?? null),
    host: sanitizeReportPublicValue(profile.knownSitePolicy.host ?? null),
    siteKey: sanitizeReportPublicValue(profile.knownSitePolicy.siteKey ?? null),
    adapterId: sanitizeReportPublicValue(profile.knownSitePolicy.adapterId ?? null),
    siteArchetype: sanitizeReportPublicValue(profile.knownSitePolicy.siteArchetype ?? null),
    primaryArchetype: sanitizeReportPublicValue(profile.knownSitePolicy.primaryArchetype ?? null),
    sources: cloneReportValue(profile.knownSitePolicy.sources ?? []),
    pageTypes: cloneReportValue(profile.knownSitePolicy.pageTypes ?? []),
    publicRouteTemplates: cloneReportValue(profile.knownSitePolicy.publicRouteTemplates ?? []),
    capabilityFamilies: cloneReportValue(profile.knownSitePolicy.capabilityFamilies ?? []),
    supportedIntents: cloneReportValue(profile.knownSitePolicy.supportedIntents ?? []),
    downloadTaskTypes: cloneReportValue(profile.knownSitePolicy.downloadTaskTypes ?? []),
    downloadSupport: cloneReportValue(profile.knownSitePolicy.downloadSupport ?? null),
    downloader: cloneReportValue(profile.knownSitePolicy.downloader ?? null),
  } : null;
  const evidenceQuality = profile.evidenceQuality ? {
    sourceAvailability: cloneReportValue(profile.evidenceQuality.sourceAvailability ?? {}),
    sourceStatus: cloneReportValue(profile.evidenceQuality.sourceStatus ?? {}),
    actualPageEvidenceCount: profile.evidenceQuality.actualPageEvidenceCount ?? 0,
    syntheticPageEvidenceCount: profile.evidenceQuality.syntheticPageEvidenceCount ?? 0,
    robotsExcludedPageEvidenceCount: profile.evidenceQuality.robotsExcludedPageEvidenceCount ?? 0,
    allPrimarySourcesUnavailable: profile.evidenceQuality.allPrimarySourcesUnavailable === true,
    syntheticFallbackOnly: profile.evidenceQuality.syntheticFallbackOnly === true,
    robotsExcludedAllCandidateEvidence: profile.evidenceQuality.robotsExcludedAllCandidateEvidence === true,
    knownPolicyCapabilityPressure: profile.evidenceQuality.knownPolicyCapabilityPressure ? cloneReportValue(profile.evidenceQuality.knownPolicyCapabilityPressure) : null,
  } : null;
  return {
    artifactFamily: sanitizeReportPublicValue(profile.artifactFamily ?? null),
    source: sanitizeReportPublicValue(profile.source ?? null),
    knownSitePolicy,
    evidenceQuality,
    crawlContract: profile.crawlContract ? {
      crawlMode: sanitizeReportPublicValue(profile.crawlContract.crawlMode ?? null),
      sourceMode: sanitizeReportPublicValue(profile.crawlContract.sourceMode ?? null),
      authMethod: sanitizeReportPublicValue(profile.crawlContract.authMethod ?? null),
      authVerificationStatus: sanitizeReportPublicValue(profile.crawlContract.authVerificationStatus ?? null),
      coverageTargets: cloneReportValue(profile.crawlContract.coverageTargets ?? {}),
      evidencePolicy: cloneReportValue(profile.crawlContract.evidencePolicy ?? {}),
    } : null,
    authState: profile.authStateReport ? {
      crawlMode: sanitizeReportPublicValue(profile.authStateReport.crawlMode ?? null),
      authMethod: sanitizeReportPublicValue(profile.authStateReport.authMethod ?? null),
      authVerificationStatus: sanitizeReportPublicValue(profile.authStateReport.authVerificationStatus ?? null),
      verified: profile.authStateReport.verified === true,
      source: sanitizeReportPublicValue(profile.authStateReport.source ?? null),
      rawMaterialPersisted: profile.authStateReport.rawMaterialPersisted === true,
      sessionMaterialPersisted: profile.authStateReport.sessionMaterialPersisted === true,
      browserProfilePersisted: profile.authStateReport.browserProfilePersisted === true,
    } : null,
    userAuthorizedEvidence: profile.userAuthorizedEvidence ? {
      status: sanitizeReportPublicValue(profile.userAuthorizedEvidence.status ?? null),
      source: sanitizeReportPublicValue(profile.userAuthorizedEvidence.source ?? null),
      authorizationMode: sanitizeReportPublicValue(profile.userAuthorizedEvidence.authorizationMode ?? null),
      pageCount: profile.userAuthorizedEvidence.pages?.length ?? 0,
      browserSeedCount: profile.userAuthorizedEvidence.browserSeeds?.length ?? 0,
      capabilityProofCount: profile.userAuthorizedEvidence.capabilityProofs?.length ?? 0,
      sessionMaterialPersisted: profile.userAuthorizedEvidence.sessionMaterialPersisted === true,
      browserProfilePersisted: profile.userAuthorizedEvidence.browserProfilePersisted === true,
      pageSourcePersisted: profile.userAuthorizedEvidence.rawHtmlPersisted === true,
    } : null,
    buildReadiness: profile.buildReadiness ? cloneReportValue(profile.buildReadiness) : null,
    partialCoverage: profile.partialCoverage ? cloneReportValue(profile.partialCoverage) : null,
    profileUsability: profile.profileUsability ? cloneReportValue(profile.profileUsability) : null,
    scope: profile.scope ? cloneReportValue(profile.scope) : null,
    safety: profile.safety ? {
      submitForms: profile.safety.submitForms === true,
      allowDestructiveActions: profile.safety.allowDestructiveActions === true,
      allowPayment: profile.safety.allowPayment === true,
      allowAccountMutation: profile.safety.allowAccountMutation === true,
      allowContactSubmit: profile.safety.allowContactSubmit === true,
    } : null,
    selectedCapabilityCount: profile.capabilityScope?.selectedCapabilities?.length ?? 0,
  };
}

export function setupProfileBlockCode(reasonCode) {
  if (String(reasonCode ?? '').includes('robots-disallowed')) {
    return 'robots-disallowed';
  }
  if (reasonCode === 'setup-primary-sources-unavailable') {
    return 'robots-unavailable';
  }
  return 'siteforge-seed-discovery-empty';
}

export function setupProfileBuildBlock(profile = null, options = /** @type {any} */ ({})) {
  const blocked = profile?.profileUsability?.buildable === false
    || profile?.profileUsability?.status === 'unusable'
    || profile?.buildReadiness?.buildable === false
    || profile?.buildReadiness?.status === 'not_ready';
  if (!blocked) {
    return null;
  }
  const setupReasonCode = profile?.buildReadiness?.reasonCode
    ?? profile?.profileUsability?.reasonCode
    ?? 'setup-profile-unusable';
  const apiExtractionRequested = options.internalRawNetwork === true
    || options.captureNetwork === true
    || options.network === true;
  if (
    options.allowSetupBlockedApiDiscovery === true
    && options.renderJs !== false
    && apiExtractionRequested
    && /^browser[_-]/u.test(String(setupReasonCode ?? ''))
  ) {
    return null;
  }
  const knownPolicy = profile?.knownSitePolicy ?? null;
  const policySources = cloneReportValue(knownPolicy?.sources ?? []);
  const reason = sanitizeReportPublicValue(profile?.buildReadiness?.reason ?? profile?.profileUsability?.reason ?? setupReasonCode);
  return {
    code: setupProfileBlockCode(setupReasonCode),
    setupReasonCode,
    message: `Setup profile is not buildable: ${reason}.`,
    reasonCodes: uniqueSortedStrings([
      setupReasonCode,
      profile?.profileUsability?.reasonCode,
    ].filter(Boolean)),
    warnings: [
      `setup profile marked unusable; build skipped before activating capabilities (reasonCode=${setupReasonCode}).`,
    ],
    summary: {
      setupProfileBuildable: false,
      setupReasonCode,
      knownSitePolicy: knownPolicy ? {
        siteKey: knownPolicy.siteKey ?? null,
        adapterId: knownPolicy.adapterId ?? null,
        sources: policySources,
      } : null,
    },
  };
}
