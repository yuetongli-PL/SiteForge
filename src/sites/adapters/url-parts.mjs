// @ts-check

export function parseUrl(input) {
  try {
    return input ? new URL(input) : null;
  } catch {
    return null;
  }
}

export function endpointParts(candidate = /** @type {any} */ ({})) {
  const parsed = parseUrl(candidate?.endpoint?.url);
  return {
    host: parsed?.hostname.toLowerCase() ?? '',
    pathname: parsed?.pathname ?? '',
  };
}
