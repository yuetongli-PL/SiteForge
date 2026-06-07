// @ts-check

export const PUBLIC_BUILD_COMMAND = 'build';

export const PUBLIC_BOOLEAN_BUILD_FLAGS = Object.freeze([
  '--auto',
  '--manual',
  '--deep',
  '--network',
  '--robots-plan',
  '--render-js',
  '--no-render-js',
  '--headless',
  '--no-headless',
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
  '--execute',
  '--allow-destructive-execution',
]);

export const COMPAT_BOOLEAN_BUILD_FLAGS = Object.freeze([
  '--cookie-stdin',
  '--login-enhanced',
  '--public-only',
  '--user-authorized-browser-live',
]);

export const ACCEPTED_BOOLEAN_BUILD_FLAGS = Object.freeze([
  ...PUBLIC_BOOLEAN_BUILD_FLAGS,
  ...COMPAT_BOOLEAN_BUILD_FLAGS,
]);

export const PUBLIC_ENUM_VALUE_BUILD_FLAGS = Object.freeze([
  ['--privacy', Object.freeze(['limited', 'strict'])],
  ['--report', Object.freeze(['user', 'debug', 'both'])],
  ['--progress', Object.freeze(['auto', 'interactive', 'plain'])],
]);

export const COMPAT_ENUM_VALUE_BUILD_FLAGS = Object.freeze([
  ['--auth', Object.freeze(['none', 'cookie', 'browser'])],
]);

export const ACCEPTED_ENUM_VALUE_BUILD_FLAGS = Object.freeze([
  ...PUBLIC_ENUM_VALUE_BUILD_FLAGS,
  ...COMPAT_ENUM_VALUE_BUILD_FLAGS,
]);

export const PUBLIC_STRING_VALUE_BUILD_FLAGS = Object.freeze([
  '--browser-path',
  '--timeout',
  '--max-depth',
  '--max-pages',
  '--max-seeds',
  '--max-sitemaps',
  '--task',
  '--confirm-risk',
  '--confirm-destructive',
]);

export const COMPAT_STRING_VALUE_BUILD_FLAGS = Object.freeze([
  '--cookie-env',
  '--cookie-file',
  '--auth-check-url',
]);

export const ACCEPTED_STRING_VALUE_BUILD_FLAGS = Object.freeze([
  ...PUBLIC_STRING_VALUE_BUILD_FLAGS,
  ...COMPAT_STRING_VALUE_BUILD_FLAGS,
]);

export const PUBLIC_BUILD_HELP_FLAGS = Object.freeze([
  ...PUBLIC_BOOLEAN_BUILD_FLAGS,
  '--privacy limited|strict',
  '--report user|debug|both',
  '--progress auto|interactive|plain',
  '--browser-path <path>',
  '--timeout <ms>',
  '--max-depth <n>',
  '--max-pages <n>',
  '--max-seeds <n>',
  '--max-sitemaps <n>',
  '--task <intent-or-capability>',
  '--confirm-risk <id>',
  '--confirm-destructive',
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
  --network              Keep network/API capture requested; raw traces are enabled by default.
  --render-js            Enable rendered-page discovery.
  --no-render-js         Disable rendered-page discovery.
  --headless             Run rendered-page browser discovery headlessly.
  --no-headless          Run rendered-page browser discovery in a visible browser.
  --robots-plan          On robots/setup block, print a machine-readable compliant remediation plan.
  --privacy limited|strict
  --browser-path <path>
  --timeout <ms>
  --max-depth <n>
  --max-pages <n>
  --max-seeds <n>
  --max-sitemaps <n>
  --task <intent-or-capability>  Generate a task plan and RuntimeInvocationRequest for a compiled capability.
  --execute             Request app/runtime governance decision for --task.
  --confirm-risk <id>   Confirm a high-risk governed execution contract or capability id.
  --allow-destructive-execution
  --confirm-destructive [id]
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

export function acceptedBooleanBuildFlagSet() {
  return new Set(ACCEPTED_BOOLEAN_BUILD_FLAGS);
}

export function publicValueBuildFlagMap() {
  return publicEnumValueBuildFlagMap();
}

export function acceptedValueBuildFlagMap() {
  return acceptedEnumValueBuildFlagMap();
}

export function publicEnumValueBuildFlagMap() {
  return new Map(PUBLIC_ENUM_VALUE_BUILD_FLAGS.map(([flag, values]) => [flag, [...values]]));
}

export function acceptedEnumValueBuildFlagMap() {
  return new Map(ACCEPTED_ENUM_VALUE_BUILD_FLAGS.map(([flag, values]) => [flag, [...values]]));
}

export function publicStringValueBuildFlagSet() {
  return new Set(PUBLIC_STRING_VALUE_BUILD_FLAGS);
}

export function acceptedStringValueBuildFlagSet() {
  return new Set(ACCEPTED_STRING_VALUE_BUILD_FLAGS);
}
