import {build as viteBuild} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {cp} from 'node:fs/promises';
import {loadHostedCatalogue} from './hosted-catalogue.mjs';
const root=process.cwd(),require=createRequire(import.meta.url);
const hosted = await loadHostedCatalogue(root);
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
await viteBuild({configFile:false,root:path.join(root,'commerce'),publicDir:path.join(root,'public'),plugins:[{name:'hosted-featured',enforce:'post',transform(code,id){if(id===path.join(root,'data/storefront-edit.json'))return 'export default '+hosted.featured;}},react()],resolve:{alias:{'@':root}},css:{postcss:path.join(root,'postcss.config.mjs')},build:{copyPublicDir:false,outDir:path.join(root,'dist/client'),emptyOutDir:true}});
await cp(path.join(root,'public'),path.join(root,'dist/client'),{recursive:true,filter:source=>!source.startsWith(path.join(root,'public/catalogue-images'))});
const clientHtml=await readFile('dist/client/index.html','utf8');
const assetHash=createHash('sha256').update(clientHtml);
for(const asset of (await readdir('dist/client',{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).sort((a,b)=>(a.parentPath+'/'+a.name).localeCompare(b.parentPath+'/'+b.name))){assetHash.update(await readFile(path.join(asset.parentPath,asset.name)));}
const buildId=assetHash.digest('hex').slice(0,16);
await writeFile('dist/client/sw.js',(await readFile('dist/client/sw.js','utf8')).replaceAll('__STRIDE_BUILD_ID__',buildId));
// CSV is immutable for a deployment; generate it once instead of spending
// Worker request CPU formatting the full catalogue on every download.
const exportColumns=['id','name','brand','department','category','priceGHS','sourcePrice','sourceCurrency','priceType','sourceName','sourceUrl','image'];
const exportCell=value=>'"'+String(value??'').replace(/"/g,'""').replace(/^[=+@-]/,"'")+'"';
const exportCsv='\uFEFF'+[exportColumns.join(','),...JSON.parse(hosted.products).map(product=>exportColumns.map(column=>exportCell(product[column])).join(','))].join('\r\n');
await mkdir('dist/client/assets',{recursive:true});
await writeFile('dist/client/assets/catalogue.csv',exportCsv);
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['commerce/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',target:'es2022',platform:'neutral',minify:true,external:['cloudflare:workers'],alias:{'@':root},plugins:[{name:'raw-data',setup(b){b.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.path.startsWith('@/')?root:args.resolveDir,args.path.replace(/^@\//,'').replace(/\?raw$/,'')),namespace:'raw-data'}));b.onLoad({filter:/.*/,namespace:'raw-data'},async args=>({contents:args.path===path.join(root,'data/products.json')?hosted.products:await readFile(args.path,'utf8'),loader:'text'}));}}]});
const config=JSON.parse(await readFile('wrangler.json','utf8'));
await writeFile('dist/server/wrangler.json',JSON.stringify({...config,main:'index.js',assets:{...config.assets,directory:'../client'},d1_databases:config.d1_databases.map(d=>({...d,migrations_dir:'../../drizzle'}))},null,2));
console.log('STRIDE client and Worker production build complete.');
