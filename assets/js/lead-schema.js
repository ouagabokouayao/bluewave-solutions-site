// Contrat P0 unique pour le front, /api/leads et les tests.
// Il ne contient ni secret, ni règle d'activation d'un service externe.
export const OFFERS = Object.freeze([
  'diagnostic-strategique', 'vulnerabilite-cotiere', 'gouvernance-acteurs',
  'structuration-projet', 'formation-capacites', 'note-strategique', 'atelier-cadrage'
]);

export const JOURNEYS = Object.freeze(['projet', 'collaboration', 'formation', 'evenement']);
export const LEAD_TYPES = Object.freeze([
  'projet-mission', 'collaboration-organisation', 'expertise-offer', 'formation',
  // Compatibilité des demandes historiques déjà préparées par le Qualifier.
  'collaboration', 'partenariat', 'recherche-expertise', 'presse-intervention',
  'evenement-intervention', 'autre'
]);

export const EXPERT_POOL_STATUSES = Object.freeze(['REÇU', 'À QUALIFIER', 'QUALIFIÉ', 'À CONTACTER']);

export const ENUMS = Object.freeze({
  journey: JOURNEYS,
  source_offer: OFFERS,
  recommended_offer: OFFERS,
  lead_type: LEAD_TYPES,
  organisation_type: ['collectivite', 'port', 'bureau', 'conseil', 'avocat', 'institution', 'consortium', 'ong', 'recherche', 'entreprise', 'independant', 'autre'],
  territory: ['france-mediterranee', 'cote-divoire', 'afrique-ouest', 'autre', 'multi', 'a-preciser'],
  need_category: ['vulnerabilite', 'strategie', 'gouvernance', 'sfn', 'projet', 'planification', 'formation', 'multiple', 'indetermine', 'collaboration', 'expertise'],
  stage: ['initial', 'flou', 'cadrage', 'etude', 'structure', 'decision', 'concertation', 'formation', 'a-preciser'],
  data_availability: ['etudes', 'sig', 'planif', 'env', 'concert', 'projet', 'maritime', 'aucune', 'incertain', 'non-applicable'],
  desired_outcome: ['comprendre', 'options', 'acteurs', 'structurer', 'route', 'concertation', 'former', 'note', 'perimetre', 'collaborer', 'proposer-expertise'],
  deadline: ['1m', '1-3m', '3-6m', '6-12m', 'plus', 'nondef'],
  contact_preference: ['email', 'telephone', 'visioconference'],
  training_format: ['presentiel', 'distance', 'hybride'],
  training_level: ['initiation', 'intermediaire', 'avance', 'mixte', 'a-preciser'],
  rc_pro: ['oui', 'non', 'non-applicable', 'en-cours'],
  professional_status: ['independant', 'salarie', 'chercheur', 'enseignant', 'doctorant', 'consultant', 'entrepreneur', 'autre'],
  availability: ['immediate', 'sous-1-mois', '1-3-mois', 'ponctuelle', 'a-preciser'],
  collaboration_form: ['mission', 'consortium', 'recherche', 'formation', 'evenement', 'autre'],
  domain: ['littoral-adaptation', 'gouvernance-maritime', 'environnement-marin', 'economie-bleue', 'ports-maritime', 'droit-securite', 'concertation-mediation', 'formation-recherche'],
  intervention_type: ['etude', 'conseil', 'recherche', 'formation', 'facilitation', 'terrain', 'cartographie', 'redaction'],
  work_language: ['francais', 'anglais', 'espagnol', 'portugais', 'arabe', 'autre']
});

export const LIMITS = Object.freeze({
  firstname: 80, lastname: 80, email: 254, organisation: 160, role: 120,
  website_url: 500, linkedin: 500, orcid: 80, portfolio: 500, phone: 40,
  need: 2000, collaboration_subject: 240, collaboration_expectation: 1200,
  public_reference: 500, expertise_evidence: 1200, motivation: 800,
  mobility: 240, rate_range: 160, audience: 500, training_subject: 240,
  learning_objectives: 1200, period: 160, location: 240, duration: 160,
  customization: 800, context: 1200, participant_count: 6,
  honeypot: 200, captcha_token: 2048
});

