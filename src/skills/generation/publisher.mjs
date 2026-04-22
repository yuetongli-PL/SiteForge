// @ts-check

import path from 'node:path';
import { buildSkillPublisherModel } from './build-publisher-model.mjs';
import { resolveSkillPublisherInput } from './resolve-publisher-input.mjs';
import { syncPublishedSiteMetadata } from './sync-site-metadata.mjs';

export async function publishSkill(inputUrl, options, deps) {
  const publisherInput = await resolveSkillPublisherInput(inputUrl, options, {
    resolveSourceInputs: deps.resolveSourceInputs,
  });
  const context = buildSkillPublisherModel(publisherInput);
  context.skillName = options.skillName;
  context.siteDisplayName = options.skillName;

  const skillDir = path.resolve(options.outDir ?? path.join(deps.cwd, 'skills', options.skillName));
  const outputs = deps.buildOutputPaths(skillDir);
  await deps.rm(skillDir, { recursive: true, force: true });
  await deps.ensureDir(outputs.referencesDir);

  const docsByIntent = deps.collectFlowDocs(context);

  await deps.writeTextFile(outputs.skillMd, deps.renderSkillMd(context, outputs));
  await deps.writeTextFile(outputs.indexMd, deps.renderIndexReference(context, outputs, docsByIntent));
  await deps.writeTextFile(outputs.flowsMd, await deps.renderFlowsReference(context, outputs, docsByIntent));
  await deps.writeTextFile(outputs.recoveryMd, await deps.renderRecoveryReference(context, outputs));
  await deps.writeTextFile(outputs.approvalMd, await deps.renderApprovalReference(context, outputs));
  await deps.writeTextFile(outputs.nlIntentsMd, await deps.renderNlIntentsReference(context, outputs));
  await deps.writeTextFile(outputs.interactionModelMd, await deps.renderInteractionModelReference(context, outputs));

  await syncPublishedSiteMetadata('skill', {
    cwd: deps.cwd,
    host: publisherInput.run.host,
    inputUrl,
    baseUrl: publisherInput.run.baseUrl,
    generatedAt: new Date().toISOString(),
    skillDir,
    profilePath: context.step3SourceRefs?.files?.siteProfile ?? context.step3SourceRefs?.siteProfile ?? null,
    kbDir: publisherInput.published.kbDir,
    siteContext: publisherInput.site.siteContext,
    siteProfile: publisherInput.site.siteProfile,
    primaryArchetype: deps.resolvePrimaryArchetype(context),
    capabilityFamilies: deps.resolveCapabilityFamilies(context),
    supportedIntents: deps.resolveSupportedIntents(context),
    siteMetadataOptions: options.siteMetadataOptions ?? null,
  }, {
    upsertSiteRegistryRecord: deps.upsertSiteRegistryRecord,
    upsertSiteCapabilities: deps.upsertSiteCapabilities,
  });

  return {
    skillDir,
    skillName: options.skillName,
    references: [
      deps.toPosixPath(path.relative(skillDir, outputs.indexMd)),
      deps.toPosixPath(path.relative(skillDir, outputs.flowsMd)),
      deps.toPosixPath(path.relative(skillDir, outputs.recoveryMd)),
      deps.toPosixPath(path.relative(skillDir, outputs.approvalMd)),
      deps.toPosixPath(path.relative(skillDir, outputs.nlIntentsMd)),
      deps.toPosixPath(path.relative(skillDir, outputs.interactionModelMd)),
    ],
    sourceLayout: publisherInput.resolution.layout,
    warnings: deps.uniqueSortedStrings(context.warnings),
  };
}
