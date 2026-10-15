import assert from 'node:assert/strict';
import test from 'node:test';

import { createLeadHandler, SUCCESS_MESSAGE, ERROR_MESSAGE } from '../handler.mjs';
import { createMemoryGuard } from '../security.mjs';
import { createD1Double } from './d1-double.mjs';

const environment = Object.freeze({
  BREVO_API_KEY: 'test-credential',
  BREVO_LEADS_LIST_ID: '11',
  BREVO_ACK_TEMPLATE_ID: '33',
  BREVO_INTERNAL_TEMPLATE_ID: '44',
  BLUEWAVE_INTERNAL_EMAIL: 'bluewave@example.invalid',
  ALLOWED_ORIGIN: 'https://example.invalid'
});

const payload = Object.freeze({
  journey: 'projet', lead_type: 'projet-mission', source_offer: 'note-strategique',
  recommended_offer: 'diagnostic-strategique', organisation_type: 'collectivite',
  territory: 'cote-divoire', need_category: 'vulnerabilite', stage: 'cadrage',
  data_availability: 'etudes', desired_outcome: 'options',
  firstname: 'Awa', lastname: 'Koné', email: 'awa.kone@example.invalid',
  organisation: 'Organisation test', contact_preference: 'email', deadline: '3-6m',
  need: 'Structurer un besoin littoral.',
  newsletter_optin_request: false, privacy_acknowledged: true, website: ''
});

const request = (body = payload) => new Request('https://function.example.invalid/bluewave-leads', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: environment.ALLOWED_ORIGIN },
  body: JSON.stringify(body)
});

const brevoAlways = status => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ id: 1 }), { status, headers: { 'content-type': 'application/json' } });
    }
  };
};

const handler = (fetchImpl, leadStore, extra = {}) => createLeadHandler({
  environment, fetchImpl, leadStore,
  guard: createMemoryGuard({ rateLimit: 50 }),
  logger: { log: () => null },
  ...extra
});

test('la demande est enregistrée avant le premier appel Brevo', async () => {
  const order = [];
  const database = createD1Double();
  const tracked = {
    prepare(sql) {
      const inner = database.prepare(sql);
      return { bind(...values) {
        const bound = inner.bind(...values);
        return { async run() { order.push('store'); return bound.run(); }, all: bound.all };
      } };
    }
  };
  const fetchImpl = async (url, options) => { order.push('brevo'); return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }); };
  const response = await handler(fetchImpl, tracked)(request());
  assert.equal(response.status, 201);
  assert.equal(order[0], 'store');
  assert.equal(order.includes('brevo'), true);
});

test('panne Brevo complète : la demande est conservée et la réponse reste un succès', async () => {
  const database = createD1Double();
  const brevo = brevoAlways(503);
  const response = await handler(brevo.fetchImpl, database)(request());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true, message: SUCCESS_MESSAGE });
  assert.equal(database.size, 1);
  const row = database.first();
  assert.equal(row.delivery_status, 'FAILED');
  assert.equal(row.brevo_contact_status, 'FAILED');
  assert.equal(row.ack_status, 'FAILED');
  assert.equal(row.notification_status, 'FAILED');
  assert.equal(row.last_error_code, 'brevo_contact');
});

test('échec partiel : contact et accusé passés, notification en échec', async () => {
  const database = createD1Double();
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return new Response('{}', { status: call === 3 ? 500 : 201, headers: { 'content-type': 'application/json' } });
  };
  const response = await handler(fetchImpl, database)(request());
  assert.equal(response.status, 201);
  const row = database.first();
  assert.equal(row.brevo_contact_status, 'OK');
  assert.equal(row.ack_status, 'OK');
  assert.equal(row.notification_status, 'FAILED');
  assert.equal(row.delivery_status, 'PARTIAL_FAILURE');
  assert.equal(row.last_error_code, 'internal_notification');
});

test('diffusion complète : statut DELIVERED et aucun code d’erreur', async () => {
  const database = createD1Double();
  const brevo = brevoAlways(201);
  await handler(brevo.fetchImpl, database)(request());
  const row = database.first();
  assert.equal(row.delivery_status, 'DELIVERED');
  assert.equal(row.last_error_code, '');
  assert.equal(brevo.calls.length, 3);
});

test('la garde anti-doublon arrête une reprise immédiate avant tout stockage', async () => {
  const database = createD1Double();
  const brevo = brevoAlways(201);
  const handle = handler(brevo.fetchImpl, database);
  assert.equal((await handle(request())).status, 201);
  assert.equal((await handle(request())).status, 409);
  assert.equal(database.size, 1);
  assert.equal(brevo.calls.length, 3);
});

test('seconde ligne de défense : garde passée, le stockage collapse quand même la reprise', async () => {
  // Fenêtre anti-doublon écoulée, ou état de garde perdu entre deux instances :
  // l'idempotence de la base doit encore empêcher une seconde ligne et un
  // second accusé.
  const database = createD1Double();
  const brevo = brevoAlways(201);
  const permissive = { allowRate: () => true, claimSubmission: () => true };
  const handle = createLeadHandler({
    environment, fetchImpl: brevo.fetchImpl, leadStore: database,
    guard: permissive, logger: { log: () => null }
  });
  const first = await handle(request());
  const second = await handle(request());
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { success: true, message: SUCCESS_MESSAGE });
  assert.equal(database.size, 1);
  // Trois appels pour la première demande, aucun pour la reprise.
  assert.equal(brevo.calls.length, 3);
});

test('stockage indisponible : aucun accusé expédié, l’envoi est à refaire', async () => {
  const database = createD1Double({ failOn: 'INSERT INTO lead_records' });
  const brevo = brevoAlways(201);
  const response = await handler(brevo.fetchImpl, database)(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { success: false, message: ERROR_MESSAGE });
  assert.equal(brevo.calls.length, 0);
});

test('sans LEADS_DB, le comportement antérieur est conservé : panne Brevo = erreur', async () => {
  const brevo = brevoAlways(503);
  const response = await handler(brevo.fetchImpl, null)(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { success: false, message: ERROR_MESSAGE });
});

test('aucune donnée personnelle ne quitte le service dans la réponse', async () => {
  const database = createD1Double();
  const brevo = brevoAlways(201);
  const response = await handler(brevo.fetchImpl, database)(request());
  const body = await response.text();
  for (const secret of ['awa.kone@example.invalid', 'Koné', 'Organisation test', 'Structurer un besoin littoral.']) {
    assert.equal(body.includes(secret), false);
  }
});
