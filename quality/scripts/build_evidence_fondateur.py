#!/usr/bin/env python3
"""Projette la sélection OBY validée en corpus public « Parcours du fondateur ».

Entrées :
- la sélection métier 01_SELECTION_OBY_BLUEWAVE_V1.json (passée en argument) ;
- la source de vérité OBY assets/data/mediatheque-oby.json (dépôt OBY local).

Sorties :
- assets/data/oby-preuves-selectionnees.json : données publiques du corpus ;
- quality/media-provenance-oby-bluewave.json : traçabilité des copies d'images.

Le script refuse toute entrée qui n'est plus « public-valide » côté OBY et ne la
remplace jamais : il s'arrête et signale le delta.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DATA = ROOT / "assets" / "data" / "oby-preuves-selectionnees.json"
PROVENANCE = ROOT / "quality" / "media-provenance-oby-bluewave.json"
OBY_DATA = "assets/data/mediatheque-oby.json"
OBY_BASE_URL = "https://ouagabokouayao.github.io/oby-site-academique/"

# Statuts OBY exclus de toute publication BlueWave.
STATUT_REQUIS = "public-valide"

# Filtres publics du corpus fondateur, dans l'ordre d'affichage.
FILTRES = [
    ("tout", "Tout", None),
    ("afrique-ouest", "Afrique de l’Ouest", None),
    ("france-mediterranee", "France / Méditerranée", None),
    ("gouvernance-droit-mer", "Gouvernance & droit de la mer",
     {"gouvernance-maritime", "droit-de-la-mer", "droit-public", "securite-maritime", "gouvernance", "usages"}),
    ("littoral-environnement", "Littoral & environnement",
     {"littoral", "environnement-marin", "aires-marines-protegees", "pollution-marine", "climat", "ocean"}),
    ("economie-bleue-innovation", "Économie bleue & innovation",
     {"economie-bleue", "innovation-maritime", "industrie-maritime", "tourisme", "developpement-durable"}),
    ("recherche-formation", "Recherche & formation", {"recherche", "formation"}),
]
THEMATIQUES = [(slug, label, tags) for slug, label, tags in FILTRES if tags]

# Normalisation du nom du fondateur : forme publique unique sur le site BlueWave.
NOM_PUBLIC = "OUAGA Bokoua Yao"
ALIAS = ["Joseph OUAGA", "OUAGA Joseph", "Joseph"]


def webp_dimensions(path: Path) -> tuple[int, int]:
    """Largeur et hauteur d'un WebP, pour servir width/height sans reflow."""
    data = path.read_bytes()[:40]
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"fichier non WebP : {path}")
    chunk = data[12:16]
    if chunk == b"VP8X":
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    if chunk == b"VP8 ":
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L":
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise ValueError(f"format WebP non reconnu : {path}")


def normaliser_nom(texte: str) -> str:
    for alias in ALIAS:
        texte = texte.replace(alias, NOM_PUBLIC)
    return texte


def filtres_de(themes: list[str], zone: str) -> list[str]:
    tags = set(themes)
    retenus = [zone] if zone in {"afrique-ouest", "france-mediterranee"} else []
    retenus += [slug for slug, _, attendus in THEMATIQUES if tags & attendus]
    return retenus


