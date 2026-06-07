// @ts-check

import {
  assertNoPaymentAuthorizationRawMaterial,
} from './payment-requirement-validator.mjs';

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function providerList(source = {}) {
  if (Array.isArray(source)) return source;
  if (typeof source.list === 'function') return source.list();
  if (Array.isArray(source.providers)) return source.providers;
  return [];
}

function providerLooksPayment(provider = {}) {
  const text = [
    provider.id,
    provider.providerId,
    provider.providerKind,
    ...(Array.isArray(provider.capabilityKinds) ? provider.capabilityKinds : []),
    ...(Array.isArray(provider.manifest?.capabilityKinds) ? provider.manifest.capabilityKinds : []),
  ].map(normalize).join(' ');
  return /\bpayment\b|\bpay\b|\bbilling\b|\bcheckout\b|payment_provider/iu.test(text);
}

export function assertProductionPaymentProviderProhibited(source = {}) {
  const providers = providerList(source);
  const paymentProviders = providers.filter(providerLooksPayment);
  if (paymentProviders.length > 0) {
    const error = new Error('Production payment provider registration is prohibited');
    // @ts-ignore
    error.code = 'payment_authorization.production_payment_provider_registered';
    // @ts-ignore
    error.details = paymentProviders.map((provider) => provider.id ?? provider.providerId ?? 'unknown');
    throw error;
  }
  const result = {
    prohibitionType: 'payment_provider_prohibition',
    paymentProviderRegistered: false,
    paymentProviderProhibited: true,
    productionProviderRegistrationAllowed: false,
    providerIds: providers.map((provider) => normalize(provider.id ?? provider.providerId)).filter(Boolean).sort(),
    providerInvoked: false,
    sideEffectAttempted: false,
    redactionRequired: true,
  };
  assertNoPaymentAuthorizationRawMaterial(result);
  return result;
}
