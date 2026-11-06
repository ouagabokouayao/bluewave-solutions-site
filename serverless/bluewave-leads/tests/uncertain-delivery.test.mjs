// Issue inconnue chez Brevo : ce que le fournisseur a accepté ne doit pas repartir.
import assert from 'node:assert/strict';
import test from 'node:test';

import { attemptKey, BrevoClient, DELIVERY_STEPS, deliveryTag, failureStatus } from '../brevo-client.mjs';
import { createLeadHandler } from '../handler.mjs';
import { STEP_STATUSES, summarizeDelivery } from '../lead-store.mjs';
import { createBrevoNewsletterTransport } from '../newsletter-brevo.mjs';
import { replayDelivery, stepsToReconcile } from '../replay.mjs';
import { createMemoryGuard } from '../security.mjs';
import { createD1Double } from './d1-double.mjs';

const ORIGIN = 'https://bluewave.invalid';
const environment = Object.freeze({
  LEADS_ENABLED: 'true', LEADS_CONTACT_SYNC_ENABLED: 'true', LEADS_ACK_ENABLED: 'true', LEADS_NOTIFY_ENABLED: 'true', LEADS_REPLAY_ENABLED: 'true',
  LEAD_RETENTION_DAYS: '365', BREVO_API_KEY: 'cle-synthetique', BREVO_LEADS_LIST_ID: '11', BREVO_ACK_TEMPLATE_ID: '12', BREVO_INTERNAL_TEMPLATE_ID: '13',
  BLUEWAVE_INTERNAL_EMAIL: 'interne@example.invalid', ALLOWED_ORIGIN: ORIGIN
});
const payload = Object.freeze({
  journey: 'projet', lead_type: 'projet-mission', source_offer: 'note-strategique', recommended_offer: 'diagnostic-strategique',
  organisation_type: 'collectivite', territory: 'cote-divoire', need_category: 'vulnerabilite', stage: 'cadrage', data_availability: 'etudes',
  desired_outcome: 'options', firstname: 'Awa', lastname: 'Koné', email: 'awa@example.invalid', organisation: 'Organisation test',
  contact_preference: 'email', deadline: '3-6m', need: 'Structurer un besoin littoral.', newsletter_optin_request: false, privacy_acknowledged: true, website: ''
});
const quiet = { log: () => null };
const post = () => new Request(`${ORIGIN}/api/leads`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.40' }, body: JSON.stringify(payload) });
const submit = (database, fetchImpl) => createLeadHandler({ environment, fetchImpl, leadStore: database, guard: createMemoryGuard({ rateLimit: 50 }), logger: quiet })(post());
const isAck = init => init?.body && JSON.parse(init.body).templateId === 12;

// Fournisseur simulé : `onAck` décide du sort de l'accusé, `events` répond au rapprochement.
function provider({ onAck = () => new Response('{}', { status: 201 }), events = [] } = {}) {
  const calls = { ack: [], email: [], contact: [], lookup: [] };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/smtp/statistics/events')) { calls.lookup.push(new URL(url).searchParams); return typeof events === 'function' ? events() : Response.json({ events }); }
    if (path.endsWith('/contacts')) { calls.contact.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); }
    calls.email.push(JSON.parse(init.body));
    if (!isAck(init)) return new Response('{}', { status: 201 });
    calls.ack.push(JSON.parse(init.body));
    return onAck();
  };
  return { calls, fetchImpl };
}
const lost = () => { throw new TypeError('connexion coupée'); };
const uncertainLead = async () => {
  const database = createD1Double();
  await submit(database, provider({ onAck: lost }).fetchImpl);
  return { database, id: database.first().id };
};

test('les états sont distincts : refus certain, issue inconnue, envoi commencé', () => {
  assert.deepEqual(STEP_STATUSES, ['PENDING', 'SENDING', 'OK', 'FAILED', 'UNCERTAIN', 'SKIPPED']);
  assert.equal(summarizeDelivery(['OK', 'UNCERTAIN', 'OK']), 'UNCERTAIN');
  assert.equal(summarizeDelivery(['OK', 'SENDING']), 'UNCERTAIN');
  assert.equal(summarizeDelivery(['OK', 'FAILED']), 'PARTIAL_FAILURE');
  assert.equal(summarizeDelivery(['FAILED']), 'FAILED');
  assert.equal(summarizeDelivery(['OK']), 'DELIVERED');
  assert.equal(summarizeDelivery([]), 'STORED');
});

