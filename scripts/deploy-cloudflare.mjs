import {spawnSync} from 'node:child_process';
// Build credentials remain in the Cloudflare build environment. Fail before
// publishing if the complete gallery cannot be verified/uploaded to R2.
for (const args of [
  ['scripts/sync-images-r2.mjs','--concurrency=24'],
  ['node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json'],
]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if (result.error || result.status!==0) process.exit(result.status||1);
}
