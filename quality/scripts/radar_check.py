#!/usr/bin/env python3
"""Contrôle du radar interne d'opportunités.

Le radar prépare des décisions ; il ne publie rien et n'envoie rien. Ce script
vérifie trois choses : que sa configuration est cohérente, qu'aucune alerte n'est
activée, et qu'il ne fuit pas dans le build public.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RADAR = ROOT / "quality" / "radar"
FICHIERS = ["README.md", "types.json", "schema-opportunite.json", "scoring.json",
            "opportunites.json", "mapping-crm.json", "alertes.md", "alertes-config.json",
            "doctrine-recherche-appliquee.md", "doctrine-evenements-interventions.md"]
ID = re.compile(r"^OPP-\d{3,}$")  # canon du CRM maître : OPP-014, OPP-015, OPP-016…
URL = re.compile(r"^https://[^\s\"']+$")


def charger(nom: str, errors: list[str]):
    chemin = RADAR / nom
    if not chemin.is_file():
        errors.append(f"radar: fichier absent {nom}")
        return None
    if chemin.suffix != ".json":
        return chemin.read_text(encoding="utf-8")
    try:
        return json.loads(chemin.read_text(encoding="utf-8"))
    except ValueError as exc:
        errors.append(f"radar: JSON invalide {nom} ({exc})")
        return None


def main() -> int:
    errors: list[str] = []
    if not RADAR.is_dir():
        print("FAIL: quality/radar absent")
        return 1
    for nom in FICHIERS:
        if not (RADAR / nom).is_file():
            errors.append(f"radar: fichier absent {nom}")

    types = charger("types.json", errors) or {}
    scoring = charger("scoring.json", errors) or {}
    schema = charger("schema-opportunite.json", errors) or {}
    registre = charger("opportunites.json", errors) or {}
    mapping = charger("mapping-crm.json", errors) or {}
    alertes = charger("alertes-config.json", errors) or {}

    # --- Scoring : pondérations totales, seuils ordonnés, statuts déclarés.
    poids = sum(c.get("poids", 0) for c in scoring.get("criteres", []))
    if poids != 100:
        errors.append(f"radar: somme des pondérations de scoring = {poids}, attendu 100")
    # Décisions et cycle de vie sont deux ensembles distincts et disjoints.
    DECISIONS = ["GO À PRÉPARER", "À ÉTUDIER", "VEILLE", "NO GO"]
    STATUTS = ["DÉTECTÉE", "À QUALIFIER", "ACTION EN COURS", "CLÔTURÉE", "EXPIRÉE"]
    decisions = scoring.get("decisions", [])
    statuts = schema.get("statuts", [])
    if sorted(decisions) != sorted(DECISIONS):
        errors.append(f"radar: ensemble des décisions non canonique {decisions}")
    if sorted(statuts) != sorted(STATUTS):
        errors.append(f"radar: ensemble des statuts non canonique {statuts}")
    if sorted(schema.get("decisions", [])) != sorted(DECISIONS):
        errors.append("radar: décisions du schéma non alignées sur le scoring")
    if set(decisions) & set(statuts):
        errors.append(f"radar: décision et statut se recouvrent {sorted(set(decisions) & set(statuts))}")
    if "statuts" in scoring:
        errors.append("radar: le scoring ne doit pas porter de statut — il ne produit qu'une décision recommandée")
    seuils = [x.get("min") for x in scoring.get("seuils_indicatifs", [])]
    if seuils != sorted(seuils, reverse=True):
        errors.append("radar: seuils de scoring non ordonnés")
    for seuil in scoring.get("seuils_indicatifs", []):
        recommandee = seuil.get("decision_recommandee")
        if recommandee not in DECISIONS:
            errors.append(f"radar: seuil vers une valeur qui n'est pas une décision {recommandee}")
        if recommandee in STATUTS:
            errors.append(f"radar: un seuil ne peut pas recommander un statut {recommandee}")

    # --- Le score ne décide pas : le schéma doit porter une décision humaine distincte.
    noms = {c.get("nom") for c in schema.get("champs", [])}
    for requis in ["id", "url_source", "score", "decision_recommandee", "decision_humaine", "statut"]:
        if requis not in noms:
            errors.append(f"radar: champ absent du schéma {requis}")
    if "decision_humaine" in schema.get("champs_obligatoires", []):
        errors.append("radar: decision_humaine ne peut pas être obligatoire — elle reste vide jusqu'à décision")
    if "url_source" not in schema.get("champs_obligatoires", []):
        errors.append("radar: url_source doit être obligatoire")

    # --- Registre : aucune fiche fictive, aucun doublon d'id ni d'URL.
    types_connus = {t["slug"] for t in types.get("types_opportunite", [])}
    roles_connus = {r["slug"] for r in types.get("roles_possibles", [])}
    items = registre.get("items", [])
    if not isinstance(items, list):
        errors.append("radar: opportunites.json items n'est pas une liste")
        items = []
    vus_id: set[str] = set()
    vus_url: set[str] = set()
    aujourdhui = date.today().isoformat()
    for item in items:
        oid = item.get("id", "")
        if not ID.match(oid):
            errors.append(f"radar: id non conforme {oid!r}, format attendu OPP-NNN, canon du CRM maître")
        if oid in vus_id:
            errors.append(f"radar: id dupliqué {oid}")
        vus_id.add(oid)
        url = item.get("url_source", "")
        if not URL.match(url or ""):
            errors.append(f"radar: url_source absente ou non conforme sur {oid}")
        if url in vus_url:
            errors.append(f"radar: url_source rattachée à plusieurs fiches {url}")
        vus_url.add(url)
        if item.get("type") not in types_connus:
            errors.append(f"radar: type inconnu sur {oid} ({item.get('type')})")
        if item.get("role_possible") not in roles_connus:
            errors.append(f"radar: rôle inconnu sur {oid} ({item.get('role_possible')})")
        if item.get("statut") not in STATUTS:
            errors.append(f"radar: statut inconnu sur {oid} ({item.get('statut')})")
        if item.get("statut") in DECISIONS:
            errors.append(f"radar: une décision est employée comme statut sur {oid}")
        if item.get("decision_recommandee") not in DECISIONS:
            errors.append(f"radar: décision recommandée invalide sur {oid} ({item.get('decision_recommandee')})")
        if item.get("decision_recommandee") in STATUTS:
            errors.append(f"radar: un statut est employé comme décision recommandée sur {oid}")
        humaine = item.get("decision_humaine")
        if humaine is not None and humaine not in DECISIONS:
            errors.append(f"radar: décision humaine invalide sur {oid} ({humaine})")
        for manquant in set(schema.get("champs_obligatoires", [])) - set(item):
            errors.append(f"radar: champ obligatoire absent sur {oid} ({manquant})")
        blob = json.dumps(item, ensure_ascii=False).casefold()
        for interdit in ["exemple", "fictif", "fictive", "lorem", "démonstration", "placeholder", "à compléter"]:
            if interdit in blob:
                errors.append(f"radar: fiche d'exemple ou de remplissage détectée sur {oid} ({interdit})")
        if item.get("date_detection", aujourdhui) > aujourdhui:
            errors.append(f"radar: date de détection dans le futur sur {oid}")

    # --- Anti-doublon avec le CRM : une seule clé d'identité, dans les deux sens.
    identite = mapping.get("cle_identite", {})
    if identite.get("champ") != "id":
        errors.append("radar: la clé d'identité CRM doit être le champ id")
    if "OPP-NNN" not in (identite.get("format") or ""):
        errors.append("radar: le format d'identifiant doit reprendre le canon du CRM (OPP-NNN)")
    if "CRM" not in (identite.get("canon") or ""):
        errors.append("radar: le canon d'identifiant doit désigner le CRM maître")
    crm_statuts = mapping.get("correspondance_statuts", {})
    crm_decisions = mapping.get("correspondance_decisions", {})
    for statut in STATUTS:
        if statut not in crm_statuts:
            errors.append(f"radar: statut non mappé vers le CRM {statut}")
    for decision in DECISIONS:
        if decision not in crm_decisions:
            errors.append(f"radar: décision non mappée vers le CRM {decision}")
    if set(crm_statuts) & set(crm_decisions):
        errors.append("radar: décisions et statuts partagent une entrée de mapping CRM")
    if not mapping.get("anti_doublon"):
        errors.append("radar: règles anti-doublon absentes du mapping CRM")

    # --- Alertes : rien d'activé, aucune clé en clair.
    if alertes.get("active") is not False:
        errors.append("radar: les alertes ne doivent pas être activées dans ce lot")
    for nom, canal in (alertes.get("canaux") or {}).items():
        if canal.get("active") is not False:
            errors.append(f"radar: canal d'alerte activé {nom}")
        for cle, valeur in canal.items():
            if cle.endswith("_key") and valeur:
                errors.append(f"radar: clé d'API en clair dans le canal {nom}")
    for declencheur in alertes.get("declencheurs", []):
        if declencheur.get("active") is not False:
            errors.append(f"radar: déclencheur armé {declencheur.get('slug')}")
    if not alertes.get("garde_fous"):
        errors.append("radar: garde-fous d'alerte absents")

    # --- Étanchéité : le radar ne doit apparaître dans aucune page publique.
    for page in sorted(ROOT.glob("*.html")):
        texte = page.read_text(encoding="utf-8")
        for marqueur in ["quality/radar", "opportunites.json", "OPP-20", "radar interne"]:
            if marqueur.casefold() in texte.casefold():
                errors.append(f"{page.name}: référence au radar interne ({marqueur})")
    dist = ROOT / "dist"
    if dist.is_dir():
        for chemin in dist.rglob("*"):
            if chemin.is_file() and "radar" in chemin.relative_to(dist).as_posix().casefold():
                errors.append(f"dist: fichier du radar servi {chemin.name}")

    rapport = {"status": "pass" if not errors else "fail",
               "fiches": len(items), "alertes_actives": bool(alertes.get("active")), "errors": errors}
    print(json.dumps(rapport, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
