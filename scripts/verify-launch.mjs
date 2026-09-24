// Offline launch verification: real route/dispatcher SQL, in-memory SQLite,
// mocked authenticated identity and native email binding. No real emails.
import {createRequire} from 'node:module';
import {readFile, readdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const {build} = require(require.resolve('esbuild', {paths: [require.resolve('wrangler/package.json')]}));
const sql = new DatabaseSync(':memory:');
const generated = await mkdtemp(path.join(tmpdir(), 'stride-launch-check-'));
const originalFetch = globalThis.fetch;
try {
// Fail closed if a future refactor tries to contact a live service during CI.
globalThis.fetch = async () => { throw Error('Network is disabled in launch verification'); };
sql.exec('PRAGMA foreign_keys=ON');
for (const migration of (await readdir(path.join(root, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()) {
  sql.exec(await readFile(path.join(root, 'drizzle', migration), 'utf8'));
}
function prepared(query, params=[]) {
  const execute = () => ({results: sql.prepare(query).all(...params)});
  return {bind: (...next) => prepared(query, next), all: async () => execute(), first: async () => sql.prepare(query).get(...params) || null, run: async () => sql.prepare(query).run(...params), execute};
}
const db = {prepare: prepared, batch: async tasks => {
  sql.exec('BEGIN');
  try { const results = tasks.map(task => task.execute()); sql.exec('COMMIT'); return results; }
  catch (error) { sql.exec('ROLLBACK'); throw error; }
}};
globalThis.__launchTestEnv = {DB: db, ADMIN_EMAILS: ' Staff@Stride.test ', AUTH_SECRET: 'x'.repeat(32), AUTH_BASE_URL: 'https://stride.test', AUTH_FROM: 'auth@stride.test', SUPPORT_EMAIL: 'help@stride.test', EMAIL: {send: async () => {throw Error('Must not send');}}};
globalThis.__launchTestSession = {user: {id:'staff-1',email:'staff@stride.test',emailVerified:true,name:'Staff'}};
// Authentication itself is exercised by verify-auth.mjs. This suite stubs
// identity/configuration to isolate staff authorization and delivery behavior.
const plugins = [{name:'test-bindings',setup(b) {
  b.onResolve({filter:/^cloudflare:workers$/}, () => ({path:'env',namespace:'test'}));
  b.onResolve({filter:/^(?:@\/lib\/auth|\.\/auth)$/}, () => ({path:'auth',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'}, args => ({contents: args.path==='env' ? 'export const env=globalThis.__launchTestEnv;' : 'export const getAuthSession=async()=>globalThis.__launchTestSession; export const isAuthConfigured=env=>Boolean(env.DB && env.EMAIL?.send && env.AUTH_SECRET?.length>=32 && env.AUTH_BASE_URL==="https://stride.test" && env.AUTH_FROM);',loader:'js'}));
}}];
await Promise.all([
  build({entryPoints:[root+'/app/api/admin/route.ts'],outfile:path.join(generated,'admin.mjs'),bundle:true,format:'esm',platform:'node',alias:{'@':root},plugins}),
  build({entryPoints:[root+'/lib/launch.ts'],outfile:path.join(generated,'launch.mjs'),bundle:true,format:'esm',platform:'node',plugins}),
  build({entryPoints:[root+'/lib/notifications.ts'],outfile:path.join(generated,'notifications.mjs'),bundle:true,format:'esm',platform:'node',plugins}),
]);
const admin = await import(pathToFileURL(path.join(generated,'admin.mjs')).href);
const launch = await import(pathToFileURL(path.join(generated,'launch.mjs')).href);
const headers = {'content-type':'application/json',origin:'https://stride.test'};
const get = query => admin.GET(new Request('https://stride.test/api/admin'+(query||'')));
const post = (body, overrides={}) => admin.POST(new Request('https://stride.test/api/admin',{method:'POST',headers:{...headers,...overrides},body:typeof body==='string'?body:JSON.stringify(body)}));
const count = table => sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const ids = ['ST-'+crypto.randomUUID(),'ST-'+crypto.randomUUID(),'ST-'+crypto.randomUUID()].sort().reverse();
for (const id of ids) sql.prepare('INSERT INTO requests(id,owner,kind,data,status,created) VALUES(?,?,?,?,?,?)').run(id,'guest:private-secret','quote',JSON.stringify({name:'Customer',email:'customer@example.test'}),'Saved — awaiting store launch','2026-09-24T12:00:00.000Z');
const id = ids[0];
const payload = {action:'customer-reply',id,message:'Your quote is ready to discuss.',idempotencyKey:crypto.randomUUID()};
globalThis.__launchTestSession = null;
assert.equal((await get()).status,401);
assert.equal((await post(payload)).status,401);
globalThis.__launchTestSession = {user:{id:'customer-1',email:'customer@example.test',emailVerified:true}};
assert.equal((await get()).status,403);
globalThis.__launchTestSession.user.email='staff@stride.test';
globalThis.__launchTestSession.user.emailVerified=false;
assert.equal((await get()).status,403);
globalThis.__launchTestSession={user:{id:'staff-1',email:'STAFF@stride.test',emailVerified:true}};
const configuredAdmins = globalThis.__launchTestEnv.ADMIN_EMAILS;
globalThis.__launchTestEnv.ADMIN_EMAILS='';
assert.equal((await get()).status,503);
globalThis.__launchTestEnv.ADMIN_EMAILS=configuredAdmins;
const response = await get('?limit=2');
assert.equal(response.headers.get('cache-control'),'no-store');
const page = await response.json();
assert.deepEqual(page.requests.map(r=>r.id),ids.slice(0,2));
assert.ok(page.nextCursor);
assert.equal('owner' in page.requests[0],false);
const secondPage = await (await get('?limit=2&cursor='+page.nextCursor)).json();
assert.deepEqual(secondPage.requests.map(r=>r.id),ids.slice(2));
assert.equal(secondPage.nextCursor,null);
assert.equal((await get('?cursor=invalid')).status,400);
assert.equal((await get('?limit=51')).status,400);
assert.equal((await get('?status=Unknown')).status,400);
assert.equal((await get('?kind=not-kind')).status,400);
assert.equal((await post(payload,{origin:'https://evil.test'})).status,403);
assert.equal((await post(payload,{origin:''})).status,403);
assert.equal((await post(payload,{'content-type':'text/plain'})).status,415);
assert.equal((await post('{')).status,400);
assert.equal((await post('[]')).status,400);
assert.equal((await post('x'.repeat(17000))).status,413);
assert.equal((await post(payload,{'content-length':'17000'})).status,413);
assert.equal((await post({...payload,message:' '})).status,400);
assert.equal((await post({...payload,message:'x'.repeat(3001)})).status,400);
assert.equal((await post({...payload,message:'Hello\u0000'})).status,400);
assert.equal((await post({...payload,action:'status',status:'Paid'})).status,400);
assert.equal((await post({...payload,id:'ST-'+crypto.randomUUID()})).status,404);
assert.equal((await post(payload)).status,200);
assert.equal(count('request_messages'),1);
assert.equal(count('notifications_outbox'),1);
assert.equal(count('request_operations'),1);
assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(id).status,'Replied');
assert.equal(sql.prepare('SELECT status FROM notifications_outbox').get().status,'pending');
assert.equal((await (await post(payload)).json()).duplicate,true);
assert.equal(count('request_messages'),1);
assert.equal((await post({...payload,message:'Different payload'})).status,409);
const detail = await (await get('?id='+id)).json();
assert.equal(detail.messages[0].body,payload.message);
assert.deepEqual(Object.keys(detail.messages[0]).sort(),['authorRole','body','created','id']);
assert.equal(detail.moreMessages,false);
const close = {action:'status',id,status:'Closed',idempotencyKey:crypto.randomUUID()};
assert.equal((await post(close)).status,200);
assert.equal((await post(payload)).status,200);
assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(id).status,'Closed');
assert.equal(count('notifications_outbox'),2);
const filtered = await (await get('?status=Closed')).json();
assert.deepEqual(filtered.requests.map(r=>r.id),[id]);
const before = count('request_operations');
sql.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON notifications_outbox BEGIN SELECT RAISE(ABORT,'test rollback'); END");
const loggedErrors = [];
const originalConsoleError = console.error;
try {
  console.error = (...args) => loggedErrors.push(args);
  assert.equal((await post({...close,status:'In review',idempotencyKey:crypto.randomUUID()})).status,503);
} finally { console.error = originalConsoleError; }
assert.deepEqual(loggedErrors, [['STRIDE launch operation failed.']]);
assert.equal(count('request_operations'),before);
assert.equal(sql.prepare('SELECT status FROM requests WHERE id=?').get(id).status,'Closed');
const readiness = launch.getLaunchReadiness(globalThis.__launchTestEnv);
assert.equal(readiness.authenticationEnabled,true);
assert.equal(readiness.staffInboxEnabled,true);
assert.equal(readiness.emailNotificationsEnabled,false);
assert.equal(readiness.checkoutEnabled,false);
assert.equal(readiness.supportEmail,'help@stride.test');
assert.equal(JSON.stringify(readiness).toLowerCase().includes('staff@stride.test'),false);
assert.equal(JSON.stringify(readiness).includes('x'.repeat(32)),false);
assert.equal(launch.getLaunchReadiness({...globalThis.__launchTestEnv,AUTH_SECRET:''}).authenticationEnabled,false);
assert.equal(launch.getLaunchReadiness({...globalThis.__launchTestEnv,SITE_URL:'https://user:secret@evil.test',AUTH_BASE_URL:undefined}).siteUrl,null);
console.log('PASS: admin verification/allowlist, no-store/private field filtering, cursor pagination, filters, strict JSON/origin/size validation, replies/statuses, idempotency, durable pending outbox, transaction rollback, and readiness secret redaction.');

sql.exec('DROP TRIGGER fail_outbox');
const {dispatchRequestNotifications} = await import(pathToFileURL(path.join(generated,'notifications.mjs')).href);
let report = await dispatchRequestNotifications(globalThis.__launchTestEnv);
assert.equal(report.enabled,false);
assert.equal(count('notifications_outbox'),2);
const now = new Date().toISOString();
for (const [userId,email,verified] of [['verified-user','verified@example.test',1],['unverified-user','unverified@example.test',0]]) {
  sql.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(userId,'Test',email,verified,Date.now(),Date.now());
}
sql.prepare('UPDATE requests SET owner=? WHERE id=?').run('user:verified-user',id);
sql.prepare('UPDATE requests SET owner=? WHERE id=?').run('user:unverified-user',ids[1]);
function enqueue(request=id, options={}) {
  const notification='TEST-'+crypto.randomUUID();
  sql.prepare('INSERT INTO notifications_outbox(id,request_id,kind,payload,status,attempts,available_at,created,lease_id,lease_expires) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(notification,request,'request-status','{}',options.status||'pending',options.attempts||0,options.available||now,options.created||now,options.lease||null,options.expires||null);
  return notification;
}
const guestMessage=enqueue(ids[2]);
const unverifiedMessage=enqueue(ids[1]);
let sends=[];
globalThis.__launchTestEnv.REQUEST_EMAILS_ENABLED='true';
globalThis.__launchTestEnv.EMAIL.send=async message=>{sends.push(message);return {messageId:crypto.randomUUID()};};
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);
assert.equal(report.enabled,true);assert.equal(report.claimed,4);assert.equal(report.sent,2);assert.equal(report.skipped,2);
assert.equal(sends.length,2);
assert.ok(sends.every(message=>message.to==='verified@example.test' && message.text.includes('https://stride.test/account') && !message.text.includes('Customer') && !message.text.includes('customer@example.test') && !message.text.includes(payload.message)));
for (const notification of [guestMessage,unverifiedMessage]) assert.equal(sql.prepare('SELECT last_error_code FROM notifications_outbox WHERE id=?').get(notification).last_error_code,'RECIPIENT_NOT_VERIFIED');
let notification=enqueue();
globalThis.__launchTestEnv.EMAIL.send=async()=>{throw Object.assign(Error('Sensitive raw message must not persist'),{code:'E_RATE_LIMIT_EXCEEDED'});};
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);assert.equal(report.retried,1);
const stored=sql.prepare('SELECT * FROM notifications_outbox WHERE id=?').get(notification);
assert.equal(stored.status,'pending');assert.equal(stored.attempts,1);assert.ok(stored.available_at>now);assert.equal(stored.last_error_code,'E_RATE_LIMIT_EXCEEDED');
assert.equal((await dispatchRequestNotifications(globalThis.__launchTestEnv)).claimed,0);
sql.prepare('UPDATE notifications_outbox SET available_at=? WHERE id=?').run(now,notification);
globalThis.__launchTestEnv.EMAIL.send=async()=>{throw Object.assign(Error('Sensitive raw message'),{code:'E_RECIPIENT_SUPPRESSED'});};
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);assert.equal(report.failed,1);
assert.equal(sql.prepare('SELECT status FROM notifications_outbox WHERE id=?').get(notification).status,'failed');
notification=enqueue();globalThis.__launchTestEnv.EMAIL.send=async()=>undefined;
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);assert.equal(report.failed,1);
assert.equal(sql.prepare('SELECT last_error_code FROM notifications_outbox WHERE id=?').get(notification).last_error_code,'DELIVERY_OUTCOME_UNKNOWN');
notification=enqueue(id,{attempts:4});
globalThis.__launchTestEnv.EMAIL.send=async()=>{throw Object.assign(Error('Transient'),{code:'E_INTERNAL_SERVER_ERROR'});};
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);assert.equal(report.failed,1);
assert.equal(sql.prepare('SELECT attempts FROM notifications_outbox WHERE id=?').get(notification).attempts,5);
const expiredLease=enqueue(id,{status:'sending',lease:'old-lease',expires:new Date(Date.now()-60000).toISOString()});
const activeLease=enqueue(id,{status:'sending',lease:'active-lease',expires:new Date(Date.now()+3600000).toISOString()});
const expiredMessage=enqueue(id,{created:new Date(Date.now()-8*86400000).toISOString()});
const exhausted=enqueue(id,{attempts:5});
report=await dispatchRequestNotifications(globalThis.__launchTestEnv);assert.equal(report.claimed,0);
assert.equal(sql.prepare('SELECT last_error_code FROM notifications_outbox WHERE id=?').get(expiredLease).last_error_code,'DELIVERY_OUTCOME_UNKNOWN');
assert.equal(sql.prepare('SELECT status FROM notifications_outbox WHERE id=?').get(activeLease).status,'sending');
assert.equal(sql.prepare('SELECT last_error_code FROM notifications_outbox WHERE id=?').get(expiredMessage).last_error_code,'NOTIFICATION_EXPIRED');
assert.equal(sql.prepare('SELECT last_error_code FROM notifications_outbox WHERE id=?').get(exhausted).last_error_code,'ATTEMPTS_EXHAUSTED');
const concurrentIds=Array.from({length:30},()=>enqueue());
sends=[];globalThis.__launchTestEnv.EMAIL.send=async message=>{sends.push(message);await Promise.resolve();return {messageId:crypto.randomUUID()};};
const parallel=await Promise.all([dispatchRequestNotifications(globalThis.__launchTestEnv),dispatchRequestNotifications(globalThis.__launchTestEnv)]);
assert.equal(parallel.reduce((sum,item)=>sum+item.claimed,0),30);assert.ok(parallel.every(item=>item.claimed<=20));assert.equal(sends.length,30);
for(const notification of concurrentIds) assert.equal(sql.prepare('SELECT status FROM notifications_outbox WHERE id=?').get(notification).status,'sent');
assert.equal(launch.getLaunchReadiness(globalThis.__launchTestEnv).emailNotificationsEnabled,true);
console.log('PASS: disabled send gate, verified account recipients only, generic emails, provider acceptance tracking, retries/backoff, permanent errors, uncertain outcomes, expired leases, age/attempt caps, atomic concurrent leases and bounded batches. Email binding was mocked; no email sent.');
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__launchTestEnv;
  delete globalThis.__launchTestSession;
  sql.close();
  await rm(generated, {recursive:true, force:true});
}

