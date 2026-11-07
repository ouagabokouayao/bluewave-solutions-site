// Reprise contrôlée d'une diffusion incomplète.
//
// Une demande enregistrée dont le contact, l'accusé ou la notification a
// échoué doit pouvoir être rejouée, mais seulement sur les étapes encore
// nécessaires. Une étape déjà aboutie n'est jamais réexpédiée.
//
// Un courriel dont l'issue est inconnue (SENDING, UNCERTAIN) n'est pas rejoué à
// l'aveugle : Brevo a pu l'accepter. Il faut d'abord une preuve chez Brevo. Sans
// preuve, seule une décision humaine (`confirmedNotSent`) autorise un nouvel envoi.
//
// Ce module n'est appelé par aucune route. Il est destiné à une exécution
// d'exploitation explicite, documentée dans serverless/OPERATIONS.md.

import { BrevoClient, DELIVERY_STEPS, enabledSteps, failureStatus } from './brevo-client.mjs';
import { canReplayLeads, getLeadRecord, markDelivery, retentionCutoff, summarizeDelivery } from './lead-store.mjs';
import { createLogger } from './observability.mjs';

const STEPS = DELIVERY_STEPS;

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

const unsettled = (step, record) => !step.repeatable && ['SENDING', 'UNCERTAIN'].includes(record[step.field]);

export function stepsToReconcile(record) {
  return STEPS.filter(step => unsettled(step, record)).map(step => step.code);
}

// `dryRun` est le mode par défaut : la reprise dit ce qu'elle ferait sans rien
// envoyer. Un envoi réel demande un choix explicite.
export async function replayDelivery(database, id, {
  environment, fetchImpl = globalThis.fetch, logger = createLogger(), dryRun = true, now = () => new Date(), confirmedNotSent = []
} = {}) {
  if (typeof database?.prepare !== 'function') return { ok: false, reason: 'storage_unavailable' };
  const record = await getLeadRecord(database, id);
  if (!record) return { ok: false, reason: 'not_found' };
  if (record.delivery_status === 'DELIVERED') return { ok: true, reason: 'already_delivered', steps: [] };

  const pending = stepsToReplay(record);
  if (!pending.length) return { ok: true, reason: 'nothing_to_replay', steps: [] };
  const toReconcile = stepsToReconcile(record);
  if (dryRun) return { ok: true, reason: 'dry_run', steps: pending, ...(toReconcile.length ? { to_reconcile: toReconcile } : {}) };
  if (!canReplayLeads(environment, database)) return { ok: false, reason: 'delivery_closed', steps: pending };
  // Une demande hors durée de conservation doit être purgée, jamais réémise.
  if (record.created_at < retentionCutoff(environment.LEAD_RETENTION_DAYS, now())) return { ok: false, reason: 'retention_expired', steps: pending };
  // Une étape fermée n'est pas réémise : son interrupteur reste souverain.
  const open = enabledSteps(environment).filter(step => record[step.field] !== 'OK');
  if (!open.length) return { ok: false, reason: 'steps_closed', steps: pending };

  logger.log('replay_started', { journey: record.journey, lead_type: record.lead_type, count: open.length });
  const lead = leadFromRecord(record);
  const patch = Object.fromEntries(STEPS.map(step => [step.field, record[step.field]]));
  let firstFailure = '';
  let client;
  try {
    client = new BrevoClient({ environment, fetchImpl, steps: open });
  } catch {
    logger.log('replay_failed', { reason: 'client_unavailable' });
    return { ok: false, reason: 'client_unavailable', steps: pending };
  }

  // 1. Rapprochement : aucune étape incertaine ne repart sans preuve ni décision.
  const reconciled = [];
  const unresolved = [];
  const toSend = [];
  for (const step of open) {
    if (!unsettled(step, record) || confirmedNotSent.includes(step.code)) { toSend.push(step); continue; }
    let found = false;
    try { found = await client.hasDelivery(step, lead, record.id); }
    catch { logger.log('delivery_reconciliation_failed', { journey: record.journey, step: step.code }); }
    if (found) { patch[step.field] = 'OK'; reconciled.push(step.code); }
    else { patch[step.field] = 'UNCERTAIN'; unresolved.push(step.code); }
  }

  // 2. Intention écrite avant l'envoi, comme à la première tentative.
  if (toSend.length) {
    try {
      await markDelivery(database, id, { ...Object.fromEntries(toSend.map(step => [step.field, 'SENDING'])), now: now() });
    } catch {
      logger.log('delivery_status_write_failed', { status: 'intent' });
      return { ok: false, reason: 'status_write_failed', steps: pending };
    }
  }

  // 3. Envoi des seules étapes dont on sait qu'elles ne sont pas parties.
  for (const step of toSend) {
    try {
      await client[step.method](lead, { reference: record.id });
      patch[step.field] = 'OK';
    } catch (error) {
      patch[step.field] = failureStatus(step, error);
      firstFailure = firstFailure || step.code;
      logger.log(step.event, { journey: record.journey, step: step.code, status: patch[step.field] });
    }
  }

  const delivery = summarizeDelivery(STEPS.map(step => patch[step.field]).filter(value => value !== 'SKIPPED'));
  try {
    await markDelivery(database, id, { ...patch, delivery_status: delivery, last_error_code: firstFailure, now: now() });
  } catch {
    logger.log('delivery_status_write_failed', { status: delivery });
    return { ok: false, reason: 'status_write_failed', delivery_status: delivery, steps: pending };
  }
  if (delivery !== 'DELIVERED') logger.log('replay_failed', { status: delivery });
  return { ok: delivery === 'DELIVERED', delivery_status: delivery, steps: toSend.map(step => step.code),
    ...(reconciled.length ? { reconciled } : {}),
    ...(unresolved.length ? { reason: 'reconciliation_required', unresolved } : {}) };
}

export { STEPS };
