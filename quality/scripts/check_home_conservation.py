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
    'serverless/cloudflare/tests/guard.test.mjs': ('c9dd63362ff484439a78f9d647c01da6a2595cf9e58a4ee46b61d72320b7ee9f',
        'Idempotence durable des demandes'),
    'serverless/cloudflare/tests/d1-native.test.mjs': ('b0153a6e2f0cc8a08212c5e4c182b7f860963ba4403b3a2a3d245a80ad0b0024',
        'Idempotence durable des demandes'),
    'serverless/cloudflare/leads-schema.sql': ('30fcb930dfc279209b7508959ce3840b68775974c85aa7d4c0b2c965ec00f007',
        'Idempotence durable des demandes'),
    'serverless/cloudflare/guard.mjs': ('abe38d6ecfbf6cbaf2d43d336d1d8031f63c352801b1d475309e8d3e5e26c264',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/tests/lead-store.test.mjs': ('1c892a7f6a69f70b184cbc36853d837bbe2373b8d8c5b2c268a9c3f965411050',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/tests/d1-double.mjs': ('a5d8b8698f0039c9ad14a365c65ae894a37a70aa812ee24782e21967d2f6d43a',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/security.mjs': ('b8a91daadacde6c7cbc29ebf4b1dbd1b46a30dbbc505b6ad965365539a261a36',
        'Idempotence durable des demandes'),
    'serverless/a01/README.md': ('dc980d700292c557469b4aa8cc199e125737f3a4cacd3bf665911ca65a84947c',
        'Idempotence durable des demandes'),
    'serverless/OPERATIONS.md': ('74e58ac30ad7130d91783838f1b6c581bce6539e6238147e8abbf5d733f5340a',
        'Idempotence durable des demandes'),
    'quality/privacy-approval.json': ('ad6ade641db60c6a220e307c887db5194c6a7a902f60fc5dd7246e2217141247',
        'Lettre de veille : page dédiée sous option de build'),
    'serverless/bluewave-leads/tests/newsletter.test.mjs': ('a1f83892f891fda47391a672291595663e6207876cc41b93e117dd44897d7f75',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/bluewave-leads/observability.mjs': ('bccfb2cc752fc4cba84e2689b687e24e3fe4e02d0b4ee3a7f7e221bcb10d8fa5',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/bluewave-leads/newsletter.mjs': ('58a73c22510e66bc2851f8ef4debb7a4be45425b981d2a0007e118a7a8ee604c',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/a01/newsletter-test-schema.sql': ('d458e0ca74c4a717e0d03f206f1f4d05ef6f843d0711ba5837038b7aa067fb6b',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/a01/newsletter-test-channel.mjs': ('db4c7757c0ce7eb9c6ee35a5ae8b1d486def2b83c26429f7cf487641ddf12753',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.production.jsonc': ('830fa47468cf25ba1835769915efc4cde68cee7e30fc6f6680b3ace39f29ce23',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.preproduction.jsonc': ('fbff2992d0f75358351e1f1159497ef4c7f50f104876c3046c369d69d1967641',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.jsonc': ('619cb1b3f36a722535e9f56f3c9f6768d3bfec6f899718cb2f077a2cca188e2b',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/bluewave-leads/brevo-client.mjs': ('c81a167f5be75a8543582ecdc2fcd8be2d6f579dabc676128d4205e24240d87b',
        'W14 : interrupteurs indépendants et contrat de reprise'),
    'serverless/bluewave-leads/.env.example': ('2fff0663e6764bfd77b431d32a3b6d5d59335efa8bcd1f2303ee0f88cd6d3246',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
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
    'serverless/cloudflare/worker.mjs': ('63180008df2eb4e7c0a9225523d1998c610207b12f6725bd37adf93996968b39',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/tests/readiness.test.mjs': ('82bd1b62b617ca44d73475beae8b17ddd48a4454046b7a51244e97d8996c1a77',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/tests/operations.test.mjs': ('df4f220e4173c199cc9749bc16589015697e492790fe54afbbc0480fddda01d4',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/tests/native-worker.check.mjs': ('dd685a6e2b372f67f4f553ff7557904807d9b852a65c6cae131fe3135baf5186',
        'Idempotence durable des demandes'),
    'serverless/cloudflare/readiness.mjs': ('a96dd9560a269d96cc726ff68718d4fe3ad16af29dbd719ffdf8772a34dc085b',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/bluewave-leads/tests/replay.test.mjs': ('96ad9218494d506d137524654a2e20fd9ea845a230ecab2eb9231e9ce4565158',
        'W14 : interrupteurs indépendants et contrat de reprise'),
    'serverless/bluewave-leads/tests/pipeline.test.mjs': ('47999ebf45be1dc3ba4809b189436304c8f7a4f5fd434e2ec122785575324341',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/tests/handler.test.mjs': ('af15fd238f936477612fe41c9e3f63213e24d84de151a0a69f49d87440d1f46f',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/tests/a01.test.mjs': ('f02c60cb2319c4237eb35a87db619770736f434a7dd6d5ef37047fd4561188cf',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/replay.mjs': ('a27fd68c12f8132b13bbff6ea7e7598ad96a4f43cd939c172c7803148a92f4b4',
        'W14 : interrupteurs indépendants et contrat de reprise'),
    'serverless/bluewave-leads/lead-store.mjs': ('8dfe3603a2221f9a9e32a479e1276f1eeedc1b6f8780806458566fad19ecb0ed',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/handler.mjs': ('d86b952c12b228d945712a407cb3181698ef485633636c0e8aeb60487467eab7',
        'Idempotence durable des demandes'),
    'quality/scripts/render_production_wrangler.py': ('8ce33e4972c270b207fe4c661d4444338531dea76e7ba3ca9a1045c782b17330',
        'Lettre de veille : page dédiée sous option de build'),
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
    'serverless/cloudflare/PRODUCTION.md': ('7b63172a782100919e15b188c3a4907128aa790eed84bd2eb5b961c94f2e938a',
        'Lettre de veille : page dédiée sous option de build'),
    'data/actualites.json': ('dfc7ac62fb5befca4ec0917a78332e47a00021a350b533bb3d70dc736c510cf8',
        '02-E11 : veille actualisée le 16/10/2026 par le collecteur existant (sources vérifiées)'),
    'data/actualites-status.json': ('5f1422c2ac5e4abf2f21ecb736cb22402265f5bd6ce253edeac3c387b239f377',
        '02-E11 : état de la veille du 16/10/2026'),
    'assets/css/premium.css': ('04d3cd4a77f3572000b774940b4abc55aaebe23e3b13f9369fb8578a410e7790',
        'V3-FIN : adresse insécable sur écran étroit'),
    'assets/js/automation.js': ('d77a3fad2165b8c4aea1dd27845de09a6e667380f4eb85cc280d53fd861b85ce',
        'Idempotence durable des demandes'),
    'assets/js/qualifier.js': ('665d345fda61c0373462c4dc724cefcc97979ed29250b8942e9e17f2b426f1b7',
        'W14 : contrat navigateur-serveur et perte de réponse'),
    'quality/scripts/build_production_dist.py': ('750d078221a3ee09ab8188eea843ee839cb60cc7c1980b439bc4d68a4cb86ae5',
        'Lettre de veille : page dédiée sous option de build'),
    'quality/tests/test_production.py': ('b8067a5c1405e2b0f83a8f2471f5941acdf39c3adf4f019e4de12b5216c3fcdf',
        'Lettre de veille : page dédiée sous option de build'),
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
