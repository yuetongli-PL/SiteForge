// @ts-check

import fs from 'node:fs/promises';

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeHost(value) {
  return normalizeText(value).replace(/^\./u, '').toLowerCase();
}

function targetFromUrl(targetUrl) {
  const parsed = new URL(String(targetUrl ?? 'https://www.instagram.com/'));
  return {
    origin: parsed.origin,
    host: parsed.hostname.toLowerCase(),
    https: parsed.protocol === 'https:',
  };
}

function cookieDomainMatches(cookieDomain, targetHost) {
  const domain = normalizeHost(cookieDomain);
  return Boolean(domain) && (
    domain === targetHost
    || domain.endsWith(`.${targetHost}`)
    || targetHost.endsWith(`.${domain}`)
  );
}

function truthyCell(value) {
  const text = normalizeText(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y' || text === '✓' || text === '✔';
}

function sameSiteCell(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === 'strict') return 'Strict';
  if (text === 'lax') return 'Lax';
  if (text === 'none' || text === 'no_restriction') return 'None';
  return null;
}

function expirySeconds(value) {
  const text = normalizeText(value);
  if (!text || /^session|会话$/iu.test(text)) {
    return null;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.trunc(numeric);
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return Math.trunc(parsed / 1000);
  }
  return null;
}

function cookieParam(row, target) {
  const name = normalizeText(row.name);
  const value = normalizeText(row.value);
  const domain = normalizeText(row.domain);
  if (!name || !value || !cookieDomainMatches(domain, target.host)) {
    return null;
  }
  const path = normalizeText(row.path, '/');
  const expires = expirySeconds(row.expires);
  const sameSite = sameSiteCell(row.sameSite);
  const secure = row.secure === true || target.https || sameSite === 'None';
  const cookie = {
    name,
    value,
    path: path.startsWith('/') ? path : '/',
    httpOnly: row.httpOnly === true,
    secure,
  };
  if (domain) {
    cookie.domain = domain;
  } else {
    cookie.url = target.origin;
  }
  if (expires !== null) {
    cookie.expires = expires;
  }
  if (sameSite) {
    cookie.sameSite = sameSite;
  }
  return cookie;
}

function parseNetscapeCookieRow(cells) {
  if (cells.length < 7) return null;
  if (!String(cells[2] ?? '').startsWith('/')) return null;
  if (!/^(?:true|false)$/iu.test(String(cells[1] ?? ''))) return null;
  return {
    domain: cells[0],
    path: cells[2],
    secure: truthyCell(cells[3]),
    expires: cells[4],
    name: cells[5],
    value: cells.slice(6).join('\t'),
  };
}

function parseBrowserTableCookieRow(cells) {
  if (cells.length < 4) return null;
  if (!/instagram\.com$/iu.test(String(cells[2] ?? ''))) return null;
  return {
    name: cells[0],
    value: cells[1],
    domain: cells[2],
    path: cells[3] || '/',
    expires: cells[4] || null,
    httpOnly: truthyCell(cells[6]),
    secure: truthyCell(cells[7]),
    sameSite: cells.find((cell, index) => index >= 8 && sameSiteCell(cell)) || null,
  };
}

function parseCookieHeaderLine(line) {
  if (!line.includes('=') || !line.includes(';')) {
    return null;
  }
  return line.split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      return {
        name: part.slice(0, index),
        value: part.slice(index + 1),
        domain: '.instagram.com',
        path: '/',
      };
    })
    .filter(Boolean);
}

export function parseBrowserCookieFileText(text, {
  targetUrl = 'https://www.instagram.com/',
} = /** @type {any} */ ({})) {
  const target = targetFromUrl(targetUrl);
  const rows = [];
  let format = 'unknown';
  for (const rawLine of String(text ?? '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const headerRows = parseCookieHeaderLine(line);
    if (headerRows?.length) {
      rows.push(...headerRows);
      format = format === 'unknown' ? 'cookie-header' : format;
      continue;
    }
    const cells = line.split(/\t+/u).map((cell) => cell.trim());
    const parsed = parseNetscapeCookieRow(cells) ?? parseBrowserTableCookieRow(cells);
    if (parsed) {
      rows.push(parsed);
      format = format === 'unknown'
        ? (parseNetscapeCookieRow(cells) ? 'netscape' : 'browser-table')
        : format;
    }
  }

  const seen = new Set();
  const cookies = [];
  for (const row of rows) {
    const cookie = cookieParam(row, target);
    if (!cookie) continue;
    const key = `${cookie.domain || cookie.url}\t${cookie.path}\t${cookie.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cookies.push(cookie);
  }
  return {
    cookies,
    summary: {
      source: 'user-provided-login-state-file',
      format,
      targetOrigin: target.origin,
      parsed: cookies.length > 0,
      matchedItemCount: cookies.length,
      rawMaterialPersisted: false,
      filePathPersisted: false,
      namesPersisted: false,
      valuesPersisted: false,
    },
  };
}

export async function loadBrowserCookiesFromFile(filePath, options = /** @type {any} */ ({})) {
  const text = await fs.readFile(filePath, 'utf8');
  return parseBrowserCookieFileText(text, options);
}

export async function applyBrowserCookiesFromFile(session, filePath, {
  targetUrl = 'https://www.instagram.com/',
} = /** @type {any} */ ({})) {
  const loaded = await loadBrowserCookiesFromFile(filePath, { targetUrl });
  if (!loaded.cookies.length) {
    return {
      ...loaded.summary,
      applied: false,
      status: 'no-matching-login-state',
    };
  }
  await session.send('Network.setCookies', { cookies: loaded.cookies });
  return {
    ...loaded.summary,
    applied: true,
    status: 'applied',
  };
}
