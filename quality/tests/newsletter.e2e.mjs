// Parcours complet de la lettre de veille : la vraie page, dans un vrai navigateur,
// parle au vrai Worker et à une vraie base D1 locale. Brevo est simulé, et toute
// autre sortie réseau fait échouer le test.
import {chromium} from 'playwright';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join, normalize} from 'node:path';
import assert from 'node:assert/strict';
import worker from '../../serverless/cloudflare/worker.mjs';

const ROOT = normalize(process.argv[2] || 'dist-production');
const ORIGIN = 'https://bluewave.test';
const PAGE = `${ORIGIN}/lettre-de-veille.html`;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain'};
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const mf = new Miniflare({modules: true, script: 'export default {fetch(){return new Response("local");}}', d1Databases: {NEWSLETTER_DB: 'veille-e2e'}, d1Persist: false});
const database = await mf.getD1Database('NEWSLETTER_DB');
for (const statement of (await readFile('serverless/cloudflare/newsletter-schema.sql', 'utf8')).split(';').map(item => item.trim()).filter(Boolean)) await database.prepare(statement).run();

const brevo = [];
let brevoDown = false;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.brevo.com/')) throw new Error(`Sortie réseau interdite : ${url}`);
  brevo.push({path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body)});
  return new Response('{}', {status: brevoDown ? 503 : 201});
};
const assets = {fetch: async request => {
  const path = new URL(request.url).pathname;
  try { return new Response(await readFile(join(ROOT, path)), {status: 200, headers: {'content-type': TYPES[extname(path)] || 'application/octet-stream'}}); }
  catch { return new Response('introuvable', {status: 404}); }
}};
const guard = {idFromName: name => name, get: () => ({fetch: async () => Response.json({ok: true})})};
const env = {ASSETS: assets, NEWSLETTER_DB: database, LEAD_GUARD: guard, GUARD_HMAC_KEY: 'c'.repeat(40), ALLOWED_ORIGIN: ORIGIN, BLUEWAVE_SITE_URL: ORIGIN,
  LEADS_ENABLED: 'false', EVENTS_ENABLED: 'false', TURNSTILE_ENABLED: 'false', NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: 's'.repeat(40),
  NEWSLETTER_NOTICE_VERSION: 'veille-v1', NEWSLETTER_PROOF_RETENTION_DAYS: '1095', BREVO_API_KEY: 'cle-synthetique', BREVO_NEWSLETTER_LIST_ID: '7', BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID: '8'};