test('sans réponse ou sur 5xx : UNCERTAIN ; sur 4xx : FAILED ; le contact reste rejouable', async () => {
  for (const [onAck, expected] of [[lost, 'UNCERTAIN'], [() => new Response('', { status: 500 }), 'UNCERTAIN'], [() => new Response('', { status: 504 }), 'UNCERTAIN'], [() => new Response('', { status: 400 }), 'FAILED'], [() => new Response('', { status: 429 }), 'FAILED']]) {
    const database = createD1Double();
    assert.equal((await submit(database, provider({ onAck }).fetchImpl)).status, 201);
    assert.equal(database.first().ack_status, expected);
  }
  const contact = DELIVERY_STEPS.find(step => step.code === 'brevo_contact');
  assert.equal(failureStatus(contact, { uncertain: true }), 'FAILED');
});

test('W14 : accusé accepté, réponse perdue : la reprise ne renvoie rien sans preuve', async () => {
  const { database, id } = await uncertainLead();
  assert.deepEqual(stepsToReconcile(database.first()), ['ack']);
  const brevo = provider();
  const result = await replayDelivery(database, id, { environment, fetchImpl: brevo.fetchImpl, dryRun: false, logger: quiet });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'reconciliation_required');
  assert.deepEqual(result.unresolved, ['ack']);
  assert.equal(brevo.calls.ack.length, 0, 'second accusé');
  assert.equal(database.first().ack_status, 'UNCERTAIN');
  assert.equal(database.first().delivery_status, 'UNCERTAIN');
});

test('annonce de reprise : les étapes à rapprocher sont dites, sans appel', async () => {
  const { database, id } = await uncertainLead();
  const brevo = provider();
  const result = await replayDelivery(database, id, { environment, fetchImpl: brevo.fetchImpl, logger: quiet });
  assert.deepEqual(result.to_reconcile, ['ack']);
  assert.equal(brevo.calls.lookup.length, 0);
});

test('preuve chez Brevo : l’étape est close sans aucun envoi', async () => {
  const { database, id } = await uncertainLead();
  const brevo = provider({ events: [{ event: 'requests', tag: deliveryTag(id, 'ack') }] });
  const result = await replayDelivery(database, id, { environment, fetchImpl: brevo.fetchImpl, dryRun: false, logger: quiet });
  assert.deepEqual(result.reconciled, ['ack']);
  assert.equal(result.delivery_status, 'DELIVERED');
  assert.equal(brevo.calls.ack.length, 0);
  assert.equal(brevo.calls.lookup[0].get('email'), payload.email);
  assert.equal(brevo.calls.lookup[0].get('tags'), JSON.stringify([deliveryTag(id, 'ack')]));
  assert.equal(database.first().ack_status, 'OK');
});

test('rapprochement non fiable : autre repère, événement d’échec ou panne ne valent pas preuve', async () => {
  const cases = [() => [{ event: 'requests', tag: 'bw-ack-autre-demande' }], () => [{ event: 'requests' }], id => [{ event: 'blocked', tag: deliveryTag(id, 'ack') }],
    () => () => new Response('', { status: 500 }), () => () => { throw new TypeError('coupure'); }];
  for (const events of cases) {
    const { database, id } = await uncertainLead();
    const brevo = provider({ events: events(id) });
    const result = await replayDelivery(database, id, { environment, fetchImpl: brevo.fetchImpl, dryRun: false, logger: quiet });
    assert.equal(result.reason, 'reconciliation_required');
    assert.equal(brevo.calls.ack.length, 0);
    assert.equal(database.first().ack_status, 'UNCERTAIN');
  }
});

test('décision humaine : un seul renvoi, avec la même clé et le même repère', async () => {
  const first = provider({ onAck: lost });
  const database = createD1Double();
  await submit(database, first.fetchImpl);
  const id = database.first().id;
  const second = provider();
  const result = await replayDelivery(database, id, { environment, fetchImpl: second.fetchImpl, dryRun: false, logger: quiet, confirmedNotSent: ['ack'] });
  assert.equal(result.delivery_status, 'DELIVERED');
  assert.equal(second.calls.ack.length, 1);
  assert.deepEqual(second.calls.ack[0].headers, first.calls.ack[0].headers);
  assert.deepEqual(second.calls.ack[0].tags, [deliveryTag(id, 'ack')]);
  await replayDelivery(database, id, { environment, fetchImpl: second.fetchImpl, dryRun: false, logger: quiet, confirmedNotSent: ['ack'] });
  assert.equal(second.calls.ack.length, 1);
});

