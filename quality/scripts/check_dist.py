#!/usr/bin/env python3
"""Contrôle dist/ : aucun fichier interne, parité stricte avec les sources.

Complète dist_manifest.py --check, qui contrôle l'intégrité du manifeste.
Ici on contrôle la *nature* du contenu : rien d'interne ne doit être servi, et
chaque fichier publié doit être la copie exacte de sa source dans le dépôt.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
MANIFEST_NAME = "MANIFEST_SHA256.json"

FORBIDDEN_TOP_LEVEL = {
    ".claude", ".github", ".git", "QA", "quality", "serverless",
    "archives", "backups", "prompts", "documents", "supports",
    "exports", "captures", "brand", "dist", "node_modules",
}
# Segments qui ne sont légitimes à aucune profondeur (assets/img/brand/logo est public).
FORBIDDEN_SEGMENTS = {
    ".claude", ".github", ".git", "QA", "quality", "serverless",
    "archives", "backups", "prompts", "documents", "supports",
    "exports", "captures", "node_modules", "boards", "libraries", "sources",
}
FORBIDDEN_NAMES = {"README.md", ".gitignore", "CLAUDE.md", "AGENTS.md"}
FORBIDDEN_SUFFIXES = (".py", ".mjs", ".md", ".yml", ".yaml", ".zip", ".log", ".bak")
ALLOWED_SUFFIXES = {".html", ".css", ".js", ".json", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2"}
ALLOWED_EXTENSIONLESS = {".nojekyll"}

SECRET = re.compile(r"(?i)(?:api[_-]?key|secret|token|password)\s*[=:]\s*[\"'][A-Za-z0-9_\-]{16,}")
REQUIRED = ["index.html", "robots.txt", ".nojekyll", "assets/css/style.css"]


def main() -> int:
    if not DIST.is_dir():
        print("FAIL: dist/ absent")
        return 1
    errors: list[str] = []
    files = sorted(path.relative_to(DIST).as_posix() for path in DIST.rglob("*") if path.is_file())

    for relative in files:
        parts = Path(relative).parts
        name = Path(relative).name
        suffix = Path(relative).suffix.lower()
        if parts[0] in FORBIDDEN_TOP_LEVEL:
            errors.append(f"répertoire interne publié : {relative}")
        if set(parts[:-1]) & FORBIDDEN_SEGMENTS:
            errors.append(f"segment interne dans le chemin : {relative}")
        if name in FORBIDDEN_NAMES or name.startswith(".env"):
            errors.append(f"fichier interne publié : {relative}")
        if relative != MANIFEST_NAME and relative.lower().endswith(FORBIDDEN_SUFFIXES):
            errors.append(f"artefact de développement publié : {relative}")
        if suffix and suffix not in ALLOWED_SUFFIXES:
            errors.append(f"extension non autorisée en publication : {relative}")
        if not suffix and name not in ALLOWED_EXTENSIONLESS:
            errors.append(f"fichier sans extension non autorisé : {relative}")

    for required in REQUIRED:
        if required not in files:
            errors.append(f"fichier public obligatoire absent : {required}")

    # Parité stricte avec les sources : dist ne fabrique ni ne modifie de contenu.
    for relative in files:
        if relative == MANIFEST_NAME:
            continue
        source = ROOT / relative
        if not source.is_file():
            errors.append(f"fichier publié sans source dans le dépôt : {relative}")
        elif source.read_bytes() != (DIST / relative).read_bytes():
            errors.append(f"fichier publié divergent de sa source : {relative}")

    # Toute page publique du dépôt doit être publiée.
    for page in sorted(path.name for path in ROOT.glob("*.html")):
        if page not in files:
            errors.append(f"page publique non publiée : {page}")

    # Aucun secret dans les fichiers texte servis.
    for relative in files:
        if Path(relative).suffix.lower() in {".html", ".css", ".js", ".json", ".txt"}:
            if SECRET.search((DIST / relative).read_text(encoding="utf-8", errors="ignore")):
                errors.append(f"secret potentiel dans un fichier servi : {relative}")

    # robots.txt de pré-publication : le site reste fermé aux robots.
    robots = (DIST / "robots.txt").read_text(encoding="utf-8")
    if not re.search(r"(?mi)^Disallow:\s*/\s*$", robots):
        errors.append("robots.txt publié sans Disallow: /")

    if errors:
        print("FAIL: contenu de dist non conforme")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: {len(files)} fichiers publiés, 0 fichier interne, parité source exacte")
    return 0


if __name__ == "__main__":
    sys.exit(main())
