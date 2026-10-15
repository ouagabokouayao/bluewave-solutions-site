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
    await p.fill(`${f} [name=firstname]`, 'Awa'); await p.fill(`${f} [name=lastname]`, 'Koné');
    await p.fill(`${f} [name=email]`, 'awa@example.invalid');
    await c.fill(p, f);
    await p.check(`${f} [name=privacy_acknowledged]`);
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
    assert.match(await p.textContent(`${f} [data-form-message]`), /transmission automatique est désactivée/);
    assert.equal(await p.locator(`${f} [data-mail-copy]`).count(), 1, 'message copiable dupliqué');
    assert.deepEqual(api, [], 'appel API alors que la transmission est fermée');
    console.log(`ok - ${label}`);
  } catch (error) {
    failures++; console.log(`not ok - ${label}: ${error.message}`);
  }
  await ctx.close();
}
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
