import { env } from 'cloudflare:workers';
import { byId } from '@/lib/catalogue';
import {
  authJson, clearGuestCookie, consumeThrottle, getAuthSession, guestCookie, guestId,
  isAuthConfigured, readJsonBody, RequestError, validWriteOrigin,
  type AuthSession,
} from '@/lib/auth';
import { hasAdminConfiguration, type LaunchEnvironment } from '@/lib/launch';

function bindings() { return env as unknown as LaunchEnvironment; }
function db() {
  const database = bindings().DB;
  if (!database) throw new Error('Storage unavailable');
  return database;
}

type Identity = { owner: string; cookie: string; session: AuthSession | null };
async function identity(req: Request): Promise<Identity> {
  const session = await getAuthSession(req, bindings());
  const oldGuest = guestId(req);
  if (session) return { owner: `user:${session.user.id}`, cookie: oldGuest ? clearGuestCookie(req) : '', session };
  // A token that has already moved into an account must never regain access to
  // that account, even when somebody replays it after sign-out.
  const claimed = oldGuest && await db().prepare('SELECT guest FROM auth_guest_claims WHERE guest=?').bind(oldGuest).first();
  const id = oldGuest && !claimed ? oldGuest : crypto.randomUUID();
  return { owner: `guest:${id}`, cookie: id === oldGuest ? '' : guestCookie(req, id), session: null };
}
function out(data: unknown, cookie = '', status = 200) {
  return authJson(data, status, cookie ? { 'Set-Cookie': cookie, Vary: 'Cookie' } : { Vary: 'Cookie' });
}
function fields(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, max = 300) { return String(value ?? '').slice(0, max); }
function errorResponse(error: unknown, cookie = '') {
  if (error instanceof RequestError) return out({ error: error.message }, cookie, error.status);
  console.error('STRIDE shopping storage request failed');
  return out({ error: 'Saved shopping information is temporarily unavailable. Please retry.' }, cookie, 503);
}

