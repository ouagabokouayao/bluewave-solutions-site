export function shouldRenderTrust(config) {
  return Boolean(config?.enabled === true && Array.isArray(config.items) && config.items.length > 0);
}

export async function prepareTrust(root, fetchImpl = globalThis.fetch) {
  if (!root) return false;
  root.hidden = true;
  root.replaceChildren();
  try {
    const response = await fetchImpl('data/trust-config.json', {cache: 'no-store'});
    if (!response.ok) return false;
    const config = await response.json();
    if (!shouldRenderTrust(config)) return false;
    // Le rendu futur exigera aussi une validation des huit champs documentés.
    // Aucun contenu n'est fabriqué par défaut.
    return false;
  } catch {
    return false;
  }
}

if (typeof document !== 'undefined') prepareTrust(document.querySelector('[data-trust-root]'));
