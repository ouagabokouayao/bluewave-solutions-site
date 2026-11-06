// Inscriptions fermées : la vraie page de retrait, dans un vrai navigateur, à travers
// le vrai Worker et une vraie base D1 locale. Brevo est simulé.
import {chromium} from 'playwright';
import {Miniflare} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname, join, normalize} from 'node:path';
import assert from 'node:assert/strict';
import worker from '../../serverless/cloudflare/worker.mjs';
import {createNewsletterChannel} from '../../serverless/bluewave-leads/newsletter.mjs';

const ROOT = normalize(process.argv[2] || 'dist-production');
const ORIGIN = 'https://bluewave.test';
const PAGE = `${ORIGIN}/lettre-de-veille.html`;
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain'};
const axeSource = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const mf = new Miniflare({modules: true, script: 'export default {fetch(){return new Response("local");}}', d1Databases: {NEWSLETTER_DB: 'retrait-e2e'}, d1Persist: false});
const database = await mf.getD1Database('NEWSLETTER_DB');
for (const statement of (await readFile('serverless/cloudflare/newsletter-schema.sql', 'utf8')).replace(/^\s*--.*$/gm, '').split(';').map(item => item.trim()).filter(Boolean)) await database.prepare(statement).run();

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
const secret = 's'.repeat(40);
const closed = {ASSETS: assets, NEWSLETTER_DB: database, ALLOWED_ORIGIN: ORIGIN, BLUEWAVE_SITE_URL: ORIGIN, LEADS_ENABLED: 'false', EVENTS_ENABLED: 'false', TURNSTILE_ENABLED: 'false',
  NEWSLETTER_ENABLED: 'false', NEWSLETTER_TOKEN_SECRET: secret, BREVO_API_KEY: 'cle-synthetique', BREVO_NEWSLETTER_LIST_ID: '7', BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID: '8'};

// Un inscrit d'avant la fermeture, créé par le vrai canal.
async function subscriber(email) {
  const sent = [];
  const transport = {sendConfirmation: async (_, token) => sent.push(token), subscribe: async () => {}, unsubscribe: async () => {}, updatePreferences: async () => {}};
  const channel = createNewsletterChannel({NEWSLETTER_ENABLED: 'true', NEWSLETTER_TOKEN_SECRET: secret}, {database, transport});
  await channel.request({email, consent: true, notice_version: 'notice-test', consent_source: 'lettre-de-veille', preferences: ['veille']});
  return (await channel.confirm(sent[0])).management_token;
}
const state = async email => (await database.prepare('SELECT state FROM newsletter_consents WHERE email=?').bind(email).all()).results[0]?.state;

