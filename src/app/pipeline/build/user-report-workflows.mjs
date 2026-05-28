// @ts-check

import { RUNTIME_MODES } from './runtime-provider.mjs';
import { ACCESS_REMEDIATION_PLAN_FILE } from './build-summary-paths.mjs';

export const ROUTE_CAPTURE_PLAN_FILE = 'route_capture_plan.json';

const BRIDGE_RUNTIME_MODE = RUNTIME_MODES.browserBridgeRequired;
const HTTP_RUNTIME_MODE = RUNTIME_MODES.genericHttpRead;

export function buildNextStepWorkflows({ resultStatus, report }) {
  const workflows = /** @type {any[]} */ ([]);
  const routeCapturePlanPath = report.artifacts?.[ROUTE_CAPTURE_PLAN_FILE] ? ROUTE_CAPTURE_PLAN_FILE : null;
  if (report.summary?.verificationStatus === 'bridge_runtime_passed') {
    workflows.push({
      id: 'browser-bridge-runtime',
      status: 'registered',
      purpose: 'Invoke captured read-only capabilities through the default-browser Bridge with fresh sanitized structure evidence.',
      promotionAllowed: true,
      updatesCurrent: true,
      updatesRegistry: true,
      runtimeMode: BRIDGE_RUNTIME_MODE,
      requiresFreshBridgeEvidence: true,
      genericHttpRuntimeAllowed: false,
    });
    workflows.push({
      id: 'generic-http-read-runtime',
      status: 'registered-when-eligible',
      purpose: 'Invoke eligible public read-only capabilities through same-site GET or route navigation without cookies or form submission.',
      promotionAllowed: true,
      updatesCurrent: true,
      updatesRegistry: true,
      runtimeMode: HTTP_RUNTIME_MODE,
      requiresFreshBridgeEvidence: false,
      genericHttpRuntimeAllowed: true,
    });
  }
  if (routeCapturePlanPath && Number(report.summary?.routeCapturePlan?.missingRouteCount ?? 0) > 0) {
    workflows.push({
      id: 'browser-bridge-route-retry',
      status: 'available-for-missing-routes',
      report: routeCapturePlanPath,
      purpose: 'Retry only the browser-bridge routes that were not captured; successful retries can update coverage without fabricating blocked routes.',
      promotionAllowed: false,
      updatesCurrent: false,
      updatesRegistry: false,
      runtimeMode: BRIDGE_RUNTIME_MODE,
      requiresFreshBridgeEvidence: true,
    });
  }
  const accessPlanPath = report.artifacts?.[ACCESS_REMEDIATION_PLAN_FILE] ? ACCESS_REMEDIATION_PLAN_FILE : null;
  if (accessPlanPath) {
    workflows.push(
      {
        id: 'access-remediation-plan',
        status: 'available',
        report: accessPlanPath,
        purpose: 'Use compliant alternatives after robots, challenge, or access-boundary blocks generic live crawling.',
        promotionAllowed: false,
        updatesCurrent: false,
        updatesRegistry: false,
      },
      {
        id: 'official-api-or-feed',
        status: 'requires-user-input',
        allowedEvidence: ['response_shape', 'schema_hash', 'rate_limit_policy', 'permission_scope'],
        promotionAllowed: false,
      },
      {
        id: 'manual-summary',
        status: 'requires-sanitized-structure-source',
        allowedEvidence: ['route_template', 'page_type', 'visible_item_count', 'control_type', 'structure_hash'],
        promotionAllowed: false,
      },
      {
        id: 'local-http-validation',
        status: 'available-for-tests-only',
        promotionAllowed: false,
        liveSupportClaimAllowed: false,
      },
    );
  }
  if (!workflows.length && resultStatus === 'failed') {
    workflows.push({
      id: 'rerun-after-blocker-fixed',
      status: 'available-after-input-change',
      promotionAllowed: false,
      updatesCurrent: false,
      updatesRegistry: false,
    });
  }
  return workflows;
}
