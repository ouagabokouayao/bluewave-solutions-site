// Vérification Cloudflare Turnstile, préparée mais non activée.
//
// Tant que TURNSTILE_ENABLED ne vaut pas 'true', aucun vérificateur n'est
// construit et aucun appel réseau n'a lieu. La clé secrète reste un secret de
// runtime : elle n'est jamais versionnée, jamais renvoyée au navigateur, jamais
// journalisée. Le jeton reçu du navigateur n'est ni stocké ni journalisé.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;

export function turnstileEnabled(environment = {}) {
  return environment.TURNSTILE_ENABLED === 'true';
}

// Retourne null lorsque Turnstile est désactivé : le pipeline saute l'étape.
// Lève lorsque l'activation est demandée sans secret, pour qu'une
// configuration incomplète échoue visiblement au lieu de laisser passer.
export function createTurnstileVerifier(environment = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!turnstileEnabled(environment)) return null;
  const secret = String(environment.TURNSTILE_SECRET_KEY ?? '').trim();
  if (!secret) throw new Error('Turnstile activé sans clé secrète');
  if (typeof fetchImpl !== 'function') throw new Error('Client HTTP indisponible');

  return async function verify(token, request) {
    const candidate = typeof token === 'string' ? token.trim() : '';
    if (!candidate || candidate.length > 2048) return false;
    const body = new URLSearchParams({ secret, response: candidate });
    // L'adresse fournie par la plateforme est transmise au service de
    // vérification, jamais conservée de notre côté.
    const address = request?.headers?.get?.('cf-connecting-ip');
    if (address) body.set('remoteip', address);
    try {
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) return false;
      const result = await response.json();
      return result?.success === true;
    } catch {
      // Expiration, réponse illisible ou service indisponible : refus
      // générique. Le détail amont ne remonte jamais au navigateur.
      return false;
    }
  };
}

export { SITEVERIFY_URL, TIMEOUT_MS };
