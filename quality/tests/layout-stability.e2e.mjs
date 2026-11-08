// Garde de stabilité visuelle : le décalage cumulé de mise en page (CLS) de
// chaque page servie reste sous 0,1 (seuil « bon » des Core Web Vitals), sur
// mobile, tablette et ordinateur. Sans JavaScript, le menu de l'accueil reste
// utilisable.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';

const ROOT = normalize(process.argv[2] || 'dist');
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2'};
const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, {'content-type': TYPES[extname(path)] || 'application/octet-stream'}).end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// Une page dont la balise <base> vise un autre chemin que la racine servie ici
// (page 404 du profil GitHub Pages) ne peut pas être mesurée par ce banc.
const pages = [];
for (const f of (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort()) {
  const base = ((await readFile(join(ROOT, f), 'utf8')).match(/<base href="([^"]+)"/) || [])[1];
  if (!base || base === '/') pages.push(f); else console.log(`# ${f} ignorée : base ${base}`);
}

const browser = await chromium.launch();
let failures = 0;
for (const [width, height] of [[412, 823], [1024, 768], [1440, 900]]) {
  const page = await browser.newPage({viewport: {width, height}});
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({type: 'layout-shift', buffered: true});
  });
  for (const name of pages) {
    await page.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    await page.waitForTimeout(400);
    const cls = await page.evaluate(() => window.__cls);
    if (cls >= 0.1) { failures++; console.log(`not ok - ${name} @${width}px : CLS ${cls.toFixed(3)}`); }
  }
  await page.close();
}
const noJs = await browser.newContext({viewport: {width: 412, height: 823}, javaScriptEnabled: false});
const p = await noJs.newPage();
await p.goto(`${base}/index.html`);
const links = await p.evaluate(() => [...document.querySelectorAll('#menu-mobile a')].filter(a => a.getBoundingClientRect().height > 0).length);
if (links < 5) { failures++; console.log(`not ok - index.html sans JavaScript : menu inaccessible (${links} lien(s) visibles)`); }
await browser.close(); server.close();
console.log(failures ? `${failures} échec(s)` : `ok - ${pages.length} pages × 3 largeurs, CLS < 0,1 ; menu de l'accueil utilisable sans JavaScript`);
process.exit(failures ? 1 : 0);
