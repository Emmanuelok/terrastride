import {areRequestEmailsEnabled, type LaunchEnvironment} from './launch';

const maxAttempts = 5;
const batchSize = 20;
const leaseDurationMs = 10 * 60_000;
const sendTimeoutMs = 30_000;
const transientCodes = new Set(['E_INTERNAL_SERVER_ERROR', 'E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_DELIVERY_FAILED']);
const permanentCodes = new Set([
  'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_CONTENT_TOO_LARGE', 'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD', 'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID', 'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY',
]);
type OutboxRow = {id: string; request_id: string; kind: string; attempts: number};
type DispatchReport = {enabled: boolean; claimed: number; sent: number; retried: number; failed: number; skipped: number};

function providerErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && (transientCodes.has(code) || permanentCodes.has(code)) ? code : 'DELIVERY_OUTCOME_UNKNOWN';
}

async function sendWithDeadline(env: LaunchEnvironment, to: string, kind: string): Promise<string> {
  const received = kind === 'request-received';
  const accountUrl = new URL('/account', env.AUTH_BASE_URL!).href;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: unknown = await Promise.race([
      env.EMAIL!.send({
        from: env.AUTH_FROM!, to,
        subject: received ? 'Your STRIDE request is saved' : 'An update on your STRIDE request',
        text: (received ? 'Your enquiry has been saved for the STRIDE team.' : 'There is an update on your STRIDE request.')
          + '\n\nSign in to your account to view your requests:\n' + accountUrl
          + '\n\nNo payment has been collected and this message does not confirm an order.',
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Email outcome unknown')), sendTimeoutMs); }),
    ]);
    if (!result || typeof result !== 'object' || !('messageId' in result) || typeof result.messageId !== 'string'
      || !result.messageId.trim() || result.messageId.length > 200 || /[\u0000-\u001f\u007f]/.test(result.messageId)) {
      throw Error('Email acceptance was not confirmed');
    }
    return result.messageId;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Scheduled only. No request handler should call this without the explicit send flag. */
export async function dispatchRequestNotifications(env: LaunchEnvironment): Promise<DispatchReport> {
  const report: DispatchReport = {enabled: areRequestEmailsEnabled(env), claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0};
  if (!report.enabled) return report;
  const db = env.DB;
  const now = new Date().toISOString();
  const oldest = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  // The native binding has no documented provider idempotency parameter. An
  // expired send lease may have delivered: stop for review rather than resend.
  await db.batch([
    db.prepare(`UPDATE notifications_outbox SET status='failed',last_error_code='DELIVERY_OUTCOME_UNKNOWN',lease_id=NULL,lease_expires=NULL
      WHERE id IN (SELECT id FROM notifications_outbox WHERE status='sending' AND lease_expires<=? LIMIT 100)`).bind(now),
    db.prepare(`UPDATE notifications_outbox SET status='failed',last_error_code='NOTIFICATION_EXPIRED'
      WHERE id IN (SELECT id FROM notifications_outbox WHERE status='pending' AND created<? LIMIT 100)`).bind(oldest),
    db.prepare(`UPDATE notifications_outbox SET status='failed',last_error_code='ATTEMPTS_EXHAUSTED'
      WHERE id IN (SELECT id FROM notifications_outbox WHERE status='pending' AND attempts>=? LIMIT 100)`).bind(maxAttempts),
  ]);
  const lease = crypto.randomUUID();
  const leaseExpires = new Date(Date.now() + leaseDurationMs).toISOString();
  const claimed = await db.prepare(`UPDATE notifications_outbox
    SET status='sending',lease_id=?,lease_expires=?,attempts=attempts+1
    WHERE id IN (SELECT id FROM notifications_outbox WHERE status='pending' AND available_at<=? AND attempts<? AND created>=?
      ORDER BY available_at,created,id LIMIT ?)
    AND status='pending'
    RETURNING id,request_id,kind,attempts`).bind(lease, leaseExpires, now, maxAttempts, oldest, batchSize).all<OutboxRow>();
  report.claimed = claimed.results.length;
  let next = 0;
  const finish = (row: OutboxRow, code: string) => db.prepare(`UPDATE notifications_outbox
    SET status='failed',last_error_code=?,lease_id=NULL,lease_expires=NULL WHERE id=? AND status='sending' AND lease_id=?`)
    .bind(code, row.id, lease).run();
  const process = async (row: OutboxRow) => {
    // Resolve the current, verified account identity; submitted contact addresses
    // and pending guest enquiries are never authorization to email a recipient.
    const recipient = await db.prepare(`SELECT u.email FROM "user" u
      JOIN requests r ON r.owner=('user:' || u.id)
      JOIN notifications_outbox n ON n.request_id=r.id
      WHERE n.id=? AND n.status='sending' AND n.lease_id=? AND n.lease_expires>?
      AND u."emailVerified"=1`).bind(row.id, lease, new Date().toISOString()).first<{email: string}>();
    if (!recipient || typeof recipient.email !== 'string' || recipient.email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email)) {
      await finish(row, 'RECIPIENT_NOT_VERIFIED'); report.skipped++; return;
    }
    let messageId: string;
    try { messageId = await sendWithDeadline(env, recipient.email, row.kind); }
    catch (error) {
      const code = providerErrorCode(error);
      if (transientCodes.has(code) && row.attempts < maxAttempts) {
        const delay = code === 'E_DAILY_LIMIT_EXCEEDED' ? 24 * 60 * 60_000 : Math.min(60 * 60_000, 60_000 * 2 ** row.attempts) + Math.floor(Math.random() * 30_000);
        await db.prepare(`UPDATE notifications_outbox SET status='pending',available_at=?,last_error_code=?,lease_id=NULL,lease_expires=NULL
          WHERE id=? AND status='sending' AND lease_id=?`).bind(new Date(Date.now() + delay).toISOString(), code, row.id, lease).run();
        report.retried++;
      } else { await finish(row, code); report.failed++; }
      return;
    }
    // 'sent' means accepted by Cloudflare. It is not proof of inbox delivery.
    await db.prepare(`UPDATE notifications_outbox SET status='sent',sent_at=?,provider_message_id=?,last_error_code=NULL,lease_id=NULL,lease_expires=NULL
      WHERE id=? AND status='sending' AND lease_id=?`).bind(new Date().toISOString(), messageId, row.id, lease).run();
    report.sent++;
  };
  await Promise.all(Array.from({length: Math.min(4, claimed.results.length)}, async () => {
    while (next < claimed.results.length) { const row = claimed.results[next++]; await process(row); }
  }));
  return report;
}
