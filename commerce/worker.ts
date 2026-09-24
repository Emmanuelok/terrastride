import {GET as catalogue} from '../app/api/catalog/route';
import {GET as readStore,POST as writeStore} from '../app/api/store/route';
type Bindings = { ASSETS: Fetcher; IMAGES?: R2Bucket };
export default {
  async fetch(req: Request, env: Bindings) {
    const url = new URL(req.url);
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
    if (url.pathname === '/api/catalog') return req.method === 'GET' ? catalogue(req) : new Response(null, {status: 405});
    if (url.pathname === '/api/store') return req.method === 'GET' ? readStore(req) : req.method === 'POST' ? writeStore(req) : new Response(null, {status: 405});
    if (url.pathname === '/api/export') {
      if (req.method !== 'GET') return new Response(null, {status: 405});
      const asset = await env.ASSETS.fetch(new Request(new URL('/assets/catalogue.csv', url), req));
      const response = new Response(asset.body, asset);
      response.headers.set('Content-Type', 'text/csv; charset=utf-8');
      response.headers.set('Content-Disposition', 'attachment; filename="STRIDE-Complete-Product-Catalogue.csv"');
      return response;
    }
    if (url.pathname.startsWith('/api/')) return Response.json({error: 'Not found'}, {status: 404});
    return env.ASSETS.fetch(req);
  }
};
