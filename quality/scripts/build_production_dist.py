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
APPROVAL = ROOT / 'quality/privacy-approval.json'
ORIGIN = 'https://www.bluewavesolutions.fr'
OLD = 'https://ouagabokouayao.github.io/bluewave-solutions-site/'
OLD_PATH = '/bluewave-solutions-site/'
# Carte de partage composée à partir du logo officiel de référence (sans redessin).
SOCIAL_IMAGE = 'assets/img/brand/social/bluewave-partage-1200x630.png'
OFFICIAL_LOGO = 'assets/img/brand/logo/logo-bluewave-horizontal-officiel.png'
LOGO_URL = ORIGIN + '/' + OFFICIAL_LOGO
# Le texte affiché avant envoi décrit le canal réellement ouvert par le profil.
FORM_PAGES = ('collaboration.html', 'formation.html', 'qualifier-un-besoin.html')
CLOSED_FORM_NOTICE = ('Ce formulaire n’envoie rien automatiquement : il prépare un courriel que vous relisez, '
    'puis envoyez vous-même depuis votre messagerie.')
# La page et son script n'existent que dans un artefact où la lettre est ouverte.
NEWSLETTER_PAGE = 'lettre-de-veille.html'
NEWSLETTER_TEMPLATE = ROOT / 'quality/templates/lettre-de-veille.main.html'
NEWSLETTER_SCRIPT = 'assets/js/newsletter.js'
LEGAL_FOOTER = '<a href="politique-confidentialite.html">Confidentialité</a>'
# Une demande de contact ne vaut jamais inscription : la lettre ouverte, cette case
# n'aurait aucun effet. Elle cède la place à un lien vers la page dédiée.
LEAD_NEWSLETTER_OPTION = re.compile(r'<label class="consent-check" for="lead-newsletter" hidden>.*?</label>', re.S)
LEAD_NEWSLETTER_LINK = ('<p class="note">Cette demande ne vous inscrit à aucune liste. Pour recevoir la lettre de veille, '
    f'utilisez <a href="{NEWSLETTER_PAGE}">sa page dédiée</a>.</p>')
OPEN_FORM_NOTICE = ('Ce formulaire transmet votre demande à BlueWave Solutions. Si la transmission échoue, '
    'un courriel prêt à envoyer vous est proposé.')


