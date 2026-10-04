#!/usr/bin/env python3
"""Vérifie la cohérence des deux moitiés de Turnstile dans un profil construit.

Turnstile ne fonctionne que si la vérification serveur et la clé publique du
navigateur sont activées ensemble. Ce contrôle refuse les deux incohérences :
une vérification serveur sans clé publique, et une clé publique publiée alors
que la vérification serveur reste fermée. Il refuse aussi la présence de la
clé secrète dans un artefact public.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / 'serverless/cloudflare/.wrangler-production.generated.json'
PUBLIC = ROOT / 'dist-production/data/automation-config.json'
TEXT_SUFFIXES = {'.json', '.js', '.html', '.txt', '.css'}
SECRET_MARKERS = ('TURNSTILE_SECRET', 'turnstile_secret')


def main() -> int:
    if not GENERATED.is_file() or not PUBLIC.is_file():
        print('FAIL: profil production non construit', file=sys.stderr)
        return 1
    server = json.loads(GENERATED.read_text(encoding='utf-8'))['vars'].get('TURNSTILE_ENABLED') == 'true'
    public = json.loads(PUBLIC.read_text(encoding='utf-8')).get('turnstile') or {}
    browser = public.get('enabled') is True and bool(public.get('site_key'))

    if server != browser:
        side = 'serveur' if server else 'navigateur'
        print(f'FAIL: Turnstile activé côté {side} seulement', file=sys.stderr)
        return 1

    for path in (ROOT / 'dist-production').rglob('*'):
        if path.is_file() and path.suffix in TEXT_SUFFIXES:
            content = path.read_text(encoding='utf-8', errors='ignore')
            if any(marker in content for marker in SECRET_MARKERS):
                print(f'FAIL: référence à la clé secrète dans {path.relative_to(ROOT)}', file=sys.stderr)
                return 1

    state = 'activé des deux côtés' if server else 'fermé des deux côtés'
    print(f'PASS: Turnstile {state}, aucune clé secrète publiée')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
