import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.mjs';
import { isReady, readinessReasons } from '../readiness.mjs';

const assets = { fetch: async () => new Response('static') };

const leadsComplete = Object.freeze({
  ASSETS: assets,
  LEADS_ENABLED: 'true',
  LEADS_DB: {},
  LEAD_GUARD: {},
  GUARD_HMAC_KEY: 'g'.repeat(40),
  ALLOWED_ORIGIN: 'https://www.example.invalid',
  BREVO_API_KEY: 'clé de test',
  BREVO_LEADS_LIST_ID: '11',
  BREVO_ACK_TEMPLATE_ID: '33',
  BREVO_INTERNAL_TEMPLATE_ID: '44',
  BLUEWAVE_INTERNAL_EMAIL: 'bluewave@example.invalid'
});

test('tous services fermés : disponible dès que les pages sont servies', () => {
  assert.equal(isReady({ ASSETS: assets }), true);
  assert.deepEqual(readinessReasons({}), ['assets_missing']);
});

test('leads ouvert mais incomplet : chaque dépendance manquante est détectée', () => {
  const cases = {
    leads_db_missing: 'LEADS_DB',
    lead_guard_missing: 'LEAD_GUARD',
    guard_key_missing: 'GUARD_HMAC_KEY',
    allowed_origin_invalid: 'ALLOWED_ORIGIN'
  };
  for (const [reason, field] of Object.entries(cases)) {
    const environment = { ...leadsComplete };
    delete environment[field];
    assert.ok(readinessReasons(environment).includes(reason), `${field} non détecté`);
    assert.equal(isReady(environment), false);
  }
  for (const field of ['BREVO_API_KEY', 'BREVO_LEADS_LIST_ID', 'BREVO_ACK_TEMPLATE_ID', 'BREVO_INTERNAL_TEMPLATE_ID', 'BLUEWAVE_INTERNAL_EMAIL']) {
    const environment = { ...leadsComplete };
    delete environment[field];
    assert.ok(readinessReasons(environment).includes('brevo_config_missing'), `${field} non détecté`);
  }
  // Origine en clair ou avec un chemin : refusée.
  assert.equal(isReady({ ...leadsComplete, ALLOWED_ORIGIN: 'http://www.example.invalid' }), false);
  assert.equal(isReady({ ...leadsComplete, ALLOWED_ORIGIN: 'https://www.example.invalid/api' }), false);
  // Garde trop courte : refusée, car la garde distribuée lèverait à chaque appel.
  assert.equal(isReady({ ...leadsComplete, GUARD_HMAC_KEY: 'court' }), false);
  // Identifiant Brevo non numérique : refusé.
  assert.equal(isReady({ ...leadsComplete, BREVO_LEADS_LIST_ID: 'onze' }), false);
  assert.equal(isReady({ ...leadsComplete, BLUEWAVE_INTERNAL_EMAIL: 'pas-une-adresse' }), false);
});

test('leads ouvert et complet : disponible', () => {
  assert.deepEqual(readinessReasons(leadsComplete), []);
  assert.equal(isReady(leadsComplete), true);
});

test('Turnstile ouvert sans secret : indisponible', () => {
  assert.equal(isReady({ ASSETS: assets, TURNSTILE_ENABLED: 'true' }), false);
  assert.ok(readinessReasons({ ASSETS: assets, TURNSTILE_ENABLED: 'true' }).includes('turnstile_secret_missing'));
  assert.equal(isReady({ ASSETS: assets, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'secret de test' }), true);
});

test('événements ouverts sans base : indisponible', () => {
  assert.equal(isReady({ ASSETS: assets, EVENTS_ENABLED: 'true' }), false);
  assert.equal(isReady({ ASSETS: assets, EVENTS_ENABLED: 'true', CONVERSION_DB: {} }), true);
});

test('lettre de veille ouverte : indisponible tant que le canal n’est pas complet', () => {
  const environment = { ASSETS: assets, NEWSLETTER_ENABLED: 'true' };
  assert.equal(isReady(environment), false);
  assert.ok(readinessReasons(environment).includes('newsletter_channel_not_implemented'));
});

