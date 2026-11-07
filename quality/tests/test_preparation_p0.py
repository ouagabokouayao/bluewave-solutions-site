"""Préparation du profil A : DNS, messagerie, BlueWave Perspectives et radar.

Fichier distinct, hors du socle de conservation. Aucun test ne contacte un service.
"""
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dns = load('compare_dns', 'quality/scripts/compare_dns.py')
radar = load('radar_export_crm', 'quality/scripts/radar_export_crm.py')
build = load('production_build', 'quality/scripts/build_production_dist.py')
REFERENCE = json.loads(dns.REFERENCE.read_text(encoding='utf-8'))
CLOUDFLARE_EXPORT = """;; Exportation de zone fictive, au format BIND
$ORIGIN bluewavesolutions.fr.
@ 3600 IN SOA ns.cloudflare.com. dns.cloudflare.com. 1 10000 2400 604800 3600
bluewavesolutions.fr. 86400 IN NS ana.ns.cloudflare.com.
bluewavesolutions.fr. 1 IN MX 1 mx1.mail.ovh.net.
bluewavesolutions.fr. 1 IN MX 5 mx2.mail.ovh.net.
bluewavesolutions.fr. 1 IN MX 100 mx3.mail.ovh.net.
bluewavesolutions.fr. 1 IN TXT "v=spf1 include:mx.ovh.com -all"
www.bluewavesolutions.fr. 1 IN CNAME bluewave-site-production.workers.dev.
"""


class Dns(unittest.TestCase):
    def test_reference_conforme_a_la_sauvegarde(self):
        self.assertEqual(REFERENCE['soa_serial'], 2092849087)
        self.assertEqual(len(REFERENCE['enregistrements']) + 3, 12, 'neuf enregistrements, plus SOA et deux NS')
        self.assertTrue(REFERENCE['fournisseur']['dnssec']['actif'])
        self.assertIn('DKIM', REFERENCE['absents'])
        self.assertIn('DMARC', REFERENCE['absents'])

    def test_zone_cible_conserve_la_messagerie(self):
        rows, critical = dns.compare(CLOUDFLARE_EXPORT, REFERENCE)
        states = {(key[0], key[1], key[2]): state for state, key, _ in rows}
        self.assertFalse(critical)
        self.assertEqual(states[('@', 'MX', '1 mx1.mail.ovh.net')], 'OK')
        self.assertEqual(states[('@', 'TXT', 'v=spf1 include:mx.ovh.com -all')], 'OK')
        self.assertEqual(states[('www', 'A', '213.186.33.5')], 'ABSENT')
        self.assertEqual(states[('www', 'CNAME', 'bluewave-site-production.workers.dev')], 'EN PLUS')
        self.assertNotIn('SOA', {key[1] for _, key, _ in rows})

    def test_messagerie_manquante_ou_modifiee_fait_echouer(self):
        for broken in (CLOUDFLARE_EXPORT.replace('MX 5 mx2', 'MX 5 mx9'), CLOUDFLARE_EXPORT.replace('include:mx.ovh.com', 'include:autre.example')):
            self.assertTrue(dns.compare(broken, REFERENCE)[1])

    def test_ligne_de_commande(self):
        with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False) as zone:
            zone.write(CLOUDFLARE_EXPORT)
        result = subprocess.run([sys.executable, str(ROOT / 'quality/scripts/compare_dns.py'), zone.name], capture_output=True, text=True)
        Path(zone.name).unlink()
        self.assertEqual(result.returncode, 0)
        self.assertIn('DNSSEC actif', result.stdout)


class Messagerie(unittest.TestCase):
    SIGNATURES = sorted((ROOT / 'private/prepublication/brand/contact-kit/signatures-v2').glob('*.html'))

    def test_quatre_signatures_conformes(self):
        self.assertEqual([path.stem for path in self.SIGNATURES], ['contact', 'direction', 'partenariats', 'projets'])
        for path in self.SIGNATURES:
            text = path.read_text(encoding='utf-8')
            self.assertIn('TEMP — DO NOT PUBLISH', text)
            self.assertIn(f'mailto:{path.stem}@bluewavesolutions.fr', text)
            self.assertEqual(re.findall(r'<img [^>]*src="([^"]+)"', text), ['https://www.bluewavesolutions.fr/assets/img/brand/logo/logo-bluewave-horizontal-officiel.png'])
            self.assertIn('alt="BlueWave Solutions"', text)
            for required in ('Comprendre la mer. Éclairer la décision.', 'SASU en cours de constitution', '#0A2540', '#005BAA', '#00A6A6'):
                self.assertIn(required, text)
            self.assertNotRegex(text, r'tel:|@gmail|\\+33')

    def test_logo_signe_existe_dans_le_build(self):
        self.assertTrue((ROOT / build.OFFICIAL_LOGO).is_file())


