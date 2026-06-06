// @ts-check

export const SITEFORGE_BUILD_STAGE_NAMES = Object.freeze([
  'registerSite',
  'discoverSeeds',
  'crawlStatic',
  'authStateCheck',
  'crawlAuthenticated',
  'crawlRendered',
  'discoverInteractions',
  'captureNetworkTraces',
  'apiAdapterReplay',
  'buildSiteGraph',
  'classifyNodes',
  'extractAffordances',
  'discoverCapabilities',
  'generateIntents',
  'compileExecutionContracts',
  'evaluateExecutionGovernance',
  'dispatchGovernedRuntime',
  'generateSkill',
  'verifySkill',
  'registerSkill',
  'writeBuildReport',
]);

function freezeStageDependencies(dependencies) {
  return Object.freeze(Object.fromEntries(
    Object.entries(dependencies).map(([stageName, stageDependencies]) => [
      stageName,
      Object.freeze([...stageDependencies]),
    ]),
  ));
}

export const SITEFORGE_BUILD_STAGE_DEPENDENCIES = freezeStageDependencies({
  registerSite: [],
  discoverSeeds: ['registerSite'],
  crawlStatic: ['discoverSeeds'],
  authStateCheck: ['crawlStatic'],
  crawlAuthenticated: ['authStateCheck'],
  crawlRendered: ['crawlAuthenticated'],
  discoverInteractions: ['crawlStatic', 'crawlAuthenticated'],
  captureNetworkTraces: ['crawlRendered'],
  apiAdapterReplay: ['captureNetworkTraces'],
  buildSiteGraph: ['crawlStatic', 'crawlAuthenticated', 'discoverInteractions', 'apiAdapterReplay'],
  classifyNodes: ['buildSiteGraph'],
  extractAffordances: ['classifyNodes', 'discoverInteractions'],
  discoverCapabilities: ['extractAffordances'],
  generateIntents: ['discoverCapabilities'],
  compileExecutionContracts: ['classifyNodes', 'discoverCapabilities', 'generateIntents'],
  evaluateExecutionGovernance: ['compileExecutionContracts'],
  dispatchGovernedRuntime: ['evaluateExecutionGovernance'],
  generateSkill: ['classifyNodes', 'discoverCapabilities', 'generateIntents', 'compileExecutionContracts', 'evaluateExecutionGovernance', 'dispatchGovernedRuntime'],
  verifySkill: ['generateSkill'],
  registerSkill: ['verifySkill'],
  writeBuildReport: ['registerSkill'],
});

export function siteForgeBuildStageDependencies(stageName) {
  return SITEFORGE_BUILD_STAGE_DEPENDENCIES[stageName] ?? [];
}

export function validateSiteForgeBuildStagePlan({
  stageNames = SITEFORGE_BUILD_STAGE_NAMES,
  dependencies = SITEFORGE_BUILD_STAGE_DEPENDENCIES,
} = /** @type {any} */ ({})) {
  const errors = [];
  const seen = new Set();
  const stageSet = new Set(stageNames);

  if (stageSet.size !== stageNames.length) {
    errors.push('stage names must be unique');
  }

  for (const stageName of Object.keys(dependencies)) {
    if (!stageSet.has(stageName)) {
      errors.push(`dependency map contains unknown stage ${stageName}`);
    }
  }

  for (const stageName of stageNames) {
    const stageDependencies = dependencies[stageName];
    if (!Array.isArray(stageDependencies)) {
      errors.push(`stage ${stageName} is missing dependency metadata`);
      seen.add(stageName);
      continue;
    }

    for (const dependency of stageDependencies) {
      if (!stageSet.has(dependency)) {
        errors.push(`stage ${stageName} depends on unknown stage ${dependency}`);
      } else if (!seen.has(dependency)) {
        errors.push(`stage ${stageName} depends on later stage ${dependency}`);
      }
    }
    seen.add(stageName);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertSiteForgeBuildStagePlan(plan = /** @type {any} */ ({})) {
  const result = validateSiteForgeBuildStagePlan(plan);
  if (!result.valid) {
    throw new Error(`Invalid SiteForge build stage plan: ${result.errors.join('; ')}`);
  }
  return true;
}
