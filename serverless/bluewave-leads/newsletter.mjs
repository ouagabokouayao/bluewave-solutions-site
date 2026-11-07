// Lettre de veille : double opt-in complet, canal fermé par défaut.
//
// Trois garanties structurent ce module.
// - Un jeton ne contient rien : c'est un HMAC opaque. Aucune adresse n'y est
//   lisible, et la base n'en conserve que l'empreinte.
// - L'usage unique et l'expiration sont décidés dans D1 par compare-and-set :
//   ils tiennent entre instances, sans mémoire locale.
// - La désinscription est exécutée : le consentement est retiré d'abord en base,
//   puis chez le fournisseur, et un échec reste en REVOKING jusqu'à sa reprise.
//
// Invariant central : une demande commerciale n'est jamais convertie en
// inscription. Les deux canaux ont des points d'entrée, des consentements, des
// durées et des bases distincts.

export const NEWSLETTER_STEPS = Object.freeze([
  'REQUEST',      // saisie de l'adresse sur un formulaire dédié
  'CONFIRM_SENT', // courriel de confirmation expédié, jeton à durée limitée
  'CONFIRMED',    // le destinataire a confirmé dans la fenêtre de validité
  'EXPIRED',      // jeton périmé sans confirmation : aucune inscription
  'REVOKED'       // désinscription ou retrait du consentement
]);

export const NEWSLETTER_PREFERENCES = Object.freeze(['veille', 'formations', 'publications']);
export const TOKEN_TTL_SECONDS = 86400;
// La gestion des préférences expire ; la désinscription, elle, ne dépend d'aucune durée.
export const MANAGEMENT_TTL_SECONDS = 2 * 365 * 86400;
export const UNCONFIRMED_RETENTION_DAYS = 30;
// Au-delà, un retrait qui n'atteint pas le fournisseur n'est plus un incident
// passager : la personne risque de recevoir une édition après s'être désinscrite.
export const REVOCATION_ALERT_HOURS = 24;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const TABLES = new Set(['newsletter_consents', 'newsletter_test_consents']);

export function newsletterEnabled(environment = {}) {
  return environment.NEWSLETTER_ENABLED === 'true';
}

// Une demande de contact ne vaut jamais demande d'inscription, quel que soit
// le contenu du formulaire reçu.
export function leadGrantsSubscription() {
  return false;
}

const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

// Dérivé d'un aléa conservé côté serveur : rejouer un envoi redonne le même
// jeton, sans qu'il soit stocké ni qu'il porte une information.
export async function deriveToken(secret, purpose, nonce) {
  if (String(secret ?? '').length < 32) throw new Error('Secret de signature insuffisant');
  return base64url(await hmac(secret, `${purpose}:${nonce}`));
}

export async function tokenDigest(token) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(token)))));
}

// Preuve de confirmation : scelle qui a accepté quelle version de l'information,
// et quand. Elle permet de démontrer le consentement sans conserver le jeton.
export async function consentProof(secret, { consent_id, email, notice_version, request_at, confirmed_at }) {
  return hex(await hmac(secret, ['consent', consent_id, email, notice_version, request_at, confirmed_at].join('|')));
}

// Interface fournisseur : chaque méthode est obligatoire. Une désinscription
// facultative laisserait croire à un retrait qui n'a pas eu lieu.
export function assertSubscriberTransport(transport) {
  if (['sendConfirmation', 'subscribe', 'unsubscribe', 'updatePreferences'].some(method => typeof transport?.[method] !== 'function')) {
    throw new Error('Transport lettre de veille incomplet');
  }
  return transport;
}

const refused = async () => ({ ok: false, reason: 'newsletter_disabled' });
const CLOSED = Object.freeze({
  enabled: false, request: refused, confirm: refused, read: refused, preferences: refused, revoke: refused,
  retryRevocation: refused, retryPendingRevocations: async () => ({ retried: 0, failed: 0 })
});

