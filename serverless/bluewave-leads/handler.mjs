import { BrevoClient, DELIVERY_STEPS, enabledSteps, validateEnvironment } from './brevo-client.mjs';
import { buildLeadRecord, canDeliverLeads, markDelivery, storeLead } from './lead-store.mjs';
import { createLogger, newCorrelationId } from './observability.mjs';
import { createMemoryGuard, requestClientKey } from './security.mjs';
import { validateLeadPayload } from './validation.mjs';

// Sans interrupteur ouvert, aucun code campagne n'est retenu, même listé.
export function allowedCampaigns(environment) {
  return environment.CAMPAIGNS_ENABLED === 'true' ? (environment.ALLOWED_CAMPAIGNS || '') : '';
}

const MAX_PAYLOAD_BYTES = 16 * 1024;
const SUCCESS_MESSAGE = 'Votre demande a bien été transmise à BlueWave Solutions.';
const ERROR_MESSAGE = 'La transmission n’a pas pu aboutir. Vous pouvez réessayer ou contacter directement BlueWave Solutions.';
const defaultGuard = createMemoryGuard();

function responseJson(status, payload, origin = null) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    vary: 'Origin'
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(payload), { status, headers });
}

function corsPreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '600',
      vary: 'Origin'
    }
  });
}

export function createLeadHandler({
  environment = globalThis.process?.env ?? {},
  fetchImpl = globalThis.fetch,
  guard = defaultGuard,
  captchaVerifier = null,
  leadStore = null,
  logger = createLogger(),
  now = () => new Date()
} = {}) {
  return async function handleLead(request) {
    if (!canDeliverLeads(environment, leadStore) ||
        (environment.TURNSTILE_ENABLED === 'true' && typeof captchaVerifier !== 'function')) {
      return responseJson(503, { success: false, message: ERROR_MESSAGE });
    }
    let allowedOrigin;
    try {
      validateEnvironment(environment, enabledSteps(environment));
      allowedOrigin = environment.ALLOWED_ORIGIN;
    } catch {
      return responseJson(500, { success: false, message: ERROR_MESSAGE });
    }

    const origin = request.headers.get('origin');
    if (origin !== allowedOrigin) return responseJson(403, { success: false, message: ERROR_MESSAGE });
    if (request.method === 'OPTIONS') return corsPreflight(origin);
    if (request.method !== 'POST') return responseJson(405, { success: false, message: ERROR_MESSAGE }, origin);

    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return responseJson(415, { success: false, message: ERROR_MESSAGE }, origin);
    const clientKey = requestClientKey(request);
    if (!(await guard.allowRate(clientKey))) return responseJson(429, { success: false, message: ERROR_MESSAGE }, origin);
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_PAYLOAD_BYTES) return responseJson(413, { success: false, message: ERROR_MESSAGE }, origin);

    let raw;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error('empty body');
      const chunks = []; let length = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_PAYLOAD_BYTES) { await reader.cancel(); return responseJson(413, { success: false, message: ERROR_MESSAGE }, origin); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      raw = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
    } catch {
      return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) {
      return responseJson(413, { success: false, message: ERROR_MESSAGE }, origin);
    }

    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    }
    const validated = validateLeadPayload(input, {campaigns: allowedCampaigns(environment)});
    if (!validated.ok) {
      // Seul le nom du champ fautif est journalisé, jamais sa valeur.
      logger.log('lead_rejected', { reason: 'validation' });
      return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    }
    const lead = validated.value;

    // A forged client cannot opt in to a channel disabled in this environment.
    if (lead.newsletter_consent && environment.NEWSLETTER_ENABLED !== 'true') {
      return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    }

    if (lead.website) return responseJson(200, { success: true, message: SUCCESS_MESSAGE }, origin);
    if (captchaVerifier && !(await captchaVerifier(lead.captcha_token, request))) {
      logger.log('turnstile_failed', { journey: lead.journey });
      return responseJson(403, { success: false, message: ERROR_MESSAGE }, origin);
    }

    const correlationId = newCorrelationId();

    // La demande validée est enregistrée AVANT toute dépendance externe.
    let record;
    try {
      record = await buildLeadRecord(lead, { now: now(), correlationId });
      const stored = await storeLead(leadStore, record);
      if (!stored.stored) {
        // Reprise d'une demande déjà enregistrée, souvent après une réponse
        // perdue : on confirme sa réception sans rien réexpédier.
        logger.log('lead_duplicate', { correlation_id: correlationId, journey: lead.journey, lead_type: lead.lead_type });
        return responseJson(200, { success: true, message: SUCCESS_MESSAGE }, origin);
      }
      logger.log('lead_stored', { correlation_id: correlationId, journey: lead.journey, lead_type: lead.lead_type });
    } catch {
      // Le stockage est la garantie de non-perte : s'il échoue, mieux vaut
      // inviter à réessayer que d'expédier un accusé sans trace. C'est une
      // panne de notre côté, pas un rejet de la demande.
      logger.log('lead_storage_failed', { correlation_id: correlationId });
      return responseJson(503, { success: false, message: ERROR_MESSAGE }, origin);
    }

    const active = enabledSteps(environment);
    const steps = Object.fromEntries(DELIVERY_STEPS.map(step => [step.field, active.includes(step) ? 'PENDING' : 'SKIPPED']));
    let firstFailure = '';
    if (active.length) {
      try {
        const brevo = new BrevoClient({ environment, fetchImpl, steps: active });
        for (const step of active) {
          try {
            await brevo[step.method](lead);
            steps[step.field] = 'OK';
          } catch {
            steps[step.field] = 'FAILED';
            firstFailure = firstFailure || step.code;
            logger.log(step.event, { correlation_id: correlationId, journey: lead.journey });
          }
        }
      } catch {
        // Client Brevo inconstructible : les étapes ouvertes restent à reprendre.
        for (const step of active) steps[step.field] = 'FAILED';
        firstFailure = 'brevo_client';
        logger.log('brevo_contact_failed', { correlation_id: correlationId, reason: 'client_unavailable' });
      }
    }

    const attempted = active.map(step => steps[step.field]);
    const deliveryStatus = !attempted.length ? 'STORED'
      : attempted.every(status => status === 'OK') ? 'DELIVERED'
        : attempted.some(status => status === 'OK') ? 'PARTIAL_FAILURE' : 'FAILED';
    // Le statut est consigné pour que la reprise sache exactement quoi rejouer.
    try {
      await markDelivery(leadStore, record.id, { ...steps, delivery_status: deliveryStatus, last_error_code: firstFailure, now: now() });
    } catch {
      // La demande reste en base, mais ses statuts ne reflètent plus la
      // diffusion réelle : la ligne apparaîtra en STORED/PENDING alors que des
      // envois ont pu aboutir. L'exploitation doit le savoir pour ne pas
      // rejouer à l'aveugle.
      logger.log('delivery_status_write_failed', { correlation_id: correlationId, status: deliveryStatus });
    }

    // La demande est enregistrée : elle n'est pas perdue, donc la réponse est
    // un succès même si la diffusion reste à reprendre.
    return responseJson(201, { success: true, message: SUCCESS_MESSAGE }, origin);
  };
}

export const handleRequest = createLeadHandler();
export { ERROR_MESSAGE, MAX_PAYLOAD_BYTES, SUCCESS_MESSAGE };
