// Stockage métier des demandes, en amont de tout prestataire externe.
//
// Le contrat est volontairement étroit : construire une ligne, l'insérer une
// seule fois, mettre à jour des statuts de livraison, purger selon une durée
// fournie par la configuration. Aucune règle commerciale, aucun secret.

// Cycle TECHNIQUE. Il ne dit rien de l'intérêt commercial d'une demande.
export const DELIVERY_STATUSES = Object.freeze([
  'RECEIVED', 'STORED', 'DELIVERY_PENDING', 'DELIVERED', 'PARTIAL_FAILURE', 'FAILED'
]);

// Statuts du vivier d'expertise. 'MOBILISABLE' n'y figure pas : il se décide
// humainement, hors de ce pipeline.
export const EXPERTISE_STATUSES = Object.freeze(['REÇU', 'À QUALIFIER', 'QUALIFIÉ', 'À CONTACTER']);

export const STEP_STATUSES = Object.freeze(['PENDING', 'OK', 'FAILED', 'SKIPPED']);

// Champs métier sérialisés dans journey_payload. Liste fermée, alignée sur le
// schéma P0 : un champ inconnu n'entre pas en base.
const PAYLOAD_FIELDS = Object.freeze([
  'need',
  // Collaboration — organisation
  'collaboration_subject', 'domains', 'collaboration_expectation', 'collaboration_form',
  'public_reference', 'organisation_website',
  // Collaboration — expertise
  'professional_status', 'expertise_domains', 'intervention_types', 'work_languages',
  'availability', 'expertise_evidence', 'motivation', 'phone', 'linkedin', 'website_url',
  'orcid', 'portfolio', 'mobility', 'rate_range', 'rc_pro',
  // Formation
  'audience', 'training_subject', 'learning_objectives', 'training_format', 'period',
  'participant_count', 'training_level', 'location', 'duration', 'customization', 'context'
]);

// Jamais stocké, quelle que soit la source.
const NEVER_STORED = Object.freeze(['captcha_token', 'website', 'ip', 'cf-connecting-ip']);

const COLUMNS = Object.freeze([
  'id', 'idempotency_key', 'created_at', 'updated_at',
  'journey', 'source_offer', 'recommended_offer', 'lead_type', 'organisation_type',
  'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome',
  'deadline', 'contact_preference',
  'firstname', 'lastname', 'email', 'organisation', 'role',
  'journey_payload', 'delivery_status', 'qualification_status',
  'brevo_contact_status', 'ack_status', 'notification_status',
  'last_error_code', 'correlation_id'
]);

const text = value => (typeof value === 'string' ? value : '');

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function journeyPayload(lead) {
  const payload = {};
  for (const field of PAYLOAD_FIELDS) {
    const value = lead[field];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) { if (value.length) payload[field] = [...value]; continue; }
    payload[field] = value;
  }
  for (const field of NEVER_STORED) delete payload[field];
  return payload;
}

// Deux envois identiques le même jour UTC retombent sur la même clé : l'insert
// est alors ignoré et aucun second accusé n'est expédié. Une demande déposée un
// autre jour reste une demande distincte.
export async function idempotencyKey(lead, now = new Date()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const body = text(lead.need) || text(lead.collaboration_expectation) || text(lead.motivation) ||
    text(lead.learning_objectives) || text(lead.context);
  return sha256Hex([text(lead.email), text(lead.journey), text(lead.lead_type), body, day].join('|'));
}

export async function buildLeadRecord(lead, { now = new Date(), correlationId = '' } = {}) {
  const stamp = new Date(now).toISOString();
  return {
    id: crypto.randomUUID(),
    idempotency_key: await idempotencyKey(lead, now),
    created_at: stamp,
    updated_at: stamp,
    journey: text(lead.journey),
    source_offer: text(lead.source_offer),
    recommended_offer: text(lead.recommended_offer),
    lead_type: text(lead.lead_type),
    organisation_type: text(lead.organisation_type),
    territory: text(lead.territory),
    need_category: text(lead.need_category),
    stage: text(lead.stage),
    data_availability: text(lead.data_availability),
    desired_outcome: text(lead.desired_outcome),
    deadline: text(lead.deadline),
    contact_preference: text(lead.contact_preference),
    firstname: text(lead.firstname),
    lastname: text(lead.lastname),
    email: text(lead.email),
    organisation: text(lead.organisation),
    role: text(lead.role),
    journey_payload: JSON.stringify(journeyPayload(lead)),
    delivery_status: 'STORED',
    // Seul le vivier d'expertise entre dans un cycle de qualification, au
    // premier échelon. Rien n'est promu automatiquement.
    qualification_status: lead.lead_type === 'expertise-offer' ? 'REÇU' : '',
    brevo_contact_status: 'PENDING',
    ack_status: 'PENDING',
    notification_status: 'PENDING',
    last_error_code: '',
    correlation_id: text(correlationId)
  };
}

// Retourne {stored:true} à la première insertion, {stored:false, duplicate:true}
// si la demande a déjà été enregistrée : le pipeline s'arrête alors sans
// réexpédier d'accusé.
export async function storeLead(database, record) {
  const placeholders = COLUMNS.map(() => '?').join(',');
  const statement = database
    .prepare(`INSERT INTO lead_records (${COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(...COLUMNS.map(column => record[column]));
  const result = await statement.run();
  const changes = result?.meta?.changes ?? result?.changes ?? 0;
  return changes > 0 ? { stored: true, id: record.id } : { stored: false, duplicate: true, id: record.id };
}

export async function markDelivery(database, id, patch = {}) {
  const fields = ['brevo_contact_status', 'ack_status', 'notification_status', 'delivery_status', 'last_error_code']
    .filter(field => patch[field] !== undefined);
  if (!fields.length) return { updated: false };
  const assignments = [...fields.map(field => `${field}=?`), 'updated_at=?'].join(',');
  const values = [...fields.map(field => patch[field]), new Date(patch.now ?? Date.now()).toISOString(), id];
  await database.prepare(`UPDATE lead_records SET ${assignments} WHERE id=?`).bind(...values).run();
  return { updated: true };
}

// La durée de conservation n'est pas décidée ici : elle est fournie par la
// configuration. Sans valeur explicite, aucune purge n'a lieu.
export function retentionCutoff(retentionDays, now = new Date()) {
  const days = Number(retentionDays);
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  return new Date(new Date(now).getTime() - days * 86400000).toISOString();
}

export async function selectExpiredLeads(database, retentionDays, now = new Date()) {
  const cutoff = retentionCutoff(retentionDays, now);
  if (!cutoff) return [];
  const result = await database.prepare('SELECT id FROM lead_records WHERE created_at < ?').bind(cutoff).all();
  return result?.results ?? [];
}

export async function purgeExpiredLeads(database, retentionDays, now = new Date()) {
  const cutoff = retentionCutoff(retentionDays, now);
  if (!cutoff) return { purged: 0, skipped: true };
  const result = await database.prepare('DELETE FROM lead_records WHERE created_at < ?').bind(cutoff).run();
  return { purged: result?.meta?.changes ?? result?.changes ?? 0, skipped: false, cutoff };
}

export { PAYLOAD_FIELDS, NEVER_STORED, COLUMNS };
