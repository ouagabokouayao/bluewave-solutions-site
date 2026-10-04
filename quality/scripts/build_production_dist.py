#!/usr/bin/env python3
"""Dérive un artefact production explicite de dist/ sans ouvrir la source Preview."""
import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'dist'
OUT = ROOT / 'dist-production'
ORIGIN = 'https://www.bluewavesolutions.fr'
OLD = 'https://ouagabokouayao.github.io/bluewave-solutions-site/'


def article(document, heading, body):
    pattern = re.compile(r'<article><h2>' + re.escape(heading) + r'</h2>.*?</article>', re.S)
    result, count = pattern.subn(lambda _: f'<article><h2>{heading}</h2>{body}</article>', document)
    if count != 1:
        raise ValueError(f'Rubrique confidentialité absente ou répétée : {heading}')
    return result


def privacy(document, leads, events, traffic):
    if leads:
        transmission = ('<p>Lorsque vous envoyez le formulaire, BlueWave reçoit les données nécessaires '
            'à la réponse. Le service Cloudflare transmet la demande au prestataire Brevo, qui conserve '
            'un contact dans la liste Leads et expédie un accusé et une notification interne. '
            'Un échec partiel peut nécessiter un rapprochement manuel. Vous pouvez toujours choisir '
            'le lien de messagerie et contrôler votre courriel avant son envoi.</p>')
        recipients = ('<p>Le responsable BlueWave et ses personnes habilitées ; Cloudflare pour '
            'l’hébergement, les mesures techniques et la protection contre les abus ; Brevo pour '
            'les contacts et e-mails transactionnels. Aucune inscription à une liste de veille '
            'ni automatisation marketing n’est active.</p>')
    else:
        transmission = ('<p>La transmission automatisée reste désactivée. Le site prépare un courriel '
            'que vous relisez et envoyez depuis votre propre messagerie. BlueWave ne reçoit ces '
            'informations que si vous l’envoyez.</p>')
        recipients = ('<p>Le responsable BlueWave et ses personnes habilitées. Brevo ne reçoit aucune '
            'demande depuis ce site tant que le formulaire automatisé est désactivé.</p>')
    document = article(document, 'Comment votre message est transmis', transmission)
    document = article(document, 'Destinataires', recipients)
    document = article(document, 'Bases juridiques',
        '<ul><li>Mesures précontractuelles demandées par la personne pour un projet ou une mission ;'
        '</li><li>intérêt légitime documenté pour répondre aux autres sollicitations '
        'professionnelles, sécuriser le site et mesurer son fonctionnement de façon '
        'proportionnée ;</li><li>consentement distinct uniquement si une lettre de veille '
        'est ultérieurement ouverte.</li></ul>')
    document = article(document, 'Données concernées',
        '<ul><li>Si le formulaire est actif : nom, organisation, e-mail, type de demande, '
        'description, territoire, thèmes, délai et préférence de contact ;</li><li>données '
        'techniques nécessaires à la connexion et à la sécurité, dont l’adresse IP traitée '
        'temporairement par l’hébergeur et une empreinte HMAC utilisée pour limiter les abus ;'
        '</li><li>si la mesure est active : compteurs quotidiens de pages, parcours, offres, '
        'statuts et campagnes préautorisées, sans contenu libre ni identité.</li></ul>')
    document = article(document, 'Hébergement et transferts',
        '<p>Le site est servi par Cloudflare Workers et Static Assets. Cloudflare traite les '
        'données techniques nécessaires à l’hébergement et à la sécurité ; Brevo, si le formulaire '
        'est activé, traite les données de contact et les courriels. Des traitements ou transferts '
        'hors de l’Union européenne peuvent dépendre des contrats et paramètres réels de ces '
        'prestataires. Le responsable fournit sur demande les informations contractuelles applicables ; '
        'aucune résidence exclusivement européenne n’est garantie ici.</p>')
    analytics_text = ('<p>Cloudflare Web Analytics mesure les visites et performances sans cookie '
        'publicitaire.</p>' if traffic else '<p>Cloudflare Web Analytics est désactivé.</p>')
    analytics_text += ('<p>Des événements de conversion limités à des catégories prédéfinies sont '
        'agrégés par jour dans Cloudflare D1. Aucun nom, e-mail, organisation, texte libre, identifiant '
        'visiteur ou URL brute n’y est envoyé. Les agrégats sont purgés après treize mois glissants.</p>'
        if events else '<p>Aucun événement de conversion distant n’est activé.</p>')
    if events or traffic:
        analytics_text += ('<p>La base juridique et les conditions de dispense de consentement pour '
            'la mesure d’audience sont documentées par le responsable.</p>')
    document = article(document, 'Cookies et traceurs', analytics_text +
        '<p>Aucun cookie publicitaire, newsletter, chat ou lien de rendez-vous automatisé n’est activé. '
        'Cloudflare peut traiter des données techniques de connexion pour servir et sécuriser le site.</p>')
    document = article(document, 'Lettre de veille',
        '<p>La lettre de veille est désactivée. Aucun formulaire de prise de contact ne vaut '
        'inscription marketing. Une éventuelle activation ultérieure demandera un consentement séparé.</p>')
    document = article(document, 'Durées de conservation',
        '<ul><li>Demandes sans suite : jusqu’à trois ans après le dernier contact, sous réserve de '
        'l’examen du responsable et des obligations applicables ;</li><li>relations contractuelles : '
        'selon les obligations propres au dossier ;</li><li>agrégats de conversion : treize mois '
        'glissants lorsqu’ils sont activés ;</li><li>garde anti-abus : fenêtres temporaires '
        'd’environ vingt minutes ;</li><li>journaux techniques des prestataires : selon leurs '
        'paramètres contractuels effectivement retenus.</li></ul>')
    document = article(document, 'Évolution',
        '<p>Pour exercer vos droits d’accès, de rectification, d’effacement, d’opposition ou de '
        'limitation, utilisez l’adresse de contact indiquée plus haut. BlueWave rapproche les '
        'demandes et supprime les données dans ses systèmes et auprès de ses prestataires '
        'lorsqu’une suppression est applicable.</p>')
    document = document.replace('Politique de confidentialité du site BlueWave Solutions en phase de préactivation.',
        'Traitement des données du site BlueWave Solutions et des demandes de contact.')
    return document


