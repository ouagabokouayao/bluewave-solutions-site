#!/usr/bin/env python3
"""Empêche les activations à l'insu du propriétaire dans cette branche de préparation."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
auto = json.loads((ROOT/'data/automation-config.json').read_text())
analytics = json.loads((ROOT/'data/analytics-config.json').read_text())
worker = json.loads((ROOT/'serverless/cloudflare/wrangler.jsonc').read_text())
assert auto['lead_endpoint'] is None and auto['chat_enabled'] is False and auto['newsletter_enabled'] is False and auto['meeting_url'] is None
assert analytics == {'enabled':False,'endpoint':None,'traffic_token':None,'campaigns':[]}
assert all(worker['vars'][key]=='false' for key in ['LEADS_ENABLED','EVENTS_ENABLED','NEWSLETTER_ENABLED'])
assert worker['workers_dev'] is False and worker['preview_urls'] is False
assert 'routes' not in worker and 'route' not in worker
assert 'database_id' not in str(worker)
print('PASS: intégrations distantes désactivées')
