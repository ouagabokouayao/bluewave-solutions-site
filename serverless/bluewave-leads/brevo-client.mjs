const BREVO_API_BASE = 'https://api.brevo.com/v3';
const ACK_SUBJECT = 'Votre demande a bien été reçue — BlueWave Solutions';

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Configuration invalide : ${name}`);
  return parsed;
}

export function validateEnvironment(environment) {
  const required = [
    'BREVO_API_KEY',
    'BREVO_LEADS_LIST_ID',
    'BREVO_NEWSLETTER_LIST_ID',
    'BREVO_ACK_TEMPLATE_ID',
    'BREVO_INTERNAL_TEMPLATE_ID',
    'BLUEWAVE_INTERNAL_EMAIL',
    'ALLOWED_ORIGIN'
  ];
  const missing = required.filter(name => !String(environment[name] ?? '').trim());
  if (missing.length) throw new Error(`Configuration incomplète : ${missing.join(', ')}`);
  positiveInteger(environment.BREVO_LEADS_LIST_ID, 'BREVO_LEADS_LIST_ID');
  positiveInteger(environment.BREVO_NEWSLETTER_LIST_ID, 'BREVO_NEWSLETTER_LIST_ID');
  positiveInteger(environment.BREVO_ACK_TEMPLATE_ID, 'BREVO_ACK_TEMPLATE_ID');
  positiveInteger(environment.BREVO_INTERNAL_TEMPLATE_ID, 'BREVO_INTERNAL_TEMPLATE_ID');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.BLUEWAVE_INTERNAL_EMAIL)) {
    throw new Error('Configuration invalide : BLUEWAVE_INTERNAL_EMAIL');
  }
  const origin = new URL(environment.ALLOWED_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== environment.ALLOWED_ORIGIN) {
    throw new Error('Configuration invalide : ALLOWED_ORIGIN');
  }
  if (environment.BLUEWAVE_SITE_URL) {
    const site = new URL(environment.BLUEWAVE_SITE_URL);
    if (site.protocol !== 'https:') throw new Error('Configuration invalide : BLUEWAVE_SITE_URL');
  }
}

export class BrevoClient {
  constructor({ environment, fetchImpl = globalThis.fetch }) {
    validateEnvironment(environment);
    if (typeof fetchImpl !== 'function') throw new Error('Client HTTP indisponible');
    this.environment = environment;
    this.fetchImpl = fetchImpl;
  }

  async request(path, body) {
    const response = await this.fetchImpl(`${BREVO_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': this.environment.BREVO_API_KEY
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Service Brevo indisponible');
    return response;
  }

  async upsertContact(lead) {
    const listIds = [positiveInteger(this.environment.BREVO_LEADS_LIST_ID, 'BREVO_LEADS_LIST_ID')];
    if (lead.newsletter_consent) {
      listIds.push(positiveInteger(this.environment.BREVO_NEWSLETTER_LIST_ID, 'BREVO_NEWSLETTER_LIST_ID'));
    }
    return this.request('/contacts', {
      email: lead.email,
      attributes: {
        FIRSTNAME: lead.firstname,
        LASTNAME: lead.lastname,
        BW_TYPE: lead.type,
        BW_GEO: lead.geography,
        BW_THEME: lead.themes.join(' | '),
        BW_ORGANISATION: lead.organisation,
        BW_BESOIN: lead.need,
        BW_DELAI: lead.deadline,
        BW_SOURCE: lead.source,
        BW_STATUT: 'NOUVEAU',
        BW_CONSENT_VEILLE: lead.newsletter_consent
      },
      listIds,
      updateEnabled: true
    });
  }

  async sendAcknowledgement(lead) {
    const site = String(this.environment.BLUEWAVE_SITE_URL || `${this.environment.ALLOWED_ORIGIN}/bluewave-solutions-site`).replace(/\/$/, '');
    return this.request('/smtp/email', {
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
    });
  }

  async sendInternalNotification(lead) {
    return this.request('/smtp/email', {
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
    });
  }
}

export { ACK_SUBJECT };
