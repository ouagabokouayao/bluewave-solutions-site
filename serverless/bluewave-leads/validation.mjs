const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = Object.freeze({
  firstname: 80,
  lastname: 80,
  email: 254,
  organisation: 160,
  type: 80,
  geography: 80,
  theme: 100,
  need: 2000,
  deadline: 80,
  contact_preference: 40,
  source: 40,
  honeypot: 200,
  captcha_token: 2048
});

const REQUIRED_STRING_FIELDS = ['firstname', 'email', 'type', 'geography', 'need', 'contact_preference'];
const OPTIONAL_STRING_FIELDS = ['lastname', 'organisation', 'deadline'];
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_STRING_FIELDS,
  ...OPTIONAL_STRING_FIELDS,
  'themes', 'source', 'newsletter_consent', 'privacy_acknowledged',
  'website', 'captcha_token'
]);
const ALLOWED_VALUES = Object.freeze({
  type: new Set(['projet-mission', 'formation', 'collaboration', 'partenariat', 'recherche-expertise', 'presse-intervention', 'autre']),
  geography: new Set(['france-mediterranee', 'cote-divoire', 'afrique-ouest', 'autre']),
  theme: new Set(['littoral-adaptation', 'gouvernance-maritime', 'environnement-marin', 'economie-bleue', 'ports-maritime', 'droit-securite']),
  deadline: new Set(['1m', '1-3m', '3-6m', '6-12m', 'plus', 'nondef']),
  contact_preference: new Set(['email', 'telephone', 'visioconference'])
});

function cleanString(value, limit) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length > limit) return null;
  return clean;
}

export function validateLeadPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['payload'] };
  }

  const errors = [];
  const value = {};
  if (Object.keys(input).some(field => !ALLOWED_FIELDS.has(field))) errors.push('payload');
  for (const field of REQUIRED_STRING_FIELDS) {
    const clean = cleanString(input[field], LIMITS[field]);
    if (!clean) errors.push(field);
    else value[field] = clean;
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    const clean = cleanString(input[field] ?? '', LIMITS[field]);
    if (clean === null) errors.push(field);
    else value[field] = clean;
  }

  const email = cleanString(input.email, LIMITS.email);
  if (email && EMAIL_PATTERN.test(email)) value.email = email.toLowerCase();
  else if (!errors.includes('email')) errors.push('email');

  for (const field of ['type', 'geography', 'contact_preference']) {
    if (value[field] && !ALLOWED_VALUES[field].has(value[field])) errors.push(field);
  }
  if (value.deadline && !ALLOWED_VALUES.deadline.has(value.deadline)) errors.push('deadline');

  if (!Array.isArray(input.themes) || input.themes.length < 1 || input.themes.length > 5) {
    errors.push('themes');
  } else {
    value.themes = input.themes.map(theme => cleanString(theme, LIMITS.theme));
    if (value.themes.some(theme => !theme || !ALLOWED_VALUES.theme.has(theme))) errors.push('themes');
    else value.themes = [...new Set(value.themes)];
  }

  if (input.source !== 'SITE_QUALIFIER') errors.push('source');
  else value.source = input.source;
  if (typeof input.newsletter_consent !== 'boolean') errors.push('newsletter_consent');
  else value.newsletter_consent = input.newsletter_consent;
  if (input.privacy_acknowledged !== true) errors.push('privacy_acknowledged');
  else value.privacy_acknowledged = true;

  const website = cleanString(input.website ?? '', LIMITS.honeypot);
  if (website === null) errors.push('website');
  value.website = website ?? '';
  const captchaToken = cleanString(input.captcha_token ?? '', LIMITS.captcha_token);
  if (captchaToken === null) errors.push('captcha_token');
  value.captcha_token = captchaToken ?? '';

  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, value };
}

export { LIMITS };
