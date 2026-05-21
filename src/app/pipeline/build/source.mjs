// @ts-check

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { pathExists } from '../../../infra/io.mjs';
import { normalizeUrl } from './models.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..', '..', '..');
const DEFAULT_FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'sites');
const STATIC_FETCH_HEADERS = Object.freeze({
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
  'accept-encoding': 'identity',
  'user-agent': 'SiteForgeBuildStaticCrawler/1.0',
});
const MAX_PROXY_REDIRECTS = 5;

function slugFixtureName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function readFixtureAliases(fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const aliasesPath = path.join(fixtureRoot, 'fixtures.json');
  if (!existsSync(aliasesPath)) {
    return new Map();
  }
  const parsed = JSON.parse(readFileSync(aliasesPath, 'utf8'));
  return new Map(Object.entries(parsed.hosts ?? {}).map(([host, fixtureName]) => [
    String(host).toLowerCase(),
    String(fixtureName),
  ]));
}

function fixtureNameForHost(hostname, fixtureRoot = DEFAULT_FIXTURE_ROOT) {
  const normalizedHost = String(hostname ?? '').toLowerCase();
  const aliases = readFixtureAliases(fixtureRoot);
  const aliased = aliases.get(normalizedHost);
  if (aliased) {
    return aliased;
  }
  const candidate = slugFixtureName(normalizedHost);
  return candidate && existsSync(path.join(fixtureRoot, candidate)) ? candidate : null;
}

function candidateFixtureFiles(fixtureDir, urlValue) {
  const rawPathMatch = String(urlValue).match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/iu);
  const rawPath = rawPathMatch?.[1] ?? '';
  if (/(?:^|\/)(?:\.|%2e){2}(?:\/|$)|%2f|%5c/iu.test(rawPath)) {
    const error = /** @type {Error & Record<string, any>} */ (new Error(`Fixture path traversal is not allowed for ${urlValue}`));
    error.code = 'fixture-path-traversal';
    throw error;
  }
  const parsed = new URL(urlValue);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/' || pathname === '') {
    return [path.join(fixtureDir, 'index.html')];
  }
  const segments = pathname.replace(/^\/+/u, '').replace(/\/+$/u, '').split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    const error = /** @type {Error & Record<string, any>} */ (new Error(`Fixture path traversal is not allowed for ${urlValue}`));
    error.code = 'fixture-path-traversal';
    throw error;
  }
  const clean = segments.join(path.sep);
  const candidates = [path.join(fixtureDir, ...segments)];
  if (!path.extname(clean)) {
    candidates.push(path.join(fixtureDir, ...segments.slice(0, -1), `${segments.at(-1)}.html`));
    candidates.push(path.join(fixtureDir, ...segments, 'index.html'));
  }
  if (clean.endsWith('/')) {
    candidates.push(path.join(fixtureDir, ...segments, 'index.html'));
  }
  return candidates;
}

export function resolveFixtureForUrl(inputUrl, options = /** @type {any} */ ({})) {
  const parsed = new URL(inputUrl);
  const explicitFixture = options.fixturePath
    ? path.resolve(options.fixturePath)
    : options.fixture
      ? path.join(DEFAULT_FIXTURE_ROOT, options.fixture)
      : null;
  const fixtureRoot = path.resolve(options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT);
  const fixtureName = explicitFixture || options.fixture === false
    ? null
    : fixtureNameForHost(parsed.hostname.toLowerCase(), fixtureRoot);
  const fixtureDir = explicitFixture ?? (fixtureName ? path.join(fixtureRoot, fixtureName) : null);
  if (!fixtureDir) {
    return null;
  }
  return {
    name: fixtureName ?? path.basename(fixtureDir),
    fixtureDir,
    rootUrl: `${parsed.protocol}//${parsed.host}/`,
  };
}

