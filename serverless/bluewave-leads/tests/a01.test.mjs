import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {cleanProvenance, provenanceFromLocation, campaignLink} from '../../../assets/js/provenance.js';
import {validateLeadPayload} from '../validation.mjs';
import {createLeadHandler} from '../handler.mjs';
import {buildLeadRecord, idempotencyKey, storeLead} from '../lead-store.mjs';
import {createMemoryGuard} from '../security.mjs';
import {replayDelivery} from '../replay.mjs';
import {prepareHandoff, validateHumanReview, classifyIncident, createTestAlertSink, stopPlan} from '../../a01/contracts.mjs';
import {transitionContent, reviseContent, prepareSchedule} from '../../a01/editorial.mjs';
import {createNewsletterTestChannel} from '../../a01/newsletter-test-channel.mjs';
import {buildReport} from '../../a01/reporting.mjs';

const campaigns = ['c01-test'];
const stamp = '2026-10-11T09:00:00Z';
const base = {journey:'projet',lead_type:'projet-mission',firstname:'Test',lastname:'Synthétique',email:'qa@example.invalid',
  organisation:'Organisation fictive',organisation_type:'collectivite',territory:'france-mediterranee',
  need_category:'strategie',stage:'cadrage',data_availability:'incertain',desired_outcome:'options',need:'Besoin fictif',
  newsletter_optin_request:false,privacy_acknowledged:true,website:'',
  acquisition_source:'linkedin',campaign_code:'c01-test',landing_page:'projet'};
const organisation = {...base,journey:'collaboration',lead_type:'collaboration-organisation',collaboration_subject:'Étude fictive',domains:['gouvernance-maritime'],collaboration_expectation:'Cadrage fictif'};
const expertise = {...base,journey:'collaboration',lead_type:'expertise-offer',professional_status:'chercheur',expertise_domains:['gouvernance-maritime'],intervention_types:['recherche'],work_languages:['francais'],availability:'ponctuelle',expertise_evidence:'Preuve fictive',motivation:'Contribution fictive'};
const formation = {...base,journey:'formation',lead_type:'formation',audience:'Public fictif',training_subject:'Sujet fictif',learning_objectives:'Objectif fictif',training_format:'distance',period:'Période fictive'};
const env = {BREVO_API_KEY:'synthetic',BREVO_LEADS_LIST_ID:'11',BREVO_ACK_TEMPLATE_ID:'33',BREVO_INTERNAL_TEMPLATE_ID:'44',BLUEWAVE_INTERNAL_EMAIL:'internal@example.invalid',ALLOWED_ORIGIN:'https://example.invalid',ALLOWED_CAMPAIGNS:campaigns.join(',')};
const request = (body, origin = env.ALLOWED_ORIGIN) => new Request('https://example.invalid/api/leads',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const logger = {log:()=>null};
async function databaseTest(run) {
  const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("local");}}',d1Databases:{LEADS_DB:'a01-leads',CONVERSION_DB:'a01-events',NEWSLETTER_TEST_DB:'a01-newsletter'},d1Persist:false});
  try {
    const leads = await mf.getD1Database('LEADS_DB');
    const conversions = await mf.getD1Database('CONVERSION_DB');
    const newsletter = await mf.getD1Database('NEWSLETTER_TEST_DB');
    for (const [db,file] of [[leads,'../../cloudflare/leads-schema.sql'],[conversions,'../../cloudflare/schema.sql'],[newsletter,'../../a01/newsletter-test-schema.sql']]) {
      const sql = await readFile(new URL(file,import.meta.url),'utf8');
      for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await run({leads,conversions,newsletter});
  } finally { await mf.dispose(); }
}

const makeHandler = (leads, extra = {}) => createLeadHandler({environment:env,leadStore:leads,logger,
  now:()=>new Date(stamp),guard:createMemoryGuard({rateLimit:100}),fetchImpl:async()=>new Response('{}',{status:201}),...extra});

