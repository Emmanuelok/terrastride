import {byId,departments,products} from '../lib/catalogue';
export const securityHeaders={
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
export function secureResponse(response:Response,privateData=false){const copy=new Response(response.body,response);for(const [key,value] of Object.entries(securityHeaders))copy.headers.set(key,value);if(privateData)copy.headers.set('Cache-Control','no-store');return copy;}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const pages:Record<string,[string,string]>={
 '/':['STRIDE Ghana — Built for more.','Find your next move with STRIDE. Explore fitness equipment, activewear, sports nutrition and training tools, built around life in Ghana.'],
 '/shop':['Find your next level | STRIDE Ghana','Explore equipment and essentials for the way you move. Build your shortlist and request a quotation.'],
 '/departments':['Every way to move | STRIDE Ghana','Explore fitness, sport, nutrition and wellbeing departments. Find the essentials for your next goal.'],
 '/tools':['Training tools | STRIDE Ghana','Build a workout, plan your home gym and use practical fitness tools for your next session.'],
 '/services':['Gym & business projects | STRIDE Ghana','Plan equipment for your home gym, business, club or team. Start a project enquiry with STRIDE.'],
 '/help':['Help & enquiries | STRIDE Ghana','Understand catalogue prices, quotations, delivery enquiries and how STRIDE works.'],
 '/privacy':['Privacy | STRIDE Ghana','How STRIDE handles account, contact, request and browser data.'],
 '/terms':['Terms | STRIDE Ghana','Read the terms for using the STRIDE catalogue, training tools and enquiry service.'],
 '/account':['Your account | STRIDE Ghana','Manage your STRIDE account, requests, saved details and plans.'],
 '/saved':['Your favourites | STRIDE Ghana','Your personal STRIDE shortlist.'],
 '/admin':['Staff workspace | STRIDE Ghana','STRIDE staff request management.'],
};
export function routeMetadata(url:URL,base:string){
 let [title,description]=pages[url.pathname]||['Page not found | STRIDE Ghana','Find your way back to STRIDE.'];
 let status=pages[url.pathname]?200:404,image=base+'/og/stride-social.png',canonical=base+url.pathname;
 let privatePage=['/account','/saved','/admin'].includes(url.pathname);
 if(url.pathname.startsWith('/product/')){let id='';try{id=decodeURIComponent(url.pathname.slice(9))}catch{}const product=byId.get(id);if(product){status=200;title=product.name+' | STRIDE Ghana';description=(product.description||`Explore ${product.name} from ${product.brand}. Request a quote for price and availability.`).replace(/\s+/g,' ').slice(0,220);image=new URL(product.image,base).href;}else status=404;}
 if(url.pathname==='/shop'){
  const department=departments.find(d=>d.id===url.searchParams.get('department'));
  if(department){title=(url.searchParams.get('category')||department.name)+' | STRIDE Ghana';description=`Explore ${department.name.toLowerCase()} with STRIDE. Discover your next essential and request a quotation.`;canonical+='?department='+encodeURIComponent(department.id);if(url.searchParams.get('category')&&department.categories.includes(url.searchParams.get('category')!))canonical+='&category='+encodeURIComponent(url.searchParams.get('category')!);}
  if(url.searchParams.has('q')||url.searchParams.has('ids'))privatePage=true;
 }
 return {title,description,image,canonical,status,noindex:privatePage||status===404};
}
export function rewriteMetadata(html:string,url:URL,base:string){const meta=routeMetadata(url,base);const tags=`<title>${escape(meta.title)}</title><meta name="description" content="${escape(meta.description)}"/><link rel="canonical" href="${escape(meta.canonical)}"/><meta name="robots" content="${meta.noindex?'noindex, nofollow':'index, follow'}"/><meta property="og:type" content="website"/><meta property="og:site_name" content="STRIDE Ghana"/><meta property="og:title" content="${escape(meta.title)}"/><meta property="og:description" content="${escape(meta.description)}"/><meta property="og:url" content="${escape(meta.canonical)}"/><meta property="og:image" content="${escape(meta.image)}"/><meta property="og:image:alt" content="${escape(meta.title)}"/>${meta.image===base+'/og/stride-social.png'?'<meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/><meta property="og:image:type" content="image/png"/>':''}<meta name="twitter:image:alt" content="${escape(meta.title)}"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${escape(meta.title)}"/><meta name="twitter:description" content="${escape(meta.description)}"/><meta name="twitter:image" content="${escape(meta.image)}"/>`;
 const clean=html.replace(/<title>[\s\S]*?<\/title>/gi,'').replace(/<meta\b[^>]*(?:name=["'](?:description|robots|twitter:[^"']+)["']|property=["']og:[^"']+["'])[^>]*>/gi,'').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'');
 return {html:clean.replace('</head>',tags+'</head>'),...meta};
}
let sitemapCache:{base:string;xml:string}|undefined;
export function sitemap(base:string){if(sitemapCache?.base===base)return sitemapCache.xml;const locations=[...Object.keys(pages).filter(p=>!['/account','/saved','/admin'].includes(p)),...departments.map(d=>'/shop?department='+encodeURIComponent(d.id)),...products.map(p=>'/product/'+encodeURIComponent(p.id))];const xml='<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+locations.map(p=>'<url><loc>'+escape(base+p)+'</loc></url>').join('')+'</urlset>';sitemapCache={base,xml};return xml;}
