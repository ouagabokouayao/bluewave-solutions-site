import assert from 'node:assert/strict';
import test from 'node:test';

import { createTurnstileVerifier, turnstileEnabled, SITEVERIFY_URL } from '../turnstile.mjs';
import worker from '../worker.mjs';

test('désactivé par défaut : aucun vérificateur, donc aucun appel réseau', () => {
  assert.equal(turnstileEnabled({}), false);
  assert.equal(turnstileEnabled({ TURNSTILE_ENABLED: 'false' }), false);
  let called = false;
  const verifier = createTurnstileVerifier({ TURNSTILE_ENABLED: 'false', TURNSTILE_SECRET_KEY: 'x'.repeat(32) },
    { fetchImpl: async () => { called = true; return new Response('{}'); } });
  assert.equal(verifier, null);
  assert.equal(called, false);
});

test('activation sans secret : échec visible plutôt que passage silencieux', () => {
  assert.throws(() => createTurnstileVerifier({ TURNSTILE_ENABLED: 'true' }), /clé secrète/);
});

test('activé et mocké : jeton valide accepté, secret jamais exposé au navigateur', async () => {
  const calls = [];
  const verifier = createTurnstileVerifier(
    { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'secret-de-test-0123456789abcdef' },
    { fetchImpl: async (url, options) => { calls.push({ url, body: options.body }); return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }); } }
  );
  const request = new Request('https://example.invalid/api/leads', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.10' } });
  assert.equal(await verifier('jeton-valide', request), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY_URL);
  assert.ok(calls[0].body.includes('response=jeton-valide'));
});

test('jeton refusé, vide, surdimensionné ou service en panne : refus générique', async () => {
  const secret = { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'secret-de-test-0123456789abcdef' };
  const refused = createTurnstileVerifier(secret, { fetchImpl: async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.equal(await refused('jeton-invalide'), false);

  const broken = createTurnstileVerifier(secret, { fetchImpl: async () => { throw new Error('timeout'); } });
  assert.equal(await broken('jeton'), false);

  const http500 = createTurnstileVerifier(secret, { fetchImpl: async () => new Response('', { status: 500 }) });
  assert.equal(await http500('jeton'), false);

  let called = false;
  const unused = createTurnstileVerifier(secret, { fetchImpl: async () => { called = true; return new Response('{}'); } });
  assert.equal(await unused(''), false);
  assert.equal(await unused('x'.repeat(2049)), false);
  assert.equal(called, false);
});

test('le jeton n’est ni stocké ni renvoyé : le Worker reste fermé sans configuration', async () => {
  const env = { ASSETS: { fetch: async () => new Response('static') } };
  const response = await worker.fetch(new Request('https://example.invalid/api/leads', { method: 'POST' }), env, {});
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('token'), false);
});
