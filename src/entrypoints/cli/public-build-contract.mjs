// @ts-check

export const PUBLIC_BUILD_COMMAND = 'build';

export const PUBLIC_BOOLEAN_BUILD_FLAGS = Object.freeze([
  '--auto',
  '--manual',
  '--deep',
  '--network',
  '--explain',
  '--verbose',
  '--debug',
]);

export const PUBLIC_VALUE_BUILD_FLAGS = Object.freeze([
  ['--privacy', Object.freeze(['limited', 'strict'])],
  ['--report', Object.freeze(['user', 'debug', 'both'])],
]);

export const PUBLIC_BUILD_HELP_FLAGS = Object.freeze([
  ...PUBLIC_BOOLEAN_BUILD_FLAGS,
  '--privacy limited|strict',
  '--report user|debug|both',
]);

export const PUBLIC_BUILD_HELP = `Usage:
  siteforge build <url> [flags]

Examples:
  siteforge build https://example.com/
  siteforge build https://example.com/ --auto --privacy limited --report user

Flags:
  --auto
  --manual
  --deep                 Broaden static and sanitized structure discovery.
  --network              Save only a sanitized network summary where available; raw traces are not persisted.
  --privacy limited|strict
  --explain
  --report user|debug|both
  --verbose
  --debug
`;

export function publicBooleanBuildFlagSet() {
  return new Set(PUBLIC_BOOLEAN_BUILD_FLAGS);
}

export function publicValueBuildFlagMap() {
  return new Map(PUBLIC_VALUE_BUILD_FLAGS.map(([flag, values]) => [flag, [...values]]));
}
