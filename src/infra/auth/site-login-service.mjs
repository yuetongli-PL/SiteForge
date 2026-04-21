// @ts-check

import { inspectReusableSiteSession as inspectReusableSiteSessionEntrypoint } from './site-auth.mjs';
import { siteLogin as siteLoginEntrypoint } from '../../entrypoints/sites/site-login.mjs';

export const siteLogin = siteLoginEntrypoint;
export const inspectReusableSiteSession = inspectReusableSiteSessionEntrypoint;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function definedEntries(input) {
  return Object.fromEntries(
    Object.entries(input ?? {}).filter(([, value]) => value !== undefined),
  );
}

export function buildSiteLoginBootstrapOptions(request = {}, overrides = {}) {
  const reuseLoginState = hasOwn(overrides, 'reuseLoginState')
    ? overrides.reuseLoginState
    : (hasOwn(request, 'reuseLoginState') ? request.reuseLoginState : true);
  const autoLogin = hasOwn(overrides, 'autoLogin')
    ? overrides.autoLogin
    : (hasOwn(request, 'autoLogin') ? request.autoLogin : request.allowAutoLoginBootstrap !== false);

  return definedEntries({
    profilePath: hasOwn(overrides, 'profilePath') ? overrides.profilePath : request.profilePath,
    browserPath: hasOwn(overrides, 'browserPath') ? overrides.browserPath : request.browserPath,
    browserProfileRoot: hasOwn(overrides, 'browserProfileRoot') ? overrides.browserProfileRoot : request.browserProfileRoot,
    userDataDir: hasOwn(overrides, 'userDataDir') ? overrides.userDataDir : request.userDataDir,
    reuseLoginState,
    autoLogin,
    headless: hasOwn(overrides, 'headless') ? overrides.headless : request.headless,
    waitForManualLogin: hasOwn(overrides, 'waitForManualLogin') ? overrides.waitForManualLogin : request.waitForManualLogin,
    outDir: hasOwn(overrides, 'outDir') ? overrides.outDir : request.outDir,
    timeoutMs: hasOwn(overrides, 'timeoutMs') ? overrides.timeoutMs : request.timeoutMs,
    manualLoginTimeoutMs: hasOwn(overrides, 'manualLoginTimeoutMs') ? overrides.manualLoginTimeoutMs : request.manualLoginTimeoutMs,
    runtimePurpose: hasOwn(overrides, 'runtimePurpose') ? overrides.runtimePurpose : request.runtimePurpose,
    loginUsername: hasOwn(overrides, 'loginUsername') ? overrides.loginUsername : request.loginUsername,
    loginPassword: hasOwn(overrides, 'loginPassword') ? overrides.loginPassword : request.loginPassword,
    credentialTarget: hasOwn(overrides, 'credentialTarget') ? overrides.credentialTarget : request.credentialTarget,
    disableCredentialManager: hasOwn(overrides, 'disableCredentialManager')
      ? overrides.disableCredentialManager
      : request.disableCredentialManager,
  });
}

export function buildReusableSessionInspectionSettings(request = {}, overrides = {}) {
  const reuseLoginState = hasOwn(overrides, 'reuseLoginState')
    ? overrides.reuseLoginState
    : (hasOwn(request, 'reuseLoginState') ? request.reuseLoginState : true);

  return definedEntries({
    browserProfileRoot: hasOwn(overrides, 'browserProfileRoot') ? overrides.browserProfileRoot : request.browserProfileRoot,
    userDataDir: hasOwn(overrides, 'userDataDir') ? overrides.userDataDir : request.userDataDir,
    reuseLoginState,
  });
}

export function buildReusableSessionInspectionOptions(request = {}, overrides = {}) {
  return definedEntries({
    profilePath: hasOwn(overrides, 'profilePath') ? overrides.profilePath : request.profilePath,
    siteProfile: hasOwn(overrides, 'siteProfile') ? overrides.siteProfile : request.siteProfile,
  });
}

export async function runSiteLoginBootstrap(inputUrl, request = {}, deps = {}, overrides = {}) {
  return await (deps.siteLogin ?? siteLogin)(
    inputUrl,
    buildSiteLoginBootstrapOptions(request, overrides),
    deps.siteLoginDeps ?? {},
  );
}

export async function inspectRequestReusableSiteSession(inputUrl, request = {}, deps = {}, settingsOverrides = {}, optionOverrides = {}) {
  return await (deps.inspectReusableSiteSession ?? inspectReusableSiteSession)(
    inputUrl,
    buildReusableSessionInspectionSettings(request, settingsOverrides),
    buildReusableSessionInspectionOptions(request, optionOverrides),
    deps.inspectReusableSiteSessionDeps ?? deps,
  );
}

export function didSiteLoginProduceReusableSession(report) {
  return report?.auth?.persistenceVerified === true || report?.auth?.status === 'session-reused';
}

export async function bootstrapReusableSiteSession(inputUrl, request = {}, deps = {}, overrides = {}) {
  const report = await runSiteLoginBootstrap(inputUrl, request, deps, overrides);
  return {
    ok: (deps.didSiteLoginProduceReusableSession ?? didSiteLoginProduceReusableSession)(report),
    report,
  };
}
