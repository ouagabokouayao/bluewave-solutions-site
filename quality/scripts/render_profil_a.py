#!/usr/bin/env python3
"""Rend la configuration de publication du profil A, sans rien déployer.

Point de départ : `serverless/cloudflare/wrangler.profil-a.jsonc`, qui reste
sans route. `--route` ajoute la seule route admise : le domaine personnalisé
`www.bluewavesolutions.fr`. Les interrupteurs de collecte, de veille et
d'indexation ne sont pas modifiés : ils restent fermés.

Le fichier produit est ignoré par Git. Le déploiement réel exige un GO de Joseph.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'serverless/cloudflare/wrangler.profil-a.jsonc'
TARGET = ROOT / 'serverless/cloudflare/.wrangler/profil-a-publication.generated.json'

_spec = importlib.util.spec_from_file_location('check_profile', ROOT / 'quality/scripts/check_profile.py')
check_profile = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_profile)


def render(route=False, target=TARGET):
    config = check_profile.load_config(SOURCE)
    config.pop('$schema', None)
    rebase = lambda value: os.path.relpath((SOURCE.parent / value).resolve(), target.parent.resolve())
    config['main'] = rebase(config['main'])
    config['assets'] = dict(config['assets'], directory=rebase(config['assets']['directory']))
    if route:
        config['routes'] = [dict(entry) for entry in check_profile.PUBLICATION_ROUTES]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--route', action='store_true', help='Ajouter le domaine personnalisé www.bluewavesolutions.fr.')
    parser.add_argument('--output', type=Path, default=TARGET)
    options = parser.parse_args()
    print(f'PASS: configuration rendue : {render(options.route, options.output.resolve())}')
