(() => {
  const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
  if (meta('siteforge-browser-bridge') !== '1') {
    return;
  }

  const sessionUrl = meta('siteforge-bridge-session') || new URL(`/session.json?nonce=${encodeURIComponent(meta('siteforge-bridge-nonce'))}`, location.href).toString();
  const signal = (session, stage) => {
    if (!session?.extensionStatusUrl) {
      return;
    }
    const url = new URL(session.extensionStatusUrl);
    url.searchParams.set('stage', stage);
    fetch(url.toString(), { method: 'POST', credentials: 'omit', cache: 'no-store' }).catch(() => {});
  };
  fetch(sessionUrl, { credentials: 'omit', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((session) => {
      if (!session || session.artifactFamily !== 'siteforge-browser-bridge-session') {
        return;
      }
      signal(session, 'bridge-content-active');
      chrome.runtime.sendMessage({ type: 'siteforge-bridge-session', session }, (response) => {
        signal(session, response?.ok ? 'background-session-accepted' : 'background-session-rejected');
      });
    })
    .catch(() => {});
})();