test('A01 provenance : allowlist serveur, valeurs inconnues neutralisées et demande conservée',()=>{
  const checked = validateLeadPayload({...base,acquisition_source:'qa@example.invalid',campaign_code:'secret',landing_page:'https://example.invalid/?email=real'},{campaigns});
  assert.equal(checked.ok,true);
  assert.deepEqual(cleanProvenance(checked.value,campaigns),{acquisition_source:'direct',campaign_code:'',landing_page:''});
  assert.equal(validateLeadPayload({...base,crm_stage:'N9'},{campaigns}).ok,false);
  assert.equal(validateLeadPayload(base,{campaigns}).value.campaign_code,'c01-test');
});
test('A01 provenance : aucun identifiant/cookie, lien interne conserve offre et ancre',()=>{
  const p=provenanceFromLocation({search:'?utm_source=linkedin&utm_campaign=c01-test&email=secret',pathname:'/solutions.html',origin:'https://example.invalid'},campaigns);
  assert.deepEqual(p,{acquisition_source:'linkedin',campaign_code:'c01-test',landing_page:'solutions'});
  const link=new URL(campaignLink('https://example.invalid/projet.html?offre=note-strategique#form','https://example.invalid',p));
  assert.equal(link.searchParams.get('offre'),'note-strategique');assert.equal(link.hash,'#form');
  assert.equal(link.searchParams.has('email'),false);
  assert.equal(campaignLink('https://external.invalid/a.html','https://example.invalid',p),'https://external.invalid/a.html');
});
test('A01 provenance : changement campagne ne contourne pas idempotence métier',async()=>{
  assert.equal(await idempotencyKey(base,new Date(stamp)),await idempotencyKey({...base,campaign_code:'other',acquisition_source:'qr'},new Date(stamp)));
});

