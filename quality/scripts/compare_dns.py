#!/usr/bin/env python3
"""Compare une exportation de zone (format BIND) à la référence OVH du 6 novembre 2026.

Usage : python quality/scripts/compare_dns.py <zone.txt>

Le script lit deux fichiers locaux et ne contacte aucun service. Il ignore SOA, NS
et DNSSEC, qui dépendent du fournisseur cible. Code de sortie 1 si un
enregistrement de messagerie manque ou diffère : la bascule casserait le courriel.
"""
import argparse
import json
import re
import shlex
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'serverless/cloudflare/dns-reference-ovh-2026-11-06.json'
TYPES = {'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA', 'SRV'}
CRITICAL_ROLES = {'messagerie', 'spf'}


def normalise(name, origin):
    name = name.rstrip('.').lower()
    if name in ('@', origin):
        return '@'
    return name[: -len(origin) - 1] if name.endswith('.' + origin) else name


def value_of(kind, fields):
    if kind == 'TXT':
        return ''.join(shlex.split(' '.join(fields)))
    if kind == 'MX':
        return f'{int(fields[0])} {fields[1].rstrip(".").lower()}'
    if kind == 'CNAME':
        return fields[0].rstrip('.').lower()
    return ' '.join(fields)


def parse_zone(text, origin):
    records, last = set(), '@'
    for raw in text.splitlines():
        line = raw.split(';', 1)[0].rstrip() if not '"' in raw else re.sub(r';[^"]*$', '', raw).rstrip()
        if not line.strip() or line.startswith('$'):
            if line.upper().startswith('$ORIGIN'):
                origin = line.split()[1].rstrip('.').lower()
            continue
        fields = line.split()
        name = last if raw[0] in ' \t' else fields.pop(0)
        last = name
        while fields and (fields[0].isdigit() or fields[0].upper() in ('IN', 'CH')):
            fields.pop(0)
        if not fields or fields[0].upper() not in TYPES:
            continue
        kind = fields.pop(0).upper()
        records.add((normalise(name, origin), kind, value_of(kind, fields)))
    return records


def compare(text, reference):
    origin = reference['domaine']
    found = parse_zone(text, origin)
    rows, critical = [], False
    expected = {(entry['nom'], entry['type'], entry['valeur']): entry for entry in reference['enregistrements']}
    for key, entry in expected.items():
        if key in found:
            rows.append(('OK', key, entry['role']))
            continue
        same_slot = [record for record in found if record[:2] == key[:2]]
        state = 'DIFFÉRENT' if same_slot else 'ABSENT'
        rows.append((state, key, entry['role']))
        critical = critical or entry['role'] in CRITICAL_ROLES
    for record in sorted(found - set(expected)):
        rows.append(('EN PLUS', record, 'nouveau'))
    return rows, critical


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('zone', type=Path)
    parser.add_argument('--reference', type=Path, default=REFERENCE)
    options = parser.parse_args()
    reference = json.loads(options.reference.read_text(encoding='utf-8'))
    rows, critical = compare(options.zone.read_text(encoding='utf-8'), reference)
    for state, (name, kind, value), role in rows:
        print(f'{state:10} {name:8} {kind:6} {value:40} {role}')
    if reference['fournisseur']['dnssec']['actif']:
        print('RAPPEL     DNSSEC actif au registre : retirer ou migrer le DS avant de changer les serveurs de noms.')
    if critical:
        print('FAIL : un enregistrement de messagerie manque ou diffère.')
        return 1
    print('PASS : messagerie conservée.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