// Fermé aux nouvelles inscriptions, le canal laisse se désinscrire toute personne
// déjà inscrite dès lors que la base et le fournisseur sont disponibles.
export function createNewsletterChannel(environment = {}, {
  database = null, transport = null, now = () => Date.now(), table = 'newsletter_consents', checkAddress = () => {}
} = {}) {
  const open = newsletterEnabled(environment);
  if (!open && !database) return CLOSED;
  const secret = String(environment.NEWSLETTER_TOKEN_SECRET ?? '');
  if (secret.length < 32) {
    if (!open) return CLOSED;
    throw new Error('Canal lettre de veille : secret de signature absent');
  }
  if (!open && !transport) return CLOSED;
  assertSubscriberTransport(transport);
  if (typeof database?.prepare !== 'function') throw new Error('Canal lettre de veille : stockage absent');
  if (!TABLES.has(table)) throw new Error('Table lettre de veille inconnue');

  const query = (sql, ...values) => database.prepare(sql).bind(...values);
  const first = async (sql, ...values) => (await query(sql, ...values).all()).results?.[0] ?? null;
  const changed = result => (result?.meta?.changes ?? result?.changes ?? 0) > 0;
  const findByEmail = email => first(`SELECT * FROM ${table} WHERE email=?`, email);
  const findByToken = async (column, token) => (typeof token === 'string' && TOKEN_PATTERN.test(token)
    ? first(`SELECT * FROM ${table} WHERE ${column}=?`, await tokenDigest(token)) : null);
  const addressOf = email => {
    const address = String(email ?? '').trim().toLowerCase();
    if (address.length > 254 || !EMAIL_PATTERN.test(address)) return null;
    checkAddress(address);
    return address;
  };
  const preferencesOf = value => (Array.isArray(value) && value.every(item => NEWSLETTER_PREFERENCES.includes(item)) ? [...new Set(value)] : null);
  const closedResult = { ok: false, reason: 'newsletter_disabled' };

  const finishRevocation = async record => {
    try { await transport.unsubscribe(record.email, { idempotency_key: `unsubscribe:${record.consent_id}` }); }
    catch (error) {
      await query(`UPDATE ${table} SET sync_attempts=sync_attempts+1,sync_error=?,sync_attempt_at=? WHERE consent_id=? AND state='REVOKING'`,
        error?.status ? `http_${error.status}` : 'network', new Date(now()).toISOString(), record.consent_id).run();
      return { ok: false, reason: 'unsubscribe_transport_failed', step: 'REVOKING' };
    }
    await query(`UPDATE ${table} SET state='REVOKED',management_digest=NULL,sync_error=NULL WHERE consent_id=? AND state='REVOKING'`, record.consent_id).run();
    return { ok: true, step: 'REVOKED' };
  };

  return {
    enabled: open,

    async request({ email, consent, notice_version, consent_source, preferences = [] } = {}) {
      if (!open) return closedResult;
      if (consent !== true || !CODE_PATTERN.test(String(notice_version ?? '')) || !CODE_PATTERN.test(String(consent_source ?? ''))) {
        return { ok: false, reason: 'explicit_consent_required' };
      }
      const address = addressOf(email);
      if (!address) return { ok: false, reason: 'invalid_email' };
      const chosen = preferencesOf(preferences);
      if (!chosen) return { ok: false, reason: 'invalid_preferences' };
      const clock = now();
      let record = await findByEmail(address);
      if (record && ['REQUEST', 'SENDING', 'CONFIRM_SENT', 'CONFIRMING'].includes(record.state) && record.expires_at <= clock) {
        await query(`UPDATE ${table} SET state='EXPIRED' WHERE email=? AND consent_id=? AND state=?`, address, record.consent_id, record.state).run();
        record = await findByEmail(address);
      }
      if (record?.state === 'CONFIRMED') return { ok: false, reason: 'already_confirmed' };
      if (record && ['SENDING', 'CONFIRM_SENT', 'CONFIRMING', 'REVOKING'].includes(record.state)) return { ok: false, reason: 'pending_or_replayed' };
      const consentId = crypto.randomUUID();
      const nonce = crypto.randomUUID();
      const digest = await tokenDigest(await deriveToken(secret, 'confirm', nonce));
      const stamp = new Date(clock).toISOString();
      const expires = clock + TOKEN_TTL_SECONDS * 1000;
      // La clé email et le compare-and-set empêchent deux demandes concurrentes.
      if (!record) {
        const inserted = await query(`INSERT INTO ${table} (email,consent_id,state,notice_version,consent_source,request_at,preferences,confirmation_nonce,confirmation_digest,expires_at) VALUES (?,?,'SENDING',?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING`,
          address, consentId, notice_version, consent_source, stamp, JSON.stringify(chosen), nonce, digest, expires).run();
        if (!changed(inserted)) return { ok: false, reason: 'pending_or_replayed' };
      } else if (record.state === 'REQUEST' && record.expires_at > clock) {
        // Reprise du même envoi, avec la même clé fournisseur et le même jeton.
        const claimed = await query(`UPDATE ${table} SET state='SENDING' WHERE email=? AND consent_id=? AND state='REQUEST'`, address, record.consent_id).run();
        if (!changed(claimed)) return { ok: false, reason: 'pending_or_replayed' };
      } else {
        const renewed = await query(`UPDATE ${table} SET consent_id=?,state='SENDING',notice_version=?,consent_source=?,request_at=?,confirmed_at=NULL,revoked_at=NULL,preferences=?,confirmation_nonce=?,confirmation_digest=?,expires_at=?,management_digest=NULL,management_expires_at=NULL,consent_proof=NULL WHERE email=? AND consent_id=? AND state=?`,
          consentId, notice_version, consent_source, stamp, JSON.stringify(chosen), nonce, digest, expires, address, record.consent_id, record.state).run();
        if (!changed(renewed)) return { ok: false, reason: 'pending_or_replayed' };
      }
      record = await findByEmail(address);
      const token = await deriveToken(secret, 'confirm', record.confirmation_nonce);
      try { await transport.sendConfirmation(address, token, { idempotency_key: `confirmation:${record.consent_id}` }); }
      catch {
        await query(`UPDATE ${table} SET state='REQUEST' WHERE email=? AND consent_id=? AND state='SENDING'`, address, record.consent_id).run();
        return { ok: false, reason: 'confirmation_transport_failed', step: 'REQUEST' };
      }
      await query(`UPDATE ${table} SET state='CONFIRM_SENT' WHERE email=? AND consent_id=? AND state='SENDING'`, address, record.consent_id).run();
      return { ok: true, step: 'CONFIRM_SENT', consent_id: record.consent_id };
    },

    async confirm(token) {
      if (!open) return closedResult;
      const record = await findByToken('confirmation_digest', token);
      if (!record) return { ok: false, reason: 'invalid' };
      if (['CONFIRMED', 'REVOKING', 'REVOKED'].includes(record.state)) return { ok: false, reason: 'replayed' };
      if (record.expires_at <= now()) {
        await query(`UPDATE ${table} SET state='EXPIRED' WHERE consent_id=? AND state=?`, record.consent_id, record.state).run();
        return { ok: false, reason: 'expired', step: 'EXPIRED' };
      }
      // Usage unique : une seule instance peut gagner ce passage d'état. REQUEST et
      // SENDING sont admis, car un envoi sans réponse a pu atteindre le destinataire.
      const claim = await query(`UPDATE ${table} SET state='CONFIRMING' WHERE consent_id=? AND state IN ('REQUEST','SENDING','CONFIRM_SENT')`, record.consent_id).run();
      if (!changed(claim)) return { ok: false, reason: 'replayed' };
      const managementToken = await deriveToken(secret, 'manage', crypto.randomUUID());
      try {
        await transport.subscribe(record.email, { preferences: JSON.parse(record.preferences), management_token: managementToken, idempotency_key: `subscribe:${record.consent_id}` });
      } catch {
        await query(`UPDATE ${table} SET state='CONFIRM_SENT' WHERE consent_id=? AND state='CONFIRMING'`, record.consent_id).run();
        return { ok: false, reason: 'subscription_transport_failed' };
      }
      const confirmedAt = new Date(now()).toISOString();
      const proof = await consentProof(secret, { ...record, confirmed_at: confirmedAt });
      await query(`UPDATE ${table} SET state='CONFIRMED',confirmed_at=?,consent_proof=?,management_digest=?,management_expires_at=? WHERE consent_id=? AND state='CONFIRMING'`,
        confirmedAt, proof, await tokenDigest(managementToken), now() + MANAGEMENT_TTL_SECONDS * 1000, record.consent_id).run();
      return { ok: true, step: 'CONFIRMED', management_token: managementToken };
    },

    // L'adresse n'est jamais renvoyée : le jeton donne accès aux choix, pas à l'identité.
    async read(token) {
      if (!open) return closedResult;
      const record = await findByToken('management_digest', token);
      if (!record || record.state !== 'CONFIRMED') return { ok: false, reason: 'invalid' };
      if (record.management_expires_at <= now()) return { ok: false, reason: 'expired' };
      return { ok: true, preferences: JSON.parse(record.preferences) };
    },

    async preferences(token, preferences) {
      if (!open) return closedResult;
      const record = await findByToken('management_digest', token);
      if (!record || record.state !== 'CONFIRMED') return { ok: false, reason: 'invalid' };
      if (record.management_expires_at <= now()) return { ok: false, reason: 'expired' };
      const chosen = preferencesOf(preferences);
      if (!chosen) return { ok: false, reason: 'invalid_preferences' };
      try { await transport.updatePreferences(record.email, chosen, { idempotency_key: `preferences:${record.consent_id}:${chosen.join(',')}` }); }
      catch { return { ok: false, reason: 'preferences_transport_failed' }; }
      const saved = await query(`UPDATE ${table} SET preferences=? WHERE consent_id=? AND state='CONFIRMED'`, JSON.stringify(chosen), record.consent_id).run();
      return changed(saved) ? { ok: true, step: 'CONFIRMED' } : { ok: false, reason: 'invalid' };
    },

    // Le retrait est enregistré avant l'appel au fournisseur : une panne ne peut
    // pas maintenir un consentement que la personne a retiré.
    async revoke(token) {
      const record = await findByToken('management_digest', token);
      if (!record) return { ok: false, reason: 'invalid' };
      if (record.state === 'REVOKING') return finishRevocation(record);
      const claimed = await query(`UPDATE ${table} SET state='REVOKING',revoked_at=?,preferences='[]' WHERE consent_id=? AND state='CONFIRMED'`, new Date(now()).toISOString(), record.consent_id).run();
      if (!changed(claimed)) return { ok: false, reason: 'invalid' };
      return finishRevocation(record);
    },

    async retryRevocation(consentId) {
      const record = await first(`SELECT * FROM ${table} WHERE consent_id=?`, consentId);
      if (!record || record.state !== 'REVOKING') return { ok: false, reason: 'not_pending' };
      return finishRevocation(record);
    },

    async retryPendingRevocations(limit = 50) {
      const pending = (await query(`SELECT * FROM ${table} WHERE state='REVOKING' ORDER BY revoked_at LIMIT ?`, limit).all()).results ?? [];
      let failed = 0;
      for (const record of pending) if (!(await finishRevocation(record)).ok) failed += 1;
      return { retried: pending.length, failed };
    }
  };
}

