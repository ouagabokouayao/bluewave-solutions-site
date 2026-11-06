// Interrupteurs indépendants : collecte, contacts, accusés, notifications,
// campagnes et réémission s'ouvrent séparément. Aucun ne s'ouvre par défaut.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createLeadHandler } from '../handler.mjs';
import { replayDelivery } from '../replay.mjs';
import { createMemoryGuard } from '../security.mjs';
import { createD1Double } from './d1-double.mjs';
import { readinessReasons } from '../../cloudflare/readiness.mjs';

const ORIGIN = 'https://example.invalid';
const collectOnly = Object.freeze({ LEADS_ENABLED: 'true', LEAD_RETENTION_DAYS: '30', ALLOWED_ORIGIN: ORIGIN });
const brevo = Object.freeze({ BREVO_API_KEY: 'cle-de-test', BREVO_LEADS_LIST_ID: '11', BREVO_ACK_TEMPLATE_ID: '33',
  BREVO_INTERNAL_TEMPLATE_ID: '44', BLUEWAVE_INTERNAL_EMAIL: 'bluewave@example.invalid' });
const lead = Object.freeze({ journey: 'projet', lead_type: 'projet-mission', organisation_type: 'collectivite', territory: 'cote-divoire',
  need_category: 'vulnerabilite', stage: 'cadrage', data_availability: 'etudes', desired_outcome: 'options', firstname: 'Awa', lastname: 'Koné',
  email: 'awa@example.invalid', organisation: 'Organisation test', contact_preference: 'email', deadline: '3-6m', need: 'Besoin fictif',
  newsletter_optin_request: false, privacy_acknowledged: true, website: '' });
const post = body => new Request('https://function.example.invalid/', { method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify(body) });
const recorder = (status = 201) => {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return new Response('{}', { status }); } };
};
const submit = (environment, database, fetchImpl, body = lead) => createLeadHandler({ environment, leadStore: database, fetchImpl,
  guard: createMemoryGuard({ rateLimit: 50 }), logger: { log: () => null } })(post(body));

test('collecte seule : demande stockée, aucun appel Brevo, aucune clé nécessaire', async () => {
  const database = createD1Double(); const { calls, fetchImpl } = recorder();
  assert.equal((await submit(collectOnly, database, fetchImpl)).status, 201);
  assert.equal(calls.length, 0);
  const row = database.first();
  assert.equal(row.delivery_status, 'STORED');
  assert.deepEqual([row.brevo_contact_status, row.ack_status, row.notification_status], ['SKIPPED', 'SKIPPED', 'SKIPPED']);
});

for (const [flag, field, count] of [['LEADS_ACK_ENABLED', 'ack_status', 1], ['LEADS_NOTIFY_ENABLED', 'notification_status', 1], ['LEADS_CONTACT_SYNC_ENABLED', 'brevo_contact_status', 1]]) {
  test(`${flag} s’ouvre seul`, async () => {
    const database = createD1Double(); const { calls, fetchImpl } = recorder();
    assert.equal((await submit({ ...collectOnly, ...brevo, [flag]: 'true' }, database, fetchImpl)).status, 201);
    assert.equal(calls.length, count);
    const row = database.first();
    assert.equal(row[field], 'OK');
    assert.equal(row.delivery_status, 'DELIVERED');
    assert.equal([row.brevo_contact_status, row.ack_status, row.notification_status].filter(status => status === 'SKIPPED').length, 2);
  });
}

test('une étape ouverte sans ses paramètres refuse la demande sans appel Brevo', async () => {
  const database = createD1Double(); const { calls, fetchImpl } = recorder();
  assert.equal((await submit({ ...collectOnly, LEADS_ACK_ENABLED: 'true' }, database, fetchImpl)).status, 500);
  assert.equal(database.size, 0); assert.equal(calls.length, 0);
});

