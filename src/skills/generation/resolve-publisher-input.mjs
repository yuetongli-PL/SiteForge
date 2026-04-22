// @ts-check

function createArtifactRef(source) {
  if (!source) {
    return null;
  }
  return {
    step: source.step ?? null,
    key: source.key ?? null,
    dir: source.dir ?? null,
    manifestPath: source.manifestPath ?? null,
    generatedAt: source.generatedAt ?? null,
    runId: source.runId ?? null,
    files: source.files ?? null,
  };
}

export async function resolveKnowledgeBasePublisherInput(inputUrl, options, deps) {
  const artifacts = await deps.resolveCompileArtifacts(inputUrl, options);
  const siteContext = await deps.readSiteContext(
    artifacts.workspaceRoot,
    artifacts.host,
    options.siteMetadataOptions ?? {},
  );
  return {
    kind: 'knowledge-base',
    run: {
      inputUrl: artifacts.inputUrl,
      baseUrl: artifacts.baseUrl,
      host: artifacts.host,
      workspaceRoot: artifacts.workspaceRoot,
      generatedAt: null,
    },
    sourceRefs: {
      capture: createArtifactRef(artifacts.capture),
      expandedStates: createArtifactRef(artifacts.expanded),
      bookContent: createArtifactRef(artifacts.bookContent),
      analysis: createArtifactRef(artifacts.analysis),
      abstraction: createArtifactRef(artifacts.abstraction),
      nlEntry: createArtifactRef(artifacts.nlEntry),
      docs: createArtifactRef(artifacts.docs),
      governance: createArtifactRef(artifacts.governance),
    },
    site: {
      siteContext,
      siteProfile: artifacts.analysis?.siteProfileDocument ?? null,
      terminologyHints: null,
    },
    model: null,
    content: {},
    bookContent: {
      manifest: artifacts.bookContent?.manifest ?? null,
      books: artifacts.bookContent?.booksDocument ?? [],
      authors: artifacts.bookContent?.authorsDocument ?? [],
      searchResults: artifacts.bookContent?.searchResultsDocument ?? [],
    },
    published: {
      kbDir: options.kbDir,
      kbIndex: null,
    },
    resolution: {
      layout: 'raw-artifacts',
      warnings: [...(artifacts.warnings ?? [])],
    },
    compat: {
      artifacts,
    },
  };
}

export async function resolveSkillPublisherInput(inputUrl, options, deps) {
  const context = await deps.resolveSourceInputs(inputUrl, options);
  return {
    kind: 'skill',
    run: {
      inputUrl,
      baseUrl: context.baseUrl ?? inputUrl,
      host: context.host,
      workspaceRoot: context.workspaceRoot ?? process.cwd(),
      generatedAt: null,
    },
    sourceRefs: {
      analysis: createArtifactRef(context.step3SourceRefs),
      abstraction: createArtifactRef(context.step4SourceRefs),
      nlEntry: createArtifactRef(context.step5SourceRefs),
      docs: createArtifactRef(context.step6SourceRefs),
      governance: createArtifactRef(context.step7SourceRefs),
      bookContent: createArtifactRef(context.stepBookContentSourceRefs),
    },
    site: {
      siteContext: context.siteContext,
      siteProfile: context.siteProfileDocument ?? null,
      terminologyHints: context.siteCapabilitiesRecord ?? null,
    },
    model: null,
    content: {
      wikiIndexPath: context.wikiIndexPath,
      wikiSchema: context.wikiSchema,
      flowsDir: context.flowsDir,
      recoveryPath: context.recoveryPath,
      approvalPath: context.approvalPath,
      nlIntentsPath: context.nlIntentsPath,
      interactionModelPath: context.interactionModelPath,
      docsManifest: context.docsManifest,
    },
    bookContent: {
      manifest: context.bookContentManifest,
      books: context.booksContentDocument,
      authors: context.authorsContentDocument,
      searchResults: context.searchResultsDocument,
      rawDir: context.bookContentRawDir ?? null,
    },
    published: {
      kbDir: context.kbDir,
      kbIndex: {
        pages: context.pagesDocument,
        sources: context.sourcesDocument,
      },
    },
    resolution: {
      layout: context.sourceLayout,
      warnings: [...(context.warnings ?? [])],
    },
    compat: {
      context,
    },
  };
}
