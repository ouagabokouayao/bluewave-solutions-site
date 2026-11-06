#!/usr/bin/env python3
"""Contrôle de conservation du socle A01 lors de l'intégration de l'accueil."""
import hashlib
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
BASE = '70b683105ca2e660dc21076173d0f019fe6e1bd7'
ALLOWED = {'index.html', 'MANIFEST_SHA256.json', 'quality/scripts/update_manifest.py', '.github/workflows/site-quality.yml'}
# V03 est autorisée exclusivement dans renderStatus ; les données, filtres,
# cartes et parcours historiques restent contrôlés octet pour octet.
STATUS_BLOCK = re.compile(rb'  const renderStatus = \(status\) => \{.*?\n  const renderHome =', re.S)
# Correctifs 02 du 15/10/2026 : chaque fichier ne peut différer du socle que
# dans sa version exacte épinglée ici. Toute autre modification échoue.
AUTHORIZED_VERSIONS = {
    'quality/scripts/quality_check.py': ('b735feef9fd64f8feca8d98e6e46e37de5c46234476e9bd04b9223c4798dc36a',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'assets/js/lead-schema.js': ('d9924611f458a026412b38d6aaf3b9d02d6830e5e00bd9b431d13c45ae031526',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'serverless/cloudflare/worker.mjs': ('d5966270c7f7c563f8ddc51fbf18f0f2a0a05bb49014d685eb4c4484ec07f450',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/tests/readiness.test.mjs': ('a6e3e86279b3940436060cc2057447bbe37c5c551a722114e300d7153c62e2eb',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/tests/operations.test.mjs': ('df4f220e4173c199cc9749bc16589015697e492790fe54afbbc0480fddda01d4',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/tests/native-worker.check.mjs': ('6f337a6e1f3c814f9177c0e80be9ee70d400827583551c007f1a1d1d90031d6e',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/readiness.mjs': ('068615aecee362a58d28c3ca8aaffbaea5ed60c89f5139431f4245b60c4c2ce2',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/tests/replay.test.mjs': ('1ef2823cd7877f8db024336c2db4661f2aecd1b2546c0b27858d5748565c28b8',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/tests/pipeline.test.mjs': ('3edea76748c4950eefbd7a77ca578abff1b5c842fe9895d26dee27262f5c8fdb',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/tests/handler.test.mjs': ('2547b7c24c2252131dd52a21162eee3e885173bcaa73c35c04148ade1590ecb1',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/tests/a01.test.mjs': ('6dadfa6013a1ca3159c62aaefab11ee74c0c5aae07c294208ba7afbd7a698302',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'serverless/bluewave-leads/replay.mjs': ('94bcec7818124936e20710a43bcaa165d6e272b7d76bf7d14fd98aefee16e84b',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/lead-store.mjs': ('4e47cb37590216e24995eb9dc7029f6460b69c25c97b10b4dbe0800d695faec9',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/bluewave-leads/handler.mjs': ('e0ad6fd6261659211e9d9aa4663ec3809c58973308d55b6c2db141eceecb512a',
        'W14-P0 : correctif et preuve de non-régression'),
    'quality/scripts/render_production_wrangler.py': ('f87a8c0b6a9b1f8005c79f596bbbf0ebae045a35841b8b07b9648fe3ca892e30',
        'W14-P0 : correctif et preuve de non-régression'),
    'actualites.html': ('fc329660a9374081785f5ecadc3b0523adc3c203cf1297fe5ba19f34cd31f657',
        'W14-P0 : correctif et preuve de non-régression'),
    'politique-confidentialite.html': ('0e6dbff92524322bf983d2f451bd2f773de9d37715cb292e2ab755fb2df290aa',
        '02-E7/E12 : Gmail identifié ; bases, durées et droits selon 04B ; téléphone non confirmé retiré'),
    'mentions-legales.html': ('4d77759ab82b1009ed86f9172095d3940118732efebd2e3d69c6eeed6eda24ae',
        '02-E12 : téléphone non confirmé retiré et rangé parmi les informations non encore acquises'),
    'solutions.html': ('4ca76012aa133993279aeef912bca4b3e25b6e789925d40026e7ff83a15986bb',
        '02-E12 : déclinaisons spécialisées rattachées aux cinq offres cœur (arbitrage 01)'),
    'quality/scripts/build_dist.py': ('f5c2c1bfe334dad6bbe5b0e11cb8f3650c9fe21799ec59fb76b3945468aebe7c',
        '02-E11 : seules les pages suivies par Git entrent dans le site servi'),
    'serverless/cloudflare/PRODUCTION.md': ('25d3493b05439f6630d932b2eca8c297d8390a600a7488bdf524f714ac827331',
        'W14-P0 : sécurité des formulaires et profil de publication'),
    'data/actualites.json': ('dfc7ac62fb5befca4ec0917a78332e47a00021a350b533bb3d70dc736c510cf8',
        '02-E11 : veille actualisée le 16/10/2026 par le collecteur existant (sources vérifiées)'),
    'data/actualites-status.json': ('5f1422c2ac5e4abf2f21ecb736cb22402265f5bd6ce253edeac3c387b239f377',
        '02-E11 : état de la veille du 16/10/2026'),
    'assets/css/premium.css': ('3174097d86fcb9bd6de8ca185b7b33c6ee2bed5ea9304fccf459f16a1f13b90d',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'assets/js/automation.js': ('16366bddae3af93c28b48ea2eb0af1b473641c970c91d3da1fd93059fcca651d',
        '02-E6 : option newsletter fermée masquée ; modules optionnels résolus sur la base du document'),
    'assets/js/qualifier.js': ('01d6b51fc57c8b41cbf83d64a4f0c4a20dc2b3948a72c1a902a34b698a9a1d6d',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'quality/scripts/build_production_dist.py': ('39027049f76affbae9c2bbbec3a6e2a7ca096e2b95f0fbe5abdcfc0b9daef92b',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'quality/tests/test_production.py': ('0cd7f784bca3e833a8b65633b2019a5dd4a5f0d3d277a1507bb7b1a4934449af',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'projet.html': ('d5d052935e7680013f07d2bb1ca31f9bfedd255054630938790a7e3202231548',
        '02-E1 : sept questions de qualification distinguées des quatre étapes du parcours'),
    'collaboration.html': ('ce9afa59c2183417efce7aa7b622ac1e892806ec28b0fd2e7ad2738e3325c053',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'formation.html': ('00dc3581b86d94d2ae4c35a932094d363e8a7c135e08cef5b352ee157077d73d',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'qualifier-un-besoin.html': ('3f33eee088546664bd93e1fcc25358102d57a039ac68aa9cf676396cc526c52c',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
    'assets/js/journey-form.js': ('b1e20a570b9aa280bf48d0c2d08c133333cdfce55f7eee989a1c0bd637871b92',
        'V3-FIN : formulaires, messages et repli sans JavaScript'),
}
def outside_news_status(content):
    if len(STATUS_BLOCK.findall(content)) != 1:
        raise ValueError('Bloc renderStatus absent ou ambigu')
    return STATUS_BLOCK.sub(b'  const renderHome =', content)
class Page(HTMLParser):
    def __init__(self):
        super().__init__(); self.links=set(); self.ids=set(); self.scripts=set(); self.offers=set()
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='a' and a.get('href'): self.links.add(a['href'])
        if a.get('id'): self.ids.add(a['id'])
        if tag=='script' and a.get('src'): self.scripts.add(a['src'])
        if a.get('data-offer'): self.offers.add(a['data-offer'])
def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT)
def main():
    errors=[]
    authorized=[]
    paths=git('ls-tree','-r','--name-only',BASE).decode().splitlines()
    preserved=[]
    for path in paths:
        target=ROOT/path
        if not target.is_file(): errors.append('Fichier perdu : '+path); continue
        if path not in ALLOWED:
            before=git('show',BASE+':'+path)
            if path == 'assets/js/actualites.js' and before != target.read_bytes():
                try:
                    if outside_news_status(before) != outside_news_status(target.read_bytes()):
                        errors.append('Modification Actualités hors statut autorisé')
                    else:
                        authorized.append('assets/js/actualites.js:renderStatus uniquement (V03)')
                except ValueError as error:
                    errors.append(str(error))
                continue
            current=target.read_bytes()
            if path in AUTHORIZED_VERSIONS and before!=current:
                pinned,reason=AUTHORIZED_VERSIONS[path]
                if hashlib.sha256(current).hexdigest()==pinned: authorized.append(f'{path}: {reason}')
                else: errors.append('Modification hors version autorisée : '+path)
                continue
            if before!=current: errors.append('Modification hors accueil : '+path)
            else: preserved.append(path)
    old=Page(); old.feed(git('show',BASE+':index.html').decode())
    now=Page(); now.feed((ROOT/'index.html').read_text())
    for link in sorted(old.links-now.links): errors.append('Lien accueil perdu : '+link)
    for script in sorted(old.scripts-now.scripts): errors.append('Script accueil perdu : '+script)
    expected={'diagnostic-strategique','vulnerabilite-cotiere','gouvernance-acteurs','structuration-projet','formation-capacites','note-strategique','atelier-cadrage'}
    if now.offers!=expected: errors.append('Sept entrées commerciales non canoniques')
    for page in ROOT.glob('*.html'):
        p=Page();p.feed(page.read_text())
        for link in p.links:
            u=urlsplit(link)
            if u.scheme or link.startswith('//'): continue
            target=(ROOT/unquote(u.path)).resolve() if u.path else page
            if not target.is_file(): errors.append(f'{page.name}: cible absente {link}'); continue
            if u.fragment and target.suffix=='.html':
                dest=Page();dest.feed(target.read_text())
                if unquote(u.fragment) not in dest.ids: errors.append(f'{page.name}: ancre absente {link}')
    result={'status':'FAIL' if errors else 'PASS','base':BASE,'baseline_files':len(paths),'unchanged_baseline_files':len(preserved),'unchanged_pages':len([x for x in preserved if x.endswith('.html')]),'authorized_modifications':authorized,'old_home_links_preserved':len(old.links-now.links)==0,'old_home_scripts_preserved':len(old.scripts-now.scripts)==0,'canonical_offers':sorted(now.offers),'errors':errors}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return bool(errors)
if __name__=='__main__': raise SystemExit(main())
