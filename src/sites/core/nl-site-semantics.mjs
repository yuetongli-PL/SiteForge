import { resolveCanonicalSiteKey } from './site-identity.mjs';
import { createDouyinNlSemantics } from '../douyin/nl/semantics.mjs';
import { createJableNlSemantics } from '../jable/nl/semantics.mjs';
import { createMoodyzNlSemantics } from '../moodyz/nl/semantics.mjs';

export function resolveSiteNlSemantics({ baseUrl = '', siteProfileDocument = null, deps = {} } = {}) {
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
    default:
      return null;
  }
}
