// @ts-check

export const PUBLIC_BUILD_COMMAND = 'build';

export const PUBLIC_BOOLEAN_BUILD_FLAGS = Object.freeze([
  '--auto',
  '--manual',
  '--deep',
  '--network',
  '--cookie-stdin',
  '--robots-plan',
  '--login-enhanced',
  '--public-only',
  '--render-js',
  '--no-render-js',
  '--explain',
  '--json',
  '--quiet',
  '--verbose',
  '--debug',
  '--no-color',
  '--ascii',
  '--compact',
  '--no-tty',
  '--force-tty',
]);

export const PUBLIC_ENUM_VALUE_BUILD_FLAGS = Object.freeze([
  ['--privacy', Object.freeze(['limited', 'strict'])],
  ['--report', Object.freeze(['user', 'debug', 'both'])],
  ['--auth', Object.freeze(['none', 'cookie', 'browser'])],
  ['--progress', Object.freeze(['auto', 'interactive', 'plain'])],
]);

export const PUBLIC_STRING_VALUE_BUILD_FLAGS = Object.freeze([
  '--browser-path',
  '--timeout',
  '--max-depth',
  '--max-pages',
  '--max-seeds',
  '--max-sitemaps',
  '--cookie-env',
  '--cookie-file',
  '--auth-check-url',
]);

export const PUBLIC_BUILD_HELP_FLAGS = Object.freeze([
  ...PUBLIC_BOOLEAN_BUILD_FLAGS.filter((flag) => !['--cookie-stdin', '--login-enhanced', '--public-only'].includes(flag)),
  '--privacy limited|strict',
  '--report user|debug|both',
  '--progress auto|interactive|plain',
  '--browser-path <path>',
  '--timeout <ms>',
  '--max-depth <n>',
  '--max-pages <n>',
  '--max-seeds <n>',
  '--max-sitemaps <n>',
]);

export const PUBLIC_BUILD_HELP = `Usage:
  siteforge build <url> [flags]

Examples:
  siteforge build https://example.com/
  siteforge build https://example.com/ --auto --privacy limited --report user
  siteforge build https://example.com/

Flags:
  --auto
  --manual               Accepted for compatibility; build still starts immediately without prompts.
  --deep                 Broaden static and sanitized structure discovery.
  --network              Save only a sanitized network summary where available; raw traces are not persisted.
  --render-js            Enable rendered-page discovery.
  --no-render-js         Disable rendered-page discovery.
  --robots-plan          On robots/setup block, print a machine-readable compliant remediation plan.
  --privacy limited|strict
  --browser-path <path>
  --timeout <ms>
  --max-depth <n>
  --max-pages <n>
  --max-seeds <n>
  --max-sitemaps <n>
  --explain
  --report user|debug|both
  --json
  --quiet
  --verbose
  --debug
  --no-color
  --ascii
  --compact
  --progress auto|interactive|plain
  --no-tty
  --force-tty

Authentication and browser bridge settings are read from siteforge.local.json.
Advanced authentication flags remain accepted for compatibility and test automation, but are intentionally hidden from the user-facing help.
`;

export function publicBooleanBuildFlagSet() {
  return new Set(PUBLIC_BOOLEAN_BUILD_FLAGS);
}

export function publicValueBuildFlagMap() {
  return publicEnumValueBuildFlagMap();
}

export function publicEnumValueBuildFlagMap() {
  return new Map(PUBLIC_ENUM_VALUE_BUILD_FLAGS.map(([flag, values]) => [flag, [...values]]));
}

export function publicStringValueBuildFlagSet() {
  return new Set(PUBLIC_STRING_VALUE_BUILD_FLAGS);
}
