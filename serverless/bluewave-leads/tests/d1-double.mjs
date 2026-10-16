// Double minimal de D1 pour les tests : il ne comprend que les requêtes
// réellement émises par lead-store.mjs. Volontairement bête, donc fiable.
import { COLUMNS } from '../lead-store.mjs';

export function createD1Double({ failOn = null } = {}) {
  const rows = new Map();          // id -> ligne
  const byKey = new Map();         // idempotency_key -> id
  const statements = [];

  const run = (sql, values) => {
    statements.push(sql);
    if (failOn && sql.startsWith(failOn)) throw new Error('base indisponible');

    if (sql.startsWith('INSERT INTO lead_records')) {
      const row = Object.fromEntries(COLUMNS.map((column, index) => [column, values[index]]));
      if (byKey.has(row.idempotency_key)) return { meta: { changes: 0 } };
      byKey.set(row.idempotency_key, row.id);
      rows.set(row.id, row);
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE lead_records SET')) {
      const assignments = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE')).split(',');
      const id = values[values.length - 1];
      const row = rows.get(id);
      if (!row) return { meta: { changes: 0 } };
      assignments.forEach((assignment, index) => { row[assignment.split('=')[0].trim()] = values[index]; });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('DELETE FROM lead_records WHERE created_at <')) {
      const cutoff = values[0];
      let changes = 0;
      for (const [id, row] of [...rows]) {
        if (row.created_at < cutoff) { rows.delete(id); byKey.delete(row.idempotency_key); changes += 1; }
      }
      return { meta: { changes } };
    }

    throw new Error(`Requête non prévue par le double : ${sql}`);
  };

  const all = (sql, values) => {
    statements.push(sql);
    if (sql.startsWith('SELECT * FROM lead_records WHERE id =')) {
      const row = rows.get(values[0]);
      return { results: row ? [{ ...row }] : [] };
    }

    if (sql.startsWith('SELECT * FROM lead_records WHERE email =')) {
      return { results: [...rows.values()].filter(row => row.email === values[0]).map(row => ({ ...row })) };
    }

    if (sql.startsWith('SELECT id FROM lead_records WHERE created_at <')) {
      const cutoff = values[0];
      return { results: [...rows.values()].filter(row => row.created_at < cutoff).map(row => ({ id: row.id })) };
    }
    throw new Error(`Requête non prévue par le double : ${sql}`);
  };

  return {
    prepare(sql) {
      return {
        bind(...values) {
          return { async run() { return run(sql, values); }, async all() { return all(sql, values); } };
        }
      };
    },
    // Accès de test seulement.
    rows,
    statements,
    get size() { return rows.size; },
    first() { return [...rows.values()][0]; }
  };
}
