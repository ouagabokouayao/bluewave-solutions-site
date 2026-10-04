// Lettre de veille : contrat de double opt-in, préparé et volontairement inerte.
//
// Rien n'est activé ici. Le module fixe la séquence et les invariants pour que
// l'implémentation future n'ait pas à les redécouvrir, et pour que des tests de
// non-activation existent dès maintenant.
//
// Invariant central : une demande commerciale n'est jamais convertie en
// inscription. Les deux canaux ont des points d'entrée, des consentements et
// des durées distincts.

export const NEWSLETTER_STEPS = Object.freeze([
  'REQUEST',      // saisie de l'adresse sur un formulaire dédié
  'CONFIRM_SENT', // courriel de confirmation expédié, jeton à durée limitée
  'CONFIRMED',    // le destinataire a cliqué dans la fenêtre de validité
  'EXPIRED',      // jeton périmé sans confirmation : aucune inscription
  'REVOKED'       // désinscription ou retrait du consentement
]);

export const TOKEN_TTL_SECONDS = 86400;

export function newsletterEnabled(environment = {}) {
  return environment.NEWSLETTER_ENABLED === 'true';
}

// Une demande de contact ne vaut jamais demande d'inscription, quel que soit
// le contenu du formulaire reçu.
export function leadGrantsSubscription() {
  return false;
}

// Point d'entrée futur. Tant que le canal est fermé, il refuse sans effet de
// bord : aucun jeton émis, aucun courriel, aucun contact créé.
export function createNewsletterChannel(environment = {}) {
  if (!newsletterEnabled(environment)) {
    return {
      enabled: false,
      async request() { return { ok: false, reason: 'newsletter_disabled' }; },
      async confirm() { return { ok: false, reason: 'newsletter_disabled' }; }
    };
  }
  // Le reste de la séquence (émission de jeton signé, expiration, confirmation,
  // inscription chez le prestataire retenu) dépend d'un choix de fournisseur et
  // d'un modèle de courriel qui ne sont pas arrêtés. Voir le delta restant dans
  // serverless/OPERATIONS.md.
  throw new Error('Canal lettre de veille non implémenté : activation non autorisée');
}
