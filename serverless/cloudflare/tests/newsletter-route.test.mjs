// Routes réelles du Worker, base D1 réelle (Miniflare), Brevo simulé.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import worker from '../worker.mjs';

const ORIGIN = 'https://bluewave.test';
const EMAIL = 'veille@example.invalid';
const guard = { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ ok: true }) }) };
const base = { ASSETS: { fetch: async () => new Response('page') }, ALLOWED_ORIGIN: ORIGIN, BLUEWAVE_SITE_URL: ORIGIN, LEAD_GUARD: guard, GUARD_HMAC_KEY: 'g'.repeat(40),
  NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: 's'.repeat(40), NEWSLETTER_NOTICE_VERSION: 'veille-v1', NEWSLETTER_PROOF_RETENTION_DAYS: '1095',
  BREVO_API_KEY: 'cle-synthetique', BREVO_NEWSLETTER_LIST_ID: '7', BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID: '8' };

function call(env, action, body, { method = 'POST', origin = ORIGIN, type = 'application/json' } = {}) {
  const headers = { 'cf-connecting-ip': '192.0.2.20' };
  if (origin) headers.origin = origin;
  if (type) headers['content-type'] = type;
  return worker.fetch(new Request(`${ORIGIN}/api/newsletter/${action}`, { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env);
}

async function scenario(run, overrides = {}) {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("local");}}', d1Databases: { NEWSLETTER_DB: 'veille-route' }, d1Persist: false });
  const previous = globalThis.fetch;
  const previousLog = console.log;
  const brevo = [];
  const logs = [];
  let failing = false;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.brevo.com/')) throw new Error(`Sortie réseau interdite : ${url}`);
    brevo.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body) });
    return new Response('{}', { status: failing ? 503 : 201 });
  };
  console.log = line => logs.push(String(line));
  try {
    const database = await mf.getD1Database('NEWSLETTER_DB');
    const sql = await readFile(new URL('../newsletter-schema.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) await database.prepare(statement).run();
    await run({ env: { ...base, NEWSLETTER_DB: database, ...overrides }, database, brevo, logs, fail: value => { failing = value; } });
  } finally { globalThis.fetch = previous; console.log = previousLog; await mf.dispose(); }
}
const subscribe = (env, extra = {}) => call(env, 'subscribe', { email: EMAIL, consent: true, preferences: ['veille'], ...extra });
const confirmationToken = brevo => brevo.find(item => item.path === '/v3/smtp/email').body.params.confirmation_url.split('#confirmer=')[1];

test('route fermée : 503 sans lecture ni appel extérieur, inconnue : 404', async () => {
  await scenario(async ({ env, brevo }) => {
    for (const action of ['subscribe', 'confirm', 'preferences']) assert.equal((await call(env, action, {})).status, 503);
    assert.equal((await call(env, 'inconnue', {})).status, 404);
    assert.equal((await call({ ASSETS: base.ASSETS, ALLOWED_ORIGIN: ORIGIN }, 'unsubscribe', { token: 'a'.repeat(43) })).status, 503);
    assert.equal(brevo.length, 0);
  }, { NEWSLETTER_ENABLED: 'false' });
});

test('canal incomplet : 503, jamais d’envoi', async () => {
  await scenario(async ({ env, brevo }) => {
    assert.equal((await subscribe(env)).status, 503);
    assert.equal(brevo.length, 0);
  }, { NEWSLETTER_NOTICE_VERSION: '' });
});

test('parcours complet : inscription, confirmation, rubriques, désinscription', async () => {
  await scenario(async ({ env, brevo, database, logs }) => {
    const accepted = await subscribe(env);
    assert.equal(accepted.status, 202);
    assert.equal(brevo.length, 1);
    assert.equal(brevo.some(item => item.path === '/v3/contacts'), false, 'aucune inscription avant confirmation');
    const token = confirmationToken(brevo);
    const confirmed = await call(env, 'confirm', { token });
    assert.equal(confirmed.status, 200);
    const management = (await confirmed.json()).management_token;
    assert.equal((await call(env, 'confirm', { token })).status, 410);
    assert.deepEqual(await (await call(env, 'preferences', { token: management })).json(), { success: true, preferences: ['veille'] });
    assert.equal((await call(env, 'preferences', { token: management, preferences: ['formations', 'publications'] })).status, 200);
    assert.equal((await call(env, 'preferences', { token: management, preferences: ['autre'] })).status, 400);
    assert.deepEqual(await (await call(env, 'preferences', { token: management })).json(), { success: true, preferences: ['formations', 'publications'] });
    assert.equal((await call(env, 'unsubscribe', { token: management })).status, 200);
    assert.deepEqual(brevo.at(-1), { path: `/v3/contacts/${encodeURIComponent(EMAIL)}`, method: 'PUT', body: { unlinkListIds: [7] } });
    assert.equal((await call(env, 'unsubscribe', { token: management })).status, 410);
    const row = (await database.prepare('SELECT * FROM newsletter_consents').all()).results[0];
    assert.equal(row.state, 'REVOKED');
    assert.equal(row.notice_version, 'veille-v1');
    assert.equal(row.consent_source, 'lettre-de-veille');
    const journal = logs.join('\n');
    assert.equal(journal.includes(EMAIL), false);
    assert.equal(journal.includes(token), false);
  });
});

test('la version de l’information vient du serveur, jamais du navigateur', async () => {
  await scenario(async ({ env, database }) => {
    await subscribe(env, { notice_version: 'forgee', consent_source: 'forgee' });
    const row = (await database.prepare('SELECT * FROM newsletter_consents').all()).results[0];
    assert.equal(row.notice_version, 'veille-v1');
    assert.equal(row.consent_source, 'lettre-de-veille');
  });
});

test('anti-énumération : même réponse pour une adresse nouvelle, en attente ou inscrite', async () => {
  await scenario(async ({ env, brevo }) => {
    const first = await subscribe(env);
    const pending = await subscribe(env);
    await call(env, 'confirm', { token: confirmationToken(brevo) });
    const subscribed = await subscribe(env);
    const bodies = await Promise.all([first, pending, subscribed].map(response => response.text()));
    assert.deepEqual([first.status, pending.status, subscribed.status], [202, 202, 202]);
    assert.equal(new Set(bodies).size, 1);
    assert.equal(brevo.filter(item => item.path === '/v3/smtp/email').length, 1);
  });
});

test('lien inconnu et lien déjà utilisé sont indiscernables', async () => {
  await scenario(async ({ env, brevo }) => {
    await subscribe(env);
    const token = confirmationToken(brevo);
    await call(env, 'confirm', { token });
    const used = await call(env, 'confirm', { token });
    const unknown = await call(env, 'confirm', { token: 'a'.repeat(43) });
    assert.equal(used.status, unknown.status);
    assert.equal(await used.text(), await unknown.text());
  });
});

test('garde : origine, type, méthode, taille, JSON, pot de miel et limite de débit', async () => {
  await scenario(async ({ env, brevo, database }) => {
    assert.equal((await call(env, 'subscribe', {}, { origin: 'https://ailleurs.test' })).status, 403);
    assert.equal((await call(env, 'subscribe', {}, { origin: null })).status, 403);
    assert.equal((await call(env, 'subscribe', {}, { type: 'text/plain' })).status, 403);
    assert.equal((await call(env, 'subscribe', {}, { method: 'GET' })).status, 405);
    assert.equal((await call(env, 'confirm', {}, { method: 'GET' })).status, 405);
    assert.equal((await call(env, 'subscribe', 'x'.repeat(3000))).status, 413);
    assert.equal((await call(env, 'subscribe', '{pas du json')).status, 400);
    assert.equal((await call(env, 'subscribe', '[]')).status, 400);
    assert.equal((await subscribe(env, { consent: false })).status, 400);
    assert.equal((await subscribe(env, { consent: 'yes' })).status, 400);
    assert.equal((await subscribe(env, { website: 'https://robot.test' })).status, 202);
    const limited = { ...env, LEAD_GUARD: { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ ok: false }) }) } };
    assert.equal((await subscribe(limited)).status, 429);
    assert.equal(brevo.length, 0);
    assert.equal((await database.prepare('SELECT * FROM newsletter_consents').all()).results.length, 0);
  });
});

