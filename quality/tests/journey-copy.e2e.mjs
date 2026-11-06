// Non-régression navigateur du message copiable (02-E4).
// Les trois formulaires de parcours, servis depuis le build public, avec la
// transmission automatique fermée : soumission, message intégral copiable,
// modification qui masque le message, nouvelle soumission acceptée.
// Le message copiable ne doit jamais entrer dans la demande : s'il le faisait,
// le schéma refuserait la seconde soumission.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import assert from 'node:assert/strict';

const ROOT = normalize(process.argv[2] || 'dist');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2'};
const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const LONG = 'Études d’érosion côtière et gouvernance littorale en Méditerranée et en Côte d’Ivoire. '.repeat(14).slice(0, 1150).trim();
const CASES = [
  {page: 'collaboration.html', choose: 'organisation', form: '#collaboration-organisation', fill: async (p, f) => {
    await p.fill(`${f} [name=organisation]`, 'Organisation test');
    await p.selectOption(`${f} [name=organisation_type]`, 'ong');
    await p.selectOption(`${f} [name=territory]`, 'france-mediterranee');
    await p.fill(`${f} [name=collaboration_subject]`, 'Objet test');
    await p.check(`${f} [name=domains][value=littoral-adaptation]`);
    await p.fill(`${f} [name=collaboration_expectation]`, LONG);
  }},
  {page: 'collaboration.html', choose: 'expertise', form: '#collaboration-expertise', fill: async (p, f) => {
    await p.selectOption(`${f} [name=territory]`, 'cote-divoire');
    await p.selectOption(`${f} [name=professional_status]`, 'consultant');
    await p.selectOption(`${f} [name=availability]`, 'ponctuelle');
    await p.check(`${f} [name=expertise_domains][value=gouvernance-maritime]`);
    await p.check(`${f} [name=intervention_types][value=cartographie]`);
    await p.check(`${f} [name=work_languages][value=francais]`);
    await p.fill(`${f} [name=expertise_evidence]`, LONG);
    await p.fill(`${f} [name=motivation]`, 'Contribuer aux diagnostics.');
  }},
  {page: 'formation.html', form: 'form[data-lead-type="formation"]', fill: async (p, f) => {
    await p.fill(`${f} [name=organisation]`, 'Organisation test');
    await p.fill(`${f} [name=audience]`, 'Agents');
    await p.fill(`${f} [name=training_subject]`, 'Gouvernance littorale');
    await p.fill(`${f} [name=learning_objectives]`, LONG);
    await p.selectOption(`${f} [name=training_format]`, 'distance');
    await p.fill(`${f} [name=period]`, 'Novembre');
  }}
];

// Les codes techniques des listes ne doivent jamais atteindre le courriel.
const INTERNAL_CODES = /\b(france-mediterranee|cote-divoire|afrique-ouest|projet-mission|collaboration-organisation|expertise-offer|presentiel|gouvernance-maritime|littoral-adaptation)\b|: (email|ong|consultant|ponctuelle|distance|francais|cartographie)$/m;

