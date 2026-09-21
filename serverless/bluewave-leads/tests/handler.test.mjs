import assert from 'node:assert/strict';
import test from 'node:test';

import { createLeadHandler, ERROR_MESSAGE, SUCCESS_MESSAGE } from '../handler.mjs';
import { createMemoryGuard } from '../security.mjs';

const environment = Object.freeze({
  BREVO_API_KEY: 'test-credential',
  BREVO_LEADS_LIST_ID: '11',
  BREVO_NEWSLETTER_LIST_ID: '22',
  BREVO_ACK_TEMPLATE_ID: '33',
  BREVO_INTERNAL_TEMPLATE_ID: '44',
  BLUEWAVE_INTERNAL_EMAIL: 'bluewave@example.invalid',
  ALLOWED_ORIGIN: 'https://example.invalid'
});

const validPayload = Object.freeze({
  firstname: 'Awa',
  lastname: 'Koné',
  email: ' AWA.KONE@EXAMPLE.INVALID ',
  organisation: 'Organisation test',
  type: 'projet-mission',
  geography: 'cote-divoire',
  themes: ['littoral-adaptation'],
  need: 'Structurer un besoin littoral.',
  deadline: '3-6m',
  contact_preference: 'email',
  source: 'SITE_QUALIFIER',
  newsletter_consent: false,
  privacy_acknowledged: true,
  website: ''
});

function request(payload = validPayload, origin = environment.ALLOWED_ORIGIN) {
  return new Request('https://function.example.invalid/bluewave-leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '192.0.2.10' },
    body: JSON.stringify(payload)
  });
}

function mockBrevo({ status = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(status < 400 ? JSON.stringify({ id: 1 }) : JSON.stringify({ diagnostic: 'private-upstream-detail' }), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };
  return { calls, fetchImpl };
}

function handler(fetchImpl, guard = createMemoryGuard({ rateLimit: 20 })) {
  return createLeadHandler({ environment, fetchImpl, guard });
}

test('cas valide : contact, accusé et notification, sans donnée brute en réponse', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, message: SUCCESS_MESSAGE });
  assert.equal(brevo.calls.length, 3);
  assert.equal(brevo.calls[0].body.email, 'awa.kone@example.invalid');
  assert.equal(brevo.calls[0].body.attributes.BW_STATUT, 'NOUVEAU');
});

test('email invalide rejeté avant tout appel Brevo', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request({ ...validPayload, email: 'incorrect' }));
  assert.equal(response.status, 400);
  assert.equal(brevo.calls.length, 0);
});

test('champ obligatoire absent rejeté', async () => {
  const brevo = mockBrevo();
  const payload = { ...validPayload };
  delete payload.need;
  const response = await handler(brevo.fetchImpl)(request(payload));
  assert.equal(response.status, 400);
  assert.equal(brevo.calls.length, 0);
});

test('newsletter false : seule la liste Leads est transmise', async () => {
  const brevo = mockBrevo();
  await handler(brevo.fetchImpl)(request({ ...validPayload, newsletter_consent: false }));
  assert.deepEqual(brevo.calls[0].body.listIds, [11]);
  assert.equal(brevo.calls[0].body.attributes.BW_CONSENT_VEILLE, false);
});

test('newsletter true : la liste Newsletter est ajoutée indépendamment', async () => {
  const brevo = mockBrevo();
  await handler(brevo.fetchImpl)(request({ ...validPayload, newsletter_consent: true }));
  assert.deepEqual(brevo.calls[0].body.listIds, [11, 22]);
  assert.equal(brevo.calls[0].body.attributes.BW_CONSENT_VEILLE, true);
});

test('contact existant : updateEnabled évite la création d’un doublon', async () => {
  const brevo = mockBrevo();
  await handler(brevo.fetchImpl)(request());
  assert.equal(brevo.calls[0].body.updateEnabled, true);
  assert.equal(brevo.calls[0].url, 'https://api.brevo.com/v3/contacts');
});

test('API Brevo indisponible : erreur générique sans réponse brute', async () => {
  const brevo = mockBrevo({ status: 503 });
  const response = await handler(brevo.fetchImpl)(request());
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, { success: false, message: ERROR_MESSAGE });
  assert.equal(JSON.stringify(body).includes('private-upstream-detail'), false);
});

test('double soumission rapprochée rejetée', async () => {
  const brevo = mockBrevo();
  const guard = createMemoryGuard({ rateLimit: 20 });
  const handle = handler(brevo.fetchImpl, guard);
  assert.equal((await handle(request())).status, 201);
  assert.equal((await handle(request())).status, 409);
  assert.equal(brevo.calls.length, 3);
});

test('Origin refusée : aucun appel Brevo', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request(validPayload, 'https://malicious.example.invalid'));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(brevo.calls.length, 0);
});

test('payload trop grand rejeté', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request({ ...validPayload, need: 'x'.repeat(20_000) }));
  assert.equal(response.status, 413);
  assert.equal(brevo.calls.length, 0);
});

test('honeypot rempli : succès silencieux sans appel Brevo', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request({ ...validPayload, website: 'https://bot.example.invalid' }));
  assert.equal(response.status, 200);
  assert.equal(brevo.calls.length, 0);
});

test('limite de débit : les requêtes excédentaires sont rejetées', async () => {
  const brevo = mockBrevo();
  const guard = createMemoryGuard({ rateLimit: 1 });
  const handle = handler(brevo.fetchImpl, guard);
  assert.equal((await handle(request())).status, 201);
  const changed = { ...validPayload, need: 'Une autre demande littorale.' };
  assert.equal((await handle(request(changed))).status, 429);
  assert.equal(brevo.calls.length, 3);
});
