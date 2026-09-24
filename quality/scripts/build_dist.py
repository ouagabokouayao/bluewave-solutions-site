#!/usr/bin/env python3
"""Construit l'artefact public BlueWave par liste blanche."""
from __future__ import annotations

import argparse
import filecmp
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "dist"

PUBLIC_FILES = [
    ".nojekyll",
    "404.html",
    "a-propos.html",
    "actualites.html",
    "contact.html",
    "domaines.html",
    "index.html",
    "mediatheque.html",
    "mentions-legales.html",
    "methode.html",
    "notes-demonstrateurs.html",
    "politique-confidentialite.html",
    "preuves-demonstrateurs.html",
    "qualifier-un-besoin.html",
    "robots.txt",
    "services.html",
    "solutions.html",
    "assets/css/style.css",
    "assets/js/actualites.js",
    "assets/js/automation.js",
    "assets/js/main.js",
    "assets/js/mediatheque.js",
    "assets/js/qualifier.js",
    "data/actualites-status.json",
    "data/actualites.json",
    "data/automation-config.json",
    "assets/img/brand/logo/favicon-bluewave-board-192-preview.png",
    "assets/img/brand/logo/logo-bluewave-horizontal-fond-fonce.png",
    "assets/img/brand/logo/logo-bluewave-horizontal-officiel.png",
    "assets/img/brand/logo/logo-bluewave-reference.png",
    "assets/img/visuals/apercu-diagnostic.svg",
    "assets/img/visuals/apercu-fiche-projet.svg",
    "assets/img/visuals/apercu-note-strategique.svg",
    "assets/img/visuals/apercu-support-formation.svg",
    "assets/img/visuals/feuille-route-bluewave.svg",
    "assets/img/visuals/matrice-acteurs-usages.svg",
    "assets/img/visuals/matrice-risques-opportunites.svg",
    "assets/img/visuals/visualisation-deux-marches.svg",
    "assets/img/visuals/visualisation-donnees-decision.svg",
    "assets/img/visuals/visualisation-methode-bluewave.svg",
]


def build_to(output: Path) -> list[str]:
    output = output.resolve()
    if output == ROOT or ROOT in output.parents and output.name in {".git", ".github"}:
        raise ValueError(f"Destination de build interdite : {output}")
    missing = [relative for relative in PUBLIC_FILES if not (ROOT / relative).is_file()]
    if missing:
        raise FileNotFoundError("Fichiers publics absents : " + ", ".join(missing))
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for relative in PUBLIC_FILES:
        source = ROOT / relative
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return sorted(PUBLIC_FILES)


def files_under(root: Path) -> list[str]:
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())


def compare_dirs(expected: Path, actual: Path) -> list[str]:
    expected_files = files_under(expected)
    actual_files = files_under(actual) if actual.is_dir() else []
    errors = []
    if expected_files != actual_files:
        missing = sorted(set(expected_files) - set(actual_files))
        extra = sorted(set(actual_files) - set(expected_files))
        if missing:
            errors.append("absents de dist : " + ", ".join(missing))
        if extra:
            errors.append("inattendus dans dist : " + ", ".join(extra))
    for relative in sorted(set(expected_files) & set(actual_files)):
        if not filecmp.cmp(expected / relative, actual / relative, shallow=False):
            errors.append(f"contenu désynchronisé : {relative}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="bluewave-dist-") as temporary:
            expected = Path(temporary) / "dist"
            built = build_to(expected)
            errors = compare_dirs(expected, args.output.resolve())
        if errors:
            print("FAIL: dist désynchronisé")
            for error in errors:
                print(f"- {error}")
            return 1
        print(f"PASS: dist synchronisé ({len(built)} fichiers publics)")
        return 0
    built = build_to(args.output)
    print(f"PASS: dist construit ({len(built)} fichiers publics) : {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
