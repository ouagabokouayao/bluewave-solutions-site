import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { assertSubscriberTransport, consentProof, createNewsletterChannel, leadGrantsSubscription, MANAGEMENT_TTL_SECONDS, NEWSLETTER_STEPS, newsletterEnabled, purgeNewsletter, TOKEN_TTL_SECONDS, UNCONFIRMED_RETENTION_DAYS } from '../newsletter.mjs';
import { createBrevoNewsletterTransport } from '../newsletter-brevo.mjs';
import { journeyPayload } from '../lead-store.mjs';

const SECRET = 'secret de signature pour les tests, plus de trente-deux caractères';
const OPEN = { NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: SECRET };
const NOW = Date.UTC(2026, 9, 4, 8, 0, 0);
const EMAIL = 'awa.kone@example.invalid';
const INPUT = { email: 'Awa.Kone@Example.invalid', consent: true, notice_version: 'veille-v1', consent_source: 'lettre-de-veille', preferences: ['veille'] };

function fakeTransport() {
  const calls = { sent: [], subscribed: [], unsubscribed: [], preferences: [] };
  return { calls,
    async sendConfirmation(email, token, options) { calls.sent.push({ email, token, options }); },
    async subscribe(email, options) { calls.subscribed.push({ email, options }); },
    async unsubscribe(email) { calls.unsubscribed.push(email); },
    async updatePreferences(email, preferences) { calls.preferences.push({ email, preferences }); } };
}

async function withDatabase(run) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("local");}}', d1Databases: { NEWSLETTER_DB: 'veille' }, d1Persist: false });
  try {
    const database = await mf.getD1Database('NEWSLETTER_DB');
    const sql = await readFile(new URL('../../cloudflare/newsletter-schema.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) await database.prepare(statement).run();
    await run(database);
  } finally { await mf.dispose(); }
}
const stored = async database => (await database.prepare('SELECT * FROM newsletter_consents').all()).results[0];

test('le canal reste fermé et refuse sans effet de bord', async () => {
  assert.equal(newsletterEnabled({}), false);
  assert.equal(newsletterEnabled({ NEWSLETTER_ENABLED: 'false' }), false);
  const channel = createNewsletterChannel({});
  assert.equal(channel.enabled, false);
  assert.deepEqual(await channel.request({ email: 'a@example.invalid' }), { ok: false, reason: 'newsletter_disabled' });
  assert.deepEqual(await channel.confirm('jeton'), { ok: false, reason: 'newsletter_disabled' });
  assert.deepEqual(await channel.revoke('jeton'), { ok: false, reason: 'newsletter_disabled' });
});

test('ouverture sans secret, transport ou base : échec explicite', () => {
  assert.throws(() => createNewsletterChannel({ NEWSLETTER_ENABLED: 'true' }), /secret de signature absent/);
  assert.throws(() => createNewsletterChannel(OPEN), /Transport .* incomplet/);
  assert.throws(() => createNewsletterChannel(OPEN, { transport: fakeTransport() }), /stockage absent/);
});

test('régression W14 : un transport sans désinscription ni préférences est refusé', () => {
  assert.throws(() => assertSubscriberTransport({ sendConfirmation() {} }), /incomplet/);
  assert.throws(() => assertSubscriberTransport({ sendConfirmation() {}, subscribe() {} }), /incomplet/);
  assert.throws(() => assertSubscriberTransport({ sendConfirmation() {}, subscribe() {}, unsubscribe() {} }), /incomplet/);
});

test('la séquence de double opt-in est fixée, confirmation obligatoire', () => {
  assert.deepEqual(NEWSLETTER_STEPS, ['REQUEST', 'CONFIRM_SENT', 'CONFIRMED', 'EXPIRED', 'REVOKED']);
  assert.ok(NEWSLETTER_STEPS.indexOf('CONFIRM_SENT') < NEWSLETTER_STEPS.indexOf('CONFIRMED'));
});

test('une demande commerciale ne vaut jamais inscription', () => {
  assert.equal(leadGrantsSubscription({ newsletter_optin_request: true }), false);
  // Rien de relatif à la veille n'entre dans la charge métier d'une demande.
  const payload = journeyPayload({ need: 'Structurer un besoin.', newsletter_optin_request: true });
  assert.equal('newsletter_optin_request' in payload, false);
});

test('régression W14 : aucun jeton ne laisse lire une adresse, et la base ne contient aucun jeton', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    const { token } = transport.calls.sent[0];
    const { management_token: management } = await channel.confirm(token);
    for (const value of [token, management]) {
      assert.match(value, /^[A-Za-z0-9_-]{43}$/);
      const decoded = Buffer.from(value, 'base64url').toString('latin1').toLowerCase();
      assert.equal(decoded.includes('awa'), false);
      assert.equal(decoded.includes('example'), false);
    }
    const row = JSON.stringify(await stored(database));
    assert.equal(row.includes(token), false);
    assert.equal(row.includes(management), false);
  });
});

