// @ts-check

export class ProviderSandboxError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, details?: any }} [options]
   */
  constructor(message, options = {}) {
    const { code = 'provider_sandbox.error', details } = options;
    super(message);
    this.name = 'ProviderSandboxError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
