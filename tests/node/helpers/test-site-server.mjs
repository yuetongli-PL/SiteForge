import { createServer } from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

export function testHtmlPage(title, body = '') {
  return `<!doctype html>
<html><head><title>${title}</title></head><body>${body}</body></html>`;
}

export function testSitemapXml(rootUrl, paths = ['/']) {
  const urls = paths.map((item) => {
    const loc = new URL(item, rootUrl).toString();
    return `  <url><loc>${loc}</loc></url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function testRobotsTxt(rootUrl, { allow = '/', disallow = null, sitemap = true } = {}) {
  return [
    'User-agent: *',
    disallow ? `Disallow: ${disallow}` : `Allow: ${allow}`,
    sitemap ? `Sitemap: ${new URL('/sitemap.xml', rootUrl)}` : null,
    '',
  ].filter((line) => line !== null).join('\n');
}

function normalizeRoutePath(value) {
  const path = String(value || '/').split('?')[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function routeCandidates(pathname) {
  const normalized = normalizeRoutePath(pathname);
  const candidates = [normalized];
  if (normalized !== '/' && normalized.endsWith('/')) {
    candidates.push(normalized.slice(0, -1));
  }
  if (!normalized.endsWith('/')) {
    candidates.push(`${normalized}/`);
  }
  return [...new Set(candidates)];
}

function responseForRoute(routes, pathname) {
  for (const candidate of routeCandidates(pathname)) {
    if (Object.prototype.hasOwnProperty.call(routes, candidate)) {
      const route = routes[candidate];
      return typeof route === 'string' ? { body: route } : route;
    }
  }
  return null;
}

export async function withTestSite(routesOrFactory, callback) {
  let routes = {};
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const route = responseForRoute(routes, path);
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const status = route.status ?? 200;
    const headers = {
      'content-type': route.contentType ?? 'text/html; charset=utf-8',
      ...(route.headers ?? {}),
    };
    response.writeHead(status, headers);
    response.end(route.body ?? '');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address();
  const rootUrl = `http://127.0.0.1:${port}/`;
  routes = typeof routesOrFactory === 'function' ? routesOrFactory(rootUrl) : routesOrFactory;
  try {
    return await callback(rootUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readRouteFile(rootDir, pathname) {
  const normalizedPath = decodeURIComponent(normalizeRoutePath(pathname));
  if (/(?:^|\/)\.\.(?:\/|$)/u.test(normalizedPath)) {
    return null;
  }
  const segments = normalizedPath.replace(/^\/+|\/+$/gu, '').split('/').filter(Boolean);
  const candidates = segments.length
    ? [
        path.join(rootDir, ...segments),
        path.join(rootDir, ...segments.slice(0, -1), `${segments.at(-1)}.html`),
        path.join(rootDir, ...segments, 'index.html'),
      ]
    : [path.join(rootDir, 'index.html')];
  if (normalizedPath === '/robots.txt' || normalizedPath === '/sitemap.xml') {
    candidates.unshift(path.join(rootDir, path.basename(normalizedPath)));
  }
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) {
        return await readFile(candidate, 'utf8');
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function withDirectorySite(rootDir, callback) {
  let rootUrl = 'http://127.0.0.1/';
  const server = createServer(async (request, response) => {
    const requestPath = new URL(request.url ?? '/', rootUrl).pathname;
    const body = await readRouteFile(rootDir, requestPath);
    if (body === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const contentType = requestPath.endsWith('.xml')
      ? 'application/xml; charset=utf-8'
      : requestPath.endsWith('.txt')
        ? 'text/plain; charset=utf-8'
        : 'text/html; charset=utf-8';
    response.writeHead(200, { 'content-type': contentType });
    response.end(body
      .replaceAll('https://fixture.test/', rootUrl)
      .replace(/https:\/\/[a-z0-9.-]+\.local\//gu, rootUrl));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address();
  rootUrl = `http://127.0.0.1:${port}/`;
  try {
    return await callback(rootUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

export function simpleShopRoutes(rootUrl) {
  return {
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: testRobotsTxt(rootUrl),
    },
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: testSitemapXml(rootUrl, ['/', '/products.html', '/search.html', '/product-1.html', '/contact.html']),
    },
    '/': testHtmlPage('Simple Shop', `
      <main>
        <h1>Simple Shop</h1>
        <p>Simple Shop sells deterministic public products for SiteForge tests.</p>
        <nav>
          <a href="/products.html">Products</a>
          <a href="/search.html">Search</a>
          <a href="/product-1.html">Wireless headphones</a>
          <a href="/contact.html">Contact support</a>
        </nav>
        <form method="GET" action="/search.html" role="search" aria-label="Search products">
          <input name="q" type="search" placeholder="wireless headphones">
          <button type="submit">Search</button>
        </form>
      </main>
    `),
    '/products.html': testHtmlPage('Products', `
      <main>
        <h1>Products</h1>
        <p>Browse public product catalog.</p>
        <a href="/product-1.html">Wireless headphones</a>
      </main>
    `),
    '/search.html': testHtmlPage('Search Products', `
      <main>
        <h1>Search products</h1>
        <form method="GET" action="/search.html" role="search" aria-label="Search products">
          <input name="q" type="search" placeholder="wireless headphones">
          <button type="submit">Search</button>
        </form>
      </main>
    `),
    '/product-1.html': testHtmlPage('Wireless headphones', `
      <main>
        <h1>Wireless headphones</h1>
        <p>Noise-canceling audio product detail page.</p>
      </main>
    `),
    '/contact.html': testHtmlPage('Contact support', `
      <main>
        <h1>Contact support</h1>
        <p>Support contact form for dry-run confirmation coverage.</p>
        <form method="POST" action="/support/message" aria-label="Contact support">
          <input name="email" type="email" placeholder="Email">
          <textarea name="message">Need help</textarea>
          <button type="submit">Send message</button>
        </form>
      </main>
    `),
  };
}

export function tencentNewsRoutes(rootUrl) {
  return {
    '/robots.txt': {
      contentType: 'text/plain; charset=utf-8',
      body: [
        'User-agent: *',
        'Disallow: /answer/',
        'Disallow: /qqfile/',
        'Disallow: /sv1/',
        'Allow: /',
        `Sitemap: ${new URL('/sitemap.xml', rootUrl)}`,
        '',
      ].join('\n'),
    },
    '/sitemap.xml': {
      contentType: 'application/xml; charset=utf-8',
      body: testSitemapXml(rootUrl, [
        '/',
        '/ch/world.html',
        '/omn/20260516/20260516A001.html',
        '/qqfile/private.html',
        '/sv1/internal.html',
        '/answer/comment.html',
      ]),
    },
    '/': testHtmlPage('Tencent News', `
      <main>
        <h1>Tencent News</h1>
        <p>Public news homepage with channel and article links.</p>
        <a href="/ch/world.html">World News</a>
        <a href="/omn/20260516/20260516A001.html">Public article detail</a>
        <a href="/qqfile/private.html">Blocked private file</a>
        <a href="/sv1/internal.html">Blocked internal service</a>
        <a href="/answer/comment.html">Blocked comment area</a>
      </main>
    `),
    '/ch/world.html': testHtmlPage('World News', `
      <main>
        <h1>World News</h1>
        <p>Public channel listing with public articles.</p>
        <a href="/omn/20260516/20260516A001.html">Public article detail</a>
      </main>
    `),
    '/omn/20260516/20260516A001.html': testHtmlPage('Public article detail', `
      <article>
        <h1>Public article detail</h1>
        <p>Read-only public article detail page.</p>
      </article>
    `),
  };
}