test('régression W14 : le jeton est à usage unique entre deux instances sans mémoire commune', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const first = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    const second = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await first.request(INPUT);
    const { token } = transport.calls.sent[0];
    const results = await Promise.all([first.confirm(token), second.confirm(token)]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(transport.calls.subscribed.length, 1);
    assert.deepEqual(await second.confirm(token), { ok: false, reason: 'replayed' });
    assert.equal(transport.calls.subscribed.length, 1);
  });
});

test('régression W14 : la désinscription est exécutée, persistée et sans retour en arrière', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    const confirmed = await channel.confirm(transport.calls.sent[0].token);
    assert.equal((await channel.revoke(confirmed.management_token)).step, 'REVOKED');
    assert.deepEqual(transport.calls.unsubscribed, [EMAIL]);
    const row = await stored(database);
    assert.equal(row.state, 'REVOKED');
    assert.ok(row.revoked_at);
    assert.equal(row.preferences, '[]');
    assert.equal(row.management_digest, null);
    assert.equal((await channel.read(confirmed.management_token)).ok, false);
    assert.equal((await channel.preferences(confirmed.management_token, ['veille'])).ok, false);
    assert.equal((await channel.confirm(transport.calls.sent[0].token)).ok, false);
  });
});

test('panne fournisseur au retrait : le consentement tombe d’abord, puis tout chemin de reprise aboutit', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const unsubscribe = transport.unsubscribe;
    let failures = 2;
    transport.unsubscribe = async email => { if (failures-- > 0) throw new Error('panne fictive'); return unsubscribe(email); };
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    const { management_token: management } = await channel.confirm(transport.calls.sent[0].token);
    assert.equal((await channel.revoke(management)).step, 'REVOKING');
    assert.equal((await stored(database)).state, 'REVOKING');
    assert.equal((await channel.preferences(management, ['veille'])).ok, false);
    // Un second clic relance le retrait, il ne répond pas « lien invalide ».
    assert.equal((await channel.revoke(management)).reason, 'unsubscribe_transport_failed');
    assert.deepEqual(await channel.retryPendingRevocations(), { retried: 1, failed: 0 });
    assert.equal((await stored(database)).state, 'REVOKED');
    assert.deepEqual(transport.calls.unsubscribed, [EMAIL]);
  });
});

test('canal fermé après coup : la personne inscrite peut toujours se désinscrire', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    const { management_token: management } = await channel.confirm(transport.calls.sent[0].token);
    const closed = createNewsletterChannel({ ...OPEN, NEWSLETTER_ENABLED: 'false' }, { database, transport, now: () => NOW });
    assert.deepEqual(await closed.request({ ...INPUT, email: 'autre@example.invalid' }), { ok: false, reason: 'newsletter_disabled' });
    assert.deepEqual(await closed.read(management), { ok: false, reason: 'newsletter_disabled' });
    assert.equal((await closed.revoke(management)).step, 'REVOKED');
  });
});

test('expiration : confirmation à 24 h, gestion limitée, retrait sans limite de durée', async () => {
  await withDatabase(async database => {
    let clock = NOW;
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => clock });
    await channel.request(INPUT);
    clock += (TOKEN_TTL_SECONDS + 1) * 1000;
    assert.equal((await channel.confirm(transport.calls.sent[0].token)).reason, 'expired');
    assert.equal(transport.calls.subscribed.length, 0);
    assert.equal((await channel.request(INPUT)).step, 'CONFIRM_SENT');
    assert.equal((await channel.confirm(transport.calls.sent[0].token)).reason, 'invalid', 'l’ancien lien est remplacé');
    const { management_token: management } = await channel.confirm(transport.calls.sent[1].token);
    clock += (MANAGEMENT_TTL_SECONDS + 1) * 1000;
    assert.equal((await channel.read(management)).reason, 'expired');
    assert.equal((await channel.preferences(management, ['veille'])).reason, 'expired');
    assert.equal((await channel.revoke(management)).step, 'REVOKED');
  });
});

test('confirmation : réponse perdue à l’envoi, le lien reçu fonctionne', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const send = transport.sendConfirmation;
    transport.sendConfirmation = async (...args) => { await send(...args); throw new Error('réponse perdue'); };
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    assert.equal((await channel.request(INPUT)).reason, 'confirmation_transport_failed');
    assert.equal((await channel.confirm(transport.calls.sent[0].token)).step, 'CONFIRMED');
  });
});

