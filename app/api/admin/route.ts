import {env} from 'cloudflare:workers';
import {getAuthSession} from '@/lib/auth';
import {
  hasAdminConfiguration, isAdminEmailAllowed, launchErrorResponse, LaunchHttpError,
  legacyRequestStatus, privateJson, readSameOriginJson, requestKinds, requestStatuses,
  type LaunchEnvironment,
} from '@/lib/launch';

type RequestRow = {id: string; kind: string; data: string; status: string; created: string};
type OperationRow = {request_id: string; actor_id: string; action: string; payload_hash: string; applied: number};
const requestIdPattern = /^ST-[a-f0-9-]{36}$/;
const operationKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

async function authorize(req: Request) {
  const runtime = env as unknown as LaunchEnvironment;
  if (!runtime.DB || !hasAdminConfiguration(runtime)) throw new LaunchHttpError(503, 'Staff access is not configured.');
  const session = await getAuthSession(req, runtime);
  if (!session?.user) throw new LaunchHttpError(401, 'Sign in to continue.');
  if (session.user.emailVerified !== true || !isAdminEmailAllowed(runtime, session.user.email)) {
    throw new LaunchHttpError(403, 'Staff access is required.');
  }
  return {db: runtime.DB, user: session.user};
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !requestIdPattern.test(value)) throw new LaunchHttpError(400, 'A valid request reference is required.');
  return value;
}

function requestData(row: RequestRow) {
  return {id: row.id, kind: row.kind, data: JSON.parse(row.data), status: row.status, created: row.created};
}

function readCursor(value: string | null): [string, string] | null {
  if (!value) return null;
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const decoded: unknown = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded[0])
      || !Number.isFinite(Date.parse(decoded[0])) || typeof decoded[1] !== 'string' || !requestIdPattern.test(decoded[1])) throw Error();
    return [decoded[0], decoded[1]];
  } catch { throw new LaunchHttpError(400, 'Invalid page cursor.'); }
}