const browser = await chromium.launch();
let failures = 0;
async function session({width = 390, loseResponse = () => false} = {}) {
  const ctx = await browser.newContext({viewport: {width, height: 900}});
  const api = [];
  await ctx.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort();
    const response = await worker.fetch(new Request(url, {method: request.method(), body: request.postData() ?? undefined,
      headers: {...request.headers(), 'cf-connecting-ip': '192.0.2.30'}}), env);
    if (url.pathname.startsWith('/api/newsletter/')) {
      api.push({path: url.pathname, status: response.status, search: url.search});
      if (loseResponse(url.pathname)) return route.abort('connectionreset');
    }
    return route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
  return {ctx, page: await ctx.newPage(), api};
}
async function check(name, run) {
  try { await run(); console.log(`ok - ${name}`); }
  catch (error) { failures++; console.log(`not ok - ${name} — ${String(error.message).slice(0, 300)}`); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Lettre de veille ${name}::${String(error.message).slice(0, 300)}`); }
}
const message = (page, view) => page.locator(`[data-veille-view="${view}"] [data-form-message]`);
const expectText = async (locator, pattern) => { await locator.filter({hasText: pattern}).waitFor({timeout: 5000}); };
const fill = async (page, email) => {
  await page.goto(PAGE);
  await page.fill('#veille-email', email);
  await page.check('[data-veille-view="subscribe"] [name=preferences][value=veille]');
  await page.check('[name=consent]');
};
const links = () => {
  const mails = brevo.filter(item => item.path === '/v3/smtp/email');
  return mails.at(-1).body.params.confirmation_url.replace(ORIGIN, '').replace(/^\//, `${ORIGIN}/`);
};
const management = () => brevo.filter(item => item.path === '/v3/contacts').at(-1).body.attributes.BW_VEILLE_GESTION;
const state = async email => (await database.prepare('SELECT * FROM newsletter_consents WHERE email=?').bind(email).all()).results[0];
const axe = async page => {
  await page.evaluate(axeSource);
  return page.evaluate(async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']})).violations.map(v => `${v.id} : ${v.nodes[0].target.join(' ')}`));
};

const EMAIL = 'parcours@example.invalid';
await check('saisie incomplète : aucun appel, message clair', async () => {
  const {ctx, page, api} = await session();
  await page.goto(PAGE);
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'subscribe'), /adresse e-mail valide/);
  await page.fill('#veille-email', EMAIL);
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'subscribe'), /au moins une préférence/);
  await page.check('[data-veille-view="subscribe"] [name=preferences][value=veille]');
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'subscribe'), /accord est nécessaire/);
  assert.equal(api.length, 0);
  await ctx.close();
});

await check('inscription : le courriel part, aucune inscription avant confirmation', async () => {
  const {ctx, page, api} = await session();
  await fill(page, EMAIL);
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'done'), /Demande reçue/);
  assert.deepEqual(api.map(item => item.status), [202]);
  assert.equal(brevo.length, 1);
  assert.equal((await state(EMAIL)).state, 'CONFIRM_SENT');
  await ctx.close();
});

let managementLink;
await check('confirmation : un clic délibéré, jeton retiré de l’adresse et absent des requêtes', async () => {
  const {ctx, page, api} = await session();
  const link = links();
  await page.goto(link);
  await page.locator('[data-veille-action="confirm"]').waitFor();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(api.length, 0, 'ouvrir le lien ne confirme rien : les scanners de messagerie restent sans effet');
  await page.click('[data-veille-action="confirm"]');
  await expectText(message(page, 'manage'), /inscription à BlueWave Perspectives est confirmée/);
  assert.equal(await page.isChecked('[data-veille-form="preferences"] [value=veille]'), true);
  assert.ok(api.every(item => item.search === ''));
  assert.equal((await state(EMAIL)).state, 'CONFIRMED');
  managementLink = management();
  await ctx.close();
});

await check('lien de confirmation rejoué : refusé, inscription intacte', async () => {
  const {ctx, page} = await session();
  await page.goto(links());
  await page.click('[data-veille-action="confirm"]');
  await expectText(message(page, 'done'), /n’est plus actif/);
  assert.equal((await state(EMAIL)).state, 'CONFIRMED');
  await ctx.close();
});

await check('préférences : modifiées, conservées à la réouverture, jamais l’adresse à l’écran', async () => {
  const {ctx, page} = await session();
  await page.goto(managementLink);
  await page.locator('[data-veille-form="preferences"] [value=veille]:checked').waitFor();
  assert.equal((await page.content()).includes(EMAIL), false);
  await page.uncheck('[data-veille-form="preferences"] [value=veille]');
  await page.click('[data-veille-form="preferences"] [type=submit]');
  await expectText(message(page, 'manage'), /au moins une préférence/);
  await page.check('[data-veille-form="preferences"] [value=formations]');
  await page.click('[data-veille-form="preferences"] [type=submit]');
  await expectText(message(page, 'manage'), /préférences sont enregistrées/);
  await page.goto('about:blank');
  await page.goto(managementLink);
  await page.locator('[data-veille-form="preferences"] [value=formations]:checked').waitFor();
  assert.equal(await page.isChecked('[data-veille-form="preferences"] [value=veille]'), false);
  await ctx.close();
});

await check('désinscription : effective chez le fournisseur et en base', async () => {
  const {ctx, page} = await session();
  await page.goto(managementLink);
  await page.locator('[data-veille-form="preferences"] [value=formations]:checked').waitFor();
  await page.click('[data-veille-action="unsubscribe"]');
  await expectText(message(page, 'done'), /désinscription de BlueWave Perspectives est effective/);
  assert.equal(brevo.at(-1).method, 'PUT');
  assert.deepEqual(brevo.at(-1).body, {unlinkListIds: [7]});
  assert.equal((await state(EMAIL)).state, 'REVOKED');
  await page.goto('about:blank');
  await page.goto(managementLink);
  await expectText(message(page, 'done'), /n’est plus actif/);
  await ctx.close();
});

await check('réponse perdue à l’inscription : le visiteur n’est pas trompé', async () => {
  const {ctx, page} = await session({loseResponse: path => path.endsWith('/subscribe')});
  await fill(page, 'perdue@example.invalid');
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'subscribe'), /a peut-être abouti/);
  assert.equal((await state('perdue@example.invalid')).state, 'CONFIRM_SENT');
  await ctx.close();
});

await check('lien expiré : aucune inscription, nouvelle demande proposée', async () => {
  const {ctx, page} = await session();
  const link = links();
  await database.prepare('UPDATE newsletter_consents SET expires_at=? WHERE email=?').bind(Date.now() - 1000, 'perdue@example.invalid').run();
  await page.goto(link);
  await page.click('[data-veille-action="confirm"]');
  await expectText(message(page, 'subscribe'), /a expiré/);
  assert.equal((await state('perdue@example.invalid')).state, 'EXPIRED');
  await ctx.close();
});

await check('panne Brevo : à la demande rien n’est promis, au retrait le retrait reste acquis', async () => {
  const {ctx, page} = await session();
  brevoDown = true;
  await fill(page, 'panne@example.invalid');
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'subscribe'), /indisponible/);
  brevoDown = false;
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'done'), /Demande reçue/);
  await page.goto(links());
  await page.click('[data-veille-action="confirm"]');
  await expectText(message(page, 'manage'), /inscription à BlueWave Perspectives est confirmée/);
  brevoDown = true;
  await page.click('[data-veille-action="unsubscribe"]');
  await expectText(message(page, 'done'), /désinscription de BlueWave Perspectives est enregistrée/);
  brevoDown = false;
  assert.equal((await state('panne@example.invalid')).state, 'REVOKING');
  await worker.scheduled({}, env);
  assert.equal((await state('panne@example.invalid')).state, 'REVOKED');
  await ctx.close();
});

for (const width of [320, 390, 1440]) await check(`accessibilité et largeur à ${width} px, trois vues`, async () => {
  const {ctx, page} = await session({width});
  const email = `vues-${width}@example.invalid`;
  await fill(page, email);
  const verify = async () => {
    assert.deepEqual(await axe(page), []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'débordement horizontal');
  };
  await verify();
  await page.click('[data-veille-form="subscribe"] [type=submit]');
  await expectText(message(page, 'done'), /Demande reçue/);
  await page.goto(links());
  await page.locator('[data-veille-action="confirm"]').waitFor();
  await verify();
  await page.click('[data-veille-action="confirm"]');
  await expectText(message(page, 'manage'), /inscription à BlueWave Perspectives est confirmée/);
  await verify();
  await ctx.close();
});

await check('les mentions décrivent le canal ouvert et le pied de page y conduit', async () => {
  const {ctx, page} = await session();
  await page.goto(`${ORIGIN}/politique-confidentialite.html`);
  const text = await page.locator('main').innerText();
  assert.match(text, /consentement spécifique, que vous pouvez retirer/);
  assert.equal(text.includes('La lettre de veille est désactivée'), false);
  await page.click('.site-footer a[href="lettre-de-veille.html"]');
  await page.locator('#veille-email').waitFor();
  await page.goto(`${ORIGIN}/qualifier-un-besoin.html`);
  assert.equal(await page.locator('[name=newsletter_consent]').count(), 0, 'aucune case d’inscription dans une demande de contact');
  await page.goto(`${ORIGIN}/actualites.html`);
  await page.click('.newsletter-panel a[href="lettre-de-veille.html"]');
  await page.locator('#veille-email').waitFor();
  await ctx.close();
});

await browser.close();
await mf.dispose();
console.log(failures ? `FAIL : ${failures} parcours en échec` : 'PASS : parcours de la lettre de veille');
process.exit(failures ? 1 : 0);
