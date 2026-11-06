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

// Champs de qualification et d'identité entrant dans l'empreinte. Deux demandes
// qui diffèrent sur l'un d'eux sont deux demandes distinctes.
const IDENTITY_FIELDS = Object.freeze([
  'journey', 'source_offer', 'recommended_offer', 'lead_type', 'organisation_type',
  'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome',
  'deadline', 'contact_preference',
  'firstname', 'lastname', 'email', 'organisation', 'role'
]);

// Représentation canonique déterministe de la demande validée.
//
// Clés triées, tableaux triés et dédoublonnés, valeurs déjà nettoyées par la
// validation. Rien d'invisible n'y est ajouté : ni horodatage, ni identifiant
// de corrélation, ni statut, ni jeton, ni honeypot. La même demande produit
// donc toujours la même représentation, et deux demandes qui diffèrent sur
// n'importe quel champ métier produisent des représentations différentes.
export function canonicalRepresentation(lead) {
  const canonical = {};
  for (const field of IDENTITY_FIELDS) canonical[field] = text(lead[field]);
  const payload = journeyPayload(lead);
  const ordered = {};
  for (const field of Object.keys(payload).sort()) {
    const value = payload[field];
    ordered[field] = Array.isArray(value) ? [...new Set(value.map(String))].sort() : String(value);
  }
  canonical.journey_payload = ordered;
  return canonical;
}

// La clé ne dépend que du contenu validé. Une réponse perdue peut être reprise
// après plusieurs minutes ou le lendemain : ni l'heure ni le jour n'y entrent.
// Un seul champ métier modifié donne une autre clé, donc une autre demande.
export async function idempotencyKey(lead) {
  return sha256Hex(JSON.stringify(canonicalRepresentation(lead)));
}

// Au-delà, un envoi au contenu identique n'est plus une reprise mais une nouvelle
// demande : le même besoin peut revenir, il ne doit pas disparaître en silence.
export const DUPLICATE_WINDOW_DAYS = 30;

export async function buildLeadRecord(lead, { now = new Date(), correlationId = '' } = {}) {
  const stamp = new Date(now).toISOString();
  return {
    id: crypto.randomUUID(),
    idempotency_key: await idempotencyKey(lead),
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
    // Extension JSON compatible avec les bases existantes : aucune migration.
    // Hors empreinte métier : changer d'UTM ne crée pas une nouvelle demande.
    journey_payload: JSON.stringify({...journeyPayload(lead),
      acquisition_source: text(lead.acquisition_source), campaign_code: text(lead.campaign_code),
      landing_page: text(lead.landing_page)}),
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

const changed = result => (result?.meta?.changes ?? result?.changes ?? 0) > 0;

// Retourne {stored:true} à la première insertion, {stored:false, duplicate:true}
// si la demande a déjà été enregistrée : le pipeline s'arrête alors sans
// réexpédier d'accusé. La contrainte d'unicité décide, y compris entre instances.
export async function storeLead(database, record) {
  const placeholders = COLUMNS.map(() => '?').join(',');
  const insert = () => database
    .prepare(`INSERT INTO lead_records (${COLUMNS.join(',')}) VALUES (${placeholders}) ON CONFLICT(idempotency_key) DO NOTHING`)
    .bind(...COLUMNS.map(column => record[column])).run();
  if (changed(await insert())) return { stored: true, id: record.id };
  // Passée la fenêtre, la ligne ancienne libère sa clé : elle reste en base, intacte.
  const oldest = new Date(new Date(record.created_at).getTime() - DUPLICATE_WINDOW_DAYS * 86400000).toISOString();
  const released = await database
    .prepare(`UPDATE lead_records SET idempotency_key=idempotency_key||':'||id WHERE idempotency_key=? AND created_at<?`)
    .bind(record.idempotency_key, oldest).run();
  if (changed(released) && changed(await insert())) return { stored: true, id: record.id };
  return { stored: false, duplicate: true, id: record.id };
}

export async function getLeadRecord(database, id) {
  const result = await database.prepare('SELECT * FROM lead_records WHERE id = ?').bind(id).all();
  return (result?.results ?? [])[0] ?? null;
}

export async function findLeadsByEmail(database, email) {
  const result = await database.prepare('SELECT * FROM lead_records WHERE email = ? ORDER BY created_at DESC').bind(String(email ?? '').toLowerCase()).all();
  return result?.results ?? [];
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

// Collecte publique : accepter de nouvelles demandes.
export function canDeliverLeads(environment, database) {
  return environment?.LEADS_ENABLED === 'true' &&
    typeof database?.prepare === 'function' &&
    retentionCutoff(environment.LEAD_RETENTION_DAYS) !== null;
}

// Réémission : reprendre une demande déjà reçue. Elle ne dépend pas de la
// collecte publique : fermer le formulaire ne doit pas bloquer une notification
// due à une personne qui a déjà écrit. Elle exige son propre interrupteur.
export function canReplayLeads(environment, database) {
  return environment?.LEADS_REPLAY_ENABLED === 'true' &&
    typeof database?.prepare === 'function' &&
    retentionCutoff(environment.LEAD_RETENTION_DAYS) !== null;
}

// La durée de conservation n'est pas décidée ici : elle est fournie par la
// configuration. Sans valeur explicite, aucune purge n'a lieu.
export function retentionCutoff(retentionDays, now = new Date()) {
  const days = Number(retentionDays);
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  const cutoff = new Date(new Date(now).getTime() - days * 86400000);
  return Number.isFinite(cutoff.getTime()) ? cutoff.toISOString() : null;
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
