// E2E DOI isolé : le canal réel, sur une table de test et des adresses .invalid.
// Aucun fournisseur réel ni drapeau public n'y est raccordé.
import {NEWSLETTER_PREFERENCES, createNewsletterChannel} from '../bluewave-leads/newsletter.mjs';
export const TEST_PREFERENCES = NEWSLETTER_PREFERENCES;
export function createNewsletterTestChannel({database, transport, secret, testOnly = false, now = () => Date.now()} = {}) {
  if (!testOnly || transport?.testOnly !== true) throw new Error('Environnement et transport de test explicites requis');
  if (!database || String(secret).length < 32) throw new Error('Stockage/transport de test incomplet');
  return createNewsletterChannel({NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: secret}, {
    database, transport, now, table: 'newsletter_test_consents',
    checkAddress(address) { if (!address.endsWith('.invalid')) throw new Error('Adresse synthétique .invalid requise'); }
  });
}