test('durée de conservation invalide : indisponible ; vide : sans effet', () => {
  assert.equal(isReady({ ASSETS: assets, LEAD_RETENTION_DAYS: 'trente' }), false);
  assert.equal(isReady({ ASSETS: assets, LEAD_RETENTION_DAYS: '-5' }), false);
  assert.equal(isReady({ ASSETS: assets, LEAD_RETENTION_DAYS: '' }), true);
  assert.equal(isReady({ ASSETS: assets, LEAD_RETENTION_DAYS: '30' }), true);
});

test('/api/health reflète le readiness réel sans rien divulguer', async () => {
  const incomplete = await worker.fetch(new Request('https://example.invalid/api/health'), { ...leadsComplete, LEADS_DB: undefined }, {});
  assert.equal(incomplete.status, 503);
  assert.deepEqual(await incomplete.json(), { status: 'unavailable' });

  const response = await worker.fetch(new Request('https://example.invalid/api/health'), leadsComplete, {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { status: 'available' });
  for (const leak of ['BREVO', 'GUARD', 'LEADS_DB', 'g'.repeat(40), 'bluewave@example.invalid', 'brevo_config_missing']) {
    assert.equal(body.includes(leak), false);
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('/api/health accepte GET et HEAD, refuse le reste', async () => {
  const environment = { ASSETS: assets };
  for (const method of ['GET', 'HEAD']) {
    const response = await worker.fetch(new Request('https://example.invalid/api/health', { method }), environment, {});
    assert.equal(response.status, 200);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const response = await worker.fetch(new Request('https://example.invalid/api/health', { method }), environment, {});
    assert.equal(response.status, 405);
  }
});

test('toute route API inconnue répond 404, jamais un fichier statique', async () => {
  const environment = { ASSETS: { fetch: async () => new Response('<html>page</html>') } };
  for (const path of ['/api/', '/api/inconnue', '/api/leads/extra', '/api/health/extra', '/api/admin']) {
    const response = await worker.fetch(new Request('https://example.invalid' + path), environment, {});
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), '', path);
  }
});

test('la CSP n’ouvre challenges.cloudflare.com que si Turnstile est activé', async () => {
  const environment = { ASSETS: assets };
  const closed = await worker.fetch(new Request('https://example.invalid/index.html'), environment, {});
  const closedPolicy = closed.headers.get('content-security-policy');
  assert.equal(closedPolicy.includes('challenges.cloudflare.com'), false);
  assert.ok(closedPolicy.includes("frame-src 'none'"));

  const open = await worker.fetch(new Request('https://example.invalid/index.html'), { ...environment, TURNSTILE_ENABLED: 'true' }, {});
  const openPolicy = open.headers.get('content-security-policy');
  assert.ok(openPolicy.includes('script-src \'self\' https://static.cloudflareinsights.com https://challenges.cloudflare.com'));
  assert.ok(openPolicy.includes('frame-src https://challenges.cloudflare.com'));
  assert.ok(openPolicy.includes("frame-ancestors 'none'"));
});

test('cron : les deux purges sont indépendantes et aucune n’échoue en silence', async () => {
  const events = [];
  const logs = [];
  const brokenConversion = { prepare() { throw new Error('base indisponible'); } };
  let leadPurge = 0;
  const leads = { prepare() { return { bind() { return { async run() { leadPurge += 1; return { meta: { changes: 2 } }; } }; } }; } };
  const original = console.log;
  console.log = line => logs.push(line);
  try {
    await worker.scheduled({}, { CONVERSION_DB: brokenConversion, LEADS_DB: leads, LEAD_RETENTION_DAYS: '30' });
  } finally { console.log = original; }
  // La panne de la base d'agrégats n'a pas empêché la purge des demandes.
  assert.equal(leadPurge, 1);
  const parsed = logs.map(line => JSON.parse(line));
  assert.ok(parsed.some(entry => entry.event === 'event_storage_failed' && entry.reason === 'purge'));
  assert.ok(parsed.some(entry => entry.event === 'lead_purged' && entry.count === 2));
  assert.equal(events.length, 0);
});

test('cron : aucune purge de demandes sans durée configurée', async () => {
  let calls = 0;
  const leads = { prepare() { calls += 1; return { bind() { return { async run() { return { meta: { changes: 0 } }; } }; } }; } };
  await worker.scheduled({}, { LEADS_DB: leads });
  assert.equal(calls, 0);
});
