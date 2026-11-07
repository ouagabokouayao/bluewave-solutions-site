#!/usr/bin/env python3
"""Prépare l'import manuel des fiches du radar dans le CRM maître.

Usage : python quality/scripts/radar_export_crm.py --registre <opportunites.json> --sortie <fichier.json>

Le radar alimente le CRM ; il ne le remplace pas. Ce script ne crée aucune base :
il traduit les fiches selon quality/radar/mapping-crm.json et écrit un fichier
JSON hors du dépôt public, que l'on importe à la main dans le CRM.
Sans --sortie, il se contente de compter les fiches exportables.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RADAR = ROOT / 'quality/radar'
ID = re.compile(r'OPP-\d{3,}')


def lookup(item, dotted):
    value = item
    for part in dotted.split('.'):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def export(registry, mapping, schema):
    errors, rows, ids, urls = [], [], set(), set()
    required = schema.get('champs_obligatoires', [])
    for index, item in enumerate(registry.get('items', [])):
        label = item.get('id') or f'fiche {index + 1}'
        if not ID.fullmatch(str(item.get('id', ''))):
            errors.append(f'{label} : identifiant hors du canon CRM (OPP-NNN)')
        if item.get('id') in ids:
            errors.append(f'{label} : identifiant en double')
        if item.get('url_source') in urls:
            errors.append(f'{label} : url_source déjà rattachée à une autre fiche')
        ids.add(item.get('id'))
        urls.add(item.get('url_source'))
        for field in required:
            if item.get(field) in (None, '', []):
                errors.append(f'{label} : champ obligatoire absent ({field})')
        row = {}
        for pair in mapping['correspondances']:
            value = lookup(item, pair['radar'])
            if pair['radar'] == 'statut':
                value = mapping['correspondance_statuts'].get(value, value)
            if pair['radar'] in ('decision_humaine', 'decision_recommandee'):
                value = mapping['correspondance_decisions'].get(value, value)
            row[pair['crm']] = value
        rows.append(row)
    return rows, errors


def inside_repository(path):
    try:
        path.resolve().relative_to(ROOT)
        return True
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--registre', type=Path, default=RADAR / 'opportunites.json')
    parser.add_argument('--sortie', type=Path)
    options = parser.parse_args()
    mapping = json.loads((RADAR / 'mapping-crm.json').read_text(encoding='utf-8'))
    schema = json.loads((RADAR / 'schema-opportunite.json').read_text(encoding='utf-8'))
    registry = json.loads(options.registre.read_text(encoding='utf-8'))
    rows, errors = export(registry, mapping, schema)
    for error in errors:
        print(f'FAIL : {error}')
    if errors:
        return 1
    if not options.sortie:
        print(f'PASS : {len(rows)} fiche(s) exportable(s), aucun fichier écrit.')
        return 0
    if inside_repository(options.sortie):
        print('FAIL : la sortie doit se trouver hors du dépôt public.')
        return 1
    if options.sortie.exists():
        print('FAIL : la sortie existe déjà ; aucun écrasement.')
        return 1
    options.sortie.write_text(json.dumps({'source': 'radar BlueWave', 'cle': mapping['cle_identite']['champ'],
        'opportunities': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'PASS : {len(rows)} fiche(s) écrite(s) dans {options.sortie}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
