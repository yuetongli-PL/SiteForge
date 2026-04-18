// @ts-check

export function buildKnowledgeBasePublisherModel(publisherInput, deps) {
  const model = deps.finalizeDataModel(deps.buildDataModel(publisherInput.compat.artifacts));
  return {
    ...model,
    inputUrl: publisherInput.run.inputUrl,
    baseUrl: publisherInput.run.baseUrl,
  };
}

export function buildSkillPublisherModel(publisherInput) {
  return {
    ...publisherInput.compat.context,
    baseUrl: publisherInput.run.baseUrl,
    step3SourceRefs: publisherInput.sourceRefs.analysis ?? publisherInput.compat.context.step3SourceRefs ?? null,
    step4SourceRefs: publisherInput.sourceRefs.abstraction ?? publisherInput.compat.context.step4SourceRefs ?? null,
    step5SourceRefs: publisherInput.sourceRefs.nlEntry ?? publisherInput.compat.context.step5SourceRefs ?? null,
    step6SourceRefs: publisherInput.sourceRefs.docs ?? publisherInput.compat.context.step6SourceRefs ?? null,
    step7SourceRefs: publisherInput.sourceRefs.governance ?? publisherInput.compat.context.step7SourceRefs ?? null,
    stepBookContentSourceRefs: publisherInput.sourceRefs.bookContent ?? publisherInput.compat.context.stepBookContentSourceRefs ?? null,
  };
}