def social(document, name):
    """Ajoute l'image de partage et, sur l'accueil, les données structurées.

    Les données structurées ne décrivent que des faits publiés sur le site :
    nom, adresse, logo, courriel de contact, description et zones prioritaires.
    Aucun client, partenaire, adresse postale, téléphone ou date de création.
    """
    tags = (f'<meta property="og:image" content="{ORIGIN}/{SOCIAL_IMAGE}">'
            '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
            '<meta property="og:image:alt" content="BlueWave Solutions — conseil, études, recherche, innovation">'
            '<meta name="twitter:card" content="summary_large_image">')
    if name == 'index.html':
        description = re.search(r'<meta name="description" content="([^"]*)"', document)
        graph = {'@context': 'https://schema.org', '@graph': [
            {'@type': 'Organization', '@id': ORIGIN + '/#organisation', 'name': 'BlueWave Solutions',
             'url': ORIGIN + '/', 'logo': LOGO_URL, 'email': 'bluewavesolutions3399@gmail.com',
             'description': html.unescape(description.group(1)) if description else None,
             'areaServed': ['France', 'Méditerranée', 'Côte d’Ivoire', 'Afrique de l’Ouest'],
             'knowsAbout': ['Gouvernance maritime', 'Gestion côtière', 'Économie bleue',
                            'Vulnérabilité côtière et adaptation', 'Concertation et médiation de projets']},
            {'@type': 'WebSite', '@id': ORIGIN + '/#site', 'name': 'BlueWave Solutions', 'url': ORIGIN + '/',
             'inLanguage': 'fr', 'publisher': {'@id': ORIGIN + '/#organisation'}}]}
        payload = json.dumps(graph, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
        tags += f'<script type="application/ld+json">{payload}</script>'
    if document.count('</head>') != 1:
        raise ValueError('Balise </head> absente ou répétée')
    return document.replace('</head>', tags + '</head>')


def privacy_gate(requires_approval, simulation):
    """Interdit un artefact publiable tant que les mentions ne sont pas validées.

    Le profil fermé et les simulations restent disponibles. L’indexation
    ou l’activation d’une collecte exige une validation explicite.
    """
    if not requires_approval or simulation:
        return
    if not APPROVAL.is_file():
        raise ValueError('Verrou confidentialité : quality/privacy-approval.json absent')
    approval = json.loads(APPROVAL.read_text(encoding='utf-8'))
    pending = [item['rubrique'] for item in approval.get('affirmations_a_valider', [])
               if item.get('statut') != 'VALIDE']
    if approval.get('approved') is not True or pending:
        raise ValueError(
            'Verrou confidentialité : artefact indexable ou avec collecte refusé. '
            f'Affirmations non validées : {", ".join(sorted(set(pending))) or "approbation absente"}. '
            'Utiliser --privacy-simulation pour un artefact de test.')


def article(document, heading, body):
    pattern = re.compile(r'<article><h2>' + re.escape(heading) + r'</h2>.*?</article>', re.S)
    result, count = pattern.subn(lambda _: f'<article><h2>{heading}</h2>{body}</article>', document)
    if count != 1:
        raise ValueError(f'Rubrique confidentialité absente ou répétée : {heading}')
    return result


def newsletter_page():
    """Dérive la page de veille de la page de confidentialité déjà produite."""
    document = (OUT / 'politique-confidentialite.html').read_text(encoding='utf-8')
    main = NEWSLETTER_TEMPLATE.read_text(encoding='utf-8').strip()
    document, count = re.subn(r'<main id="contenu">.*</main>', lambda _: main, document, flags=re.S)
    if count != 1:
        raise ValueError('Contenu principal absent de la page de référence')
    description = 'Inscription à la lettre de veille de BlueWave Solutions, confirmée par courriel et retirable à tout moment.'
    document = re.sub(r'(<title>)[^<]*(</title>)', r'\g<1>Lettre de veille | BlueWave Solutions\g<2>', document, count=1)
    document = re.sub(r'(<meta (?:name|property)="(?:og:|twitter:)?description" content=")[^"]*', lambda m: m.group(1) + description, document)
    document = re.sub(r'(<meta property="og:title" content=")[^"]*', r'\g<1>Lettre de veille | BlueWave Solutions', document)
    document = document.replace(ORIGIN + '/politique-confidentialite.html', ORIGIN + '/' + NEWSLETTER_PAGE)
    return document.replace('</body>', f'<script src="{NEWSLETTER_SCRIPT}" defer></script></body>')


def privacy(document, leads, events, traffic, newsletter=False):
    if leads:
        transmission = ('<p>Lorsque vous envoyez le formulaire, BlueWave reçoit les données nécessaires '
            'à la réponse. Le service Cloudflare transmet la demande au prestataire Brevo, qui conserve '
            'un contact dans la liste Leads et expédie un accusé et une notification interne. '
            'Un échec partiel peut nécessiter un rapprochement manuel. Vous pouvez toujours choisir '
            'le lien de messagerie et contrôler votre courriel avant son envoi.</p>')
        recipients = ('<p>Le fondateur de BlueWave Solutions, seul destinataire à ce jour ; Cloudflare pour '
            'l’hébergement, les mesures techniques et la protection contre les abus ; Brevo pour '
            'les contacts et e-mails transactionnels ; Google, qui fournit la messagerie de réception. '
            + ('' if newsletter else 'Aucune inscription à une liste de veille ni automatisation marketing n’est active.') + '</p>')
    else:
        transmission = ('<p>La transmission automatisée reste désactivée. Le site prépare un courriel '
            'que vous relisez et envoyez depuis votre propre messagerie. BlueWave ne reçoit ces '
            'informations que si vous l’envoyez.</p>')
        recipients = ('<p>Le fondateur de BlueWave Solutions, seul destinataire à ce jour. Les courriels '
            'sont reçus dans une messagerie fournie par Google (Gmail). Brevo ne reçoit aucune '
            'demande depuis ce site tant que le formulaire automatisé est désactivé.</p>')
    document = article(document, 'Comment votre message est transmis', transmission)
    document = article(document, 'Destinataires', recipients)
    # Formulations de principe validées par 04B pour la configuration statique.
    measured = ', sécuriser le site et en mesurer le fonctionnement de façon proportionnée' if (events or traffic) else ' et sécuriser le site'
    document = article(document, 'Bases juridiques',
        '<ul><li>Mesures précontractuelles prises à votre demande, uniquement lorsque votre message '
        'porte sur une mission ou un projet et que leurs conditions sont réunies ;</li><li>intérêt '
        f'légitime de BlueWave à répondre aux contacts professionnels{measured}, sous réserve d’une '
        'mise en balance avec vos intérêts, libertés et droits ;</li><li>' +
        ('la lettre de veille est un traitement distinct, fondé sur votre consentement spécifique, '
         'que vous pouvez retirer à tout moment.' if newsletter else
         'la lettre de veille est un traitement distinct, désactivé ; s’il était ouvert, il reposerait '
         'sur votre consentement spécifique.') + '</li></ul>')
    if not leads:
        data = ('<ul><li>les informations que vous choisissez d’inclure dans votre courriel : '
            'nom, organisation, adresse e-mail, description de la demande et, le cas échéant, '
            'vos réponses aux questions de qualification ;</li><li>données techniques nécessaires '
            'à la connexion et à la sécurité, traitées par l’hébergeur.</li></ul>')
    else:
        data = None
    document = article(document, 'Données concernées', data or
        '<ul><li>Si le formulaire est actif : nom, organisation, e-mail, type de demande, '
        'description, territoire, thèmes, délai et préférence de contact ;</li><li>données '
        'techniques nécessaires à la connexion et à la sécurité, dont l’adresse IP traitée '
        'temporairement par l’hébergeur et une empreinte HMAC utilisée pour limiter les abus ;'
        '</li><li>si la mesure est active : compteurs quotidiens de pages, parcours, offres, '
        'statuts et campagnes préautorisées, sans contenu libre ni identité.</li></ul>')
    document = article(document, 'Hébergement et transferts',
        '<p>Le site est servi par Cloudflare Workers et Static Assets. Cloudflare traite les '
        'données techniques nécessaires à l’hébergement et à la sécurité ; Brevo, si le formulaire '
        'est activé, traite les données de contact et les courriels. Les courriels adressés à '
        'BlueWave sont reçus dans une messagerie fournie par Google (Gmail). Des traitements ou transferts '
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
        # Aucune dispense de consentement n'est revendiquée : le régime applicable
        # doit être établi avant toute activation de la mesure.
        analytics_text += ('<p>Le régime applicable à cette mesure (consentement ou exemption) est '
            'établi par le responsable avant son activation ; aucune exemption n’est présumée.</p>')
    document = article(document, 'Cookies et traceurs', analytics_text +
        '<p>Aucun cookie publicitaire, ' + ('' if newsletter else 'newsletter, ') + 'chat ou lien de rendez-vous automatisé n’est activé. '
        'Cloudflare peut traiter des données techniques de connexion pour servir et sécuriser le site.</p>')
    document = article(document, 'Lettre de veille',
        '<p>L’inscription se fait sur une page dédiée et ne prend effet qu’après confirmation par un lien '
        'reçu par courriel, valable vingt-quatre heures. BlueWave conserve votre adresse, vos rubriques, '
        'la version de l’information présentée et les dates de demande, de confirmation et de retrait, '
        'dans une base distincte des demandes de contact. Brevo reçoit votre adresse pour expédier la '
        'lettre. Chaque lettre permet de se désinscrire ; aucun formulaire de prise de contact ne vaut '
        'inscription.</p>' if newsletter else
        '<p>La lettre de veille est désactivée. Aucun formulaire de prise de contact ne vaut '
        'inscription marketing. Une éventuelle activation ultérieure demandera un consentement séparé.</p>')
    durations = ('<ul><li>Demandes de contact : le temps nécessaire à leur traitement ;</li><li>contacts '
        'professionnels susceptibles d’un suivi commercial : trois ans au plus à compter du dernier '
        'contact, durée de référence retenue en matière de prospection et non durée applicable à '
        'toutes les données ;</li><li>relations contractuelles : selon les obligations propres au dossier ;</li>')
    if events:
        durations += '<li>agrégats de conversion : treize mois glissants ;</li>'
    if leads or newsletter:
        durations += '<li>garde anti-abus : fenêtres temporaires d’environ vingt minutes ;</li>'
    if newsletter:
        durations += ('<li>lettre de veille : jusqu’à votre désinscription ; une adresse jamais confirmée '
            'est supprimée au plus tard trente jours après l’expiration du lien ; la preuve d’un '
            'consentement retiré, selon la durée arrêtée par le responsable ;</li>')
    durations += ('<li>journaux techniques des prestataires : selon leurs paramètres contractuels '
        'effectivement retenus.</li></ul>')
    document = article(document, 'Durées de conservation', durations)
    document = article(document, 'Évolution',
        '<p>Pour exercer vos droits d’accès, de rectification, d’effacement, d’opposition ou de '
        'limitation, utilisez l’adresse de contact indiquée plus haut. Chaque demande est traitée '
        'manuellement : BlueWave recherche les données concernées dans sa messagerie et, le cas '
        'échéant, auprès des prestataires effectivement utilisés, puis vous informe des suites '
        'données. Aucune suppression automatique n’est présentée comme opérationnelle.</p>'
        '<p>Cette politique sera mise à jour avant toute activation d’un traitement distant.</p>')
    document = document.replace('Politique de confidentialité du site BlueWave Solutions en phase de préactivation.',
        'Traitement des données du site BlueWave Solutions et des demandes de contact.')
    return document


def build(indexable=False, leads=False, events=False, token=None, campaigns=(), privacy_simulation=False,
          turnstile_site_key=None, newsletter=False):
    privacy_gate(indexable or leads or events or newsletter or token is not None, privacy_simulation)
    # Turnstile ne s'active pas à moitié : sans clé publique, le navigateur ne
    # peut obtenir aucun jeton et toute demande serait refusée côté serveur.
    if turnstile_site_key is not None and not re.fullmatch(r'[A-Za-z0-9_-]{8,64}', turnstile_site_key):
        raise ValueError('Clé publique Turnstile invalide')
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
    if len(pages) != 21:
        raise ValueError(f'21 pages attendues, {len(pages)} trouvées')
    for page in pages:
        document = page.read_text(encoding='utf-8')
        if document.count(OLD) < 2:
            raise ValueError(f'Canonical/OG absent : {page.name}')
        document = document.replace(OLD, ORIGIN + '/')
        if page.name == 'index.html':
            # La racine est l'adresse publique de l'accueil.
            document = document.replace(ORIGIN + '/index.html"', ORIGIN + '/"')
        # La page 404 de GitHub Pages fixe <base> sur le chemin du projet.
        # Servie à la racine du domaine, elle perdrait styles, logos et liens.
        document = document.replace(OLD_PATH, '/')
        if 'bluewave-solutions-site' in document:
            raise ValueError(f'Chemin GitHub Pages résiduel : {page.name}')
        desired = 'index, follow' if indexable and page.name != '404.html' else 'noindex, nofollow'
        document, count = re.subn(r'(<meta name="robots" content=")[^"]+("/?>)',
            lambda m: m.group(1) + desired + m.group(2), document, count=1)
        if count != 1:
            raise ValueError(f'Méta robots absente : {page.name}')
        if page.name != '404.html':
            document = social(document, page.name)
        if page.name in FORM_PAGES:
            if document.count(CLOSED_FORM_NOTICE) != 1:
                raise ValueError(f'Avis de transmission absent ou répété : {page.name}')
            if leads:
                document = document.replace(CLOSED_FORM_NOTICE, OPEN_FORM_NOTICE)
        if page.name == 'politique-confidentialite.html':
            document = privacy(document, leads, events, bool(token), newsletter)
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
        if newsletter and page.name == 'qualifier-un-besoin.html':
            document, count = LEAD_NEWSLETTER_OPTION.subn(lambda _: LEAD_NEWSLETTER_LINK, document)
            if count != 1:
                raise ValueError('Option de veille absente ou répétée du questionnaire')
        if newsletter:
            if document.count(LEGAL_FOOTER) != 1:
                raise ValueError(f'Pied de page absent ou répété : {page.name}')
            document = document.replace(LEGAL_FOOTER, f'{LEGAL_FOOTER} · <a href="{NEWSLETTER_PAGE}">Lettre de veille</a>')
        page.write_text(document, encoding='utf-8')
    if newsletter:
        (OUT / NEWSLETTER_PAGE).write_text(newsletter_page(), encoding='utf-8')
        shutil.copyfile(ROOT / NEWSLETTER_SCRIPT, OUT / NEWSLETTER_SCRIPT)
        pages.append(OUT / NEWSLETTER_PAGE)
    (OUT / SOCIAL_IMAGE).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / SOCIAL_IMAGE, OUT / SOCIAL_IMAGE)
    # Les pages servent un logo allégé ; les données structurées citent l'original.
    shutil.copyfile(ROOT / OFFICIAL_LOGO, OUT / OFFICIAL_LOGO)
    (OUT / 'robots.txt').write_text(
        ('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ' + ORIGIN + '/sitemap.xml\n')
        if indexable else 'User-agent: *\nDisallow: /\n', encoding='utf-8')
    if indexable:
        canonicals = []
        for page in pages:
            if page.name == '404.html':
                continue
            document = page.read_text(encoding='utf-8')
            hrefs = re.findall(r'<link rel="canonical" href="([^"]+)">', document)
            if len(hrefs) != 1:
                raise ValueError(f'Canonical absente ou ambiguë : {page.name}')
            url = f'{ORIGIN}/' if page.name == 'index.html' else f'{ORIGIN}/{page.name}'
            if html.unescape(hrefs[0]) == url:
                canonicals.append(url)
        links = ''.join(f'<url><loc>{html.escape(url)}</loc></url>' for url in canonicals)
        (OUT / 'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + links + '</urlset>', encoding='utf-8')
    (OUT / 'data/automation-config.json').write_text(json.dumps({
        'provider':'brevo', 'lead_endpoint':'/api/leads' if leads else None,
        'chat_enabled':False, 'newsletter_enabled':bool(newsletter), 'meeting_url':None,
        # Seule la clé publique entre dans le build. La clé secrète reste un
        # secret de runtime et n'a aucune raison d'exister ici.
        'turnstile':{'enabled':bool(turnstile_site_key), 'site_key':turnstile_site_key}
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
    # Un artefact de simulation est marqué comme tel : il sert aux contrôles,
    # jamais à une publication.
    (reports / 'production-build-mode.json').write_text(json.dumps({
        'indexable': bool(indexable), 'privacy_simulation': bool(privacy_simulation),
        'publishable': bool(indexable) and not privacy_simulation
    }, ensure_ascii=False) + '\n')
    return len(entries) + 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--indexable', action='store_true')
    parser.add_argument('--leads', action='store_true')
    parser.add_argument('--events', action='store_true')
    parser.add_argument('--newsletter', action='store_true', help='Ajoute la page de la lettre de veille et ses mentions.')
    parser.add_argument('--traffic-token')
    parser.add_argument('--campaign', action='append', default=[])
    parser.add_argument('--privacy-simulation', action='store_true',
        help='Artefact de test : contourne le verrou de validation des mentions, sans produire un artefact publiable.')
    parser.add_argument('--turnstile-site-key',
        help='Clé PUBLIQUE Turnstile. Son absence laisse le canal fermé ; la clé secrète ne passe jamais par ici.')
    opts = parser.parse_args()
    print(f'PASS: {build(opts.indexable,opts.leads,opts.events,opts.traffic_token,opts.campaign,opts.privacy_simulation,opts.turnstile_site_key,opts.newsletter)} fichiers de production dérivés')
