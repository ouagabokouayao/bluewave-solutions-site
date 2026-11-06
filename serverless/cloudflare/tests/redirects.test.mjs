import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const assets = () => {
  const seen = [];
  return {seen, fetch: async request => { seen.push(new URL(request.url).pathname); return new Response('page', {status: 200}); }};
};

for (const [from, to] of [['/contact.html', '/qualifier-un-besoin.html'], ['/domaines.html', '/solutions.html'],
  ['/services.html', '/solutions.html'], ['/notes-demonstrateurs.html', '/preuves-demonstrateurs.html']]) {
  test(`ancienne adresse ${from} : redirection permanente`, async () => {
    const ASSETS = assets();
    const response = await worker.fetch(new Request(`https://www.bluewavesolutions.fr${from}?offre=note-strategique`), {ASSETS});
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `https://www.bluewavesolutions.fr${to}?offre=note-strategique`);
    assert.deepEqual(ASSETS.seen, []);
  });
}

test('les autres pages restent servies, la racine sert l’accueil', async () => {
  const ASSETS = assets();
  for (const path of ['/solutions.html', '/']) {
    assert.equal((await worker.fetch(new Request(`https://www.bluewavesolutions.fr${path}`), {ASSETS})).status, 200);
  }
  assert.deepEqual(ASSETS.seen, ['/solutions.html', '/index.html']);
});

test('un nom d’attribut JavaScript n’est pas pris pour une ancienne adresse', async () => {
  const ASSETS = assets();
  const response = await worker.fetch(new Request('https://www.bluewavesolutions.fr/constructor'), {ASSETS});
  assert.equal(response.status, 200);
});
