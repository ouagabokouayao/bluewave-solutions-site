import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLeadRecord, idempotencyKey, journeyPayload, markDelivery,
  purgeExpiredLeads, retentionCutoff, selectExpiredLeads, storeLead,
  DELIVERY_STATUSES, EXPERTISE_STATUSES
} from '../lead-store.mjs';
import { createD1Double } from './d1-double.mjs';

const lead = Object.freeze({
  journey: 'projet', lead_type: 'projet-mission', source_offer: 'note-strategique',
  recommended_offer: 'diagnostic-strategique', organisation_type: 'collectivite',
  territory: 'cote-divoire', need_category: 'vulnerabilite', stage: 'cadrage',
  data_availability: 'etudes', desired_outcome: 'options', deadline: '3-6m',
  contact_preference: 'email', firstname: 'Awa', lastname: 'Koné',
  email: 'awa.kone@example.invalid', organisation: 'Organisation test', role: 'Cheffe de projet',
  need: 'Structurer un besoin littoral.',
  captcha_token: 'valeur de test jamais stockée', website: ''
});

test('la charge métier ne retient que des champs du schéma et jamais le jeton', () => {
  const payload = journeyPayload({ ...lead, motivation: 'Travailler ensemble', inconnu: 'x' });
  assert.equal(payload.need, 'Structurer un besoin littoral.');
  assert.equal(payload.motivation, 'Travailler ensemble');
  assert.equal('captcha_token' in payload, false);
  assert.equal('website' in payload, false);
  assert.equal('inconnu' in payload, false);
});

test('la ligne stockée ne contient ni jeton, ni honeypot, ni adresse', async () => {
  const record = await buildLeadRecord(lead, { now: new Date('2026-10-04T08:00:00Z'), correlationId: 'abc' });
  const serialised = JSON.stringify(record);
  assert.equal(serialised.includes('valeur de test jamais stockée'), false);
  assert.equal('ip' in record, false);
  assert.equal('captcha_token' in record, false);
  assert.equal(record.delivery_status, 'STORED');
  assert.ok(DELIVERY_STATUSES.includes(record.delivery_status));
  assert.equal(record.correlation_id, 'abc');
});

test('une demande d’expertise entre au premier échelon, jamais à MOBILISABLE', async () => {
  const record = await buildLeadRecord({ ...lead, journey: 'collaboration', lead_type: 'expertise-offer' });
  assert.equal(record.qualification_status, 'REÇU');
  assert.equal(EXPERTISE_STATUSES.includes('MOBILISABLE'), false);
  const projet = await buildLeadRecord(lead);
  assert.equal(projet.qualification_status, '');
});

test('idempotence : même demande le même jour, une seule clé ; un autre jour, une autre', async () => {
  const first = await idempotencyKey(lead, new Date('2026-10-04T08:00:00Z'));
  const same = await idempotencyKey(lead, new Date('2026-10-04T22:30:00Z'));
  const later = await idempotencyKey(lead, new Date('2026-10-05T08:00:00Z'));
  assert.equal(first, same);
  assert.notEqual(first, later);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('un renvoi identique n’ajoute pas de seconde ligne', async () => {
  const database = createD1Double();
  const now = new Date('2026-10-04T08:00:00Z');
  const first = await storeLead(database, await buildLeadRecord(lead, { now }));
  const second = await storeLead(database, await buildLeadRecord(lead, { now }));
  assert.equal(first.stored, true);
  assert.equal(second.stored, false);
  assert.equal(second.duplicate, true);
  assert.equal(database.size, 1);
});

test('les statuts de diffusion sont consignés sur la ligne existante', async () => {
  const database = createD1Double();
  const record = await buildLeadRecord(lead);
  await storeLead(database, record);
  await markDelivery(database, record.id, {
    brevo_contact_status: 'OK', ack_status: 'FAILED', notification_status: 'PENDING',
    delivery_status: 'PARTIAL_FAILURE', last_error_code: 'ack'
  });
  const stored = database.first();
  assert.equal(stored.brevo_contact_status, 'OK');
  assert.equal(stored.ack_status, 'FAILED');
  assert.equal(stored.delivery_status, 'PARTIAL_FAILURE');
  assert.equal(stored.last_error_code, 'ack');
});

test('aucune purge sans durée explicitement configurée', async () => {
  assert.equal(retentionCutoff(undefined), null);
  assert.equal(retentionCutoff(''), null);
  assert.equal(retentionCutoff(0), null);
  assert.equal(retentionCutoff(-5), null);
  const database = createD1Double();
  await storeLead(database, await buildLeadRecord(lead, { now: new Date('2020-01-01T00:00:00Z') }));
  const result = await purgeExpiredLeads(database, '', new Date('2026-10-04T00:00:00Z'));
  assert.deepEqual(result, { purged: 0, skipped: true });
  assert.equal(database.size, 1);
});

test('purge configurable : seules les demandes expirées disparaissent', async () => {
  const database = createD1Double();
  const now = new Date('2026-10-04T00:00:00Z');
  await storeLead(database, await buildLeadRecord(lead, { now: new Date('2023-01-01T00:00:00Z') }));
  await storeLead(database, await buildLeadRecord({ ...lead, email: 'recent@example.invalid' }, { now: new Date('2026-10-01T00:00:00Z') }));
  const expired = await selectExpiredLeads(database, 30, now);
  assert.equal(expired.length, 1);
  const purge = await purgeExpiredLeads(database, 30, now);
  assert.equal(purge.purged, 1);
  assert.equal(purge.skipped, false);
  assert.equal(database.size, 1);
  assert.equal(database.first().email, 'recent@example.invalid');
});
