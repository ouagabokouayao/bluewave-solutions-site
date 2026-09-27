import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

const root=new URL('../../../',import.meta.url);
const compiled=await readFile(new URL('../../../quality/reports/cloudflare-worker-build/worker-native.js',import.meta.url),'utf8');
const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
const assets=new URL('../../../dist/',import.meta.url).pathname;
const origin='https://preview.example.invalid';
const testEnvironment={
  ALLOWED_ORIGIN:origin, BREVO_API_KEY:'local-test-only', BREVO_LEADS_LIST_ID:'11',
  BREVO_NEWSLETTER_LIST_ID:'22', BREVO_ACK_TEMPLATE_ID:'33', BREVO_INTERNAL_TEMPLATE_ID:'44',
  BLUEWAVE_INTERNAL_EMAIL:'internal@example.invalid', GUARD_HMAC_KEY:'local-test-guard-key-01234567890123456789',
  LEADS_ENABLED:'false', EVENTS_ENABLED:'false', NEWSLETTER_ENABLED:'false'
};
const validLead={firstname:'Test',lastname:'Local',email:'lead@example.invalid',organisation:'BlueWave test',type:'projet-mission',geography:'cote-divoire',themes:['littoral-adaptation'],need:'Besoin local',deadline:'3-6m',contact_preference:'email',source:'SITE_QUALIFIER',newsletter_consent:false,privacy_acknowledged:true,website:'bot'};
function runtime(flags={}) {
 return new Miniflare({cf:false,workers:[{modules:true,script:compiled,compatibilityDate:'2026-08-06',assets:{directory:assets,binding:'ASSETS',routerConfig:{invoke_user_worker_ahead_of_assets:true,has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'404-page'}},d1Databases:['CONVERSION_DB'],durableObjects:{LEAD_GUARD:{className:'LeadGuard',useSQLite:true}},bindings:{...testEnvironment,...flags}}]});
}
function post(path,body,headers={}) {
 return {method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.42',...headers},body:JSON.stringify(body)};
}
const off=runtime();
try {
 const html=await off.dispatchFetch(`${origin}/`);
 assert.equal(html.status,200);
 assert.match(await html.text(),/<html lang="fr">/);
 assert.equal(html.headers.get('x-robots-tag'),'noindex, nofollow');
 assert.match(html.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
 assert.equal(html.headers.has('set-cookie'),false);
 assert.equal((await off.dispatchFetch(`${origin}/robots.txt`)).status,200);
 assert.equal((await off.dispatchFetch(`${origin}/api/leads`,post('/api/leads',validLead))).status,503);
 assert.equal((await off.dispatchFetch(`${origin}/api/events`,post('/api/events',{event_name:'page_view',page:'index'}))).status,503);
 assert.equal((await off.dispatchFetch(`${origin}/api/private`)).status,404);
 const bindings=await off.getBindings();
 assert.ok(bindings.ASSETS && bindings.CONVERSION_DB && bindings.LEAD_GUARD);
 console.log('PASS: workerd, static assets, bindings, noindex, APIs OFF');
} finally {await off.dispose();}

const on=runtime({LEADS_ENABLED:'true',EVENTS_ENABLED:'true'});
try {
 const db=await on.getD1Database('CONVERSION_DB');
 await db.prepare(schema).run();
 const event={event_name:'qualifier_complete',page:'qualifier-un-besoin',journey:'projet',offer:'note-strategique',source:'direct'};
 assert.equal((await on.dispatchFetch(`${origin}/api/events`,post('/api/events',event))).status,204);
 assert.equal((await on.dispatchFetch(`${origin}/api/events`,post('/api/events',event))).status,204);
 for (const invalid of [{...event,email:'pii@example.invalid'}, {...event,need:'texte libre'}, {...event,campaign:'unapproved'}]) {
  assert.equal((await on.dispatchFetch(`${origin}/api/events`,post('/api/events',invalid))).status,400);
 }
 assert.equal((await on.dispatchFetch(`${origin}/api/events`,post('/api/events',event,{origin:'https://malicious.example.invalid'}))).status,403);
 const counts=await db.prepare('SELECT * FROM conversion_counts').all();
 assert.equal(counts.results.length,1);
 assert.equal(counts.results[0].count,2);
 assert.doesNotMatch(JSON.stringify(counts),/pii@example|texte libre|192\.0\.2|user-agent/i);
 const lead=await on.dispatchFetch(`${origin}/api/leads`,post('/api/leads',validLead));
 assert.equal(lead.status,200); // Honeypot stops before an external Brevo request.
 assert.equal((await on.dispatchFetch(`${origin}/api/leads`,post('/api/leads',{...validLead,website:'',newsletter_consent:true}))).status,400);
 const guard=(await on.getBindings()).LEAD_GUARD;
 const id=guard.idFromName('concurrency-test');
 const stub=guard.get(id);
 const key='a'.repeat(64);
 const claims=await Promise.all(Array.from({length:12},()=>stub.fetch('https://guard.internal/',{method:'POST',body:JSON.stringify({action:'claim',key})})));
 const outcomes=await Promise.all(claims.map(response=>response.json()));
 assert.equal(outcomes.filter(x=>x.ok).length,1);
 const rates=await Promise.all(Array.from({length:12},()=>stub.fetch('https://guard.internal/',{method:'POST',body:JSON.stringify({action:'rate',key})})));
 const windows=await Promise.all(rates.map(response=>response.json()));
 assert.equal(windows.filter(x=>x.ok).length,5);
 assert.ok((await on.listDurableObjectIds('LEAD_GUARD')).length >= 1);
 console.log('PASS: workerd D1 aggregated/no PII, DO concurrent persistent guard, lead honeypot, newsletter gate');
} finally {await on.dispose();}
