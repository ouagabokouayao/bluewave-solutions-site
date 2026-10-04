import assert from 'node:assert/strict';
import test from 'node:test';

import { createNewsletterChannel, leadGrantsSubscription, newsletterEnabled, NEWSLETTER_STEPS } from '../newsletter.mjs';
import { journeyPayload } from '../lead-store.mjs';

test('le canal reste fermé et refuse sans effet de bord', async () => {
  assert.equal(newsletterEnabled({}), false);
  assert.equal(newsletterEnabled({ NEWSLETTER_ENABLED: 'false' }), false);
  const channel = createNewsletterChannel({});
  assert.equal(channel.enabled, false);
  assert.deepEqual(await channel.request({ email: 'a@example.invalid' }), { ok: false, reason: 'newsletter_disabled' });
  assert.deepEqual(await channel.confirm('jeton'), { ok: false, reason: 'newsletter_disabled' });
});

test('une activation prématurée échoue au lieu d’improviser une séquence', () => {
  assert.throws(() => createNewsletterChannel({ NEWSLETTER_ENABLED: 'true' }), /non implémenté/);
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
