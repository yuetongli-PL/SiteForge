// @ts-check

export const COMMON_REPORT_PROFILE_KEYS = Object.freeze([
  'profilePath',
  'browserProfileRoot',
  'userDataDir',
]);

export const SESSION_REPORT_PROFILE_KEYS = Object.freeze([
  ...COMMON_REPORT_PROFILE_KEYS,
  'networkIdentityFingerprint',
  'sessionLeaseId',
  'fingerprint',
]);

export function reportProfileKeySet(extraKeys = []) {
  return Object.freeze(new Set([
    ...COMMON_REPORT_PROFILE_KEYS,
    ...extraKeys,
  ]));
}