const COMMON_FIELDS = [
  'journey', 'source_offer', 'recommended_offer', 'lead_type', 'organisation_type',
  'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome',
  'firstname', 'lastname', 'email', 'organisation', 'role', 'contact_preference',
  'deadline', 'need', 'newsletter_optin_request', 'privacy_acknowledged',
  'website', 'captcha_token'
];
const ORGANISATION_FIELDS = ['collaboration_subject', 'domains', 'collaboration_expectation', 'collaboration_form', 'public_reference', 'organisation_website'];
const EXPERTISE_FIELDS = ['professional_status', 'expertise_domains', 'intervention_types', 'work_languages', 'availability', 'expertise_evidence', 'motivation', 'phone', 'linkedin', 'website_url', 'orcid', 'portfolio', 'mobility', 'rate_range', 'rc_pro'];
const TRAINING_FIELDS = ['audience', 'training_subject', 'learning_objectives', 'training_format', 'period', 'participant_count', 'training_level', 'location', 'duration', 'customization', 'context'];
export const ALLOWED_FIELDS = Object.freeze([...COMMON_FIELDS, ...ORGANISATION_FIELDS, ...EXPERTISE_FIELDS, ...TRAINING_FIELDS]);

export const CONDITIONAL_RULES = Object.freeze({
  'projet:projet-mission': ['organisation', 'organisation_type', 'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome', 'need'],
  'collaboration:collaboration-organisation': ['organisation', 'organisation_type', 'territory', 'collaboration_subject', 'domains', 'collaboration_expectation'],
  'collaboration:expertise-offer': ['territory', 'professional_status', 'expertise_domains', 'intervention_types', 'work_languages', 'availability', 'expertise_evidence', 'motivation'],
  'formation:formation': ['organisation', 'audience', 'training_subject', 'learning_objectives', 'training_format', 'period']
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https:\/\//i;
const ARRAY_ENUMS = Object.freeze({domains: 'domain', expertise_domains: 'domain', intervention_types: 'intervention_type', work_languages: 'work_language'});
function cleanString(value, limit) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length <= limit ? clean : null;
}

function pushError(errors, field) {
  if (!errors.includes(field)) errors.push(field);
}

export function validateLead(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok: false, errors: ['payload']};
  const errors = [];
  const value = {};
  if (Object.keys(input).some(field => !ALLOWED_FIELDS.includes(field))) pushError(errors, 'payload');

  for (const field of ['journey', 'lead_type', 'firstname', 'lastname', 'email']) {
    const clean = cleanString(input[field], LIMITS[field] || 80);
    if (!clean) pushError(errors, field); else value[field] = clean;
  }
  if (value.email && !EMAIL_PATTERN.test(value.email)) pushError(errors, 'email');
  else if (value.email) value.email = value.email.toLowerCase();

  for (const field of ['source_offer', 'recommended_offer', 'organisation_type', 'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome', 'deadline', 'contact_preference', 'training_format', 'training_level', 'rc_pro', 'professional_status', 'availability', 'collaboration_form']) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '') { value[field] = ''; continue; }
    const clean = cleanString(raw, 100);
    if (!clean || !ENUMS[field]?.includes(clean)) pushError(errors, field); else value[field] = clean;
  }

  for (const [field, limit] of Object.entries(LIMITS)) {
    if (field === 'honeypot' || field === 'captcha_token') continue;
    if (value[field] !== undefined || input[field] === undefined) continue;
    const clean = cleanString(input[field] ?? '', limit);
    if (clean === null) pushError(errors, field); else value[field] = clean;
  }
  for (const field of ['organisation_website']) {
    const clean = cleanString(input[field] ?? '', 500);
    if (clean === null || (clean && !URL_PATTERN.test(clean))) pushError(errors, field); else value[field] = clean || '';
  }
  for (const field of ['website_url', 'linkedin', 'portfolio']) {
    if (value[field] && !URL_PATTERN.test(value[field])) pushError(errors, field);
  }
  if (value.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value.orcid)) pushError(errors, 'orcid');

  for (const [field, enumName] of Object.entries(ARRAY_ENUMS)) {
    const raw = input[field];
    if (raw === undefined) { value[field] = []; continue; }
    if (!Array.isArray(raw) || raw.length > 8 || raw.length < 1 || raw.some(item => typeof item !== 'string' || !ENUMS[enumName].includes(item))) {
      pushError(errors, field);
    } else value[field] = [...new Set(raw)];
  }

  if (!ENUMS.journey.includes(value.journey)) pushError(errors, 'journey');
  if (!ENUMS.lead_type.includes(value.lead_type)) pushError(errors, 'lead_type');
  const compatibility = {
    'projet-mission': ['projet'],
    'collaboration-organisation': ['collaboration'],
    'expertise-offer': ['collaboration'],
    formation: ['formation'],
    collaboration: ['collaboration'],
    'evenement-intervention': ['evenement']
  };
  if (compatibility[value.lead_type] && !compatibility[value.lead_type].includes(value.journey)) pushError(errors, 'lead_type');

  const required = CONDITIONAL_RULES[`${value.journey}:${value.lead_type}`] || [];
  for (const field of required) {
    const fieldValue = value[field];
    if (Array.isArray(fieldValue) ? fieldValue.length === 0 : !fieldValue) pushError(errors, field);
  }
  if (value.journey === 'formation' && ['presentiel', 'hybride'].includes(value.training_format) && !value.location) pushError(errors, 'location');

  if (input.newsletter_optin_request !== false) pushError(errors, 'newsletter_optin_request');
  else value.newsletter_optin_request = false;
  if (input.privacy_acknowledged !== true) pushError(errors, 'privacy_acknowledged');
  else value.privacy_acknowledged = true;

  const website = cleanString(input.website ?? '', LIMITS.honeypot);
  if (website === null) pushError(errors, 'website');
  value.website = website ?? '';
  const captchaToken = cleanString(input.captcha_token ?? '', LIMITS.captcha_token);
  if (captchaToken === null) pushError(errors, 'captcha_token');
  value.captcha_token = captchaToken ?? '';

  return errors.length ? {ok: false, errors} : {ok: true, value};
}

