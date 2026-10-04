import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLeadRecord, idempotencyKey, journeyPayload, markDelivery,
  purgeExpiredLeads, retentionCutoff, selectExpiredLeads, storeLead, canonicalRepresentation,
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

// Canon d'idempotence : deux demandes métier différentes ne doivent jamais
// partager une empreinte, même déposées le même jour par la même personne.
const DAY = new Date('2026-10-04T08:00:00Z');
const NEXT = new Date('2026-10-05T08:00:00Z');
const keyFor = (overrides = {}, when = DAY) => idempotencyKey({ ...lead, ...overrides }, when);

const expertise = Object.freeze({
  ...lead, journey: 'collaboration', lead_type: 'expertise-offer',
  professional_status: 'independant', expertise_domains: ['littoral-adaptation'],
  intervention_types: ['etude'], work_languages: ['francais'], availability: 'immediate',
  expertise_evidence: 'Références publiques.', motivation: 'Travailler sur le littoral.',
  mobility: 'Méditerranée', rate_range: '600-800'
});

const formation = Object.freeze({
  ...lead, journey: 'formation', lead_type: 'formation',
  audience: 'Agents de collectivité', training_subject: 'Gouvernance littorale',
  learning_objectives: 'Comprendre les cadres applicables.', training_format: 'distance',
  period: 'Premier trimestre', location: '', duration: '2 jours'
});

test('A — demande identique le même jour : même clé', async () => {
  assert.equal(await keyFor(), await keyFor());
});

test('B — demande identique le jour suivant : clé différente', async () => {
  assert.notEqual(await keyFor(), await keyFor({}, NEXT));
});

test('C — même e-mail et même besoin, territoire différent : clé différente', async () => {
  assert.notEqual(await keyFor(), await keyFor({ territory: 'france-mediterranee' }));
});

test('D — source_offer différente : clé différente', async () => {
  assert.notEqual(await keyFor(), await keyFor({ source_offer: 'atelier-cadrage' }));
});

test('E — recommended_offer différente : clé différente', async () => {
  assert.notEqual(await keyFor(), await keyFor({ recommended_offer: 'gouvernance-acteurs' }));
});

test('F — organisation différente : clé différente', async () => {
  assert.notEqual(await keyFor(), await keyFor({ organisation: 'Autre organisation' }));
});

test('G — expertise : même motivation, domaines différents : clé différente', async () => {
  const base = await idempotencyKey(expertise, DAY);
  const other = await idempotencyKey({ ...expertise, expertise_domains: ['gouvernance-maritime'] }, DAY);
  assert.notEqual(base, other);
});

test('H — expertise : mobilité ou tarif différent : clé différente', async () => {
  const base = await idempotencyKey(expertise, DAY);
  assert.notEqual(base, await idempotencyKey({ ...expertise, mobility: 'Golfe de Guinée' }, DAY));
  assert.notEqual(base, await idempotencyKey({ ...expertise, rate_range: '900-1100' }, DAY));
});

test('I — formation : mêmes objectifs, format différent : clé différente', async () => {
  const base = await idempotencyKey(formation, DAY);
  assert.notEqual(base, await idempotencyKey({ ...formation, training_format: 'presentiel' }, DAY));
});

test('J — formation : public ou période différent : clé différente', async () => {
  const base = await idempotencyKey(formation, DAY);
  assert.notEqual(base, await idempotencyKey({ ...formation, audience: 'Élus' }, DAY));
  assert.notEqual(base, await idempotencyKey({ ...formation, period: 'Automne' }, DAY));
});

test('la représentation canonique est stable et n’emporte rien d’invisible', () => {
  const a = canonicalRepresentation({ ...expertise, expertise_domains: ['gouvernance-maritime', 'littoral-adaptation'] });
  const b = canonicalRepresentation({ ...expertise, expertise_domains: ['littoral-adaptation', 'gouvernance-maritime', 'littoral-adaptation'] });
  // Ordre d'origine et doublons sans effet.
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const serialised = JSON.stringify(canonicalRepresentation(lead));
  for (const forbidden of ['captcha_token', 'website', 'correlation_id', 'created_at', 'delivery_status', 'qualification_status', 'valeur de test']) {
    assert.equal(serialised.includes(forbidden), false);
  }
});