test('renvoi refusé par la clé d’idempotence : c’est la preuve du premier envoi', async () => {
  const { database, id } = await uncertainLead();
  const brevo = provider({ onAck: () => Response.json({ code: 'duplicate_parameter', message: 'doublon' }, { status: 400 }) });
  const result = await replayDelivery(database, id, { environment, fetchImpl: brevo.fetchImpl, dryRun: false, logger: quiet, confirmedNotSent: ['ack'] });
  assert.equal(result.delivery_status, 'DELIVERED');
  assert.equal(database.first().ack_status, 'OK');
});

test('intention écrite avant l’envoi : sans cette écriture, rien ne part', async () => {
  const database = createD1Double({ failOn: 'UPDATE lead_records SET' });
  const brevo = provider();
  assert.equal((await submit(database, brevo.fetchImpl)).status, 201);
  assert.equal(brevo.calls.email.length + brevo.calls.contact.length, 0);
  assert.equal(database.first().ack_status, 'PENDING');
});

test('statut final perdu : la ligne reste en SENDING et la reprise n’envoie rien sans preuve', async () => {
  const database = createD1Double();
  let writes = 0;
  const failing = { prepare(sql) {
    const statement = database.prepare(sql);
    return { bind(...values) {
      const bound = statement.bind(...values);
      return { ...bound, async run() {
        if (sql.startsWith('UPDATE lead_records SET') && !sql.includes('idempotency_key') && ++writes === 2) throw new Error('base indisponible');
        return bound.run();
      } };
    } };
  } };
  const brevo = provider();
  assert.equal((await submit(failing, brevo.fetchImpl)).status, 201);
  assert.equal(brevo.calls.ack.length, 1);
  const row = database.first();
  assert.equal(row.ack_status, 'SENDING');
  assert.deepEqual(stepsToReconcile(row), ['ack', 'internal_notification']);
  const replay = provider();
  const result = await replayDelivery(database, row.id, { environment, fetchImpl: replay.fetchImpl, dryRun: false, logger: quiet });
  assert.equal(result.reason, 'reconciliation_required');
  assert.equal(replay.calls.email.length, 0);
  assert.equal(replay.calls.contact.length, 1, 'le contact est rejouable sans risque');
});

test('la clé de tentative est un UUID stable, propre à la demande et à l’étape', async () => {
  const key = await attemptKey('demande-1', 'ack');
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(key, await attemptKey('demande-1', 'ack'));
  assert.notEqual(key, await attemptKey('demande-1', 'internal_notification'));
  assert.notEqual(key, await attemptKey('demande-2', 'ack'));
});

test('un envoi sans repère reste possible, et le client ne suit que ce qu’on lui confie', async () => {
  const bodies = [];
  const client = new BrevoClient({ environment, fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); } });
  await client.sendAcknowledgement({ ...payload, themes: [] });
  assert.equal('tags' in bodies[0], false);
  assert.equal('headers' in bodies[0], false);
});

test('confirmation de la lettre : même clé à la reprise, le refus de doublon vaut acceptation', async () => {
  const calls = [];
  let status = 201;
  const transport = createBrevoNewsletterTransport({
    environment: { BREVO_API_KEY: 'cle', BREVO_NEWSLETTER_LIST_ID: '7', BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID: '8', BLUEWAVE_SITE_URL: ORIGIN },
    fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return status === 400 ? Response.json({ code: 'duplicate_parameter' }, { status }) : new Response('{}', { status }); }
  });
  await transport.sendConfirmation('a@example.invalid', 'jeton', { idempotency_key: 'confirmation:1' });
  status = 400;
  await transport.sendConfirmation('a@example.invalid', 'jeton', { idempotency_key: 'confirmation:1' });
  assert.equal(calls[0].headers.idempotencyKey, calls[1].headers.idempotencyKey);
  status = 500;
  await assert.rejects(() => transport.sendConfirmation('a@example.invalid', 'jeton', { idempotency_key: 'confirmation:1' }), /indisponible/);
});
