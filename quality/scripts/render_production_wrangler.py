#!/usr/bin/env python3
"""Rend une configuration non versionnée après création d'une base D1 distincte."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / 'serverless/cloudflare/wrangler.production.jsonc'
TARGET = ROOT / 'serverless/cloudflare/.wrangler-production.generated.json'


def render(database_id, *, indexable=False, leads=False, events=False, route=False, campaigns=()):
    if not re.fullmatch(r'[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}', database_id):
        raise ValueError('Identifiant D1 de production invalide')
    if database_id == '00000000-0000-0000-0000-000000000000':
        raise ValueError('Base D1 factice interdite')
    if any(not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', code) for code in campaigns):
        raise ValueError('Code campagne invalide')
    config = json.loads(TEMPLATE.read_text())
    config['d1_databases'] = [{'binding':'CONVERSION_DB',
        'database_name':'bluewave-conversions-production', 'database_id':database_id}]
    config['vars'].update(LEADS_ENABLED=str(leads).lower(), EVENTS_ENABLED=str(events).lower(),
        PUBLIC_INDEXABLE=str(indexable).lower(), ALLOWED_CAMPAIGNS=','.join(campaigns))
    if route:
        config['routes'] = [{'pattern':'www.bluewavesolutions.fr','custom_domain':True}]
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(config, indent=2) + '\n')
    return TARGET


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--database-id', required=True)
    parser.add_argument('--indexable', action='store_true')
    parser.add_argument('--leads', action='store_true')
    parser.add_argument('--events', action='store_true')
    parser.add_argument('--route', action='store_true')
    parser.add_argument('--campaign', action='append', default=[])
    opts = parser.parse_args()
    print(render(opts.database_id,indexable=opts.indexable,leads=opts.leads,
        events=opts.events,route=opts.route,campaigns=opts.campaign))