export async function GET(req: Request) {
  let cookie = '';
  try {
    const current = await identity(req);
    cookie = current.cookie;
    const { owner, session } = current;
    const result = await db().batch<Record<string, unknown>>([
      db().prepare('SELECT product,quantity FROM basket WHERE owner=?').bind(owner),
      db().prepare('SELECT product FROM saved WHERE owner=?').bind(owner),
      db().prepare('SELECT data FROM profiles WHERE owner=?').bind(owner),
      db().prepare('SELECT * FROM requests WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner),
      db().prepare('SELECT * FROM plans WHERE owner=? ORDER BY created DESC LIMIT 50').bind(owner),
      db().prepare(`SELECT m.id,m.request_id,m.author_role,m.body,m.created FROM request_messages m
        JOIN requests r ON r.id=m.request_id WHERE r.owner=? AND r.id IN
        (SELECT id FROM requests WHERE owner=? ORDER BY created DESC LIMIT 100)
        ORDER BY m.created DESC LIMIT 500`).bind(owner, owner),
    ]);
    const messages = new Map<string, { id: unknown; authorRole: unknown; body: unknown; created: unknown }[]>();
    for (const message of [...result[5].results].reverse()) {
      const key = String(message.request_id);
      const thread = messages.get(key) || [];
      thread.push({ id: message.id, authorRole: message.author_role, body: message.body, created: message.created });
      messages.set(key, thread);
    }
    return out({
      cart: result[0].results.map(item => ({ ...item, item: byId.get(String(item.product)) })),
      saved: result[1].results.map(item => item.product),
      profile: result[2].results[0] ? JSON.parse(String(result[2].results[0].data)) : {},
      requests: result[3].results.map(item => ({ ...item, data: JSON.parse(String(item.data)), messages: messages.get(String(item.id)) || [] })),
      plans: result[4].results.map(item => ({ ...item, data: JSON.parse(String(item.data)) })),
      email: session?.user.email || null,
      user: session?.user || null,
      auth: { enabled: isAuthConfigured(bindings()) },
    }, cookie);
  } catch (error) { return errorResponse(error, cookie); }
}

export async function POST(req: Request) {
  let cookie = '';
  try {
    if (!validWriteOrigin(req)) return out({ error: 'Invalid origin.' }, '', 403);
    const body = await readJsonBody(req);
    const current = await identity(req);
    const { owner } = current;
    cookie = current.cookie;
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    if (!await consumeThrottle(bindings(), `store-owner:${owner}`, 120, 60) ||
        !await consumeThrottle(bindings(), `store-ip:${ip}`, 300, 60)) {
      return out({ error: 'Too many changes. Please wait a minute and retry.' }, cookie, 429);
    }
    const action = body.action;
    if (action === 'cart') {
      if (typeof body.product !== 'string' || !byId.has(body.product) || !Number.isInteger(body.quantity) ||
          Number(body.quantity) < 0 || Number(body.quantity) > 50) return out({ error: 'Select a product and quantity from 1 to 50.' }, cookie, 400);
      if (body.quantity === 0) await db().prepare('DELETE FROM basket WHERE owner=? AND product=?').bind(owner, body.product).run();
      else await db().prepare('INSERT INTO basket(owner,product,quantity) VALUES(?,?,?) ON CONFLICT(owner,product) DO UPDATE SET quantity=excluded.quantity')
        .bind(owner, body.product, body.quantity).run();
    } else if (action === 'save') {
      if (typeof body.product !== 'string' || !byId.has(body.product) || typeof body.value !== 'boolean') return out({ error: 'Product not found.' }, cookie, 400);
      if (body.value) await db().prepare('INSERT OR IGNORE INTO saved(owner,product) VALUES(?,?)').bind(owner, body.product).run();
      else await db().prepare('DELETE FROM saved WHERE owner=? AND product=?').bind(owner, body.product).run();
    } else if (action === 'profile') {
      const profile = fields(body.profile);
      const data = Object.fromEntries(['name', 'email', 'phone', 'city', 'address', 'digitalAddress'].map(key => [key, text(profile[key])]));
      // Contact fields remain editable; account identity always comes from auth.
      await db().prepare('INSERT INTO profiles(owner,data) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data')
        .bind(owner, JSON.stringify(data)).run();
    } else if (action === 'plan') {
      if (typeof body.name !== 'string' || !body.name.trim() || !Array.isArray(body.items) || body.items.length > 60 ||
          body.items.some(value => typeof value !== 'string' || value.length > 1000)) return out({ error: 'Add a plan name and up to 60 entries.' }, cookie, 400);
      const id = `PL-${crypto.randomUUID()}`;
      await db().prepare('INSERT INTO plans(id,owner,name,data,created) VALUES(?,?,?,?,?)')
        .bind(id, owner, text(body.name, 120), JSON.stringify({ type: text(body.type || 'workout', 40), items: body.items }), new Date().toISOString()).run();
      return out({ ok: true, id }, cookie);
    } else if (action === 'delete-plan') {
      await db().prepare('DELETE FROM plans WHERE id=? AND owner=?').bind(text(body.id, 100), owner).run();
    } else if (action === 'request') {
      if (typeof body.kind !== 'string' || !['quote', 'service', 'business', 'support', 'return', 'supplier'].includes(body.kind)) return out({ error: 'Invalid request type.' }, cookie, 400);
      if (!await consumeThrottle(bindings(), `request-owner:${owner}`, 10, 3600) ||
          !await consumeThrottle(bindings(), `request-ip:${ip}`, 30, 3600)) return out({ error: 'Too many requests. Please try again later.' }, cookie, 429);
      const form = fields(body.form);
      if (!text(form.name).trim() || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text(form.email))) return out({ error: 'Enter your name and a valid email.' }, cookie, 400);
      const data: Record<string, unknown> = Object.fromEntries(['name', 'email', 'phone', 'city', 'address', 'digitalAddress', 'message', 'service', 'paymentPreference']
        .map(key => [key, text(form[key], key === 'message' ? 3000 : 300)]));
      if (body.kind === 'quote') {
        const basket = await db().prepare('SELECT product,quantity FROM basket WHERE owner=?').bind(owner).all();
        const items = basket.results.flatMap(item => {
          const product = byId.get(String(item.product));
          return product ? [{ id: product.id, name: product.name, quantity: Number(item.quantity), guidePrice: product.priceGHS }] : [];
        });
        if (!items.length) return out({ error: 'Your bag is empty.' }, cookie, 400);
        data.items = items;
        data.total = items.reduce((sum, item) => sum + (item.guidePrice || 0) * item.quantity, 0);
        data.priceType = 'Planning estimate; not a selling price';
        data.paymentStatus = 'No payment taken';
      }
      const key = String(body.idempotencyKey || '');
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)) return out({ error: 'Refresh the form and try again.' }, cookie, 400);
      const id = `ST-${key}`;
      const status = isAuthConfigured(bindings()) && hasAdminConfiguration(bindings()) ? 'Received' : 'Saved — awaiting store launch';
      const created = new Date().toISOString();
      await db().batch([
        db().prepare('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
          .bind(id, owner, body.kind, JSON.stringify(data), status, created),
        db().prepare(`INSERT INTO notifications_outbox(id,request_id,kind,payload,available_at,created)
          SELECT ?,id,'request-received','{}',?,? FROM requests WHERE id=? AND owner=?
          ON CONFLICT(id) DO NOTHING`).bind(`NT-REQUEST-${id}`, created, created, id, owner),
      ]);
      if (!await db().prepare('SELECT id FROM requests WHERE id=? AND owner=?').bind(id, owner).first()) return out({ error: 'Please reopen the form to create a new request.' }, cookie, 409);
      return out({ ok: true, id }, cookie);
    } else return out({ error: 'Unknown action.' }, cookie, 400);
    return out({ ok: true }, cookie);
  } catch (error) { return errorResponse(error, cookie); }
}
