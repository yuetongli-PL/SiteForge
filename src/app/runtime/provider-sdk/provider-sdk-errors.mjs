// @ts-check

export class ProviderSdkValidationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderSdkValidationError';
    this.code = options.code ?? 'provider.sdk.validation_failed';
    this.details = options.details ?? {};
  }
}

export function createProviderSdkFinding(reasonCode, message, details = {}) {
  return {
    reasonCode,
    message,
    details,
  };
}

