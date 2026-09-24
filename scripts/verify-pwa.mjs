import vm from 'node:vm';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
// Offline verification only: no live account, network or database calls.
const root=fileURLToPath(new URL('../',import.meta.url));
const publicRoot=path.join(root,process.argv.includes('--built')?'dist/client':'public');
const assetPath=relative=>path.join(publicRoot,relative.replace(/^public\//,''));
const readAsset=(relative,encoding)=>readFile(assetPath(relative),encoding);
const origin='https://stride.test';
const handlers={}, stores=new Map(), fetches=[];
let offline=false, claims=0, skips=0;
const normalize=value=>new URL(typeof value==='string'?value:value.url,origin).href;
const caches={async open(name){if(!stores.has(name)) stores.set(name,new Map());const rows=stores.get(name);return {async match(key){return rows.get(normalize(key))?.clone()},async put(key,response){rows.set(normalize(key),response.clone())},async keys(){return [...rows.keys()].map(url=>new Request(url))},async delete(key){return rows.delete(normalize(key))}}},async keys(){return [...stores.keys()]},async delete(name){return stores.delete(name)}};
const mockFetch=async request=>{fetches.push(request);if(offline)throw new Error('offline');const url=new URL(request.url);const mime=url.pathname.endsWith('.html')||request.mode==='navigate'?'text/html':url.pathname.endsWith('.woff')?'font/woff':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.js')?'application/javascript':'image/png';return new Response('public asset or uncached navigation',{headers:{'Content-Type':mime}})};
const context=vm.createContext({self:{location:{origin},clients:{claim:async()=>{claims++}},skipWaiting:async()=>{skips++},addEventListener:(type,cb)=>{handlers[type]=cb}},caches,fetch:mockFetch,Request,Response,Headers,URL,Uint8Array,Promise,Set});
vm.runInContext(await readAsset('public/sw.js','utf8')+'\nglobalThis.audit={publicResource,canStore,boundedBody,remember,LIMITS,STATIC_CACHE,IMAGE_CACHE,OFFLINE_ASSETS};',context);
const a=context.audit;
async function dispatch(type,props={}){const waits=[];let responded=false,result;handlers[type]({...props,waitUntil(p){waits.push(p)},respondWith(p){responded=true;result=Promise.resolve(p)}});const response=result?await result:undefined;await Promise.all(waits);return{responded,response}}
await dispatch('install');assert(await(await caches.open(a.STATIC_CACHE)).match('/offline.html'));
await(await caches.open('stride-pwa-public-static-old')).put('/old',new Response('old'));await(await caches.open('unrelated')).put('/other',new Response('other'));await dispatch('activate');assert(!stores.has('stride-pwa-public-static-old'));assert(stores.has('unrelated'));assert.equal(claims,1);assert.equal(skips,0);
const req=(route,extra={})=>({url:origin+route,method:'GET',mode:'cors',headers:new Headers(),cache:'default',...extra});
for(const route of ['/api/store','/api/auth/session','/auth/login','/account','/saved','/admin','/session','/login','/logout','/checkout','/cart','/bag','/private/customer.json','/assets/catalogue.csv','/catalogue-images/'+'a'.repeat(64)+'.png?token=secret'])assert.equal((await dispatch('fetch',{request:req(route)})).responded,false,route);
assert.equal((await dispatch('fetch',{request:new Request(origin+'/assets/index-AbCd1234.js',{headers:{Authorization:'Bearer private'}})})).responded,false);
assert.equal((await dispatch('fetch',{request:new Request('https://example.com/assets/index-AbCd1234.js')})).responded,false);
assert.equal((await dispatch('fetch',{request:new Request(origin+'/assets/index-AbCd1234.js',{cache:'no-store'})})).responded,false);
const beforeNavigationKeys=[...stores.values()].reduce((n,s)=>n+s.size,0);const nav=await dispatch('fetch',{request:req('/shop?customer=private',{mode:'navigate'})});assert(nav.responded);assert.equal([...stores.values()].reduce((n,s)=>n+s.size,0),beforeNavigationKeys);assert.equal((await dispatch('fetch',{request:req('/account',{mode:'navigate'})})).responded,false);
offline=true;const fallback=await dispatch('fetch',{request:req('/product/a-123',{mode:'navigate'})});assert.equal(fallback.response.headers.get('Content-Type'),'text/html');offline=false;
const asset=new Request(origin+'/assets/index-AbCd1234.js',{credentials:'include'});await dispatch('fetch',{request:asset});assert.equal(fetches.at(-1).credentials,'omit');assert.equal(fetches.at(-1).redirect,'error');const fetchCount=fetches.length;await dispatch('fetch',{request:asset});assert.equal(fetches.length,fetchCount);
const imagePolicy=a.publicResource(new URL(origin+'/catalogue-images/'+'b'.repeat(64)+'.png'));assert(imagePolicy);
for(const response of [new Response('secret',{headers:{'Content-Type':'image/png','Cache-Control':'private'}}),new Response('secret',{headers:{'Content-Type':'image/png','Cache-Control':'no-store'}}),new Response('secret',{headers:{'Content-Type':'image/png','Vary':'Cookie'}}),new Response('<html>secret</html>',{headers:{'Content-Type':'text/html'}}),new Response('secret',{headers:{'Content-Type':'image/png','Set-Cookie':'session=secret'}})])assert.equal(a.canStore(response,imagePolicy),false);
assert.equal(await a.boundedBody(new Response(new Uint8Array(4097)),4096),null);
for(let i=0;i<38;i++)await a.remember(new Request(origin+'/catalogue-images/'+i.toString(16).padStart(64,'0')+'.png'),new Response(new Uint8Array(800*1024),{headers:{'Content-Type':'image/png'}}),imagePolicy);
const imageRows=stores.get(a.IMAGE_CACHE),imageBytes=[...imageRows.values()].reduce((n,r)=>n+Number(r.headers.get('X-Stride-Public-Bytes')),0);assert(imageRows.size<=32);assert(imageBytes<=24*1024*1024);
await dispatch('message',{data:{type:'STRIDE_SKIP_WAITING'},source:{url:'https://attacker.test/'}});assert.equal(skips,0);await dispatch('message',{data:{type:'STRIDE_SKIP_WAITING'},source:{url:origin+'/shop'}});assert.equal(skips,1);
const manifest=JSON.parse(await readAsset('public/manifest.webmanifest','utf8'));assert.equal(manifest.scope,'/');assert.equal(manifest.id,'/');const dimensions=[['public/og/stride-social.png',1200,630],['public/icons/icon-192.png',192,192],['public/icons/icon-512.png',512,512],['public/icons/maskable-512.png',512,512],['public/icons/apple-touch-icon.png',180,180]];for(const [file,w,h] of dimensions){const bytes=await readAsset(file);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file);assert.equal(bytes.subarray(12,16).toString(),'IHDR',file);assert.equal(bytes.readUInt32BE(16),w,file);assert.equal(bytes.readUInt32BE(20),h,file);console.log(file,w,h,(await stat(assetPath(file))).size+' bytes')};
for(const icon of manifest.icons){assert.equal(new URL(icon.src,origin).origin,origin);assert.match(icon.src,/^\/icons\/[a-z0-9-]+\.png$/);await stat(assetPath(icon.src));}
for(const shortcut of manifest.shortcuts){assert.equal(new URL(shortcut.url,origin).origin,origin);}
for(let i=0;i<30;i++)await a.remember(new Request(origin+'/assets/chunk-'+String(i).padStart(8,'0')+'.js'),new Response(new Uint8Array(512*1024),{headers:{'Content-Type':'application/javascript'}}),{kind:'static',mime:/^application\/javascript$/,immutable:true});
const staticRows=stores.get(a.STATIC_CACHE),staticBytes=[...staticRows.values()].reduce((n,r)=>n+Number(r.headers.get('X-Stride-Public-Bytes')),0);assert(staticRows.size<=24);assert(staticBytes<=8*1024*1024);assert(await(await caches.open(a.STATIC_CACHE)).match('/offline.html'));
console.log('PASS: install/activate/update lifecycle; API/private/auth/query bypass; no navigation storage; anonymous assets; rejected sensitive responses; per-file/count/total-byte limits; all manifest/icon dimensions.');
