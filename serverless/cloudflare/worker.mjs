import {createLeadHandler} from '../bluewave-leads/handler.mjs';
import {createDistributedGuard, LeadGuard} from './guard.mjs';
import {sanitizeEvent} from '../../assets/js/analytics.js';
export {LeadGuard};

const noStore = {'cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'};
const off = () => Response.json({success:false}, {status:503,headers:noStore});
const allowOrigin = (request, url) => request.headers.get('origin') === url.origin;

async function readLimited(request, max) {
 const length = Number(request.headers.get('content-length') || 0);
 if (length > max) return {tooLarge:true};
 const reader = request.body?.getReader();
 if (!reader) return {invalid:true};
 const chunks=[]; let size=0;
 for (;;) {
  const {done,value}=await reader.read();
  if (done) break;
  size+=value.byteLength;
  if (size>max) {await reader.cancel();return {tooLarge:true};}
  chunks.push(value);
 }
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
 return {raw:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}

async function conversion(request, env, url) {
 if (env.EVENTS_ENABLED !== 'true' || !env.CONVERSION_DB) return off();
 if (request.method !== 'POST') return new Response(null,{status:405,headers:noStore});
 if (!allowOrigin(request,url) || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return new Response(null,{status:403,headers:noStore});
 try {
  const body=await readLimited(request,2048);
  if (body.tooLarge) return new Response(null,{status:413,headers:noStore});
  if (body.invalid) return new Response(null,{status:400,headers:noStore});
  let input;
  try {input=JSON.parse(body.raw);} catch {return new Response(null,{status:400,headers:noStore});}
  const campaigns=(env.ALLOWED_CAMPAIGNS || '').split(',').filter(code=>/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code));
  const clean=sanitizeEvent(input,campaigns);
  if (!clean) return new Response(null,{status:400,headers:noStore});
  const day=new Date().toISOString().slice(0,10);
  await env.CONVERSION_DB.prepare(`INSERT INTO conversion_counts (day,event_name,page,journey,offer,status,source,campaign,count) VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(day,event_name,page,journey,offer,status,source,campaign) DO UPDATE SET count=count+1`).bind(day,clean.event_name,clean.page,clean.journey||'',clean.offer||'',clean.status||'',clean.source||'',clean.campaign||'').run();
  return new Response(null,{status:204,headers:noStore});
 } catch {return new Response(null,{status:503,headers:noStore});}
}

export default {
 async fetch(request, env) {
  const url=new URL(request.url);
  if (url.pathname==='/api/leads') {
   if (env.LEADS_ENABLED!=='true') return off();
   try {
    const guard=createDistributedGuard(env,request);
    return await createLeadHandler({environment:env,guard})(request);
   } catch {return off();}
  }
  if (url.pathname==='/api/events') return conversion(request,env,url);
  if (url.pathname.startsWith('/api/')) return new Response(null,{status:404,headers:noStore});
  if (url.pathname.startsWith('/bluewave-solutions-site/')) {
   const destination=new URL(url.href);
   destination.pathname=url.pathname.replace(/^\/bluewave-solutions-site/,'') || '/';
   return Response.redirect(destination.href,308);
  }
  if (url.pathname==='/') url.pathname='/index.html';
  const response=await env.ASSETS.fetch(new Request(url,request));
  const headers=new Headers(response.headers);
  Object.entries(noStore).forEach(([name,value])=>{if(name!=='cache-control')headers.set(name,value);});
  headers.set('content-security-policy', "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com");
  headers.set('referrer-policy','strict-origin-when-cross-origin');
  headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
