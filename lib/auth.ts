import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';

export type AuthEnvironment = {
  DB: D1Database;
  EMAIL?: { send(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  AUTH_FROM?: string;
};

export type AuthSession = {
  user: { id: string; email: string; emailVerified: boolean; name: string };
  session: { id: string; userId: string; expiresAt: Date };
};

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const GUEST_PATTERN = /(?:^|;\s*)stride_session=([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?:;|$)/;
const AUTH_PATHS = new Map([
  ['/email-otp/send-verification-otp', 'POST'],
  ['/sign-in/email-otp', 'POST'],
  ['/get-session', 'GET'],
  ['/sign-out', 'POST'],
  ['/list-sessions', 'GET'],
  ['/revoke-session', 'POST'],
  ['/revoke-other-sessions', 'POST'],
  ['/revoke-sessions', 'POST'],
]);

export function isAuthConfigured(env: AuthEnvironment): boolean {
  if (!env.DB || !env.EMAIL?.send || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32 ||
      !env.AUTH_FROM || env.AUTH_FROM.length > 254 || !EMAIL_PATTERN.test(env.AUTH_FROM)) return false;
  try {
    const url = new URL(env.AUTH_BASE_URL || '');
    return url.protocol === 'https:' && url.origin === env.AUTH_BASE_URL && !url.username && !url.password;
  } catch { return false; }
}

function createAuth(env: AuthEnvironment, delivery?: { failed: boolean }) {
  return betterAuth({
    appName: 'STRIDE',
    database: env.DB,
    secret: env.AUTH_SECRET!,
    baseURL: env.AUTH_BASE_URL!,
    basePath: '/api/auth',
    trustedOrigins: [env.AUTH_BASE_URL!],
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 300, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: 'stride-auth',
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    telemetry: { enabled: false },
    logger: { disabled: true },
    plugins: [emailOTP({
      otpLength: 8,
      expiresIn: 300,
      allowedAttempts: 3,
      storeOTP: 'hashed',
      resendStrategy: 'rotate',
      rateLimit: { window: 60, max: 5 },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') throw new Error('Unsupported authentication email');
        // All valid addresses take the same send path, regardless of whether an
        // account exists. Await provider acceptance so failures are not success.
        try {
          await env.EMAIL!.send({
            from: env.AUTH_FROM!, to: email,
            subject: 'Your STRIDE sign-in code',
            text: `Your STRIDE sign-in code is ${otp}. It expires in 5 minutes and can be used once. If you did not request this code, you can ignore this email.`,
          });
        } catch (error) {
          // Better Auth deliberately catches mail callback failures. Track the
          // result within this request so our handler can report unavailability.
          if (delivery) delivery.failed = true;
          throw error;
        }
      },
    })],
  });
}

export async function getAuthSession(req: Request, env: AuthEnvironment): Promise<AuthSession | null> {
  if (!isAuthConfigured(env)) return null;
  const result = await createAuth(env).api.getSession({ headers: req.headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!result?.user.emailVerified) return null;
  return {
    user: { id: result.user.id, email: result.user.email, emailVerified: true, name: result.user.name },
    session: { id: result.session.id, userId: result.session.userId, expiresAt: result.session.expiresAt },
  };
}

export function authJson(data: unknown, status = 200, headers?: HeadersInit): Response {
  const response = Response.json(data, { status, headers });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

export function validWriteOrigin(req: Request, expected = new URL(req.url).origin): boolean {
  return req.headers.get('origin') === expected && req.headers.get('sec-fetch-site') !== 'cross-site';
}

/** Bound streaming bodies before JSON parsing, including chunked requests. */
export async function readJsonBody(req: Request, limit = 30_000): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new RequestError(415, 'Send a JSON request.');
  if (Number(req.headers.get('content-length') || 0) > limit) throw new RequestError(413, 'Request too large.');
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError(400, 'Enter the required information.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RequestError(413, 'Request too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new RequestError(400, 'Enter valid request information.'); }
}

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Atomic, shared D1 counters; identifiers are hashed before storage. */
export async function consumeThrottle(env: Pick<AuthEnvironment, 'DB'>, key: string, max: number, seconds: number): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hashedKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const result = await env.DB.prepare(`INSERT INTO auth_throttle(key,count,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN expires<=? THEN 1 ELSE MIN(count+1,?) END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
    RETURNING count`).bind(hashedKey, now + seconds * 1000, now, max + 1, now).first<{ count: number }>();
  return !!result && result.count <= max;
}

export function guestId(req: Request): string | null {
  return req.headers.get('cookie')?.match(GUEST_PATTERN)?.[1] || null;
}

export function guestCookie(req: Request, id: string): string {
  return `stride_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}

export function clearGuestCookie(req: Request): string {
  return `stride_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
}

/** Every migration statement is gated by a unique claim created in this batch. */
export async function mergeGuest(env: Pick<AuthEnvironment, 'DB'>, guest: string, userId: string): Promise<void> {
  const owner = `guest:${guest}`, target = `user:${userId}`, claim = crypto.randomUUID();
  const gate = 'EXISTS(SELECT 1 FROM auth_guest_claims WHERE guest=? AND claim=?)';
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO auth_guest_claims(guest,user_id,claim,created) VALUES(?,?,?,?)').bind(guest, userId, claim, Date.now()),
    env.DB.prepare(`INSERT INTO basket(owner,product,quantity) SELECT ?,product,quantity FROM basket WHERE owner=? AND ${gate}
      ON CONFLICT(owner,product) DO UPDATE SET quantity=MIN(50,basket.quantity+excluded.quantity)`).bind(target, owner, guest, claim),
    env.DB.prepare(`INSERT OR IGNORE INTO saved(owner,product) SELECT ?,product FROM saved WHERE owner=? AND ${gate}`).bind(target, owner, guest, claim),
    env.DB.prepare(`INSERT OR IGNORE INTO profiles(owner,data) SELECT ?,data FROM profiles WHERE owner=? AND ${gate}`).bind(target, owner, guest, claim),
    env.DB.prepare(`UPDATE requests SET owner=? WHERE owner=? AND ${gate}`).bind(target, owner, guest, claim),
    env.DB.prepare(`UPDATE plans SET owner=? WHERE owner=? AND ${gate}`).bind(target, owner, guest, claim),
    ...['basket', 'saved', 'profiles'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE owner=? AND ${gate}`).bind(owner, guest, claim)),
  ]);
}

export async function handleAuthRequest(req: Request, env: AuthEnvironment, _ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  // Keep the Worker handler contract; OTP delivery intentionally completes
  // before the response, so a rejected sender cannot appear successful.
  void _ctx;
  if (!isAuthConfigured(env)) return authJson({ code: 'AUTH_UNAVAILABLE', message: 'Account sign-in is not available yet.' }, 503);
  const url = new URL(req.url), path = url.pathname.slice('/api/auth'.length);
  if (!AUTH_PATHS.has(path)) return authJson({ message: 'Not found.' }, 404);
  if (AUTH_PATHS.get(path) !== req.method) return authJson({ message: 'Method not allowed.' }, 405);
  if (url.origin !== env.AUTH_BASE_URL || (req.method === 'POST' && !validWriteOrigin(req, env.AUTH_BASE_URL))) return authJson({ message: 'Invalid request origin.' }, 403);
  try {
    let request = req;
    if (req.method === 'POST') {
      let body = await readJsonBody(req, 8_192);
      if (path === '/email-otp/send-verification-otp' || path === '/sign-in/email-otp') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (email.length > 254 || !EMAIL_PATTERN.test(email)) return authJson({ message: 'Enter a valid email address.' }, 400);
        if (path === '/email-otp/send-verification-otp') {
          if (body.type !== 'sign-in') return authJson({ message: 'Unsupported sign-in request.' }, 400);
          const limits = await Promise.all([
            consumeThrottle(env, `otp-send-minute:${email}`, 1, 60),
            consumeThrottle(env, `otp-send-hour:${email}`, 5, 3600),
            consumeThrottle(env, `otp-send-ip:${req.headers.get('cf-connecting-ip') || 'unknown'}`, 15, 3600),
          ]);
          if (limits.some(allowed => !allowed)) return authJson({ message: 'Please wait before requesting another code.' }, 429, { 'Retry-After': '60' });
          body = { email, type: 'sign-in' };
        } else {
          if (typeof body.otp !== 'string' || !/^\d{8}$/.test(body.otp)) return authJson({ message: 'Enter the 8-digit code from your email.' }, 400);
          if (!await consumeThrottle(env, `otp-check:${email}`, 10, 300)) return authJson({ message: 'Too many attempts. Request a new code later.' }, 429, { 'Retry-After': '300' });
          body = { email, otp: body.otp };
        }
      }
      const headers = new Headers(req.headers);
      headers.delete('content-length');
      request = new Request(req.url, { method: req.method, headers, body: JSON.stringify(body) });
    }
    const delivery = { failed: false };
    const response = await createAuth(env, delivery).handler(request);
    if (delivery.failed) return authJson({ code: 'AUTH_EMAIL_UNAVAILABLE', message: 'We could not send your sign-in code. Please try again later.' }, 503);
    const result = new Response(response.body, response);
    result.headers.set('Cache-Control', 'no-store');
    result.headers.set('X-Content-Type-Options', 'nosniff');
    if (response.ok && path === '/sign-in/email-otp') {
      // Resolve the newly issued cookie server-side; never accept a user ID or
      // email from a guest as authorization to move another account's data.
      const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const session = await getAuthSession(new Request(req.url, { headers: { cookie: cookies } }), env);
      const guest = guestId(req);
      if (session && guest) await mergeGuest(env, guest, session.user.id);
      result.headers.append('Set-Cookie', clearGuestCookie(req));
    }
    if (response.ok && (path === '/sign-out' || path === '/revoke-sessions')) {
      result.headers.append('Set-Cookie', guestCookie(req, crypto.randomUUID()));
    }
    return result;
  } catch (error) {
    if (error instanceof RequestError) return authJson({ message: error.message }, error.status);
    console.error('Authentication request failed');
    return authJson({ code: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable. Please try again.' }, 503);
  }
}
