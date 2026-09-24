#!/usr/bin/env node
/**
 * Upload the verified catalogue mirror to the application's Cloudflare R2 bucket.
 *
 * Node 22+: node scripts/sync-images-r2.mjs [--concurrency=16]
 * Requires @aws-sdk/client-s3 and CLOUDFLARE_API_TOKEN with R2 object read/write.
 * The token and derived S3 credentials stay in memory and are never persisted.
 * Local files must match the original snapshot. The pinned CDN may re-encode
 * remote images; same-format renditions retain original and uploaded SHA-256
 * metadata. Re-running verifies that lineage, uploaded size and MIME in R2.
 * No objects are deleted and no local files or manifests are modified.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bucket = 'terrastride-images';
const endpoint = 'https://e24b9546211a6f1a310bf8ac9c411114.r2.cloudflarestorage.com';
const manifestFile = join(root, 'data/image-mirror-manifest.json');
const maxBytes = 20 * 1024 * 1024;
const attempts = 3;
const imageAccept = 'image/avif,image/webp,image/png,image/jpeg,image/gif';
const imageTypes = new Map([
  ['jpg', 'image/jpeg'], ['png', 'image/png'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['avif', 'image/avif'],
]);
const args = process.argv.slice(2);
if (args.some(arg => !/^--concurrency=\d+$/.test(arg)) || args.length > 1) {
  throw new Error('Usage: node scripts/sync-images-r2.mjs [--concurrency=16]');
}
const concurrency = Number(args[0]?.split('=')[1] ?? 16);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
  throw new Error('Concurrency must be an integer between 1 and 64.');
}

const digest = value => createHash('sha256').update(value).digest('hex');
const shutdown = new AbortController();
const interrupt = () => shutdown.abort(new Error('Image sync interrupted.'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const secrets = [];

function safeError(error) {
  // Never print SDK request objects, response bodies, stacks or credentials.
  let message = String(error?.message || 'Unknown error');
  for (const secret of secrets) if (secret) message = message.split(secret).join('[redacted]');
  return message.slice(0, 500);
}

function signal(timeoutMs) {
  return AbortSignal.any([shutdown.signal, AbortSignal.timeout(timeoutMs)]);
}

async function retry(operation) {
  for (let attempt = 1; ; attempt++) {
    shutdown.signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      if (shutdown.signal.aborted || attempt >= attempts) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500)));
    }
  }
}

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com' ||
      url.username || url.password || (url.port && url.port !== '443') || url.hash) {
    throw new Error('Catalogue image URL must use the pinned HTTPS host cdn.shopify.com.');
  }
  return url;
}

function identifyImage(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return 'image/gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(buffer.toString('ascii', 8, 40))) return 'image/avif';
  throw new Error('Content is not a supported raster image.');
}

function validateBytes(buffer, entry) {
  if (buffer.length !== entry.bytes) throw new Error('Image byte size differs from the verified manifest.');
  if (digest(buffer) !== entry.sha256) throw new Error('Image SHA-256 differs from the verified manifest.');
  if (identifyImage(buffer) !== entry.contentType) throw new Error('Image format differs from the verified manifest.');
  return buffer;
}

function validateRendition(buffer, entry) {
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error('Image rendition is empty or exceeds the maximum byte size.');
  if (identifyImage(buffer) !== entry.contentType) throw new Error('Image rendition format differs from the verified manifest.');
  const sha256 = digest(buffer);
  if (buffer.length !== entry.bytes || sha256 !== entry.sha256) {
    console.log(JSON.stringify({ event: 'cdn-rendition-drift', key: entry.key,
      expectedBytes: entry.bytes, actualBytes: buffer.length,
      expectedSha256: entry.sha256, actualSha256: sha256 }));
  }
  return buffer;
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (!manifest.images || Array.isArray(manifest.images) || typeof manifest.images !== 'object') {
    throw new Error('The image mirror manifest has no valid images mapping.');
  }
  const entries = Object.entries(manifest.images);
  const summary = manifest.summary;
  if (!entries.length || !summary || !Number.isInteger(summary.total) ||
      summary.total !== entries.length || summary.mirrored !== entries.length ||
      summary.failed !== 0 || summary.pending !== 0 ||
      Object.keys(manifest.failures || {}).length !== 0) {
    throw new Error('Image mirror manifest is incomplete. Finish mirror-images.mjs before deploying.');
  }
  const keys = new Set();
  return entries.map(([originalUrl, entry]) => {
    validateUrl(originalUrl);
    const match = typeof entry?.path === 'string' &&
      entry.path.match(/^\/catalogue-images\/([a-f0-9]{64})\.(jpg|png|gif|webp|avif)$/);
    if (!match || match[1] !== digest(originalUrl) ||
        !Number.isInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > maxBytes ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        imageTypes.get(match[2]) !== entry.contentType ||
        (entry.originalUrl !== undefined && entry.originalUrl !== originalUrl)) {
      throw new Error('Invalid image manifest entry; path, size, SHA-256 and MIME must match the mirror format.');
    }
    const key = entry.path.slice(1);
    if (keys.has(key)) throw new Error('Image manifest contains a duplicate destination key.');
    keys.add(key);
    return { ...entry, originalUrl, key };
  });
}

async function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required with R2 object read/write permissions.');
  secrets.push(token);
  // https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token
  const verificationUrls = [
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    'https://api.cloudflare.com/client/v4/accounts/e24b9546211a6f1a310bf8ac9c411114/tokens/verify',
  ];
  const accessKeyId = await retry(async () => {
    for (const [index, verificationUrl] of verificationUrls.entries()) {
      const response = await fetch(verificationUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: signal(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Account-owned tokens are verified through the account endpoint.
        if (index === 0 && response.status >= 400 && response.status < 500) continue;
        throw new Error(`Cloudflare token verification returned HTTP ${response.status}.`);
      }
      const data = await response.json();
      if (!data.success || data.result?.status !== 'active' ||
          !/^[a-f0-9]{32}$/i.test(data.result?.id || '')) {
        throw new Error('Cloudflare did not return an active token ID.');
      }
      return data.result.id;
    }
    throw new Error('Cloudflare could not verify the token through either endpoint.');
  });
  const secretAccessKey = digest(token);
  secrets.push(accessKeyId, secretAccessKey);
  return { accessKeyId, secretAccessKey };
}

async function listExisting(client) {
  const sizes = new Map();
  let continuationToken;
  do {
    const page = await retry(() => client.send(new ListObjectsV2Command({
      Bucket: bucket, MaxKeys: 1000, ContinuationToken: continuationToken,
    }), { abortSignal: signal(60_000) }));
    for (const object of page.Contents || []) {
      if (typeof object.Key === 'string' && Number.isInteger(object.Size)) sizes.set(object.Key, object.Size);
    }
    if (!page.IsTruncated) break;
    if (!page.NextContinuationToken || page.NextContinuationToken === continuationToken) {
      throw new Error('R2 returned an invalid object-list continuation token.');
    }
    continuationToken = page.NextContinuationToken;
  } while (true);
  return sizes;
}

async function matchesExisting(client, entry, sizes) {
  const listedBytes = sizes.get(entry.key);
  if (!Number.isInteger(listedBytes) || listedBytes <= 0 || listedBytes > maxBytes) return false;
  const head = await retry(async () => {
    try {
      return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: entry.key }), {
        abortSignal: signal(60_000),
      });
    } catch (error) {
      // An object can disappear after listing; upload it again in that case.
      if (error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  });
  if (!head || head.ContentLength !== listedBytes || head.ContentType !== entry.contentType) return false;
  const metadata = head.Metadata || {};
  if (Object.hasOwn(metadata, 'manifest-sha256')) {
    return metadata['manifest-sha256'] === entry.sha256 &&
      /^[a-f0-9]{64}$/.test(metadata.sha256 || '') &&
      metadata.bytes === String(listedBytes) &&
      typeof metadata['retrieved-at'] === 'string' &&
      Number.isFinite(Date.parse(metadata['retrieved-at']));
  }
  // Existing uploads made before rendition lineage was introduced are valid
  // only when they match the original snapshot exactly.
  return head.ContentLength === entry.bytes && metadata.sha256 === entry.sha256;
}

async function download(entry) {
  let url = validateUrl(entry.originalUrl);
  const requestSignal = signal(45_000);
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetch(url, {
      redirect: 'manual', signal: requestSignal,
      headers: { Accept: imageAccept, 'User-Agent': 'STRIDE-Catalogue-Migration/1.0' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 5) throw new Error('Invalid or excessive image redirects.');
    url = validateUrl(new URL(location, url).href);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Image source returned HTTP ${response.status}.`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(?:jpeg|jpg|png|gif|webp|avif)$/.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Image source returned an unsupported Content-Type.');
  }
  if ((contentType === 'image/jpg' ? 'image/jpeg' : contentType) !== entry.contentType) {
    await response.body?.cancel();
    throw new Error('Image source Content-Type differs from the verified manifest.');
  }
  if (Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Image source exceeds the maximum byte size.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('Image source exceeds the maximum byte size.');
    chunks.push(chunk);
  }
  return validateRendition(Buffer.concat(chunks), entry);
}

async function imageBytes(entry) {
  const file = join(root, 'public', entry.key);
  let info;
  try { info = await lstat(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return download(entry);
  }
  if (!info.isFile() || info.size !== entry.bytes) throw new Error('Local image is not a regular file of the verified size.');
  return validateBytes(await readFile(file), entry);
}

async function main() {
  const entries = await readManifest();
  const client = new S3Client({
    endpoint, region: 'auto', forcePathStyle: true,
    credentials: await credentials(), maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try {
    const sizes = await listExisting(client);
    const queue = entries;
    let skipped = 0;
    let cursor = 0;
    let uploaded = 0;
    let uploadedBytes = 0;
    const failures = [];
    const progress = () => ({ bucket, total: entries.length, existingListed: sizes.size, skipped,
      uploaded, failed: failures.length, remaining: queue.length - skipped - uploaded - failures.length,
      uploadedBytes, concurrency });
    console.log(JSON.stringify(progress()));
    const progressTimer = setInterval(() => console.log(JSON.stringify(progress())), 15_000);
    async function worker() {
      while (!shutdown.signal.aborted) {
        const entry = queue[cursor++];
        if (!entry) return;
        try {
          // The same bounded pool handles HEAD checks and uploads, so a resumed
          // deployment verifies thousands of objects without serial HEAD calls.
          if (await matchesExisting(client, entry, sizes)) {
            skipped++;
            continue;
          }
          const actualBytes = await retry(async () => {
            const body = await imageBytes(entry);
            await client.send(new PutObjectCommand({
              Bucket: bucket, Key: entry.key, Body: body, ContentLength: body.length,
              ContentType: entry.contentType, CacheControl: 'public, max-age=31536000, immutable',
              Metadata: { 'manifest-sha256': entry.sha256, sha256: digest(body),
                bytes: String(body.length), 'retrieved-at': new Date().toISOString() },
            }), { abortSignal: signal(60_000) });
            return body.length;
          });
          uploaded++;
          uploadedBytes += actualBytes;
        } catch (error) {
          if (shutdown.signal.aborted) return;
          failures.push(entry.key);
          console.error(JSON.stringify({ key: entry.key, error: safeError(error) }));
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    } finally {
      clearInterval(progressTimer);
      console.log(JSON.stringify({ ...progress(), interrupted: shutdown.signal.aborted }));
    }
    if (shutdown.signal.aborted) process.exitCode = 130;
    else if (failures.length) process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

try { await main(); }
catch (error) {
  console.error(`R2 image sync failed: ${safeError(error)}`);
  process.exitCode = shutdown.signal.aborted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