test('la limite de débit n’entrave pas le retrait', async () => {
  await scenario(async ({ env, brevo }) => {
    await subscribe(env);
    const { management_token: token } = await (await call(env, 'confirm', { token: confirmationToken(brevo) })).json();
    const limited = { ...env, LEAD_GUARD: { idFromName: name => name, get: () => ({ fetch: async () => Response.json({ ok: false }) }) } };
    assert.equal((await call(limited, 'unsubscribe', { token })).status, 200);
  });
});

test('Turnstile ouvert : un jeton refusé bloque l’envoi', async () => {
  await scenario(async ({ env, brevo }) => {
    const previous = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).includes('challenges.cloudflare.com') ? Response.json({ success: false }) : previous(url, init));
    try { assert.equal((await subscribe(env, { captcha_token: 'jeton' })).status, 403); } finally { globalThis.fetch = previous; }
    assert.equal(brevo.length, 0);
  }, { TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'cle' });
});

test('pannes Brevo : 503 honnête, puis reprise ; retrait acquis et repris par la tâche quotidienne', async () => {
  await scenario(async ({ env, brevo, database, fail }) => {
    fail(true);
    assert.equal((await subscribe(env)).status, 503);
    fail(false);
    assert.equal((await subscribe(env)).status, 202);
    const token = confirmationToken(brevo);
    fail(true);
    assert.equal((await call(env, 'confirm', { token })).status, 503);
    fail(false);
    const { management_token: management } = await (await call(env, 'confirm', { token })).json();
    fail(true);
    const pending = await call(env, 'unsubscribe', { token: management });
    assert.equal(pending.status, 202);
    assert.deepEqual(await pending.json(), { success: true, pending: true });
    const state = async () => (await database.prepare('SELECT state FROM newsletter_consents').all()).results[0].state;
    assert.equal(await state(), 'REVOKING');
    fail(false);
    await worker.scheduled({}, env);
    assert.equal(await state(), 'REVOKED');
  });
});

