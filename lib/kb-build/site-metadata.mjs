import path from 'node:path';
import {
  resolvePrimaryArchetypeFromSiteContext,
  resolveSafeActionKindsFromSiteContext,
  resolveSupportedIntentsFromSiteContext,
} from '../sites/context.mjs';
import { upsertSiteCapabilities, upsertSiteRegistryRecord } from '../sites/repository.mjs';
import { toArray, uniqueSortedStrings } from '../normalize.mjs';
import { resolveConfiguredPageTypes } from '../sites/page-types.mjs';

function deriveCapabilityFamiliesFromModel(model) {
  const intentTypes = new Set(
    toArray(model.intents)
      .map((intent) => intent?.intentType ?? intent?.intentId)
      .filter(Boolean),
  );
  const capabilityFamilies = new Set(toArray(model.siteProfile?.capabilityFamilies));

  if ([...intentTypes].some((intentType) => String(intentType).startsWith('search-'))) {
    capabilityFamilies.add('search-content');
  }
  if (['open-book', 'open-work', 'open-video'].some((intentType) => intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-content');
  }
  if (['open-author', 'open-actress', 'open-model', 'open-up'].some((intentType) => intentTypes.has(intentType))) {
    capabilityFamilies.add('navigate-to-author');
  }
  if (intentTypes.has('open-category') || intentTypes.has('list-category-videos')) {
    capabilityFamilies.add('navigate-to-category');
  }
  if (intentTypes.has('open-utility-page')) {
    capabilityFamilies.add('navigate-to-utility-page');
  }
  if (intentTypes.has('open-chapter')) {
    capabilityFamilies.add('navigate-to-chapter');
  }
  if (intentTypes.has('download-book')) {
    capabilityFamilies.add('download-content');
  }

  return uniqueSortedStrings([...capabilityFamilies]);
}

export async function syncKnowledgeBaseSiteMetadata({
  cwd,
  host,
  baseUrl,
  generatedAt,
  kbDir,
  kbFiles,
  lintSummary,
  siteContext,
  model,
  siteProfilePath,
}) {
  const usedActionKinds = uniqueSortedStrings(
    toArray(model.intents)
      .map((intent) => intent?.actionId)
      .filter(Boolean),
  );
  const approvalActionKinds = uniqueSortedStrings(
    toArray(model.approvalRules)
      .flatMap((rule) => toArray(rule?.appliesTo?.actionIds))
      .filter((actionId) => usedActionKinds.includes(actionId)),
  );
  const safeActionKinds = uniqueSortedStrings(
    usedActionKinds.filter((actionId) => !approvalActionKinds.includes(actionId)),
  );
  const resolvedPrimaryArchetype = resolvePrimaryArchetypeFromSiteContext(siteContext, [model.siteProfile?.primaryArchetype]);
  const resolvedPageTypes = resolveConfiguredPageTypes(model.siteProfile);
  const resolvedCapabilityFamilies = deriveCapabilityFamiliesFromModel(model);
  const resolvedSupportedIntents = resolveSupportedIntentsFromSiteContext(
    siteContext,
    [toArray(model.intents).map((intent) => intent.intentType ?? intent.intentId)],
  );
  const resolvedSafeActionKinds = resolveSafeActionKindsFromSiteContext(siteContext, [safeActionKinds]);

  await upsertSiteRegistryRecord(cwd, host, {
    canonicalBaseUrl: baseUrl,
    siteArchetype: resolvedPrimaryArchetype,
    profilePath: siteProfilePath ?? null,
    knowledgeBaseDir: kbDir,
    latestKnowledgeBaseCompileAt: generatedAt,
    latestKnowledgeBaseSourcesPath: path.join(kbDir, kbFiles.sources),
    latestLintSummary: lintSummary,
  });
  await upsertSiteCapabilities(cwd, host, {
    baseUrl,
    primaryArchetype: resolvedPrimaryArchetype,
    pageTypes: resolvedPageTypes,
    capabilityFamilies: resolvedCapabilityFamilies,
    supportedIntents: resolvedSupportedIntents,
    safeActionKinds: resolvedSafeActionKinds,
    approvalActionKinds,
  });
}
