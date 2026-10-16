// Garde d'accessibilité : axe-core, règles WCAG 2.0/2.1 A et AA, sur les
// 21 pages du build servi, à 390 et 1440 px. Toute violation fait échouer.
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';

process.on('uncaughtException', e => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Garde accessibilite::${String(e.message).slice(0, 300)}`); console.error(e); process.exit(2); });
process.on('unhandledRejection', e => { if (process.env.GITHUB_ACTIONS) console.log(`::error title=Garde accessibilite::${String(e?.message || e).slice(0, 300)}`); console.error(e); process.exit(2); });

const require = createRequire(import.meta.url);
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
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();

const browser = await chromium.launch();
let violations = 0;
for (const width of [390, 1440]) {
  const page = await browser.newPage({viewport: {width, height: 900}});
  for (const name of pages) {
    await page.goto(`${base}/${name}`, {waitUntil: 'networkidle'});
    await page.addScriptTag({content: axeSource});
    const found = await page.evaluate(async () => (await axe.run(document, {
      runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']},
      resultTypes: ['violations']
    })).violations.map(v => `${v.id} (${v.impact}) ×${v.nodes.length} : ${v.nodes[0].target.join(' ')}`));
    for (const line of found) {
      violations++;
      console.log(`not ok - ${name} @${width}px — ${line}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::error title=WCAG ${name} @${width}px::${line}`);
    }
  }
  await page.close();
}
await browser.close(); server.close();
console.log(violations ? `${violations} violation(s)` : `ok - ${pages.length} pages × 2 largeurs, aucune violation WCAG A/AA`);
process.exit(violations ? 1 : 0);
