import assert from 'node:assert/strict';
import test from 'node:test';

import { createNewsletterChannel, createConfirmationToken, verifyConfirmationToken, assertSubscriberTransport, leadGrantsSubscription, newsletterEnabled, NEWSLETTER_STEPS, TOKEN_TTL_SECONDS } from '../newsletter.mjs';
import { journeyPayload } from '../lead-store.mjs';

test('le canal reste fermé et refuse sans effet de bord', async () => {
  assert.equal(newsletterEnabled({}), false);
  assert.equal(newsletterEnabled({ NEWSLETTER_ENABLED: 'false' }), false);
  const channel = createNewsletterChannel({});
  assert.equal(channel.enabled, false);
  assert.deepEqual(await channel.request({ email: 'a@example.invalid' }), { ok: false, reason: 'newsletter_disabled' });
  assert.deepEqual(await channel.confirm('jeton'), { ok: false, reason: 'newsletter_disabled' });
});

test('ouverture sans secret ou sans transport : échec explicite', () => {
  assert.throws(() => createNewsletterChannel({ NEWSLETTER_ENABLED: 'true' }), /secret de signature absent/);
  assert.throws(() => createNewsletterChannel(
    { NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: 's'.repeat(40) }), /Transport .* incomplet/);
  assert.throws(() => assertSubscriberTransport({ sendConfirmation() {} }), /incomplet/);
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

const SECRET = 'secret de signature pour les tests, plus de trente-deux caractères';

test('jeton signé : vérifiable, à usage unique, expirable', async () => {
  const now = Date.UTC(2026, 9, 4, 8, 0, 0);
  const token = await createConfirmationToken('Awa.Kone@Example.invalid', SECRET, { now });
  const seen = new Set();
  const first = await verifyConfirmationToken(token, SECRET, { now, seen });
  assert.equal(first.ok, true);
  assert.equal(first.email, 'awa.kone@example.invalid');
  assert.equal(first.step, 'CONFIRMED');
  // Rejeu refusé.
  assert.deepEqual(await verifyConfirmationToken(token, SECRET, { now, seen }), { ok: false, reason: 'replayed' });
  // Expiration.
  const late = now + (TOKEN_TTL_SECONDS + 1) * 1000;
  const expired = await verifyConfirmationToken(token, SECRET, { now: late });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, 'expired');
  assert.equal(expired.step, 'EXPIRED');
});

test('jeton falsifié ou signé d’un autre secret : refusé', async () => {
  const now = Date.UTC(2026, 9, 4, 8, 0, 0);
  const token = await createConfirmationToken('a@example.invalid', SECRET, { now });
  assert.equal((await verifyConfirmationToken(token, 'x'.repeat(40), { now })).reason, 'signature');
  assert.equal((await verifyConfirmationToken(token.replace(/.$/, 'A'), SECRET, { now })).reason, 'signature');
  assert.equal((await verifyConfirmationToken('sans-point', SECRET, { now })).reason, 'malformed');
});

test('adresse invalide ou secret trop court : refus à l’émission', async () => {
  await assert.rejects(() => createConfirmationToken('pas-une-adresse', SECRET), /Adresse invalide/);
  await assert.rejects(() => createConfirmationToken('a@example.invalid', 'court'), /Secret de signature/);
});

test('séquence complète avec transport simulé, hors production', async () => {
  const sent = [];
  const subscribed = [];
  const transport = {
    async sendConfirmation(email, token) { sent.push({ email, token }); },
    async subscribe(email) { subscribed.push(email); }
  };
  const channel = createNewsletterChannel(
    { NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: SECRET }, { transport });
  assert.deepEqual(await channel.request('a@example.invalid'), { ok: true, step: 'CONFIRM_SENT' });
  assert.equal(subscribed.length, 0, 'aucune inscription avant confirmation');
  const confirmed = await channel.confirm(sent[0].token);
  assert.equal(confirmed.step, 'CONFIRMED');
  assert.deepEqual(subscribed, ['a@example.invalid']);
  // Un second clic sur le même lien n'inscrit pas une seconde fois.
  assert.equal((await channel.confirm(sent[0].token)).ok, false);
  assert.equal(subscribed.length, 1);
});
