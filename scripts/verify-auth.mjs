// No network or real email: exercise the production auth/store modules against
// SQLite through the same prepare/bind/all/batch interface as Cloudflare D1.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const root = process.cwd();
const require = createRequire(import.meta.url);
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('wrangler/package.json')] }));
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const migration of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) sql.exec(await readFile(`drizzle/${migration}`, 'utf8'));
const statement = (query, parameters = []) => {
  const execute = () => {
    const results = sql.prepare(query).all(...parameters);
    const meta = sql.prepare('SELECT changes() AS changes,last_insert_rowid() AS last_row_id').get();
    return { success: true, results, meta };
  };
  return {
    execute,
    bind: (...values) => statement(query, values),
    all: async () => execute(),
    run: async () => execute(),
    first: async column => { const row = execute().results[0]; return column ? row?.[column] ?? null : row ?? null; },
    raw: async () => execute().results.map(row => Object.values(row)),
  };
};
const DB = {
  prepare: query => statement(query),
  exec: async query => { sql.exec(query); return { count: 1, duration: 0 }; },
  batch: async tasks => {
    sql.exec('BEGIN');
    try { const results = tasks.map(task => task.execute()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
const emails = [];
const env = {
  DB,
  AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
  AUTH_BASE_URL: 'https://stride.test',
  AUTH_FROM: 'accounts@stride.test',
  ADMIN_EMAILS: 'staff@stride.test',
  EMAIL: { send: async message => { emails.push(message); return { messageId: crypto.randomUUID() }; } },
};
globalThis.__strideAuthTestEnv = env;
await mkdir('.sites-runtime', { recursive: true });
const output = path.join(root, '.sites-runtime/auth-test.mjs');
await build({
  stdin: { contents: `export * from './lib/auth.ts'; export {GET as readStore,POST as writeStore} from './app/api/store/route.ts';`, resolveDir: root, sourcefile: 'auth-test-entry.ts' },
  outfile: output, bundle: true, format: 'esm', platform: 'node', packages: 'external', alias: { '@': root },
  plugins: [{ name: 'auth-test-bindings', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'test-env', namespace: 'test-env' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-env' }, () => ({ contents: 'export const env = globalThis.__strideAuthTestEnv;', loader: 'js' }));
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.path.startsWith('@/') ? root : args.resolveDir, args.path.replace(/^@\//, '').replace(/\?raw$/, '')), namespace: 'raw-data' }));
    builder.onLoad({ filter: /.*/, namespace: 'raw-data' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
const auth = await import(pathToFileURL(output).href);
const cookiePairs = response => response.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => !value.endsWith('=')).join('; ');
let ipCounter = 1;
const request = (pathname, body, cookie = '', extra = {}) => new Request(`https://stride.test${pathname}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Origin: 'https://stride.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${ipCounter}`, ...(cookie ? { Cookie: cookie } : {}), ...extra },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const call = (endpoint, body, cookie = '', extra = {}, context = env) => auth.handleAuthRequest(request(`/api/auth${endpoint}`, body, cookie, extra), context);
const store = (body, cookie = '', extra = {}) => body === undefined ? auth.readStore(request('/api/store', undefined, cookie, extra)) : auth.writeStore(request('/api/store', body, cookie, extra));
const latestCode = email => {
  const message = emails.findLast(value => value.to === email);
  assert.ok(message, `Missing test-only email for ${email}`);
  return message.text.match(/\b\d{8}\b/)[0];
};
async function send(email) {
  ipCounter++;
  const response = await call('/email-otp/send-verification-otp', { email, type: 'sign-in' });
  assert.equal(response.status, 200, await response.clone().text());
  return latestCode(email);
}
async function signIn(email, cookie = '') {
  const code = await send(email);
  const response = await call('/sign-in/email-otp', { email, otp: code }, cookie);
  assert.equal(response.status, 200, await response.clone().text());
  return { cookie: cookiePairs(response), body: await response.clone().json(), response, code };
}
try {
  // Configuration, transport, and allowed endpoint boundaries.
  assert.equal(auth.isAuthConfigured(env), true);
  assert.equal(auth.isAuthConfigured({ ...env, AUTH_BASE_URL: 'http://stride.test' }), false);
  assert.equal((await call('/get-session', undefined, '', {}, { DB })).status, 503);
  assert.equal((await call('/sign-up/email', { email: 'bad@stride.test', password: 'unused' })).status, 404);
  assert.equal((await call('/email-otp/send-verification-otp', { email: 'a@stride.test', type: 'sign-in' }, '', { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/email-otp/send-verification-otp', { email: 'a@stride.test', type: 'sign-in' }, '', { Origin: '' })).status, 403);
  assert.equal((await call('/email-otp/send-verification-otp', { email: 'a@stride.test', type: 'forget-password' })).status, 400);
  assert.equal((await call('/sign-out', { payload: 'x'.repeat(9000) })).status, 413);
  assert.equal((await call('/sign-out', {}, '', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal(emails.length, 0);

  // Guest possession migrates once, never by matching an unverified contact email.
  const guestResponse = await store();
  const guestCookie = cookiePairs(guestResponse);
  const guest = guestCookie.split('=')[1];
  assert.match(guestResponse.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const products = JSON.parse(await readFile('data/products.json', 'utf8'));
  const product = products[0].id;
  assert.equal((await store({ action: 'cart', product, quantity: 40 }, guestCookie)).status, 200);
  assert.equal((await store({ action: 'save', product, value: true }, guestCookie)).status, 200);
  assert.equal((await store({ action: 'profile', profile: { name: 'Guest shopper', email: 'someone-else@stride.test' } }, guestCookie)).status, 200);
  assert.equal((await store({ action: 'plan', name: 'Starter', items: ['Walk'] }, guestCookie)).status, 200);
  const requestId = `ST-${crypto.randomUUID()}`;
  assert.equal((await store({ action: 'request', kind: 'quote', idempotencyKey: requestId.slice(3), form: { name: 'Guest shopper', email: 'someone-else@stride.test' } }, guestCookie)).status, 200);
  const accountA = await signIn('a@stride.test', guestCookie);
  assert.equal(accountA.body.user.emailVerified, true);
  assert.equal(accountA.body.user.email, 'a@stride.test');
  assert.match(accountA.response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(accountA.response.headers.get('set-cookie'), /Secure/i);
  assert.match(accountA.response.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal(accountA.response.headers.get('cache-control'), 'no-store');
  let state = await (await store(undefined, accountA.cookie)).json();
  assert.equal(state.user.id, accountA.body.user.id);
  assert.equal(state.cart[0].quantity, 40);
  assert.equal(state.saved[0], product);
  assert.equal(state.plans.length, 1);
  assert.equal(state.requests[0].id, requestId);
  assert.equal(state.profile.email, 'someone-else@stride.test');
  assert.equal(state.email, 'a@stride.test');
  assert.equal(sql.prepare('SELECT count(*) AS count FROM auth_guest_claims WHERE guest=?').get(guest).count, 1);
  state = await (await store(undefined, guestCookie)).json();
  assert.equal(state.cart.length, 0);
  assert.equal(state.requests.length, 0);
  assert.equal(state.user, null);
  assert.equal((await call('/sign-in/email-otp', { email: 'a@stride.test', otp: accountA.code })).status, 400);

  // Fresh challenge verification, storage hashes, expiry, attempts, and replay.
  const codeB = await send('b@stride.test');
  const verificationB = sql.prepare('SELECT value FROM verification WHERE identifier LIKE ?').get('%b@stride.test%');
  assert.ok(verificationB && !verificationB.value.includes(codeB));
  assert.equal((await call('/email-otp/send-verification-otp', { email: 'b@stride.test', type: 'sign-in' })).status, 429);
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => call('/sign-in/email-otp', { email: 'b@stride.test', otp: codeB })));
  assert.equal(concurrent.filter(response => response.status === 200).length, 1);
  const bResponse = concurrent.find(response => response.status === 200);
  const accountB = { cookie: cookiePairs(bResponse), body: await bResponse.json() };
  state = await (await store(undefined, accountB.cookie)).json();
  assert.equal(state.cart.length, 0);
  assert.equal(state.requests.length, 0);
  const expiredCode = await send('expired@stride.test');
  sql.prepare('UPDATE verification SET expiresAt=? WHERE identifier LIKE ?').run(Date.now() - 1, '%expired@stride.test%');
  assert.equal((await call('/sign-in/email-otp', { email: 'expired@stride.test', otp: expiredCode })).status, 400);
  const wrongCode = await send('wrong@stride.test');
  const incorrect = wrongCode === '00000000' ? '11111111' : '00000000';
  for (let i = 0; i < 3; i++) assert.equal((await call('/sign-in/email-otp', { email: 'wrong@stride.test', otp: incorrect })).status, 400);
  assert.notEqual((await call('/sign-in/email-otp', { email: 'wrong@stride.test', otp: wrongCode })).status, 200);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM "user" WHERE email IN (?,?)').get('wrong@stride.test', 'expired@stride.test').count, 0);

  // Atomic competing guest claims, capped merge, and existing profile preservation.
  const guestTwo = crypto.randomUUID();
  sql.prepare('INSERT INTO basket(owner,product,quantity) VALUES(?,?,?)').run(`guest:${guestTwo}`, product, 25);
  sql.prepare('INSERT INTO profiles(owner,data) VALUES(?,?)').run(`guest:${guestTwo}`, JSON.stringify({ name: 'Replace me' }));
  await Promise.all([auth.mergeGuest(env, guestTwo, accountA.body.user.id), auth.mergeGuest(env, guestTwo, accountB.body.user.id), auth.mergeGuest(env, guestTwo, accountA.body.user.id)]);
  assert.equal(sql.prepare('SELECT quantity FROM basket WHERE owner=? AND product=?').get(`user:${accountA.body.user.id}`, product).quantity, 50);
  assert.equal(sql.prepare('SELECT count(*) AS count FROM basket WHERE owner=?').get(`user:${accountB.body.user.id}`).count, 0);
  assert.equal(JSON.parse(sql.prepare('SELECT data FROM profiles WHERE owner=?').get(`user:${accountA.body.user.id}`).data).name, 'Guest shopper');
  const limitResults = await Promise.all(Array.from({ length: 10 }, () => auth.consumeThrottle(env, 'concurrent-test', 3, 60)));
  assert.equal(limitResults.filter(Boolean).length, 3);

  // Private message visibility and author-id exclusion.
  sql.prepare('INSERT INTO request_messages(id,request_id,author_role,author_id,body,created) VALUES(?,?,?,?,?,?)').run('test-message', requestId, 'staff', 'private-staff-id', 'We received your request.', new Date().toISOString());
  state = await (await store(undefined, accountA.cookie)).json();
  assert.equal(state.requests[0].messages[0].body, 'We received your request.');
  assert.equal('author_id' in state.requests[0].messages[0], false);
  assert.equal(JSON.stringify(state).includes('private-staff-id'), false);
  assert.equal((await (await store(undefined, accountB.cookie)).json()).requests.length, 0);

  // Session cookies are signed, database-revocable, and isolated from guest IDs.
  assert.equal(await auth.getAuthSession(request('/api/store', undefined, accountA.cookie.replace(/=./, '=x')), env), null);
  const sessions = await call('/list-sessions', undefined, accountA.cookie);
  assert.equal(sessions.status, 200);
  assert.equal((await sessions.json()).length, 1);
  // Advance the test's request quotas independently of real wall-clock time.
  sql.exec('DELETE FROM auth_throttle; DELETE FROM "rateLimit";');
  const secondA = await signIn('a@stride.test');
  assert.notEqual(secondA.cookie, accountA.cookie);
  assert.equal((await call('/revoke-other-sessions', {}, secondA.cookie)).status, 200);
  assert.equal(await auth.getAuthSession(request('/api/store', undefined, accountA.cookie), env), null);
  assert.ok(await auth.getAuthSession(request('/api/store', undefined, secondA.cookie), env));
  accountA.cookie = secondA.cookie;
  const logout = await call('/sign-out', {}, accountA.cookie);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /stride_session=/);
  assert.equal(await auth.getAuthSession(request('/api/store', undefined, accountA.cookie), env), null);
  assert.equal((await (await store(undefined, accountA.cookie)).json()).cart.length, 0);
  assert.equal((await store({ action: 'profile', profile: {} }, accountB.cookie, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await store({ action: 'profile', profile: { name: 'x'.repeat(31_000) } }, accountB.cookie)).status, 413);
  assert.equal((await (await store(undefined, '', { 'oai-authenticated-user-id': accountB.body.user.id })).json()).user, null);
  const failedSend = await call('/email-otp/send-verification-otp', { email: 'delivery-failure@stride.test', type: 'sign-in' }, '', {},
    { ...env, EMAIL: { send: async () => { throw new Error('Test provider unavailable'); } } });
  assert.ok(failedSend.status >= 500, `An email provider failure must not appear successful (status ${failedSend.status})`);
  console.log('PASS: auth configuration/origin/body boundaries, hashed expiring OTPs, attempt limits and concurrent replay, verified sessions, atomic guest migration, ownership/message isolation, throttles, signed cookies and revocation. No real email sent.');
} finally {
  sql.close();
  delete globalThis.__strideAuthTestEnv;
  await rm(output, { force: true });
}
