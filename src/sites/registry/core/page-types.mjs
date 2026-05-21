// @ts-check

import {
  CONTENT_DETAIL_PAGE_TYPES,
  inferPageTypeFromUrlCore,
  inferProfilePageTypeFromPathnameCore,
  isContentDetailPageType,
  resolveConfiguredPageTypes,
  toSemanticPageType,
} from '../../../shared/page-state-runtime.mjs';
import { resolveSiteAdapter } from '../../adapters/resolver.mjs';

function inferAdapterPageTypeFromUrl({
  inputUrl = '',
  parsedUrl = null,
  pathname = '/',
  hostname = '',
  siteProfile = null,
} = /** @type {any} */ ({})) {
  const adapter = resolveSiteAdapter({
    host: hostname || parsedUrl?.hostname,
    inputUrl: inputUrl || parsedUrl?.toString?.() || '',
    profile: siteProfile,
  });
  const pageType = adapter?.inferPageType?.({
    inputUrl: inputUrl || parsedUrl?.toString?.() || '',
    parsedUrl,
    pathname: pathname || parsedUrl?.pathname || '/',
    hostname: hostname || parsedUrl?.hostname || '',
    siteProfile,
  });
  if (!pageType) {
    return null;
  }
  return pageType === 'content-detail-page' ? 'book-detail-page' : pageType;
}

export {
  CONTENT_DETAIL_PAGE_TYPES,
  isContentDetailPageType,
  resolveConfiguredPageTypes,
  toSemanticPageType,
};

export function inferProfilePageTypeFromPathname(pathname, siteProfile = null) {
  return inferProfilePageTypeFromPathnameCore(pathname, siteProfile);
}

export function inferPageTypeFromUrl(input, siteProfile = null) {
  return inferPageTypeFromUrlCore(input, siteProfile, {
    inferSiteSpecificPageType(context = /** @type {any} */ ({})) {
      return inferAdapterPageTypeFromUrl({
        ...context,
        siteProfile,
      });
    },
  });
}
