import { BrevoClient, validateEnvironment } from './brevo-client.mjs';
import { createMemoryGuard, requestClientKey, submissionFingerprint } from './security.mjs';
import { validateLeadPayload } from './validation.mjs';

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
  captchaVerifier = null
} = {}) {
  return async function handleLead(request) {
    let allowedOrigin;
    try {
      validateEnvironment(environment);
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
    const validated = validateLeadPayload(input);
    if (!validated.ok) return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    const lead = validated.value;

    // A forged client cannot opt in to a channel disabled in this environment.
    if (lead.newsletter_consent && environment.NEWSLETTER_ENABLED !== 'true') {
      return responseJson(400, { success: false, message: ERROR_MESSAGE }, origin);
    }

    if (lead.website) return responseJson(200, { success: true, message: SUCCESS_MESSAGE }, origin);
    if (captchaVerifier && !(await captchaVerifier(lead.captcha_token, request))) {
      return responseJson(403, { success: false, message: ERROR_MESSAGE }, origin);
    }
    if (!(await guard.claimSubmission(await submissionFingerprint(lead)))) {
      return responseJson(409, { success: false, message: ERROR_MESSAGE }, origin);
    }

    try {
      const brevo = new BrevoClient({ environment, fetchImpl });
      await brevo.upsertContact(lead);
      await brevo.sendAcknowledgement(lead);
      await brevo.sendInternalNotification(lead);
      return responseJson(201, { success: true, message: SUCCESS_MESSAGE }, origin);
    } catch {
      return responseJson(502, { success: false, message: ERROR_MESSAGE }, origin);
    }
  };
}

export const handleRequest = createLeadHandler();
export { ERROR_MESSAGE, MAX_PAYLOAD_BYTES, SUCCESS_MESSAGE };
