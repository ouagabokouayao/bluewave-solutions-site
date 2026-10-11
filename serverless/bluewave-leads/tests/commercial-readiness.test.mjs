import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {hasCanonicalOffer} from '../../../assets/js/lead-schema.js';

test('Commercial readiness: five complete offers, two entry formats, seven training modules', async () => {
  const root = new URL('../../../', import.meta.url);
  const solutions = await readFile(new URL('solutions.html', root), 'utf8');
  const formation = await readFile(new URL('formation.html', root), 'utf8');
  const cards = solutions.match(/<article class="solution-card"[\s\S]*?<\/article>/g) || [];
  assert.equal(cards.length, 5);
  assert.equal((solutions.match(/<article class="format-card"/g) || []).length, 2);
  for (const card of cards) {
    for (const label of ['Problème client', 'Intervention BlueWave', 'Méthode', 'Livrable', 'Bénéfice décisionnel']) assert.ok(card.includes(`<strong>${label} :</strong>`));
    assert.match(card, /<a href="[^\"]+\?offre=/);
  }
  const titles = ['Gouvernance maritime et littorale', 'Droit de la mer pour non-juristes', 'Acteurs, usages, tensions et acceptabilité', 'Concertation, négociation et médiation multi-acteurs', 'Structurer un projet maritime / littoral / économie bleue', 'Vulnérabilité côtière et adaptation pour décideurs', 'Économie bleue : du concept au projet territorial'];
  assert.equal((formation.match(/id="formation-f\d"/g) || []).length, 7);
  titles.forEach((title, i) => assert.ok(formation.includes(`id="formation-f${i + 1}"`) && formation.includes(`<h3>${title}</h3>`)));
  assert.equal((formation.match(/href="#demande-formation"/g) || []).length, 7);
  assert.ok(formation.indexOf('id="modules-formation"') < formation.indexOf('id="demande-formation"'));
  assert.match(formation, /name="training_subject"/);
  for (const slug of ['diagnostic-strategique', 'vulnerabilite-cotiere', 'gouvernance-acteurs', 'structuration-projet', 'formation-capacites', 'note-strategique', 'atelier-cadrage']) {
    assert.equal(hasCanonicalOffer(new URLSearchParams(`offre=${slug}`).get('offre')), true);
    assert.ok(solutions.includes(`?offre=${slug}`));
  }
  for (const page of [solutions, formation]) {
    assert.match(page, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(page, /(?:\d[\d\s.,]*\s*(?:€|EUR)|prix\s*:\s*\d)/i);
  }
});
