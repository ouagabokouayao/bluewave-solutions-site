// Recette qualité de la version servie : axe-core WCAG 2.0/2.1 A et AA sur
// les 21 pages à 390 et 1440 px ; CLS < 0,1 à 412 et 1440 px ; menu de
// l'accueil utilisable sans JavaScript. Lecture seule.
import {chromium} from 'playwright';
import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const base = process.env.BASE_URL;
const pages = readdirSync('dist-production').filter(f => f.endsWith('.html')).sort();
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch();
const wcag = [], cls = [];
for (const width of [390, 1440]) {
  const ctx = await browser.newContext({viewport: {width, height: 900}, userAgent: process.env.UA});
  const page = await ctx.newPage();
  for (const name of pages) {
    await page.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    // Injection par le protocole du navigateur : la CSP servie (script-src 'self') refuse tout script en ligne.
    await page.evaluate(axeSource);
    const found = await page.evaluate(async () => (await axe.run(document, {
      runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']
    })).violations.map(v => `${v.id}×${v.nodes.length}`));
    found.forEach(f => wcag.push(`${name}@${width}:${f}`));
  }
  await ctx.close();
}
for (const [width, height] of [[412, 823], [1440, 900]]) {
  const ctx = await browser.newContext({viewport: {width, height}, userAgent: process.env.UA});
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({type: 'layout-shift', buffered: true}); });
  for (const name of pages) {
    await page.goto(`${base}/${name}`, {waitUntil: 'networkidle'}); await page.waitForTimeout(400);
    const v = await page.evaluate(() => window.__cls); if (v >= 0.1) cls.push(`${name}@${width}:${v.toFixed(3)}`);
  }
  await ctx.close();
}
const noJs = await browser.newContext({viewport: {width: 412, height: 823}, javaScriptEnabled: false});
const p = await noJs.newPage(); await p.goto(`${base}/index.html`);
const menu = await p.evaluate(() => [...document.querySelectorAll('#menu-mobile a')].filter(a => a.getBoundingClientRect().height > 0).length);
await browser.close();
console.log(`::notice title=WCAG 2.1 A/AA servi::${wcag.length ? wcag.slice(0, 30).join(' ') : `aucune violation (${pages.length} pages × 2 largeurs)`}`);
console.log(`::notice title=CLS servi::${cls.length ? cls.join(' ') : `toutes pages < 0,1 à 412 et 1440 px`}`);
console.log(`::notice title=Menu accueil sans JavaScript::${menu} liens visibles`);
const ok = !wcag.length && !cls.length && menu >= 5;
console.log(`::notice title=VERDICT qualite servie::${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