test('A01 E2E local natif : Projet, Organisation, Expertise, Formation et qualification',async()=>{
  await databaseTest(async({leads,conversions})=>{
    let calls=0;
    const handle=makeHandler(leads,{fetchImpl:async()=>{calls++;return new Response('{}',{status:201});}});
    for(const payload of [base,organisation,expertise,formation,{...formation,email:'presentiel@example.invalid',training_format:'presentiel',location:'Lieu fictif'},{...formation,email:'hybride@example.invalid',training_format:'hybride',location:'Lieu fictif'},{...base,recommended_offer:'atelier-cadrage',need:'Qualification fictive'}]) {
      const response=await handle(request(payload));assert.equal(response.status,201);
      assert.equal((await response.json()).success,true);
      assert.equal((await handle(request(payload))).status,409);
    }
    const rows=(await leads.prepare('SELECT * FROM lead_records').all()).results;
    assert.equal(rows.length,7);assert.equal(calls,21);
    for(const row of rows) {
      assert.equal(row.delivery_status,'DELIVERED');
      assert.equal(JSON.parse(row.journey_payload).campaign_code,'c01-test');
      assert.equal(JSON.parse(row.journey_payload).acquisition_source,'linkedin');
    }
    await assert.rejects(()=>conversions.prepare('SELECT * FROM lead_records').all());
    for(const field of ['email','ip','lead_id','journey_payload']) await assert.rejects(()=>conversions.prepare(`SELECT ${field} FROM conversion_counts`).all());
    const permissive={allowRate:()=>true,claimSubmission:()=>true};
    assert.equal((await makeHandler(leads,{guard:permissive})(request({...base,campaign_code:'unknown'}))).status,200);
    assert.equal((await leads.prepare('SELECT COUNT(*) AS count FROM lead_records').all()).results[0].count,7);
  });
});
test('A01 E2E local : 400,403,429,503 ne déclenchent aucun Brevo',async()=>{
  await databaseTest(async({leads})=>{
    let calls=0;const fetchImpl=async()=>{calls++;throw new Error('Aucun appel attendu');};
    assert.equal((await makeHandler(leads,{fetchImpl})(request({...base,email:'invalid'}))).status,400);
    assert.equal((await makeHandler(leads,{fetchImpl})(request(base,'https://wrong.invalid'))).status,403);
    assert.equal((await makeHandler(leads,{fetchImpl,captchaVerifier:async()=>false})(request(base))).status,403);
    assert.equal((await makeHandler(leads,{fetchImpl,guard:{allowRate:()=>false}})(request(base))).status,429);
    const broken={prepare(){throw new Error('stockage indisponible');}};
    assert.equal((await makeHandler(broken,{fetchImpl})(request(base))).status,503);
    assert.equal(calls,0);
  });
});
test('A01 E2E : 201 PARTIAL_FAILURE, DRY RUN puis reprise de notification seule',async()=>{
  await databaseTest(async({leads})=>{
    let count=0;
    assert.equal((await makeHandler(leads,{fetchImpl:async()=>new Response('{}',{status:++count===3?503:201})})(request(organisation))).status,201);
    const row=(await leads.prepare('SELECT * FROM lead_records').all()).results[0];
    assert.equal(row.delivery_status,'PARTIAL_FAILURE');assert.equal(row.ack_status,'OK');
    assert.deepEqual((await replayDelivery(leads,row.id)).steps,['internal_notification']);
    let replays=0;
    const opts={environment:env,logger,dryRun:false,fetchImpl:async()=>{replays++;return new Response('{}',{status:201});}};
    assert.equal((await replayDelivery(leads,row.id,opts)).delivery_status,'DELIVERED');
    await replayDelivery(leads,row.id,opts);assert.equal(replays,1);
  });
});
test('A01 CRM : remise sensible désactivée par défaut, clé unique, aucune promotion',async()=>{
  const record=await buildLeadRecord(validateLeadPayload(base,{campaigns}).value,{now:new Date(stamp)});
  assert.deepEqual(prepareHandoff([record]),{enabled:false,items:[]});
  const result=prepareHandoff([record],{enabled:true,campaigns});
  assert.equal(result.master_crm_written,false);assert.equal(result.items[0].review_status,'PENDING_REVIEW');
  assert.equal(result.items[0].crm_id,null);assert.equal(result.items[0].next_action_at,null);
  assert.equal(result.sensitive,false);assert.equal(JSON.stringify(result).includes(base.email),false);
  assert.throws(()=>prepareHandoff([record],{enabled:true,includeContact:true}),/Autorisation/);
  assert.throws(()=>prepareHandoff([record],{enabled:true,includeContact:true,contactAccessApprovedBy:'03'}),/Autorisation/);
  assert.throws(()=>prepareHandoff([record,record],{enabled:true}),/Doublon/);
  assert.throws(()=>validateHumanReview({lead_id:record.id,stage:'N5'}),/03/);
  assert.throws(()=>validateHumanReview({owner:'03',lead_id:record.id,reviewed_at:stamp,stage:'N5',evidence_ref:'test'}),/besoin/);
  assert.throws(()=>validateHumanReview({owner:'03',lead_id:record.id,reviewed_at:stamp,stage:'N9',evidence_ref:'test'}),/Contrat/);
});
test('A01 alertes : gravité, cooldown, échec/reprise, aucune PII',async()=>{
  const messages=[];let fail=true;
  const alert=createTestAlertSink({sink:async record=>{if(fail)throw new Error('canal indisponible');messages.push(record);},now:()=>Date.parse(stamp)});
  const details={correlation_id:'synthetic-run',email:base.email,need:base.need,ip:'192.0.2.1',api_key:'secret'};
  assert.equal((await alert('ack_failed',details)).reason,'alert_transport_failed');fail=false;
  assert.equal((await alert('ack_failed',details)).sent,true);
  assert.equal((await alert('ack_failed',details)).reason,'cooldown');
  assert.equal(messages[0].severity,'MAJOR');assert.doesNotMatch(JSON.stringify(messages),/qa@example|Besoin fictif|192\.0|secret/);
  assert.equal(classifyIncident('lead_storage_failed',{},stamp).action,'STOP_LEADS');
  assert.equal(classifyIncident('delivery_status_write_failed',{},stamp).action,'RECONCILE_BEFORE_REPLAY');
  assert.deepEqual(stopPlan({leads:true}).changes,{LEADS_ENABLED:'false'});
  assert.equal(stopPlan().delete_data,false);
});