export async function GET(req: Request) {
  try {
    const {db} = await authorize(req);
    const params = new URL(req.url).searchParams;
    if (params.has('id')) {
      const id = requestId(params.get('id'));
      const row = await db.prepare('SELECT id,kind,data,status,created FROM requests WHERE id=?').bind(id).first<RequestRow>();
      if (!row) throw new LaunchHttpError(404, 'Request not found.');
      const messages = await db.prepare('SELECT id,author_role AS authorRole,body,created FROM request_messages WHERE request_id=? ORDER BY created DESC,id DESC LIMIT 101').bind(id).all();
      return privateJson({request: requestData(row), messages: messages.results.slice(0, 100).reverse(), moreMessages: messages.results.length > 100});
    }
    const rawLimit = params.get('limit') || '20';
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) throw new LaunchHttpError(400, 'Page size must be from 1 to 50.');
    const limit = Number(rawLimit);
    const status = params.get('status');
    const kind = params.get('kind');
    if (status && ![...requestStatuses, legacyRequestStatus].some(value => value === status)) throw new LaunchHttpError(400, 'Invalid request status.');
    if (kind && !requestKinds.some(value => value === kind)) throw new LaunchHttpError(400, 'Invalid request type.');
    const cursor = readCursor(params.get('cursor'));
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (status) { clauses.push('status=?'); values.push(status); }
    if (kind) { clauses.push('kind=?'); values.push(kind); }
    if (cursor) { clauses.push('(created < ? OR (created = ? AND id < ?))'); values.push(cursor[0], cursor[0], cursor[1]); }
    const result = await db.prepare(`SELECT id,kind,data,status,created FROM requests${clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''} ORDER BY created DESC,id DESC LIMIT ?`).bind(...values, limit + 1).all<RequestRow>();
    const rows = result.results.slice(0, limit);
    const last = rows.at(-1);
    const nextCursor = result.results.length > limit && last
      ? btoa(JSON.stringify([last.created, last.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
    return privateJson({requests: rows.map(requestData), nextCursor, statuses: requestStatuses});
  } catch (error) { return launchErrorResponse(error); }
}

export async function POST(req: Request) {
  try {
    const {db, user} = await authorize(req);
    const body = await readSameOriginJson(req);
    const id = requestId(body.id);
    const action = body.action;
    if (action !== 'status' && action !== 'customer-reply') throw new LaunchHttpError(400, 'Invalid staff action.');
    if (typeof body.idempotencyKey !== 'string' || !operationKeyPattern.test(body.idempotencyKey)) throw new LaunchHttpError(400, 'A unique operation key is required.');
    const status = action === 'customer-reply' ? 'Replied' : body.status;
    if (typeof status !== 'string' || !requestStatuses.some(value => value === status)) throw new LaunchHttpError(400, 'Invalid request status.');
    let message = '';
    if (action === 'customer-reply') {
      if (typeof body.message !== 'string') throw new LaunchHttpError(400, 'Enter a reply.');
      message = body.message.trim();
      if (!message || message.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) throw new LaunchHttpError(400, 'Replies must contain 1 to 3,000 characters of text.');
    }
    const operationId = 'OP-' + body.idempotencyKey.toLowerCase();
    const messageId = 'MSG-' + body.idempotencyKey.toLowerCase();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({id, action, status, message})));
    const payloadHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    const existing = await db.prepare('SELECT request_id,actor_id,action,payload_hash,applied FROM request_operations WHERE id=?').bind(operationId).first<OperationRow>();
    const matches = (operation: OperationRow | null) => operation?.request_id === id && operation.actor_id === user.id && operation.action === action && operation.payload_hash === payloadHash;
    if (existing) {
      if (!matches(existing)) throw new LaunchHttpError(409, 'This operation key has already been used. Start a new action.');
      if (existing.applied === 1) return privateJson({ok: true, id, operationId, duplicate: true});
    }
    const request = await db.prepare('SELECT id FROM requests WHERE id=?').bind(id).first();
    if (!request) throw new LaunchHttpError(404, 'Request not found.');
    const created = new Date().toISOString();
    const guard = 'EXISTS (SELECT 1 FROM request_operations WHERE id=? AND request_id=? AND actor_id=? AND payload_hash=? AND applied=0)';
    const guardValues = [operationId, id, user.id, payloadHash];
    const statements = [
      db.prepare('INSERT INTO request_operations(id,request_id,actor_id,action,payload_hash,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(operationId, id, user.id, action, payloadHash, created),
      db.prepare(`UPDATE requests SET status=? WHERE id=? AND ${guard}`).bind(status, id, ...guardValues),
    ];
    if (action === 'customer-reply') {
      statements.push(db.prepare(`INSERT INTO request_messages(id,request_id,author_role,author_id,body,created) SELECT ?,?,'staff',?,?,? WHERE ${guard}`).bind(messageId, id, user.id, message, created, ...guardValues));
    }
    statements.push(
      db.prepare(`INSERT INTO notifications_outbox(id,request_id,message_id,kind,payload,available_at,created) SELECT ?,?,?,?,?,?,? WHERE ${guard}`)
        .bind('NT-' + body.idempotencyKey.toLowerCase(), id, action === 'customer-reply' ? messageId : null, action === 'customer-reply' ? 'request-reply' : 'request-status', JSON.stringify({status}), created, created, ...guardValues),
      db.prepare('UPDATE request_operations SET applied=1 WHERE id=? AND request_id=? AND actor_id=? AND payload_hash=? AND applied=0').bind(...guardValues),
    );
    // D1 batches are transactional: reply, status, outbox and replay protection commit together.
    await db.batch(statements);
    const stored = await db.prepare('SELECT request_id,actor_id,action,payload_hash,applied FROM request_operations WHERE id=?').bind(operationId).first<OperationRow>();
    if (!matches(stored)) throw new LaunchHttpError(409, 'This operation key has already been used. Start a new action.');
    if (stored?.applied !== 1) throw Error('Operation did not commit');
    return privateJson({ok: true, id, operationId});
  } catch (error) { return launchErrorResponse(error); }
}
