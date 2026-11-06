// Recette navigateur du site servi : responsive, liens et ancres, clavier,
// requêtes externes et textes internes. Lit le build public sans réseau.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import assert from 'node:assert/strict';

const ROOT = normalize(process.argv[2] || 'dist');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.txt': 'text/plain'};
const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path.endsWith('/') ? join(path, 'index.html') : path);
    res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// La page 404 fixe sa base sur le chemin GitHub Pages : elle est contrôlée à part.
const pages = (await readdir(ROOT)).filter(name => name.endsWith('.html') && name !== '404.html').sort();
const WIDTHS = [320, 375, 768, 1024, 1440];
const INTERNAL_TEXT = /Project Qualifier|\bCTA\b|transition V3|prépublication|Offre d’origine|email direct|\bSCROLL\b/;

const browser = await chromium.launch();
let failures = 0;
const check = async (label, run) => {
  try { await run(); console.log(`ok - ${label}`); }
  catch (error) {
    failures++; console.log(`not ok - ${label}: ${error.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${label.slice(0, 80)}::${error.message.replace(/\s+/g, ' ').slice(0, 900)}`);
  }
};

// La police de remplacement varie selon l'appareil : une police large est essayée à la plus petite largeur.
for (const [width, wideFont] of [...WIDTHS.map(value => [value, false]), [320, true]]) {
  await check(`${pages.length} pages à ${width} px${wideFont ? ', police large' : ''} : aucun débordement, aucune erreur, aucune requête externe`, async () => {
    const ctx = await browser.newContext({viewport: {width, height: 900}});
    const p = await ctx.newPage();
    const problems = [];
    let current = '';
    p.on('pageerror', error => problems.push(`${current} erreur JS ${error.message.slice(0, 80)}`));
    p.on('console', message => { if (message.type() === 'error') problems.push(`${current} console ${message.text().slice(0, 90)}`); });
    p.on('request', request => { if (new URL(request.url()).origin !== base && !request.url().startsWith('data:')) problems.push(`${current} requête ${request.url()}`); });
    p.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) problems.push(`${current} ${response.status()} ${response.url()}`); });
    for (const name of pages) {
      current = name;
      await p.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
      if (wideFont) await p.evaluate(() => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('*{font-family:Verdana,"DejaVu Sans",sans-serif!important}');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
      const info = await p.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 20)); }
        const limit = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll('main *, header *, footer *')].filter(node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.right > limit + 1 && !node.closest('[aria-hidden="true"], .hero, .closing, .proof-section') && getComputedStyle(node).position !== 'fixed';
        }).slice(0, 3).map(node => `${node.tagName}.${String(node.className).slice(0, 30)}`);
        return {overflow: document.documentElement.scrollWidth - limit, wide,
          broken: [...document.images].filter(image => image.complete && image.naturalWidth === 0).map(image => image.getAttribute('src'))};
      });
      if (info.overflow > 0) problems.push(`${name} débordement ${info.overflow}px ${info.wide.join(' ')}`);
      if (info.broken.length) problems.push(`${name} image cassée ${info.broken[0]}`);
    }
    await ctx.close();
    assert.deepEqual(problems, []);
  });
}

await check('liens internes et ancres résolus sur toutes les pages', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const anchors = new Map();
  const targets = new Set();
  for (const name of pages) {
    await p.goto(`${base}/${name}`, {waitUntil: 'load'});
    anchors.set(name, new Set(await p.evaluate(() => [...document.querySelectorAll('[id]')].map(node => node.id))));
    for (const href of await p.evaluate(() => [...document.querySelectorAll('a[href]')].map(link => link.href))) {
      const url = new URL(href);
      if (url.origin === base) targets.add(`${name}|${url.pathname}|${url.hash}`);
    }
  }
  const broken = [];
  for (const target of targets) {
    const [from, path, hash] = target.split('|');
    const file = path.replace(/^\//, '') || 'index.html';
    if (!anchors.has(file) && file !== '404.html') {
      const response = await ctx.request.get(`${base}${path}`);
      if (!response.ok()) broken.push(`${from} → ${path}`);
      continue;
    }
    if (hash && !anchors.get(file)?.has(decodeURIComponent(hash.slice(1)))) broken.push(`${from} → ${path}${hash}`);
  }
  await ctx.close();
  assert.deepEqual(broken, []);
});

await check('aucun texte interne visible sur les pages', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const found = [];
  for (const name of pages) {
    await p.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    const text = await p.evaluate(() => `${document.title} ${document.querySelector('meta[name="description"]')?.content || ''} ${document.body.innerText}`);
    const match = text.match(INTERNAL_TEXT);
    if (match) found.push(`${name}: ${match[0]}`);
    if (!text.includes('bluewavesolutions3399@gmail.com')) found.push(`${name}: adresse de contact absente`);
    if (!text.includes('SASU en cours de constitution')) found.push(`${name}: statut juridique absent`);
  }
  await ctx.close();
  assert.deepEqual(found, []);
});

