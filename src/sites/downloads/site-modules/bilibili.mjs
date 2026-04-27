// @ts-check

import {
  addCommonProfileFlags,
  addLoginFlags,
  legacyItems,
  normalizePositiveInteger,
  pushFlag,
  resolveNativeResourceSeeds,
} from './common.mjs';

export const siteKey = 'bilibili';

export const nativeSeedResolverOptions = Object.freeze({
  defaultMediaType: 'video',
  method: 'native-bilibili-resource-seeds',
  completeReason: 'bilibili-resource-seeds-provided',
  incompleteReason: 'bilibili-resource-seeds-incomplete',
});

export function resolveResources(plan, sessionLease = null, context = {}) {
  return resolveNativeResourceSeeds(siteKey, plan, sessionLease, context, nativeSeedResolverOptions);
}

export function buildLegacyArgs(entrypointPath, plan, request = {}, sessionLease = {}, options = {}, layout) {
  const args = [entrypointPath, 'download', ...legacyItems(plan, request)];
  addCommonProfileFlags(args, request, sessionLease);
  addLoginFlags(args, request, options, plan.siteKey);
  pushFlag(args, '--out-dir', layout.runDir);
  pushFlag(args, '--concurrency', request.concurrency ?? plan.policy?.concurrency);
  const playlistLimit = request.maxPlaylistItems ?? request.maxItems ?? plan.policy?.maxItems;
  if (normalizePositiveInteger(playlistLimit, null)) {
    args.push('--max-playlist-items', String(playlistLimit));
  }
  if (request.skipExisting ?? plan.policy?.skipExisting) {
    args.push('--skip-existing');
  }
  if (request.retryFailedOnly) {
    args.push('--retry-failed-only');
  }
  if (request.resume === false) {
    args.push('--no-resume');
  } else if (request.resume === true) {
    args.push('--resume');
  }
  pushFlag(args, '--download-archive', request.downloadArchivePath);
  return args;
}

export default Object.freeze({
  siteKey,
  resolveResources,
  buildLegacyArgs,
});
