import {GET as catalogue} from '../app/api/catalog/route';
import {GET as readStore,POST as writeStore} from '../app/api/store/route';
import {GET as readAdmin,POST as writeAdmin} from '../app/api/admin/route';
import {handleAuthRequest} from '../lib/auth';
import {getLaunchReadiness,type LaunchEnvironment} from '../lib/launch';
import {dispatchRequestNotifications} from '../lib/notifications';
import {secureResponse,rewriteMetadata,sitemap} from './metadata';
type Bindings = LaunchEnvironment & { ASSETS: Fetcher; IMAGES?: R2Bucket };
const worker = {
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil((async()=>{
      const now=Date.now();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM "session" WHERE "expiresAt"<?').bind(now),
        env.DB.prepare('DELETE FROM "verification" WHERE "expiresAt"<?').bind(now),
        env.DB.prepare('DELETE FROM auth_throttle WHERE expires<?').bind(now),
        env.DB.prepare('DELETE FROM "rateLimit" WHERE "lastRequest"<?').bind(now-86_400_000),
      ]);
      await dispatchRequestNotifications(env);
    })());
  },
  async fetch(req: Request, env: Bindings, ctx?: ExecutionContext) {
    const url = new URL(req.url);
    if(url.pathname.startsWith('/api/auth/'))return secureResponse(await handleAuthRequest(req,env,ctx),true);
    if(url.pathname==='/api/admin')return secureResponse(req.method==='GET'?await readAdmin(req):req.method==='POST'?await writeAdmin(req):new Response(null,{status:405}),true);
    if(url.pathname==='/api/launch')return secureResponse(req.method==='GET'?Response.json(getLaunchReadiness(env)):new Response(null,{status:405}),true);
    if (url.pathname.startsWith('/catalogue-images/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return new Response(null, {status: 405});
      if (!/^\/catalogue-images\/[a-f0-9]{64}\.(jpg|png|gif|webp|avif)$/.test(url.pathname)) return new Response('Not found', {status: 404});
      if (!env.IMAGES) return new Response('Image storage unavailable', {status: 503});
      const object = await env.IMAGES.get(url.pathname.slice(1));
      if (!object) return new Response('Not found', {status: 404});
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('ETag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (req.headers.get('If-None-Match') === object.httpEtag) return new Response(null, {status: 304, headers});
      return new Response(req.method === 'HEAD' ? null : object.body, {headers});
    }
    if (url.pathname === '/api/catalog') return secureResponse(req.method === 'GET' ? await catalogue(req) : new Response(null, {status: 405}));
    if (url.pathname === '/api/store') return secureResponse(req.method === 'GET' ? await readStore(req) : req.method === 'POST' ? await writeStore(req) : new Response(null, {status: 405}),true);
    if (url.pathname === '/api/export') {
      if (req.method !== 'GET') return new Response(null, {status: 405});
      const asset = await env.ASSETS.fetch(new Request(new URL('/assets/catalogue.csv', url), req));
      const response = new Response(asset.body, asset);
      response.headers.set('Content-Type', 'text/csv; charset=utf-8');
      response.headers.set('Content-Disposition', 'attachment; filename="STRIDE-Complete-Product-Catalogue.csv"');
      return response;
    }
    if (url.pathname.startsWith('/api/')) return secureResponse(Response.json({error: 'Not found'}, {status: 404}),true);
    const base=getLaunchReadiness(env).siteUrl||url.origin;
    if(url.pathname==='/robots.txt')return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account\nDisallow: /saved\nDisallow: /admin\nSitemap: ${base}/sitemap.xml\n`,{headers:{'Content-Type':'text/plain; charset=utf-8'}});
    if(url.pathname==='/sitemap.xml')return new Response(sitemap(base),{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
    const asset=await env.ASSETS.fetch(req);
    if(url.pathname==='/offline.html')return secureResponse(asset);
    if(asset.headers.get('Content-Type')?.includes('text/html')){
      const meta=rewriteMetadata(await asset.text(),url,base);
      const headers=new Headers(asset.headers);headers.delete('ETag');headers.delete('Content-Length');headers.set('Cache-Control',meta.noindex?'no-store':'public, max-age=0, must-revalidate');
      if(meta.noindex)headers.set('X-Robots-Tag','noindex, nofollow');
      return secureResponse(new Response(req.method==='HEAD'?null:meta.html,{status:meta.status,headers}));
    }
    return secureResponse(asset);
  }
};

export default worker;