await check('organisation commerciale : cinq offres et deux formats, distincts des sept situations', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${base}/index.html`, {waitUntil: 'load'});
  assert.match(await p.textContent('#expertises h2'), /Cinq offres, deux formats/);
  assert.equal(await p.locator('#expertises .offer-card').count(), 7);
  assert.equal(await p.locator('#expertises .offer-n', {hasText: 'OFFRE CŒUR'}).count(), 5);
  assert.equal(await p.locator('#expertises .offer-n', {hasText: 'FORMAT D’ENTRÉE'}).count(), 2);
  await p.goto(`${base}/solutions.html`, {waitUntil: 'load'});
  for (const id of ['diagnostic-strategique', 'vulnerabilite-cotiere', 'gouvernance-acteurs', 'structuration-projet', 'formation-capacites']) assert.equal(await p.locator(`#offres #${id}`).count(), 1, id);
  for (const id of ['note-strategique', 'atelier-cadrage']) assert.equal(await p.locator(`#formats #${id}`).count(), 1, id);
  await ctx.close();
});

await check('clavier : lien d’évitement, foyer visible et menu mobile', async () => {
  for (const [name, width] of [['index.html', 1440], ['solutions.html', 1440], ['index.html', 390], ['solutions.html', 390]]) {
    const ctx = await browser.newContext({viewport: {width, height: 844}});
    const p = await ctx.newPage();
    await p.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('href')), '#contenu', `${name} lien d’évitement`);
    assert.ok(await p.evaluate(() => { const box = document.activeElement.getBoundingClientRect(); return box.top >= 0 && box.width > 0; }), `${name} évitement invisible au foyer`);
    for (let index = 0; index < 8; index++) {
      await p.keyboard.press('Tab');
      const visible = await p.evaluate(() => {
        const node = document.activeElement; const style = getComputedStyle(node);
        return node === document.body || style.outlineStyle !== 'none' || style.boxShadow !== 'none';
      });
      assert.ok(visible, `${name} foyer invisible à ${width} px`);
    }
    if (width === 390) {
      await p.focus('.menu-toggle');
      await p.keyboard.press('Enter');
      assert.equal(await p.getAttribute('.menu-toggle', 'aria-expanded'), 'true', `${name} menu non ouvert`);
      if (name === 'index.html') {
        const gaps = await p.evaluate(() => {
          const link = document.querySelector('.mobile-nav a.nav-action'); const range = document.createRange(); range.selectNodeContents(link);
          const box = link.getBoundingClientRect(), text = range.getBoundingClientRect();
          return [text.left - box.left, box.right - text.right];
        });
        assert.ok(Math.abs(gaps[0] - gaps[1]) < 6 && gaps[0] > 10, `bouton du menu décentré ${gaps}`);
        await p.keyboard.press('Escape');
        assert.equal(await p.getAttribute('.menu-toggle', 'aria-expanded'), 'false', 'Échap ne ferme pas le menu');
        assert.equal(await p.evaluate(() => document.activeElement.className), 'menu-toggle', 'foyer non rendu au bouton');
      }
    }
    await ctx.close();
  }
});

await check('accueil : les ancres atterrissent sur leur section malgré la mise en page différée', async () => {
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({viewport: {width, height: 844}, reducedMotion: 'reduce'});
    const p = await ctx.newPage();
    await p.goto(`${base}/index.html`, {waitUntil: 'networkidle'});
    await p.click('.hero-actions a[href="#expertises"]');
    await p.waitForTimeout(500);
    const top = await p.evaluate(() => document.querySelector('#expertises').getBoundingClientRect().top);
    assert.ok(Math.abs(top) < 120, `#expertises à ${Math.round(top)} px en ${width}`);
    await p.goto(`${base}/index.html#parcours`, {waitUntil: 'networkidle'});
    await p.waitForTimeout(500);
    const hash = await p.evaluate(() => document.querySelector('#parcours').getBoundingClientRect().top);
    assert.ok(Math.abs(hash) < 120, `#parcours à ${Math.round(hash)} px en ${width}`);
    await ctx.close();
  }
});

await check('accueil : les images hors écran attendent leur section', async () => {
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}});
  const p = await ctx.newPage();
  const images = [];
  p.on('request', request => { if (request.resourceType() === 'image') images.push(new URL(request.url()).pathname.split('/').pop()); });
  await p.goto(`${base}/index.html`, {waitUntil: 'load'});
  await p.waitForTimeout(400);
  for (const name of ['lagune-conceptuelle-cadree.webp', 'cote-conceptuelle-fond.webp']) assert.ok(!images.includes(name), `${name} chargée d’emblée`);
  assert.ok(images.includes('port-conceptuel-mobile.webp'), 'image du hero absente');
  await p.evaluate(() => document.querySelector('.geo-photo').scrollIntoView({behavior: 'instant'}));
  await p.waitForFunction(() => document.querySelector('.geo-photo').classList.contains('is-near'));
  await p.waitForTimeout(400);
  assert.ok(images.includes('lagune-conceptuelle-cadree.webp'), 'image non chargée à l’approche');
  await ctx.close();
});

await browser.close(); server.close();
process.exit(failures ? 1 : 0);