// Une adresse jamais confirmée n'a aucune raison d'être conservée. La preuve d'un
// consentement retiré n'est purgée que si une durée a été arrêtée.
export async function purgeNewsletter(database, { now = Date.now(), proofRetentionDays = null, table = 'newsletter_consents' } = {}) {
  if (!TABLES.has(table)) throw new Error('Table lettre de veille inconnue');
  const removed = result => result?.meta?.changes ?? result?.changes ?? 0;
  // CONFIRMING n'y figure pas : le contact a pu être créé chez le fournisseur.
  const unconfirmed = await database.prepare(`DELETE FROM ${table} WHERE state IN ('REQUEST','SENDING','CONFIRM_SENT','EXPIRED') AND expires_at < ?`)
    .bind(now - UNCONFIRMED_RETENTION_DAYS * 86400000).run();
  const days = Number(proofRetentionDays);
  if (!proofRetentionDays || !Number.isSafeInteger(days) || days <= 0) return { unconfirmed: removed(unconfirmed), revoked: 0 };
  const revoked = await database.prepare(`DELETE FROM ${table} WHERE state='REVOKED' AND revoked_at < ?`)
    .bind(new Date(now - days * 86400000).toISOString()).run();
  return { unconfirmed: removed(unconfirmed), revoked: removed(revoked) };
}