def libelles_thematiques(filtres: list[str]) -> list[str]:
    """Au plus deux thèmes affichés sur la carte, conformément à la spécification UX."""
    labels = [label for slug, label, _ in THEMATIQUES if slug in filtres]
    return labels[:2]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", type=Path, required=True, help="01_SELECTION_OBY_BLUEWAVE_V1.json")
    parser.add_argument("--oby-root", type=Path, required=True, help="racine du dépôt OBY")
    parser.add_argument("--copy-images", action="store_true", help="recopier les images sources")
    args = parser.parse_args()

    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    source = json.loads((args.oby_root / OBY_DATA).read_text(encoding="utf-8"))
    par_id = {entry["id"]: entry for entry in source}

    refus: list[str] = []
    items: list[dict] = []
    provenance: list[dict] = []

    for rang, choix in enumerate(selection["items"], start=1):
        identifiant = choix["source_id"]
        origine = par_id.get(identifiant)
        if origine is None:
            refus.append(f"{identifiant} : absent de la source OBY")
            continue
        if origine.get("statut") != STATUT_REQUIS:
            refus.append(f"{identifiant} : statut OBY « {origine.get('statut')} », publication refusée")
            continue
        if origine.get("fichier") != choix["image_source_oby"]:
            refus.append(f"{identifiant} : image source OBY « {origine.get('fichier')} » différente de la sélection")
            continue

        chemin_source = args.oby_root / choix["image_source_oby"]
        if not chemin_source.is_file():
            refus.append(f"{identifiant} : image source absente du dépôt OBY")
            continue

        destination = ROOT / choix["image_destination_bluewave"]
        if args.copy_images:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(chemin_source, destination)
        if not destination.is_file():
            refus.append(f"{identifiant} : image destination absente côté BlueWave")
            continue

        octets_source = chemin_source.read_bytes()
        octets_destination = destination.read_bytes()
        sha_source = hashlib.sha256(octets_source).hexdigest()
        sha_destination = hashlib.sha256(octets_destination).hexdigest()
        largeur, hauteur = webp_dimensions(destination)
        filtres = filtres_de(choix["themes"], choix["zone"])

        items.append({
            "id": identifiant,
            "rang": rang,
            "titre": choix["titre"],
            "date": choix["date"],
            "lieu": choix["lieu"],
            "zone": choix["zone"],
            "filtres": filtres,
            "themes_affiches": libelles_thematiques(filtres),
            "image": choix["image_destination_bluewave"],
            "largeur": largeur,
            "hauteur": hauteur,
            "alt": normaliser_nom(origine.get("alt") or choix["titre"]),
            "attribution": choix["attribution"],
            "lien_oby": choix["source_page_oby"],
            "note_prudence": choix["note_prudence"],
        })

        provenance.append({
            "id": identifiant,
            "source_repository": selection["source_repository"],
            "source_ref": selection["source_ref"],
            "source_path": choix["image_source_oby"],
            "destination_path": choix["image_destination_bluewave"],
            "sha256_source": sha_source,
            "sha256_destination": sha_destination,
            "identique": sha_source == sha_destination,
            "bytes_source": len(octets_source),
            "bytes_destination": len(octets_destination),
            "statut_source": origine.get("statut"),
            "type_media_source": origine.get("typeMedia"),
            "date_canonique_source": origine.get("date_canonique"),
            "lieu_source": origine.get("lieu"),
        })

    if refus:
        print("FAIL: entrées refusées, aucune écriture", file=sys.stderr)
        for motif in refus:
            print(f"- {motif}", file=sys.stderr)
        return 1

    PUBLIC_DATA.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA.write_text(json.dumps({
        "version": 1,
        "corpus": "parcours-fondateur",
        "titre": "Parcours et environnements du fondateur",
        "attribution": selection["items"][0]["attribution"],
        "filtres": [{"slug": slug, "label": label} for slug, label, _ in FILTRES],
        "items": items,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    PROVENANCE.parent.mkdir(parents=True, exist_ok=True)
    PROVENANCE.write_text(json.dumps({
        "version": 1,
        "source_repository": selection["source_repository"],
        "source_ref": selection["source_ref"],
        "source_data": selection["source_data"],
        "entrees": provenance,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    divergences = [row["id"] for row in provenance if not row["identique"]]
    print(f"PASS: {len(items)} entrées publiées, {len(provenance)} copies tracées")
    print(f"- {PUBLIC_DATA.relative_to(ROOT)}")
    print(f"- {PROVENANCE.relative_to(ROOT)}")
    print(f"- copies byte-to-byte : {len(provenance) - len(divergences)}/{len(provenance)}")
    if divergences:
        print("- divergences SHA : " + ", ".join(divergences))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
