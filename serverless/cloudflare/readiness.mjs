// Disponibilité réelle des composants ACTIVÉS.
//
// Un service fermé n'a rien à prouver. Un service ouvert doit avoir tout ce
// dont il a besoin pour fonctionner, sans quoi /api/health annonce
// « unavailable » plutôt que de laisser découvrir le manque au premier
// visiteur.
//
// La fonction retourne un booléen et rien d'autre : les motifs restent
// internes et ne sont jamais exposés sur la route publique.

import { enabledSteps, validateEnvironment } from '../bluewave-leads/brevo-client.mjs';
import { retentionCutoff } from '../bluewave-leads/lead-store.mjs';
import { newsletterEnabled } from '../bluewave-leads/newsletter.mjs';
import { newsletterTransportMissing } from '../bluewave-leads/newsletter-brevo.mjs';
import { turnstileEnabled } from './turnstile.mjs';

const filled = (environment, name) => String(environment[name] ?? '').trim().length > 0;

// Motifs internes, utiles aux tests et au diagnostic hors ligne. Jamais servis.
export function readinessReasons(environment = {}) {
  const reasons = [];
  if (!environment.ASSETS) reasons.push('assets_missing');

  if (environment.LEADS_ENABLED === 'true') {
    if (typeof environment.LEADS_DB?.prepare !== 'function') reasons.push('leads_db_missing');
    if (!filled(environment, 'LEAD_RETENTION_DAYS')) reasons.push('lead_retention_missing');
  }

  // Tout point d'entrée public repose sur la garde et sur une origine stricte.
  if (environment.LEADS_ENABLED === 'true' || newsletterEnabled(environment)) {
    if (!environment.LEAD_GUARD) reasons.push('lead_guard_missing');
    // La garde distribuée refuse déjà une clé plus courte : l'annoncer ici
    // évite d'ouvrir le formulaire sur une garde qui lèvera à chaque appel.
    if (String(environment.GUARD_HMAC_KEY ?? '').length < 32) reasons.push('guard_key_missing');
    try {
      const origin = new URL(environment.ALLOWED_ORIGIN);
      if (origin.protocol !== 'https:' || origin.origin !== environment.ALLOWED_ORIGIN) reasons.push('allowed_origin_invalid');
    } catch { reasons.push('allowed_origin_invalid'); }
  }

  // Chaque diffusion ouverte doit avoir ses paramètres, y compris pour la
  // reprise lorsque la collecte publique est fermée.
  if (environment.LEADS_ENABLED === 'true' || environment.LEADS_REPLAY_ENABLED === 'true') {
    try { validateEnvironment({ALLOWED_ORIGIN: 'https://bluewave.invalid', ...environment}, enabledSteps(environment)); }
    catch { reasons.push('brevo_config_missing'); }
  }
  if (environment.LEADS_REPLAY_ENABLED === 'true') {
    if (typeof environment.LEADS_DB?.prepare !== 'function') reasons.push('leads_db_missing');
    if (!filled(environment, 'LEAD_RETENTION_DAYS')) reasons.push('lead_retention_missing');
  }
  if (environment.CAMPAIGNS_ENABLED === 'true' && !filled(environment, 'ALLOWED_CAMPAIGNS')) reasons.push('campaigns_missing');

  if (turnstileEnabled(environment) && !filled(environment, 'TURNSTILE_SECRET_KEY')) {
    reasons.push('turnstile_secret_missing');
  }

  if (environment.EVENTS_ENABLED === 'true' && !environment.CONVERSION_DB) reasons.push('conversion_db_missing');

  // La lettre de veille a sa propre base, son secret et sa preuve de consentement.
  if (newsletterEnabled(environment)) {
    if (typeof environment.NEWSLETTER_DB?.prepare !== 'function') reasons.push('newsletter_db_missing');
    if (String(environment.NEWSLETTER_TOKEN_SECRET ?? '').length < 32) reasons.push('newsletter_secret_missing');
    if (newsletterTransportMissing(environment).length) reasons.push('newsletter_transport_missing');
    if (!filled(environment, 'NEWSLETTER_NOTICE_VERSION')) reasons.push('newsletter_notice_missing');
    if (!(Number(environment.NEWSLETTER_PROOF_RETENTION_DAYS) > 0)) reasons.push('newsletter_retention_missing');
  }

  // Fermée aux inscriptions, une lettre qui a des inscrits doit rester quittable.
  if (!newsletterEnabled(environment) && environment.NEWSLETTER_DB &&
      (String(environment.NEWSLETTER_TOKEN_SECRET ?? '').length < 32 || newsletterTransportMissing(environment).length)) {
    reasons.push('newsletter_withdrawal_incomplete');
  }

  // Une purge configurée doit l'être avec une valeur exploitable.
  if (filled(environment, 'LEAD_RETENTION_DAYS') && retentionCutoff(environment.LEAD_RETENTION_DAYS) === null) {
    reasons.push('lead_retention_invalid');
  }

  return [...new Set(reasons)];
}

export function isReady(environment = {}) {
  return readinessReasons(environment).length === 0;
}
