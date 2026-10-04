// Reprise contrôlée d'une diffusion incomplète.
//
// Une demande enregistrée dont le contact, l'accusé ou la notification a
// échoué doit pouvoir être rejouée — mais seulement sur les étapes encore
// nécessaires. Une étape déjà aboutie n'est jamais réexpédiée : c'est la
// garantie qu'aucun demandeur ne reçoit deux accusés.
//
// Ce module n'est appelé par aucune route. Il est destiné à une exécution
// d'exploitation explicite, documentée dans serverless/OPERATIONS.md.

import { BrevoClient } from './brevo-client.mjs';
import { getLeadRecord, markDelivery } from './lead-store.mjs';
import { createLogger } from './observability.mjs';

const STEPS = Object.freeze([
  { field: 'brevo_contact_status', code: 'brevo_contact', method: 'upsertContact', event: 'brevo_contact_failed' },
  { field: 'ack_status', code: 'ack', method: 'sendAcknowledgement', event: 'ack_failed' },
  { field: 'notification_status', code: 'internal_notification', method: 'sendInternalNotification', event: 'internal_notification_failed' }
]);

// Reconstitue la charge attendue par le client Brevo à partir de la ligne
// stockée. Aucune donnée n'est inventée : seuls les champs enregistrés et la
// charge métier sérialisée sont relus.
export function leadFromRecord(record) {
  let payload = {};
  try { payload = JSON.parse(record.journey_payload || '{}'); } catch { payload = {}; }
  const domains = payload.domains?.length ? payload.domains
    : payload.expertise_domains?.length ? payload.expertise_domains : [];
  return {
    ...payload,
    journey: record.journey,
    lead_type: record.lead_type,
    firstname: record.firstname,
    lastname: record.lastname,
    email: record.email,
    organisation: record.organisation,
    type: record.lead_type,
    geography: record.territory,
    themes: domains,
    need: payload.need || payload.collaboration_expectation || payload.motivation ||
      payload.learning_objectives || payload.context || '',
    deadline: record.deadline || 'nondef',
    contact_preference: record.contact_preference || 'email',
    source: 'SITE_FORMS',
    newsletter_consent: false
  };
}

export function stepsToReplay(record) {
  return STEPS.filter(step => record[step.field] !== 'OK').map(step => step.code);
}

// `dryRun` est le mode par défaut : la reprise dit ce qu'elle ferait sans rien
// envoyer. Un envoi réel demande un choix explicite.
export async function replayDelivery(database, id, {
  environment, fetchImpl = globalThis.fetch, logger = createLogger(), dryRun = true, now = () => new Date()
} = {}) {
  const record = await getLeadRecord(database, id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.delivery_status === 'DELIVERED') return { ok: true, reason: 'already_delivered', steps: [] };

  const pending = stepsToReplay(record);
  if (!pending.length) return { ok: true, reason: 'nothing_to_replay', steps: [] };
  if (dryRun) return { ok: true, reason: 'dry_run', steps: pending };

  logger.log('replay_started', { journey: record.journey, lead_type: record.lead_type, count: pending.length });
  const lead = leadFromRecord(record);
  const patch = {};
  let firstFailure = '';
  let client;
  try {
    client = new BrevoClient({ environment, fetchImpl });
  } catch {
    logger.log('replay_failed', { reason: 'client_unavailable' });
    return { ok: false, reason: 'client_unavailable', steps: pending };
  }

  for (const step of STEPS) {
    // Garde anti-double envoi : une étape déjà aboutie est sautée, pas rejouée.
    if (record[step.field] === 'OK') { patch[step.field] = 'OK'; continue; }
    try {
      await client[step.method](lead);
      patch[step.field] = 'OK';
    } catch {
      patch[step.field] = 'FAILED';
      firstFailure = firstFailure || step.code;
      logger.log(step.event, { journey: record.journey, step: step.code });
    }
  }

  const values = STEPS.map(step => patch[step.field]);
  const delivery = values.every(value => value === 'OK') ? 'DELIVERED'
    : values.some(value => value === 'OK') ? 'PARTIAL_FAILURE' : 'FAILED';
  try {
    await markDelivery(database, id, { ...patch, delivery_status: delivery, last_error_code: firstFailure, now: now() });
  } catch {
    logger.log('delivery_status_write_failed', { status: delivery });
    return { ok: false, reason: 'status_write_failed', delivery_status: delivery, steps: pending };
  }
  if (delivery !== 'DELIVERED') logger.log('replay_failed', { status: delivery });
  return { ok: delivery === 'DELIVERED', delivery_status: delivery, steps: pending };
}

export { STEPS };