const content={content_id:'c01-synthetic',version_hash:'a'.repeat(64),networks:['linkedin'],assets:[{asset_id:'synthetic-asset',rights_approved:true}],status:'DRAFT',source:'linkedin',campaign_code:'c01-test',destination:'https://example.invalid/projet.html?offre=note-strategique',scheduled_at:'2026-10-12T09:00:00Z'};
test('A01 C01 : DRAFT→REVIEW→APPROVED lié au hash ; aucun PROGRAMMÉ',()=>{
  const review=transitionContent(content,'REVIEW');
  const approved=transitionContent(review,'APPROVED',{reviewer:'02',approved_at:stamp});
  assert.equal(prepareSchedule([content],{campaigns,approvedOrigins:['https://example.invalid']}).plans[0].ready_for_manual_execution,false);
  assert.equal(prepareSchedule([approved],{campaigns,approvedOrigins:['https://example.invalid']}).plans[0].ready_for_manual_execution,false);
  const result=prepareSchedule([approved],{campaigns,enabled:true,go:{owner:'Joseph',reference:'go-test',content_id:content.content_id,version_hash:content.version_hash,account_ids:['test-account']},accounts:[{account_id:'test-account',network:'linkedin',authorized:true}],approvedOrigins:['https://example.invalid']});
  assert.equal(result.external_calls,0);assert.equal(result.plans[0].status,'DRY_RUN');assert.equal(result.plans[0].scheduled_id,null);
  assert.equal(result.plans[0].ready_for_manual_execution,true);
  assert.equal(reviseContent(approved,'b'.repeat(64)).approved_hash,null);
  assert.throws(()=>prepareSchedule([{...approved,version_hash:'b'.repeat(64)}],{campaigns,approvedOrigins:['https://example.invalid']}),/version/);
  assert.throws(()=>prepareSchedule([approved,approved],{campaigns,approvedOrigins:['https://example.invalid']}),/Doublon/);
  assert.throws(()=>prepareSchedule([{...approved,scheduled_id:'existing'}],{campaigns,approvedOrigins:['https://example.invalid']}),/déjà/);
});
test('A01 reporting : source→CTA→demande→revue 03→N5 ou contrat, aucune identité exportée',async()=>{
  const record=await buildLeadRecord(validateLeadPayload(base,{campaigns}).value,{now:new Date(stamp)});
  const review={owner:'03',lead_id:record.id,reviewed_at:'2026-10-11T10:00:00Z',stage:'N5',evidence_ref:'review-test',need_evidence_ref:'need-test',next_action_at:'2026-10-12T09:00:00Z'};
  const event={occurred_at:stamp,event_name:'journey_cta_click',page:'projet',source:'linkedin',campaign:'c01-test',count:4};
  const options={from:'2026-10-11T00:00:00Z',to:'2026-10-12T00:00:00Z',campaigns,leads:[record],reviews:[review],events:[event,{...event,event_name:'lead_submit_fallback_email',count:2}]};
  const report=buildReport(options);assert.equal(report.counts[0].accepted_requests,1);assert.equal(report.counts[0].n5,0);assert.equal(report.counts[0].fallback_events,2);
  const text=JSON.stringify(report);for(const value of [base.email,base.firstname,record.id,base.need])assert.equal(text.includes(value),false);
  const n9={...review,stage:'N9',reviewed_at:'2026-10-11T11:00:00Z',contract_evidence_ref:'contract-test',contract_at:'2026-10-11T10:30:00Z'};
  const contracted=buildReport({...options,reviews:[review,n9]});assert.equal(contracted.counts[0].proven_contracts,0);assert.equal(contracted.counts[0].pipeline_n5_n8,0);assert.equal(contracted.signed_revenue,null);
  assert.throws(()=>buildReport({...options,events:[{...event,email:base.email}]}),/invalide/);
  assert.throws(()=>buildReport({...options,leads:[record,record]}),/Doublon/);
  assert.throws(()=>buildReport({...options,reviews:[{...n9,contract_evidence_ref:null}]}),/Contrat/);
});