def build(indexable=False, leads=False, events=False, token=None, campaigns=()):
    if not SOURCE.is_dir():
        raise ValueError('Construire et vérifier dist/ avant le profil production')
    if token is not None and not re.fullmatch(r'[a-f0-9]{32}', token):
        raise ValueError('Jeton Web Analytics invalide')
    if any(not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', c) for c in campaigns):
        raise ValueError('Code campagne invalide')
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(SOURCE, OUT)
    pages = sorted(OUT.glob('*.html'))
    if len(pages) != 20:
        raise ValueError(f'20 pages attendues, {len(pages)} trouvées')
    for page in pages:
        document = page.read_text(encoding='utf-8')
        if document.count(OLD) < 2:
            raise ValueError(f'Canonical/OG absent : {page.name}')
        document = document.replace(OLD, ORIGIN + '/')
        desired = 'index, follow' if indexable and page.name != '404.html' else 'noindex, nofollow'
        document, count = re.subn(r'(<meta name="robots" content=")[^"]+("/?>)',
            lambda m: m.group(1) + desired + m.group(2), document, count=1)
        if count != 1:
            raise ValueError(f'Méta robots absente : {page.name}')
        if page.name == 'politique-confidentialite.html':
            document = privacy(document, leads, events, bool(token))
        if page.name == 'mentions-legales.html':
            document = document.replace('Mentions légales — préactivation', 'Mentions légales')
            document = document.replace('Cette page est préparée pour la phase de préactivation. Elle sera complétée après immatriculation avant toute activation publique définitive.',
                'Ces mentions seront complétées après immatriculation sur présentation des justificatifs correspondants.')
            document = article(document, 'Hébergement',
                '<p>Hébergement technique du site public : Cloudflare Workers et Static Assets, '
                'services fournis par Cloudflare, Inc., 101 Townsend St., San Francisco, '
                'CA 94107, États-Unis. Téléphone : +1 888 993 5273.</p>')
            document = article(document, 'Publication',
                '<p>Le site est public et indexable. Les mentions légales seront complétées après '
                'immatriculation sur justificatifs.</p>' if indexable else
                '<p>Le site reste non indexable pendant sa préparation. Les mentions légales '
                'seront complétées après immatriculation sur justificatifs.</p>')
        page.write_text(document, encoding='utf-8')
    (OUT / 'robots.txt').write_text(
        ('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ' + ORIGIN + '/sitemap.xml\n')
        if indexable else 'User-agent: *\nDisallow: /\n', encoding='utf-8')
    if indexable:
        links = ''.join(f'<url><loc>{html.escape(ORIGIN + "/" + p.name)}</loc></url>'
            for p in pages if p.name != '404.html')
        (OUT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + links + '</urlset>', encoding='utf-8')
    (OUT / 'data/automation-config.json').write_text(json.dumps({
        'provider':'brevo', 'lead_endpoint':'/api/leads' if leads else None,
        'chat_enabled':False, 'newsletter_enabled':False, 'meeting_url':None
    }, ensure_ascii=False) + '\n', encoding='utf-8')
    (OUT / 'data/analytics-config.json').write_text(json.dumps({
        'enabled':bool(events or token), 'endpoint':'/api/events' if events else None,
        'traffic_token':token, 'campaigns':list(campaigns)
    }, ensure_ascii=False) + '\n', encoding='utf-8')
    public_manifest = OUT / 'MANIFEST_SHA256.json'
    entries = []
    for path in sorted(p for p in OUT.rglob('*') if p.is_file() and p != public_manifest):
        content = path.read_bytes()
        entries.append({'path':path.relative_to(OUT).as_posix(),
            'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content)})
    public_manifest.write_text(json.dumps(entries,ensure_ascii=False,indent=2) + '\n',encoding='utf-8')
    reports = ROOT / 'quality/reports'
    reports.mkdir(parents=True, exist_ok=True)
    (reports / 'production-dist-manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2) + '\n')
    return len(entries) + 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--indexable', action='store_true')
    parser.add_argument('--leads', action='store_true')
    parser.add_argument('--events', action='store_true')
    parser.add_argument('--traffic-token')
    parser.add_argument('--campaign', action='append', default=[])
    opts = parser.parse_args()
    print(f'PASS: {build(opts.indexable,opts.leads,opts.events,opts.traffic_token,opts.campaign)} fichiers de production dérivés')
