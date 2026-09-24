#!/usr/bin/env python3
"""Contrôle l'artefact public sans dépendre des fichiers internes du dépôt."""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
FORBIDDEN_PARTS = {
    ".claude",
    ".env",
    ".github",
    ".gitignore",
    "QA",
    "README.md",
    "archives",
    "captures",
    "documents",
    "quality",
    "serverless",
    "supports",
}
FORBIDDEN_SUFFIXES = {".md", ".py", ".pyc", ".toml", ".yaml", ".yml", ".zip"}
INTERNAL_MARKERS = ("AquaLab", "CLAUDE.md", "AGENTS.md", "Pont inter-agent", "Claude Code")
SOCIAL_IMAGE = "https://ouagabokouayao.github.io/bluewave-solutions-site/assets/img/brand/logo/logo-bluewave-reference.png"


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.resources: list[str] = []
        self.robots = ""
        self.canonical = ""
        self.og_image = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "a" and values.get("href") is not None:
            self.links.append(values.get("href") or "")
        if tag in {"img", "script", "source"} and values.get("src") is not None:
            self.resources.append(values.get("src") or "")
        if tag == "link":
            rel = (values.get("rel") or "").lower()
            href = values.get("href") or ""
            if rel == "canonical":
                self.canonical = href
            elif href:
                self.resources.append(href)
        if tag == "meta":
            name = (values.get("name") or "").lower()
            prop = (values.get("property") or "").lower()
            if name == "robots":
                self.robots = (values.get("content") or "").lower()
            if prop == "og:image":
                self.og_image = values.get("content") or ""


def local_target(page: Path, raw: str) -> Path | None:
    parsed = urlsplit(raw)
    if parsed.scheme or raw.startswith(("//", "mailto:", "tel:", "#")):
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    prefix = "/bluewave-solutions-site/"
    if path.startswith(prefix):
        return DIST / path[len(prefix):]
    if path.startswith("/"):
        return DIST / path.lstrip("/")
    return page.parent / path


def main() -> int:
    errors: list[str] = []
    if not DIST.is_dir():
        print("FAIL: dist absent")
        return 1
    files = sorted(path.relative_to(DIST).as_posix() for path in DIST.rglob("*") if path.is_file())
    for relative in files:
        path = Path(relative)
        if any(part in FORBIDDEN_PARTS for part in path.parts):
            errors.append(f"élément interne : {relative}")
        if path.suffix.lower() in FORBIDDEN_SUFFIXES:
            errors.append(f"extension interne : {relative}")
    pages = sorted(DIST.glob("*.html"))
    for page in pages:
        text = page.read_text(encoding="utf-8")
        parser = PageParser()
        parser.feed(text)
        robots = {value.strip() for value in parser.robots.split(",") if value.strip()}
        if not {"noindex", "nofollow"}.issubset(robots):
            errors.append(f"{page.name}: noindex,nofollow absent")
        if parser.og_image != SOCIAL_IMAGE:
            errors.append(f"{page.name}: image sociale officielle absente")
        for marker in INTERNAL_MARKERS:
            if marker.casefold() in text.casefold():
                errors.append(f"{page.name}: marqueur interne {marker}")
        for raw in parser.links + parser.resources:
            target = local_target(page, raw)
            if target is not None and not target.exists():
                errors.append(f"{page.name}: cible locale absente {raw}")
    index = (DIST / "index.html").read_text(encoding="utf-8")
    canonical = "https://ouagabokouayao.github.io/bluewave-solutions-site/"
    if f'<link rel="canonical" href="{canonical}">' not in index:
        errors.append("index.html: canonical accueil incorrecte")
    robots_text = (DIST / "robots.txt").read_text(encoding="utf-8")
    if not re.search(r"(?mi)^Disallow:\s*/\s*$", robots_text):
        errors.append("robots.txt: Disallow / absent")
    automation = json.loads((DIST / "data/automation-config.json").read_text(encoding="utf-8"))
    expected = {
        "provider": "brevo",
        "lead_endpoint": None,
        "chat_enabled": False,
        "newsletter_enabled": False,
        "meeting_url": None,
    }
    if automation != expected:
        errors.append("automation-config.json: Brevo ou lead_endpoint activé")
    if errors:
        print("FAIL: artefact public invalide")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: artefact public propre ({len(files)} fichiers, {len(pages)} pages, 0 élément interne)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
