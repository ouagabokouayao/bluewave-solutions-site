#!/usr/bin/env python3
"""Rend une configuration non versionnée après création des bases D1 distinctes.

Deux bases sont exigées et ne se confondent jamais :

- CONVERSION_DB : compteurs d'événements agrégés, sans donnée personnelle ;
- LEADS_DB      : demandes nominatives.

Aucun identifiant fictif n'est accepté. La route de production n'est jamais
ajoutée d'office : elle demande une option explicite.

LEAD_RETENTION_DAYS reste vide par défaut. Tant qu'aucune durée n'est arrêtée,
le Worker ne purge aucune demande : la valeur n'est pas choisie ici.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'serverless/cloudflare/wrangler.production.jsonc'
TARGET = ROOT / 'serverless/cloudflare/.wrangler-production.generated.json'

UUID = re.compile(r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}')
PLACEHOLDER = '00000000-0000-0000-0000-000000000000'


def _database_id(value, label):
    if not value or not UUID.fullmatch(value):
        raise ValueError(f'Identifiant D1 de production invalide : {label}')
    if value == PLACEHOLDER:
        raise ValueError(f'Base D1 factice interdite : {label}')
    return value


def render(database_id, leads_database_id, *, indexable=False, leads=False, events=False,
           route=False, campaigns=(), turnstile=False, retention_days=None):
    conversion_id = _database_id(database_id, 'CONVERSION_DB')
    leads_id = _database_id(leads_database_id, 'LEADS_DB')
    if conversion_id.lower() == leads_id.lower():
        raise ValueError('CONVERSION_DB et LEADS_DB doivent être deux bases distinctes')
    if any(not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', code) for code in campaigns):
        raise ValueError('Code campagne invalide')
    if retention_days is not None:
        days = int(retention_days)
        if days <= 0:
            raise ValueError('LEAD_RETENTION_DAYS doit être un entier positif')
        retention = str(days)
    else:
        retention = ''
    config = json.loads(TEMPLATE.read_text())
    config['d1_databases'] = [
        {'binding': 'CONVERSION_DB', 'database_name': 'bluewave-conversions-production',
         'database_id': conversion_id},
        {'binding': 'LEADS_DB', 'database_name': 'bluewave-leads-production',
         'database_id': leads_id},
    ]
    config['vars'].update(LEADS_ENABLED=str(leads).lower(), EVENTS_ENABLED=str(events).lower(),
        PUBLIC_INDEXABLE=str(indexable).lower(), ALLOWED_CAMPAIGNS=','.join(campaigns),
        TURNSTILE_ENABLED=str(turnstile).lower(), LEAD_RETENTION_DAYS=retention)
    if route:
        config['routes'] = [{'pattern': 'www.bluewavesolutions.fr', 'custom_domain': True}]
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(config, indent=2) + '\n')
    return TARGET


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database-id', required=True, help='Identifiant D1 de CONVERSION_DB')
    parser.add_argument('--leads-database-id', required=True, help='Identifiant D1 de LEADS_DB')
    parser.add_argument('--indexable', action='store_true')
    parser.add_argument('--leads', action='store_true')
    parser.add_argument('--events', action='store_true')
    parser.add_argument('--turnstile', action='store_true')
    parser.add_argument('--retention-days', type=int, default=None)
    parser.add_argument('--route', action='store_true')
    parser.add_argument('--campaign', action='append', default=[])
    opts = parser.parse_args()
    print(render(opts.database_id, opts.leads_database_id, indexable=opts.indexable,
        leads=opts.leads, events=opts.events, route=opts.route, campaigns=opts.campaign,
        turnstile=opts.turnstile, retention_days=opts.retention_days))
