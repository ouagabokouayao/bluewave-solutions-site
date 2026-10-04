// Opérations internes sur les données d'une demande.
//
// Retrouver, exporter, anonymiser. Rien de public : aucune route ne mène ici,
// et ces fonctions sont destinées à une exécution d'exploitation explicite.
//
// L'anonymisation est préférée à la suppression lorsque la ligne doit rester
// comptable d'un traitement : l'identité disparaît, la qualification reste.
// Aucune donnée réelle n'est touchée par ce lot.

import { findLeadsByEmail, getLeadRecord } from './lead-store.mjs';
import { createLogger } from './observability.mjs';

const ANONYMISED = '[anonymisé]';

export async function findByEmail(database, email, { logger = createLogger() } = {}) {
  const rows = await findLeadsByEmail(database, email);
  logger.log('data_rights_operation', { operation: 'find', count: rows.length });
  return rows;
}

// Export destiné à une communication de données : la ligne telle que stockée,
// charge métier désérialisée, sans champ technique sans intérêt pour la
// personne concernée.
export async function exportRecord(database, id, { logger = createLogger() } = {}) {
  const record = await getLeadRecord(database, id);
  if (!record) return null;
  let payload = {};
  try { payload = JSON.parse(record.journey_payload || '{}'); } catch { payload = {}; }
  const { journey_payload, idempotency_key, correlation_id, ...rest } = record;
  logger.log('data_rights_operation', { operation: 'export' });
  return { ...rest, journey_payload: payload };
}

// Retire l'identité et la matière libre, conserve la qualification et les
// statuts techniques. L'empreinte d'idempotence est neutralisée pour qu'une
// demande ultérieure de la même personne ne vienne pas se heurter à une ligne
// qui ne porte plus son identité.
export async function anonymiseRecord(database, id, { logger = createLogger(), now = () => new Date() } = {}) {
  const record = await getLeadRecord(database, id);
  if (!record) return { ok: false, reason: 'not_found' };
  const stamp = new Date(now()).toISOString();
  await database.prepare(
    'UPDATE lead_records SET firstname=?, lastname=?, email=?, organisation=?, role=?, journey_payload=?, idempotency_key=?, updated_at=? WHERE id=?'
  ).bind(ANONYMISED, ANONYMISED, ANONYMISED, ANONYMISED, ANONYMISED, '{}', `anonymised:${id}`, stamp, id).run();
  logger.log('data_rights_operation', { operation: 'anonymise' });
  return { ok: true, id };
}

export { ANONYMISED };
