import {LIMITS, validateLead} from '../../assets/js/lead-schema.js';

const LEGACY_FIELDS = new Set([
  'firstname', 'lastname', 'email', 'organisation', 'type', 'geography', 'themes',
  'need', 'deadline', 'contact_preference', 'source', 'newsletter_consent',
  'privacy_acknowledged', 'website', 'captcha_token'
]);

const territoryMap = Object.freeze({
  'france-mediterranee': 'france-mediterranee',
  'cote-divoire': 'cote-divoire',
  'afrique-ouest': 'afrique-ouest',
  autre: 'autre'
});
const categoryMap = Object.freeze({
  'littoral-adaptation': 'vulnerabilite',
  'gouvernance-maritime': 'gouvernance',
  'environnement-marin': 'sfn',
  'economie-bleue': 'projet',
  'ports-maritime': 'strategie',
  'droit-securite': 'strategie'
});

function legacyToCanonical(input) {
  if (Object.keys(input).some(field => !LEGACY_FIELDS.has(field))) return null;
  const leadType = input.type;
  const journey = leadType === 'formation' ? 'formation'
    : leadType === 'collaboration' ? 'collaboration'
      : leadType === 'evenement-intervention' ? 'evenement' : 'projet';
  const theme = Array.isArray(input.themes) ? input.themes[0] : '';
  return {
    journey,
    source_offer: '',
    recommended_offer: '',
    lead_type: leadType,
    organisation_type: 'autre',
    territory: territoryMap[input.geography] || 'autre',
    need_category: categoryMap[theme] || (journey === 'formation' ? 'formation' : journey === 'collaboration' ? 'collaboration' : 'indetermine'),
    stage: journey === 'formation' ? 'formation' : 'a-preciser',
    data_availability: 'incertain',
    desired_outcome: journey === 'formation' ? 'former' : journey === 'collaboration' ? 'collaborer' : 'perimetre',
    firstname: input.firstname,
    lastname: input.lastname || 'À préciser',
    email: input.email,
    organisation: input.organisation || (journey === 'projet' ? 'À préciser' : ''),
    contact_preference: input.contact_preference || 'email',
    deadline: input.deadline || 'nondef',
    need: input.need,
    newsletter_optin_request: input.newsletter_consent === true,
    privacy_acknowledged: input.privacy_acknowledged,
    website: input.website || '',
    captcha_token: input.captcha_token || '',
    ...(journey === 'formation' ? {
      audience: 'À préciser', training_subject: input.need, learning_objectives: input.need,
      training_format: 'distance', period: input.deadline || 'À préciser'
    } : {})
  };
}

function downstreamCompatibility(value) {
  const domains = value.domains?.length ? value.domains
    : value.expertise_domains?.length ? value.expertise_domains
      : [({vulnerabilite:'littoral-adaptation',strategie:'gouvernance-maritime',gouvernance:'gouvernance-maritime',sfn:'environnement-marin',projet:'economie-bleue',planification:'littoral-adaptation',formation:'formation-recherche',collaboration:'gouvernance-maritime',expertise:'formation-recherche',multiple:'gouvernance-maritime',indetermine:'gouvernance-maritime'})[value.need_category] || 'gouvernance-maritime'];
  return {
    ...value,
    type: value.lead_type,
    geography: value.territory,
    themes: domains,
    need: value.need || value.collaboration_expectation || value.motivation || value.learning_objectives || value.context,
    deadline: value.deadline || value.period || 'nondef',
    contact_preference: value.contact_preference || 'email',
    source: 'SITE_FORMS',
    newsletter_consent: false
  };
}

export function validateLeadPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok: false, errors: ['payload']};
  const candidate = 'lead_type' in input ? input : legacyToCanonical(input);
  if (!candidate) return {ok: false, errors: ['payload']};
  const result = validateLead(candidate);
  return result.ok ? {ok: true, value: downstreamCompatibility(result.value)} : result;
}

export {LIMITS};
