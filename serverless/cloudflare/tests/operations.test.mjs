import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.mjs';
import { buildLogRecord, createLogger, newCorrelationId } from '../../bluewave-leads/observability.mjs';
import { createD1Double } from '../../bluewave-leads/tests/d1-double.mjs';
import { buildLeadRecord, storeLead } from '../../bluewave-leads/lead-store.mjs';

const assets = { fetch: async () => new Response('static') };

test('/api/health ne révèle ni binding, ni identifiant de base, ni secret', async () => {
  const env = { ASSETS: assets, LEADS_DB: { id: 'ne-doit-pas-fuiter' }, CONVERSION_DB: {}, GUARD_HMAC_KEY: 'x'.repeat(40) };
  const response = await worker.fetch(new Request('https://example.invalid/api/health'), env, {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { status: 'available' });
  for (const leak of ['ne-doit-pas-fuiter', 'LEADS_DB', 'CONVERSION_DB', 'GUARD_HMAC_KEY', 'x'.repeat(40)]) {
    assert.equal(body.includes(leak), false);
  }
});

test('/api/health signale l’indisponibilité quand une base annoncée manque', async () => {
  const missing = await worker.fetch(new Request('https://example.invalid/api/health'), { ASSETS: assets, LEADS_ENABLED: 'true' }, {});
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { status: 'unavailable' });
  const ok = await worker.fetch(new Request('https://example.invalid/api/health'), { ASSETS: assets, LEADS_ENABLED: 'true', LEADS_DB: {} }, {});
  assert.equal(ok.status, 200);
});

test('/api/health refuse les méthodes d’écriture', async () => {
  const response = await worker.fetch(new Request('https://example.invalid/api/health', { method: 'POST' }), { ASSETS: assets }, {});
  assert.equal(response.status, 405);
});

test('le journal retient les étapes, jamais une donnée personnelle', () => {
  const records = [];
  const logger = createLogger({ sink: record => records.push(record) });
  const correlationId = newCorrelationId();
  logger.log('lead_stored', {
    correlation_id: correlationId, journey: 'projet', lead_type: 'projet-mission',
    email: 'awa.kone@example.invalid', firstname: 'Awa', need: 'Structurer un besoin littoral.',
    captcha_token: 'jeton', ip: '192.0.2.10'
  });
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { event: 'lead_stored', correlation_id: correlationId, journey: 'projet', lead_type: 'projet-mission' });
  const serialised = JSON.stringify(records[0]);
  for (const leak of ['awa.kone', 'Awa', 'Structurer', 'jeton', '192.0.2.10']) {
    assert.equal(serialised.includes(leak), false);
  }
});

test('le journal refuse un événement inconnu et une valeur non fermée', () => {
  assert.equal(buildLogRecord('evenement_invente', {}), null);
  const record = buildLogRecord('ack_failed', { reason: 'texte libre avec espaces et accents é' });
  assert.deepEqual(record, { event: 'ack_failed' });
});

test('les deux bases restent séparées : aucune demande dans les agrégats', async () => {
  const conversionStatements = [];
  const conversion = { prepare(sql) { conversionStatements.push(sql); return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } }; } };
  const leads = createD1Double();
  await storeLead(leads, await buildLeadRecord({
    journey: 'projet', lead_type: 'projet-mission', firstname: 'Awa', lastname: 'Koné',
    email: 'awa.kone@example.invalid', need: 'Structurer un besoin littoral.'
  }));
  const origin = 'https://example.invalid';
  const request = new Request(origin + '/api/events', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ event_name: 'lead_submit_success', page: 'qualifier-un-besoin', journey: 'projet' })
  });
  await worker.fetch(request, { EVENTS_ENABLED: 'true', CONVERSION_DB: conversion, LEADS_DB: leads }, {});
  assert.equal(conversionStatements.length, 1);
  assert.ok(conversionStatements[0].includes('conversion_counts'));
  assert.equal(conversionStatements.some(sql => sql.includes('lead_records')), false);
  assert.equal(leads.statements.some(sql => sql.includes('conversion_counts')), false);
});

test('purge des demandes : rien sans durée configurée, purge ciblée sinon', async () => {
  const leads = createD1Double();
  await storeLead(leads, await buildLeadRecord(
    { journey: 'projet', lead_type: 'projet-mission', firstname: 'A', lastname: 'B', email: 'a@example.invalid', need: 'x' },
    { now: new Date('2020-01-01T00:00:00Z') }
  ));
  await worker.scheduled({}, { LEADS_DB: leads });
  assert.equal(leads.size, 1);
  await worker.scheduled({}, { LEADS_DB: leads, LEAD_RETENTION_DAYS: '30' });
  assert.equal(leads.size, 0);
});
