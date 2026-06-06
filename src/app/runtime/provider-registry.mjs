// @ts-check

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeKind(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function inferKindFromText(value) {
  const text = normalizeKind(value);
  if (!text) return '';
  if (/\bexport\b|export/iu.test(text)) return 'download';
  if (/\bapi\b|api/iu.test(text)) return 'read';
  if (/\bdownload\b|download/iu.test(text)) return 'download';
  if (/\bpay\b|pay|\bpayment\b|payment|\bpurchase\b|purchase|\bbilling\b|billing/iu.test(text)) return 'payment';
  if (/\bdelete\b|delete|\bdestroy\b|destroy|\bclear\b|clear|\breset\b|reset|\bcancel\b|cancel|\brevoke\b|revoke/iu.test(text)) return 'destructive';
  if (/\bwrite\b|write|\bsubmit\b|submit|\bupdate\b|update|\bcreate\b|create|\bpost\b|post/iu.test(text)) return 'write';
  if (/\bread\b|read|\bquery\b|query|\bsearch\b|search|\bfetch\b|fetch|\bview\b|view/iu.test(text)) return 'read';
  return '';
}

export function inferRuntimeCapabilityKind({
  invocationRequest = null,
  executionContract = null,
  capability = null,
  runtimeContext = null,
} = {}) {
  const candidates = [
    runtimeContext?.capabilityKind,
    runtimeContext?.operationKind,
    executionContract?.capabilityKind,
    executionContract?.operationKind,
    executionContract?.contractKind,
    capability?.capabilityKind,
    capability?.kind,
    capability?.operationKind,
    invocationRequest?.capabilityKind,
    invocationRequest?.capabilityId,
  ];
  for (const candidate of candidates) {
    const direct = normalizeKind(candidate);
    if (['api', 'read', 'query', 'search', 'download', 'export', 'write', 'submit', 'payment', 'destructive'].includes(direct)) {
      if (direct === 'api') return 'read';
      if (direct === 'export') return 'download';
      return direct;
    }
    const inferred = inferKindFromText(candidate);
    if (inferred) return inferred;
  }
  return 'generic';
}

function requestedProviderId({
  invocationRequest = null,
  executionContract = null,
  capability = null,
  runtimeContext = null,
} = {}) {
  for (const value of [
    runtimeContext?.providerId,
    runtimeContext?.runtimeProviderId,
    executionContract?.providerId,
    executionContract?.runtimeProviderId,
    executionContract?.runtimeBinding?.providerId,
    capability?.providerId,
    capability?.runtimeProviderId,
  ]) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return '';
}

function validateProvider(provider) {
  if (!isPlainObject(provider)) {
    throw new TypeError('Runtime provider must be a plain object');
  }
  if (!normalizeText(provider.id)) {
    throw new TypeError('Runtime provider id is required');
  }
  if (typeof provider.run !== 'function') {
    throw new TypeError(`Runtime provider ${provider.id} must expose run()`);
  }
  return true;
}

function providerSupports(provider, descriptor) {
  if (typeof provider.supports === 'function') {
    return provider.supports(descriptor) === true;
  }
  const kind = normalizeKind(descriptor.capabilityKind);
  const supportedKinds = new Set(asArray(provider.capabilityKinds).map(normalizeKind));
  return supportedKinds.has(kind);
}

export function createRuntimeProviderRegistry(providers = []) {
  const entries = new Map();
  return {
    register(provider) {
      validateProvider(provider);
      entries.set(normalizeText(provider.id), provider);
      return provider;
    },
    get(providerId) {
      return entries.get(normalizeText(providerId)) ?? null;
    },
    list() {
      return [...entries.values()];
    },
    resolve(descriptor = {}) {
      const providerId = requestedProviderId(descriptor);
      if (providerId) {
        return entries.get(providerId) ?? null;
      }
      const capabilityKind = inferRuntimeCapabilityKind(descriptor);
      return [...entries.values()].find((provider) => providerSupports(provider, {
        ...descriptor,
        capabilityKind,
      })) ?? null;
    },
  };
}

export function createRuntimeProviderRegistryWith(providers = []) {
  const registry = createRuntimeProviderRegistry();
  for (const provider of providers) {
    registry.register(provider);
  }
  return registry;
}
