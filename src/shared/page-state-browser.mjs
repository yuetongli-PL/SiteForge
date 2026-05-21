// @ts-check

export function createBrowserPageStateRuntime(runtime) {
  const {
    bilibiliBvidFromUrl,
    bilibiliContentTypeFromUrl,
    bilibiliMidFromUrl,
    cleanText,
    computePageStateSignature,
    normalizeUrlNoFragment,
    uniqueValues,
  } = runtime;

  function browserComputePageStateSignature(siteProfile = null) {
    function getLabel(element) {
      const ariaLabel = cleanText(element?.getAttribute?.('aria-label'));
      if (ariaLabel) {
        return ariaLabel;
      }
      const labelledBy = cleanText(element?.getAttribute?.('aria-labelledby'));
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/u)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map((node) => cleanText(node.textContent || node.innerText || ''))
          .filter(Boolean);
        if (parts.length > 0) {
          return cleanText(parts.join(' '));
        }
      }
      const text = cleanText(element?.innerText || element?.textContent || '');
      if (text) {
        return text.slice(0, 80);
      }
      return cleanText(element?.id || element?.getAttribute?.('name') || element?.tagName?.toLowerCase?.() || '');
    }

    function getRole(element) {
      const explicit = cleanText(element?.getAttribute?.('role'));
      if (explicit) {
        return explicit.toLowerCase();
      }
      const tag = String(element?.tagName || '').toLowerCase();
      if (tag === 'button' || tag === 'summary') {
        return 'button';
      }
      if (tag === 'a' && element?.hasAttribute?.('href')) {
        return 'link';
      }
      return '';
    }

    function isVisible(element) {
      if (!element || element.isConnected === false) {
        return false;
      }
      if (element.hidden || element.closest?.('[hidden], [inert]')) {
        return false;
      }
      if (element.getAttribute?.('aria-hidden') === 'true') {
        return false;
      }
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function descriptor(element) {
      return [
        element?.tagName?.toLowerCase?.() || '',
        element?.id ? `#${element.id}` : '',
        getRole(element) ? `[${getRole(element)}]` : '',
        getLabel(element),
      ].filter(Boolean).join('');
    }

    function uniqueSorted(values) {
      return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'en'));
    }

    function controlledIdsFromElement(element) {
      return cleanText(element?.getAttribute?.('aria-controls')).split(/\s+/u).filter(Boolean);
    }

    function textFromSelectors(selectors) {
      for (const selector of selectors) {
        try {
          const node = document.querySelector(selector);
          const text = cleanText(node?.textContent || node?.innerText || '');
          if (text) {
            return text;
          }
        } catch {
          // Ignore invalid selectors.
        }
      }
      return null;
    }

    function hrefFromSelectors(selectors) {
      for (const selector of selectors) {
        try {
          const node = document.querySelector(selector);
          const href = node?.getAttribute?.('href');
          if (href) {
            return normalizeUrlNoFragment(href, document.baseURI);
          }
        } catch {
          // Ignore invalid selectors.
        }
      }
      return null;
    }

    function textsFromSelectors(selectors) {
      const values = /** @type {any[]} */ ([]);
      for (const selector of selectors) {
        try {
          values.push(
            ...Array.from(document.querySelectorAll(selector)).map((node) => cleanText(node?.textContent || node?.innerText || '')),
          );
        } catch {
          // Ignore invalid selectors.
        }
      }
      return uniqueValues(values);
    }

    function hrefsFromSelectors(selectors) {
      const values = /** @type {any[]} */ ([]);
      for (const selector of selectors) {
        try {
          values.push(
            ...Array.from(document.querySelectorAll(selector))
              .map((node) => cleanText(node?.getAttribute?.('href') || ''))
              .filter(Boolean)
              .map((value) => normalizeUrlNoFragment(value, document.baseURI)),
          );
        } catch {
          // Ignore invalid selectors.
        }
      }
      return uniqueValues(values);
    }

    function metaContent(name) {
      return cleanText(
        document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '',
      ) || null;
    }

    function extractStructuredBilibiliAuthorCards({ currentAuthorMid = null, currentAuthorName = null, authorSubpage = null } = /** @type {any} */ ({})) {
      const containerSelectors = [
        '.bili-dyn-list__item',
        '.bili-dyn-item',
        '.bili-space-video',
        '.video-page-card',
        '.video-page-card-small',
        '.small-item',
        '.bili-video-card',
        '.list-item',
        '.card',
        'article',
        'li',
      ];
      const contentSelector = 'a[href*="/video/"], a[href*="/bangumi/play/"]';
      const authorSelector = 'a[href*="space.bilibili.com/"]';
      const titleSelectors = [
        '[title]',
        '.title',
        '.bili-video-card__info--tit',
        '.bili-video-card__info--title',
        '.video-name',
        '.name',
      ];
      const nameSelectors = ['.name', '.up-name', '.nickname', '[data-user-name]'];

      const isHeaderLike = (node) => Boolean(node?.closest?.('header, nav, [class*="header"], [class*="nav"]'));

      const findContainer = (node) => {
        for (const selector of containerSelectors) {
          const match = node?.closest?.(selector);
          if (match instanceof Element && !isHeaderLike(match) && isVisible(match)) {
            return match;
          }
        }
        const parent = node?.parentElement;
        return parent instanceof Element && !isHeaderLike(parent) ? parent : null;
      };

      const readAuthorNameFromContainer = (container, authorLink) => {
        for (const selector of nameSelectors) {
          const node = container.querySelector(selector);
          const value = cleanText(node?.textContent || node?.getAttribute?.('title') || '');
          if (value) {
            return value;
          }
        }
        return cleanText(authorLink?.textContent || authorLink?.getAttribute?.('title') || '');
      };

      const readContentTitleFromContainer = (container, contentLink) => {
        for (const selector of titleSelectors) {
          const node = container.querySelector(selector);
          const value = cleanText(node?.getAttribute?.('title') || node?.textContent || '');
          if (value) {
            return value;
          }
        }
        return cleanText(contentLink?.getAttribute?.('title') || contentLink?.textContent || '');
      };

      const registerContainer = (collection, node) => {
        const container = findContainer(node);
        if (container instanceof Element && !collection.includes(container)) {
          collection.push(container);
        }
      };

      const containers = /** @type {any[]} */ ([]);
      for (const node of Array.from(document.querySelectorAll(contentSelector))) {
        registerContainer(containers, node);
      }
      for (const node of Array.from(document.querySelectorAll(authorSelector))) {
        registerContainer(containers, node);
      }

      const authorCards = /** @type {any[]} */ ([]);
      const contentCards = /** @type {any[]} */ ([]);
      for (const container of containers) {
        const contentLink = Array.from(container.querySelectorAll(contentSelector))
          .find((node) => isVisible(node) && normalizeUrlNoFragment(node.getAttribute?.('href') || '', document.baseURI));
        const contentUrl = normalizeUrlNoFragment(contentLink?.getAttribute?.('href') || '', document.baseURI);
        const authorLink = Array.from(container.querySelectorAll(authorSelector))
          .find((node) => {
            if (!isVisible(node)) {
              return false;
            }
            const href = normalizeUrlNoFragment(node.getAttribute?.('href') || '', document.baseURI);
            const mid = bilibiliMidFromUrl(href);
            if (!href || mid === currentAuthorMid) {
              return false;
            }
            return true;
          });
        const authorUrl = normalizeUrlNoFragment(authorLink?.getAttribute?.('href') || '', document.baseURI);
        const authorMid = bilibiliMidFromUrl(authorUrl);
        const authorName = readAuthorNameFromContainer(container, authorLink) || currentAuthorName || null;
        if (authorUrl || authorName || authorMid) {
          authorCards.push({
            name: authorName,
            url: authorUrl || null,
            mid: authorMid || null,
            authorSubpage,
          });
        }
        if (contentUrl) {
          contentCards.push({
            title: readContentTitleFromContainer(container, contentLink),
            url: contentUrl,
            bvid: bilibiliBvidFromUrl(contentUrl),
            authorMid: authorMid || currentAuthorMid || null,
            authorUrl: authorUrl || null,
            authorName,
            contentType: bilibiliContentTypeFromUrl(contentUrl),
          });
        }
      }

      return {
        authorCards,
        contentCards,
      };
    }

    const detailsOpen = uniqueSorted(
      Array.from(document.querySelectorAll('details[open]')).map((element) => descriptor(element)),
    );
    const expandedTriggers = Array.from(document.querySelectorAll('[aria-expanded="true"]')).filter(isVisible);
    const expandedTrue = uniqueSorted(expandedTriggers.map((element) => descriptor(element)));
    const activeTabs = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(isVisible);
    const activeTabDescriptors = uniqueSorted(activeTabs.map((element) => descriptor(element)));
    const controlledIds = new Set();
    for (const element of [...expandedTriggers, ...activeTabs]) {
      for (const id of controlledIdsFromElement(element)) {
        controlledIds.add(id);
      }
    }
    const controlledVisible = uniqueSorted(
      [...controlledIds]
        .map((id) => document.getElementById(id))
        .filter((element) => isVisible(element))
        .map((element) => descriptor(element)),
    );
    const openDialogs = uniqueSorted(
      Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
        .filter(isVisible)
        .map((element) => descriptor(element)),
    );
    const openMenus = uniqueSorted(
      [...controlledIds]
        .map((id) => document.getElementById(id))
        .filter((element) => isVisible(element) && (getRole(element) === 'menu' || getRole(element) === 'menubar'))
        .map((element) => descriptor(element)),
    );
    const openListboxes = uniqueSorted(
      [...controlledIds]
        .map((id) => document.getElementById(id))
        .filter((element) => isVisible(element) && getRole(element) === 'listbox')
        .map((element) => descriptor(element)),
    );
    const openPopovers = uniqueSorted(
      Array.from(document.querySelectorAll('[popover]'))
        .filter((element) => {
          try {
            return element.matches(':popover-open') && isVisible(element);
          } catch {
            return false;
          }
        })
        .map((element) => descriptor(element)),
    );

    const searchInputSelectors = Array.isArray(siteProfile?.search?.inputSelectors)
      ? siteProfile.search.inputSelectors
      : ['#searchkey', 'input[name="searchkey"]', 'input[name="keyword"]', '#s', 'input[type="search"]'];
    const queryInputValue = (() => {
      for (const selector of searchInputSelectors) {
        try {
          const value = cleanText(document.querySelector(selector)?.value || '');
          if (value) {
            return value;
          }
        } catch {
          // Ignore invalid selectors.
        }
      }
      return '';
    })();

    return computePageStateSignature({
      finalUrl: normalizeUrlNoFragment(location.href),
      title: document.title || '',
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      rawHtml: document.documentElement?.outerHTML || '',
      documentText: document.body?.innerText || document.documentElement?.innerText || '',
      queryInputValue,
      textFromSelectors,
      hrefFromSelectors,
      textsFromSelectors,
      hrefsFromSelectors,
      metaContent,
      extractStructuredBilibiliAuthorCards,
      detailsOpen,
      expandedTrue,
      activeTabs: activeTabDescriptors,
      controlledVisible,
      openDialogs,
      openMenus,
      openListboxes,
      openPopovers,
    }, siteProfile);
  }

  return {
    browserComputePageStateSignature,
  };
}
