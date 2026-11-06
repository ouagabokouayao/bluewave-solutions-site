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
    'services.html': ('795c24d1722a8c9b9bbe9e4b009462e4a87609faa46acda1b5d492b30436acfe',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'preuves-demonstrateurs.html': ('e13de1057ce05a562c493279dc1d0511ac4e86def2ffcd293288a2ea71fa5026',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'notes-demonstrateurs.html': ('d20ec17e43b969bddcd2478b862912220a463327da4aa3ac42fc647221e66ea6',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'methode.html': ('7b7b62497b6146716506ef9d032519a7037110d85311b2a8036d4dbc554eae86',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'mediatheque.html': ('95c05c0f858fdd3138c52a0a91ca50c7636fb436df5b5a19fffbcc7a43adeea0',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'mediatheque-visualisations.html': ('178cbd1d68bc463bc52e57aad3a4bf52801ca11fadd6ef964aaaf4bd376321fa',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'mediatheque-activites.html': ('1f96f54d0e73ac26270413f960c21daf80cca31d6b636581c26810cc9291a4dd',
        'V3-FIN : accessibilité et performance de l’accueil'),
    'media-intervention.html': ('39b6186c64d08fc08aa587967bb0ebd2ac9393b89291ae0482ef34126123ac78',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'domaines.html': ('2aaf8f571143faf41a78c18c04828603f843addc4988337a0c9cf3c624ad8812',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'contact.html': ('3a0e36c6b0f2b316cc4aabfe0bf8b94c85e416a7bbf9e5986688d236e1c42c32',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'assets/js/actualites.js': ('eee659f0aeb4ceebc0fdf7c2057d92ba67f8b7a6b3f1930acff45209f8f97dbd',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'a-propos.html': ('72de8126d6a27ae17fc3d57aeb618e3d208afd199dfcb5e5735addeb0fa38343',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    '404.html': ('e39d0291ca7dddcc4859e7fe83e84126039e43bd3f7790a8d00cff459ae53c0a',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'quality/scripts/quality_check.py': ('bea18b4870961067706a76cd3babc47f616b3e79d6efe9b8b11c3af1b244b14f',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'assets/js/lead-schema.js': ('06640eb09919da8eaaa152852cbaad046c8a46de37eb71f80b70d359081d64a2',
        'W14 : contrat navigateur-serveur et perte de réponse'),
    'serverless/cloudflare/worker.mjs': ('e2dbf6f7404886c0cd8b1b5422c0be4c2bc7acbbb02a580b9e4ed36d0090f7f6',
        'V3-FIN : canonical racine, redirections et profils A et B'),
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
    'actualites.html': ('738cb185062c50aa24892abce7ffdd406658af7340991254b2f579fbbd328cc6',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'politique-confidentialite.html': ('13f525b3bcba3d91c9552bb1e8eeec4488332d0d37a85cc68721612ab4533b05',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'mentions-legales.html': ('5b8185ef10b06aba6c30490e294c3b9eb9e2e00079effda26cf131a80120aaa7',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'solutions.html': ('6ef6d1bd85a6e49f0a0fae9ba33dfdb0316cfb18dae782d591bee4d93470aa4c',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'quality/scripts/build_dist.py': ('f5c2c1bfe334dad6bbe5b0e11cb8f3650c9fe21799ec59fb76b3945468aebe7c',
        '02-E11 : seules les pages suivies par Git entrent dans le site servi'),
    'serverless/cloudflare/PRODUCTION.md': ('4546f82f44d37c2f90ab12de981e6e15b13249a03e13392d2d0f8d7d11bbf356',
        'V3-FIN : canonical racine, redirections et profils A et B'),
    'data/actualites.json': ('dfc7ac62fb5befca4ec0917a78332e47a00021a350b533bb3d70dc736c510cf8',
        '02-E11 : veille actualisée le 16/10/2026 par le collecteur existant (sources vérifiées)'),
    'data/actualites-status.json': ('5f1422c2ac5e4abf2f21ecb736cb22402265f5bd6ce253edeac3c387b239f377',
        '02-E11 : état de la veille du 16/10/2026'),
    'assets/css/premium.css': ('04d3cd4a77f3572000b774940b4abc55aaebe23e3b13f9369fb8578a410e7790',
        'V3-FIN : adresse insécable sur écran étroit'),
    'assets/js/automation.js': ('57767492f2921228468e7d1f8ac929e9e9e5feb19815af27a50297137bd48d0d',
        'W14 : contrat navigateur-serveur et perte de réponse'),
    'assets/js/qualifier.js': ('665d345fda61c0373462c4dc724cefcc97979ed29250b8942e9e17f2b426f1b7',
        'W14 : contrat navigateur-serveur et perte de réponse'),
    'quality/scripts/build_production_dist.py': ('201307113c1883074a4cd4b9b8eee7a03ddec5d066f736eff0009b619e19bc5b',
        'V3-FIN : canonical racine, redirections et profils A et B'),
    'quality/tests/test_production.py': ('b9ca15a2b945c9adb0aaf0ea7d42924bd8cb68c8f0bb0306bb64550f1430a5c1',
        'V3-FIN : canonical racine, redirections et profils A et B'),
    'projet.html': ('4c8232abb6d976005ad59d2d6aeb24f2fed07cf0b4da355c89a53a9742fff3ef',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'collaboration.html': ('00977fa92ac111557cb62e465068f34413937da3eaa3faf09c49fd059189351c',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'formation.html': ('066266a9f2a12fa7c2f14b991b042b8a54a033aa5538898231c730eb0cffd98d',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'qualifier-un-besoin.html': ('aa811f1a73e78b376c500c8689e3eae6c06bb2784a6ebec8633ebec4cb8569a0',
        'V3-FIN : accessibilité et performance de l’accueil'),
    'assets/js/journey-form.js': ('49ede1e58599668e55ccf269a70ceb3b6f630baa7fa17761947240020d9b8e0d',
        'W14 : contrat navigateur-serveur et perte de réponse'),
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
            if path == 'assets/js/actualites.js' and path not in AUTHORIZED_VERSIONS and before != target.read_bytes():
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