function testTransport() {
  const sent=[];const subscribed=[];const unsubscribed=[];const prefs=[];
  return {testOnly:true,sent,subscribed,unsubscribed,prefs,async sendConfirmation(email,token){sent.push({email,token});},async subscribe(email,options){subscribed.push({email,options});},async unsubscribe(email){unsubscribed.push(email);},async updatePreferences(email,preferences){prefs.push({email,preferences});}};
}
test('A01 newsletter E2E D1 : consentement distinct, confirmation, rejeu, préférences et retrait',async()=>{
  await databaseTest(async({newsletter,leads})=>{
    const transport=testTransport();const secret='s'.repeat(40);
    let clock=Date.parse(stamp);
    const channel=createNewsletterTestChannel({database:newsletter,transport,secret,testOnly:true,now:()=>clock});
    const input={email:'newsletter@example.invalid',consent:true,notice_version:'notice-test-v1',consent_source:'newsletter-dedicated',preferences:['veille']};
    assert.equal((await channel.request({...input,consent:false})).ok,false);assert.equal(transport.sent.length,0);
    await assert.rejects(()=>channel.request({...input,email:'real@example.com'}),/synthétique/);
    const first=await channel.request(input);assert.equal(first.step,'CONFIRM_SENT');assert.equal(transport.subscribed.length,0);
    assert.equal((await channel.request(input)).ok,false);assert.equal(transport.sent.length,1);
    const token=transport.sent[0].token;
    const [one,two]=await Promise.all([channel.confirm(token),channel.confirm(token)]);
    assert.equal([one,two].filter(r=>r.ok).length,1);assert.equal(transport.subscribed.length,1);
    const management=[one,two].find(r=>r.ok).management_token;
    assert.equal((await channel.preferences(token,['formations'])).ok,false);
    assert.equal((await channel.preferences(management,['formations'])).ok,true);
    assert.equal((await channel.revoke(management)).step,'REVOKED');assert.equal(transport.unsubscribed.length,1);
    assert.equal((await channel.confirm(token)).ok,false);assert.equal((await channel.preferences(management,[])).ok,false);
    assert.equal((await channel.revoke(management)).ok,false);
    const stored=(await newsletter.prepare('SELECT * FROM newsletter_test_consents').all()).results[0];
    assert.equal(stored.state,'REVOKED');assert.equal(stored.notice_version,'notice-test-v1');assert.ok(stored.confirmed_at && stored.revoked_at);
    await assert.rejects(()=>leads.prepare('SELECT * FROM newsletter_test_consents').all());
    const next=await channel.request({...input,email:'expired@example.invalid'});assert.equal(next.ok,true);
    clock+=86401000;assert.equal((await channel.confirm(transport.sent.at(-1).token)).reason,'expired');
  });
});
test('A01 newsletter : transport refusé sans mode test, panne/reprise et retrait avant fournisseur',async()=>{
  assert.throws(()=>createNewsletterTestChannel({}),/test/);
  await databaseTest(async({newsletter})=>{
    const transport=testTransport();let failSubscribe=true;let failUnsub=true;
    transport.subscribe=async()=>{if(failSubscribe)throw new Error('panne fictive');};
    transport.unsubscribe=async()=>{if(failUnsub)throw new Error('panne fictive');};
    const channel=createNewsletterTestChannel({database:newsletter,transport,secret:'s'.repeat(40),testOnly:true});
    const first=await channel.request({email:'retry@example.invalid',consent:true,notice_version:'notice-test',consent_source:'newsletter-dedicated'});
    const token=transport.sent[0].token;
    assert.equal((await channel.confirm(token)).reason,'subscription_transport_failed');failSubscribe=false;
    const confirmed=await channel.confirm(token);assert.equal(confirmed.ok,true);
    assert.equal((await channel.revoke(confirmed.management_token)).step,'REVOKING');
    assert.equal((await channel.preferences(confirmed.management_token,[])).ok,false);
    failUnsub=false;assert.equal((await channel.retryRevocation(first.consent_id)).step,'REVOKED');
  });
});

