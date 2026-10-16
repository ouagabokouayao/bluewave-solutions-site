// Chaîne Turnstile côté navigateur, inerte tant que le service est fermé.
//
// Fermé : rien n'est chargé, aucun élément n'est créé, aucune requête n'est
// émise, et les formulaires transmettent un jeton vide comme aujourd'hui.
// Ouvert : le script officiel est chargé une seule fois, un widget est rendu
// par formulaire, et le jeton obtenu est injecté dans captcha_token.
//
// Seule la clé publique (site key) circule ici. La clé secrète reste côté
// serveur et n'a aucune raison d'exister dans ce fichier ni dans le build.

const API_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const widgets = new WeakMap();
let apiPromise = null;

function readConfig(config) {
  const turnstile = config?.turnstile;
  if (!turnstile || turnstile.enabled !== true) return null;
  const siteKey = typeof turnstile.site_key === 'string' ? turnstile.site_key.trim() : '';
  // Activation annoncée sans clé publique : on ne bricole pas un contournement
  // silencieux, le formulaire échouera visiblement côté serveur.
  if (!siteKey) return null;
  return { siteKey };
}

function loadApi(doc) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(globalThis.turnstile ?? null));
    script.addEventListener('error', () => reject(new Error('Turnstile indisponible')));
    doc.head.append(script);
  });
  return apiPromise;
}

// Le conteneur est créé par le script : aucune page n'a à le prévoir, et rien
// n'apparaît lorsque le service est fermé.
function container(form, doc) {
  let host = form.querySelector('[data-turnstile-host]');
  if (host) return host;
  host = doc.createElement('div');
  host.dataset.turnstileHost = '';
  host.className = 'turnstile-host';
  const submit = form.querySelector('button[type="submit"]');
  if (submit?.parentNode) submit.parentNode.insertBefore(host, submit);
  else form.append(host);
  return host;
}

export function createTurnstile({ config, doc = globalThis.document, api = null } = {}) {
  const settings = readConfig(config);
  if (!settings) {
    // Contrat identique pour les formulaires, quel que soit l'état du service.
    return { enabled: false, async token() { return ''; }, reset() {}, async prepare() {} };
  }

  const widgetApi = async () => api ?? (await loadApi(doc)) ?? globalThis.turnstile;

  const render = async form => {
    if (widgets.has(form)) return widgets.get(form);
    const instance = await widgetApi();
    if (!instance?.render) throw new Error('Turnstile indisponible');
    const id = instance.render(container(form, doc), {
      sitekey: settings.siteKey,
      // Le défi n'est présenté que si le service le juge nécessaire ; le
      // formulaire reste utilisable au clavier et ne bouge pas sous le curseur.
      appearance: 'interaction-only',
      retry: 'never'
    });
    widgets.set(form, id);
    return id;
  };

  return {
    enabled: true,
    // Rendu anticipé : le jeton est prêt avant que la personne ne valide.
    async prepare(form) { try { await render(form); } catch { /* l'échec est traité à la soumission */ } },
    async token(form) {
      const instance = await widgetApi();
      const id = await render(form);
      const existing = instance.getResponse?.(id);
      if (existing) return existing;
      // Jeton absent ou déjà consommé : on repart d'un défi neuf plutôt que
      // de renvoyer une valeur périmée que le serveur refuserait.
      instance.reset?.(id);
      return instance.getResponse?.(id) || '';
    },
    reset(form) {
      const id = widgets.get(form);
      if (id === undefined) return;
      Promise.resolve(widgetApi()).then(instance => instance?.reset?.(id)).catch(() => {});
    }
  };
}

export { API_URL };
