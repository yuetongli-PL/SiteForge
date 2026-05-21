// @ts-check

function stringList(values) {
  if (Array.isArray(values)) {
    return values.map((value) => String(value ?? '').trim()).filter(Boolean);
  }
  const value = String(values ?? '').trim();
  return value ? [value] : [];
}

function uniqueStrings(...lists) {
  return [...new Set(lists.flatMap(stringList))];
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) {
      return text;
    }
  }
  return null;
}

export function isBlockedAvailabilityStatus(value) {
  return /blocked|placeholder|unavailable|disabled/iu.test(String(value ?? ''));
}

export function isFixtureOnlyAvailabilityStatus(value) {
  return /fixture[-_ ]?only/iu.test(String(value ?? ''));
}

export function isDownloadIntent(intent) {
  return /^download(?:-|$)/iu.test(String(intent ?? ''))
    || /(?:^|-)archive$/iu.test(String(intent ?? ''));
}

export function isGenericLiveBuildBlocked(registry = {}, capabilities = {}) {
  return isBlockedAvailabilityStatus(registry.genericLiveBuild?.status)
    || isBlockedAvailabilityStatus(capabilities.genericLiveBuild?.status)
    || isBlockedAvailabilityStatus(registry.siteAccessStatus)
    || isBlockedAvailabilityStatus(capabilities.siteAccessStatus);
}

export function declaredDownloadTaskTypes(registry = {}, capabilities = {}) {
  return uniqueStrings(
    registry.declaredDownloadTaskTypes,
    registry.downloadTaskTypes,
    registry.downloadSupport?.taskTypes,
    registry.downloadSupport?.declaredTaskTypes,
    capabilities.downloader?.taskTypes,
    capabilities.downloader?.declaredTaskTypes,
  );
}

export function availableDownloadTaskTypes(registry = {}, capabilities = {}) {
  const registrySupport = registry.downloadSupport ?? {};
  const capabilitySupport = capabilities.downloader ?? {};
  const blocked = isBlockedAvailabilityStatus(registrySupport.status)
    || isBlockedAvailabilityStatus(capabilitySupport.status)
    || registrySupport.supported === false
    || capabilitySupport.supported === false
    || isGenericLiveBuildBlocked(registry, capabilities);
  const explicitAvailable = uniqueStrings(
    registry.availableDownloadTaskTypes,
    registrySupport.availableTaskTypes,
    capabilitySupport.availableTaskTypes,
  );
  if (blocked) {
    return [];
  }
  const supportedByRegistry = registrySupport.supported === true
    || ['implemented', 'available', 'supported'].includes(String(registrySupport.status ?? '').toLowerCase());
  const supportedByCapability = capabilitySupport.supported === true
    || ['implemented', 'available', 'supported'].includes(String(capabilitySupport.status ?? '').toLowerCase());
  return uniqueStrings(
    explicitAvailable,
    supportedByRegistry ? registrySupport.taskTypes : [],
    supportedByCapability ? capabilitySupport.taskTypes : [],
  );
}

export function blockedDownloadTaskTypes(registry = {}, capabilities = {}) {
  const declared = declaredDownloadTaskTypes(registry, capabilities);
  const explicitBlocked = uniqueStrings(
    registry.blockedDownloadTaskTypes,
    registry.downloadSupport?.blockedTaskTypes,
    capabilities.downloader?.blockedTaskTypes,
  );
  if (explicitBlocked.length) {
    return explicitBlocked;
  }
  const blocked = isBlockedAvailabilityStatus(registry.downloadSupport?.status)
    || isBlockedAvailabilityStatus(capabilities.downloader?.status)
    || registry.downloadSupport?.supported === false
    || capabilities.downloader?.supported === false
    || isGenericLiveBuildBlocked(registry, capabilities);
  return blocked ? declared : [];
}

