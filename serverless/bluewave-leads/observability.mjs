// Journalisation technique sans donnée personnelle.
//
// Le journal doit permettre de répondre à « qu'est-ce qui a échoué, et à quelle
// étape », jamais à « pour qui ». Les champs libres, l'identité, l'adresse et le
// jeton Turnstile n'y entrent pas : seuls des codes fermés et un identifiant de
// corrélation tiré au hasard, sans lien avec une personne.

export const LOG_EVENTS = Object.freeze([
  'lead_rejected', 'lead_stored', 'lead_duplicate', 'lead_storage_failed',
  'turnstile_failed',
  'brevo_contact_failed', 'ack_failed', 'internal_notification_failed',
  'delivery_status_write_failed',
  'event_storage_failed', 'lead_purged', 'lead_purge_failed',
  'replay_started', 'replay_failed', 'data_rights_operation'
]);

// Seules ces clés peuvent accompagner un événement, et seules des valeurs
// fermées y sont admises.
const ALLOWED_KEYS = Object.freeze(['correlation_id', 'reason', 'journey', 'lead_type', 'status', 'count', 'step', 'operation']);

const FORBIDDEN_KEYS = Object.freeze([
  'email', 'firstname', 'lastname', 'name', 'organisation', 'role', 'phone',
  'need', 'motivation', 'context', 'captcha_token', 'token', 'ip', 'api_key',
  'authorization', 'cf-connecting-ip', 'payload', 'journey_payload'
]);

const CODE = /^[a-z0-9_.:-]{1,64}$/i;

export function newCorrelationId() {
  return crypto.randomUUID();
}

function safeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  return CODE.test(value) ? value : null;
}

// Construit l'enregistrement journalisable. Toute clé interdite, inconnue ou
// toute valeur non fermée est écartée plutôt que tronquée : rien ne fuit par
// inadvertance.
export function buildLogRecord(event, details = {}) {
  if (!LOG_EVENTS.includes(event)) return null;
  const record = { event };
  for (const [key, value] of Object.entries(details)) {
    const name = key.toLowerCase();
    if (FORBIDDEN_KEYS.includes(name) || !ALLOWED_KEYS.includes(name)) continue;
    const clean = safeValue(value);
    if (clean !== null) record[name] = clean;
  }
  return record;
}

export function createLogger({ sink = null } = {}) {
  const emit = sink ?? (record => { try { console.log(JSON.stringify(record)); } catch { /* journal best-effort */ } });
  return {
    log(event, details = {}) {
      const record = buildLogRecord(event, details);
      if (record) emit(record);
      return record;
    }
  };
}

export { ALLOWED_KEYS, FORBIDDEN_KEYS };
