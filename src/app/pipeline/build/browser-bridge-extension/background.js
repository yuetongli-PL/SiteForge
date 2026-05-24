const activeSessions = new Map();

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function sameAllowedHost(urlValue, allowedHost) {
  const parsed = safeUrl(urlValue);
  return Boolean(parsed && parsed.hostname === String(allowedHost || ''));
}

function sessionKey(session) {
  return String(session?.nonce || '');
}

function signal(session, stage) {
  if (!session?.extensionStatusUrl) {
    return;
  }
  try {
    const url = new URL(session.extensionStatusUrl);
    url.searchParams.set('stage', stage);
    fetch(url.toString(), { method: 'POST', credentials: 'omit', cache: 'no-store' }).catch(() => {});
  } catch {
    // Ignore bridge diagnostics failures; structure submission remains authoritative.
  }
}

async function injectCollector(tabId, session) {
  signal(session, 'collector-injecting');
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['collector-content.js'],
  });
  const result = await chrome.tabs.sendMessage(tabId, {
    type: 'siteforge-collect-structure',
    session,
  });
  signal(session, result?.ok ? 'collector-submit-ok' : `collector-submit-failed-${result?.reason || result?.status || 'unknown'}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'siteforge-bridge-session') {
    return false;
  }

  const session = message.session;
  const target = safeUrl(session?.targetUrl);
  if (!target || !sessionKey(session) || target.hostname !== String(session?.allowedHost || '')) {
    sendResponse?.({ ok: false });
    return false;
  }

  chrome.tabs.create({ url: target.toString(), active: true }, (tab) => {
    if (!tab?.id) {
      sendResponse?.({ ok: false });
      return;
    }
    activeSessions.set(tab.id, session);
    signal(session, 'target-tab-created');
    sendResponse?.({ ok: true, tabId: tab.id });
  });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') {
    return;
  }
  const session = activeSessions.get(tabId);
  if (!session) {
    return;
  }
  if (!sameAllowedHost(tab?.url, session.allowedHost)) {
    activeSessions.delete(tabId);
    return;
  }
  injectCollector(tabId, session)
    .then(() => activeSessions.delete(tabId))
    .catch(() => activeSessions.delete(tabId));
});