test('A01 front réel : endpoint OFF sans POST, provenance ajoutée au même contrat pour les parcours',async()=>{
  const previous={window:globalThis.window,document:globalThis.document,location:globalThis.location,fetch:globalThis.fetch};
  const config={lead_endpoint:null,newsletter_enabled:false,turnstile_enabled:false};
  const posts=[];const listeners=[];
  const location={href:new URL('../../../projet.html',import.meta.url).href,origin:'https://example.invalid',protocol:'https:',pathname:'/projet.html',search:'?offre=note-strategique&utm_source=linkedin&utm_campaign=c01-test&bw_landing=solutions'};
  const fetchImpl=async(url,options={})=>{
    if(url==='data/automation-config.json')return {ok:true,json:async()=>config};
    if(url==='data/analytics-config.json')return {ok:true,json:async()=>({enabled:false,campaigns})};
    assert.equal(url,'https://example.invalid/api/leads');assert.equal(options.method,'POST');
    posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true})};
  };
  globalThis.location=location;globalThis.fetch=fetchImpl;
  globalThis.document={referrer:'',querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>listeners.push({name,fn})};
  globalThis.window={location,navigator:{},fetch:fetchImpl,dispatchEvent:()=>true};
  try {
    await import('../../../assets/js/automation.js');
    assert.deepEqual(await window.BlueWaveAutomation.submit('lead',base),{configured:false});assert.equal(posts.length,0);
    config.lead_endpoint='/api/leads';
    for(const payload of [base,organisation,expertise,formation])assert.equal((await window.BlueWaveAutomation.submit('lead',payload)).ok,true);
    assert.equal(posts.length,4);
    for(const payload of posts){assert.equal(payload.campaign_code,'c01-test');assert.equal(payload.landing_page,'solutions');assert.equal(validateLeadPayload(payload,{campaigns}).ok,true);}
    config.lead_endpoint='https://external.invalid/api/leads';
    await assert.rejects(()=>window.BlueWaveAutomation.submit('lead',base),/sécurisé/);assert.equal(posts.length,4);
  } finally {Object.assign(globalThis,previous);}
});
test('A01 STOP Worker : API fermée 503, aucun transport ni binding requis',async()=>{
  const {default:worker}=await import('../../cloudflare/worker.mjs');
  const response=await worker.fetch(request(base),{LEADS_ENABLED:'false'});
  assert.equal(response.status,503);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.equal((await worker.fetch(new Request('https://example.invalid/api/newsletter'),{})).status,404);
});
test('A01 incident réel du handler : journal expurgé et alerte locale de panne partielle',async()=>{
  const {createIncidentLogger}=await import('../../a01/contracts.mjs');
  await databaseTest(async({leads})=>{
    const journal=[];const alerts=[];
    const incidentLogger=createIncidentLogger({journal:record=>journal.push(record),alert:createTestAlertSink({sink:async record=>alerts.push(record)})});
    let calls=0;
    const handle=makeHandler(leads,{logger:incidentLogger,fetchImpl:async()=>new Response('{}',{status:++calls===3?503:201})});
    assert.equal((await handle(request(base))).status,201);await incidentLogger.flush();
    assert.equal(alerts.length,1);assert.equal(alerts[0].event,'internal_notification_failed');
    const text=JSON.stringify({journal,alerts});assert.equal(text.includes(base.email),false);assert.equal(text.includes(base.need),false);
  });
});
test('A01 newsletter : panne confirmation, clé stable de reprise, expiration renouvelable',async()=>{
  await databaseTest(async({newsletter})=>{
    let clock=Date.parse(stamp);let failed=true;const calls=[];
    const transport=testTransport();
    transport.sendConfirmation=async(email,token,options)=>{calls.push({token,key:options.idempotency_key});if(failed)throw new Error('panne fictive');};
    const channel=createNewsletterTestChannel({database:newsletter,transport,secret:'s'.repeat(40),testOnly:true,now:()=>clock});
    const input={email:'confirm-retry@example.invalid',consent:true,notice_version:'notice-test',consent_source:'dedicated-test'};
    assert.equal((await channel.request(input)).reason,'confirmation_transport_failed');failed=false;
    assert.equal((await channel.request(input)).step,'CONFIRM_SENT');
    assert.equal(calls[0].key,calls[1].key);assert.equal(calls[0].token,calls[1].token);
    clock+=86401000;assert.equal((await channel.confirm(calls[1].token)).reason,'expired');
    assert.equal((await channel.request(input)).step,'CONFIRM_SENT');assert.notEqual(calls[2].key,calls[1].key);
  });
});

