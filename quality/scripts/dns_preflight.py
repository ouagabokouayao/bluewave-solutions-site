#!/usr/bin/env python3
"""Contrôle avant changement de serveurs de noms pour bluewavesolutions.fr.

Usage : python quality/scripts/dns_preflight.py [--cible ns1.exemple,ns2.exemple]

Lecture seule : quelques requêtes `dig`, aucune modification. Le changement de
serveurs de noms n'est sûr que si le registre .fr ne publie plus de DS : sinon,
les résolveurs qui valident DNSSEC rejetteraient la nouvelle zone, site et courriel
compris. Avec --cible, vérifie aussi que la zone préparée chez le nouveau fournisseur
porte déjà la messagerie.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = json.loads((ROOT / 'serverless/cloudflare/dns-reference-ovh-2026-11-06.json').read_text(encoding='utf-8'))
DOMAIN = REFERENCE['domaine']
REGISTRY = 'd.nic.fr'


def dig(name, kind, server):
    # Le registre répond par une délégation : les NS figurent dans la section autorité.
    result = subprocess.run(['dig', '+noall', '+answer', '+authority', '+time=3', '+tries=1', name, kind, f'@{server}'], capture_output=True, text=True)
    rows = [line.split(None, 4) for line in result.stdout.splitlines() if line.strip() and not line.startswith(';')]
    return [row[4].strip() for row in rows if len(row) == 5 and row[3] == kind]


def mail_records(resolve, server):
    mx = sorted(' '.join(value.rstrip('.').lower().split()) for value in resolve(DOMAIN, 'MX', server))
    spf = [value.replace('" "', '').strip('"') for value in resolve(DOMAIN, 'TXT', server) if 'v=spf1' in value]
    return mx, spf


def preflight(resolve=dig, target=()):
    expected_mx = sorted(entry['valeur'] for entry in REFERENCE['enregistrements'] if entry['type'] == 'MX')
    expected_spf = [entry['valeur'] for entry in REFERENCE['enregistrements'] if entry['role'] == 'spf']
    checks = []
    ds = resolve(DOMAIN, 'DS', REGISTRY)
    checks.append(('DS au registre .fr', not ds, 'absent' if not ds else 'présent : désactiver DNSSEC chez OVH, puis attendre son retrait (TTL 3600 s)'))
    current = sorted(value.rstrip('.') for value in resolve(DOMAIN, 'NS', REGISTRY))
    checks.append(('Délégation actuelle', bool(current), ', '.join(current) or 'illisible'))
    for server in target:
        mx, spf = mail_records(resolve, server)
        checks.append((f'Messagerie servie par {server}', mx == expected_mx and spf == expected_spf,
                       'MX et SPF identiques à la référence' if mx == expected_mx and spf == expected_spf else f'MX {mx}, SPF {spf}'))
    return checks, all(ok for _, ok, _ in checks)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--cible', default='', help='Serveurs de noms attribués par Cloudflare, séparés par des virgules.')
    options = parser.parse_args()
    checks, ready = preflight(target=[name for name in options.cible.split(',') if name])
    for label, ok, detail in checks:
        print(f"{'OK ' if ok else 'NON'}  {label} : {detail}")
    print('GO technique pour changer les serveurs de noms (décision de Joseph requise).' if ready else 'NO GO : ne pas changer les serveurs de noms.')
    return 0 if ready else 1


if __name__ == '__main__':
    sys.exit(main())