class Perspectives(unittest.TestCase):
    def test_gabarit_courriel(self):
        text = (ROOT / 'quality/perspectives/gabarit-courriel.html').read_text(encoding='utf-8')
        for rubrique in ('À la une', 'Afrique de l’Ouest &amp; Méditerranée', 'Opportunités', 'Agenda', 'Regard BlueWave'):
            self.assertIn(f'>{rubrique}</h2>', text)
        self.assertIn('BlueWave Perspectives — Mer, littoral &amp; opportunités', text)
        self.assertIn('{{ contact.BW_VEILLE_GESTION }}', text)
        self.assertNotIn('{{ unsubscribe }}', text, 'le lien Brevo ne met pas NEWSLETTER_DB à jour')
        self.assertIn('max-width:600px', text)
        self.assertIn('@media (max-width: 620px)', text)
        self.assertEqual(len(re.findall(r'<img ', text)), 1, 'aucune image de suivi')
        self.assertIn('SASU en cours de constitution', text)

    def test_archive_vide_ne_publie_rien(self):
        archive = json.loads(build.PERSPECTIVES_ARCHIVE.read_text(encoding='utf-8'))
        self.assertEqual(archive['editions'], [])
        self.assertEqual(build.perspectives_archive(), [])

    def test_archive_publie_les_editions_validees(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            originals = build.OUT, build.PERSPECTIVES_ARCHIVE, build.PERSPECTIVES_EDITIONS
            try:
                build.OUT = tmp / 'public'
                build.PERSPECTIVES_EDITIONS = tmp / 'editions'
                build.PERSPECTIVES_EDITIONS.mkdir()
                (build.PERSPECTIVES_EDITIONS / 'edition-1.html').write_text('<main id="contenu"><h1>Édition 1</h1></main>', encoding='utf-8')
                build.PERSPECTIVES_ARCHIVE = tmp / 'archive.json'
                build.PERSPECTIVES_ARCHIVE.write_text(json.dumps({'editions': [
                    {'numero': 1, 'date': '2026-12-01', 'titre': 'Première édition', 'public': True},
                    {'numero': 2, 'date': '2026-12-15', 'titre': 'Non validée', 'public': False}]}), encoding='utf-8')
                build.build()
                page = (build.OUT / build.NEWSLETTER_PAGE).read_text(encoding='utf-8')
                self.assertIn('href="perspectives-1.html">Nº 1 — Première édition', page)
                self.assertNotIn('Non validée', page)
                edition = (build.OUT / 'perspectives-1.html').read_text(encoding='utf-8')
                self.assertIn('<h1>Édition 1</h1>', edition)
                self.assertIn(f'{build.ORIGIN}/perspectives-1.html', edition)
                self.assertFalse((build.OUT / 'perspectives-2.html').exists())
                build.PERSPECTIVES_ARCHIVE.write_text(json.dumps({'editions': [{'numero': 3, 'date': '2026-12-01', 'titre': 'Sans fichier', 'public': True}]}), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Version web absente'):
                    build.build()
            finally:
                build.OUT, build.PERSPECTIVES_ARCHIVE, build.PERSPECTIVES_EDITIONS = originals


class Radar(unittest.TestCase):
    MAPPING = json.loads((ROOT / 'quality/radar/mapping-crm.json').read_text(encoding='utf-8'))
    SCHEMA = json.loads((ROOT / 'quality/radar/schema-opportunite.json').read_text(encoding='utf-8'))

    def fiche(self, **overrides):
        item = {field: 'valeur synthétique' for field in self.SCHEMA['champs_obligatoires']}
        item.update({'id': 'OPP-999', 'url_source': 'https://example.invalid/appel', 'statut': 'À QUALIFIER',
                     'decision_recommandee': 'À ÉTUDIER', 'score': {'total': 12}, 'offres_concernees': ['diagnostic']})
        item.update(overrides)
        return item

    def test_export_traduit_selon_le_mapping(self):
        rows, errors = radar.export({'items': [self.fiche()]}, self.MAPPING, self.SCHEMA)
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]['opportunity_external_id'], 'OPP-999')
        self.assertEqual(rows[0]['stage'], 'Qualification')
        self.assertEqual(rows[0]['recommended_decision'], 'To assess')
        self.assertEqual(rows[0]['priority_score'], 12)

    def test_export_refuse_les_fiches_hors_canon(self):
        _, errors = radar.export({'items': [self.fiche(id='OPP-1'), self.fiche(), self.fiche(url_source='https://example.invalid/autre')]}, self.MAPPING, self.SCHEMA)
        self.assertTrue(any('canon CRM' in error for error in errors))
        self.assertTrue(any('identifiant en double' in error for error in errors))
        _, errors = radar.export({'items': [self.fiche(organisme='')]}, self.MAPPING, self.SCHEMA)
        self.assertTrue(any('organisme' in error for error in errors))

    def test_aucune_base_parallele_dans_le_depot(self):
        script = str(ROOT / 'quality/scripts/radar_export_crm.py')
        with tempfile.TemporaryDirectory() as tmp:
            registry = Path(tmp) / 'registre.json'
            registry.write_text(json.dumps({'items': [self.fiche()]}), encoding='utf-8')
            inside = subprocess.run([sys.executable, script, '--registre', str(registry), '--sortie', str(ROOT / 'export.json')], capture_output=True, text=True)
            self.assertEqual(inside.returncode, 1)
            self.assertFalse((ROOT / 'export.json').exists())
            target = Path(tmp) / 'crm.json'
            self.assertEqual(subprocess.run([sys.executable, script, '--registre', str(registry), '--sortie', str(target)], capture_output=True).returncode, 0)
            self.assertEqual(json.loads(target.read_text(encoding='utf-8'))['opportunities'][0]['opportunity_external_id'], 'OPP-999')
            self.assertEqual(subprocess.run([sys.executable, script, '--registre', str(registry), '--sortie', str(target)], capture_output=True).returncode, 1, 'aucun écrasement')


if __name__ == '__main__':
    unittest.main()
