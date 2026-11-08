#!/usr/bin/env python3
"""Garde anti-publication du Brand Asset System.

Trois familles de contrôles, sans contournement silencieux :

1. Intégrité des registres de prépublication — manifeste des actifs du fondateur
   et registre des supports : clés obligatoires, statuts reconnus, cohérence
   entre statut, autorisation publique et existence réelle du fichier.
2. Étanchéité des pages publiques — aucune page publique ne référence un actif
   au statut TEMP ou REVIEW, ni un fichier de la zone de prépublication, ni un
   gabarit provisoire.
3. Étanchéité du build — si dist/ existe, aucun fichier issu de private/, aucun
   marqueur de prépublication et aucun gabarit provisoire ne s'y trouve.

Le contrôle 3 ne construit pas dist/ : il l'inspecte s'il existe. La construction
et le contrôle de parité restent du ressort de build_dist.py et check_dist.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "private"
PREPUB = PRIVATE / "prepublication"
DIST = ROOT / "dist"

FOUNDER_MANIFEST = PREPUB / "founder" / "founder-assets-manifest.json"
SUPPORTS_REGISTRY = PREPUB / "supports-registry.json"

STATUSES = {"TEMP", "REVIEW", "APPROVED", "PUBLIC_READY"}
BLOCKED_STATUSES = {"TEMP", "REVIEW"}
ASSET_REQUIRED_KEYS = {
    "asset_id", "filename", "version", "status", "usage",
    "ratio", "public_allowed", "approved_by", "approved_at",
}
SUPPORT_REQUIRED_KEYS = {
    "code", "support_id", "titre", "status", "public_allowed",
    "download_enabled", "emplacement", "approved_by", "approved_at",
}
REQUIRED_ALIASES = [
    "FOUNDER_HEADSHOT",
    "FOUNDER_PORTRAIT_VERTICAL",
    "FOUNDER_EXECUTIVE_HORIZONTAL",
    "FOUNDER_SPEAKER",
    "FOUNDER_FIELD",
    "FOUNDER_MEDIA",
    "FOUNDER_SOCIAL",
]
REQUIRED_FOLDERS = [
    "brand", "media", "photos", "video", "decks", "one-pagers",
    "offres", "formation", "collaboration", "founder", "press", "events",
]
# Marqueur littéral imposé aux gabarits de prépublication.
PREPUB_MARKER = "TEMP — DO NOT PUBLISH"
# Variante sans tiret cadratin, pour les formats qui ne l'acceptent pas.
PREPUB_MARKER_ASCII = "TEMP - DO NOT PUBLISH"
PLACEHOLDER_NAME = re.compile(r"(?i)(?:-TEMP\b|placeholder|prepublication)")
TEXT_SUFFIXES = {".html", ".css", ".js", ".json", ".txt", ".svg", ".md", ".vcf"}


def load(path: Path, errors: list[str]) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        errors.append(f"registre illisible : {path.relative_to(ROOT).as_posix()} ({exc})")
        return None


def check_structure(errors: list[str]) -> None:
    if not PREPUB.is_dir():
        errors.append("architecture de prépublication absente : private/prepublication/")
        return
    for folder in REQUIRED_FOLDERS:
        target = PREPUB / folder
        if not target.is_dir():
            errors.append(f"répertoire de prépublication absent : private/prepublication/{folder}/")
        elif not (target / "README.md").is_file():
            errors.append(f"doctrine absente : private/prepublication/{folder}/README.md")
    if not (PRIVATE / "README.md").is_file():
        errors.append("doctrine absente : private/README.md")


def check_founder_manifest(errors: list[str]) -> dict[str, dict]:
    assets: dict[str, dict] = {}
    if not FOUNDER_MANIFEST.is_file():
        errors.append("manifeste des actifs du fondateur absent")
        return assets
    data = load(FOUNDER_MANIFEST, errors)
    if data is None:
        return assets
    entries = data.get("assets")
    if not isinstance(entries, list) or not entries:
        errors.append("manifeste fondateur : aucune entrée d'actif")
        return assets
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("manifeste fondateur : entrée non structurée")
            continue
        asset_id = entry.get("asset_id")
        missing = ASSET_REQUIRED_KEYS - set(entry)
        if missing:
            errors.append(f"manifeste fondateur : clés absentes {asset_id} {sorted(missing)}")
        if not isinstance(asset_id, str) or not asset_id:
            errors.append("manifeste fondateur : asset_id invalide")
            continue
        if asset_id in assets:
            errors.append(f"manifeste fondateur : asset_id dupliqué {asset_id}")
        assets[asset_id] = entry
        status = entry.get("status")
        if status not in STATUSES:
            errors.append(f"manifeste fondateur : statut non reconnu {asset_id} ({status})")
        allowed = entry.get("public_allowed")
        if not isinstance(allowed, bool):
            errors.append(f"manifeste fondateur : public_allowed non booléen {asset_id}")
            allowed = False
        if allowed and status != "PUBLIC_READY":
            errors.append(f"manifeste fondateur : actif autorisé en publication sans statut PUBLIC_READY {asset_id}")
        if status == "PUBLIC_READY":
            for champ in ("filename", "version", "approved_by", "approved_at"):
                if not entry.get(champ):
                    errors.append(f"manifeste fondateur : {champ} requis au statut PUBLIC_READY {asset_id}")
            filename = entry.get("filename")
            if isinstance(filename, str) and filename and not (ROOT / filename).is_file():
                errors.append(f"manifeste fondateur : fichier déclaré absent {asset_id} ({filename})")
        else:
            if entry.get("filename"):
                errors.append(f"manifeste fondateur : filename renseigné hors statut PUBLIC_READY {asset_id}")
            if entry.get("approved_at") or entry.get("approved_by"):
                errors.append(f"manifeste fondateur : approbation renseignée hors statut PUBLIC_READY {asset_id}")
        placeholder = entry.get("placeholder")
        if isinstance(placeholder, str) and placeholder:
            if not placeholder.startswith("private/"):
                errors.append(f"manifeste fondateur : gabarit hors zone privée {asset_id} ({placeholder})")
            elif not (ROOT / placeholder).is_file():
                errors.append(f"manifeste fondateur : gabarit déclaré absent {asset_id} ({placeholder})")
            else:
                content = (ROOT / placeholder).read_text(encoding="utf-8", errors="ignore")
                if PREPUB_MARKER not in content and PREPUB_MARKER_ASCII not in content:
                    errors.append(f"manifeste fondateur : gabarit sans marqueur de prépublication {placeholder}")
    for alias in REQUIRED_ALIASES:
        if alias not in assets:
            errors.append(f"manifeste fondateur : alias requis absent {alias}")
    return assets


def check_supports_registry(errors: list[str]) -> None:
    if not SUPPORTS_REGISTRY.is_file():
        errors.append("registre des supports absent")
        return
    data = load(SUPPORTS_REGISTRY, errors)
    if data is None:
        return
    supports = data.get("supports")
    if not isinstance(supports, list) or not supports:
        errors.append("registre des supports : aucune entrée")
        return
    codes = set()
    for entry in supports:
        if not isinstance(entry, dict):
            errors.append("registre des supports : entrée non structurée")
            continue
        support_id = entry.get("support_id")
        missing = SUPPORT_REQUIRED_KEYS - set(entry)
        if missing:
            errors.append(f"registre des supports : clés absentes {support_id} {sorted(missing)}")
        code = entry.get("code")
        if code in codes:
            errors.append(f"registre des supports : code dupliqué {code}")
        codes.add(code)
        status = entry.get("status")
        if status not in STATUSES:
            errors.append(f"registre des supports : statut non reconnu {support_id} ({status})")
        if entry.get("download_enabled") and status != "PUBLIC_READY":
            errors.append(f"registre des supports : téléchargement actif sans statut PUBLIC_READY {support_id}")
        if entry.get("public_allowed") and status != "PUBLIC_READY":
            errors.append(f"registre des supports : exposition autorisée sans statut PUBLIC_READY {support_id}")
        emplacement = entry.get("emplacement")
        if isinstance(emplacement, str) and emplacement and not emplacement.startswith("private/"):
            errors.append(f"registre des supports : emplacement hors zone privée {support_id} ({emplacement})")
        filename = entry.get("filename")
        if filename and status != "PUBLIC_READY":
            errors.append(f"registre des supports : fichier final déclaré hors statut PUBLIC_READY {support_id}")
    expected_codes = set("ABCDEFGHIJ")
    if not expected_codes.issubset(codes):
        errors.append(f"registre des supports : codes absents {sorted(expected_codes - codes)}")


def check_public_pages(assets: dict[str, dict], errors: list[str]) -> None:
    blocked_ids = {
        asset_id for asset_id, entry in assets.items()
        if entry.get("status") in BLOCKED_STATUSES
    }
    blocked_files = set()
    for entry in assets.values():
        if entry.get("status") in BLOCKED_STATUSES:
            for champ in ("filename", "placeholder"):
                value = entry.get(champ)
                if isinstance(value, str) and value:
                    blocked_files.add(value)
                    blocked_files.add(Path(value).name)
    for page in sorted(ROOT.glob("*.html")):
        text = page.read_text(encoding="utf-8")
        if "private/" in text:
            errors.append(f"{page.name} : référence à la zone de prépublication")
        for asset_id in sorted(blocked_ids):
            if asset_id in text:
                errors.append(f"{page.name} : actif non approuvé référencé {asset_id}")
        for blocked in sorted(blocked_files):
            if blocked in text:
                errors.append(f"{page.name} : gabarit non approuvé référencé {blocked}")
        if PREPUB_MARKER in text or PREPUB_MARKER_ASCII in text:
            errors.append(f"{page.name} : marqueur de prépublication dans une page publique")


def check_dist(errors: list[str]) -> str:
    if not DIST.is_dir():
        return "dist/ absent — contrôle d'étanchéité du build non applicable"
    files = [path for path in DIST.rglob("*") if path.is_file()]
    for path in files:
        relative = path.relative_to(DIST).as_posix()
        if relative == "private" or relative.startswith("private/") or "private" in Path(relative).parts[:-1]:
            errors.append(f"zone de prépublication publiée : {relative}")
        if PLACEHOLDER_NAME.search(Path(relative).name):
            errors.append(f"gabarit de prépublication publié : {relative}")
        if path.suffix.lower() in TEXT_SUFFIXES:
            content = path.read_text(encoding="utf-8", errors="ignore")
            if PREPUB_MARKER in content or PREPUB_MARKER_ASCII in content:
                errors.append(f"marqueur de prépublication publié : {relative}")
    return f"dist/ inspecté — {len(files)} fichiers"


def main() -> int:
    errors: list[str] = []
    check_structure(errors)
    assets = check_founder_manifest(errors)
    check_supports_registry(errors)
    check_public_pages(assets, errors)
    dist_state = check_dist(errors)
    if errors:
        print("FAIL: garde anti-publication Brand Asset System")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"PASS: garde anti-publication — {len(assets)} actifs déclarés, {dist_state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
