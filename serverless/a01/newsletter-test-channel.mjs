// E2E DOI isolé. Aucun endpoint Worker, fournisseur réel ou flag public raccordé.
import {createConfirmationToken, verifyConfirmationToken, TOKEN_TTL_SECONDS} from '../bluewave-leads/newsletter.mjs';
import {isCode} from './contracts.mjs';
export const TEST_PREFERENCES = Object.freeze(['veille','formations','publications']);
const preferencesOf = value => {
  if (!Array.isArray(value) || value.some(item => !TEST_PREFERENCES.includes(item))) throw new Error('Préférences invalides');
  return [...new Set(value)];
};
export function createNewsletterTestChannel({database, transport, secret, testOnly = false, now = () => Date.now()} = {}) {
  if (!testOnly || transport?.testOnly !== true) throw new Error('Environnement et transport de test explicites requis');
  if (!database || String(secret).length < 32 || ['sendConfirmation','subscribe','unsubscribe','updatePreferences'].some(method => typeof transport[method] !== 'function')) throw new Error('Stockage/transport de test incomplet');
  const find = async email => (await database.prepare('SELECT * FROM newsletter_test_consents WHERE email=?').bind(email).all()).results[0] || null;
  const addressOf = email => {
    const address = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !address.endsWith('.invalid')) throw new Error('Adresse synthétique .invalid requise');
    return address;
  };
  const verify = async (token, management = false) => {
    if (typeof token !== 'string' || token.length > 2048 || token.split('.').length !== 2) return {ok:false,reason:'malformed'};
    const result = await verifyConfirmationToken(token, secret, {now:now()});
    if (!result.ok) return result;
    const record = await find(result.email);
    if (!record || result.nonce !== (management ? record.management_nonce : record.confirmation_nonce)) return {ok:false, reason:'revoked_or_unknown'};
    if (management && record.state !== 'CONFIRMED') return {ok:false, reason:'not_confirmed'};
    return {ok:true, record};
  };
  return {
    async request({email, consent, notice_version, consent_source, preferences = []}) {
      if (consent !== true || !isCode(notice_version) || !isCode(consent_source)) return {ok:false, reason:'explicit_consent_required'};
      const address = addressOf(email); const prefs = preferencesOf(preferences);
      let record = await find(address);
      if (record?.state === 'CONFIRM_SENT' && record.expires_at <= now()) {
        await database.prepare("UPDATE newsletter_test_consents SET state='EXPIRED' WHERE email=? AND consent_id=? AND state='CONFIRM_SENT'").bind(address,record.consent_id).run();
        record = await find(address);
      }
      if (record?.state === 'CONFIRMED') return {ok:false, reason:'already_confirmed'};
      if (record && ['SENDING','CONFIRM_SENT','CONFIRMING','REVOKING'].includes(record.state)) return {ok:false, reason:'pending_or_replayed'};
      const consentId = crypto.randomUUID(); const nonce = crypto.randomUUID();
      const stamp = new Date(now()).toISOString(); const expires = now() + TOKEN_TTL_SECONDS * 1000;
      // La clé email et le compare-and-set empêchent deux demandes concurrentes.
      if (!record) {
        const inserted = await database.prepare("INSERT INTO newsletter_test_consents (email,consent_id,state,notice_version,consent_source,request_at,preferences,confirmation_nonce,expires_at) VALUES (?,?,'SENDING',?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING")
          .bind(address,consentId,notice_version,consent_source,stamp,JSON.stringify(prefs),nonce,expires).run();
        if (!inserted.meta.changes) return {ok:false, reason:'pending_or_replayed'};
      } else if (record.state === 'REQUEST' && record.expires_at > now()) {
        // Reprise du même envoi, avec la même clé fournisseur et le même nonce.
        const claimed = await database.prepare("UPDATE newsletter_test_consents SET state='SENDING' WHERE email=? AND consent_id=? AND state='REQUEST'").bind(address,record.consent_id).run();
        if (!claimed.meta.changes) return {ok:false, reason:'pending_or_replayed'};
      } else {
        const changed = await database.prepare("UPDATE newsletter_test_consents SET consent_id=?,state='SENDING',notice_version=?,consent_source=?,request_at=?,confirmed_at=NULL,revoked_at=NULL,preferences=?,confirmation_nonce=?,expires_at=?,management_nonce=NULL WHERE email=? AND consent_id=? AND state IN ('REQUEST','EXPIRED','REVOKED')")
          .bind(consentId,notice_version,consent_source,stamp,JSON.stringify(prefs),nonce,expires,address,record.consent_id).run();
        if (!changed.meta.changes) return {ok:false, reason:'pending_or_replayed'};
      }
      record = await find(address);
      const token = await createConfirmationToken(address, secret, {now:Date.parse(record.request_at),nonce:record.confirmation_nonce});
      try { await transport.sendConfirmation(address,token,{idempotency_key:`confirmation:${record.consent_id}`}); }
      catch {
        await database.prepare("UPDATE newsletter_test_consents SET state='REQUEST' WHERE email=? AND consent_id=? AND state='SENDING'").bind(address,record.consent_id).run();
        return {ok:false, reason:'confirmation_transport_failed', step:'REQUEST'};
      }
      await database.prepare("UPDATE newsletter_test_consents SET state='CONFIRM_SENT' WHERE email=? AND consent_id=? AND state='SENDING'").bind(address,record.consent_id).run();
      return {ok:true, step:'CONFIRM_SENT', consent_id:record.consent_id};
    },
    async confirm(token) {
      const result = await verify(token);
      if (!result.ok) return {ok:false, reason:result.reason};
      const record = result.record;
      if (record.expires_at <= now()) return {ok:false, reason:'expired'};
      const claim = await database.prepare("UPDATE newsletter_test_consents SET state='CONFIRMING' WHERE email=? AND consent_id=? AND state='CONFIRM_SENT'").bind(record.email,record.consent_id).run();
      if (!claim.meta.changes) return {ok:false, reason:'replayed'};
      try { await transport.subscribe(record.email,{preferences:JSON.parse(record.preferences),idempotency_key:`subscribe:${record.consent_id}`}); }
      catch {
        await database.prepare("UPDATE newsletter_test_consents SET state='CONFIRM_SENT' WHERE email=? AND state='CONFIRMING'").bind(record.email).run();
        return {ok:false, reason:'subscription_transport_failed'};
      }
      const nonce = crypto.randomUUID();
      await database.prepare("UPDATE newsletter_test_consents SET state='CONFIRMED',confirmed_at=?,management_nonce=? WHERE email=? AND state='CONFIRMING'").bind(new Date(now()).toISOString(),nonce,record.email).run();
      return {ok:true, step:'CONFIRMED', management_token:await createConfirmationToken(record.email,secret,{now:now(),nonce})};
    },
    async preferences(token, preferences) {
      const result = await verify(token,true); if (!result.ok) return {ok:false, reason:result.reason};
      const prefs = preferencesOf(preferences);
      try { await transport.updatePreferences(result.record.email,prefs,{idempotency_key:`preferences:${result.record.consent_id}:${prefs.join(',')}`}); }
      catch { return {ok:false, reason:'preferences_transport_failed'}; }
      const changed = await database.prepare("UPDATE newsletter_test_consents SET preferences=? WHERE email=? AND state='CONFIRMED'").bind(JSON.stringify(prefs),result.record.email).run();
      return changed.meta.changes ? {ok:true, step:'CONFIRMED'} : {ok:false,reason:'revoked'};
    },
    async revoke(token) {
      const result = await verify(token,true); if (!result.ok) return {ok:false, reason:result.reason};
      const record = result.record;
      const claimed = await database.prepare("UPDATE newsletter_test_consents SET state='REVOKING',revoked_at=? WHERE email=? AND state='CONFIRMED'").bind(new Date(now()).toISOString(),record.email).run();
      if (!claimed.meta.changes) return {ok:false,reason:'revoked'};
      // Consentement retiré localement avant fournisseur. Un échec reste REVOKING.
      try { await transport.unsubscribe(record.email,{idempotency_key:`unsubscribe:${record.consent_id}`}); }
      catch { return {ok:false,reason:'unsubscribe_transport_failed',step:'REVOKING'}; }
      await database.prepare("UPDATE newsletter_test_consents SET state='REVOKED',management_nonce=NULL WHERE email=? AND state='REVOKING'").bind(record.email).run();
      return {ok:true, step:'REVOKED'};
    },
    async retryRevocation(consentId) {
      const record = (await database.prepare('SELECT * FROM newsletter_test_consents WHERE consent_id=?').bind(consentId).all()).results[0];
      if (!record || record.state !== 'REVOKING') return {ok:false,reason:'not_pending'};
      try { await transport.unsubscribe(record.email,{idempotency_key:`unsubscribe:${record.consent_id}`}); }
      catch { return {ok:false,reason:'unsubscribe_transport_failed'}; }
      await database.prepare("UPDATE newsletter_test_consents SET state='REVOKED',management_nonce=NULL WHERE consent_id=? AND state='REVOKING'").bind(consentId).run();
      return {ok:true,step:'REVOKED'};
    }
  };
}
