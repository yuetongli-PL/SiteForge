// @ts-check

export const EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION = 'route-queue-x-api-runtime-v8';
export const COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS = Object.freeze([
  EXPECTED_BROWSER_BRIDGE_EXTENSION_VERSION,
  'route-queue-chinese-semantic-v7',
  'route-queue-chinese-semantic-v6',
]);

const ROUTE_CAPTURED_STATUSES = new Set(['captured', 'captured_with_warning']);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function routeResultCaptured(result) {
  const status = String(result?.status ?? '').trim();
  return ROUTE_CAPTURED_STATUSES.has(status) && result?.captured !== false;
}

function bridgeExtensionVersionSignals(extensionStages = []) {
  const stages = Array.isArray(extensionStages) ? extensionStages : [];
  const contentVersions = stages
    .map((stage) => /^bridge-content-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const backgroundVersions = stages
    .map((stage) => /^bridge-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const collectorVersionsByRouteId = new Map();
  for (const stage of stages) {
    const match = /^collector-version:([^:]+):(.+)$/u.exec(String(stage ?? '').trim());
    if (!match) {
      continue;
    }
    const routeId = String(match[1] ?? '').trim();
    const version = String(match[2] ?? '').trim();
    if (!routeId || !version) {
      continue;
    }
    collectorVersionsByRouteId.set(routeId, uniqueStrings([
      ...(collectorVersionsByRouteId.get(routeId) ?? []),
      version,
    ]));
  }
  const collectorVersions = stages
    .map((stage) => /^collector-version:(.+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  return {
    contentVersions: uniqueStrings(contentVersions),
    backgroundVersions: uniqueStrings(backgroundVersions),
    collectorVersions: uniqueStrings(collectorVersions),
    collectorVersionsByRouteId,
  };
}

function collectorVersionMatchesExpectedVersion(routeResult = /** @type {any} */ ({}), collectorVersionsByRouteId = new Map(), expectedVersion = '') {
  const routeId = String(routeResult?.routeId ?? '').trim();
  const payloadVersion = String(routeResult?.collectorVersion ?? '').trim();
  if (payloadVersion === expectedVersion) {
    return true;
  }
  return routeId
    ? (collectorVersionsByRouteId.get(routeId) ?? []).includes(expectedVersion)
    : false;
}

export function bridgeVersionCompatible(value) {
  return COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS.includes(String(value ?? '').trim());
}

export function bridgeExtensionVersionBlockingSignals(extensionStages = [], routeResults = []) {
  const stages = uniqueStrings(extensionStages);
  if (!stages.length || !stages.some((stage) => /^bridge(?:-content)?-version:/u.test(stage))) {
    return [];
  }
  const { contentVersions, backgroundVersions, collectorVersionsByRouteId } = bridgeExtensionVersionSignals(stages);
  const submittedRouteIds = stages
    .map((stage) => /^collector-submit-ok:([^:]+)$/u.exec(String(stage ?? '').trim())?.[1])
    .filter(Boolean);
  const capturedRouteResults = (Array.isArray(routeResults) ? routeResults : [])
    .filter((result) => routeResultCaptured(result) && result?.routeId);
  const routeIdsRequiringCollectorVersion = uniqueStrings([
    ...submittedRouteIds,
    ...capturedRouteResults.map((result) => result.routeId),
  ]);
  for (const version of COMPATIBLE_BROWSER_BRIDGE_EXTENSION_VERSIONS) {
    if (
      contentVersions.includes(version)
      && backgroundVersions.includes(version)
      && routeIdsRequiringCollectorVersion.every((routeId) => collectorVersionMatchesExpectedVersion(
        (Array.isArray(routeResults) ? routeResults : []).find((result) => result?.routeId === routeId) ?? { routeId },
        collectorVersionsByRouteId,
        version,
      ))
    ) {
      return [];
    }
  }
  return ['browser-bridge-extension-stale-or-incompatible'];
}
