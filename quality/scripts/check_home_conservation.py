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
    'politique-confidentialite.html': ('ad97a33b9239ea3fde5bcd79ed82a58a355256babec020d582359dff0047801a',
        '02-E7 : messagerie de réception Gmail mentionnée'),
    'assets/css/premium.css': ('9adb0e28f557a662b1ce715e044edd108a78942871da07f95ead1721ee4a791b',
        '02-E8/E10 : numéros de format au contraste WCAG ; cases fermées masquées par la feuille (CSP)'),
    'assets/js/automation.js': ('16366bddae3af93c28b48ea2eb0af1b473641c970c91d3da1fd93059fcca651d',
        '02-E6 : option newsletter fermée masquée ; modules optionnels résolus sur la base du document'),
    'assets/js/qualifier.js': ('638ae1c302efdd8f77fd81320582b2ceea3737ae43bbf32cbab7f2f9b7710585',
        '02-E6 : courriel du parcours Projet complet et message copiable'),
    'quality/scripts/build_production_dist.py': ('b109bc948f6b0d9ca2c8ebc9d3d28e7ff4f0b06a33e8c8abd14a28e71e334cc3',
        '02-E5 : page 404 fonctionnelle à la racine du domaine en production'),
    'quality/tests/test_production.py': ('a48b7772f5e1e9c02f08471f3f010c2eb07b5f702141fa154ba084ca283b8383',
        '02-E5 : test de la page 404 à la racine du domaine'),
    'projet.html': ('d5d052935e7680013f07d2bb1ca31f9bfedd255054630938790a7e3202231548',
        '02-E1 : sept questions de qualification distinguées des quatre étapes du parcours'),
    'collaboration.html': ('304ad15f07c1360e201b97c12a569a055e239031cc1209094c694d36a68f868f',
        '02-E3 : alternative courriel sans JavaScript'),
    'formation.html': ('06ec9eea812d3506f12d55b04c9aa814882d9c8e5c16b1f5d4b0369f239cb173',
        '02-E3 : alternative courriel sans JavaScript'),
    'qualifier-un-besoin.html': ('7824c1567951b67087a09339ab047c40d5a44a81938720e5e0c98d683da1fdca',
        '02-E3/E6/E10 : alternative courriel sans JavaScript ; option newsletter fermée masquée sans attribut style'),
    'assets/js/journey-form.js': ('972e632fd283eb078071a507554dc41dbe2d3497ca3199e39ee1a66b6683329c',
        '02-E2/E4 : courriel de repli complet et message copiable pour les trois formulaires de parcours'),
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
