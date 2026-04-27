// @ts-check

import {
  addCommonProfileFlags,
  addLoginFlags,
  legacyItems,
  normalizePositiveInteger,
  pushFlag,
  resolveNativeResourceSeeds,
  toArray,
} from './common.mjs';

export const siteKey = 'xiaohongshu';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'image',
  method: 'native-xiaohongshu-resource-seeds',
  completeReason: 'xiaohongshu-resource-seeds-provided',
  incompleteReason: 'xiaohongshu-resource-seeds-incomplete',
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
  const maxItems = normalizePositiveInteger(request.maxItems ?? request.limit ?? plan.policy?.maxItems, null);
  if (maxItems) {
    args.push('--max-items', String(maxItems));
  }
  pushFlag(args, '--author-page-limit', request.authorPageLimit);
  if (request.followedUsers) {
    args.push('--followed-users');
  }
  pushFlag(args, '--followed-user-limit', request.followedUserLimit);
  for (const query of toArray(request.query ?? request.queries)) {
    pushFlag(args, '--query', query);
  }
  pushFlag(args, '--author-resume-state', request.authorResumeState);
  args.push('--output', 'full', '--format', 'json');
  return args;
}

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
