#!/usr/bin/env python3
"""Offline quality gate for the BlueWave static site."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[2]
ROOT_PAGE_EXCLUSIONS = {
    "signature-mail-bluewave-preview.html",
    "signature-mail-bluewave-snippet.html",
    "signature-mail-bluewave-ultra-compatible.html",
}
PUBLIC_HTML = [
    path for path in sorted(ROOT.glob("*.html")) if path.name not in ROOT_PAGE_EXCLUSIONS
] + sorted((ROOT / "documents" / "marche-penetration-bluewave" / "mini-projets-vitrines").glob("*.html"))
EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel", "data", "javascript"}
PLACEHOLDERS = (
    re.compile(r"lorem\s+ipsum", re.I),
    re.compile(r"https?://example\.com", re.I),
    re.compile(r"\b(?:TODO|FIXME|TBD)\b"),
    re.compile(r"\{\{[^}]+\}\}"),
)
PUBLIC_PRICE = re.compile(r"\b\d[\d\s.,]*(?:€|EUR|FCFA|XOF)\b", re.I)


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.html_lang = ""
        self.title_depth = 0
        self.title_text: list[str] = []
        self.h1_count = 0
        self.ids: list[str] = []
        self.links: list[str] = []
        self.sources: list[str] = []
        self.images: list[dict[str, str | None]] = []
        self.robots = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "html":
            self.html_lang = (data.get("lang") or "").strip()
        if tag == "title":
            self.title_depth += 1
        if tag == "h1":
            self.h1_count += 1
        if data.get("id"):
            self.ids.append(data["id"] or "")
        if tag == "a" and data.get("href") is not None:
            self.links.append(data.get("href") or "")
        if tag in {"img", "script", "source", "video"} and data.get("src") is not None:
            self.sources.append(data.get("src") or "")
        if tag == "link" and data.get("href") is not None:
            self.sources.append(data.get("href") or "")
        if tag == "img":
            self.images.append({"src": data.get("src"), "alt": data.get("alt")})
        if tag == "meta" and (data.get("name") or "").lower() == "robots":
            self.robots = (data.get("content") or "").lower()

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self.title_depth:
            self.title_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.title_depth:
            self.title_text.append(data)


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def parse_page(path: Path) -> tuple[SiteParser, str]:
    text = path.read_text(encoding="utf-8")
    parser = SiteParser()
    parser.feed(text)
    return parser, text


def resolve_local(source: Path, raw: str) -> tuple[Path | None, str]:
    value = raw.strip()
    if not value:
        return None, ""
    parsed = urlsplit(value)
    if parsed.scheme.lower() in EXTERNAL_SCHEMES or value.startswith("//"):
        return None, unquote(parsed.fragment)
    path_text = unquote(parsed.path)
    if not path_text:
        return source, unquote(parsed.fragment)
    if path_text.startswith("/"):
        target = ROOT / path_text.lstrip("/")
    else:
        target = source.parent / path_text
    if target.is_dir():
        target = target / "index.html"
    return target.resolve(), unquote(parsed.fragment)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, help="Write the complete report to JSON.")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    page_data: dict[Path, tuple[SiteParser, str]] = {}

    for path in PUBLIC_HTML:
        try:
            page_data[path.resolve()] = parse_page(path)
        except Exception as exc:  # pragma: no cover - defensive gate
            errors.append(f"{rel(path)}: HTML illisible ({exc})")

    for path, (doc, text) in page_data.items():
        label = rel(path)
        if not doc.html_lang.lower().startswith("fr"):
            errors.append(f"{label}: attribut lang français absent")
        if not "".join(doc.title_text).strip():
            errors.append(f"{label}: titre de page absent")
        if doc.h1_count != 1:
            errors.append(f"{label}: {doc.h1_count} balise(s) h1 au lieu d’une")
        robots = {token.strip() for token in doc.robots.split(",") if token.strip()}
        if not {"noindex", "nofollow"}.issubset(robots):
            errors.append(f"{label}: meta robots noindex,nofollow absente ou incomplète")

        duplicate_ids = sorted(key for key, count in Counter(doc.ids).items() if count > 1)
        if duplicate_ids:
            errors.append(f"{label}: identifiants HTML dupliqués {duplicate_ids}")

        for image in doc.images:
            if image["alt"] is None:
                errors.append(f"{label}: image sans attribut alt ({image['src'] or 'src absent'})")

        for pattern in PLACEHOLDERS:
            if pattern.search(text):
                errors.append(f"{label}: placeholder détecté ({pattern.pattern})")
        if PUBLIC_PRICE.search(text):
            errors.append(f"{label}: tarif public potentiel détecté")

        for raw in doc.sources:
            target, _ = resolve_local(path, raw)
            if target is not None and not target.exists():
                errors.append(f"{label}: ressource locale introuvable {raw}")

        for raw in doc.links:
            target, anchor = resolve_local(path, raw)
            if target is None:
                continue
            if not target.exists():
                errors.append(f"{label}: lien local introuvable {raw}")
                continue
            if anchor and target.suffix.lower() == ".html":
                target_doc = page_data.get(target)
                if target_doc is None:
                    try:
                        target_doc = parse_page(target)
                    except Exception:
                        target_doc = None
                if target_doc and anchor not in target_doc[0].ids:
                    errors.append(f"{label}: ancre introuvable {raw}")

    robots_path = ROOT / "robots.txt"
    robots_text = robots_path.read_text(encoding="utf-8") if robots_path.exists() else ""
    if not re.search(r"(?mi)^\s*Disallow:\s*/\s*$", robots_text):
        errors.append("robots.txt: Disallow: / absent")

    simulation = ROOT / "notes-demonstrateurs.html"
    if simulation.exists():
        simulation_text = simulation.read_text(encoding="utf-8").lower()
        if simulation_text.count("simulation illustrative") < 2:
            errors.append("notes-demonstrateurs.html: les deux simulations ne sont pas clairement signalées")

    for svg in sorted((ROOT / "assets" / "img" / "visuals").glob("*.svg")):
        try:
            ElementTree.parse(svg)
        except ElementTree.ParseError as exc:
            errors.append(f"{rel(svg)}: SVG invalide ({exc})")

    css = ROOT / "assets" / "css" / "style.css"
    if css.exists():
        css_text = css.read_text(encoding="utf-8")
        if css_text.count("{") != css_text.count("}"):
            errors.append("assets/css/style.css: accolades déséquilibrées")

    report = {
        "status": "pass" if not errors else "fail",
        "html_pages_checked": len(page_data),
        "svg_files_checked": len(list((ROOT / "assets" / "img" / "visuals").glob("*.svg"))),
        "errors": errors,
        "warnings": warnings,
    }
    if args.json:
        output = args.json if args.json.is_absolute() else ROOT / args.json
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
