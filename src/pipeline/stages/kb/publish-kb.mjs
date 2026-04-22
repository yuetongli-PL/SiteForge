// @ts-check

import { resolveKnowledgeBasePublisherInput } from '../../../skills/generation/resolve-publisher-input.mjs';
import { buildKnowledgeBasePublisherModel } from '../../../skills/generation/build-publisher-model.mjs';
import { syncPublishedSiteMetadata } from '../../../skills/generation/sync-site-metadata.mjs';

export async function publishKnowledgeBase(inputUrl, options, deps) {
  const publisherInput = await resolveKnowledgeBasePublisherInput(inputUrl, options, {
    resolveCompileArtifacts: deps.resolveCompileArtifacts,
    readSiteContext: deps.readSiteContext,
  });
  const layout = deps.buildKbLayout(publisherInput.run.baseUrl, options.kbDir);
  const generatedAt = new Date().toISOString();
  await deps.initializeKnowledgeBaseDirs(layout);

  const artifacts = publisherInput.compat.artifacts;
  const sourceRunIds = deps.buildSourceRunIds([
    artifacts.capture,
    artifacts.expanded,
    artifacts.bookContent,
    artifacts.analysis,
    artifacts.abstraction,
    artifacts.nlEntry,
    artifacts.docs,
    artifacts.governance,
  ]);

  await deps.appendKbEvent(layout.kbDir, 'compile_start', 'running', `Starting compile for ${artifacts.baseUrl}.`, { sourceRunIds });

  const copiedSources = await deps.copyRawSources(layout.kbDir, [
    artifacts.capture,
    artifacts.expanded,
    ...(artifacts.bookContent ? [artifacts.bookContent] : []),
    artifacts.analysis,
    artifacts.abstraction,
    artifacts.nlEntry,
    artifacts.docs,
    artifacts.governance,
  ]);

  for (const source of copiedSources) {
    await deps.appendKbEvent(
      layout.kbDir,
      source.reused ? 'reuse_raw_artifact' : 'copy_raw_artifact',
      'success',
      `${source.reused ? 'Reused' : 'Copied'} ${source.step} from ${source.dir}.`,
      { sourceRunIds },
    );
  }

  const rawResolver = deps.createRawResolver(layout.kbDir, copiedSources);
  const sourcesDocument = deps.buildSourceIndexDocument(publisherInput.run.inputUrl, publisherInput.run.baseUrl, generatedAt, copiedSources);
  const model = buildKnowledgeBasePublisherModel(publisherInput, {
    buildDataModel: deps.buildDataModel,
    finalizeDataModel: deps.finalizeDataModel,
  });
  const kbAugmentation = deps.resolveKnowledgeBaseAugmentation({
    siteContext: publisherInput.site.siteContext,
    baseUrl: publisherInput.run.baseUrl,
    host: publisherInput.run.host,
    profile: model.siteProfile,
  });
  const context = {
    generatedAt,
    kbDir: layout.kbDir,
    artifacts,
    model,
    siteContext: publisherInput.site.siteContext,
    rawResolver,
    kbAugmentation,
  };

  await deps.writeKnowledgeBaseSchemaFiles(layout.kbDir, deps.kbFiles);
  const pages = deps.buildPageDescriptors(context);
  await deps.writePagesAndIndexes(context, pages, sourcesDocument);

  const { lintReport, gapReport } = await deps.lintKnowledgeBase(layout.kbDir, {
    reportDir: layout.reportsDir,
    failOnWarnings: false,
  });

  await deps.appendKbEvent(
    layout.kbDir,
    'compile_complete',
    lintReport.summary.passed ? 'success' : 'failed',
    `Compile finished with ${pages.length} pages, ${lintReport.summary.errorCount} errors, ${lintReport.summary.warningCount} warnings.`,
    { sourceRunIds },
  );

  await syncPublishedSiteMetadata('knowledge-base', {
    cwd: deps.cwd,
    host: publisherInput.run.host,
    baseUrl: publisherInput.run.baseUrl,
    generatedAt,
    kbDir: layout.kbDir,
    kbFiles: deps.kbFiles,
    lintSummary: lintReport.summary,
    siteContext: publisherInput.site.siteContext,
    model,
    siteProfilePath: artifacts.analysis.siteProfilePath,
    siteMetadataOptions: options.siteMetadataOptions ?? null,
  }, {
    syncKnowledgeBaseSiteMetadata: deps.syncKnowledgeBaseSiteMetadata,
  });

  return {
    kbDir: layout.kbDir,
    generatedAt,
    pages: pages.length,
    lintSummary: lintReport.summary,
    gapGroups: Object.fromEntries(Object.entries(gapReport.groups).map(([key, value]) => [key, value.length])),
  };
}
