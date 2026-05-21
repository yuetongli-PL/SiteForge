// @ts-check

export const SOCIAL_OPERATOR_SCRIPT_STATUS = Object.freeze({
  'scripts/social-auth-recover.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'auth recovery orchestration',
  }),
  'scripts/social-command-templates.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'operator command template rendering',
  }),
  'scripts/social-health-watch.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'session health and keepalive planning',
  }),
  'scripts/social-kb-refresh.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'scenario knowledge-base refresh planning',
  }),
  'scripts/social-live-dashboard.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'local report dashboard generation',
  }),
  'scripts/social-live-report.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'social live manifest aggregation',
  }),
  'scripts/social-live-resume.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'bounded resume planning',
  }),
  'scripts/social-live-verify.mjs': Object.freeze({
    status: 'active-tested',
    visibility: 'internal-operator-only',
    scope: 'bounded live smoke matrix',
    downloadBoundary: 'blocked-report-only',
  }),
});