const browser = await chromium.launch();
let failures = 0;
async function session(env, {width = 390} = {}) {
  const ctx = await browser.newContext({viewport: {width, height: 900}});
  const api = [];
  await ctx.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return route.abort();
    const response = await worker.fetch(new Request(url, {method: request.method(), body: request.postData() ?? undefined,
      headers: {...request.headers(), 'cf-connecting-ip': '192.0.2.31'}}), env);
    if (url.pathname.startsWith('/api/newsletter/')) api.push({path: url.pathname, status: response.status});
    return route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
  });
  return {ctx, page: await ctx.newPage(), api};
}
async function check(name, run) {
  try { await run(); console.log(`ok - ${name}`); }
  catch (error) { failures++; console.log(`not ok - ${name} — ${String(error.message).slice(0, 300)}`); if (process.env.GITHUB_ACTIONS) console.log(`::error title=Retrait ${name}::${String(error.message).slice(0, 300)}`); }
}
const message = page => page.locator('[data-form-message]');
const expectText = (locator, pattern) => locator.filter({hasText: pattern}).waitFor({timeout: 5000});
const axe = async page => {
  await page.evaluate(axeSource);
  return page.evaluate(async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']})).violations.map(v => `${v.id} : ${v.nodes[0].target.join(' ')}`));
};

await check('07 : sans lien, la page informe, ne collecte rien et donne un recours', async () => {
  const {ctx, page, api} = await session(closed);
  await page.goto(PAGE);
  assert.match(await page.locator('main').innerText(), /Les inscriptions ne sont pas encore ouvertes\./);
  assert.equal(await page.locator('main form, main input').count(), 0);
  assert.equal(await page.locator('main a[href^="mailto:"]').count(), 1);
  assert.equal(await page.isVisible('[data-retrait-action]'), false);
  assert.equal(api.length, 0);
  await ctx.close();
});

await check('07 : un ancien abonné se désinscrit, inscriptions fermées', async () => {
  const token = await subscriber('ancien@example.invalid');
  const {ctx, page, api} = await session(closed);
  await page.goto(`${PAGE}#gerer=${token}`);
  await page.locator('[data-retrait-action]').waitFor();
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(api.length, 0, 'ouvrir le lien ne retire rien');
  await page.click('[data-retrait-action]');
  await expectText(message(page), /désinscription de BlueWave Perspectives est effective/);
  assert.equal(await state('ancien@example.invalid'), 'REVOKED');
  assert.deepEqual(brevo.at(-1), {path: `/v3/contacts/${encodeURIComponent('ancien@example.invalid')}`, method: 'PUT', body: {unlinkListIds: [7]}});
  await page.goto('about:blank');
  await page.goto(`${PAGE}#gerer=${token}`);
  await page.click('[data-retrait-action]');
  await expectText(message(page), /n’est plus actif/);
  await ctx.close();
});

await check('07 : panne Brevo pendant le retrait : acquis en base, annoncé tel quel, repris par la tâche', async () => {
  const token = await subscriber('panne@example.invalid');
  const {ctx, page} = await session(closed);
  await page.goto(`${PAGE}#gerer=${token}`);
  brevoDown = true;
  await page.click('[data-retrait-action]');
  await expectText(message(page), /est enregistrée/);
  brevoDown = false;
  assert.equal(await state('panne@example.invalid'), 'REVOKING');
  await worker.scheduled({}, closed);
  assert.equal(await state('panne@example.invalid'), 'REVOKED');
  await ctx.close();
});

await check('07 : profil A sans base : le visiteur reçoit le recours manuel', async () => {
  const {ctx, page, api} = await session({ASSETS: assets, ALLOWED_ORIGIN: ORIGIN, NEWSLETTER_ENABLED: 'false'});
  await page.goto(`${PAGE}#gerer=${'a'.repeat(43)}`);
  await page.click('[data-retrait-action]');
  await expectText(message(page), /traitée à la main/);
  assert.deepEqual(api.map(item => item.status), [503]);
  await ctx.close();
});

await check('aucune collecte rouverte : inscription refusée, lien de confirmation sans effet', async () => {
  const {ctx, page} = await session(closed);
  await page.goto(`${PAGE}#confirmer=${'a'.repeat(43)}`);
  await expectText(message(page), /ne peut pas aboutir/);
  const before = (await database.prepare('SELECT COUNT(*) AS count FROM newsletter_consents').all()).results[0].count;
  const status = await page.evaluate(async () => (await fetch('/api/newsletter/subscribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: 'nouveau@example.invalid', consent: true})})).status);
  assert.equal(status, 503);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM newsletter_consents').all()).results[0].count, before);
  await ctx.close();
});

for (const width of [320, 390, 1440]) await check(`accessibilité et largeur à ${width} px`, async () => {
  const {ctx, page} = await session(closed, {width});
  const verify = async () => {
    assert.deepEqual(await axe(page), []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'débordement horizontal');
  };
  await page.goto(PAGE);
  await verify();
  await page.goto('about:blank');
  await page.goto(`${PAGE}#gerer=${'a'.repeat(43)}`);
  await page.locator('[data-retrait-action]').waitFor();
  await verify();
  await ctx.close();
});

await browser.close();
await mf.dispose();
console.log(failures ? `FAIL : ${failures} parcours en échec` : 'PASS : retrait de BlueWave Perspectives, inscriptions fermées');
process.exit(failures ? 1 : 0);
