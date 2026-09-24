import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
// Keep the signing secret entirely inside the Cloudflare build process. Create
// it only once; redeployments must never rotate active customer sessions.
const cli='node_modules/wrangler/bin/wrangler.js';
const config='dist/server/wrangler.json';
const listed=spawnSync(process.execPath,[cli,'secret','list','--config',config],{encoding:'utf8',env:process.env});
if(listed.error||listed.status!==0){console.error('Unable to inspect Worker secret names. Deployment stopped.');process.exit(1);}
let secrets;
try{secrets=JSON.parse(listed.stdout);}catch{console.error('Unexpected secret-list response. Deployment stopped.');process.exit(1);}
if(!Array.isArray(secrets)){console.error('Invalid secret-list response. Deployment stopped.');process.exit(1);}
if(!secrets.some(secret=>secret.name==='AUTH_SECRET')){
  const created=spawnSync(process.execPath,[cli,'secret','put','AUTH_SECRET','--config',config],{input:randomBytes(48).toString('base64url')+'\n',encoding:'utf8',env:process.env,stdio:['pipe','pipe','pipe']});
  if(created.error||created.status!==0){console.error('Unable to configure the account signing secret. Deployment stopped.');process.exit(1);}
  console.log('Account signing secret configured securely.');
}
// Build credentials remain in the Cloudflare build environment. Fail before
// publishing if the complete gallery cannot be verified/uploaded to R2.
for (const args of [
  ['scripts/sync-images-r2.mjs','--concurrency=64'],
  ['node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json'],
]) {
  const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if (result.error || result.status!==0) process.exit(result.status||1);
}
