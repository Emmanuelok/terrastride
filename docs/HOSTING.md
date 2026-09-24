# Cloudflare deployment

All runtime components use Cloudflare: Worker + Static Assets for the application, D1 for persistent shopping data, R2 for product photography. No Vercel, Supabase, hosted auth provider or external image CDN is needed at runtime.

## Resources

- Account: `e24b9546211a6f1a310bf8ac9c411114`
- Worker: `terrastride`
- D1: `terrastride-db`, ID `91930849-cc37-4e21-88db-2d9ac88107f5`, binding `DB`
- R2: `terrastride-images`, binding `IMAGES`; bucket public access disabled
- Source: https://github.com/Emmanuelok/terrastride

These are public resource identifiers, not credentials. Never commit tokens or private session data.

## Build and publish

Use Node 24 and pnpm 11. Install the lockfile with `pnpm install --frozen-lockfile`.

- Build command: `pnpm run build && pnpm run verify && pnpm exec tsc --noEmit`
- Deploy command: `pnpm run deploy`
- Branch: `main`
- Build environment: `NODE_VERSION=24.19.0`, `PNPM_VERSION=11.25.0`

The build validates the complete image manifest and rewrites catalogue imagery to same-origin R2 paths. It produces `dist/server/index.js`, `dist/client`, and `dist/server/wrangler.json`. Product photographs are deliberately excluded from Static Assets and Git history; the immutable R2 manifest is committed.

The deploy command first syncs missing gallery objects into R2, then publishes the Worker. It uses the existing Cloudflare Builds token from `CLOUDFLARE_API_TOKEN`, derives S3 credentials only in memory, and never logs credentials. The token needs Workers deployment and R2 read/write permissions. Missing permissions or failed asset checks stop publication. Successful objects survive interrupted builds; rerunning skips existing objects after checking size, MIME type and stored SHA-256 metadata. Cloudflare Builds has a 20-minute execution limit, so the first large image transfer may require a retry.

To recover photographs locally: `pnpm images:mirror -- --concurrency=24`. To upload them from an authenticated environment: `pnpm images:sync`. The original URLs, verified content hashes, file sizes and MIME types are in `data/image-mirror-manifest.json`.

## Database

The five source tables were empty. The initial schema was created in the new D1 database through its dashboard console on 24 September 2026, and `d1_migrations` was populated with `0000_chemical_lady_ursula.sql` to establish the Wrangler baseline. Future schema changes require an appropriately authorized D1 migration, not replaying the initial CREATE TABLE statements.

For a local test database: `pnpm exec wrangler d1 migrations apply DB --local --config wrangler.json --persist-to .wrangler/state`. For reviewed future production migrations, use `pnpm db:migrate` with a token containing D1 Edit. The default Workers Builds token does not necessarily have that permission.

## Sessions and operations

Customer data belongs to a browser guest session, valid for 30 days. Clearing cookies or using another browser starts a separate session. The original Sites customer sign-in is not an independent authentication service. Cross-device accounts and recovery are not implemented.

Enquiries remain in D1, with no automatic notification or payment collection. Database Time Travel and Cloudflare deployment history provide recovery tools; preserve the repository and R2 manifest before future catalogue updates.

## Provider documentation

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token
- https://developers.cloudflare.com/d1/