// État de la synchronisation avec le fournisseur, indépendant de l'ouverture du
// canal. Il dit ce qui reste bloqué, depuis quand et pourquoi, pas seulement combien
// de tentatives ont eu lieu.
export async function newsletterBacklog(database, { now = Date.now(), table = 'newsletter_consents' } = {}) {
  if (!TABLES.has(table)) throw new Error('Table lettre de veille inconnue');
  const read = async (sql, ...values) => (await database.prepare(sql).bind(...values).all()).results ?? [];
  const [pending] = await read(`SELECT COUNT(*) AS count, MIN(revoked_at) AS oldest, MAX(sync_attempts) AS attempts FROM ${table} WHERE state='REVOKING'`);
  const errors = await read(`SELECT DISTINCT sync_error AS code FROM ${table} WHERE state='REVOKING' AND sync_error IS NOT NULL ORDER BY code`);
  const [stuck] = await read(`SELECT COUNT(*) AS count FROM ${table} WHERE state='CONFIRMING' AND expires_at < ?`, now);
  const oldestHours = pending.oldest ? Math.floor((now - Date.parse(pending.oldest)) / 3600000) : 0;
  return {
    pending_revocations: pending.count, oldest_pending_hours: oldestHours, max_attempts: pending.attempts ?? 0,
    error_codes: errors.map(row => row.code), stuck_confirmations: stuck.count,
    alert: (pending.count > 0 && oldestHours >= REVOCATION_ALERT_HOURS) || stuck.count > 0
  };
}
