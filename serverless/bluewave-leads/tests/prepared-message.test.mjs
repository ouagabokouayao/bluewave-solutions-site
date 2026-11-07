// Le message préparé affiché dans la page est la copie intégrale du courriel :
// il ne dépend d'aucune limite de longueur d'un lien mailto.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fallbackMailBody, preparedMessage} from '../../../assets/js/journey-form.js';

test('Message préparé : intégral même au-delà de la limite d’un lien mailto', () => {
  const evidence = 'Études d’érosion côtière et gouvernance littorale. '.repeat(24).slice(0, 1200);
  const motivation = 'Contribuer aux diagnostics et à la concertation. '.repeat(18).slice(0, 800);
  const lines = fallbackMailBody({firstname: 'Awa', lastname: 'Koné', email: 'awa@example.invalid',
    professional_status: 'consultant', expertise_domains: ['littoral-adaptation'],
    expertise_evidence: evidence, motivation});
  const message = preparedMessage('BlueWave — proposition d’expertise', lines);
  const mailto = `mailto:bluewavesolutions3399@gmail.com?body=${encodeURIComponent(lines)}`;
  assert.ok(mailto.length > 2000, 'le cas testé dépasse bien la limite courante d’un lien mailto');
  for (const text of [evidence, motivation, 'Statut professionnel : consultant',
    'À : bluewavesolutions3399@gmail.com', 'Objet : BlueWave — proposition d’expertise']) {
    assert.ok(message.includes(text));
  }
});
