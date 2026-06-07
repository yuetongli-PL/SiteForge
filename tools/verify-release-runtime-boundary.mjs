// @ts-check

export async function assertProductionProtectedProvidersAbsent() {
  const {
    createProductionRuntimeProviderRegistry,
  } = await import('../src/app/runtime/index.mjs');
  const registry = createProductionRuntimeProviderRegistry();
  const paymentProvider = registry.resolve({
    invocationRequest: { capabilityId: 'capability:release-gate:payment' },
    capability: {
      kind: 'payment',
      paymentOrFundsAction: true,
    },
    executionContract: {
      paymentOrFundsAction: true,
    },
  });
  const destructiveProvider = registry.resolve({
    invocationRequest: { capabilityId: 'capability:release-gate:destructive' },
    capability: {
      kind: 'destructive',
      destructiveAction: true,
    },
    executionContract: {
      destructiveAction: true,
    },
  });
  if (paymentProvider || destructiveProvider) {
    const error = new Error('Production provider registry exposes protected executable provider');
    // @ts-ignore
    error.code = 'release_gate.protected_provider_registered';
    // @ts-ignore
    error.details = {
      paymentProviderId: paymentProvider?.id ?? null,
      destructiveProviderId: destructiveProvider?.id ?? null,
    };
    throw error;
  }
  return true;
}
