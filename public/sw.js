/* Only explicit, credential-free public assets enter these caches.
 * Navigation HTML, APIs, account data and customer requests never do. */
const VERSION = '__STRIDE_BUILD_ID__';
const CACHE_PREFIX = 'stride-pwa-public-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const IMAGE_CACHE = `${CACHE_PREFIX}images-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const MiB = 1024 * 1024;
const LIMITS = {
  static: {name: STATIC_CACHE, entries: 24, bytes: 8 * MiB, perFile: 3 * MiB},
  image: {name: IMAGE_CACHE, entries: 32, bytes: 24 * MiB, perFile: 2 * MiB},
};
const OFFLINE_ASSETS = [OFFLINE_URL, '/favicon.svg', '/fonts/StrideDisplay-Bold.woff', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'];
const EDITORIAL_IMAGES = new Set(['/images/hero.webp', '/images/hero-sprinter.webp', '/images/strength.webp', '/images/apparel-editorial.webp', '/images/recovery-studio.webp', '/images/nutrition.webp']);
let cacheWrites = Promise.resolve();

function publicResource(url) {
  if (url.origin !== self.location.origin || url.search) return null;
  const pathname = url.pathname;
  if (pathname === OFFLINE_URL) return {kind: 'static', mime: /^text\/html$/, immutable: false};
  if (/^\/catalogue-images\/[a-f0-9]{64}\.(?:jpg|png|gif|webp|avif)$/.test(pathname)) return {kind: 'image', mime: /^image\/(?:jpeg|png|gif|webp|avif)$/, immutable: true};
  if (EDITORIAL_IMAGES.has(pathname) || pathname === '/og/stride-social.png') return {kind: 'image', mime: /^image\/(?:png|webp)$/, immutable: false};
  if (/^\/assets\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(pathname)) return {kind: 'static', mime: /^(?:text\/(?:css|javascript)|application\/javascript)$/, immutable: true};
  if (pathname === '/fonts/StrideDisplay-Bold.woff') return {kind: 'static', mime: /^(?:font\/woff|application\/(?:font-woff|octet-stream))$/, immutable: true};
  if (pathname === '/favicon.svg') return {kind: 'static', mime: /^image\/svg\+xml$/, immutable: false};
  if (/^\/icons\/(?:icon-192|icon-512|maskable-512|apple-touch-icon)\.png$/.test(pathname)) return {kind: 'static', mime: /^image\/png$/, immutable: false};
  return null;
}

function canStore(response, policy) {
  const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return response.status === 200 && !response.redirected && ['basic', 'default'].includes(response.type)
    && policy.mime.test(mime) && !/(?:private|no-store)/i.test(response.headers.get('Cache-Control') || '')
    && !/(?:\*|cookie|authorization)/i.test(response.headers.get('Vary') || '') && !response.headers.has('Set-Cookie');
}

async function boundedBody(response, maximum) {
  if (Number(response.headers.get('Content-Length')) > maximum || !response.body) return null;
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { void reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  if (!length) return null;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function trim(cache, limits) {
  const keys = await cache.keys();
  const sizes = await Promise.all(keys.map(async key => Number((await cache.match(key))?.headers.get('X-Stride-Public-Bytes')) || limits.perFile));
  let bytes = sizes.reduce((total, size) => total + size, 0), count = keys.length;
  for (let i = 0; i < keys.length && (count > limits.entries || bytes > limits.bytes); i++) {
    if (new URL(keys[i].url).pathname === OFFLINE_URL) continue;
    await cache.delete(keys[i]);
    bytes -= sizes[i];
    count--;
  }
}

function remember(request, response, policy) {
  if (!canStore(response, policy)) return Promise.resolve();
  const copy = response.clone(), limits = LIMITS[policy.kind];
  cacheWrites = cacheWrites.catch(() => {}).then(async () => {
    const bytes = await boundedBody(copy, limits.perFile);
    if (!bytes) return;
    const headers = new Headers(copy.headers);
    headers.delete('Content-Encoding');
    headers.set('Content-Length', String(bytes.byteLength));
    headers.set('X-Stride-Public-Bytes', String(bytes.byteLength));
    const cache = await caches.open(limits.name);
    await cache.put(request, new Response(bytes, {status: 200, headers}));
    await trim(cache, limits);
  });
  return cacheWrites;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    for (const asset of OFFLINE_ASSETS) {
      const request = new Request(new URL(asset, self.location.origin), {credentials: 'omit', cache: 'reload', redirect: 'error'});
      const response = await fetch(request), policy = publicResource(new URL(request.url));
      if (!policy || !canStore(response, policy)) throw new Error('Offline asset unavailable');
      await remember(request, response, policy);
    }
    if (!await (await caches.open(STATIC_CACHE)).match(OFFLINE_URL)) throw new Error('Offline page unavailable');
    // An update waits until the customer explicitly chooses Refresh.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, IMAGE_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'STRIDE_SKIP_WAITING' && event.source?.url && new URL(event.source.url).origin === self.location.origin) event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization') || request.headers.has('Range') || request.cache === 'no-store') return;
  if (/^\/(?:api|auth|account|saved|admin|session|login|logout|checkout|cart|bag)(?:\/|$)/.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    const publicPage = /^\/(?:shop|departments|tools|services|help)?\/?$/.test(url.pathname) || /^\/product\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (publicPage) event.respondWith(fetch(request).catch(async () => (await (await caches.open(STATIC_CACHE)).match(OFFLINE_URL)) || new Response('You are offline. Please reconnect and try again.', {status: 503, headers: {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'}})));
    return;
  }

  const policy = publicResource(url);
  if (!policy) return;
  event.respondWith((async () => {
    const cache = await caches.open(LIMITS[policy.kind].name), cached = await cache.match(request);
    if (cached && policy.immutable) return cached;
    try {
      const response = await fetch(new Request(request, {credentials: 'omit', cache: 'no-store', redirect: 'error'}));
      event.waitUntil(remember(request, response, policy).catch(() => {}));
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});
