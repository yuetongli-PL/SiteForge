// @ts-check

import {
  resolvePageTypesFromSiteContext,
} from '../../sites/catalog/context.mjs';
import { resolveConfiguredPageTypes } from '../../sites/core/page-types.mjs';
import { resolveCanonicalSiteIdentity } from '../../sites/core/site-identity.mjs';

export async function syncPublishedSiteMetadata(kind, payload, deps) {
  if (kind === 'knowledge-base') {
    await deps.syncKnowledgeBaseSiteMetadata(payload);
    return;
  }

  if (kind === 'skill') {
    const generatedAt = payload.generatedAt ?? new Date().toISOString();
    const resolvedIdentity = resolveCanonicalSiteIdentity({
      host: payload.host,
      baseUrl: payload.baseUrl ?? payload.inputUrl,
      inputUrl: payload.baseUrl ?? payload.inputUrl,
      siteContext: payload.siteContext,
      siteProfile: payload.siteProfile,
    });
    await deps.upsertSiteRegistryRecord(payload.cwd, payload.host, {
      canonicalBaseUrl: payload.baseUrl ?? payload.inputUrl,
      siteKey: resolvedIdentity.siteKey,
      adapterId: resolvedIdentity.adapterId,
      repoSkillDir: payload.skillDir,
      latestSkillGeneratedAt: generatedAt,
      profilePath: payload.profilePath ?? null,
      knowledgeBaseDir: payload.kbDir,
    });
    await deps.upsertSiteCapabilities(payload.cwd, payload.host, {
      baseUrl: payload.baseUrl ?? payload.inputUrl,
      siteKey: resolvedIdentity.siteKey,
      adapterId: resolvedIdentity.adapterId,
      primaryArchetype: payload.primaryArchetype,
      pageTypes: resolvePageTypesFromSiteContext(payload.siteContext, [resolveConfiguredPageTypes(payload.siteProfile)]),
      capabilityFamilies: payload.capabilityFamilies,
      supportedIntents: payload.supportedIntents,
    });
    return;
  }

  throw new Error(`Unsupported publish metadata kind: ${kind}`);
}
