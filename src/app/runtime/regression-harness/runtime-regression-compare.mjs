// @ts-check

import {
  compareRuntimeAuditViews,
} from '../audit-query/index.mjs';
import {
  diffCapabilityGraphs,
} from '../../../domain/capabilities/graph-registry/index.mjs';
import {
  diffCapabilityPackages,
} from '../../../domain/capability-packages/index.mjs';
import {
  RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION,
} from './runtime-regression-schema.mjs';
import {
  assertNoRuntimeRegressionRawMaterial,
  sanitizeRuntimeRegressionSnapshot,
} from './runtime-regression-sanitizer.mjs';
import {
  classifyRuntimeRegressionSeverity,
  maxRuntimeRegressionSeverity,
} from './runtime-regression-severity.mjs';

function arraysEqual(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function added(previous = [], next = []) {
  const previousSet = new Set(previous);
  return next.filter((value) => !previousSet.has(value));
}

function addChange(changes, kind, path, before, after, summary, severity = undefined) {
  const change = {
    kind,
    path,
    before: before ?? null,
    after: after ?? null,
    severity: severity ?? classifyRuntimeRegressionSeverity({ kind }),
    summary,
  };
  changes.push(change);
}

function protectedReason(value = '') {
  return /payment|destructive/iu.test(String(value));
}

function isDestructiveLabSnapshot(snapshot = {}) {
  return snapshot.runtime?.providerId === 'testing_destructive_lab_provider'
    && /(?:^|[\s:_-])lab(?:$|[\s:_-])|destructive-lab/iu.test(String(snapshot.metadata?.label ?? ''));
}

function compareRuntime(changes, previous, next) {
  const before = previous.runtime;
  const after = next.runtime;
  if (before.sideEffectAttempted === false && after.sideEffectAttempted === true) {
    addChange(changes, 'side_effect_introduced', 'runtime.sideEffectAttempted', false, true, 'Side effect was introduced.');
  }
  if (before.status === 'blocked' && after.status === 'completed') {
    addChange(changes, 'blocked_to_completed', 'runtime.status', before.status, after.status, 'Blocked runtime outcome changed to completed.');
  }
  if (before.paymentBlocked === true && before.providerInvoked === false && after.providerInvoked === true) {
    addChange(changes, 'payment_provider_invoked', 'runtime.providerInvoked', false, true, 'Payment-blocked case invoked a provider.');
  }
  if (
    before.destructiveBlocked === true
    && before.providerInvoked === false
    && after.providerInvoked === true
    && isDestructiveLabSnapshot(next) !== true
  ) {
    addChange(changes, 'destructive_provider_invoked', 'runtime.providerInvoked', false, true, 'Destructive-blocked case invoked a provider.');
  }
  if (before.providerId && after.providerId && before.providerId !== after.providerId) {
    addChange(changes, 'provider_changed', 'runtime.providerId', before.providerId, after.providerId, 'Provider selection changed.');
  }
  if (before.reasonCode && after.reasonCode && before.reasonCode !== after.reasonCode) {
    addChange(
      changes,
      protectedReason(before.reasonCode) || protectedReason(after.reasonCode)
        ? 'protected_reason_changed'
        : 'reason_changed',
      'runtime.reasonCode',
      before.reasonCode,
      after.reasonCode,
      'Stable runtime reason changed.',
    );
  }
  if (before.executionContractConcrete === true && after.executionContractConcrete === false) {
    addChange(changes, 'contract_concreteness_decreased', 'runtime.executionContractConcrete', true, false, 'Execution contract changed from concrete to not concrete.');
  }
}

function compareAuth(changes, previous, next) {
  if (previous.auth.required === true && next.auth.required === false) {
    addChange(changes, 'auth_requirement_removed', 'auth.required', true, false, 'Auth requirement was removed.');
  }
  const addedScopes = added(previous.auth.scopes, next.auth.scopes);
  if (addedScopes.length > 0) {
    addChange(changes, 'auth_scope_widened', 'auth.scopes', previous.auth.scopes, next.auth.scopes, 'Auth scopes widened.');
  }
  const addedMaterial = added(previous.auth.materialTypes, next.auth.materialTypes);
  if (addedMaterial.length > 0) {
    addChange(changes, 'material_type_widened', 'auth.materialTypes', previous.auth.materialTypes, next.auth.materialTypes, 'Allowed material types widened.');
  }
}

function compareBrowser(changes, previous, next) {
  if (previous.browserGuard.present === true && next.browserGuard.present === false) {
    addChange(changes, 'browser_guard_removed', 'browserGuard.present', true, false, 'Browser guard disappeared.');
  }
  const addedOrigins = added(previous.browserGuard.allowedOrigins, next.browserGuard.allowedOrigins);
  if (addedOrigins.length > 0 || next.browserGuard.allowedOrigins.includes('*')) {
    addChange(changes, 'allowed_origins_widened', 'browserGuard.allowedOrigins', previous.browserGuard.allowedOrigins, next.browserGuard.allowedOrigins, 'Allowed origins widened.');
  }
}

function comparePolicy(changes, previous, next) {
  const beforeDenied = previous.policy.verdict === 'blocked' || previous.policy.allowed === false;
  const afterAllowed = next.policy.verdict === 'allow' || next.policy.allowed === true;
  if (beforeDenied && afterAllowed) {
    addChange(changes, 'policy_denied_to_allowed', 'policy.verdict', previous.policy.verdict || previous.policy.allowed, next.policy.verdict || next.policy.allowed, 'Policy changed from deny/block to allow.');
  }
}

function compareMetadata(changes, previous, next) {
  if (previous.metadata.label && next.metadata.label && previous.metadata.label !== next.metadata.label) {
    addChange(changes, 'metadata_changed', 'metadata.label', previous.metadata.label, next.metadata.label, 'Safe metadata label changed.', 'low');
  }
}

function appendAuditCompare(changes, previous, next) {
  if (!previous.auditView || !next.auditView) return;
  const auditComparison = compareRuntimeAuditViews(previous.auditView, next.auditView);
  for (const change of auditComparison.changes ?? []) {
    addChange(
      changes,
      `audit_${String(change.path).replace(/[^a-z0-9]+/giu, '_')}`,
      `auditView.${change.path}`,
      change.before,
      change.after,
      change.summary,
      change.severity,
    );
  }
}

function appendGraphDiff(changes, previous, next) {
  if (!previous.capabilityGraph || !next.capabilityGraph) return;
  const diff = diffCapabilityGraphs(previous.capabilityGraph, next.capabilityGraph);
  for (const change of diff.changes ?? []) {
    if (!['high', 'critical'].includes(change.severity)) continue;
    addChange(
      changes,
      `graph_${change.reasonCode}`,
      `capabilityGraph.${change.field}`,
      change.before,
      change.after,
      change.message,
      change.severity,
    );
  }
}

function appendPackageDiff(changes, previous, next) {
  if (!previous.capabilityPackage || !next.capabilityPackage) return;
  const diff = diffCapabilityPackages(previous.capabilityPackage, next.capabilityPackage);
  for (const change of diff.changes ?? []) {
    if (!['high', 'critical'].includes(change.severity)) continue;
    addChange(
      changes,
      `package_${change.kind}`,
      `capabilityPackage.${change.kind}`,
      null,
      change.details ?? null,
      `Capability package ${change.kind}.`,
      change.severity,
    );
  }
}

export function compareRuntimeRegressionSnapshots(previousSnapshot = {}, nextSnapshot = {}) {
  const previous = sanitizeRuntimeRegressionSnapshot(previousSnapshot);
  const next = sanitizeRuntimeRegressionSnapshot(nextSnapshot);
  const changes = [];
  compareRuntime(changes, previous, next);
  compareAuth(changes, previous, next);
  compareBrowser(changes, previous, next);
  comparePolicy(changes, previous, next);
  compareMetadata(changes, previous, next);
  appendAuditCompare(changes, previous, next);
  appendGraphDiff(changes, previous, next);
  appendPackageDiff(changes, previous, next);

  const unique = [];
  const seen = new Set();
  for (const change of changes) {
    const key = `${change.kind}:${change.path}:${JSON.stringify(change.before)}:${JSON.stringify(change.after)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(change);
  }
  const maxSeverity = maxRuntimeRegressionSeverity(unique.map((change) => change.severity));
  const comparison = {
    schemaVersion: RUNTIME_CI_REGRESSION_HARNESS_SCHEMA_VERSION,
    comparisonType: 'runtime_ci_regression_comparison',
    status: unique.length > 0 ? 'changed' : 'same',
    previousSnapshotId: previous.snapshotId,
    nextSnapshotId: next.snapshotId,
    changeCount: unique.length,
    maxSeverity,
    highRiskChangeCount: unique.filter((change) => ['high', 'critical'].includes(change.severity)).length,
    changes: unique.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
    providerInvoked: false,
    browserInvoked: false,
    vaultAccessed: false,
    networkInvoked: false,
    redactionRequired: true,
  };
  assertNoRuntimeRegressionRawMaterial(comparison);
  return comparison;
}

export function runtimeRegressionSnapshotsEqual(previousSnapshot = {}, nextSnapshot = {}) {
  const comparison = compareRuntimeRegressionSnapshots(previousSnapshot, nextSnapshot);
  return comparison.status === 'same' && arraysEqual(
    comparison.changes.map((change) => change.path),
    [],
  );
}