test('preuve de confirmation : version, origine, dates et sceau vérifiable, sans adresse IP', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    await channel.confirm(transport.calls.sent[0].token);
    const row = await stored(database);
    assert.equal(row.notice_version, 'veille-v1');
    assert.equal(row.consent_source, 'lettre-de-veille');
    assert.ok(row.request_at && row.confirmed_at);
    assert.equal(row.consent_proof, await consentProof(SECRET, row));
    assert.notEqual(row.consent_proof, await consentProof(SECRET, { ...row, notice_version: 'autre' }));
    assert.equal(Object.keys(row).some(column => /ip|agent/i.test(column)), false);
  });
});

test('entrées invalides : ni envoi, ni écriture', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    assert.equal((await channel.request({ ...INPUT, consent: 'yes' })).reason, 'explicit_consent_required');
    assert.equal((await channel.request({ ...INPUT, notice_version: '' })).reason, 'explicit_consent_required');
    assert.equal((await channel.request({ ...INPUT, email: 'pas-une-adresse' })).reason, 'invalid_email');
    assert.equal((await channel.request({ ...INPUT, preferences: ['autre'] })).reason, 'invalid_preferences');
    assert.equal((await channel.confirm('court')).reason, 'invalid');
    assert.equal(await stored(database), undefined);
    assert.equal(transport.calls.sent.length, 0);
  });
});

test('adresse déjà inscrite ou en attente : aucun second courriel', async () => {
  await withDatabase(async database => {
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => NOW });
    await channel.request(INPUT);
    assert.equal((await channel.request(INPUT)).reason, 'pending_or_replayed');
    await channel.confirm(transport.calls.sent[0].token);
    assert.equal((await channel.request(INPUT)).reason, 'already_confirmed');
    assert.equal(transport.calls.sent.length, 1);
  });
});

test('purge : adresses jamais confirmées supprimées, inscrits conservés, preuve selon la durée arrêtée', async () => {
  await withDatabase(async database => {
    let clock = NOW;
    const transport = fakeTransport();
    const channel = createNewsletterChannel(OPEN, { database, transport, now: () => clock });
    await channel.request({ ...INPUT, email: 'jamais@example.invalid' });
    await channel.request({ ...INPUT, email: 'inscrit@example.invalid' });
    await channel.request({ ...INPUT, email: 'parti@example.invalid' });
    await channel.confirm(transport.calls.sent[1].token);
    const { management_token: management } = await channel.confirm(transport.calls.sent[2].token);
    await channel.revoke(management);
    clock += (UNCONFIRMED_RETENTION_DAYS + 2) * 86400000;
    assert.deepEqual(await purgeNewsletter(database, { now: clock }), { unconfirmed: 1, revoked: 0 });
    assert.deepEqual(await purgeNewsletter(database, { now: clock, proofRetentionDays: '10' }), { unconfirmed: 0, revoked: 1 });
    const left = (await database.prepare('SELECT email FROM newsletter_consents').all()).results.map(row => row.email);
    assert.deepEqual(left, ['inscrit@example.invalid']);
  });
});

test('transport Brevo simulé : lien en fragment, liste dédiée, retrait rejouable', async () => {
  const calls = [];
  let status = 201;
  const transport = createBrevoNewsletterTransport({
    environment: { BREVO_API_KEY: 'cle', BREVO_NEWSLETTER_LIST_ID: '7', BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID: '8', BLUEWAVE_SITE_URL: 'https://bluewave.invalid' },
    fetchImpl: async (url, init) => { calls.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body) }); return new Response(null, { status }); }
  });
  await transport.sendConfirmation(EMAIL, 'jeton');
  assert.equal(calls[0].path, '/v3/smtp/email');
  assert.equal(calls[0].body.params.confirmation_url, 'https://bluewave.invalid/lettre-de-veille.html#confirmer=jeton');
  await transport.subscribe(EMAIL, { preferences: ['veille', 'formations'], management_token: 'gestion' });
  assert.deepEqual(calls[1].body.listIds, [7]);
  assert.equal(calls[1].body.attributes.BW_VEILLE_GESTION, 'https://bluewave.invalid/lettre-de-veille.html#gerer=gestion');
  status = 404;
  await transport.unsubscribe(EMAIL);
  assert.equal(calls[2].method, 'PUT');
  assert.equal(calls[2].path, `/v3/contacts/${encodeURIComponent(EMAIL)}`);
  assert.deepEqual(calls[2].body, { unlinkListIds: [7] });
  status = 500;
  await assert.rejects(() => transport.unsubscribe(EMAIL), /indisponible/);
  await assert.rejects(() => transport.updatePreferences(EMAIL, []), /indisponible/);
  status = 404;
  await assert.rejects(() => transport.sendConfirmation(EMAIL, 'jeton'), /indisponible/);
  assert.throws(() => createBrevoNewsletterTransport({ environment: {} }), /Configuration incomplète/);
});