export async function readFixtureUrl(urlValue, fixture) {
  for (const candidate of candidateFixtureFiles(fixture.fixtureDir, urlValue)) {
    if ((await pathExists(candidate)) && (await stat(candidate)).isFile()) {
      return {
        body: await readFile(candidate, 'utf8'),
        sourcePath: candidate,
        fixtureName: fixture.name,
      };
    }
  }
  const parsed = new URL(urlValue);
  if (parsed.pathname === '/robots.txt' || parsed.pathname === '/sitemap.xml') {
    const candidate = path.join(fixture.fixtureDir, path.basename(parsed.pathname));
    if (await pathExists(candidate)) {
      return {
        body: await readFile(candidate, 'utf8'),
        sourcePath: candidate,
        fixtureName: fixture.name,
      };
    }
  }
  const error = /** @type {Error & Record<string, any>} */ (new Error(`Fixture resource not found for ${urlValue}`));
  error.code = 'fixture-resource-not-found';
  throw error;
}

function reasonedError(message, code, details = /** @type {any} */ ({})) {
  const error = /** @type {Error & Record<string, any>} */ (new Error(message));
  error.code = code;
  error.reasonCode = code;
  Object.assign(error, details);
  return error;
}

function proxyEnvValue(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function proxyEnvValues(env, names) {
  const values = /** @type {any[]} */ ([]);
  for (const name of names) {
    const value = env?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      values.push(String(value).trim());
    }
  }
  return [...new Set(values)];
}

function redactProxyUrl(proxyUrl) {
  try {
    const parsed = proxyUrl instanceof URL ? new URL(proxyUrl.toString()) : new URL(String(proxyUrl));
    if (parsed.username || parsed.password) {
      parsed.username = '[REDACTED]';
      parsed.password = '[REDACTED]';
    }
    return parsed.toString();
  } catch {
    return '[invalid-proxy-url]';
  }
}

function proxyDiagnostic(proxyUrl) {
  return proxyUrl
    ? {
        protocol: proxyUrl.protocol.replace(/:$/u, ''),
        host: proxyUrl.hostname,
        port: proxyPort(proxyUrl),
      }
    : null;
}

function requestDiagnostic({ statusCode, proxyUrl = null } = /** @type {any} */ ({})) {
  return {
    method: 'GET',
    statusCode,
    requestHeaders: { ...STATIC_FETCH_HEADERS },
    proxy: proxyDiagnostic(proxyUrl),
  };
}

function noProxyEntries(env = process.env) {
  const value = proxyEnvValue(env, ['NO_PROXY', 'no_proxy']);
  return value
    ? value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : [];
}

function targetHostPort(parsedUrl) {
  const defaultPort = parsedUrl.protocol === 'https:' ? '443' : '80';
  return `${parsedUrl.hostname.toLowerCase()}:${parsedUrl.port || defaultPort}`;
}

