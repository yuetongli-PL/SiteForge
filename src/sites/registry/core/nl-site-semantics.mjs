import { resolveCanonicalSiteKey } from './site-identity.mjs';
import { createDouyinNlSemantics } from '../../known-sites/douyin/nl/semantics.mjs';
import { createJableNlSemantics } from '../../known-sites/jable/nl/semantics.mjs';
import { createMoodyzNlSemantics } from '../../known-sites/moodyz/nl/semantics.mjs';
import { createXiaohongshuNlSemantics } from '../../known-sites/xiaohongshu/nl/semantics.mjs';

export function resolveSiteNlSemantics({ baseUrl = '', siteProfileDocument = null, deps = /** @type {any} */ ({}) } = /** @type {any} */ ({})) {
  const siteKey = resolveCanonicalSiteKey({
    baseUrl,
    inputUrl: baseUrl,
    siteProfileDocument,
  });
  switch (siteKey) {
    case 'douyin':
      return createDouyinNlSemantics(deps);
    case 'moodyz':
      return createMoodyzNlSemantics(deps);
    case 'jable':
      return createJableNlSemantics(deps);
    case 'xiaohongshu':
      return createXiaohongshuNlSemantics(deps);
    default:
      return null;
  }
}
