(() => {
  if (globalThis.__SITEFORGE_BROWSER_BRIDGE_COLLECTOR_INSTALLED__) {
    return;
  }
  globalThis.__SITEFORGE_BROWSER_BRIDGE_COLLECTOR_INSTALLED__ = true;

  const MAX_LINKS = 160;
  const MAX_CONTROLS = 80;
  const MAX_FORMS = 24;
  const MAX_ITEMS = 40;
  const forbidden = /[<>{}]|(?:authorization|bearer|cookie|token|secret|session|password|local[-_\s]?storage|session[-_\s]?storage|raw\s+dom|raw\s+html)/iu;

  const attr = (node, name) => String(node?.getAttribute?.(name) || '').trim();
  const clean = (value, fallback = '', maxLength = 120) => {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
    if (!text || forbidden.test(text)) return fallback;
    return text.slice(0, maxLength);
  };
  const visible = (node) => {
    const rect = node?.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  };
  const sameOriginUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return null;
      url.hash = '';
      url.username = '';
      url.password = '';
      return url.toString();
    } catch {
      return null;
    }
  };
  const routeTemplateFor = (value) => {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url.pathname
        .replace(/\/\d+(?=\/|$)/gu, '/:id')
        .replace(/\/[a-f0-9]{8,}(?=\/|$)/giu, '/:id')
        .replace(/\/[a-z0-9_-]{24,}(?=\/|$)/giu, '/:slug')
        .replace(/\/+$/u, '') || '/';
    } catch {
      return null;
    }
  };
  const labelFor = (node, fallback) => clean(
    attr(node, 'aria-label')
      || attr(node, 'title')
      || attr(node, 'data-title')
      || attr(node, 'data-label')
      || node?.textContent
      || fallback,
    fallback,
    80,
  );
  const semanticKindFor = (href, label, node) => {
    const text = [href, label, attr(node, 'class'), attr(node, 'id'), attr(node, 'role')].join(' ').toLowerCase();
    if (/search|query|keyword|find|\u641c\u7d22|\u641c\u4e66|\u68c0\u7d22/u.test(text)) return 'search';
    if (/categor|category|categories|genre|genres|channel|channels|section|classify|bookstore|library|\u5206\u7c7b|\u7c7b\u522b|\u9891\u9053|\u4e66\u5e93|\u4e66\u57ce/u.test(text)) return 'category';
    if (/tag|topic|\u6807\u7b7e|\u8bdd\u9898/u.test(text)) return 'tag';
    if (/rank|ranking|top|hot|popular|trending|latest|recent|\u699c\u5355|\u6392\u884c|\u70ed\u95e8|\u6700\u65b0|\u65b0\u4e66/u.test(text)) return 'ranking';
    if (/follow(?:ing|ed)?|followers|\u5173\u6ce8|\u7c89\u4e1d/u.test(text)) return 'following_list';
    if (/article|story|news|post|blog|\u6587\u7ae0|\u8d44\u8baf|\u65b0\u95fb/u.test(text)) return 'article';
    if (/book|books|novel|fiction|chapter|reader|work|works|\u5c0f\u8bf4|\u4e66\u7c4d|\u4f5c\u54c1|\u7ae0\u8282|\u9605\u8bfb/u.test(text)) return 'work';
    if (/video|watch|movie|media/u.test(text)) return 'media';
    if (/author|profile|user|org|organization|people|creator|\u4f5c\u8005|\u7528\u6237|\u4e3b\u9875/u.test(text)) return 'profile';
    if (/detail|item|product|content|\u8be6\u60c5|\u76ee\u5f55|\u4e66\u9875/u.test(text)) return 'detail';
    return 'navigation';
  };
  const structureTypeFor = (kind) => ({
    search: 'search_route_group',
    category: 'category_link_group',
    tag: 'tag_link_group',
    ranking: 'ranking_link_group',
    following_list: 'following_list_link_group',
    article: 'article_link_group',
    work: 'work_link_group',
    media: 'media_link_group',
    profile: 'profile_link_group',
    detail: 'detail_link_group',
  }[kind] || 'navigation_link_group');

  async function collect(session) {
    const current = new URL(window.location.href);
    if (current.hostname !== String(session?.allowedHost || '')) {
      return { ok: false, reason: 'host-mismatch' };
    }
    const sourceLayer = String(session?.sourceLayer || 'authenticated');
    const links = [...document.querySelectorAll('a[href], area[href]')]
      .filter(visible)
      .map((node, index) => {
        const href = sameOriginUrl(node.href || attr(node, 'href'));
        if (!href) return null;
        const label = labelFor(node, `link-${index + 1}`);
        const semanticKind = semanticKindFor(href, label, node);
        return {
          href,
          normalizedHref: href,
          label,
          selector: `${node.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
          semanticKind,
          structureType: structureTypeFor(semanticKind),
          routeTemplate: routeTemplateFor(href),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_LINKS);
    const controls = [...document.querySelectorAll('button, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]')]
      .filter(visible)
      .map((node, index) => ({
        kind: String(node.tagName || 'control').toLowerCase(),
        type: clean(attr(node, 'type'), null, 40),
        label: labelFor(node, `control-${index + 1}`),
        name: clean(attr(node, 'name'), null, 80),
        selector: `${String(node.tagName || 'control').toLowerCase()}:nth-of-type(${index + 1})`,
        attrs: { role: clean(attr(node, 'role'), null, 40) },
      }))
      .slice(0, MAX_CONTROLS);
    const forms = [...document.querySelectorAll('form')]
      .filter(visible)
      .map((form, index) => ({
        label: labelFor(form, `form-${index + 1}`),
        selector: `form:nth-of-type(${index + 1})`,
        method: clean(form.method || attr(form, 'method') || 'GET', 'GET', 12).toUpperCase(),
        action: sameOriginUrl(form.action || attr(form, 'action') || window.location.href),
        inputs: [...form.querySelectorAll('input, select, textarea')].slice(0, 20).map((input, inputIndex) => ({
          name: clean(attr(input, 'name'), null, 80),
          type: clean(attr(input, 'type'), null, 40),
          selector: `${String(input.tagName || 'input').toLowerCase()}:nth-of-type(${inputIndex + 1})`,
          label: labelFor(input, `input-${inputIndex + 1}`),
          tagName: clean(input.tagName, null, 20),
        })),
      }))
      .slice(0, MAX_FORMS);
    const listContainers = [...document.querySelectorAll('ul, ol, table, [role="list"], [role="feed"], [data-list], [class*="list"], [class*="grid"], [class*="feed"]')].filter(visible);
    const itemNodes = [...document.querySelectorAll('article, li, tr, [role="listitem"], [class*="item"], [class*="card"], [data-item]')].filter(visible);
    const semanticCounts = links.reduce((counts, link) => {
      counts[link.semanticKind] = (counts[link.semanticKind] || 0) + 1;
      return counts;
    }, {});
    const routeTemplates = [...new Set(links.map((link) => link.routeTemplate).filter(Boolean))].slice(0, 80);
    const structureItems = Object.entries(semanticCounts)
      .filter(([, count]) => Number(count) > 0)
      .slice(0, MAX_ITEMS)
      .map(([kind, count]) => ({
        nodeType: kind === 'search' ? 'operation' : 'content',
        structureType: structureTypeFor(kind),
        labelSummary: `${kind} link group`,
        visibleItemCount: count,
        listPresent: true,
        routeTemplates: links.filter((link) => link.semanticKind === kind).map((link) => link.routeTemplate).filter(Boolean).slice(0, 20),
      }));
    const signature = JSON.stringify({
      path: window.location.pathname,
      sourceLayer,
      routeTemplates: routeTemplates.slice(0, 40),
      semanticCounts,
      controls: controls.length,
      forms: forms.length,
      itemCount: itemNodes.length,
    });
    let hash = 0;
    for (let index = 0; index < signature.length; index += 1) {
      hash = ((hash << 5) - hash + signature.charCodeAt(index)) | 0;
    }
    const page = {
      url: window.location.href,
      normalizedUrl: window.location.href,
      routeTemplate: routeTemplateFor(window.location.href),
      pageType: window.location.pathname === '/' ? 'authenticated_home' : 'authenticated_browser_summary',
      sourceLayer,
      visibleItemCount: Math.min(itemNodes.length, 999),
      listPresent: listContainers.length > 0 || itemNodes.length > 0,
      emptyStatePresent: itemNodes.length === 0 && listContainers.length > 0,
      unreadMarkerPresent: document.querySelector('[class*="unread"], [aria-label*="unread" i], [data-unread]') !== null,
      modalPresence: document.querySelector('[role="dialog"], dialog, [class*="modal"]') !== null,
      structureHash: `browser-structure:${Math.abs(hash).toString(16)}`,
      evidenceLevel: 'browser_structure_verified',
      evidenceStatus: 'structure_summary_present',
      links,
      forms,
      controls,
      structureItems,
    };
    const payload = sourceLayer === 'authenticated_overlay'
      ? { nonce: session.nonce, authenticatedOverlayPages: [page] }
      : { nonce: session.nonce, authenticatedPages: [page] };
    const response = await fetch(session.submitUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(payload),
    });
    return { ok: response.ok, status: response.status };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'siteforge-collect-structure') {
      return false;
    }
    collect(message.session)
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });
})();
