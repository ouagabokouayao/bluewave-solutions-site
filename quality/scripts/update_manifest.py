#!/usr/bin/env python3
"""Génère le manifeste d'intégrité canonique du site BlueWave."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
DEFAULT_OUTPUT = ROOT / "MANIFEST_SHA256.json"


def canonical_paths() -> list[str]:
    if not DIST.is_dir():
        raise FileNotFoundError("Artefact public absent : dist/")
    return sorted(path.relative_to(DIST).as_posix() for path in DIST.rglob("*") if path.is_file() and path.name != ".DS_Store")


def build_manifest() -> list[dict]:
    missing = [relative for relative in canonical_paths() if not (DIST / relative).is_file()]
    if missing:
        raise FileNotFoundError("Fichiers canoniques absents : " + ", ".join(missing))
    manifest = []
    for relative in canonical_paths():
        content = (DIST / relative).read_bytes()
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
