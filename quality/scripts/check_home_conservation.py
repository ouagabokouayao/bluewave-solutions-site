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
    'serverless/cloudflare/tests/production.test.mjs': ('0b8c1cc9bd4e77edeeef193fa9aefb11a23c6e01cfbb76677b14ac47945897a1',
        'Alias historique sans barre finale'),
    'serverless/a01/reporting.mjs': ('bedb0c2c1d8585294fc0a594b108544bb501e913f49d96b3b2e4ce8f97693a2f',
        'Issue inconnue chez Brevo'),
    'serverless/a01/contracts.mjs': ('f570b00962552777b40b0108e02e30d8cf9bad869cffb7dea3856749dad80e46',
        'Retrait inscriptions fermées et supervision'),
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
    'serverless/bluewave-leads/tests/d1-double.mjs': ('d882b60ee85a3c1d78bfd0b5b217bba681c4b2015e8782cfd7b672e931d6c7ed',
        'Retrait inscriptions fermées et supervision'),
    'serverless/bluewave-leads/security.mjs': ('b8a91daadacde6c7cbc29ebf4b1dbd1b46a30dbbc505b6ad965365539a261a36',
        'Idempotence durable des demandes'),
    'serverless/a01/README.md': ('dc980d700292c557469b4aa8cc199e125737f3a4cacd3bf665911ca65a84947c',
        'Idempotence durable des demandes'),
    'serverless/OPERATIONS.md': ('39c16cb428757f4f75798f835f8dc786c02a2b6cd656dbdd5646275bf5d2b2ab',
        'Textes de 02 pour BlueWave Perspectives'),
    'quality/privacy-approval.json': ('ad6ade641db60c6a220e307c887db5194c6a7a902f60fc5dd7246e2217141247',
        'Lettre de veille : page dédiée sous option de build'),
    'serverless/bluewave-leads/tests/newsletter.test.mjs': ('64bb965cedf984522d98779a1314f45ce509e6356ae794d31144071f5f064bd3',
        'Retrait inscriptions fermées et supervision'),
    'serverless/bluewave-leads/observability.mjs': ('dac1d3d0b298de5b78e501c86796b91618ee3931dfd5c31f7ef1e8dbe28acb7d',
        'Retrait inscriptions fermées et supervision'),
    'serverless/bluewave-leads/newsletter.mjs': ('2f1645794f6c7c3acffac151b69777dfa1540242869671a5ae9cf49eb8755365',
        'Retrait inscriptions fermées et supervision'),
    'serverless/a01/newsletter-test-schema.sql': ('c072876ddfaf55fafdde75388c44c3bba3f1d540dd7cf69e36190107d2c35387',
        'Retrait inscriptions fermées et supervision'),
    'serverless/a01/newsletter-test-channel.mjs': ('db4c7757c0ce7eb9c6ee35a5ae8b1d486def2b83c26429f7cf487641ddf12753',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.production.jsonc': ('830fa47468cf25ba1835769915efc4cde68cee7e30fc6f6680b3ace39f29ce23',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.preproduction.jsonc': ('fbff2992d0f75358351e1f1159497ef4c7f50f104876c3046c369d69d1967641',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/cloudflare/wrangler.jsonc': ('619cb1b3f36a722535e9f56f3c9f6768d3bfec6f899718cb2f077a2cca188e2b',
        'Lettre de veille : jetons opaques, usage unique en base, retrait exécuté'),
    'serverless/bluewave-leads/brevo-client.mjs': ('c3e9d28b392131381f504dc7edfbebffe8698615e1a4b88c57f72b99dc491980',
        'Issue inconnue chez Brevo'),
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
    'serverless/cloudflare/worker.mjs': ('d66fcfd8994a548b0b956d1453ec418fc94f85a142651847404f957e22e84b53',
        'Retrait inscriptions fermées et supervision'),
    'serverless/cloudflare/tests/readiness.test.mjs': ('cb74ca6ce9defb248861ad05a1fcec35d57734c40feb1b4888d4d2ae8dae1bca',
        'Retrait inscriptions fermées et supervision'),
    'serverless/cloudflare/tests/operations.test.mjs': ('df4f220e4173c199cc9749bc16589015697e492790fe54afbbc0480fddda01d4',
        'W14-P0 : correctif et preuve de non-régression'),
    'serverless/cloudflare/tests/native-worker.check.mjs': ('dd685a6e2b372f67f4f553ff7557904807d9b852a65c6cae131fe3135baf5186',
        'Idempotence durable des demandes'),
    'serverless/cloudflare/readiness.mjs': ('5c523938078c3c47e7058649da841198c22dfb7d8cddc62e48db74f4e8a24be8',
        'Retrait inscriptions fermées et supervision'),
    'serverless/bluewave-leads/tests/replay.test.mjs': ('8c628ed2729d37c3b5e1708fa9d5ac7b8bfaf67e09263d6441e27068f6c41877',
        'Issue inconnue chez Brevo'),
    'serverless/bluewave-leads/tests/pipeline.test.mjs': ('dccf813a00a5ea5e6561a2c0c585a64f6bca3b8c603a259a5ead15df327a34e8',
        'Cas W14 panne D1 avec la garde réelle'),
    'serverless/bluewave-leads/tests/handler.test.mjs': ('af15fd238f936477612fe41c9e3f63213e24d84de151a0a69f49d87440d1f46f',
        'Idempotence durable des demandes'),
    'serverless/bluewave-leads/tests/a01.test.mjs': ('854b349e04033a0c7ff4964b76baee7ac38eeb093add6c219de207c4048c24a9',
        'Issue inconnue chez Brevo'),
    'serverless/bluewave-leads/replay.mjs': ('3a8e5892347bed2cbcdbe02a39a4f83922ba668abf7224f802eaa1adcafa5886',
        'Issue inconnue chez Brevo'),
    'serverless/bluewave-leads/lead-store.mjs': ('2a6a47fa7a19f8fa1fac1253fa85dfaa537e78db54c9d3a3ae5d4403be291fcb',
        'Retrait inscriptions fermées et supervision'),
    'serverless/bluewave-leads/handler.mjs': ('96705784394532a785ff0abdf5cdc5204ce61ed3db9f02f4f76a00e3fa9f63b5',
        'Issue inconnue chez Brevo'),
    'quality/scripts/render_production_wrangler.py': ('8ce33e4972c270b207fe4c661d4444338531dea76e7ba3ca9a1045c782b17330',
        'Lettre de veille : page dédiée sous option de build'),
    'actualites.html': ('827969d36c4026a3fdf6fe0cd0f28b742fb6f09e50da2aa7ef5e5490805b8dfb',
        'Textes de 02 pour BlueWave Perspectives'),
    'politique-confidentialite.html': ('13f525b3bcba3d91c9552bb1e8eeec4488332d0d37a85cc68721612ab4533b05',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'mentions-legales.html': ('5b8185ef10b06aba6c30490e294c3b9eb9e2e00079effda26cf131a80120aaa7',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'solutions.html': ('6ef6d1bd85a6e49f0a0fae9ba33dfdb0316cfb18dae782d591bee4d93470aa4c',
        'V3-FIN : textes visiteur, navigation, images et veille'),
    'quality/scripts/build_dist.py': ('f5c2c1bfe334dad6bbe5b0e11cb8f3650c9fe21799ec59fb76b3945468aebe7c',
        '02-E11 : seules les pages suivies par Git entrent dans le site servi'),
    'serverless/cloudflare/PRODUCTION.md': ('3b7a447cf79d307b17254504388bfe310878367323b5389ac38d824994120e47',
        'Alias historique sans barre finale'),
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
    'quality/scripts/build_production_dist.py': ('33a7703f8580dc4ac347c25ed15908776678fb5f0e4fed2f36af5e2c4f934b66',
        'Textes de 02 pour BlueWave Perspectives'),
    'quality/tests/test_production.py': ('7cdfe8d7b669720ef37753c3de330b521dfdc0d3519bd63ad518a33ed7904e95',
        'Textes de 02 pour BlueWave Perspectives'),
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