test('A01 CLI : exports exploitables hors dépôt, permissions restreintes et aucun écrasement',async()=>{
  const {mkdtemp,writeFile,readFile,stat,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const directory=await mkdtemp(join(tmpdir(),'bluewave-a01-'));
  const cli=new URL('../../a01/prepare.mjs',import.meta.url);
  const record=await buildLeadRecord(validateLeadPayload(base,{campaigns}).value,{now:new Date(stamp)});
  try {
    for(const [kind,input] of [['handoff',{records:[record],campaigns}],['schedule',{contents:[content],options:{campaigns}}],['report',{from:'2026-10-11T00:00:00Z',to:'2026-10-12T00:00:00Z',leads:[record],campaigns}]]) {
      const inputPath=join(directory,`${kind}-input.json`),outputPath=join(directory,`${kind}-output.json`);
      await writeFile(inputPath,JSON.stringify(input));
      const args=[cli.pathname,kind,inputPath,outputPath];
      execFileSync(process.execPath,args);
      const result=JSON.parse(await readFile(outputPath,'utf8'));
      assert.equal((await stat(outputPath)).mode&0o777,0o600);
      if(kind==='handoff')assert.equal(result.master_crm_written,false);
      if(kind==='schedule')assert.equal(result.external_calls,0);
      if(kind==='report')assert.equal(result.counts[0].accepted_requests,1);
      assert.throws(()=>execFileSync(process.execPath,args,{stdio:'ignore'}));
      assert.throws(()=>execFileSync(process.execPath,[cli.pathname,kind,inputPath,new URL('../../../unsafe-export.json',import.meta.url).pathname],{stdio:'ignore'}));
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('A01 qualification historique : provenance rétrocompatible pour Collaboration et Formation',async()=>{
  await databaseTest(async({leads})=>{
    const handle=makeHandler(leads);
    for(const type of ['collaboration','formation']) {
      const payload={firstname:'Test',lastname:'Synthétique',email:'legacy@example.invalid',organisation:'Organisation fictive',type,
        geography:'france-mediterranee',themes:['gouvernance-maritime'],need:`Qualification ${type} fictive`,deadline:'nondef',contact_preference:'email',
        source:'SITE_QUALIFIER',newsletter_consent:false,privacy_acknowledged:true,website:'',captcha_token:'',
        acquisition_source:'linkedin',campaign_code:'c01-test',landing_page:'qualifier-un-besoin'};
      assert.equal(validateLeadPayload(payload,{campaigns}).ok,true);
      assert.equal((await handle(request(payload))).status,201);
    }
    const rows=(await leads.prepare('SELECT * FROM lead_records').all()).results;
    assert.equal(rows.length,2);
    for(const row of rows)assert.equal(JSON.parse(row.journey_payload).campaign_code,'c01-test');
  });
});

test('A01 CSV C01 : 12 colonnes conservées, aucun statut/date indicative transformé en programmation',async()=>{
  const {C01_COLUMNS,importC01Calendar}=await import('../../a01/calendar.mjs');
  const row=['C01-TEST','2026-10-13','S01','Pilier fictif','Série fictive','"Sujet; avec séparateur"','Post fictif','Compte à vérifier','Aucun','CTA fictif','PRÊT À PRÉPARER','GO requis'];
  const csv=`${C01_COLUMNS.join(';')}\r\n${row.join(';')}\r\n`;
  const result=await importC01Calendar(csv);assert.equal(result.rows,1);assert.equal(result.columns,12);
  assert.equal(result.contents[0].source_row.Sujet,'Sujet; avec séparateur');
  assert.equal(result.contents[0].source_row['État'],'PRÊT À PRÉPARER');
  assert.equal(result.contents[0].status,'DRAFT');assert.equal(result.contents[0].scheduled_id,null);
  assert.equal(result.calendar_modified,false);assert.equal(result.external_calls,0);
  await assert.rejects(()=>importC01Calendar(csv+row.join(';')),/doublon/);
  await assert.rejects(()=>importC01Calendar(csv.replace('Date indicative','Date')),/Colonnes/);
});
