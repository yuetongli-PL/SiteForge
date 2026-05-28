import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTE_CAPTURE_PLAN_FILE,
  buildNextStepWorkflows,
} from '../../src/app/pipeline/build/user-report-workflows.mjs';
import { ACCESS_REMEDIATION_PLAN_FILE } from '../../src/app/pipeline/build/build-summary-paths.mjs';
import { RUNTIME_MODES } from '../../src/app/pipeline/build/runtime-provider.mjs';

test('user report workflows describe registered runtime routes and retry plans', () => {
  const workflows = buildNextStepWorkflows({
    resultStatus: 'partial_success',
    report: {
      summary: {
        verificationStatus: 'bridge_runtime_passed',
        routeCapturePlan: { missingRouteCount: 2 },
      },
      artifacts: {
        [ROUTE_CAPTURE_PLAN_FILE]: 'reports/route_capture_plan.json',
      },
    },
  });

  assert.deepEqual(workflows.map((workflow) => workflow.id), [
    'browser-bridge-runtime',
    'generic-http-read-runtime',
    'browser-bridge-route-retry',
  ]);
  assert.equal(workflows[0].runtimeMode, RUNTIME_MODES.browserBridgeRequired);
  assert.equal(workflows[1].runtimeMode, RUNTIME_MODES.genericHttpRead);
  assert.equal(workflows[2].report, ROUTE_CAPTURE_PLAN_FILE);
  assert.equal(workflows[2].requiresFreshBridgeEvidence, true);
});

test('user report workflows include access remediation alternatives', () => {
  const workflows = buildNextStepWorkflows({
    resultStatus: 'failed',
    report: {
      summary: {},
      artifacts: {
        [ACCESS_REMEDIATION_PLAN_FILE]: 'reports/access_remediation_plan.json',
      },
    },
  });

  assert.deepEqual(workflows.map((workflow) => workflow.id), [
    'access-remediation-plan',
    'official-api-or-feed',
    'manual-summary',
    'local-http-validation',
  ]);
  assert.equal(workflows[0].report, ACCESS_REMEDIATION_PLAN_FILE);
  assert.equal(workflows.every((workflow) => workflow.promotionAllowed === false), true);
});

test('user report workflows provide a failed-build fallback', () => {
  assert.deepEqual(buildNextStepWorkflows({
    resultStatus: 'failed',
    report: { summary: {}, artifacts: {} },
  }), [{
    id: 'rerun-after-blocker-fixed',
    status: 'available-after-input-change',
    promotionAllowed: false,
    updatesCurrent: false,
    updatesRegistry: false,
  }]);
});
