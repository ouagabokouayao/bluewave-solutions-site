#!/usr/bin/env python3
"""Construit dist/ : uniquement les fichiers nécessaires au site public servi.

Le contenu de dist/ est dérivé du graphe de références réel du site
(HTML → CSS/JS/images/pages, CSS → url(), JS → JSON frontend) à partir des
pages publiques racine. Aucun fichier interne, de développement ou
d'administration ne peut donc entrer dans dist/ : ce qui n'est pas référencé
par le runtime public n'est pas copié.

Aucun fichier source du dépôt n'est supprimé ni déplacé.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
MANIFEST_NAME = "MANIFEST_SHA256.json"

# Fichiers servis par l'hébergeur sans être référencés par une page.
UNREFERENCED_RUNTIME = ["robots.txt", ".nojekyll"]

# Répertoires et fichiers qui ne doivent jamais apparaître dans dist/.
FORBIDDEN_PREFIXES = (
    ".claude/",
    ".github/",
    "QA/",
    "quality/",
    "serverless/",
    "archives/",
    "backups/",
    "prompts/",
    "documents/",
    "supports/",
    "exports/",
    "captures/",
    "brand/",
    "assets/img/brand/boards/",
    "assets/img/brand/libraries/",
    "assets/img/brand/sources/",
    "dist/",
    ".git/",
)
FORBIDDEN_FILES = {
    "README.md",
    ".gitignore",
    ".env",
    ".env.example",
    "CLAUDE.md",
    "AGENTS.md",
    MANIFEST_NAME,
}
FORBIDDEN_SUFFIXES = (".py", ".mjs", ".md", ".yml", ".yaml", ".zip")

CSS_URL = re.compile(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)")
JS_ASSET = re.compile(r"['\"]((?:data|assets)/[^'\"]+\.(?:json|svg|png|jpg|jpeg|webp|css|js))['\"]")
JSON_ASSET = re.compile(r'"((?:data|assets)/[^"]+\.(?:json|svg|png|jpg|jpeg|webp|css|js))"')


class References(HTMLParser):
    """Collecte les références locales d'une page HTML."""

    ATTRIBUTES = {"href", "src", "poster", "data-src"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        for attribute in self.ATTRIBUTES:
            value = values.get(attribute)
            if value:
                self.refs.append(value)
        srcset = values.get("srcset")
        if srcset:
            self.refs.extend(part.strip().split(" ")[0] for part in srcset.split(",") if part.strip())
        if tag == "meta" and (values.get("property") or "").lower() in {"og:image", "twitter:image"}:
            content = values.get("content")
            if content:
                self.refs.append(content)


def resolve(source: str, raw: str, *, base: str | None = None) -> str | None:
    """Traduit une référence brute en chemin relatif au dépôt, ou None.

    `base` force le répertoire de résolution : les chemins que le JS passe à
    fetch() sont résolus par le navigateur depuis la page servie (la racine du
    site), pas depuis le fichier de script.
    """
    parts = urlsplit(raw)
    if parts.scheme or raw.startswith("//") or raw.startswith("#"):
        return None
    if raw.startswith(("mailto:", "tel:", "javascript:", "data:")):
        return None
    path = unquote(parts.path)
    if not path:
        return None
    if path.startswith("/"):
        candidate = (ROOT / path.lstrip("/")).resolve()
    elif base is not None:
        candidate = (ROOT / base / path).resolve()
    else:
        candidate = ((ROOT / source).parent / path).resolve()
    try:
        relative = candidate.relative_to(ROOT).as_posix()
    except ValueError:
        return None
    return relative if (ROOT / relative).is_file() else None


def extract(relative: str) -> list[str]:
    """Références locales sortantes d'un fichier du graphe."""
    path = ROOT / relative
    suffix = path.suffix.lower()
    base = None
    if suffix == ".html":
        parser = References()
        parser.feed(path.read_text(encoding="utf-8"))
        raws = parser.refs
    elif suffix == ".css":
        raws = CSS_URL.findall(path.read_text(encoding="utf-8"))
    elif suffix == ".js":
        raws = JS_ASSET.findall(path.read_text(encoding="utf-8"))
        base = ""  # résolution depuis la page servie, à la racine du site
    elif suffix == ".json":
        # Les données lues par le navigateur peuvent désigner des médias locaux.
        raws = JSON_ASSET.findall(path.read_text(encoding="utf-8"))
        base = ""
    else:
        return []
    return [target for target in (resolve(relative, raw, base=base) for raw in raws) if target]


def is_forbidden(relative: str) -> bool:
    if relative.startswith(FORBIDDEN_PREFIXES):
        return True
    if relative in FORBIDDEN_FILES or Path(relative).name in FORBIDDEN_FILES:
        return True
    if Path(relative).name.startswith(".env"):
        return True
    return relative.lower().endswith(FORBIDDEN_SUFFIXES)


def collect() -> list[str]:
    seeds = sorted(path.name for path in ROOT.glob("*.html"))
    seeds += [name for name in UNREFERENCED_RUNTIME if (ROOT / name).is_file()]
    selected: set[str] = set()
    queue = list(seeds)
    while queue:
        relative = queue.pop()
        if relative in selected or is_forbidden(relative) or not (ROOT / relative).is_file():
            continue
        selected.add(relative)
        queue.extend(extract(relative))
    return sorted(selected)


def build() -> list[str]:
    files = collect()
    leaked = [relative for relative in files if is_forbidden(relative)]
    if leaked:
        raise RuntimeError("fichiers interdits dans la sélection : " + ", ".join(leaked))
    if DIST.exists():
        shutil.rmtree(DIST)
    for relative in files:
        target = DIST / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="Construit dist/ pour la publication publique.")
    parser.add_argument("--json", action="store_true", help="Sortie JSON de l'inventaire.")
    args = parser.parse_args()
    try:
        files = build()
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"FAIL: construction dist impossible : {exc}", file=sys.stderr)
        return 1
    categories: dict[str, int] = {}
    for relative in files:
        categories[Path(relative).suffix.lower() or "(sans extension)"] = (
            categories.get(Path(relative).suffix.lower() or "(sans extension)", 0) + 1
        )
    if args.json:
        print(json.dumps({"files": files, "count": len(files), "categories": categories}, ensure_ascii=False, indent=2))
    else:
        print(f"PASS: dist construit ({len(files)} fichiers) : {DIST}")
        for suffix, count in sorted(categories.items()):
            print(f"- {suffix}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
