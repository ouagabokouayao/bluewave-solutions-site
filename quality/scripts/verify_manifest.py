#!/usr/bin/env python3
"""Vérifie chemins, tailles et SHA-256 du manifeste BlueWave."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from update_manifest import DEFAULT_OUTPUT, ROOT, canonical_paths


def main() -> int:
    try:
        entries = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"FAIL: manifeste illisible : {exc}")
        return 1
    errors = []
    paths = [entry.get("path") for entry in entries]
    expected = canonical_paths()
    if paths != expected:
        missing = sorted(set(expected) - set(paths))
        extra = sorted(set(paths) - set(expected))
        if missing:
            errors.append("entrées absentes : " + ", ".join(missing))
        if extra:
            errors.append("entrées inattendues : " + ", ".join(extra))
        if not missing and not extra:
            errors.append("ordre des entrées non canonique")
    for entry in entries:
        relative = entry.get("path")
        if not isinstance(relative, str):
            errors.append("entrée sans chemin valide")
            continue
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"fichier absent : {relative}")
            continue
        content = path.read_bytes()
        if entry.get("bytes") != len(content):
            errors.append(f"taille incorrecte : {relative}")
        if entry.get("sha256") != hashlib.sha256(content).hexdigest():
            errors.append(f"SHA-256 incorrect : {relative}")
    if errors:
        print("FAIL: manifeste invalide")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {len(entries)} entrées, chemins/SHA-256/octets exacts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
