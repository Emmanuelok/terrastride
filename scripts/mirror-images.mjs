#!/usr/bin/env node
/**
 * Mirror the catalogue photography onto the application's own host.
 *
 * Run with Node 22+: node scripts/mirror-images.mjs
 * Optional: --concurrency=12 --limit=100 --dry-run
 * Re-running resumes completed downloads and retries prior failures. Original
 * catalogue files and their source/provenance URLs are never modified.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = ['data/products.json', 'data/storefront-edit.json'];
const manifestFile = join(root, 'data/image-mirror-manifest.json');
const outputDirectory = join(root, 'public/catalogue-images');
// Explicitly pinned to the host present in this catalogue. Do not turn this into
// an unrestricted proxy or infer a new allowlist from untrusted source records.
const allowedHosts = new Set(['cdn.shopify.com']);
const maxBytes = 20 * 1024 * 1024;
const retries = 3;
const requestTimeoutMs = 45_000;
const args = process.argv.slice(2);
const unknownArgs = args.filter(arg => !/^--(?:concurrency=\d+|limit=\d+|dry-run)$/.test(arg));
if (unknownArgs.length) throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`);
const numericArg = (name, fallback) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const concurrency = Math.min(24, Math.max(1, numericArg('concurrency', 12)));
const limit = numericArg('limit', Infinity);
const dryRun = args.includes('--dry-run');
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const digest = input => createHash('sha256').update(input).digest('hex');

function validateUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || !allowedHosts.has(url.hostname)) {
    throw new Error(`Image URL is outside the pinned HTTP(S) host allowlist: ${url.origin}`);
  }
  return url;
}

function collectImageUrls(value, urls) {
  if (Array.isArray(value)) {
    for (const entry of value) collectImageUrls(entry, urls);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'image' && typeof entry === 'string' && /^https?:\/\//.test(entry)) urls.add(entry);
      else if (key === 'images' && Array.isArray(entry)) {
        for (const image of entry) if (typeof image === 'string' && /^https?:\/\//.test(image)) urls.add(image);
      } else if (entry && typeof entry === 'object') collectImageUrls(entry, urls);
    }
  }
}

function identifyImage(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ['jpg', 'image/jpeg'];
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['png', 'image/png'];
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return ['gif', 'image/gif'];
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return ['webp', 'image/webp'];
  if (buffer.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(buffer.toString('ascii', 8, 40))) return ['avif', 'image/avif'];
  throw new Error('Response is not a supported raster image (JPEG, PNG, GIF, WebP, AVIF)');
}

async function download(originalUrl) {
  let url = validateUrl(originalUrl);
  const controller = new AbortController();
  activeRequests.add(controller);
  const timeout = setTimeout(() => controller.abort(new Error('Image request timed out')), requestTimeoutMs);
  try {
    let response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif', 'User-Agent': 'STRIDE-Catalogue-Migration/1.0' },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) throw new Error('Invalid or excessive image redirects');
      url = validateUrl(new URL(location, url).href);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Image server returned HTTP ${response.status}`);
    }
    const responseContentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(?:jpeg|jpg|png|gif|webp|avif)$/.test(responseContentType)) {
      await response.body?.cancel();
      throw new Error(`Unexpected Content-Type: ${responseContentType || '(missing)'}`);
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
      await response.body?.cancel();
      throw new Error(`Image exceeds ${maxBytes} byte limit`);
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        controller.abort();
        throw new Error(`Image exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const [extension, contentType] = identifyImage(buffer);
    const filename = `${digest(originalUrl)}.${extension}`;
    const destination = join(outputDirectory, filename);
    const temporaryFile = `${destination}.${process.pid}.tmp`;
    await writeFile(temporaryFile, buffer);
    await rename(temporaryFile, destination);
    return { originalUrl, path: `/catalogue-images/${filename}`, bytes, contentType, sha256: digest(buffer) };
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(controller);
  }
}

const urls = new Set();
for (const source of sourceFiles) collectImageUrls(JSON.parse(await readFile(join(root, source), 'utf8')), urls);
for (const url of urls) validateUrl(url);
let previous = {};
try { previous = JSON.parse(await readFile(manifestFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const images = {};
const failures = {};
let resumedBytes = 0;
// Verify each cached asset's size before trusting it, including safe path shape.
for (const url of urls) {
  const saved = previous.images?.[url];
  if (saved && /^\/catalogue-images\/[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/.test(saved.path)) {
    try {
      const info = await stat(join(root, 'public', saved.path));
      if (info.isFile() && info.size === saved.bytes && info.size > 0 && info.size <= maxBytes) {
        images[url] = saved;
        resumedBytes += saved.bytes;
        continue;
      }
    } catch { /* Missing/partial assets are downloaded again. */ }
  }
  if (previous.failures?.[url]) failures[url] = previous.failures[url];
}
const pending = [...urls].filter(url => !images[url]);
const queue = pending.slice(0, limit);
console.log(JSON.stringify({ total: urls.size, resumed: Object.keys(images).length, queued: queue.length, concurrency, resumedBytes, dryRun }));
if (dryRun) process.exit(0);
await mkdir(outputDirectory, { recursive: true });

let interrupted = false;
const activeRequests = new Set();
const interrupt = () => {
  interrupted = true;
  for (const controller of activeRequests) controller.abort(new Error('Migration interrupted'));
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let cursor = 0;
let finished = 0;
let bytes = resumedBytes;
let manifestWrites = Promise.resolve();
function summary() {
  return { total: urls.size, mirrored: Object.keys(images).length, failed: Object.keys(failures).length, pending: urls.size - Object.keys(images).length - Object.keys(failures).length, bytes };
}
function saveManifest() {
  const payload = JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), sourceFiles, allowedHosts: [...allowedHosts], summary: summary(), images, failures }, null, 2) + '\n';
  manifestWrites = manifestWrites.then(async () => {
    const temporaryFile = `${manifestFile}.${process.pid}.tmp`;
    await writeFile(temporaryFile, payload);
    await rename(temporaryFile, manifestFile);
  });
  return manifestWrites;
}

await saveManifest();
const progressTimer = setInterval(() => {
  console.log(JSON.stringify({ ...summary(), finishedThisRun: finished, queuedThisRun: queue.length }));
  void saveManifest().catch(error => { console.error(error); interrupt(); });
}, 15_000);
async function worker() {
  while (!interrupted) {
    const originalUrl = queue[cursor++];
    if (!originalUrl) return;
    let lastError;
    let attempts = 0;
    for (; attempts < retries && !interrupted; attempts++) {
      try {
        const mirrored = await download(originalUrl);
        images[originalUrl] = mirrored;
        bytes += mirrored.bytes;
        delete failures[originalUrl];
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempts < retries - 1 && !interrupted) await sleep(750 * 2 ** attempts);
      }
    }
    if (lastError && !interrupted) {
      failures[originalUrl] = { error: String(lastError.message || lastError), attempts: (previous.failures?.[originalUrl]?.attempts || 0) + attempts, lastAttemptAt: new Date().toISOString() };
    }
    if (!interrupted) finished++;
  }
}
try {
  await Promise.all(Array.from({ length: concurrency }, worker));
} finally {
  clearInterval(progressTimer);
  await saveManifest();
}
console.log(JSON.stringify({ ...summary(), interrupted, manifest: 'data/image-mirror-manifest.json' }));
if (interrupted) process.exitCode = 130;
else if (Object.keys(failures).length) process.exitCode = 1;
