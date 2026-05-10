// @ts-check

import path from 'node:path';
import { buildSkillPublisherModel } from './build-publisher-model.mjs';
import { enforceSkillCoverageRegressionGate } from './coverage-regression-gate.mjs';
import { resolveSkillPublisherInput } from './resolve-publisher-input.mjs';
import { syncPublishedSiteMetadata } from './sync-site-metadata.mjs';

function resolveApprovalActionKinds(context) {
  const configured = [
    ...(context.siteCapabilitiesRecord?.approvalActionKinds ?? []),
    ...(context.siteContext?.capabilitiesRecord?.approvalActionKinds ?? []),
  ];
  const inferred = (context.actionsDocument?.actions ?? [])
    .map((action) => action.actionKind)
    .filter((actionKind) => ['auth-submit', 'payment-submit', 'search-submit', 'upload-submit'].includes(actionKind));
  return depsUniqueSorted([...configured, ...inferred]);
}

function depsUniqueSorted(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export async function publishSkill(inputUrl, options, deps) {
  const publisherInput = await resolveSkillPublisherInput(inputUrl, options, {
    resolveSourceInputs: deps.resolveSourceInputs,
  });
  const context = buildSkillPublisherModel(publisherInput);
  context.skillName = options.skillName;
  context.siteDisplayName = options.skillName;

  const skillDir = path.resolve(options.outDir ?? path.join(deps.cwd, 'skills', options.skillName));
  const outputs = deps.buildOutputPaths(skillDir);

  const docsByIntent = deps.collectFlowDocs(context);
  const documents = {
    skillMd: deps.renderSkillMd(context, outputs),
    indexMd: deps.renderIndexReference(context, outputs, docsByIntent),
    flowsMd: await deps.renderFlowsReference(context, outputs, docsByIntent),
    recoveryMd: await deps.renderRecoveryReference(context, outputs),
    approvalMd: await deps.renderApprovalReference(context, outputs),
    nlIntentsMd: await deps.renderNlIntentsReference(context, outputs),
    interactionModelMd: await deps.renderInteractionModelReference(context, outputs),
  };
  const resolvedSafeActionKinds = deps.resolveSafeActions?.(context) ?? [];
  const resolvedApprovalActionKinds = resolveApprovalActionKinds(context);
  const resolvedSupportedIntents = deps.resolveSupportedIntents(context);
  const resolvedCapabilityFamilies = deps.resolveCapabilityFamilies(context);
  const coverageRegressionGate = await enforceSkillCoverageRegressionGate({
    cwd: deps.cwd,
    skillName: options.skillName,
    targetDir: skillDir,
    candidateDocuments: documents,
    candidateCoverage: {
      safeActionKinds: resolvedSafeActionKinds,
      approvalActionKinds: resolvedApprovalActionKinds,
      supportedIntents: resolvedSupportedIntents,
      capabilityFamilies: resolvedCapabilityFamilies,
    },
  });

  await deps.rm(skillDir, { recursive: true, force: true });
  await deps.ensureDir(outputs.referencesDir);

  await deps.writeTextFile(outputs.skillMd, documents.skillMd);
  await deps.writeTextFile(outputs.indexMd, documents.indexMd);
  await deps.writeTextFile(outputs.flowsMd, documents.flowsMd);
  await deps.writeTextFile(outputs.recoveryMd, documents.recoveryMd);
  await deps.writeTextFile(outputs.approvalMd, documents.approvalMd);
  await deps.writeTextFile(outputs.nlIntentsMd, documents.nlIntentsMd);
  await deps.writeTextFile(outputs.interactionModelMd, documents.interactionModelMd);

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
    capabilityFamilies: resolvedCapabilityFamilies,
    supportedIntents: resolvedSupportedIntents,
    safeActionKinds: resolvedSafeActionKinds,
    approvalActionKinds: resolvedApprovalActionKinds,
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
    coverageRegressionGate,
  };
}
