// Chaîne Turnstile côté navigateur. Le module ne dépend que d'un document et
// d'une API injectable : il est donc testable sans navigateur réel.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createTurnstile, API_URL } from '../../../assets/js/turnstile.js';

function fakeDocument() {
  const appended = [];
  const make = () => {
    const element = {
      dataset: {}, className: '', children: [], attributes: {},
      append(child) { this.children.push(child); },
      insertBefore(child) { this.children.push(child); },
      querySelector() { return null; },
      addEventListener() {},
      set src(value) { this.attributes.src = value; },
      get src() { return this.attributes.src; }
    };
    return element;
  };
  return {
    appended,
    head: { append(node) { appended.push(node); } },
    createElement: () => make()
  };
}

function fakeForm(doc) {
  const host = null;
  return {
    _host: host,
    children: [],
    querySelector(selector) {
      if (selector === '[data-turnstile-host]') return this._found ?? null;
      if (selector === 'button[type="submit"]') return { parentNode: { insertBefore: (node) => { this._found = node; } } };
      return null;
    },
    append(node) { this._found = node; }
  };
}

function fakeApi() {
  const state = { rendered: 0, resets: 0, response: 'jeton-emis' };
  return {
    state,
    render() { state.rendered += 1; return `widget-${state.rendered}`; },
    getResponse() { return state.response; },
    reset() { state.resets += 1; state.response = 'jeton-renouvele'; }
  };
}

test('fermé : rien n’est chargé, aucun jeton, aucun élément créé', async () => {
  const doc = fakeDocument();
  const guard = createTurnstile({ config: { turnstile: { enabled: false, site_key: null } }, doc });
  assert.equal(guard.enabled, false);
  assert.equal(await guard.token(fakeForm(doc)), '');
  await guard.prepare(fakeForm(doc));
  guard.reset(fakeForm(doc));
  assert.equal(doc.appended.length, 0, 'aucun script injecté');
});

test('configuration absente ou site key manquante : canal fermé, pas de bricolage', async () => {
  const doc = fakeDocument();
  for (const config of [{}, { turnstile: null }, { turnstile: { enabled: true, site_key: '' } }, { turnstile: { enabled: true } }]) {
    const guard = createTurnstile({ config, doc });
    assert.equal(guard.enabled, false);
    assert.equal(await guard.token(fakeForm(doc)), '');
  }
  assert.equal(doc.appended.length, 0);
});

test('ouvert : le widget est rendu une fois par formulaire et rend un jeton', async () => {
  const doc = fakeDocument();
  const api = fakeApi();
  const guard = createTurnstile({ config: { turnstile: { enabled: true, site_key: '0x4AAAAAAATest' } }, doc, api });
  assert.equal(guard.enabled, true);
  const form = fakeForm(doc);
  assert.equal(await guard.token(form), 'jeton-emis');
  assert.equal(await guard.token(form), 'jeton-emis');
  assert.equal(api.state.rendered, 1, 'un seul rendu par formulaire');
});

test('jeton consommé : le défi est réarmé plutôt que de renvoyer une valeur périmée', async () => {
  const doc = fakeDocument();
  const api = fakeApi();
  const guard = createTurnstile({ config: { turnstile: { enabled: true, site_key: '0x4AAAAAAATest' } }, doc, api });
  const form = fakeForm(doc);
  await guard.token(form);
  api.state.response = '';
  assert.equal(await guard.token(form), 'jeton-renouvele');
  assert.equal(api.state.resets, 1);
});

test('réinitialisation explicite après une tentative', async () => {
  const doc = fakeDocument();
  const api = fakeApi();
  const guard = createTurnstile({ config: { turnstile: { enabled: true, site_key: '0x4AAAAAAATest' } }, doc, api });
  const form = fakeForm(doc);
  await guard.token(form);
  guard.reset(form);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(api.state.resets, 1);
});

test('aucune clé secrète n’est manipulée côté navigateur', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../../../assets/js/turnstile.js', import.meta.url), 'utf8');
  for (const forbidden of ['TURNSTILE_SECRET_KEY', 'siteverify', 'secret:']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.ok(source.includes(API_URL.split('?')[0]));
});
