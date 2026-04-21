export function ensureCaptureSucceeded(manifest) {
  if (manifest?.status !== 'success') {
    const errorCode = manifest?.error?.code ? `${manifest.error.code}: ` : '';
    const errorMessage = manifest?.error?.message ?? `Capture returned status ${manifest?.status ?? 'unknown'}`;
    throw new Error(`${errorCode}${errorMessage}`);
  }
}

export const DEFAULT_STAGE_VALIDATORS = {
  captureSucceeded: ensureCaptureSucceeded,
};