function noProxyMatches(urlValue, env = process.env) {
  const entries = noProxyEntries(env);
  if (!entries.length) {
    return false;
  }
  const parsed = new URL(urlValue);
  const host = parsed.hostname.toLowerCase();
  const hostPort = targetHostPort(parsed);
  for (const rawEntry of entries) {
    if (rawEntry === '*') {
      return true;
    }
    const entry = rawEntry.replace(/^https?:\/\//u, '').replace(/\/.*$/u, '');
    if (!entry) {
      continue;
    }
    if (entry.includes(':') && entry === hostPort) {
      return true;
    }
    const entryHost = entry.split(':')[0].replace(/^\./u, '');
    if (entryHost && (host === entryHost || host.endsWith(`.${entryHost}`))) {
      return true;
    }
  }
  return false;
}

export function resolveLiveFetchProxy(urlValue, env = process.env) {
  return resolveLiveFetchProxies(urlValue, env)[0] ?? null;
}

function resolveLiveFetchProxies(urlValue, env = process.env) {
  if (noProxyMatches(urlValue, env)) {
    return [];
  }
  const parsed = new URL(urlValue);
  const proxyValues = parsed.protocol === 'https:'
    ? proxyEnvValues(env, ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'])
    : proxyEnvValues(env, ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']);
  if (!proxyValues.length) {
    return [];
  }
  const proxies = /** @type {any[]} */ ([]);
  for (const proxyValue of proxyValues) {
    let proxyUrl;
    try {
      proxyUrl = new URL(proxyValue);
    } catch {
      throw reasonedError('Invalid static fetch proxy URL from environment.', 'static-fetch-proxy-invalid');
    }
    if (!['http:', 'socks5:'].includes(proxyUrl.protocol)) {
      throw reasonedError(
        `Unsupported proxy protocol for static fetch: ${redactProxyUrl(proxyUrl)}. Supported proxy protocols: http:// and socks5://.`,
        'static-fetch-proxy-unsupported',
        { proxyProtocol: proxyUrl.protocol },
      );
    }
    proxies.push(proxyUrl);
  }
  return proxies;
}

function proxyPort(proxyUrl) {
  return Number(proxyUrl.port || (proxyUrl.protocol === 'socks5:' ? 1080 : 80));
}

function proxyAuthHeader(proxyUrl) {
  if (!proxyUrl.username && !proxyUrl.password) {
    return null;
  }
  const user = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

function readSocketBytes(socket, length, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length < length) {
        return;
      }
      cleanup();
      const head = buffer.subarray(0, length);
      const tail = buffer.subarray(length);
      if (tail.length) {
        socket.unshift(tail);
      }
      resolve(head);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onTimeout = () => {
      cleanup();
      reject(reasonedError(`Static fetch SOCKS5 proxy timed out after ${timeoutMs}ms.`, 'static-fetch-proxy-timeout'));
    };
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.on('data', onData);
  });
}

function socketWrite(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function connectSocks5Proxy(target, proxyUrl, options = /** @type {any} */ ({})) {
  const timeoutMs = options.fetchTimeoutMs;
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const socket = net.connect({
    host: proxyUrl.hostname,
    port: proxyPort(proxyUrl),
  });
  socket.setTimeout(timeoutMs);
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(reasonedError(`Static fetch SOCKS5 proxy timed out after ${timeoutMs}ms.`, 'static-fetch-proxy-timeout')));
    });
    const hasAuth = Boolean(proxyUrl.username || proxyUrl.password);
    await socketWrite(socket, Buffer.from(hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]));
    const method = await readSocketBytes(socket, 2, timeoutMs);
    if (method[0] !== 0x05 || method[1] === 0xff) {
      throw reasonedError('Static fetch SOCKS5 proxy did not accept an authentication method.', 'static-fetch-proxy-connect-failed');
    }
    if (method[1] === 0x02) {
      const username = Buffer.from(decodeURIComponent(proxyUrl.username), 'utf8');
      const password = Buffer.from(decodeURIComponent(proxyUrl.password), 'utf8');
      if (username.length > 255 || password.length > 255) {
        throw reasonedError('Static fetch SOCKS5 proxy credentials are too long.', 'static-fetch-proxy-invalid');
      }
      await socketWrite(socket, Buffer.concat([
        Buffer.from([0x01, username.length]),
        username,
        Buffer.from([password.length]),
        password,
      ]));
      const auth = await readSocketBytes(socket, 2, timeoutMs);
      if (auth[0] !== 0x01 || auth[1] !== 0x00) {
        throw reasonedError('Static fetch SOCKS5 proxy authentication failed.', 'static-fetch-proxy-connect-failed');
      }
    }
    const host = Buffer.from(target.hostname, 'utf8');
    if (host.length > 255) {
      throw reasonedError('Static fetch SOCKS5 target host is too long.', 'static-fetch-proxy-invalid');
    }
    const port = Buffer.alloc(2);
    port.writeUInt16BE(targetPort, 0);
    await socketWrite(socket, Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
      host,
      port,
    ]));
    const head = await readSocketBytes(socket, 4, timeoutMs);
    if (head[0] !== 0x05 || head[1] !== 0x00) {
      throw reasonedError(`Static fetch SOCKS5 proxy CONNECT failed with status ${head[1]}.`, 'static-fetch-proxy-connect-failed', {
        socksStatus: head[1],
      });
    }
    const addressLength = head[3] === 0x01
      ? 4
      : head[3] === 0x03
        ? (await readSocketBytes(socket, 1, timeoutMs))[0]
        : head[3] === 0x04
          ? 16
          : null;
    if (addressLength === null) {
      throw reasonedError('Static fetch SOCKS5 proxy returned an unsupported address type.', 'static-fetch-proxy-connect-failed');
    }
    await readSocketBytes(socket, addressLength + 2, timeoutMs);
    socket.setTimeout(0);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function responsePayload(response, urlValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = /** @type {any[]} */ ([]);
    const cleanup = () => {
      response.off('data', onData);
      response.off('error', onError);
      response.off('end', onEnd);
      response.off('close', onClose);
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        status: response.statusCode ?? 0,
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        headers: response.headers ?? {},
        text: Buffer.concat(chunks).toString('utf8'),
        url: urlValue,
      });
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      chunks.push(Buffer.from(chunk));
    };
    const onError = (error) => fail(error);
    const onEnd = () => finish();
    const onClose = () => fail(reasonedError(`Static fetch response closed before completion for ${urlValue}.`, 'static-fetch-proxy-network-failed'));
    response.on('data', onData);
    response.once('error', onError);
    response.once('end', onEnd);
    response.once('close', onClose);
  });
}

