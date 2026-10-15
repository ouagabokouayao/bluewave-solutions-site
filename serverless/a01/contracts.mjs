// Interfaces internes de préparation A01. Aucun client réseau ni écriture CRM.
import {cleanProvenance} from '../../assets/js/provenance.js';
import {buildLogRecord} from '../bluewave-leads/observability.mjs';
import {verifyContactGrant, verifyEvidence} from './secure-review.mjs';

const CODE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;
export const isCode = value => typeof value === 'string' && CODE.test(value);
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export function provenanceOf(record, campaigns = []) {
  let payload = {};
  try { payload = JSON.parse(record.journey_payload || '{}'); } catch { /* anciennes lignes */ }
  return cleanProvenance(payload, campaigns);
}

// The handoff never writes CRM or grants CRM IDs. Nominal data require a
// signed, unexpired and non-revoked grant checked with a server-owned key.
const OFFERS = new Set(['diagnostic-strategique','vulnerabilite-cotiere','gouvernance-acteurs',
 'structuration-projet','formation-capacites','note-strategique','atelier-cadrage']);
const NEED_CATEGORIES = new Set(['vulnerabilite','strategie','gouvernance','sfn','projet','planification','formation','collaboration','expertise','multiple','indetermine']);
const normalize = value => String(value||'').normalize('NFKC').trim().toLocaleLowerCase('fr').replace(/\s+/g,' ');
export function prepareHandoff(records, {campaigns = [], enabled = false, includeContact = false,
  authorization = null, authorizationKey = null, isRevoked = null, checkPrivacy = null, now = new Date().toISOString(),
  existingActors = [], reviewDays = 7} = {}) {
  if (!enabled) return {enabled:false, items:[]};
  requireValue(Array.isArray(records) && Number.isInteger(reviewDays) && reviewDays>=1 && reviewDays<=30, 'File de revue invalide');
  if (includeContact) requireValue(verifyContactGrant(authorization,{key:authorizationKey,now,isRevoked,checkPrivacy}),
    'Autorisation nominative vérifiable requise');
  const unique = new Map(), possibleMatches = new Map();
  const prepared = records.map(record => {
    requireValue(isCode(record.id) && isDate(record.created_at), 'Demande enregistrée requise');
    requireValue(!unique.has(record.id), 'Doublon lead_id');
    unique.set(record.id,true);
    const offer_code = [record.recommended_offer,record.offer_code].find(code=>OFFERS.has(code))||null;
    const review_due_at = new Date(Date.parse(record.created_at)+reviewDays*86400000).toISOString();
    const item = {lead_id:record.id,received_at:record.created_at,owner:'03',review_status:'PENDING_REVIEW',
      actor_match_status:'UNMATCHED',actor_id:null,duplicate_candidate:false,possible_existing_actor_id:null,
      crm_id:null,offer_code, next_action_at:null,review_due_at,evidence_ref:null,
      need_evidence_ref:null,contract_evidence_ref:null,source_proof:`lead:${record.id}`,
      date_verification:null,journey:record.journey,lead_type:record.lead_type,
      ...provenanceOf(record,campaigns),delivery_status:record.delivery_status};
    if (includeContact) {
      item.contact = {firstname:String(record.firstname||''),lastname:String(record.lastname||''),
        email:String(record.email||''),organisation:String(record.organisation||'')};
      // Only closed business fields; free-text journey_payload is NEVER copied.
      item.need_summary={need_category:NEED_CATEGORIES.has(record.need_category)?record.need_category:null};
      const email=normalize(record.email),org=normalize(record.organisation);
      const key=email&&org?`${email}|${org}`:null;
      const match=key ? existingActors.find(actor=>normalize(actor.email)===email && normalize(actor.organisation)===org && isCode(actor.actor_id)) : null;
      if(match){item.duplicate_candidate=true;item.actor_match_status='DUPLICATE_CANDIDATE';item.possible_existing_actor_id=match.actor_id;}
      const previous=key?possibleMatches.get(key):null;
      if(previous){item.duplicate_candidate=true;item.actor_match_status='DUPLICATE_CANDIDATE';previous.duplicate_candidate=true;previous.actor_match_status='DUPLICATE_CANDIDATE';}
      if(key)possibleMatches.set(key,item);
    }
    return item;
  });
  return {enabled:true,sensitive:includeContact,master_crm_written:false,items:prepared};
}

