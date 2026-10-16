import {chromium} from 'playwright';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
const ROOT = normalize('dist-production');
const T = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.txt':'text/plain','.xml':'application/xml'};
const base = process.env.BASE_URL;
const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
const b = await chromium.launch(); const out = {};
// 1. Toutes les pages, deux largeurs : statut, débordement, erreurs JS/console, images, requêtes externes, liens internes.
const links = new Set();
for (const width of [390, 1440]) {
  const ctx = await b.newContext({viewport: {width, height: 900}}); const p = await ctx.newPage();
  const ext = new Set(); p.on('request', r => { const h = new URL(r.url()).host; if (h !== new URL(base).host) ext.add(h); });
  const rows = [];
  for (const name of pages) {
    const errs = []; const onErr = e => errs.push(e.message); const onCon = m => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 90)); };
    p.on('pageerror', onErr); p.on('console', onCon);
    const r = await p.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    const info = await p.evaluate(() => ({ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      brokenImg: [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')),
      hrefs: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))}));
    info.hrefs.filter(h => !/^(https?:|mailto:|tel:|#)/.test(h)).forEach(h => links.add(h.split('#')[0].split('?')[0]));
    rows.push({name, status: r.status(), ov: info.ov, img: info.brokenImg, errs: [...errs]});
    p.off('pageerror', onErr); p.off('console', onCon);
  }
  out[`pages_${width}`] = {total: rows.length, http_non200: rows.filter(x => x.status !== 200 && x.name !== '404.html').map(x => `${x.name}:${x.status}`),
    debordements: rows.filter(x => x.ov > 0).map(x => `${x.name}+${x.ov}`), images_cassees: rows.flatMap(x => x.img.map(i => `${x.name}:${i}`)),
    erreurs: rows.filter(x => x.errs.length).map(x => `${x.name}:${x.errs[0]}`), requetes_externes: [...ext]};
  await ctx.close();
}
// 2. Liens internes.
const ctxL = await b.newContext(); const pl = await ctxL.newPage(); const bad = [];
for (const h of links) { if (!h) continue; const r = await pl.request.get(`${base}/${h.replace(/^\.?\//, '')}`); if (r.status() !== 200) bad.push(`${h}:${r.status()}`); }
out.liens_internes = {verifies: links.size, casses: bad}; await ctxL.close();
// 3. Menus mobiles (accueil premium + gabarit des pages).
const ctxM = await b.newContext({viewport: {width: 390, height: 844}}); const pm = await ctxM.newPage(); out.menus = [];
for (const name of ['index.html', 'solutions.html', 'collaboration.html']) {
  await pm.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
  const t = pm.locator('.menu-toggle').first(); const before = await t.getAttribute('aria-expanded'); await t.click(); await pm.waitForTimeout(300);
  const after = await t.getAttribute('aria-expanded');
  const visibleLinks = await pm.evaluate(() => [...document.querySelectorAll('.mobile-nav a, .nav-links a')].filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== 'hidden'; }).length);
  await pm.keyboard.press('Escape');
  out.menus.push({page: name, aria_avant: before, aria_apres: after, liens_visibles: visibleLinks});
}
await ctxM.close();
// 4. Qualifier : 7 étapes, orientation, préparation de la demande, aucune transmission.
const ctxQ = await b.newContext({viewport: {width: 390, height: 900}}); const q = await ctxQ.newPage(); const api = [];
q.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(r.url()); });
await q.goto(`${base}/qualifier-un-besoin.html?parcours=projet`, {waitUntil: 'networkidle'});
const steps = ['organisation', 'territoire', 'problematique', 'stade', 'delai', 'donnees', 'resultat'];
for (const [i, n] of steps.entries()) {
  const sel = q.locator(`#qualifier-form [name="${n}"]`).first();
  const opts = await sel.evaluate(s => [...s.options].map(o => o.value).filter(Boolean)); await sel.selectOption(opts[0]);
  if (i < steps.length - 1) await q.click('#next'); else await q.click('#submit-qualifier');
}
await q.waitForSelector('#qualifier-result:not([hidden])', {timeout: 5000});
const orientation = (await q.textContent('#result-title') || '').trim();
const nl = await q.evaluate(() => { const c = document.querySelector('[name="newsletter_consent"]'); if (!c) return 'absent'; const r = c.getBoundingClientRect(); return `present visible=${r.width > 0 && !c.closest('[hidden]')} disabled=${c.disabled}`; });
await q.fill('#lead-firstname', 'Awa'); await q.fill('#lead-form [name="lastname"]', 'Koné'); await q.fill('#lead-form [name="organisation_name"]', 'Commune test');
await q.fill('#lead-form [name="email"]', 'awa@example.invalid'); await q.fill('#lead-form [name="description"]', 'Besoin de cadrage sur le trait de côte.');
await q.check('#lead-form [name="consent"]'); await q.click('#lead-submit'); await q.waitForTimeout(800);
const qmsg = (await q.textContent('#lead-message') || '').trim();
const qmail = await q.evaluate(() => [...document.querySelectorAll('#lead-form a[href^="mailto:"], #qualifier-result a[href^="mailto:"]')].filter(a => !a.closest('[hidden]') && !a.hidden).length);
const qcopy = await q.evaluate(() => { const t = document.querySelector('#lead-form [data-mail-copy] textarea'); return t && !t.closest('[hidden]') ? t.value : ''; });
out.qualifier = {etapes: steps.length, orientation, newsletter: nl, message: qmsg, liens_courriel_visibles: qmail, appels_api: api,
  message_copiable: qcopy ? `${qcopy.length} car., organisation=${qcopy.includes('Commune test')}, description=${qcopy.includes('trait de côte')}` : 'absent'};
