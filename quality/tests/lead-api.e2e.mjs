// Intégration de bout en bout : les vrais formulaires, dans un vrai navigateur,
// envoient leurs données au vrai Worker. D1 et Brevo sont simulés : aucun
// service réel n'est contacté, toute autre sortie réseau fait échouer le test.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import assert from 'node:assert/strict';
import worker from '../../serverless/cloudflare/worker.mjs';
import {createD1Double} from '../../serverless/bluewave-leads/tests/d1-double.mjs';

const ROOT = normalize(process.argv[2] || 'dist-production');
const ORIGIN = 'https://bluewave.test';
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain'};
const SUCCESS = /a bien été transmise/;
const UNKNOWN = /peut-être bien été transmise/;
const REFUSED = /n’a pas été enregistrée/;

const brevo = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.brevo.com/')) throw new Error(`Sortie réseau interdite : ${url}`);
  brevo.push({path: new URL(url).pathname, body: JSON.parse(init.body)});
  return new Response('{}', {status: 201});
};
const assets = {fetch: async request => {
  const path = new URL(request.url).pathname;
  try { return new Response(await readFile(join(ROOT, path)), {status: 200, headers: {'content-type': TYPES[extname(path)] || 'application/octet-stream'}}); }
  catch { return new Response('introuvable', {status: 404}); }
}};
const guard = {idFromName: name => name, get: () => ({fetch: async () => Response.json({ok: true})})};
const environment = database => ({ASSETS: assets, LEADS_DB: database, LEAD_GUARD: guard, GUARD_HMAC_KEY: 'c'.repeat(40),
  LEADS_ENABLED: 'true', LEAD_RETENTION_DAYS: '30', EVENTS_ENABLED: 'false', TURNSTILE_ENABLED: 'false', NEWSLETTER_ENABLED: 'false',
  LEADS_ACK_ENABLED: 'true', LEADS_NOTIFY_ENABLED: 'true',
  BREVO_API_KEY: 'cle-synthetique', BREVO_LEADS_LIST_ID: '11', BREVO_ACK_TEMPLATE_ID: '12', BREVO_INTERNAL_TEMPLATE_ID: '13',
  BLUEWAVE_INTERNAL_EMAIL: 'interne@example.invalid', ALLOWED_ORIGIN: ORIGIN, BLUEWAVE_SITE_URL: ORIGIN});

const browser = await chromium.launch();
async function session(env, {loseResponse = () => false} = {}) {
  const ctx = await browser.newContext({viewport: {width: 390, height: 900}});
  const statuses = [];
  await ctx.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort();
    const response = await worker.fetch(new Request(url, {method: request.method(), body: request.postData() ?? undefined,
      headers: {...request.headers(), 'cf-connecting-ip': '192.0.2.10'}}), env);
    if (url.pathname === '/api/leads') {
      statuses.push(response.status);
      if (loseResponse()) return route.abort('connectionreset');
    }
    return route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
  return {ctx, page: await ctx.newPage(), statuses};
}

const identity = async (p, f) => {
  await p.fill(`${f} [name=firstname]`, 'Awa'); await p.fill(`${f} [name=lastname]`, 'Koné');
  await p.fill(`${f} [name=email]`, 'awa@example.invalid');
};
const collaborationForm = '#collaboration-organisation form';
const JOURNEYS = {
  'collaboration organisation': {url: '/collaboration.html', lead: 'collaboration-organisation', form: collaborationForm, message: `${collaborationForm} [data-form-message]`, run: async (p, f) => {
    await p.check('input[value="organisation"]');
    await identity(p, f);
    await p.fill(`${f} [name=organisation]`, 'Organisation test');
    await p.selectOption(`${f} [name=organisation_type]`, 'ong');
    await p.selectOption(`${f} [name=territory]`, 'france-mediterranee');
    await p.fill(`${f} [name=collaboration_subject]`, 'Objet test');
    await p.check(`${f} [name=domains][value=littoral-adaptation]`);
    await p.fill(`${f} [name=collaboration_expectation]`, 'Attente test');
    await p.check(`${f} [name=privacy_acknowledged]`);
  }},
  'collaboration expertise': {url: '/collaboration.html', lead: 'expertise-offer', form: '#collaboration-expertise form', message: '#collaboration-expertise form [data-form-message]', run: async (p, f) => {
    await p.check('input[value="expertise"]');
    await identity(p, f);
    await p.selectOption(`${f} [name=territory]`, 'cote-divoire');
    await p.selectOption(`${f} [name=professional_status]`, 'consultant');
    await p.selectOption(`${f} [name=availability]`, 'ponctuelle');
    await p.check(`${f} [name=expertise_domains][value=gouvernance-maritime]`);
    await p.check(`${f} [name=intervention_types][value=cartographie]`);
    await p.check(`${f} [name=work_languages][value=francais]`);
    await p.fill(`${f} [name=expertise_evidence]`, 'Références test');
    await p.fill(`${f} [name=motivation]`, 'Motivation test');
    await p.check(`${f} [name=privacy_acknowledged]`);
  }},
  formation: {url: '/formation.html', lead: 'formation', form: 'form[data-lead-type="formation"]', message: 'form[data-lead-type="formation"] [data-form-message]', run: async (p, f) => {
    await identity(p, f);
    await p.fill(`${f} [name=organisation]`, 'Organisation test');
    await p.fill(`${f} [name=audience]`, 'Agents');
    await p.fill(`${f} [name=training_subject]`, 'Gouvernance littorale');
    await p.fill(`${f} [name=learning_objectives]`, 'Objectifs test');
    await p.selectOption(`${f} [name=training_format]`, 'presentiel');
    await p.fill(`${f} [name=location]`, 'Marseille');
    await p.fill(`${f} [name=period]`, 'Novembre');
    await p.check(`${f} [name=privacy_acknowledged]`);
  }}
};
const qualifier = (url, lead) => ({url, lead, form: '#lead-form', message: '#lead-message', run: async (p, f) => {
  const steps = ['organisation', 'territoire', 'problematique', 'stade', 'delai', 'donnees', 'resultat'];
  for (const [index, name] of steps.entries()) {
    const select = p.locator(`#qualifier-form [name="${name}"]`).first();
    if (!(await select.inputValue())) await select.selectOption({index: 1});
    await p.click(index < steps.length - 1 ? '#next' : '#submit-qualifier');
  }
  await p.waitForSelector('#qualifier-result:not([hidden])');
  await identity(p, f);
  await p.fill(`${f} [name=organisation_name]`, 'Commune test');
  await p.fill(`${f} [name=description]`, 'Besoin de cadrage test');
  await p.check(`${f} [name=consent]`);
}});
JOURNEYS.projet = qualifier('/qualifier-un-besoin.html?parcours=projet', 'projet-mission');
JOURNEYS['qualifier événement'] = qualifier('/qualifier-un-besoin.html?parcours=evenement', 'evenement-intervention');
const submitOf = journey => journey.form === '#lead-form' ? '#lead-submit' : `${journey.form} button[type=submit]`;