export function downloadRuntimeDependencies(registry = {}, capabilities = {}) {
  return uniqueStrings(
    registry.interpreterRequired,
    registry.downloadSupport?.interpreterRequired,
    capabilities.downloader?.interpreterRequired,
    registry.downloadSupport?.ocrRequired === true ? (registry.downloadSupport?.ocrEngine ?? 'ocr') : [],
    capabilities.downloader?.ocrRequired === true ? (capabilities.downloader?.ocrEngine ?? 'ocr') : [],
  );
}

export function downloadDependencyReasonCodes(registry = {}, capabilities = {}) {
  const dependencies = downloadRuntimeDependencies(registry, capabilities);
  return uniqueStrings(
    dependencies.some((dependency) => /^pypy(?:3)?$/iu.test(dependency)) ? ['runtime-dependency-missing'] : [],
    dependencies.some((dependency) => /tesseract|ocr/iu.test(dependency)) ? ['ocr-dependency-missing'] : [],
  );
}

export function normalizeDownloadAvailability(registry = {}, capabilities = {}) {
  const declaredTaskTypes = declaredDownloadTaskTypes(registry, capabilities);
  const availableTaskTypes = availableDownloadTaskTypes(registry, capabilities);
  const blockedTaskTypes = blockedDownloadTaskTypes(registry, capabilities);
  const runtimeDependencies = downloadRuntimeDependencies(registry, capabilities);
  const dependencyReasonCodes = downloadDependencyReasonCodes(registry, capabilities);
  const fixtureOnly = isFixtureOnlyAvailabilityStatus(registry.downloadSupport?.status)
    || isFixtureOnlyAvailabilityStatus(capabilities.downloader?.status);
  const requiresAuth = registry.downloadSessionRequirement === 'required'
    || capabilities.downloader?.requiresLogin === true;
  const publicLiveBlocked = isGenericLiveBuildBlocked(registry, capabilities);
  const explicitlyUnsupported = registry.downloadSupport?.supported === false
    || capabilities.downloader?.supported === false;
  const blocked = blockedTaskTypes.length > 0
    || explicitlyUnsupported
    || isBlockedAvailabilityStatus(registry.downloadSupport?.status)
    || isBlockedAvailabilityStatus(capabilities.downloader?.status)
    || publicLiveBlocked;
  const available = availableTaskTypes.length > 0
    && !blocked
    && !fixtureOnly;
  const downloadReasonCode = firstText(
    registry.downloadSupport?.reasonCode,
    capabilities.downloader?.reasonCode,
    registry.downloadSupport?.unsupportedLiveReasonCode,
    capabilities.downloader?.unsupportedLiveReasonCode,
  );
  const genericLiveReasonCode = firstText(
    registry.genericLiveBuild?.reasonCode,
    capabilities.genericLiveBuild?.reasonCode,
  );
  const reasonCode = firstText(downloadReasonCode, genericLiveReasonCode);
  const downloadReason = firstText(
    registry.downloadSupport?.reason,
    capabilities.downloader?.reason,
    registry.downloadSupport?.unsupportedLiveReason,
    capabilities.downloader?.unsupportedLiveReason,
  );
  const genericLiveReason = firstText(
    registry.genericLiveBuild?.reason,
    capabilities.genericLiveBuild?.reason,
  );
  const reason = firstText(downloadReason, genericLiveReason);
  const supported = available && explicitlyUnsupported !== true;
  return Object.freeze({
    declared: declaredTaskTypes.length > 0,
    available,
    blocked,
    supported,
    fixtureOnly,
    requiresAuth,
    publicLiveBlocked,
    runtimeDependencies,
    dependencyReasonCodes,
    declaredTaskTypes,
    availableTaskTypes,
    blockedTaskTypes,
    downloadReasonCode,
    genericLiveReasonCode,
    reasonCode,
    downloadReason,
    genericLiveReason,
    reason,
    status: available
      ? 'available'
      : blocked
        ? 'blocked'
        : fixtureOnly
          ? 'fixtureOnly'
          : declaredTaskTypes.length
            ? 'declared'
            : 'unavailable',
  });
}

export function canExposeDownloadCapability(availability) {
  return availability?.supported === true
    && availability?.available === true
    && Array.isArray(availability.availableTaskTypes)
    && availability.availableTaskTypes.length > 0;
}