// Syntax and chronology are necessary but NOT proof of an N5/N9 commercial fact.
// The trusted proof resolver, when available, must verify the actual document.
export function validateHumanReview(review,{lead=null,resolveEvidence=null}={}) {
  requireValue(review?.owner === '03' && isCode(review.lead_id) && isDate(review.reviewed_at), 'Revue humaine 03 requise');
  requireValue(/^N[0-9]$/.test(review.stage) && isCode(review.evidence_ref), 'Stade et preuve requis');
  if (['N5','N6','N7','N8'].includes(review.stage)) requireValue(isCode(review.need_evidence_ref), 'Preuve de besoin explicite requise');
  if (review.stage === 'N9') requireValue(isCode(review.contract_evidence_ref) && isDate(review.contract_at), 'Contrat prouvé requis');
  const closed = review.closure_reason && isCode(review.closure_reason);
  if(review.stage!=='N9'&&!closed)requireValue(isDate(review.next_action_at),'Prochaine action datée requise');
  if(review.next_action_at)requireValue(isDate(review.next_action_at)&&Date.parse(review.next_action_at)>=Date.parse(review.reviewed_at),'Chronologie prochaine action invalide');
  if(closed)requireValue(!review.next_action_at,'Clôture sans prochaine action requise');
  if(review.stage==='N9') {
    requireValue(!review.next_action_at||Date.parse(review.next_action_at)>=Date.parse(review.reviewed_at),'Action post-contrat invalide');
  }
  const proof=lead ? verifyEvidence(review,lead,resolveEvidence) : {status:'PENDING_EVIDENCE',need:false,contract:false};
  return {lead_id:review.lead_id,owner:'03',reviewed_at:review.reviewed_at,stage:review.stage,
    evidence_ref:review.evidence_ref,need_evidence_ref:review.need_evidence_ref||null,
    contract_evidence_ref:review.contract_evidence_ref||null,contract_at:review.contract_at||null,
    next_action_at:review.next_action_at||null,closure_reason:review.closure_reason||null,
    proof_status:proof.status,verified_need:proof.need,verified_contract:proof.contract};
}

const INCIDENTS = Object.freeze({
  lead_storage_failed:{severity:'CRITICAL',action:'STOP_LEADS'},
  delivery_status_write_failed:{severity:'CRITICAL',action:'RECONCILE_BEFORE_REPLAY'},
  brevo_contact_failed:{severity:'MAJOR',action:'DRY_RUN_REPLAY'},
  ack_failed:{severity:'MAJOR',action:'DRY_RUN_REPLAY'},
  internal_notification_failed:{severity:'MAJOR',action:'DRY_RUN_REPLAY'},
  event_storage_failed:{severity:'MAJOR',action:'STOP_EVENTS'},
  replay_failed:{severity:'MAJOR',action:'MANUAL_REVIEW'}
});
export function classifyIncident(event, details = {}, occurredAt = new Date().toISOString()) {
  const clean = buildLogRecord(event, details);
  if (!clean || !INCIDENTS[event]) return null;
  requireValue(isDate(occurredAt), 'Horodatage invalide');
  return {...clean, ...INCIDENTS[event], occurred_at:occurredAt, owner:'02-W14-07'};
}
export function createTestAlertSink({sink, cooldownMs = 300000, now = () => Date.now()} = {}) {
  requireValue(typeof sink === 'function', 'Canal de test explicite requis');
  const seen = new Map();
  return async (event, details) => {
    const incident = classifyIncident(event, details, new Date(now()).toISOString());
    if (!incident) return {sent:false, reason:'not_incident'};
    const key = `${incident.event}:${incident.correlation_id || 'global'}`;
    if ((seen.get(key) ?? -Infinity) + cooldownMs > now()) return {sent:false, reason:'cooldown'};
    // Échec du canal : aucune prétention de livraison, reprise possible.
    try { await sink(incident); seen.set(key, now()); return {sent:true}; }
    catch { return {sent:false, reason:'alert_transport_failed'}; }
  };
}
export function stopPlan({leads = false, events = false} = {}) {
  return {changes:{...(leads ? {LEADS_ENABLED:'false'} : {}), ...(events ? {EVENTS_ENABLED:'false'} : {})},
    delete_data:false, deploy:false, replay:'DRY_RUN', owner:'02-W14-07'};
}

// Raccord injectable au logger du handler en exercice local uniquement.
export function createIncidentLogger({journal, alert} = {}) {
  requireValue(typeof journal === 'function' && typeof alert === 'function', 'Journal/canal de test requis');
  const pending = new Set();
  return {
    log(event, details = {}) {
      const record = buildLogRecord(event, details);
      if (!record) return null;
      journal(record);
      const task = Promise.resolve().then(() => alert(event, record)).catch(() => ({sent:false, reason:'alert_transport_failed'}));
      pending.add(task); task.finally(() => pending.delete(task));
      return record;
    },
    async flush() { await Promise.all([...pending]); }
  };
}
