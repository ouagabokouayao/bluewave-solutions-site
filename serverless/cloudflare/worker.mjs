import {createLeadHandler} from '../bluewave-leads/handler.mjs';
import {purgeExpiredLeads} from '../bluewave-leads/lead-store.mjs';
import {createDistributedGuard, LeadGuard} from './guard.mjs';
import {createTurnstileVerifier} from './turnstile.mjs';
import {isReady} from './readiness.mjs';
import {createLogger} from '../bluewave-leads/observability.mjs';
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
  if (!clean || clean.event_name==='page_view') return new Response(null,{status:400,headers:noStore});
  const day=new Date().toISOString().slice(0,10);
  await env.CONVERSION_DB.prepare(`INSERT INTO conversion_counts (day,event_name,page,journey,offer,status,source,campaign,count) VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(day,event_name,page,journey,offer,status,source,campaign) DO UPDATE SET count=count+1`).bind(day,clean.event_name,clean.page,clean.journey||'',clean.offer||'',clean.status||'',clean.source||'',clean.campaign||'').run();
  return new Response(null,{status:204,headers:noStore});
 } catch {
  createLogger().log('event_storage_failed',{});
  return new Response(null,{status:503,headers:noStore});
 }
}

export default {
 async scheduled(_event, env) {
  const now = new Date();
  const logger = createLogger();
  // Les deux purges sont indépendantes : l'indisponibilité d'une base ne doit
  // pas empêcher l'autre de s'exécuter, ni échouer en silence.
  if (env.CONVERSION_DB) {
   try {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() - 13;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cutoff = new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay))).toISOString().slice(0,10);
    await env.CONVERSION_DB.prepare('DELETE FROM conversion_counts WHERE day < ?').bind(cutoff).run();
   } catch {
    logger.log('event_storage_failed',{reason:'purge'});
   }
  }
  // Purge des demandes : uniquement si une durée est explicitement configurée.
  // Aucune valeur par défaut n'est choisie ici.
  if (env.LEADS_DB && env.LEAD_RETENTION_DAYS) {
   try {
    const result = await purgeExpiredLeads(env.LEADS_DB, env.LEAD_RETENTION_DAYS, now);
    if (!result.skipped) logger.log('lead_purged',{count:result.purged});
   } catch {
    logger.log('lead_purge_failed',{});
   }
  }
 },
 async fetch(request, env) {
  const url=new URL(request.url);
  if (url.pathname==='/api/leads') {
   if (env.LEADS_ENABLED!=='true') return off();
   try {
    const guard=createDistributedGuard(env,request);
    const captchaVerifier=createTurnstileVerifier(env);
    return await createLeadHandler({environment:env,guard,captchaVerifier,leadStore:env.LEADS_DB ?? null})(request);
   } catch {return off();}
  }
  if (url.pathname==='/api/events') return conversion(request,env,url);
  // Diagnostic d'exploitation : disponibilité seule. Ni binding, ni
  // identifiant de base, ni secret, ni version n'y transparaissent.
  if (url.pathname==='/api/health') {
   if (request.method!=='GET'&&request.method!=='HEAD') return new Response(null,{status:405,headers:noStore});
   const ready=isReady(env);
   return Response.json({status:ready?'available':'unavailable'},{status:ready?200:503,headers:noStore});
  }
  if (url.pathname.startsWith('/api/')) return new Response(null,{status:404,headers:noStore});
  if (url.pathname.startsWith('/bluewave-solutions-site/')) {
   const destination=new URL(url.href);
   destination.pathname=url.pathname.replace(/^\/bluewave-solutions-site/,'') || '/';
   return Response.redirect(destination.href,308);
  }
  if (url.pathname==='/') url.pathname='/index.html';
  const response=await env.ASSETS.fetch(new Request(url,request));
  const headers=new Headers(response.headers);
  Object.entries(noStore).forEach(([name,value])=>{if(name!=='cache-control'&&name!=='x-robots-tag')headers.set(name,value);});
  headers.set('x-robots-tag',env.PUBLIC_INDEXABLE==='true'&&url.pathname!=='/404.html'&&response.status<400?'index, follow':'noindex, nofollow');
  // Turnstile charge son script et rend son défi dans une iframe servie par
  // challenges.cloudflare.com. L'origine n'est ouverte que lorsque le service
  // est réellement activé : fermé, la politique reste aussi étroite qu'avant.
  const turnstileOn = env.TURNSTILE_ENABLED === 'true';
  const scriptSrc = "script-src 'self' https://static.cloudflareinsights.com" + (turnstileOn ? ' https://challenges.cloudflare.com' : '');
  const frameSrc = turnstileOn ? "; frame-src https://challenges.cloudflare.com" : "; frame-src 'none'";
  headers.set('content-security-policy', "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self'; " + scriptSrc + "; connect-src 'self' https://cloudflareinsights.com" + frameSrc);
  headers.set('referrer-policy','strict-origin-when-cross-origin');
  headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
