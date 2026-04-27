// @ts-check

import {
  addCommonProfileFlags,
  addDownloadPolicyFlags,
  addLoginFlags,
  legacyItems,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';

export const siteKey = 'douyin';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'video',
  method: 'native-douyin-resource-seeds',
  completeReason: 'douyin-resource-seeds-provided',
  incompleteReason: 'douyin-resource-seeds-incomplete',
});

export function resolveResources(plan, sessionLease = null, context = {}) {
  return resolveNativeResourceSeeds(siteKey, plan, sessionLease, context, nativeSeedResolverOptions);
}

export function buildLegacyArgs(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
  const args = [entrypointPath, 'download', ...legacyItems(plan, request)];
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--python-path', request.pythonPath ?? options.pythonPath);
  pushFlag(args, '--out-dir', layout.runDir);
  pushFlag(args, '--window', request.followUpdatesWindow ?? request.window);
  for (const user of toArray(request.userFilter ?? request.user ?? request.author)) {
    pushFlag(args, '--user', user);
  }
  for (const keyword of toArray(request.titleKeyword ?? request.keyword)) {
    pushFlag(args, '--keyword', keyword);
  }
  if (request.updatedOnly) {
    args.push('--updated-only');
  }
  addDownloadPolicyFlags(args, plan, request);
  args.push('--output', 'full', '--format', 'json');
  return args;
}

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
