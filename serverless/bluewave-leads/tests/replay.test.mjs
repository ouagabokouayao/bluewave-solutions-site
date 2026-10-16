import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLeadRecord, markDelivery, storeLead } from '../lead-store.mjs';
import { leadFromRecord, replayDelivery, stepsToReplay } from '../replay.mjs';
import { anonymiseRecord, exportRecord, findByEmail } from '../data-rights.mjs';
import { createD1Double } from './d1-double.mjs';

const environment = Object.freeze({
  BREVO_API_KEY: 'test-credential',
  BREVO_LEADS_LIST_ID: '11',
  BREVO_ACK_TEMPLATE_ID: '33',
  BREVO_INTERNAL_TEMPLATE_ID: '44',
  BLUEWAVE_INTERNAL_EMAIL: 'bluewave@example.invalid',
  ALLOWED_ORIGIN: 'https://example.invalid'
});

const lead = Object.freeze({
  journey: 'projet', lead_type: 'projet-mission', territory: 'cote-divoire',
  firstname: 'Awa', lastname: 'Koné', email: 'awa.kone@example.invalid',
  organisation: 'Organisation test', role: 'Cheffe de projet',
  need: 'Structurer un besoin littoral.', deadline: '3-6m', contact_preference: 'email'
});

async function seed(database, steps = {}) {
  const record = await buildLeadRecord(lead);
  await storeLead(database, record);
  if (Object.keys(steps).length) await markDelivery(database, record.id, steps);
  return record;
}

test('seules les étapes non abouties sont candidates à la reprise', () => {
  assert.deepEqual(stepsToReplay({ brevo_contact_status: 'OK', ack_status: 'FAILED', notification_status: 'PENDING' }),
    ['ack', 'internal_notification']);
  assert.deepEqual(stepsToReplay({ brevo_contact_status: 'OK', ack_status: 'OK', notification_status: 'OK' }), []);
});

test('par défaut la reprise ne fait qu’annoncer ce qu’elle ferait', async () => {
  const database = createD1Double();
  const record = await seed(database, { brevo_contact_status: 'OK', ack_status: 'FAILED', notification_status: 'PENDING', delivery_status: 'PARTIAL_FAILURE' });
  let calls = 0;
  const result = await replayDelivery(database, record.id, { environment, fetchImpl: async () => { calls += 1; return new Response('{}', { status: 201 }); } });
  assert.deepEqual(result, { ok: true, reason: 'dry_run', steps: ['ack', 'internal_notification'] });
  assert.equal(calls, 0);
});

test('garde anti-double envoi : une étape déjà aboutie n’est jamais rejouée', async () => {
  const database = createD1Double();
  const record = await seed(database, { brevo_contact_status: 'OK', ack_status: 'FAILED', notification_status: 'FAILED', delivery_status: 'PARTIAL_FAILURE' });
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push(JSON.parse(options.body)); return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }); };
  const result = await replayDelivery(database, record.id, { environment, fetchImpl, dryRun: false, logger: { log: () => null } });
  assert.equal(result.ok, true);
  assert.equal(result.delivery_status, 'DELIVERED');
  // Deux appels seulement : le contact déjà passé n'est pas refait.
  assert.equal(calls.length, 2);
  assert.equal(calls.some(body => body.listIds !== undefined), false, 'aucun upsert de contact rejoué');
  const row = database.first();
  assert.equal(row.delivery_status, 'DELIVERED');
  assert.equal(row.last_error_code, '');
});

test('une demande déjà diffusée n’est pas rejouée', async () => {
  const database = createD1Double();
  const record = await seed(database, { brevo_contact_status: 'OK', ack_status: 'OK', notification_status: 'OK', delivery_status: 'DELIVERED' });
  let calls = 0;
  const result = await replayDelivery(database, record.id, { environment, fetchImpl: async () => { calls += 1; return new Response('{}'); }, dryRun: false });
  assert.deepEqual(result, { ok: true, reason: 'already_delivered', steps: [] });
  assert.equal(calls, 0);
});

test('reprise encore en échec : statut conservé, rien d’inventé', async () => {
  const database = createD1Double();
  const record = await seed(database, { brevo_contact_status: 'FAILED', ack_status: 'FAILED', notification_status: 'FAILED', delivery_status: 'FAILED' });
  const events = [];
  const result = await replayDelivery(database, record.id, {
    environment, fetchImpl: async () => new Response('', { status: 503 }), dryRun: false,
    logger: { log: (event, details) => events.push(event) }
  });
  assert.equal(result.ok, false);
  assert.equal(result.delivery_status, 'FAILED');
  assert.ok(events.includes('replay_failed'));
  assert.equal(database.first().last_error_code, 'brevo_contact');
});

test('identifiant inconnu : refus net', async () => {
  const database = createD1Double();
  assert.deepEqual(await replayDelivery(database, 'inexistant', { environment }), { ok: false, reason: 'not_found' });
});

test('la charge rejouée est relue de la base, sans rien inventer', async () => {
  const database = createD1Double();
  const record = await seed(database);
  const reconstituted = leadFromRecord(database.first());
  assert.equal(reconstituted.email, 'awa.kone@example.invalid');
  assert.equal(reconstituted.need, 'Structurer un besoin littoral.');
  assert.equal(reconstituted.source, 'SITE_FORMS');
  assert.equal(reconstituted.newsletter_consent, false);
  assert.equal(record.id.length > 0, true);
});

test('droits : retrouver, exporter, anonymiser', async () => {
  const database = createD1Double();
  const record = await seed(database);
  const found = await findByEmail(database, 'AWA.KONE@EXAMPLE.INVALID', { logger: { log: () => null } });
  assert.equal(found.length, 1);

  const exported = await exportRecord(database, record.id, { logger: { log: () => null } });
  assert.equal(exported.email, 'awa.kone@example.invalid');
  assert.equal(exported.journey_payload.need, 'Structurer un besoin littoral.');
  // L'empreinte technique et la corrélation ne font pas partie d'un export.
  assert.equal('idempotency_key' in exported, false);
  assert.equal('correlation_id' in exported, false);

  await anonymiseRecord(database, record.id, { logger: { log: () => null } });
  const row = database.first();
  assert.equal(row.email, '[anonymisé]');
  assert.equal(row.firstname, '[anonymisé]');
  assert.equal(row.journey_payload, '{}');
  // La qualification survit à l'anonymisation.
  assert.equal(row.journey, 'projet');
  assert.equal(row.territory, 'cote-divoire');
});

test('le journal des opérations sur les droits ne porte aucune identité', async () => {
  const database = createD1Double();
  const record = await seed(database);
  const records = [];
  const logger = { log: (event, details) => records.push({ event, details }) };
  await findByEmail(database, lead.email, { logger });
  await exportRecord(database, record.id, { logger });
  await anonymiseRecord(database, record.id, { logger });
  assert.deepEqual(records.map(entry => entry.details.operation), ['find', 'export', 'anonymise']);
  assert.equal(JSON.stringify(records).includes('awa.kone'), false);
});