const browser = await chromium.launch();
let failures = 0;
for (const c of CASES) {
  const label = `${c.page}${c.choose ? `#${c.choose}` : ''}`;
  const ctx = await browser.newContext({viewport: {width: 390, height: 900}});
  const p = await ctx.newPage();
  const api = []; p.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
  try {
    await p.goto(`${base}/${c.page}`, {waitUntil: 'networkidle'});
    if (c.choose) await p.check(`input[value="${c.choose}"]`);
    const f = c.form;
    // Soumission vide : le refus reste lisible et rien ne part dans l'URL.
    await p.click(`${f} button[type=submit]`);
    assert.match(await p.textContent(`${f} [data-form-message]`), /Vérifiez les champs signalés/);
    assert.ok(await p.locator(`${f} [aria-invalid="true"]`).count() > 0, 'champ refusé non signalé');
    await p.fill(`${f} [name=firstname]`, 'Awa'); await p.fill(`${f} [name=lastname]`, 'Koné');
    await p.fill(`${f} [name=email]`, 'awa@example.invalid');
    await c.fill(p, f);
    await p.check(`${f} [name=privacy_acknowledged]`);
    // La touche Entrée passe par la même interception que le bouton.
    await p.focus(`${f} [name=email]`);
    await p.keyboard.press('Enter');
    await p.waitForSelector(`${f} [data-mail-copy]:not([hidden])`, {timeout: 5000});
    assert.equal(new URL(p.url()).search, '', 'données saisies dans l’URL après Entrée');
    await p.fill(`${f} [name=firstname]`, 'Awa');
    await p.click(`${f} button[type=submit]`);
    await p.waitForSelector(`${f} [data-mail-copy]:not([hidden])`, {timeout: 5000});
    const message = await p.inputValue(`${f} [data-mail-copy] textarea`);
    assert.ok(message.includes(LONG), 'message copiable incomplet');
    assert.ok(message.includes('À : bluewavesolutions3399@gmail.com'), 'destinataire absent');
    assert.equal(await p.getAttribute(`${f} [data-mail-copy] textarea`, 'name'), null, 'le message copiable porte un name');
    assert.ok(!(await p.isHidden(`${f} [data-mail-fallback]`)), 'lien courriel masqué');
    await p.fill(`${f} [name=lastname]`, 'Koné-Traoré');
    assert.ok(await p.isHidden(`${f} [data-mail-copy]`), 'message périmé encore affiché après modification');
    await p.click(`${f} button[type=submit]`);
    await p.waitForSelector(`${f} [data-mail-copy]:not([hidden])`, {timeout: 5000});
    assert.ok((await p.inputValue(`${f} [data-mail-copy] textarea`)).includes('Koné-Traoré'), 'seconde soumission non prise en compte');
    assert.match(await p.textContent(`${f} [data-form-message]`), /n’a pas été envoyé/);
    assert.doesNotMatch(await p.inputValue(`${f} [data-mail-copy] textarea`), INTERNAL_CODES, 'code interne dans le courriel préparé');
    assert.equal(await p.locator(`${f} [data-mail-copy]`).count(), 1, 'message copiable dupliqué');
    assert.deepEqual(api, [], 'appel API alors que la transmission est fermée');
    console.log(`ok - ${label}`);
  } catch (error) {
    failures++; console.log(`not ok - ${label}: ${error.message}`);
  }
  await ctx.close();
}
// Parcours Projet (Qualifier) : sept réponses, puis demande préparée.
{
  const ctx = await browser.newContext({viewport: {width: 390, height: 900}});
  const p = await ctx.newPage();
  const api = []; p.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
  try {
    await p.goto(`${base}/qualifier-un-besoin.html?parcours=projet`, {waitUntil: 'networkidle'});
    const steps = ['organisation', 'territoire', 'problematique', 'stade', 'delai', 'donnees', 'resultat'];
    const chosen = {};
    for (const [i, n] of steps.entries()) {
      const sel = p.locator(`#qualifier-form [name="${n}"]`).first();
      const opts = await sel.evaluate(s => [...s.options].filter(o => o.value).map(o => [o.value, o.textContent.trim()]));
      await sel.selectOption(opts[1]?.[0] || opts[0][0]); chosen[n] = (opts[1] || opts[0])[1];
      await p.click(i < steps.length - 1 ? '#next' : '#submit-qualifier');
    }
    await p.waitForSelector('#qualifier-result:not([hidden])', {timeout: 5000});
    assert.ok(await p.isHidden('label[for="lead-newsletter"]'), 'case newsletter affichée alors que la lettre est fermée');
    const f = '#lead-form';
    assert.doesNotMatch(await p.textContent('#result-confirm'), /^À confirmer/, 'préfixe répété sous le titre');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'result-title', 'foyer non placé sur le résultat');
    await p.click('#lead-submit');
    assert.match(await p.textContent('#lead-message'), /Vérifiez les champs signalés/);
    assert.ok(await p.locator(`${f} [aria-invalid="true"]`).count() > 0, 'champ refusé non signalé');
    await p.fill(`${f} [name=firstname]`, 'Awa'); await p.fill(`${f} [name=lastname]`, 'Koné');
    await p.fill(`${f} [name=organisation_name]`, 'Commune test'); await p.fill(`${f} [name=role]`, 'Chargée de mission');
    await p.fill(`${f} [name=email]`, 'awa@example.invalid'); await p.fill(`${f} [name=description]`, LONG);
    await p.check(`${f} [name=consent]`);
    await p.focus(`${f} [name=email]`); await p.keyboard.press('Enter');
    await p.waitForSelector(`${f} [data-mail-copy]:not([hidden])`, {timeout: 5000});
    assert.equal(new URL(p.url()).search, '?parcours=projet', 'données saisies dans l’URL après Entrée');
    const message = await p.inputValue(`${f} [data-mail-copy] textarea`);
    for (const text of [LONG, 'Fonction : Chargée de mission', ...Object.values(chosen)]) assert.ok(message.includes(text), `réponse absente : ${text.slice(0, 40)}`);
    assert.doesNotMatch(message, INTERNAL_CODES, 'code interne dans le courriel préparé');
    assert.match(await p.textContent('#lead-message'), /n’a pas été envoyé/);
    assert.equal((await p.textContent('#result-mail')).trim(), 'Ouvrir le courriel préparé');
    assert.equal(await p.getAttribute(`${f} [data-mail-copy] textarea`, 'name'), null, 'le message copiable porte un name');
    await p.fill(`${f} [name=lastname]`, 'Koné-Traoré');
    assert.ok(await p.isHidden(`${f} [data-mail-copy]`), 'message périmé encore affiché après modification');
    assert.equal((await p.textContent('#lead-message')).trim(), '', 'statut périmé encore affiché');
    assert.equal((await p.textContent('#result-mail')).trim(), 'Utiliser directement ma messagerie');
    await p.click('#lead-submit');
    await p.waitForSelector(`${f} [data-mail-copy]:not([hidden])`, {timeout: 5000});
    assert.ok((await p.inputValue(`${f} [data-mail-copy] textarea`)).includes('Koné-Traoré'), 'seconde soumission non prise en compte');
    assert.equal(await p.locator(`${f} [data-mail-copy]`).count(), 1, 'message copiable dupliqué');
    assert.deepEqual(api, [], 'appel API alors que la transmission est fermée');
    console.log('ok - qualifier-un-besoin.html#projet');
  } catch (error) {
    failures++; console.log(`not ok - qualifier-un-besoin.html#projet: ${error.message}`);
  }
  await ctx.close();
}
// L'offre d'arrivée est nommée pour le visiteur, jamais par son code.
{
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}});
  const p = await ctx.newPage();
  try {
    await p.goto(`${base}/formation.html?offre=formation-capacites`, {waitUntil: 'networkidle'});
    assert.equal((await p.textContent('[data-source-offer]')).trim(), 'Offre présélectionnée : Formation et renforcement des capacités.');
    await p.goto(`${base}/projet.html?offre=note-strategique`, {waitUntil: 'networkidle'});
    assert.equal((await p.textContent('[data-source-offer]')).trim(), 'Offre présélectionnée : Note stratégique BlueWave.');
    console.log('ok - offre présélectionnée nommée');
  } catch (error) {
    failures++; console.log(`not ok - offre présélectionnée: ${error.message}`);
  }
  await ctx.close();
}
// Régression P0 : le réseau n'est jamais un repli de soumission native.
const safeCases = [
  ['formation.html', 'form[data-lead-form]', 'journey-form.js'],
  ['collaboration.html', 'form[data-lead-form]', 'journey-form.js'],
  ['qualifier-un-besoin.html', 'form', 'qualifier.js'],
  ['actualites.html', 'form', 'automation.js']
];
for (const mode of ['sans JavaScript', 'script bloqué']) {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, javaScriptEnabled: mode !== 'sans JavaScript'});
  const p = await ctx.newPage();
  p.setDefaultTimeout(5000);
  const unexpected = [];
  let blocked;
  await p.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.size || url.pathname.startsWith('/api/')) {
      unexpected.push(request.method() + ' ' + url.pathname);
      return route.abort();
    }
    if (url.origin !== base || (mode === 'script bloqué' && url.pathname.endsWith('/' + blocked))) return route.abort();
    return route.continue();
  });
  for (const [name, selector, script] of safeCases) {
    try {
      blocked = script;
      unexpected.length = 0;
      const url = `${base}/${name}`;
      await p.goto(url, {waitUntil: 'load'});
      const forms = p.locator(selector);
      if (name === 'actualites.html') {
        assert.equal(await forms.count(), 0, 'la veille fermée ne doit rendre aucun formulaire');
      } else {
        assert.ok(await forms.count() > 0);
        assert.equal(await forms.locator('input[type=email]').count(), name === 'collaboration.html' ? 2 : 1);
        assert.equal(await p.locator('main a[href^="mailto:"]').first().isVisible(), true, 'contact de secours absent');
        for (const f of await forms.all()) {
          assert.notEqual(await f.getAttribute('inert'), null, 'formulaire non verrouillé dans le HTML');
          const control = f.locator('input[type=email], select').first();
          assert.equal(await control.evaluate(e => { e.focus(); return document.activeElement === e; }), false);
          await p.keyboard.press('Enter');
        }
        if (mode === 'script bloqué') {
          // Un essai natif par page : Chromium laisse une navigation annulée
          // en attente après le signal CSP. Tous les formulaires de la page
          // sont déjà vérifiés inertes ci-dessus.
          const target = forms.filter({has: p.locator('input[type=email]')}).first();
          const directive = await target.evaluate(form => new Promise(resolve => {
            const timeout = setTimeout(() => resolve(null), 2000);
            document.addEventListener('securitypolicyviolation', e => {
              clearTimeout(timeout);
              resolve(e.effectiveDirective);
            }, {once:true});
            form.querySelector('input[type=email]').value = 'synthetique@example.invalid';
            HTMLFormElement.prototype.submit.call(form);
          }));
          assert.equal(directive, 'form-action');
        }
      }
      assert.equal(p.url(), url, 'navigation inattendue');
      assert.deepEqual(unexpected, [], 'soumission native arrivée sur le réseau');
      console.log(`ok - ${name} / ${mode} / mobile`);
    } catch (error) {
      failures++; console.log(`not ok - ${name} / ${mode}: ${error.message}`);
    }
  }
  await ctx.close();
}
// JavaScript réellement coupé : seul ce réglage du moteur fait rendre <noscript>.
{
  const noScript = await chromium.launch({args: ['--blink-settings=scriptEnabled=false']});
  const p = await (await noScript.newContext({viewport: {width: 390, height: 844}})).newPage();
  for (const name of ['formation.html', 'collaboration.html', 'qualifier-un-besoin.html']) {
    try {
      await p.goto(`${base}/${name}`, {waitUntil: 'load'});
      // Aucun script ne peut s'exécuter, pas même ceux de Playwright : la page
      // est lue dans l'arbre d'accessibilité, comme par une technologie d'assistance.
      const cdp = await p.context().newCDPSession(p);
      const {nodes} = await cdp.send('Accessibility.getFullAXTree');
      const exposed = nodes.filter(node => !node.ignored);
      const text = exposed.map(node => node.name?.value || '').join(' | ');
      assert.match(text, /JavaScript est désactivé/, 'explication absente');
      assert.ok(exposed.some(node => node.role?.value === 'link' && node.name?.value === 'bluewavesolutions3399@gmail.com'), 'contact direct absent');
      const fields = exposed.filter(node => ['textbox', 'combobox', 'checkbox', 'radio', 'ComboBoxMenuButton'].includes(node.role?.value));
      assert.deepEqual(fields.map(node => node.name?.value), [], 'champ inutilisable exposé');
      await cdp.detach();
      console.log(`ok - ${name} / noscript réel`);
    } catch (error) {
      failures++; console.log(`not ok - ${name} / noscript réel: ${error.message}`);
    }
  }
  await noScript.close();
}
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
