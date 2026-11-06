// Transport Brevo de la lettre de veille. Il n'est construit que par le Worker,
// lorsque la base et les paramètres sont présents.
import { attemptKey } from './brevo-client.mjs';

const BREVO_API_BASE = 'https://api.brevo.com/v3';
const CONFIRMATION_SUBJECT = 'Confirmez votre inscription à la lettre de veille BlueWave';
const REQUIRED = Object.freeze(['BREVO_API_KEY', 'BREVO_NEWSLETTER_LIST_ID', 'BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID', 'BLUEWAVE_SITE_URL']);

export function newsletterTransportMissing(environment = {}) {
  return REQUIRED.filter(name => !String(environment[name] ?? '').trim());
}

export function createBrevoNewsletterTransport({ environment, fetchImpl = globalThis.fetch }) {
  const missing = newsletterTransportMissing(environment);
  if (missing.length) throw new Error(`Configuration incomplète : ${missing.join(', ')}`);
  const listId = Number(environment.BREVO_NEWSLETTER_LIST_ID);
  const templateId = Number(environment.BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID);
  if (!Number.isSafeInteger(listId) || listId <= 0 || !Number.isSafeInteger(templateId) || templateId <= 0) throw new Error('Configuration invalide : lettre de veille');
  const site = new URL(environment.BLUEWAVE_SITE_URL);
  if (site.protocol !== 'https:') throw new Error('Configuration invalide : BLUEWAVE_SITE_URL');
  const send = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
  // Le jeton voyage dans le fragment : il n'atteint ni les journaux du serveur
  // ni l'en-tête Referer.
  const page = (name, token) => `${site.origin}/lettre-de-veille.html#${name}=${token}`;
  const request = async (path, body, { method = 'POST', absent = null } = {}) => {
    const response = await send(`${BREVO_API_BASE}${path}`, {
      method,
      headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': environment.BREVO_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    if (response.ok || response.status === absent) return response;
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error('Service Brevo indisponible'), { status: response.status, duplicate: detail?.code === 'duplicate_parameter' });
  };
  return {
    // Pendant 30 minutes, Brevo refuse un second envoi de la même clé : ce refus
    // prouve que le premier a été accepté.
    async sendConfirmation(email, token, { idempotency_key: key } = {}) {
      const tracking = key ? { headers: { idempotencyKey: await attemptKey(key) } } : {};
      try {
        return await request('/smtp/email', { to: [{ email }], templateId, subject: CONFIRMATION_SUBJECT, params: { confirmation_url: page('confirmer', token) }, ...tracking });
      } catch (error) {
        if (error.duplicate) return null;
        throw error;
      }
    },
    subscribe: (email, { preferences, management_token }) => request('/contacts', {
      email, listIds: [listId], updateEnabled: true,
      attributes: { BW_VEILLE_PREFERENCES: preferences.join(' | '), BW_VEILLE_GESTION: page('gerer', management_token) }
    }),
    updatePreferences: (email, preferences) => request('/contacts', {
      email, updateEnabled: true, attributes: { BW_VEILLE_PREFERENCES: preferences.join(' | ') }
    }),
    // Rejouable : retirer un contact déjà retiré ou inconnu n'est pas une panne.
    unsubscribe: email => request(`/contacts/${encodeURIComponent(email)}`, { unlinkListIds: [listId] }, { method: 'PUT', absent: 404 })
  };
}
