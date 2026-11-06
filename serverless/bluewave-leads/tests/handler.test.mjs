import assert from 'node:assert/strict';
import test from 'node:test';

import { createLeadHandler, ERROR_MESSAGE, SUCCESS_MESSAGE } from '../handler.mjs';
import { BrevoClient } from '../brevo-client.mjs';
import { createMemoryGuard } from '../security.mjs';
import { createD1Double } from './d1-double.mjs';

const environment = Object.freeze({
  LEADS_CONTACT_SYNC_ENABLED: 'true', LEADS_ACK_ENABLED: 'true', LEADS_NOTIFY_ENABLED: 'true', LEADS_REPLAY_ENABLED: 'true', LEADS_ENABLED: 'true', LEAD_RETENTION_DAYS: '30',
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
  return createLeadHandler({ environment, fetchImpl, guard, leadStore: createD1Double() });
}

test('le fetch natif conserve son receveur dans le client Brevo', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (_url, _options) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response('{}', { status: 201 }));
  };
  try {
    const response = await new BrevoClient({ environment }).request('/contacts', {});
    assert.equal(response.status, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cas valide : contact, accusé et notification, sans donnée brute en réponse', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, message: SUCCESS_MESSAGE });
  assert.equal(brevo.calls.length, 3);
  assert.equal(brevo.calls[0].body.email, 'awa.kone@example.invalid');
  assert.equal(brevo.calls[0].body.attributes.PRENOM, 'Awa');
  assert.equal(brevo.calls[0].body.attributes.NOM, 'Koné');
  assert.equal('FIRSTNAME' in brevo.calls[0].body.attributes, false);
  assert.equal('LASTNAME' in brevo.calls[0].body.attributes, false);
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
  assert.equal('BW_CONSENT_VEILLE' in brevo.calls[0].body.attributes, false);
});

test('newsletter true : aucun ajout direct, même si un ancien drapeau serveur est activé', async () => {
  const brevo = mockBrevo();
  const response = await createLeadHandler({ environment: {...environment, NEWSLETTER_ENABLED: 'true'}, fetchImpl: brevo.fetchImpl, guard: createMemoryGuard(), leadStore: createD1Double() })(request({ ...validPayload, newsletter_consent: true }));
  assert.equal(response.status, 400);
  assert.equal(brevo.calls.length, 0);
});

test('la liste newsletter n’est pas nécessaire lorsque le canal reste fermé', async () => {
  const brevo = mockBrevo();
  const environmentSansListe = { ...environment };
  delete environmentSansListe.BREVO_NEWSLETTER_LIST_ID;
  const response = await createLeadHandler({environment: environmentSansListe, fetchImpl: brevo.fetchImpl, guard:createMemoryGuard(),leadStore:createD1Double()})(request());
  assert.equal(response.status,201);
});

test('newsletter forgée et désactivée rejetée avant Brevo', async () => {
  const brevo = mockBrevo();
  const response = await handler(brevo.fetchImpl)(request({ ...validPayload, newsletter_consent: true }));
  assert.equal(response.status, 400);
  assert.equal(brevo.calls.length, 0);
});

test('contact existant : updateEnabled évite la création d’un doublon', async () => {
  const brevo = mockBrevo();
  await handler(brevo.fetchImpl)(request());
  assert.equal(brevo.calls[0].body.updateEnabled, true);
  assert.equal(brevo.calls[0].url, 'https://api.brevo.com/v3/contacts');
});

test('absence de D1, collecte fermée ou conservation invalide : aucun appel Brevo', async () => {
  const brevo = mockBrevo();
  for (const [leadStore, overrides] of [
    [null, {}], [{}, {}], [createD1Double(), { LEADS_ENABLED: 'false' }],
    [createD1Double(), { LEAD_RETENTION_DAYS: '' }], [createD1Double(), { LEAD_RETENTION_DAYS: '-1' }],
    [createD1Double(), { TURNSTILE_ENABLED: 'true' }]
  ]) {
    const handle = createLeadHandler({ environment: { ...environment, ...overrides }, leadStore, fetchImpl: brevo.fetchImpl });
    const response = await handle(request());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { success: false, message: ERROR_MESSAGE });
  }
  assert.equal(brevo.calls.length, 0);
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

test('hook captcha préservé : un jeton refusé bloque avant Brevo', async () => {
  const brevo = mockBrevo();
  let checked = false;
  const captchaVerifier = async (token) => { checked = true; assert.equal(token, 'future-token'); return false; };
  const response = await createLeadHandler({environment, fetchImpl:brevo.fetchImpl, guard:createMemoryGuard(), leadStore:createD1Double(), captchaVerifier})(request({...validPayload, captcha_token:'future-token'}));
  assert.equal(response.status, 403);
  assert.equal(checked, true);
  assert.equal(brevo.calls.length, 0);
});
