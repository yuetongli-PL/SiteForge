// @ts-check

import path from 'node:path';

import { normalizeText } from '../../../shared/normalize.mjs';

export { normalizeText };

export function toArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

export function normalizePositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function isHttpUrl(value) {
  return /^https?:\/\//iu.test(String(value ?? '').trim());
}

export function resolveEntrypoint(entrypoint, workspaceRoot) {
  const normalized = normalizeText(entrypoint);
  if (!normalized) {
    throw new Error('Legacy download plan is missing legacy.entrypoint.');
  }
  return path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
}

export function resolveExecutorKind(plan, entrypointPath) {
  const explicit = normalizeText(plan.legacy?.executorKind).toLowerCase();
  if (explicit) {
    return explicit;
  }
  return entrypointPath.endsWith('.mjs') || entrypointPath.endsWith('.js') ? 'node' : 'python';
}

export function legacyItems(plan, request = {}) {
  const items = [
    ...toArray(request.items),
    request.input,
    request.inputUrl,
    request.url,
    request.account,
    plan.source?.input,
  ].map((item) => normalizeText(item)).filter(Boolean);
  return [...new Set(items)];
}

export function pushFlag(args, flag, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }
  args.push(flag, String(value));
}

export function pushBooleanFlag(args, condition, trueFlag, falseFlag = null) {
  if (condition === undefined || condition === null) {
    return;
  }
  if (condition) {
    args.push(trueFlag);
  } else if (falseFlag) {
    args.push(falseFlag);
  }
}

export function resolveReuseLoginState(request = {}, options = {}) {
  if (request.reuseLoginState !== undefined) {
    return request.reuseLoginState !== false;
  }
  if (options.reuseLoginState !== undefined) {
    return options.reuseLoginState !== false;
  }
  return true;
}

export function addCommonProfileFlags(args, request = {}, sessionLease = {}) {
  pushFlag(args, '--profile-path', request.profilePath);
  pushFlag(args, '--browser-path', request.browserPath);
  pushFlag(args, '--browser-profile-root', request.browserProfileRoot ?? sessionLease.browserProfileRoot);
  pushFlag(args, '--user-data-dir', request.userDataDir ?? sessionLease.userDataDir);
  pushFlag(args, '--timeout', request.timeoutMs ?? request.timeout);
}

export function addLoginFlags(args, request = {}, options = {}, siteKey) {
  const reuseLoginState = resolveReuseLoginState(request, options);
  pushBooleanFlag(args, reuseLoginState, '--reuse-login-state', '--no-reuse-login-state');
  if (siteKey === 'xiaohongshu') {
    pushBooleanFlag(args, request.autoLogin ?? options.autoLogin, '--auto-login', '--no-auto-login');
  } else {
    pushBooleanFlag(
      args,
      request.allowAutoLoginBootstrap ?? options.allowAutoLoginBootstrap,
      '--auto-login-bootstrap',
      '--no-auto-login-bootstrap',
    );
  }
  if (request.headless === false || options.headless === false) {
    args.push('--no-headless');
  } else if (request.headless === true || options.headless === true) {
    args.push('--headless');
  }
}

export function addDownloadPolicyFlags(args, plan, request = {}) {
  const policy = plan.policy ?? {};
  pushFlag(args, '--concurrency', request.concurrency ?? policy.concurrency);
  const maxItems = normalizePositiveInteger(request.maxItems ?? request.limit ?? policy.maxItems, null);
  if (maxItems) {
    args.push('--max-items', String(maxItems));
  }
  if (request.concurrentFragments) {
    args.push('--concurrent-fragments', String(request.concurrentFragments));
  }
  if (request.maxHeight) {
    args.push('--max-height', String(request.maxHeight));
  }
  if (request.container) {
    args.push('--container', String(request.container));
  }
}

export function buildGenericLegacyArgs(entrypointPath, plan, request = {}, layout) {
  return [entrypointPath, 'download', ...legacyItems(plan, request), '--out-dir', layout.runDir];
}
