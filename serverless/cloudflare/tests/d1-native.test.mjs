// Sémantique D1 réelle, exécutée sur le moteur du runtime et non sur le double.
//
// Le double de test reproduit les requêtes que le code émet ; il ne prouve pas
// que SQLite se comporte comme attendu sur ON CONFLICT, les index ou la purge.
// Ce test l'établit sur un vrai D1 local fourni par Miniflare. Sans Miniflare
// installé, il est sauté explicitement plutôt que de donner un faux PASS.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { buildLeadRecord, markDelivery, purgeExpiredLeads, storeLead, getLeadRecord } from '../../bluewave-leads/lead-store.mjs';

let Miniflare = null;
try { ({ Miniflare } = await import('miniflare')); } catch { Miniflare = null; }

const lead = Object.freeze({
  journey: 'projet', lead_type: 'projet-mission', territory: 'cote-divoire',
  firstname: 'Awa', lastname: 'Koné', email: 'awa.kone@example.invalid',
  organisation: 'Organisation test', need: 'Structurer un besoin littoral.'
});

const schemaUrl = name => new URL(`../${name}`, import.meta.url);

async function withDatabases(run) {
  // Un changement d'API de l'outil doit se voir comme tel, pas se confondre
  // avec un défaut du code testé.
  if (typeof Miniflare !== 'function') throw new Error('API Miniflare inattendue : Miniflare n\'est pas un constructeur');
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Databases: { LEADS_DB: 'leads-test', CONVERSION_DB: 'conversions-test' },
    d1Persist: false
  });
  try {
    if (typeof mf.getD1Database !== 'function') throw new Error('API Miniflare inattendue : getD1Database absent');
    const leads = await mf.getD1Database('LEADS_DB');
    const conversions = await mf.getD1Database('CONVERSION_DB');
    for (const [database, file] of [[leads, 'leads-schema.sql'], [conversions, 'schema.sql']]) {
      const sql = await readFile(schemaUrl(file), 'utf8');
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
        await database.prepare(statement).run();
      }
    }
    await run({ leads, conversions });
  } finally {
    await mf.dispose();
  }
}

test('D1 natif : schéma, idempotence, statuts, purge et séparation des bases',
  { skip: Miniflare ? false : 'Miniflare absent : exécuté en CI, où les dépendances sont installées.' },
  async () => {
    await withDatabases(async ({ leads, conversions }) => {
      const now = new Date('2026-10-04T08:00:00Z');

      // Insertion puis renvoi identique : ON CONFLICT DO NOTHING tient.
      const record = await buildLeadRecord(lead, { now, correlationId: 'test' });
      assert.deepEqual(await storeLead(leads, record), { stored: true, id: record.id });
      const again = await buildLeadRecord(lead, { now, correlationId: 'test' });
      const duplicate = await storeLead(leads, again);
      assert.equal(duplicate.stored, false);
      assert.equal(duplicate.duplicate, true);

      const count = await leads.prepare('SELECT COUNT(*) AS total FROM lead_records').all();
      assert.equal(count.results[0].total, 1);

      // Une demande métier différente le même jour reste une seconde ligne.
      const other = await buildLeadRecord({ ...lead, territory: 'france-mediterranee' }, { now });
      assert.equal((await storeLead(leads, other)).stored, true);
      assert.equal((await leads.prepare('SELECT COUNT(*) AS total FROM lead_records').all()).results[0].total, 2);

      // Mise à jour de statut.
      await markDelivery(leads, record.id, {
        brevo_contact_status: 'OK', ack_status: 'FAILED', notification_status: 'PENDING',
        delivery_status: 'PARTIAL_FAILURE', last_error_code: 'ack'
      });
      const stored = await getLeadRecord(leads, record.id);
      assert.equal(stored.brevo_contact_status, 'OK');
      assert.equal(stored.ack_status, 'FAILED');
      assert.equal(stored.delivery_status, 'PARTIAL_FAILURE');

      // Aucune donnée exclue n'a pu entrer : la colonne n'existe pas.
      await assert.rejects(() => leads.prepare('SELECT captcha_token FROM lead_records').all());
      await assert.rejects(() => leads.prepare('SELECT ip FROM lead_records').all());

      // Purge : rien sans durée, ciblée avec une durée.
      assert.deepEqual(await purgeExpiredLeads(leads, '', new Date('2026-12-01T00:00:00Z')), { purged: 0, skipped: true });
      const purge = await purgeExpiredLeads(leads, 30, new Date('2026-12-01T00:00:00Z'));
      assert.equal(purge.skipped, false);
      assert.equal(purge.purged, 2);
      assert.equal((await leads.prepare('SELECT COUNT(*) AS total FROM lead_records').all()).results[0].total, 0);

      // Les deux bases sont réellement distinctes : la table de l'une n'existe
      // pas dans l'autre, dans les deux sens.
      await assert.rejects(() => conversions.prepare('SELECT 1 FROM lead_records').all());
      await assert.rejects(() => leads.prepare('SELECT 1 FROM conversion_counts').all());

      // L'agrégat de conversion fonctionne sur sa propre base.
      await conversions.prepare(
        'INSERT INTO conversion_counts (day,event_name,page,journey,offer,status,source,campaign,count) VALUES (?,?,?,?,?,?,?,?,1) ' +
        'ON CONFLICT(day,event_name,page,journey,offer,status,source,campaign) DO UPDATE SET count=count+1'
      ).bind('2026-10-04', 'lead_submit_success', 'qualifier-un-besoin', 'projet', '', '', '', '').run();
      const aggregate = await conversions.prepare('SELECT count FROM conversion_counts').all();
      assert.equal(aggregate.results[0].count, 1);
    });
  });