test('campagnes fermées : un code autorisé est ignoré ; ouvertes : il est conservé', async () => {
  const body = { ...lead, acquisition_source: 'linkedin', campaign_code: 'c01-test' };
  const closed = createD1Double();
  await submit({ ...collectOnly, ALLOWED_CAMPAIGNS: 'c01-test' }, closed, recorder().fetchImpl, body);
  assert.equal(JSON.parse(closed.first().journey_payload).campaign_code, '');
  const open = createD1Double();
  await submit({ ...collectOnly, ALLOWED_CAMPAIGNS: 'c01-test', CAMPAIGNS_ENABLED: 'true' }, open, recorder().fetchImpl, body);
  assert.equal(JSON.parse(open.first().journey_payload).campaign_code, 'c01-test');
});

const seeded = async (status = 400) => {
  const database = createD1Double();
  const all = { ...collectOnly, ...brevo, LEADS_ACK_ENABLED: 'true', LEADS_NOTIFY_ENABLED: 'true' };
  await submit(all, database, recorder(status).fetchImpl);
  return { database, id: database.first().id, all };
};

test('collecte publique fermée : la réémission autorisée reste possible', async () => {
  const { database, id, all } = await seeded();
  const { calls, fetchImpl } = recorder();
  const environment = { ...all, LEADS_ENABLED: 'false', LEADS_REPLAY_ENABLED: 'true' };
  const result = await replayDelivery(database, id, { environment, fetchImpl, dryRun: false, logger: { log: () => null } });
  assert.equal(result.delivery_status, 'DELIVERED');
  assert.deepEqual(result.steps, ['ack', 'internal_notification']);
  assert.equal(calls.length, 2);
  assert.equal(database.first().brevo_contact_status, 'SKIPPED');
});

test('sans interrupteur de réémission, rien n’est renvoyé, même collecte ouverte', async () => {
  const { database, id, all } = await seeded();
  const { calls, fetchImpl } = recorder();
  assert.equal((await replayDelivery(database, id, { environment: all, fetchImpl, dryRun: false })).reason, 'delivery_closed');
  assert.equal(calls.length, 0);
});

test('une étape fermée n’est pas réémise, et sa reprise reste due', async () => {
  const { database, id, all } = await seeded();
  const { calls, fetchImpl } = recorder();
  const environment = { ...all, LEADS_ACK_ENABLED: 'false', LEADS_REPLAY_ENABLED: 'true' };
  const result = await replayDelivery(database, id, { environment, fetchImpl, dryRun: false, logger: { log: () => null } });
  assert.deepEqual(result.steps, ['internal_notification']);
  assert.equal(calls.length, 1);
  assert.equal(database.first().ack_status, 'FAILED');
  assert.equal(database.first().delivery_status, 'PARTIAL_FAILURE');
  assert.equal((await replayDelivery(database, id, { environment: { ...environment, LEADS_NOTIFY_ENABLED: 'false' }, fetchImpl, dryRun: false })).reason, 'steps_closed');
});

test('une demande hors durée de conservation n’est jamais réémise', async () => {
  const { database, id, all } = await seeded();
  const { calls, fetchImpl } = recorder();
  const later = () => new Date(Date.now() + 31 * 86400000);
  const result = await replayDelivery(database, id, { environment: { ...all, LEADS_REPLAY_ENABLED: 'true' }, fetchImpl, dryRun: false, now: later });
  assert.equal(result.reason, 'retention_expired');
  assert.equal(calls.length, 0);
});

test('disponibilité : la réémission ouverte exige sa base, sa durée et ses paramètres', () => {
  const assets = { ASSETS: {} };
  assert.deepEqual(readinessReasons(assets), []);
  const reasons = readinessReasons({ ...assets, LEADS_REPLAY_ENABLED: 'true', LEADS_ACK_ENABLED: 'true' });
  for (const reason of ['leads_db_missing', 'lead_retention_missing', 'brevo_config_missing']) assert.ok(reasons.includes(reason), reason);
  assert.ok(readinessReasons({ ...assets, CAMPAIGNS_ENABLED: 'true' }).includes('campaigns_missing'));
});
