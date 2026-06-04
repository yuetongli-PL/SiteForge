// @ts-check

import { uniqueSortedStrings } from '../../../shared/normalize.mjs';
import { resolveSiteAdapter } from '../../../sites/adapters/resolver.mjs';

function adapterHostsForSite(site = /** @type {any} */ ({}), inputUrl = '') {
  let host = '';
  try {
    host = new URL(site.rootUrl ?? inputUrl).hostname;
  } catch {
    host = '';
  }
  const adapter = resolveSiteAdapter({ host, inputUrl });
  return Array.isArray(adapter?.hosts) ? adapter.hosts : [];
}

export function siteRecordWithKnownAdapterAllowedDomains(site = /** @type {any} */ ({}), inputUrl = '') {
  const allowedDomains = uniqueSortedStrings([
    ...(Array.isArray(site.allowedDomains) ? site.allowedDomains : []),
    ...adapterHostsForSite(site, inputUrl),
  ]);
  return {
    ...site,
    allowedDomains,
  };
}
