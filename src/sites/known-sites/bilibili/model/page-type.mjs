// @ts-check

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase();
}

export function isBilibiliSearchHost(hostname) {
  return normalizeHostname(hostname) === 'search.bilibili.com';
}

export function isBilibiliSpaceHost(hostname) {
  return normalizeHostname(hostname) === 'space.bilibili.com';
}

export function inferBilibiliPageTypeFromUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    const pathname = parsed.pathname || '/';

    if (isBilibiliSearchHost(parsed.hostname) && /^\/(?:all|video|bangumi|upuser)(?:\/|$)/iu.test(pathname)) {
      return 'search-results-page';
    }
    if (/^\/video\/[^/]+(?:\/|$)/iu.test(pathname) || /^\/bangumi\/play\/[^/]+(?:\/|$)/iu.test(pathname)) {
      return 'content-detail-page';
    }
    if (isBilibiliSpaceHost(parsed.hostname) && /^\/\d+\/(?:(?:upload\/)?video|dynamic|fans\/follow|fans\/fans)(?:\/|$)?/iu.test(pathname)) {
      return 'author-list-page';
    }
    if (isBilibiliSpaceHost(parsed.hostname) && /^\/\d+(?:\/|$)?/iu.test(pathname)) {
      return 'author-page';
    }
    return null;
  } catch {
    return null;
  }
}
