// @ts-check

import { resolvePageTypesFromSiteContext } from '../../site-context.mjs';
import { resolveConfiguredPageTypes } from '../../sites/page-types.mjs';

export async function syncPublishedSiteMetadata(kind, payload, deps) {
  if (kind === 'knowledge-base') {
    await deps.syncKnowledgeBaseSiteMetadata(payload);
    return;
  }

  if (kind === 'skill') {
    const generatedAt = payload.generatedAt ?? new Date().toISOString();
    await deps.upsertSiteRegistryRecord(payload.cwd, payload.host, {
      canonicalBaseUrl: payload.baseUrl ?? payload.inputUrl,
      repoSkillDir: payload.skillDir,
      latestSkillGeneratedAt: generatedAt,
      profilePath: payload.profilePath ?? null,
      knowledgeBaseDir: payload.kbDir,
    });
    await deps.upsertSiteCapabilities(payload.cwd, payload.host, {
      baseUrl: payload.baseUrl ?? payload.inputUrl,
      primaryArchetype: payload.primaryArchetype,
      pageTypes: resolvePageTypesFromSiteContext(payload.siteContext, [resolveConfiguredPageTypes(payload.siteProfile)]),
      capabilityFamilies: payload.capabilityFamilies,
      supportedIntents: payload.supportedIntents,
    });
    return;
  }

  throw new Error(`Unsupported publish metadata kind: ${kind}`);
}