function parseRawHttpResponse(buffer, urlValue) {
  const separator = buffer.indexOf('\r\n\r\n');
  if (separator < 0) {
    throw reasonedError(`Static fetch received an incomplete HTTP response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
  }
  const head = buffer.subarray(0, separator).toString('latin1');
  const body = buffer.subarray(separator + 4);
  const lines = head.split('\r\n');
  const statusMatch = lines[0]?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/u);
  if (!statusMatch) {
    throw reasonedError(`Static fetch received an invalid HTTP response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
  }
  const headers = /** @type {any} */ ({});
  for (const line of lines.slice(1)) {
    const index = line.indexOf(':');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  const decodedBody = decodeRawHttpBody(body, headers, urlValue);
  const status = Number(statusMatch[1]);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: decodedBody.toString('utf8'),
    url: urlValue,
  };
}

function decodeRawHttpBody(body, headers, urlValue) {
  const transferEncoding = String(headers['transfer-encoding'] ?? '').toLowerCase();
  if (!transferEncoding.includes('chunked')) {
    const contentLength = Number(headers['content-length']);
    return Number.isFinite(contentLength) && contentLength >= 0
      ? body.subarray(0, contentLength)
      : body;
  }
  const chunks = /** @type {any[]} */ ([]);
  let offset = 0;
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset);
    if (lineEnd < 0) {
      throw reasonedError(`Static fetch received an incomplete chunked response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
    }
    const sizeText = body.subarray(offset, lineEnd).toString('ascii').split(';')[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) {
      throw reasonedError(`Static fetch received an invalid chunked response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
    }
    offset = lineEnd + 2;
    if (size === 0) {
      return Buffer.concat(chunks);
    }
    const chunkEnd = offset + size;
    if (chunkEnd > body.length) {
      throw reasonedError(`Static fetch received a truncated chunked response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
    }
    chunks.push(body.subarray(offset, chunkEnd));
    offset = chunkEnd + 2;
  }
  throw reasonedError(`Static fetch received an unterminated chunked response for ${urlValue}.`, 'static-fetch-proxy-network-failed');
}

function rawHttpGetOverSocket(target, socket, options = /** @type {any} */ ({})) {
  const timeoutMs = options.fetchTimeoutMs;
  const secure = target.protocol === 'https:';
  return new Promise((resolve, reject) => {
    let settled = false;
    let transport = socket;
    const chunks = /** @type {any[]} */ ([]);
    const cleanup = () => {
      transport.off('data', onData);
      transport.off('end', onEnd);
      transport.off('close', onClose);
      transport.off('error', onError);
      transport.off('timeout', onTimeout);
      if (secure) {
        transport.off('secureConnect', writeRequest);
      }
    };
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      try {
        resolve(parseRawHttpResponse(Buffer.concat(chunks), target.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      transport.destroy();
      reject(error);
    };
    const onData = (chunk) => {
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => finish();
    const onClose = (hadError) => {
      if (settled) {
        return;
      }
      if (chunks.length && !hadError) {
        finish();
        return;
      }
      fail(reasonedError(`Static fetch proxy connection closed before response for ${target.toString()}.`, 'static-fetch-proxy-network-failed'));
    };
    const onError = (error) => fail(error);
    const onTimeout = () => fail(reasonedError(`Static fetch timed out after ${timeoutMs}ms through proxy tunnel.`, 'static-fetch-proxy-timeout'));
    const writeRequest = () => {
      const requestPath = `${target.pathname || '/'}${target.search}`;
      const request = [
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${target.host}`,
        `Accept: ${STATIC_FETCH_HEADERS.accept}`,
        `Accept-Encoding: ${STATIC_FETCH_HEADERS['accept-encoding']}`,
        `User-Agent: ${STATIC_FETCH_HEADERS['user-agent']}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      transport.write(request, (error) => {
        if (error) {
          fail(error);
        }
      });
    };

    if (secure) {
      transport = tls.connect({ socket, servername: target.hostname, ALPNProtocols: ['http/1.1'] });
    }
    transport.setTimeout(timeoutMs);
    transport.on('data', onData);
    transport.once('end', onEnd);
    transport.once('close', onClose);
    transport.once('error', onError);
    transport.once('timeout', onTimeout);
    if (secure) {
      transport.once('secureConnect', writeRequest);
    } else {
      queueMicrotask(writeRequest);
    }
  });
}

async function requestViaSocksProxy(urlValue, proxyUrl, options = /** @type {any} */ ({})) {
  const target = new URL(urlValue);
  const socket = await connectSocks5Proxy(target, proxyUrl, options);
  return await rawHttpGetOverSocket(target, socket, options);
}

function withProxyDeadline(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(reasonedError(message, 'static-fetch-proxy-timeout'));
    }, Math.max(1, Number(timeoutMs ?? 10000)));
    promise.then((value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    }, (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      reject(error);
    });
  });
}

function requestHttpViaProxy(urlValue, proxyUrl, options = /** @type {any} */ ({})) {
  const target = new URL(urlValue);
  const headers = {
    ...STATIC_FETCH_HEADERS,
    host: target.host,
  };
  const proxyAuth = proxyAuthHeader(proxyUrl);
  if (proxyAuth) {
    headers['proxy-authorization'] = proxyAuth;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStarted = false;
    let deadline = null;
    const request = http.request({
      hostname: proxyUrl.hostname,
      port: proxyPort(proxyUrl),
      method: 'GET',
      path: target.toString(),
      headers,
    }, (response) => {
      responseStarted = true;
      responsePayload(response, urlValue).then(finish, fail);
    });
    const cleanup = () => {
      if (deadline) {
        clearTimeout(deadline);
        deadline = null;
      }
      request.off('error', onError);
      request.off('close', onClose);
      request.setTimeout(0);
    };
    const finish = (response) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(response);
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      request.once('error', () => {});
      request.destroy();
      reject(error);
    };
    const onTimeout = () => fail(reasonedError(`Static fetch timed out after ${options.fetchTimeoutMs}ms through proxy.`, 'static-fetch-proxy-timeout'));
    const onError = (error) => fail(error);
    const onClose = () => {
      if (!responseStarted) {
        fail(reasonedError(`Static fetch proxy connection closed before response for ${urlValue}.`, 'static-fetch-proxy-network-failed'));
      }
    };
    deadline = setTimeout(onTimeout, Math.max(1, Number(options.fetchTimeoutMs ?? 10000)));
    request.setTimeout(options.fetchTimeoutMs, onTimeout);
    request.once('error', onError);
    request.once('close', onClose);
    request.end();
  });
}

function requestHttpsViaHttpProxy(urlValue, proxyUrl, options = /** @type {any} */ ({})) {
  const target = new URL(urlValue);
  const targetPort = target.port || '443';
  const connectHeaders = {
    host: `${target.hostname}:${targetPort}`,
  };
  const proxyAuth = proxyAuthHeader(proxyUrl);
  if (proxyAuth) {
    connectHeaders['proxy-authorization'] = proxyAuth;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let connected = false;
    let deadline = null;
    const connectRequest = http.request({
      hostname: proxyUrl.hostname,
      port: proxyPort(proxyUrl),
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers: connectHeaders,
    });
    const cleanup = () => {
      if (deadline) {
        clearTimeout(deadline);
        deadline = null;
      }
      connectRequest.off('connect', onConnect);
      connectRequest.off('error', onError);
      connectRequest.off('close', onClose);
      connectRequest.setTimeout(0);
    };
    const finish = (response) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(response);
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      connectRequest.once('error', () => {});
      connectRequest.destroy();
      reject(error);
    };
    const onTimeout = () => fail(reasonedError(`Static fetch CONNECT timed out after ${options.fetchTimeoutMs}ms.`, 'static-fetch-proxy-timeout'));
    const onError = (error) => fail(error);
    const onClose = () => {
      if (!connected) {
        fail(reasonedError(`Static fetch proxy CONNECT closed before response for ${target.hostname}:${targetPort}.`, 'static-fetch-proxy-network-failed'));
      }
    };
    const onConnect = (connectResponse, socket) => {
      connected = true;
      cleanup();
      if ((connectResponse.statusCode ?? 0) < 200 || (connectResponse.statusCode ?? 0) >= 300) {
        socket.destroy();
        fail(reasonedError(
          `Static fetch proxy CONNECT failed for ${target.hostname}:${targetPort}: HTTP ${connectResponse.statusCode ?? 0}`,
          'static-fetch-proxy-connect-failed',
          { statusCode: connectResponse.statusCode ?? 0 },
        ));
        return;
      }
      rawHttpGetOverSocket(target, socket, options).then(finish, fail);
    };
    deadline = setTimeout(onTimeout, Math.max(1, Number(options.fetchTimeoutMs ?? 10000)));
    connectRequest.setTimeout(options.fetchTimeoutMs, onTimeout);
    connectRequest.once('connect', onConnect);
    connectRequest.once('error', onError);
    connectRequest.once('close', onClose);
    connectRequest.end();
  });
}

async function readLiveUrlViaProxy(urlValue, proxyUrl, options = /** @type {any} */ ({}), redirectCount = 0) {
  const target = new URL(urlValue);
  const requestPromise = proxyUrl.protocol === 'socks5:'
    ? requestViaSocksProxy(urlValue, proxyUrl, options)
    : target.protocol === 'http:'
      ? requestHttpViaProxy(urlValue, proxyUrl, options)
      : target.protocol === 'https:'
        ? requestHttpsViaHttpProxy(urlValue, proxyUrl, options)
        : Promise.resolve(null);
  const response = await withProxyDeadline(
    requestPromise,
    options.fetchTimeoutMs,
    `Static fetch timed out after ${options.fetchTimeoutMs}ms through proxy ${redactProxyUrl(proxyUrl)}.`,
  );
  if (!response) {
    throw reasonedError(`Unsupported static fetch target protocol: ${target.protocol}`, 'static-fetch-protocol-unsupported');
  }
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
    if (redirectCount >= MAX_PROXY_REDIRECTS) {
      throw reasonedError(`Static fetch exceeded ${MAX_PROXY_REDIRECTS} redirects for ${urlValue}.`, 'static-fetch-redirect-limit');
    }
    return await readLiveUrlViaProxy(new URL(response.headers.location, urlValue).toString(), proxyUrl, options, redirectCount + 1);
  }
  return response;
}

function wrapStaticFetchFailure(error, urlValue, proxyUrl = null) {
  if (error?.code && String(error.code).startsWith('static-fetch-')) {
    if (!error.reasonCode) {
      error.reasonCode = error.code;
    }
    return error;
  }
  const message = error?.name === 'AbortError'
    ? `Static fetch timed out for ${urlValue}.`
    : proxyUrl
      ? `Static fetch failed for ${urlValue} through proxy ${redactProxyUrl(proxyUrl)}: ${error?.message ?? String(error)}`
      : `Static fetch failed for ${urlValue}: ${error?.message ?? String(error)}`;
  return reasonedError(
    message,
    error?.name === 'AbortError'
      ? 'static-fetch-timeout'
      : proxyUrl
        ? 'static-fetch-proxy-network-failed'
        : 'static-fetch-network-failed',
  );
}

async function readLiveUrl(urlValue, options = /** @type {any} */ ({})) {
  const timeoutMs = Math.max(1, Number(options.fetchTimeoutMs ?? 10000));
  const proxyUrls = resolveLiveFetchProxies(urlValue, options.env ?? process.env);
  if (proxyUrls.length) {
    let lastError = null;
    for (const proxyUrl of proxyUrls) {
      try {
        const response = await readLiveUrlViaProxy(urlValue, proxyUrl, { fetchTimeoutMs: timeoutMs });
        if (!response.ok) {
          throw reasonedError(`Static fetch failed for ${urlValue}: HTTP ${response.status}`, 'static-fetch-failed', {
            statusCode: response.status,
          });
        }
        return {
          body: response.text,
          sourcePath: response.url,
          fixtureName: null,
          request: requestDiagnostic({ statusCode: response.status, proxyUrl }),
        };
      } catch (error) {
        lastError = error;
      }
    }
    try {
      throw lastError;
    } catch (error) {
      const proxyUrl = proxyUrls.at(-1);
      throw wrapStaticFetchFailure(error, urlValue, proxyUrl);
    }
  }
  if (typeof fetch !== 'function') {
    throw reasonedError('Static live fetch is unavailable in this Node runtime.', 'static-fetch-unavailable');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(urlValue, {
      redirect: 'follow',
      signal: controller.signal,
      headers: STATIC_FETCH_HEADERS,
    });
  } catch (error) {
    throw wrapStaticFetchFailure(error, urlValue);
  } finally {
    clearTimeout(timeout);
  }
      if (!response.ok) {
    const error = /** @type {Error & Record<string, any>} */ (new Error(`Static fetch failed for ${urlValue}: HTTP ${response.status}`));
    error.code = 'static-fetch-failed';
    throw error;
      }
  return {
    body: await response.text(),
    sourcePath: response.url,
    fixtureName: null,
    request: requestDiagnostic({ statusCode: response.status }),
  };
}

export function createBuildSource(inputUrl, options = /** @type {any} */ ({})) {
  const fixture = resolveFixtureForUrl(inputUrl, options);
  let lastLiveReadAt = 0;
  return {
    fixture,
    async read(urlValue) {
      const normalized = normalizeUrl(urlValue);
      if (fixture) {
        return await readFixtureUrl(normalized, fixture);
      }
      const delayMs = Math.max(0, Number(options.fetchDelayMs ?? 100));
      const elapsedMs = Date.now() - lastLiveReadAt;
      if (delayMs > elapsedMs) {
        await new Promise((resolve) => setTimeout(resolve, delayMs - elapsedMs));
      }
      lastLiveReadAt = Date.now();
      return await readLiveUrl(normalized, {
        fetchTimeoutMs: options.fetchTimeoutMs,
        env: options.env,
      });
    },
  };
}
