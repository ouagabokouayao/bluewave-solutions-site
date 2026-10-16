// Recette navigateur de la préproduction : 21 pages à 390 et 1440 px.
// Lecture seule ; aucun formulaire n'est soumis.
import {chromium} from 'playwright';
import {readdirSync, mkdirSync} from 'node:fs';
const base = process.env.BASE_URL;
const pages = readdirSync('dist-production').filter(f => f.endsWith('.html')).sort();
mkdirSync('preview-shots', {recursive: true});
const browser = await chromium.launch();
let fail = 0;
for (const width of [390, 1440]) {
  const ctx = await browser.newContext({viewport: {width, height: 900}, userAgent: process.env.UA});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const overflow = [], jsErrors = [], external = new Set();
  page.on('request', r => { const h = new URL(r.url()).host; if (h !== new URL(base).host) external.add(h); });
  for (const name of pages) {
    errors.length = 0;
    const res = await page.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) overflow.push(`${name}(+${o})`);
    if (errors.length) jsErrors.push(`${name}:${errors[0].slice(0, 80)}`);
    if (res.status() !== 200 && name !== '404.html') { overflow.push(`${name}:HTTP${res.status()}`); }
    if (['index.html', 'collaboration.html', 'formation.html', 'mentions-legales.html'].includes(name))
      await page.screenshot({path: `preview-shots/${name.replace('.html', '')}-${width}.png`, fullPage: true});
  }
  const ok = !overflow.length && !jsErrors.length && !external.size;
  if (!ok) fail++;
  console.log(`::notice title=Rendu ${width}px::pages=${pages.length} debordement=${overflow.join(' ') || 'aucun'} erreursJS=${jsErrors.join(' ') || 'aucune'} requetesExternes=${[...external].join(' ') || 'aucune'} statut=${ok ? 'PASS' : 'FAIL'}`);
  await ctx.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
