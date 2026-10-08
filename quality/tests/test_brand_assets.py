"""Tests de la garde anti-publication du Brand Asset System.

Le contrôle réel du dépôt doit passer ; chaque situation interdite doit faire
échouer la garde. Les cas négatifs travaillent sur une copie temporaire : aucun
fichier du dépôt n'est modifié.
"""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load("brand_gate", "quality/scripts/check_brand_assets.py")
builder = load("dist_builder", "quality/scripts/build_dist.py")
dist_check = load("dist_check", "quality/scripts/check_dist.py")


class RealRepository(unittest.TestCase):
    def test_gate_passes_on_repository(self):
        self.assertEqual(gate.main(), 0)

    def test_seven_founder_aliases_declared(self):
        data = json.loads(gate.FOUNDER_MANIFEST.read_text(encoding="utf-8"))
        declared = {entry["asset_id"] for entry in data["assets"]}
        for alias in gate.REQUIRED_ALIASES:
            self.assertIn(alias, declared)

    def test_twelve_prepublication_folders(self):
        for folder in gate.REQUIRED_FOLDERS:
            self.assertTrue((gate.PREPUB / folder).is_dir(), folder)
            self.assertTrue((gate.PREPUB / folder / "README.md").is_file(), folder)

    def test_no_support_exposes_a_download(self):
        data = json.loads(gate.SUPPORTS_REGISTRY.read_text(encoding="utf-8"))
        for support in data["supports"]:
            self.assertFalse(support["download_enabled"], support["support_id"])
            self.assertFalse(support["public_allowed"], support["support_id"])

    def test_build_selection_excludes_private(self):
        self.assertTrue(builder.is_forbidden("private/prepublication/supports-registry.json"))
        self.assertTrue(builder.is_forbidden("private/README.md"))
        self.assertNotIn("private/", {Path(relative).parts[0] + "/" for relative in builder.collect()})

    def test_dist_control_rejects_private_segment(self):
        self.assertIn("private", dist_check.FORBIDDEN_TOP_LEVEL)
        self.assertIn("private", dist_check.FORBIDDEN_SEGMENTS)
        self.assertIn("prepublication", dist_check.FORBIDDEN_SEGMENTS)

    def test_public_pages_reference_no_placeholder(self):
        placeholders = sorted(path.name for path in (gate.PREPUB / "photos" / "placeholders").glob("*"))
        self.assertTrue(placeholders)
        for page in ROOT.glob("*.html"):
            text = page.read_text(encoding="utf-8")
            self.assertNotIn("private/", text, page.name)
            for name in placeholders:
                self.assertNotIn(name, text, f"{page.name} / {name}")

    def test_media_intervention_route_exists_and_stays_unindexed(self):
        page = (ROOT / "media-intervention.html").read_text(encoding="utf-8")
        self.assertIn('<meta name="robots" content="noindex, nofollow">', page)
        self.assertIn('href="qualifier-un-besoin.html?parcours=evenement"', page)


