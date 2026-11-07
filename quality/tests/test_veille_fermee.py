"""Verrou de non-régression : aucun formulaire inactif ne laisse croire à un envoi
ou à une inscription.

Fichier distinct, hors du socle de conservation : il ajoute un contrôle sans
modifier les scripts protégés par check_home_conservation.py.
"""
import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('production_build', ROOT / 'quality/scripts/build_production_dist.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
CLOSED = 'Les inscriptions ne sont pas encore ouvertes.'
SOURCES = sorted(ROOT.glob('*.html'))


def forms(document):
    return re.findall(r'<form\b[^>]*>.*?</form>', document, re.S)


class VeilleFermee(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original = build.OUT
        build.OUT = Path(self.tmp.name) / 'public'
        build.build()

    def tearDown(self):
        build.OUT = self.original
        self.tmp.cleanup()

    def pages(self):
        return [*SOURCES, *sorted(build.OUT.glob('*.html'))]

    def test_aucun_formulaire_de_veille(self):
        for page in self.pages():
            text = page.read_text(encoding='utf-8')
            self.assertNotIn('data-newsletter-form', text, page)
            for form in forms(text):
                self.assertNotRegex(form, r'newsletter-email|S’inscrire', page)
            # L'option de veille du questionnaire reste masquée et désactivée.
            for label in re.findall(r'<label[^>]*>(?:(?!</label>).)*data-newsletter-consent(?:(?!</label>).)*</label>', text, re.S):
                self.assertRegex(label, r'^<label[^>]*\bhidden\b', page)
                self.assertRegex(label, r'<input[^>]*\bdisabled\b', page)

    def test_panneau_ferme_annonce_tel_quel(self):
        for page in (ROOT / 'actualites.html', build.OUT / 'actualites.html'):
            text = page.read_text(encoding='utf-8')
            panel = re.search(r'<div class="container newsletter-panel">.*?</section>', text, re.S).group(0)
            self.assertIn(CLOSED, panel)
            self.assertNotIn('<form', panel)
            self.assertNotIn('<input', panel)

    def test_page_de_retrait_sans_collecte(self):
        text = (build.OUT / build.NEWSLETTER_PAGE).read_text(encoding='utf-8')
        self.assertIn(CLOSED, text)
        self.assertEqual(forms(text), [])
        self.assertNotIn('<input', text)

    def test_formulaires_de_contact_annoncent_un_courriel_prepare(self):
        for page in self.pages():
            text = page.read_text(encoding='utf-8')
            for form in forms(text):
                for label in re.findall(r'<button[^>]*type="submit"[^>]*>([^<]*)', form):
                    self.assertRegex(label, r'^(Préparer|Voir l’orientation)', f'{page.name} : « {label} » laisse croire à un envoi')
        for name in build.FORM_PAGES:
            self.assertIn(build.CLOSED_FORM_NOTICE, (build.OUT / name).read_text(encoding='utf-8'), name)


if __name__ == '__main__':
    unittest.main()
