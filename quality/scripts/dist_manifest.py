#!/usr/bin/env python3
"""Génère et vérifie dist/MANIFEST_SHA256.json (manifeste public)."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
MANIFEST = DIST / "MANIFEST_SHA256.json"


def distributed_paths() -> list[str]:
    """Chemins de dist/, manifeste exclu : il ne figure jamais dans son propre hash."""
    return sorted(
        path.relative_to(DIST).as_posix()
        for path in DIST.rglob("*")
        if path.is_file() and path != MANIFEST and path.name != ".DS_Store"
    )


def build() -> list[dict]:
    entries = []
    for relative in distributed_paths():
        content = (DIST / relative).read_bytes()
        entries.append({"path": relative, "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)})
    return entries


def generate() -> int:
    if not DIST.is_dir():
        print("FAIL: dist/ absent — construire dist avant le manifeste")
        return 1
    payload = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    MANIFEST.write_text(payload, encoding="utf-8")
    print(f"PASS: manifeste public généré ({len(json.loads(payload))} entrées) : {MANIFEST}")
    return 0


def verify() -> int:
    if not MANIFEST.is_file():
        print(f"FAIL: manifeste public absent : {MANIFEST}")
        return 1
    try:
        entries = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except ValueError as exc:
        print(f"FAIL: manifeste public illisible : {exc}")
        return 1
    errors: list[str] = []
    declared = [entry.get("path") for entry in entries]
    present = distributed_paths()
    if any(path == "MANIFEST_SHA256.json" for path in declared):
        errors.append("le manifeste se référence lui-même")
    missing = sorted(set(present) - set(declared))
    extra = sorted(set(declared) - set(present))
    if missing:
        errors.append("fichiers de dist absents du manifeste : " + ", ".join(missing))
    if extra:
        errors.append("entrées sans fichier correspondant : " + ", ".join(extra))
    if not missing and not extra and declared != present:
        errors.append("ordre des entrées non canonique")
    checked = 0
    for entry in entries:
        relative = entry.get("path")
        if not isinstance(relative, str):
            errors.append("entrée sans chemin valide")
            continue
        path = DIST / relative
        if not path.is_file():
            continue
        content = path.read_bytes()
        if entry.get("bytes") != len(content):
            errors.append(f"taille incorrecte : {relative}")
        if entry.get("sha256") != hashlib.sha256(content).hexdigest():
            errors.append(f"SHA-256 incorrect : {relative}")
        checked += 1
    if errors:
        print("FAIL: manifeste public invalide")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {checked}/{len(present)} entrées vérifiées — chemins, SHA-256 et tailles exacts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Manifeste d'intégrité du build public dist/.")
    parser.add_argument("--check", action="store_true", help="Vérifie au lieu de générer.")
    args = parser.parse_args()
    return verify() if args.check else generate()


if __name__ == "__main__":
    raise SystemExit(main())
