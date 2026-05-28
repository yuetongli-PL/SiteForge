import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCapabilityCard,
  buildCapabilityStateModel,
  capabilityCounts,
  capabilityUserSortRank,
  executionPlanCard,
  isHighRiskOrAccountDisabled,
  safeExecutionPlanRoute,
  sortCapabilitiesForUser,
} from '../../src/app/pipeline/build/capability-state-report.mjs';

test('capability state report cards summarize execution plans safely', () => {
  assert.equal(safeExecutionPlanRoute('https://example.test/private?token=SECRET'), '/private');
  assert.equal(safeExecutionPlanRoute('/search?q=SECRET'), '/search');
  assert.equal(safeExecutionPlanRoute('javascript:alert(1)'), null);

  assert.deepEqual(executionPlanCard({
    id: 'plan-1',
    mode: 'read',
    dryRunOnly: true,
    steps: [
      { kind: 'fetch page', url: 'https://example.test/private?token=SECRET' },
      { type: 'summarize-results', requiresUserApproval: true },
    ],
  }), {
    execution_plan_id: 'plan-1',
    execution_plan_mode: 'read',
    execution_plan_dry_run_only: true,
    execution_plan_requires_confirmation: false,
    execution_plan_auto_execute: false,
    execution_plan_requires_user_approval: true,
    execution_plan_step_kinds: ['fetch_page', 'summarize-results'],
    execution_plan_step_count: 2,
    route_template: '/private',
  });
});

test('capability state report model groups user-visible capability cards', () => {
  const limited = buildCapabilityCard({
    id: 'read-private',
    name: 'read private timeline',
    risk_level: 'read_personal_medium',
    enabled_status: 'limited_enabled',
    status: 'active',
    action: 'view',
  });
  assert.equal(limited.report_group, 'limited_enabled');
  assert.equal(limited.strategy, 'Return only limited sanitized summaries.');

  const disabled = buildCapabilityCard({
    id: 'publish-post',
    name: 'publish post',
    risk_level: 'write_high',
    enabled_status: 'disabled',
    status: 'active',
    action: 'submit',
  });
  assert.equal(disabled.report_group, 'disabled');
  assert.equal(isHighRiskOrAccountDisabled(disabled), true);

  const model = buildCapabilityStateModel([
    { id: 'home', name: 'view homepage', enabled_status: 'enabled', status: 'active' },
    { id: 'read-private', name: 'read private timeline', risk_level: 'read_personal_medium', enabled_status: 'limited_enabled', status: 'active' },
    { id: 'publish-post', name: 'publish post', risk_level: 'write_high', enabled_status: 'disabled', status: 'active', action: 'submit' },
  ]);

  assert.equal(model.groups.enabled.length, 1);
  assert.equal(model.groups.limited_enabled.length, 1);
  assert.equal(model.groups.disabled.length, 1);
  assert.equal(model.enablement_status_counts.enabled, 1);
  assert.equal(model.enablement_status_counts.limited_enabled, 1);
  assert.equal(model.enablement_status_counts.disabled, 1);
});

test('capability state report counts statuses, embedded intents, and risk policy summary', () => {
  const counts = capabilityCounts([
    { id: 'active-read', status: 'active', enabled_status: 'enabled', risk_level: 'read_public_low', intents: [{}, {}] },
    { id: 'candidate-read', status: 'candidate', enabled_status: 'candidate', risk_level: 'read_public_low' },
    { id: 'discarded-read', status: 'discarded', enabled_status: 'disabled', risk_level: 'read_public_low' },
    { id: 'disabled-write', status: 'disabled', enabled_status: 'disabled', risk_level: 'write_high' },
  ]);

  assert.equal(counts.active, 1);
  assert.equal(counts.candidate, 1);
  assert.equal(counts.discarded, 1);
  assert.equal(counts.disabled, 1);
  assert.equal(counts.total, 4);
  assert.equal(counts.embeddedIntents, 2);
  assert.equal(counts.enabledStatus.enabled, 1);
  assert.equal(counts.countedTotal, 2);
  assert.equal(counts.riskPolicy.read_public_low, 3);
  assert.equal(counts.riskPolicy.write_high, 1);
});

test('capability state report sorting ranks user-facing capabilities by workflow priority', () => {
  assert.equal(capabilityUserSortRank({ name: 'view home page' }), 10);
  assert.equal(capabilityUserSortRank({ name: 'search products' }), 20);
  assert.equal(capabilityUserSortRank({ name: 'account security settings', risk_level: 'account_security_critical' }), 80);

  assert.deepEqual(sortCapabilitiesForUser([
    { id: 'delete', name: 'delete post', risk_level: 'write_high' },
    { id: 'draft', name: 'compose post draft', default_policy: 'draft_only' },
    { id: 'profile', name: 'read creator profile' },
    { id: 'search', name: 'search products' },
    { id: 'home', name: 'view homepage' },
  ]).map((capability) => capability.id), [
    'home',
    'search',
    'profile',
    'draft',
    'delete',
  ]);
});
