// Routes publiques de la lettre de veille.
//
// Fermé, seul le retrait reste possible, pour qui est déjà inscrit. Les jetons
// arrivent toujours dans le corps d'un POST : un GET serait déclenché par les
// scanners de messagerie, et une URL finirait dans les journaux.
import { createNewsletterChannel, newsletterBacklog, newsletterEnabled, purgeNewsletter } from '../bluewave-leads/newsletter.mjs';
import { createBrevoNewsletterTransport, newsletterTransportMissing } from '../bluewave-leads/newsletter-brevo.mjs';
import { createLogger } from '../bluewave-leads/observability.mjs';
import { createDistributedGuard } from './guard.mjs';
import { isReady } from './readiness.mjs';
import { readLimited } from './read-limited.mjs';
import { createTurnstileVerifier } from './turnstile.mjs';

const MAX_BODY_BYTES = 2048;
const CONSENT_SOURCE = 'lettre-de-veille';
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' };
const reply = (status, body) => Response.json(body, { status, headers: noStore });
const empty = status => new Response(null, { status, headers: noStore });
const off = () => reply(503, { success: false });
const accepted = () => reply(202, { success: true });
// Lien inconnu, déjà utilisé ou retiré : la réponse ne les distingue pas.
const inactive = result => reply(410, { success: false, reason: result.reason === 'expired' ? 'expired' : 'inactive' });
const transportFailed = step => { createLogger().log('newsletter_transport_failed', { step }); return off(); };

function channelFor(env) {
  const transport = newsletterTransportMissing(env).length ? null : createBrevoNewsletterTransport({ environment: env });
  return createNewsletterChannel(env, { database: env.NEWSLETTER_DB ?? null, transport });
}

const ACTIONS = Object.freeze({
  async subscribe(channel, input, env, request) {
    if (input.website) return accepted();
    const verifier = createTurnstileVerifier(env);
    if (verifier && !(await verifier(input.captcha_token, request))) {
      createLogger().log('turnstile_failed', { journey: CONSENT_SOURCE });
      return reply(403, { success: false });
    }
    const result = await channel.request({
      email: input.email, consent: input.consent, preferences: input.preferences ?? [],
      // La version de l'information vient du serveur : le navigateur ne la choisit pas.
      notice_version: env.NEWSLETTER_NOTICE_VERSION, consent_source: CONSENT_SOURCE
    });
    // Même réponse pour une adresse nouvelle, en attente ou déjà inscrite.
    if (result.ok || result.reason === 'already_confirmed' || result.reason === 'pending_or_replayed') return accepted();
    if (result.reason === 'confirmation_transport_failed') return transportFailed('confirmation');
    return reply(400, { success: false });
  },
  async confirm(channel, input) {
    const result = await channel.confirm(input.token);
    if (result.ok) return reply(200, { success: true, management_token: result.management_token });
    return result.reason === 'subscription_transport_failed' ? transportFailed('subscribe') : inactive(result);
  },
  async preferences(channel, input) {
    if (input.preferences === undefined) {
      const current = await channel.read(input.token);
      return current.ok ? reply(200, { success: true, preferences: current.preferences }) : inactive(current);
    }
    const result = await channel.preferences(input.token, input.preferences);
    if (result.ok) return reply(200, { success: true });
    if (result.reason === 'invalid_preferences') return reply(400, { success: false });
    return result.reason === 'preferences_transport_failed' ? transportFailed('preferences') : inactive(result);
  },
  async unsubscribe(channel, input) {
    const result = await channel.revoke(input.token);
    if (result.ok) return reply(200, { success: true });
    if (result.reason === 'newsletter_disabled') return off();
    // Le retrait est acquis en base : seule la répercussion reste à reprendre.
    if (result.reason === 'unsubscribe_transport_failed') {
      createLogger().log('newsletter_transport_failed', { step: 'unsubscribe' });
      return reply(202, { success: true, pending: true });
    }
    return inactive(result);
  }
});

export async function handleNewsletter(request, env, url) {
  const action = url.pathname.slice('/api/newsletter/'.length);
  if (!Object.hasOwn(ACTIONS, action)) return empty(404);
  const open = newsletterEnabled(env);
  if ((!open && action !== 'unsubscribe') || (open && !isReady(env))) return off();
  if (request.method !== 'POST') return empty(405);
  if (request.headers.get('origin') !== env.ALLOWED_ORIGIN ||
      !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return empty(403);
  try {
    // Le retrait ne passe pas par la limite de débit : rien ne doit l'entraver.
    if (action !== 'unsubscribe' && !(await createDistributedGuard(env, request).allowRate())) return reply(429, { success: false });
    const body = await readLimited(request, MAX_BODY_BYTES);
    if (body.tooLarge) return empty(413);
    if (body.invalid) return empty(400);
    let input;
    try { input = JSON.parse(body.raw); } catch { return empty(400); }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return empty(400);
    return await ACTIONS[action](channelFor(env), input, env, request);
  } catch {
    return off();
  }
}

// Tâche quotidienne : purge, reprise des retraits restés sans répercussion, puis
// état de ce qui reste bloqué. Une reprise impossible ne masque jamais cet état.
export async function newsletterMaintenance(env, now = Date.now()) {
  const purged = await purgeNewsletter(env.NEWSLETTER_DB, { now, proofRetentionDays: env.NEWSLETTER_PROOF_RETENTION_DAYS });
  let retry = { retried: 0, failed: 0, unavailable: true };
  try { retry = await channelFor(env).retryPendingRevocations(); } catch { /* signalé par l'état ci-dessous */ }
  const backlog = await newsletterBacklog(env.NEWSLETTER_DB, { now });
  return { purged, ...retry, ...backlog, alert: backlog.alert || (retry.unavailable === true && backlog.pending_revocations > 0) };
}