await ctxQ.close();
// 5. Offre d'origine conservée de Solutions vers Projet puis Qualifier.
const ctxO = await b.newContext(); const po = await ctxO.newPage();
await po.goto(`${base}/projet.html?offre=diagnostic-strategique`, {waitUntil: 'networkidle'});
out.offre_origine = {notice: (await po.textContent('[data-source-offer]') || '').trim(), lien: await po.getAttribute('[data-project-start]', 'href')};
await ctxO.close();
// 6. Fonctionnalités actives côté client et configuration des services distants.
const cfg = JSON.parse(await readFile(join(ROOT, 'data/automation-config.json'), 'utf8')); const an = JSON.parse(await readFile(join(ROOT, 'data/analytics-config.json'), 'utf8'));
out.services_distants = {lead_endpoint: cfg.lead_endpoint, newsletter: cfg.newsletter_enabled, chat: cfg.chat_enabled, rendez_vous: cfg.meeting_url, turnstile: cfg.turnstile.enabled, mesure: an.enabled, evenements: an.endpoint};
const ctxF = await b.newContext({viewport: {width: 1440, height: 900}}); const pf = await ctxF.newPage();
await pf.goto(`${base}/mediatheque-visualisations.html`, {waitUntil: 'networkidle'});
await pf.locator('.media-card button, .media-card a, [data-media-open]').first().click().catch(() => {}); await pf.waitForTimeout(400);
const dlg = await pf.evaluate(() => !!document.querySelector('dialog[open]'));
await pf.goto(`${base}/actualites.html`, {waitUntil: 'networkidle'});
const news = await pf.evaluate(() => document.querySelectorAll('[data-actualites-grid] article, .news-card, .actualite-card').length);
await pf.goto(`${base}/index.html`, {waitUntil: 'networkidle'});
const pause = await pf.evaluate(() => [...document.querySelectorAll('button')].some(x => /pause/i.test(x.textContent)));
out.fonctions_locales = {visionneuse_mediatheque_ouverte: dlg, cartes_actualites: news, bouton_pause_animations: pause};
await ctxF.close(); await b.close();
const fail = [];
for (const w of ['pages_390', 'pages_1440']) { const d = out[w]; if (d.http_non200.length || d.debordements.length || d.images_cassees.length || d.erreurs.length || d.requetes_externes.length) fail.push(w); }
if (out.liens_internes.casses.length) fail.push('liens');
if (out.menus.some(m => m.aria_apres !== 'true' || m.liens_visibles < 5)) fail.push('menus');
if (out.qualifier.appels_api.length || out.qualifier.liens_courriel_visibles < 1 || /visible=true/.test(out.qualifier.newsletter)
  || !/organisation=true, description=true/.test(out.qualifier.message_copiable)) fail.push('qualifier');
if (Object.values(out.services_distants).some(v => v)) fail.push('services_distants');
for (const [k, v] of Object.entries(out)) console.log(`::notice title=Recette ${k}::${JSON.stringify(v).slice(0, 900)}`);
console.log(`::notice title=VERDICT recette parcours::${fail.length ? 'FAIL ' + fail.join(' ') : 'PASS'}`);
process.exit(fail.length ? 1 : 0);
