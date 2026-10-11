// Interfaces internes de préparation A01. Aucun client réseau ni écriture CRM.
import {cleanProvenance} from '../../assets/js/provenance.js';
import {buildLogRecord} from '../bluewave-leads/observability.mjs';

const CODE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;
export const isCode = value => typeof value === 'string' && CODE.test(value);
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export function provenanceOf(record, campaigns = []) {
  let payload = {};
  try { payload = JSON.parse(record.journey_payload || '{}'); } catch { /* anciennes lignes */ }
  return cleanProvenance(payload, campaigns);
}

// Export sensible pour revue 03, jamais destiné au build public ou aux logs.
export function prepareHandoff(records, {campaigns = [], enabled = false} = {}) {
  if (!enabled) return {enabled:false, items:[]};
  const unique = new Map();
  for (const record of records) {
    requireValue(isCode(record.id) && isDate(record.created_at), 'Demande enregistrée requise');
    requireValue(!unique.has(record.id), 'Doublon lead_id');
    unique.set(record.id, {
      lead_id:record.id, received_at:record.created_at, owner:'03', review_status:'PENDING_REVIEW',
      crm_id:null, next_action_at:null, evidence_ref:null,
      journey:record.journey, lead_type:record.lead_type, ...provenanceOf(record, campaigns),
      contact:{firstname:record.firstname, lastname:record.lastname, email:record.email, organisation:record.organisation},
      need:JSON.parse(record.journey_payload || '{}'), delivery_status:record.delivery_status
    });
  }
  return {enabled:true, sensitive:true, master_crm_written:false, items:[...unique.values()]};
}

// Décision fournie par 03, pas une promotion déduite d'un formulaire.
export function validateHumanReview(review) {
  requireValue(review?.owner === '03' && isCode(review.lead_id) && isDate(review.reviewed_at), 'Revue humaine 03 requise');
  requireValue(/^N[0-9]$/.test(review.stage) && isCode(review.evidence_ref), 'Stade et preuve requis');
  if (['N5','N6','N7','N8'].includes(review.stage)) requireValue(isCode(review.need_evidence_ref), 'Preuve de besoin explicite requise');
  if (review.stage === 'N9') requireValue(isCode(review.contract_evidence_ref) && isDate(review.contract_at), 'Contrat prouvé requis');
  else requireValue(isDate(review.next_action_at), 'Prochaine action datée requise');
  return {lead_id:review.lead_id, owner:'03', reviewed_at:review.reviewed_at, stage:review.stage,
    evidence_ref:review.evidence_ref, need_evidence_ref:review.need_evidence_ref || null,
    contract_evidence_ref:review.contract_evidence_ref || null, contract_at:review.contract_at || null,
    next_action_at:review.next_action_at || null};
}

const INCIDENTS = Object.freeze({
  lead_storage_failed:{severity:'CRITICAL',action:'STOP_LEADS'},
  delivery_status_write_failed:{severity:'CRITICAL',action:'RECONCILE_BEFORE_REPLAY'},
  brevo_contact_failed:{severity:'WARNING',action:'DRY_RUN_REPLAY'},
  ack_failed:{severity:'WARNING',action:'DRY_RUN_REPLAY'},
  internal_notification_failed:{severity:'WARNING',action:'DRY_RUN_REPLAY'},
  event_storage_failed:{severity:'WARNING',action:'STOP_EVENTS'},
  replay_failed:{severity:'WARNING',action:'MANUAL_REVIEW'}
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
