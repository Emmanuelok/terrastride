# Quotation launch operations

STRIDE is a catalogue and quotation service. A saved bag, submitted enquiry, staff reply, or notification is not an order, payment, stock reservation, or delivery commitment. Checkout remains disabled until the merchant supplies approved selling prices, inventory, payment configuration, fulfilment arrangements, and purchase terms.

The application, account database, enquiry inbox, photographs, and transactional email run on Cloudflare. Authentication uses the self-hosted Better Auth library with D1; it does not require a hosted authentication provider.

## Configuration

Confirm the public domain, verified sender address, monitored support address, and authorized staff email addresses with the merchant. Do not substitute invented contact information.

| Setting | Purpose |
| --- | --- |
| `AUTH_BASE_URL` | The exact public HTTPS origin, with no trailing slash, path, credentials, or query. Customers must sign in on this origin. |
| `SITE_URL` | The public canonical origin. Use the same domain as `AUTH_BASE_URL`. |
| `AUTH_FROM` | A sender address on a domain onboarded to Cloudflare Email Sending. |
| `SUPPORT_EMAIL` | The monitored public contact address, shown to customers. |
| `ADMIN_EMAILS` | Comma-separated staff email allowlist. Store as a Worker secret; never expose it in client configuration. Each staff member must verify that address by signing in. |
| `REQUEST_EMAILS_ENABLED` | Set to the string `true` only after sender configuration and delivery verification. Any other value disables the notification dispatcher. |
| `AUTH_SECRET` | Runtime signing secret, at least 32 characters. Managed automatically by the deployment script. |
| `DB` | Existing `terrastride-db` D1 binding. |
| `EMAIL` | Native Cloudflare Email Sending binding. |

`scripts/deploy-cloudflare.mjs` checks Worker secret names using the existing Cloudflare Builds deployment credentials. If `AUTH_SECRET` is absent, it creates a 48-byte cryptographically random value and sends it directly to Wrangler through stdin. The value is not printed or committed. Existing secrets are preserved on redeployment; do not rotate it routinely, because rotation invalidates sessions. Failure to inspect or create the secret stops deployment.

Cloudflare Email Sending to customer addresses requires Workers Paid and an onboarded sender domain. Complete the domain's required DNS verification and configure the native binding in the Worker configuration:

```json
"send_email": [{ "name": "EMAIL" }]
```

A binding restricted only to preverified destination addresses is insufficient for general customer sign-in. Configure appropriate sender restrictions while permitting intended customer recipients. The code sends sign-in codes only when a visitor requests them; scheduled quotation notifications additionally require the explicit send flag.

See Cloudflare's [Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/), [binding configuration](https://developers.cloudflare.com/email-service/configuration/send-bindings/), and [plan requirements](https://developers.cloudflare.com/email-service/platform/pricing/). `keep_vars: true` preserves configured dashboard variables during subsequent deployments. Confirm actual domain readiness in Cloudflare; the application's enabled flags describe configuration, not successful email delivery.

## Database and deployment

The production database records all three migrations as applied on 24 September 2026. For a new environment, apply them in order before enabling account and inbox routes:

1. `0001_auth.sql`: users, sessions, one-time verification, rate limits, and one-time guest ownership claims.
2. `0002_launch_operations.sql`: customer-visible messages, staff operation idempotency/audit, and the notification outbox.

Use an authorized Cloudflare identity with D1 Edit, preserve a recoverable database point, and run:

```sh
pnpm db:migrate
pnpm build
pnpm verify
pnpm exec tsc --noEmit
```

Do not replay the original schema manually. Workers Builds deployment permissions do not necessarily include D1 migration permission. Review any migration error before publishing dependent code.

The Worker already has a five-minute Cron Trigger that performs auth cleanup and calls `dispatchRequestNotifications(env)`. Keep `REQUEST_EMAILS_ENABLED` disabled until configuration and a merchant-authorized delivery check are complete. A disabled dispatcher makes no send attempt.