test('07 : retrait bloqué depuis plus de 24 h : journal, code d’erreur et tâche en échec', async () => {
  await scenario(async ({ env, brevo, database, fail, logs }) => {
    await subscribe(env);
    const { management_token: token } = await (await call(env, 'confirm', { token: confirmationToken(brevo) })).json();
    fail(true);
    await call(env, 'unsubscribe', { token });
    await worker.scheduled({}, env);
    const summary = logs.map(line => JSON.parse(line)).find(line => line.event === 'newsletter_maintenance');
    assert.equal(summary.status, 'ok');
    assert.equal(summary.reason, 'http_503');
    logs.length = 0;
    await database.prepare(`UPDATE newsletter_consents SET revoked_at=?`).bind(new Date(Date.now() - 25 * 3600000).toISOString()).run();
    await assert.rejects(() => worker.scheduled({}, env), /Alerte de synchronisation/);
    const events = logs.map(line => JSON.parse(line));
    const alert = events.find(line => line.event === 'sync_alert');
    assert.equal(alert.operation, 'newsletter_revocation');
    assert.equal(alert.count, 1);
    assert.ok(alert.age_hours >= 25);
    assert.ok(alert.attempts >= 3);
    assert.equal(alert.reason, 'http_503');
    assert.equal(logs.join('').includes(EMAIL), false);
    fail(false);
    await worker.scheduled({}, env);
  });
});

test('07 : transport retiré alors qu’un retrait attend : la tâche ne reste pas muette', async () => {
  await scenario(async ({ env, brevo, database, fail, logs }) => {
    await subscribe(env);
    const { management_token: token } = await (await call(env, 'confirm', { token: confirmationToken(brevo) })).json();
    fail(true);
    await call(env, 'unsubscribe', { token });
    fail(false);
    await database.prepare(`UPDATE newsletter_consents SET revoked_at=?`).bind(new Date(Date.now() - 25 * 3600000).toISOString()).run();
    const broken = { ...env, NEWSLETTER_ENABLED: 'false', BREVO_API_KEY: '' };
    await assert.rejects(() => worker.scheduled({}, broken), /Alerte de synchronisation/);
    assert.ok(logs.some(line => line.includes('sync_alert')));
  });
});

test('diffusions incomplètes : signalées chaque jour, alerte au-delà de 24 h', async () => {
  const logs = [];
  const previous = console.log;
  console.log = line => logs.push(JSON.parse(line));
  const database = count => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ count, oldest: new Date(Date.now() - 30 * 3600000).toISOString() }] }) }) }) });
  try {
    await worker.scheduled({}, { LEADS_DB: database(0) });
    assert.equal(logs.length, 0);
    await assert.rejects(() => worker.scheduled({}, { LEADS_DB: database(2) }), /Alerte de synchronisation/);
    assert.deepEqual(logs.map(line => line.event), ['lead_delivery_backlog', 'sync_alert']);
    assert.equal(logs[1].operation, 'lead_delivery');
    assert.equal(logs[1].count, 2);
  } finally { console.log = previous; }
});

test('canal refermé : le retrait reste ouvert à qui est déjà inscrit', async () => {
  await scenario(async ({ env, brevo }) => {
    await subscribe(env);
    const { management_token: token } = await (await call(env, 'confirm', { token: confirmationToken(brevo) })).json();
    const closed = { ...env, NEWSLETTER_ENABLED: 'false' };
    assert.equal((await subscribe(closed)).status, 503);
    assert.equal((await call(closed, 'unsubscribe', { token })).status, 200);
  });
});