class GateFailures(unittest.TestCase):
    """Chaque situation interdite doit produire au moins une erreur."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.private = base / "private"
        shutil.copytree(ROOT / "private", self.private)
        self.dist = base / "dist"
        self.dist.mkdir()
        (self.dist / "index.html").write_text("<!doctype html><html lang=fr></html>", encoding="utf-8")
        # Les actifs réels déclarés PUBLIC_READY doivent exister dans la copie.
        for entry in json.loads((ROOT / "private/prepublication/founder/founder-assets-manifest.json").read_text(encoding="utf-8"))["assets"]:
            filename = entry.get("filename")
            if entry.get("status") == "PUBLIC_READY" and filename:
                copie = base / filename
                copie.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / filename, copie)
        self.saved = {
            name: getattr(gate, name)
            for name in ("ROOT", "PRIVATE", "PREPUB", "DIST", "FOUNDER_MANIFEST", "SUPPORTS_REGISTRY")
        }
        gate.ROOT = base
        gate.PRIVATE = self.private
        gate.PREPUB = self.private / "prepublication"
        gate.DIST = self.dist
        gate.FOUNDER_MANIFEST = gate.PREPUB / "founder" / "founder-assets-manifest.json"
        gate.SUPPORTS_REGISTRY = gate.PREPUB / "supports-registry.json"

    def tearDown(self):
        for name, value in self.saved.items():
            setattr(gate, name, value)
        self.tmp.cleanup()

    def errors(self):
        found: list[str] = []
        gate.check_structure(found)
        assets = gate.check_founder_manifest(found)
        gate.check_supports_registry(found)
        gate.check_public_pages(assets, found)
        gate.check_dist(found)
        return found

    def write_manifest(self, data):
        gate.FOUNDER_MANIFEST.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def read_manifest(self):
        return json.loads(gate.FOUNDER_MANIFEST.read_text(encoding="utf-8"))

    def test_fixture_is_clean(self):
        self.assertEqual(self.errors(), [])

    def test_private_file_in_dist_fails(self):
        target = self.dist / "private" / "prepublication" / "fuite.json"
        target.parent.mkdir(parents=True)
        target.write_text("{}", encoding="utf-8")
        self.assertTrue(any("zone de prépublication publiée" in error for error in self.errors()))

    def test_placeholder_file_in_dist_fails(self):
        (self.dist / "assets").mkdir()
        (self.dist / "assets" / "founder-headshot-1x1-TEMP.svg").write_text("<svg/>", encoding="utf-8")
        self.assertTrue(any("gabarit de prépublication publié" in error for error in self.errors()))

    def test_prepublication_marker_in_dist_fails(self):
        (self.dist / "about.html").write_text(f"<p>{gate.PREPUB_MARKER}</p>", encoding="utf-8")
        self.assertTrue(any("marqueur de prépublication publié" in error for error in self.errors()))

    def test_public_page_referencing_temp_asset_fails(self):
        (gate.ROOT / "fuite.html").write_text("<p>FOUNDER_HEADSHOT</p>", encoding="utf-8")
        self.assertTrue(any("actif non approuvé référencé" in error for error in self.errors()))

    def test_public_page_referencing_private_path_fails(self):
        (gate.ROOT / "fuite.html").write_text('<img src="private/prepublication/photos/x.svg">', encoding="utf-8")
        self.assertTrue(any("référence à la zone de prépublication" in error for error in self.errors()))

    def test_public_allowed_without_public_ready_fails(self):
        data = self.read_manifest()
        for entry in data["assets"]:
            if entry["asset_id"] == "FOUNDER_HEADSHOT":
                entry["public_allowed"] = True
        self.write_manifest(data)
        self.assertTrue(any("sans statut PUBLIC_READY" in error for error in self.errors()))

    def test_unknown_status_fails(self):
        data = self.read_manifest()
        data["assets"][0]["status"] = "DRAFT"
        self.write_manifest(data)
        self.assertTrue(any("statut non reconnu" in error for error in self.errors()))

    def test_missing_required_alias_fails(self):
        data = self.read_manifest()
        data["assets"] = [entry for entry in data["assets"] if entry["asset_id"] != "FOUNDER_MEDIA"]
        self.write_manifest(data)
        self.assertTrue(any("alias requis absent FOUNDER_MEDIA" in error for error in self.errors()))

    def test_public_ready_without_file_fails(self):
        data = self.read_manifest()
        for entry in data["assets"]:
            if entry["status"] == "PUBLIC_READY":
                entry["filename"] = "assets/img/fondateur/inexistant.webp"
        self.write_manifest(data)
        self.assertTrue(any("fichier déclaré absent" in error for error in self.errors()))

    def test_download_enabled_without_public_ready_fails(self):
        data = json.loads(gate.SUPPORTS_REGISTRY.read_text(encoding="utf-8"))
        data["supports"][0]["download_enabled"] = True
        gate.SUPPORTS_REGISTRY.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("téléchargement actif sans statut PUBLIC_READY" in error for error in self.errors()))

    def test_missing_support_code_fails(self):
        data = json.loads(gate.SUPPORTS_REGISTRY.read_text(encoding="utf-8"))
        data["supports"] = [support for support in data["supports"] if support["code"] != "J"]
        gate.SUPPORTS_REGISTRY.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.assertTrue(any("codes absents" in error for error in self.errors()))

    def test_missing_prepublication_folder_fails(self):
        shutil.rmtree(gate.PREPUB / "press")
        self.assertTrue(any("répertoire de prépublication absent" in error for error in self.errors()))

    def test_placeholder_without_marker_fails(self):
        target = gate.PREPUB / "photos" / "placeholders" / "founder-headshot-1x1-TEMP.svg"
        target.write_text("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", encoding="utf-8")
        self.assertTrue(any("gabarit sans marqueur de prépublication" in error for error in self.errors()))


if __name__ == "__main__":
    unittest.main()
