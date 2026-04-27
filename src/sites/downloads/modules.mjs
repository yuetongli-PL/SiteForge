// @ts-check

import process from 'node:process';

import { normalizeText } from '../../shared/normalize.mjs';
import book22BiquModule from './site-modules/22biqu.mjs';
import bilibiliModule from './site-modules/bilibili.mjs';
import {
  buildGenericLegacyArgs,
  resolveEntrypoint,
  resolveExecutorKind,
} from './site-modules/common.mjs';
import douyinModule from './site-modules/douyin.mjs';
import { createSocialSiteModule } from './site-modules/social.mjs';
import xiaohongshuModule from './site-modules/xiaohongshu.mjs';
import {
  createDownloadPlan as createRegistryDownloadPlan,
  resolveDownloadResources as resolveRegistryDownloadResources,
} from './registry.mjs';

function buildLegacyCommandWithSiteModule(siteModule, plan, sessionLease = null, request = {}, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const layout = options.layout;
  if (!layout) {
    throw new Error('buildLegacyDownloadCommand requires options.layout.');
  }
  const entrypointPath = resolveEntrypoint(plan.legacy?.entrypoint, workspaceRoot);
  if (siteModule?.buildLegacyCommand) {
    return siteModule.buildLegacyCommand(entrypointPath, plan, request, sessionLease ?? {}, options, layout);
  }

  const executorKind = resolveExecutorKind(plan, entrypointPath);
  const command = executorKind === 'node'
    ? (options.nodePath ?? request.nodePath ?? process.execPath)
    : (options.pythonPath ?? request.pythonPath ?? 'python');
  const args = siteModule?.buildLegacyArgs
    ? siteModule.buildLegacyArgs(entrypointPath, plan, request, sessionLease ?? {}, options, layout)
    : buildGenericLegacyArgs(entrypointPath, plan, request, layout);
  return { command, args, executorKind };
}

function buildFallbackLegacyCommand(plan, sessionLease = null, request = {}, options = {}) {
  return buildLegacyCommandWithSiteModule(null, plan, sessionLease, request, options);
}

function createRegistryBackedSiteModule(siteModule) {
  return {
    siteKey: siteModule.siteKey,
    async createPlan(request = {}, context = {}) {
      return await createRegistryDownloadPlan(request, context);
    },
    async resolveResources(plan, sessionLease = null, context = {}) {
      const nativeResolvedTask = siteModule?.resolveResources
        ? await siteModule.resolveResources(plan, sessionLease, context)
        : null;
      if (nativeResolvedTask) {
        return nativeResolvedTask;
      }
      return await resolveRegistryDownloadResources(plan, sessionLease, context);
    },
    buildLegacyCommand(plan, sessionLease = null, request = {}, options = {}) {
      return buildLegacyCommandWithSiteModule(siteModule, plan, sessionLease, request, options);
    },
  };
}

const SITE_MODULES = Object.freeze(Object.fromEntries([
  book22BiquModule,
  bilibiliModule,
  douyinModule,
  xiaohongshuModule,
  createSocialSiteModule('x'),
  createSocialSiteModule('instagram'),
].map((siteModule) => [siteModule.siteKey, createRegistryBackedSiteModule(siteModule)])));

export function getDownloadSiteModule(siteKey) {
  return SITE_MODULES[normalizeText(siteKey).toLowerCase()] ?? null;
}

export function listDownloadSiteModules() {
  return Object.values(SITE_MODULES);
}

export async function createDownloadPlan(request = {}, context = {}) {
  const module = getDownloadSiteModule(context.definition?.siteKey ?? request.siteKey ?? request.site);
  if (module?.createPlan) {
    return await module.createPlan(request, context);
  }
  return await createRegistryDownloadPlan(request, context);
}

export async function resolveDownloadResources(plan, sessionLease = null, context = {}) {
  const module = getDownloadSiteModule(plan.siteKey);
  if (module?.resolveResources) {
    return await module.resolveResources(plan, sessionLease, context);
  }
  return await resolveRegistryDownloadResources(plan, sessionLease, context);
}

export function buildLegacyDownloadCommand(plan, sessionLease = null, request = {}, options = {}) {
  const module = getDownloadSiteModule(plan.siteKey);
  if (module?.buildLegacyCommand) {
    return module.buildLegacyCommand(plan, sessionLease, request, options);
  }
  return buildFallbackLegacyCommand(plan, sessionLease, request, options);
}
