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
import { turnstileEnabled } from './turnstile.mjs';

const filled = (environment, name) => String(environment[name] ?? '').trim().length > 0;

// Motifs internes, utiles aux tests et au diagnostic hors ligne. Jamais servis.
export function readinessReasons(environment = {}) {
  const reasons = [];
  if (!environment.ASSETS) reasons.push('assets_missing');

  if (environment.LEADS_ENABLED === 'true') {
    if (typeof environment.LEADS_DB?.prepare !== 'function') reasons.push('leads_db_missing');
    if (!filled(environment, 'LEAD_RETENTION_DAYS')) reasons.push('lead_retention_missing');
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

  // Le canal de veille n'a pas d'implémentation complète : l'ouvrir ne peut
  // pas aboutir, et le dire ici vaut mieux que de le découvrir en production.
  if (newsletterEnabled(environment)) reasons.push('newsletter_channel_not_implemented');

  // Une purge configurée doit l'être avec une valeur exploitable.
  if (filled(environment, 'LEAD_RETENTION_DAYS') && retentionCutoff(environment.LEAD_RETENTION_DAYS) === null) {
    reasons.push('lead_retention_invalid');
  }

  return [...new Set(reasons)];
}

export function isReady(environment = {}) {
  return readinessReasons(environment).length === 0;
}
