// Lettre de veille : double opt-in préparé, canal fermé.
//
// Tout ce qui ne dépend pas d'un fournisseur est implémenté et testé ici :
// contrat de données, jeton signé, expiration, confirmation, révocation,
// protection contre le rejeu. Ce qui dépend d'un fournisseur — l'expédition du
// courriel de confirmation et l'inscription effective — passe par une
// interface explicite, sans implémentation par défaut.
//
// Invariant central : une demande commerciale n'est jamais convertie en
// inscription. Les deux canaux ont des points d'entrée, des consentements et
// des durées distincts, et ne partagent aucun stockage.

export const NEWSLETTER_STEPS = Object.freeze([
  'REQUEST',      // saisie de l'adresse sur un formulaire dédié
  'CONFIRM_SENT', // courriel de confirmation expédié, jeton à durée limitée
  'CONFIRMED',    // le destinataire a cliqué dans la fenêtre de validité
  'EXPIRED',      // jeton périmé sans confirmation : aucune inscription
  'REVOKED'       // désinscription ou retrait du consentement
]);

export const TOKEN_TTL_SECONDS = 86400;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newsletterEnabled(environment = {}) {
  return environment.NEWSLETTER_ENABLED === 'true';
}

// Une demande de contact ne vaut jamais demande d'inscription, quel que soit
// le contenu du formulaire reçu.
export function leadGrantsSubscription() {
  return false;
}

const encoder = new TextEncoder();
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = value => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
};

async function sign(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64url(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

// Jeton de confirmation : adresse, date d'expiration et un aléa qui rend chaque
// jeton unique, le tout signé. Rien n'est stocké côté client qui ne soit
// vérifiable côté serveur.
export async function createConfirmationToken(email, secret, { now = Date.now(), ttlSeconds = TOKEN_TTL_SECONDS, nonce = null } = {}) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(address)) throw new Error('Adresse invalide');
  if (String(secret ?? '').length < 32) throw new Error('Secret de signature insuffisant');
  const body = { e: address, x: Math.floor(now / 1000) + ttlSeconds, n: nonce ?? crypto.randomUUID() };
  const payload = base64url(encoder.encode(JSON.stringify(body)));
  return `${payload}.${await sign(secret, payload)}`;
}

// `seen` est l'ensemble des identifiants déjà consommés : un jeton valide ne
// peut servir qu'une fois.
export async function verifyConfirmationToken(token, secret, { now = Date.now(), seen = null } = {}) {
  const [payload, signature] = String(token ?? '').split('.');
  if (!payload || !signature) return { ok: false, reason: 'malformed' };
  let expected;
  try { expected = await sign(secret, payload); } catch { return { ok: false, reason: 'secret' }; }
  if (!constantTimeEqual(signature, expected)) return { ok: false, reason: 'signature' };
  let body;
  try { body = JSON.parse(new TextDecoder().decode(fromBase64url(payload))); } catch { return { ok: false, reason: 'malformed' }; }
  if (!EMAIL_PATTERN.test(String(body.e ?? ''))) return { ok: false, reason: 'malformed' };
  if (typeof body.x !== 'number' || body.x * 1000 <= now) return { ok: false, reason: 'expired', step: 'EXPIRED' };
  if (seen?.has?.(body.n)) return { ok: false, reason: 'replayed' };
  seen?.add?.(body.n);
  return { ok: true, email: body.e, nonce: body.n, step: 'CONFIRMED' };
}

// Interface fournisseur. Elle n'a pas d'implémentation par défaut : expédier le
// courriel de confirmation et inscrire l'adresse supposent un choix qui n'est
// pas arrêté.
export function assertSubscriberTransport(transport) {
  if (typeof transport?.sendConfirmation !== 'function' || typeof transport?.subscribe !== 'function') {
    throw new Error('Transport lettre de veille incomplet');
  }
  return transport;
}

// Canal complet. Fermé, il refuse sans effet de bord. Ouvert, il exige un
// secret de signature et un transport : sans eux, l'ouverture échoue au lieu
// de laisser croire que le canal fonctionne.
export function createNewsletterChannel(environment = {}, { transport = null, seen = new Set(), now = () => Date.now() } = {}) {
  if (!newsletterEnabled(environment)) {
    return {
      enabled: false,
      async request() { return { ok: false, reason: 'newsletter_disabled' }; },
      async confirm() { return { ok: false, reason: 'newsletter_disabled' }; },
      async revoke() { return { ok: false, reason: 'newsletter_disabled' }; }
    };
  }
  const secret = String(environment.NEWSLETTER_TOKEN_SECRET ?? '');
  if (secret.length < 32) throw new Error('Canal lettre de veille : secret de signature absent');
  assertSubscriberTransport(transport);

  return {
    enabled: true,
    async request(email) {
      const token = await createConfirmationToken(email, secret, { now: now() });
      await transport.sendConfirmation(String(email).trim().toLowerCase(), token);
      return { ok: true, step: 'CONFIRM_SENT' };
    },
    async confirm(token) {
      const verified = await verifyConfirmationToken(token, secret, { now: now(), seen });
      if (!verified.ok) return { ok: false, reason: verified.reason };
      await transport.subscribe(verified.email);
      return { ok: true, step: 'CONFIRMED', email: verified.email };
    },
    async revoke(email) {
      await transport.unsubscribe?.(String(email).trim().toLowerCase());
      return { ok: true, step: 'REVOKED' };
    }
  };
}
