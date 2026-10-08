import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('production_build', ROOT / 'quality/scripts/build_production_dist.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
spec2 = importlib.util.spec_from_file_location('production_config', ROOT / 'quality/scripts/render_production_wrangler.py')
config = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(config)


class ProductionProfile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_out = module.OUT
        self.original_target = config.TARGET
        module.OUT = Path(self.tmp.name) / 'public'
        config.TARGET = Path(self.tmp.name) / 'wrangler.json'

    def tearDown(self):
        module.OUT = self.original_out
        config.TARGET = self.original_target
        self.tmp.cleanup()

    def test_closed_profile_stays_closed(self):
        module.build()
        out = module.OUT
        self.assertIn('Disallow: /', (out / 'robots.txt').read_text())
        self.assertNotIn('sitemap.xml', [p.name for p in out.iterdir()])
        self.assertEqual(json.loads((out / 'data/automation-config.json').read_text())['lead_endpoint'], None)
        self.assertFalse(json.loads((out / 'data/analytics-config.json').read_text())['enabled'])
        self.assertEqual(len(list(out.glob('*.html'))), 21)
        self.assertIn('noindex, nofollow', (out / 'index.html').read_text())

    def test_open_profile_is_canonical_and_minimal(self):
        module.build(indexable=True, leads=True, events=True, token='a'*32, campaigns=['salon_2026'], privacy_simulation=True)
        out = module.OUT
        self.assertEqual(len(list(out.glob('*.html'))), 21)
        for page in out.glob('*.html'):
            body = page.read_text()
            source = (module.SOURCE / page.name).read_text()
            original_canonical = source.split('<link rel="canonical" href="', 1)[1].split('"', 1)[0]
            self.assertIn(original_canonical.replace(module.OLD, module.ORIGIN + '/'), body)
            self.assertNotIn(module.OLD, body)
            self.assertIn('index, follow' if page.name != '404.html' else 'noindex, nofollow', body)
        self.assertIn('Sitemap: ' + module.ORIGIN, (out / 'robots.txt').read_text())
        self.assertIn('Brevo', (out / 'politique-confidentialite.html').read_text())
        self.assertIn('treize mois', (out / 'politique-confidentialite.html').read_text())
        self.assertNotIn('GitHub Pages', (out / 'politique-confidentialite.html').read_text())
        self.assertNotIn('préactivation', (out / 'mentions-legales.html').read_text())
        self.assertIn('101 Townsend St.', (out / 'mentions-legales.html').read_text())
        self.assertIn('+1 888 993 5273', (out / 'mentions-legales.html').read_text())
        self.assertEqual(json.loads((out / 'data/automation-config.json').read_text())['lead_endpoint'], '/api/leads')
        self.assertEqual(json.loads((out / 'data/analytics-config.json').read_text())['campaigns'], ['salon_2026'])
        self.assertFalse(json.loads((out / 'data/automation-config.json').read_text())['newsletter_enabled'])
        self.assertEqual(len(list(out.glob('*.xml'))), 1)
        self.assertNotIn('404.html', (out / 'sitemap.xml').read_text())
        for entry in json.loads((out / 'MANIFEST_SHA256.json').read_text()):
            self.assertEqual(hashlib.sha256((out / entry['path']).read_bytes()).hexdigest(), entry['sha256'])

    def test_config_requires_real_d1_binding_and_route_is_explicit(self):
        real = '11111111-1111-1111-1111-111111111111'
        leads = '22222222-2222-2222-2222-222222222222'
        with self.assertRaises(ValueError):
            config.render('00000000-0000-0000-0000-000000000000', leads)
        with self.assertRaises(ValueError):
            config.render(real, '00000000-0000-0000-0000-000000000000')
        # Les deux bases ne peuvent pas être la même : analytics et demandes
        # ne se mélangent pas.
        with self.assertRaises(ValueError):
            config.render(real, real)
        with self.assertRaises(TypeError):
            config.render(real)
        target = config.render(real, leads)
        closed = json.loads(target.read_text())
        self.assertFalse(closed['workers_dev'])
        self.assertNotIn('routes', closed)
        self.assertEqual(closed['vars']['LEADS_ENABLED'], 'false')
        self.assertEqual(closed['vars']['TURNSTILE_ENABLED'], 'false')
        self.assertEqual(closed['vars']['LEAD_RETENTION_DAYS'], '')
        bindings = {entry['binding']: entry['database_id'] for entry in closed['d1_databases']}
        self.assertEqual(bindings['CONVERSION_DB'], real)
        self.assertEqual(bindings['LEADS_DB'], leads)
        config.render(real, leads, indexable=True, leads=True, events=True, route=True, retention_days=30)
        opened = json.loads(target.read_text())
        self.assertEqual(opened['routes'][0]['pattern'], 'www.bluewavesolutions.fr')
        self.assertEqual(opened['vars']['NEWSLETTER_ENABLED'], 'false')
        self.assertEqual(opened['vars']['LEAD_RETENTION_DAYS'], '30')

    def test_privacy_gate_blocks_publishable_artifact(self):
        approval = json.loads((ROOT / 'quality/privacy-approval.json').read_text(encoding='utf-8'))
        self.assertFalse(approval['approved'])
        self.assertTrue(approval['affirmations_a_valider'])
        # Un artefact indexable non simulé est refusé tant que les mentions ne
        # sont pas validées.
        with self.assertRaises(ValueError):
            module.build(indexable=True, leads=True, events=True)
        # Le profil fermé et la simulation restent constructibles.
        module.build()
        module.build(indexable=True, leads=True, events=True, privacy_simulation=True)
        mode = json.loads((ROOT / 'quality/reports/production-build-mode.json').read_text())
        self.assertFalse(mode['publishable'])

if __name__ == '__main__':
    unittest.main()
