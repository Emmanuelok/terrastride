import {isAuthConfigured, type AuthEnvironment} from './auth';

export type LaunchEnvironment = AuthEnvironment & {
  ADMIN_EMAILS?: string;
  SUPPORT_EMAIL?: string;
  SITE_URL?: string;
  REQUEST_EMAILS_ENABLED?: string;
};

export const requestStatuses = ['Received', 'In review', 'Awaiting customer', 'Replied', 'Closed'] as const;
export const legacyRequestStatus = 'Saved — awaiting store launch';
export const requestKinds = ['quote', 'service', 'business', 'support', 'return', 'supplier'] as const;

function emailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : null;
}

function siteOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function isAdminEmailAllowed(env: Pick<LaunchEnvironment, 'ADMIN_EMAILS'>, email: string): boolean {
  const normalized = emailAddress(email);
  if (!normalized) return false;
  return (env.ADMIN_EMAILS || '').split(',').some(value => emailAddress(value) === normalized);
}

export function hasAdminConfiguration(env: Pick<LaunchEnvironment, 'ADMIN_EMAILS'>): boolean {
  return (env.ADMIN_EMAILS || '').split(',').some(value => emailAddress(value) !== null);
}

export function areRequestEmailsEnabled(env: LaunchEnvironment): boolean {
  return env.REQUEST_EMAILS_ENABLED === 'true' && isAuthConfigured(env) && hasAdminConfiguration(env);
}

// These are configuration flags, not a database or email delivery health check.
// Never serialize the environment: it also contains credentials and staff addresses.
export function getLaunchReadiness(env: LaunchEnvironment) {
  const authenticationEnabled = isAuthConfigured(env);
  return {
    authenticationEnabled,
    staffInboxEnabled: authenticationEnabled && hasAdminConfiguration(env),
    emailNotificationsEnabled: areRequestEmailsEnabled(env),
    checkoutEnabled: false,
    supportEmail: emailAddress(env.SUPPORT_EMAIL),
    siteUrl: siteOrigin(env.SITE_URL) || siteOrigin(env.AUTH_BASE_URL),
  };
}

export class LaunchHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'Vary': 'Cookie',
  }});
}

export async function readSameOriginJson(req: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  if (req.headers.get('origin') !== new URL(req.url).origin) throw new LaunchHttpError(403, 'Invalid origin.');
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new LaunchHttpError(403, 'Invalid origin.');
  if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new LaunchHttpError(415, 'Send an application/json request.');
  }
  const length = req.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new LaunchHttpError(413, 'Request too large.');
  }
  if (!req.body) throw new LaunchHttpError(400, 'A JSON object is required.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new LaunchHttpError(413, 'Request too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value as Record<string, unknown>;
  } catch { throw new LaunchHttpError(400, 'A valid JSON object is required.'); }
}

export function launchErrorResponse(error: unknown): Response {
  if (error instanceof LaunchHttpError) return privateJson({error: error.message}, error.status);
  // Do not log request bodies, contact details, or session credentials.
  console.error('STRIDE launch operation failed.');
  return privateJson({error: 'The request service is temporarily unavailable. Please retry.'}, 503);
}
