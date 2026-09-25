#!/usr/bin/env python3
"""Génère le manifeste d'intégrité canonique du site BlueWave."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "MANIFEST_SHA256.json"

CRITICAL_FILES = [
    ".gitignore",
    ".nojekyll",
    "404.html",
    "README.md",
    "a-propos.html",
    "actualites.html",
    "contact.html",
    "domaines.html",
    "index.html",
    "mediatheque-activites.html",
    "mediatheque-visualisations.html",
    "mediatheque.html",
    "mentions-legales.html",
    "methode.html",
    "notes-demonstrateurs.html",
    "politique-confidentialite.html",
    "preuves-demonstrateurs.html",
    "qualifier-un-besoin.html",
    "services.html",
    "solutions.html",
    "robots.txt",
    "assets/css/activites-bluewave.css",
    "assets/css/style.css",
    "assets/js/actualites.js",
    "assets/js/activites-bluewave.js",
    "assets/js/automation.js",
    "assets/js/main.js",
    "assets/js/mediatheque.js",
    "assets/js/qualifier.js",
    "assets/data/activites-bluewave.json",
    "data/actualites-curation.json",
    "data/actualites-sources.json",
    "data/actualites-status.json",
    "data/actualites.json",
    "data/automation-config.json",
    ".github/workflows/bluewave-quality.yml",
    ".github/workflows/check-links.yml",
    ".github/workflows/deploy-pages-manual.yml",
    ".github/workflows/site-quality.yml",
    ".github/workflows/update-actualites.yml",
    "quality/media-evidence/arbe-sfn-aix-2026.webp",
    "quality/media-evidence/loi-littoral-marseille-2026.webp",
    "quality/media-evidence/rfdi-gouvernance-oceans-nice-2026.webp",
    "quality/media-provenance-activites-bluewave.json",
    "quality/sources-candidates-afrique-ouest.md",
    "quality/scripts/build_dist.py",
    "quality/scripts/check_dist.py",
    "quality/scripts/check_external_links.py",
    "quality/scripts/check_secrets.py",
    "quality/scripts/dist_manifest.py",
    "quality/radar/README.md",
    "quality/radar/alertes-config.json",
    "quality/radar/alertes.md",
    "quality/radar/doctrine-evenements-interventions.md",
    "quality/radar/doctrine-recherche-appliquee.md",
    "quality/radar/mapping-crm.json",
    "quality/radar/opportunites.json",
    "quality/radar/schema-opportunite.json",
    "quality/radar/scoring.json",
    "quality/radar/types.json",
    "quality/scripts/quality_check.py",
    "quality/scripts/radar_check.py",
    "quality/scripts/update_actualites.py",
    "quality/scripts/update_manifest.py",
    "quality/scripts/verify_manifest.py",
]


def canonical_paths() -> list[str]:
    images = [path.relative_to(ROOT).as_posix() for path in (ROOT / "assets" / "img").rglob("*") if path.is_file() and path.name != ".DS_Store"]
    serverless = [path.relative_to(ROOT).as_posix() for path in (ROOT / "serverless").rglob("*") if path.is_file() and path.name != ".DS_Store"]
    return sorted(set(CRITICAL_FILES + images + serverless))


def build_manifest() -> list[dict]:
    missing = [relative for relative in canonical_paths() if not (ROOT / relative).is_file()]
    if missing:
        raise FileNotFoundError("Fichiers canoniques absents : " + ", ".join(missing))
    manifest = []
    for relative in canonical_paths():
        content = (ROOT / relative).read_bytes()
        manifest.append({"path": relative, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = json.dumps(build_manifest(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != generated:
            print(f"FAIL: manifeste désynchronisé : {args.output}")
            return 1
        print(f"PASS: manifeste synchronisé ({len(json.loads(generated))} entrées)")
        return 0
    args.output.write_text(generated, encoding="utf-8")
    print(f"PASS: manifeste généré ({len(json.loads(generated))} entrées) : {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