let failures = 0;
const check = async (label, run) => {
  try { await run(); console.log(`ok - ${label}`); }
  catch (error) {
    failures++; console.log(`not ok - ${label}: ${error.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${label.slice(0, 80)}::${error.message.replace(/\s+/g, ' ').slice(0, 900)}`);
  }
};

for (const [name, journey] of Object.entries(JOURNEYS)) {
  await check(`${name} : formulaire réel accepté, stocké puis diffusé une seule fois`, async () => {
    const database = createD1Double();
    brevo.length = 0;
    const {ctx, page, statuses} = await session(environment(database));
    await page.goto(`${ORIGIN}${journey.url}`, {waitUntil: 'networkidle'});
    await journey.run(page, journey.form);
    await page.click(submitOf(journey));
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('transmise'), journey.message);
    assert.deepEqual(statuses, [201]);
    assert.match(await page.textContent(journey.message), SUCCESS);
    assert.equal(database.size, 1, 'demande non stockée');
    const row = database.first();
    assert.equal(row.lead_type, journey.lead);
    assert.equal(row.email, 'awa@example.invalid');
    assert.equal(row.delivery_status, 'DELIVERED');
    assert.deepEqual(brevo.map(call => call.path), ['/v3/contacts', '/v3/smtp/email', '/v3/smtp/email']);
    assert.equal(new URL(page.url()).searchParams.has('email'), false, 'donnée dans l’URL');
    await ctx.close();
  });
}

await check('réponse perdue : demande enregistrée, jamais présentée comme non transmise, pas de double envoi', async () => {
  const journey = JOURNEYS.formation;
  const database = createD1Double();
  brevo.length = 0;
  let lose = true;
  const {ctx, page, statuses} = await session(environment(database), {loseResponse: () => lose});
  await page.goto(`${ORIGIN}${journey.url}`, {waitUntil: 'networkidle'});
  await journey.run(page, journey.form);
  await page.click(submitOf(journey));
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('peut-être'), journey.message);
  assert.equal(database.size, 1, 'la demande devait être enregistrée côté serveur');
  const message = await page.textContent(journey.message);
  assert.match(message, UNKNOWN);
  assert.doesNotMatch(message, REFUSED);
  assert.ok(!(await page.isHidden(`${journey.form} [data-mail-copy]`)), 'courriel de secours absent');
  const delivered = brevo.length;
  lose = false;
  await page.click(submitOf(journey));
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('a bien été'), journey.message);
  assert.deepEqual(statuses, [201, 200]);
  assert.equal(database.size, 1, 'demande dupliquée');
  assert.equal(brevo.length, delivered, 'accusé envoyé deux fois');
  await ctx.close();
});

await check('réponse perdue dans le Qualifier : même message', async () => {
  const journey = JOURNEYS.projet;
  const database = createD1Double();
  const {ctx, page} = await session(environment(database), {loseResponse: () => true});
  await page.goto(`${ORIGIN}${journey.url}`, {waitUntil: 'networkidle'});
  await journey.run(page, journey.form);
  await page.click('#lead-submit');
  await page.waitForFunction(() => document.querySelector('#lead-message')?.textContent.includes('peut-être'));
  assert.equal(database.size, 1);
  await ctx.close();
});

await check('refus du Worker : demande non stockée, annoncée comme telle, aucun appel Brevo', async () => {
  const journey = JOURNEYS.formation;
  const database = createD1Double();
  brevo.length = 0;
  const {ctx, page, statuses} = await session({...environment(database), LEADS_ENABLED: 'false'});
  await page.goto(`${ORIGIN}${journey.url}`, {waitUntil: 'networkidle'});
  await journey.run(page, journey.form);
  await page.click(submitOf(journey));
  await page.waitForFunction(selector => document.querySelector(selector)?.textContent.includes('enregistrée'), journey.message);
  assert.deepEqual(statuses, [503]);
  assert.match(await page.textContent(journey.message), REFUSED);
  assert.equal(database.size, 0);
  assert.equal(brevo.length, 0);
  await ctx.close();
});

await browser.close();
process.exit(failures ? 1 : 0);
