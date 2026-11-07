#!/usr/bin/env python3
"""Vérifie qu'une configuration et un artefact correspondent au profil annoncé.

Profil A : ouverture commerciale manuelle, aucune collecte serveur.
Profil B : automatisation future (D1, Turnstile, Brevo), jamais activée ici.
Le script lit des fichiers locaux : il ne contacte aucun service.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / 'dist-production'
CONFIG_A = ROOT / 'serverless/cloudflare/wrangler.profil-a.jsonc'
CONFIG_B = ROOT / 'serverless/cloudflare/.wrangler-production.generated.json'
SECRET_NAMES = ('BREVO_API_KEY', 'GUARD_HMAC_KEY', 'TURNSTILE_SECRET_KEY', 'NEWSLETTER_TOKEN_SECRET')
FORM_PAGES = ('collaboration.html', 'formation.html', 'qualifier-un-besoin.html')
CLOSED_NOTICE = 'n’envoie rien automatiquement'
OPEN_NOTICE = 'transmet votre demande à BlueWave Solutions'


def load_config(path):
    """Lit un fichier JSON ou JSONC : les commentaires occupent des lignes entières."""
    lines = [line for line in path.read_text(encoding='utf-8').splitlines() if not line.lstrip().startswith('//')]
    return json.loads('\n'.join(lines))


def site_config(site):
    return (json.loads((site / 'data/automation-config.json').read_text(encoding='utf-8')),
            json.loads((site / 'data/analytics-config.json').read_text(encoding='utf-8')))


def common(config, site, newsletter=False):
    errors = []
    variables = config.get('vars', {})
    if config.get('workers_dev') is not False: errors.append('workers_dev doit rester fermé')
    if config.get('preview_urls') is not False: errors.append('preview_urls doit rester fermé')
    if variables.get('NEWSLETTER_ENABLED') != str(newsletter).lower():
        errors.append('la lettre de veille doit être ouverte' if newsletter else 'la lettre de veille doit rester fermée')
    for name in SECRET_NAMES:
        if name in variables: errors.append(f'secret dans la configuration : {name}')
    for page in sorted(site.glob('*.html')):
        if 'data-newsletter-form' in page.read_text(encoding='utf-8'):
            errors.append(f'formulaire de veille publié : {page.name}')
    automation, _ = site_config(site)
    if automation.get('newsletter_enabled') is not newsletter: errors.append('état de la lettre de veille incohérent dans l’artefact')
    page = site / 'lettre-de-veille.html'
    if not page.is_file():
        errors.append('page de la lettre de veille absente : le retrait doit rester possible')
    elif not newsletter:
        text = page.read_text(encoding='utf-8')
        if '<form' in text or 'type="email"' in text: errors.append('formulaire présent sur la page de retrait')
        if 'content="noindex, nofollow"' not in text: errors.append('page de retrait indexable')
    if automation.get('chat_enabled') is not False: errors.append('discussion ouverte dans l’artefact')
    return errors


def indexing_closed(config, site):
    errors = []
    if config.get('vars', {}).get('PUBLIC_INDEXABLE') != 'false': errors.append('indexation ouverte dans la configuration')
    if 'Disallow: /\n' not in (site / 'robots.txt').read_text(encoding='utf-8'): errors.append('robots.txt ouvert')
    if (site / 'sitemap.xml').exists(): errors.append('sitemap présent')
    for page in sorted(site.glob('*.html')):
        if 'content="noindex, nofollow"' not in page.read_text(encoding='utf-8'): errors.append(f'noindex absent : {page.name}')
    return errors


def profile_a(config, site):
    errors = common(config, site) + indexing_closed(config, site)
    variables = config.get('vars', {})
    for name in ('LEADS_ENABLED', 'LEADS_CONTACT_SYNC_ENABLED', 'LEADS_ACK_ENABLED', 'LEADS_NOTIFY_ENABLED',
                 'LEADS_REPLAY_ENABLED', 'CAMPAIGNS_ENABLED', 'EVENTS_ENABLED', 'TURNSTILE_ENABLED'):
        if variables.get(name) != 'false': errors.append(f'{name} doit valoir false')
    for key in ('d1_databases', 'durable_objects', 'migrations', 'triggers', 'routes', 'kv_namespaces', 'r2_buckets'):
        if key in config: errors.append(f'ressource interdite au profil A : {key}')
    if variables.get('LEAD_RETENTION_DAYS') != '': errors.append('LEAD_RETENTION_DAYS doit rester vide')
    automation, analytics = site_config(site)
    if automation.get('lead_endpoint') is not None: errors.append('point d’envoi ouvert dans l’artefact')
    if automation.get('meeting_url') is not None: errors.append('lien de rendez-vous ouvert')
    if (automation.get('turnstile') or {}).get('enabled') is not False: errors.append('Turnstile ouvert dans l’artefact')
    if analytics.get('enabled') is not False or analytics.get('endpoint') or analytics.get('traffic_token'): errors.append('mesure ouverte dans l’artefact')
    for name in FORM_PAGES:
        if CLOSED_NOTICE not in (site / name).read_text(encoding='utf-8'): errors.append(f'avis du courriel préparé absent : {name}')
    return errors


def profile_b(config, site, simulation, newsletter=False):
    errors = common(config, site, newsletter)
    variables = config.get('vars', {})
    for name in ('LEADS_ENABLED', 'TURNSTILE_ENABLED'):
        if variables.get(name) != 'true': errors.append(f'{name} doit valoir true')
    databases = {entry.get('binding'): entry.get('database_id') for entry in config.get('d1_databases', [])}
    if not databases.get('LEADS_DB') or not databases.get('CONVERSION_DB'): errors.append('bases D1 absentes')
    elif databases['LEADS_DB'] == databases['CONVERSION_DB']: errors.append('bases D1 confondues')
    if newsletter:
        if not databases.get('NEWSLETTER_DB') or databases['NEWSLETTER_DB'] in (databases.get('LEADS_DB'), databases.get('CONVERSION_DB')):
            errors.append('base de la lettre de veille absente ou confondue')
        if not variables.get('NEWSLETTER_NOTICE_VERSION'): errors.append('version de l’information absente')
        if not re.fullmatch(r'[1-9][0-9]*', variables.get('NEWSLETTER_PROOF_RETENTION_DAYS', '')): errors.append('durée de la preuve absente')
    if not re.fullmatch(r'[1-9][0-9]*', variables.get('LEAD_RETENTION_DAYS', '')): errors.append('durée de conservation absente')
    if not str(variables.get('ALLOWED_ORIGIN', '')).startswith('https://'): errors.append('origine autorisée invalide')
    if 'durable_objects' not in config: errors.append('garde anti-abus absente')
    automation, _ = site_config(site)
    if automation.get('lead_endpoint') != '/api/leads': errors.append('point d’envoi absent de l’artefact')
    if not (automation.get('turnstile') or {}).get('site_key'): errors.append('clé publique Turnstile absente')
    for name in FORM_PAGES:
        if OPEN_NOTICE not in (site / name).read_text(encoding='utf-8'): errors.append(f'avis de transmission absent : {name}')
    approval = json.loads((ROOT / 'quality/privacy-approval.json').read_text(encoding='utf-8'))
    if approval.get('approved') is not True and not simulation: errors.append('mentions non validées (quality/privacy-approval.json)')
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('profile', choices=('A', 'B'))
    parser.add_argument('--config', type=Path)
    parser.add_argument('--site', type=Path, default=SITE)
    parser.add_argument('--simulation', action='store_true', help='Profil B seulement : contrôle hors publication.')
    parser.add_argument('--newsletter', action='store_true', help='Profil B seulement : la lettre de veille est censée être ouverte.')
    options = parser.parse_args()
    config = load_config(options.config or (CONFIG_A if options.profile == 'A' else CONFIG_B))
    errors = profile_a(config, options.site) if options.profile == 'A' else profile_b(config, options.site, options.simulation, options.newsletter)
    for error in errors:
        print(f'FAIL: {error}')
    if errors:
        return 1
    print(f'PASS: profil {options.profile}' + (' (simulation, non publiable)' if options.simulation else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
