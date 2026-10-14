import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../../assets/js/actualites.js', import.meta.url), 'utf8');
const now = Date.parse('2026-10-14T17:22:12Z');
class CaptureDate extends Date {static now() {return now;}}

async function render(status) {
  const targets = [{textContent: '', title: ''}, {textContent: '', title: ''}];
  const document = {
    querySelectorAll(selector) {return selector === '[data-news-status]' ? targets : [];},
    querySelector() {return null;}
  };
  runInNewContext(source, {
    document, Date: CaptureDate, Intl,
    fetch: async url => ({ok: true, json: async () => url.endsWith('actualites-status.json') ? status : {items: []}})
  });
  await new Promise(setImmediate);
  assert.equal(targets[0].textContent, targets[1].textContent);
  assert.doesNotMatch(targets[0].textContent, /en cours/i);
  return targets[0];
}

test('stale corpus displays the actual last update, without claiming a running job', async () => {
  const result = await render({state: 'ok', generated_at: '2026-09-20T16:22:11Z', last_successful_at: '2026-09-20T16:22:11Z'});
  assert.equal(result.textContent, 'Actualisation nécessaire. Dernière mise à jour : 20 septembre 2026.');
});
test('recent successful collection displays its date', async () => {
  const result = await render({state: 'ok', generated_at: '2026-10-14T12:00:00Z'});
  assert.equal(result.textContent, 'Veille actualisée. Dernière mise à jour : 14 octobre 2026.');
});
test('cache revalidation does not replace the last collection date', async () => {
  const result = await render({state: 'cached', generated_at: '2026-10-14T12:00:00Z', last_successful_at: '2026-09-20T16:22:11Z'});
  assert.match(result.textContent, /sans nouvelle collecte distante/);
  assert.match(result.textContent, /Dernière mise à jour : 20 septembre 2026/);
  assert.match(result.textContent, /Revalidation du corpus : 14 octobre 2026/);
  assert.equal(result.title, 'Dernière collecte réussie : 20 septembre 2026');
});
test('source errors retain the date of the previous successful collection', async () => {
  const result = await render({state: 'error', generated_at: '2026-10-14T12:00:00Z', last_successful_at: '2026-09-20T16:22:11Z'});
  assert.match(result.textContent, /Sources momentanément indisponibles/);
  assert.match(result.textContent, /Dernière mise à jour : 20 septembre 2026/);
});
test('partial collection remains explicitly partial', async () => {
  const result = await render({state: 'partial', generated_at: '2026-10-14T12:00:00Z'});
  assert.match(result.textContent, /^Veille partiellement actualisée/);
  assert.match(result.textContent, /14 octobre 2026/);
});
test('invalid or missing timestamps never create a false update date', async () => {
  for (const value of [null, '', 'invalid', undefined]) {
    const result = await render({state: 'ok', generated_at: value});
    assert.match(result.textContent, /Date de dernière mise à jour indisponible/);
    assert.doesNotMatch(result.textContent, /1970|Invalid/);
    assert.equal(result.title, '');
  }
});
test('unknown state and a cache without collection metadata remain explicit', async () => {
  assert.match((await render({state: 'unknown', message: 'Actualisation en cours.'})).textContent, /État de la veille non renseigné/);
  const cached = await render({state: 'cached', generated_at: '2026-10-14T12:00:00Z'});
  assert.match(cached.textContent, /Date de dernière mise à jour indisponible/);
  assert.match(cached.textContent, /Revalidation du corpus : 14 octobre 2026/);
});
