const BREVO_API_BASE = 'https://api.brevo.com/v3';
const ACK_SUBJECT = 'Votre demande a bien été reçue — BlueWave Solutions';

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Configuration invalide : ${name}`);
  return parsed;
}

// Chaque diffusion a son interrupteur : collecter ne vaut pas accuser réception,
// notifier ou alimenter la liste de contacts. Une étape non ouverte est sautée.
// `repeatable` : rejouer l'étape ne produit aucun effet visible, même si la
// première tentative a abouti. C'est vrai du contact, pas d'un courriel.
export const DELIVERY_STEPS = Object.freeze([
  Object.freeze({ field: 'brevo_contact_status', code: 'brevo_contact', method: 'upsertContact', event: 'brevo_contact_failed', repeatable: true,
    flag: 'LEADS_CONTACT_SYNC_ENABLED', requires: Object.freeze(['BREVO_API_KEY', 'BREVO_LEADS_LIST_ID']) }),
  Object.freeze({ field: 'ack_status', code: 'ack', method: 'sendAcknowledgement', event: 'ack_failed',
    flag: 'LEADS_ACK_ENABLED', requires: Object.freeze(['BREVO_API_KEY', 'BREVO_ACK_TEMPLATE_ID', 'BLUEWAVE_INTERNAL_EMAIL']) }),
  Object.freeze({ field: 'notification_status', code: 'internal_notification', method: 'sendInternalNotification', event: 'internal_notification_failed',
    flag: 'LEADS_NOTIFY_ENABLED', requires: Object.freeze(['BREVO_API_KEY', 'BREVO_INTERNAL_TEMPLATE_ID', 'BLUEWAVE_INTERNAL_EMAIL']) })
]);

export function enabledSteps(environment) {
  return DELIVERY_STEPS.filter(step => environment?.[step.flag] === 'true');
}

// Sans réponse, ou sur une erreur 5xx, le fournisseur a pu accepter l'envoi : seul
// un refus explicite (4xx) prouve que rien n'est parti.
export function failureStatus(step, error) {
  return error?.uncertain && !step.repeatable ? 'UNCERTAIN' : 'FAILED';
}

// Clé stable d'une tentative, au format UUID exigé par Brevo.
export async function attemptKey(...parts) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join(':')));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export const deliveryTag = (reference, code) => `bw-${code}-${reference}`;

// Événements qui prouvent que Brevo a pris le message en charge.
const ACCEPTED_EVENTS = Object.freeze(['requests', 'deferred', 'delivered', 'opened', 'clicks', 'loadedByProxy']);

const INTEGER_PARAMETERS = Object.freeze(['BREVO_LEADS_LIST_ID', 'BREVO_ACK_TEMPLATE_ID', 'BREVO_INTERNAL_TEMPLATE_ID']);

export function validateEnvironment(environment, steps = DELIVERY_STEPS) {
  const required = [...new Set(['ALLOWED_ORIGIN', ...steps.flatMap(step => step.requires)])];
  const missing = required.filter(name => !String(environment[name] ?? '').trim());
  if (missing.length) throw new Error(`Configuration incomplète : ${missing.join(', ')}`);
  for (const name of INTEGER_PARAMETERS) if (required.includes(name)) positiveInteger(environment[name], name);
  if (required.includes('BLUEWAVE_INTERNAL_EMAIL') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.BLUEWAVE_INTERNAL_EMAIL)) {
    throw new Error('Configuration invalide : BLUEWAVE_INTERNAL_EMAIL');
  }
  const origin = new URL(environment.ALLOWED_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== environment.ALLOWED_ORIGIN) {
    throw new Error('Configuration invalide : ALLOWED_ORIGIN');
  }
  if (environment.NEWSLETTER_ENABLED && environment.NEWSLETTER_ENABLED !== 'false' && environment.NEWSLETTER_ENABLED !== 'true') throw new Error('NEWSLETTER_ENABLED invalide');
  if (environment.BLUEWAVE_SITE_URL) {
    const site = new URL(environment.BLUEWAVE_SITE_URL);
    if (site.protocol !== 'https:') throw new Error('Configuration invalide : BLUEWAVE_SITE_URL');
  }
}

export class BrevoClient {
  constructor({ environment, fetchImpl = globalThis.fetch, steps = DELIVERY_STEPS }) {
    validateEnvironment(environment, steps);
    if (typeof fetchImpl !== 'function') throw new Error('Client HTTP indisponible');
    this.environment = environment;
    // Cloudflare Workers requires the host fetch function's global receiver.
    this.fetchImpl = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
  }

  async request(path, body) {
    let response;
    try {
      response = await this.fetchImpl(`${BREVO_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': this.environment.BREVO_API_KEY
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw Object.assign(new Error('Réponse Brevo perdue'), { uncertain: true });
    }
    if (response.ok) return response;
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error('Service Brevo indisponible'), {
      status: response.status, uncertain: response.status >= 500, duplicate: detail?.code === 'duplicate_parameter'
    });
  }

  // Le repère relie le courriel à sa demande. La clé d'idempotence fait refuser à
  // Brevo un second envoi pendant 30 minutes : ce refus prouve donc le premier.
  async sendEmail(code, body, reference) {
    if (!reference) return this.request('/smtp/email', body);
    const tracked = { ...body, tags: [deliveryTag(reference, code)], headers: { idempotencyKey: await attemptKey(reference, code) } };
    try {
      return await this.request('/smtp/email', tracked);
    } catch (error) {
      if (error.duplicate) return null;
      throw error;
    }
  }

  // Rapprochement : seule une preuve positive vaut. Une absence n'en est pas une,
  // car les événements de Brevo peuvent arriver en retard.
  async hasDelivery(step, lead, reference) {
    const tag = deliveryTag(reference, step.code);
    const query = new URLSearchParams({
      email: step.code === 'ack' ? lead.email : this.environment.BLUEWAVE_INTERNAL_EMAIL,
      tags: JSON.stringify([tag]), days: '90', limit: '100'
    });
    const response = await this.fetchImpl(`${BREVO_API_BASE}/smtp/statistics/events?${query}`, {
      headers: { accept: 'application/json', 'api-key': this.environment.BREVO_API_KEY },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Rapprochement Brevo indisponible');
    const { events = [] } = await response.json();
    return events.some(event => String(event.tag ?? '').includes(tag) && ACCEPTED_EVENTS.includes(event.event));
  }

  async upsertContact(lead) {
    const listIds = [positiveInteger(this.environment.BREVO_LEADS_LIST_ID, 'BREVO_LEADS_LIST_ID')];
    // Une demande commerciale n'ajoute jamais directement un contact à la
    // newsletter. Le futur canal de veille utilisera un flux DOI séparé.
    return this.request('/contacts', {
      email: lead.email,
      attributes: {
        PRENOM: lead.firstname,
        NOM: lead.lastname,
        BW_TYPE: lead.type,
        BW_GEO: lead.geography,
        BW_THEME: lead.themes.join(' | '),
        BW_ORGANISATION: lead.organisation,
        BW_BESOIN: lead.need,
        BW_DELAI: lead.deadline,
        BW_SOURCE: lead.source,
        BW_STATUT: 'NOUVEAU'
      },
      listIds,
      updateEnabled: true
    });
  }

  async sendAcknowledgement(lead, { reference } = {}) {
    const site = String(this.environment.BLUEWAVE_SITE_URL || this.environment.ALLOWED_ORIGIN).replace(/\/$/, '');
    return this.sendEmail('ack', {
      to: [{ email: lead.email, name: `${lead.firstname} ${lead.lastname}`.trim() }],
      templateId: positiveInteger(this.environment.BREVO_ACK_TEMPLATE_ID, 'BREVO_ACK_TEMPLATE_ID'),
      subject: ACK_SUBJECT,
      replyTo: { email: this.environment.BLUEWAVE_INTERNAL_EMAIL, name: 'BlueWave Solutions' },
      params: {
        firstname: lead.firstname,
        type: lead.type,
        theme: lead.themes.join(', '),
        organisation: lead.organisation,
        solutions_url: `${site}/solutions.html`,
        method_url: `${site}/methode.html`,
        evidence_url: `${site}/preuves-demonstrateurs.html`
      }
    }, reference);
  }

  async sendInternalNotification(lead, { reference } = {}) {
    return this.sendEmail('internal_notification', {
      to: [{ email: this.environment.BLUEWAVE_INTERNAL_EMAIL, name: 'BlueWave Solutions' }],
      templateId: positiveInteger(this.environment.BREVO_INTERNAL_TEMPLATE_ID, 'BREVO_INTERNAL_TEMPLATE_ID'),
      subject: `Nouveau lead BlueWave — ${lead.type} — ${lead.organisation || 'Non précisée'} — ${lead.geography}`,
      params: {
        name: `${lead.firstname} ${lead.lastname}`.trim(),
        organisation: lead.organisation,
        email: lead.email,
        type: lead.type,
        geography: lead.geography,
        themes: lead.themes.join(', '),
        need: lead.need,
        deadline: lead.deadline,
        contact_preference: lead.contact_preference,
        newsletter_consent: lead.newsletter_consent ? 'Oui' : 'Non',
        source: lead.source
      }
    }, reference);
  }
}

export { ACK_SUBJECT };