export function hasCanonicalOffer(value) { return OFFERS.includes(value); }
export function hasJourney(value) { return JOURNEYS.includes(value); }
export function resolveQualifierLeadType(journey, historicalType = 'projet-mission') {
  return journey === 'projet' ? 'projet-mission' : historicalType;
}

export const LEAD_SCHEMA = Object.freeze({
  version: 'p0-2026-10-04',
  common_fields: Object.freeze(['journey', 'source_offer', 'recommended_offer', 'lead_type', 'organisation_type', 'territory', 'need_category', 'stage', 'data_availability', 'desired_outcome']),
  required_identity: Object.freeze(['firstname', 'lastname', 'email', 'privacy_acknowledged']),
  conditional_rules: CONDITIONAL_RULES,
  limits: LIMITS,
  enums: ENUMS,
  compatibility: Object.freeze({
    type: 'lead_type', geography: 'territory', themes: 'domains',
    source: 'origine technique historique SITE_QUALIFIER', newsletter_consent: 'newsletter_optin_request'
  })
});

// Projection interne future : ces champs ne sont pas acceptés depuis le navigateur.
export const LEAD_RECORD_SCHEMA = Object.freeze({
  fields: Object.freeze(['timestamp', 'journey', 'source_offer', 'recommended_offer', 'lead_type', 'qualification_status']),
  expertise_statuses: EXPERT_POOL_STATUSES,
  public_client_may_set_status: false
});
