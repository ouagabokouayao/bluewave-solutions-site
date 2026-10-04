import assert from 'node:assert/strict';
import test from 'node:test';

import { LeadGuard, createDistributedGuard } from '../guard.mjs';

// État d'objet durable simulé : une transaction sérialisée et une alarme.
function fakeState() {
  const store = new Map();
  let alarm = null;
  const txn = {
    async get(key) { return store.get(key); },
    async put(key, value) { store.set(key, value); }
  };
  return {
    store,
    get alarm() { return alarm; },
    storage: {
      async transaction(run) { return run(txn); },
      async setAlarm(time) { alarm = time; },
      async deleteAll() { store.clear(); }
    }
  };
}

const call = (guard, body) => guard.fetch(new Request('https://guard.internal/', { method: 'POST', body: JSON.stringify(body) }));
const KEY = 'a'.repeat(64);

test('clé mal formée refusée : seule une empreinte hexadécimale est acceptée', async () => {
  const guard = new LeadGuard(fakeState());
  for (const key of ['', 'court', '192.0.2.10', 'Z'.repeat(64), 'a'.repeat(63)]) {
    assert.equal((await call(guard, { action: 'rate', key })).status, 400, String(key));
  }
});

test('action inconnue refusée', async () => {
  const guard = new LeadGuard(fakeState());
  assert.equal((await call(guard, { action: 'inconnue', key: KEY })).status, 400);
});

test('limite de débit : cinq passages, le sixième est refusé', async () => {
  const guard = new LeadGuard(fakeState());
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await (await call(guard, { action: 'rate', key: KEY })).json(), { ok: true }, `passage ${index + 1}`);
  }
  assert.deepEqual(await (await call(guard, { action: 'rate', key: KEY })).json(), { ok: false });
});

test('anti-doublon : une empreinte ne peut être réclamée qu’une fois dans sa fenêtre', async () => {
  const guard = new LeadGuard(fakeState());
  assert.deepEqual(await (await call(guard, { action: 'claim', key: KEY })).json(), { ok: true });
  assert.deepEqual(await (await call(guard, { action: 'claim', key: KEY })).json(), { ok: false });
  // Une autre empreinte reste libre.
  assert.deepEqual(await (await call(guard, { action: 'claim', key: 'b'.repeat(64) })).json(), { ok: true });
});

test('une alarme de purge est armée, et elle efface tout', async () => {
  const state = fakeState();
  const guard = new LeadGuard(state);
  await call(guard, { action: 'rate', key: KEY });
  assert.ok(state.alarm > Date.now(), 'alarme armée dans le futur');
  assert.ok(state.store.size > 0);
  await guard.alarm();
  assert.equal(state.store.size, 0);
});

test('aucune adresse brute n’est conservée : seule une empreinte est stockée', async () => {
  const state = fakeState();
  const guard = new LeadGuard(state);
  await call(guard, { action: 'rate', key: KEY });
  await call(guard, { action: 'claim', key: KEY });
  const serialised = JSON.stringify([...state.store.entries()]);
  assert.equal(serialised.includes('192.0.2'), false);
  assert.equal(serialised.includes('@'), false);
});

test('la garde distribuée exige une clé HMAC suffisante', () => {
  const request = new Request('https://example.invalid/api/leads', { method: 'POST' });
  assert.throws(() => createDistributedGuard({}, request), /Garde distribuée non configurée/);
  assert.throws(() => createDistributedGuard({ LEAD_GUARD: {} }, request), /Garde distribuée non configurée/);
  assert.throws(() => createDistributedGuard({ LEAD_GUARD: {}, GUARD_HMAC_KEY: 'court' }, request), /Garde distribuée non configurée/);
});

test('l’en-tête fourni par le navigateur est ignoré au profit de celui de la plateforme', async () => {
  const names = [];
  const environment = {
    LEAD_GUARD: {
      idFromName(name) { names.push(name); return name; },
      get() { return { fetch: async () => Response.json({ ok: true }) }; }
    },
    GUARD_HMAC_KEY: 'k'.repeat(40)
  };
  const request = new Request('https://example.invalid/api/leads', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '192.0.2.10', 'x-forwarded-for': '203.0.113.7' }
  });
  const guard = createDistributedGuard(environment, request);
  assert.equal(await guard.allowRate(), true);
  // Le nom de l'objet est une empreinte, pas une adresse — et l'en-tête
  // contrôlable par le navigateur n'y entre pas.
  assert.match(names[0], /^[0-9a-f]{64}$/);
  assert.equal(names[0].includes('192.0.2.10'), false);
  assert.equal(names[0].includes('203.0.113.7'), false);
});