## Accounts and staff inbox

Customers sign in with an expiring email code. Only verified accounts own cross-device data. On successful sign-in, the current guest session's bag, saved products, profile, requests, and plans are transferred once to `user:<id>`. The editable contact email in a profile or enquiry does not establish ownership.

Staff access requires both a verified account and an exact, case-insensitive match in `ADMIN_EMAILS`. An empty allowlist fails closed. No account becomes staff merely by being the first signup or changing its profile.

`GET /api/admin` returns up to 50 requests per page, with an opaque `nextCursor`; `status` and `kind` are optional filters. `GET /api/admin?id=<reference>` returns a request and its latest 100 customer-visible messages. Staff can set `Received`, `In review`, `Awaiting customer`, `Replied`, or `Closed`.

Staff mutations require JSON, a matching Origin, and a fresh UUIDv4 `idempotencyKey`. A customer reply contains plain text of up to 3,000 characters and sets the status to `Replied`. The reply, status, pending notification, and idempotency record commit in one D1 transaction. Repeating the same key and payload does not repeat the operation; reusing a key for a different operation is rejected.

`request_messages` contains customer-visible messages. Do not put private staff notes there. Customer responses must select messages through the request owner's authorization and omit `author_id`. `request_operations` is an internal audit/idempotency table and must not be returned to customers. Private API responses are `no-store`; service workers must never cache account, admin, or store API responses.

## Notification delivery

The outbox records durable work; a `pending` row is not evidence that an email was sent. The dispatcher only selects the verified account address by joining `requests.owner = 'user:' || user.id`. It never sends to the contact email supplied in an enquiry. Guest and unverified requests remain accessible in the inbox but are not emailed.

Each run atomically claims at most 20 rows with a ten-minute lease and sends at most four concurrently. Each email contains a generic update and the configured `/account` link; it contains no customer name, address, product list, staff reply, or request reference. Notifications older than seven days expire rather than creating a backlog of stale messages.

Explicit temporary provider errors use delayed retries, with a maximum of five attempts. Rate limits and provider errors persist only a known error code, not raw provider messages or customer data. Suppressed recipients and other permanent errors fail without repeated sending. A successful `sent` record means Cloudflare accepted the message and returned a provider message ID; it does not prove inbox delivery.

The native binding has no documented send-idempotency parameter. A timeout, malformed acceptance result, or expired sending lease may represent an email that was already accepted. These rows fail with `DELIVERY_OUTCOME_UNKNOWN` for operator review rather than being automatically resent. Check the provider's email logs before deciding whether a manual retry is appropriate.

For operational review, inspect outbox metadata without selecting request contents:

```sql
SELECT status, last_error_code, COUNT(*) AS total
FROM notifications_outbox
GROUP BY status, last_error_code;
```

The staff inbox is the source of truth for enquiries. Assign someone to review it; email notifications alone are not a support workflow.

## Before opening quotations to customers

- Verify a sign-in code, sign-out, expired-code rejection, and access from another browser using authorized test accounts. Confirm that one account cannot read another account's requests.
- Verify guest transfer once, staff allowlist rejection, staff reply visibility, duplicate-submit handling, and a failed email remaining visible for staff review. Automated tests should mock email; actual delivery checks require a chosen recipient.
- Publish the confirmed business/support details and accurate privacy, retention, quotation, and contact information. Cookie expiry does not delete D1 records. Do not claim automatic deletion until a retention process exists.
- Confirm the sender, domain, canonical links, private-page indexing restrictions, and security headers. Confirm installed-app updates do not cache private data.
- Keep reference-price, unconfirmed-availability, and no-payment disclosures. Do not describe supplements as registered, images as licensed, or delivery/returns as guaranteed without merchant evidence.

Payments, approved inventory and prices, courier fulfilment, returns/refunds, and purchase policies are a separate trading launch. This code does not fabricate or activate them.
