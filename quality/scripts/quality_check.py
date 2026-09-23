#!/usr/bin/env python3
from __future__ import annotations
import re, sys, json
from collections import Counter
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
ROOT=Path(__file__).resolve().parents[2]
HTML=sorted(ROOT.glob('*.html'))
HELD={'assets/img/site/hero-lagoon.jpg','assets/img/site/about-mangrove-optimized.jpg','assets/img/site/about-mangrove.jpg','assets/img/site/domaines-research-vessel.jpg','assets/img/site/domaines-research-vessel.png'}
PRICE=re.compile(r'\b\d[\d\s.,]*(?:€|EUR|FCFA|XOF)\b',re.I)
FORBIDDEN=[
    re.compile(r'7\s+offres\s+c[oœ]ur',re.I),
    re.compile(r'implantation\s+(?:locale\s+)?(?:en\s+)?c[oô]te d[’\']ivoire',re.I),
    re.compile(r'link' r'edin',re.I),
    re.compile('|'.join(['Aix-'+'Marseille Université','AMI'+'DEX','PRO'+'TEUS','INDE'+'MER','IT'+'LOS','Ham'+'bourg','Mon'+'aco']),re.I),
    re.compile(r'Repères institutionnels et expériences ' r'valorisables',re.I),
    re.compile(r'\bAquaLab\b',re.I),
    re.compile(r'\bJoseph\b',re.I),
]
SECRET=re.compile(r'(?i)(?:api[_-]?key|secret|token)\s*[=:]\s*["\'][A-Za-z0-9_\-]{16,}')
MEDIA_ASSETS=[
    'assets/img/visuals/visualisation-methode-bluewave.svg',
    'assets/img/visuals/feuille-route-bluewave.svg',
    'assets/img/visuals/visualisation-donnees-decision.svg',
    'assets/img/visuals/apercu-diagnostic.svg',
    'assets/img/visuals/matrice-risques-opportunites.svg',
    'assets/img/visuals/matrice-acteurs-usages.svg',
    'assets/img/visuals/apercu-note-strategique.svg',
    'assets/img/visuals/apercu-fiche-projet.svg',
    'assets/img/visuals/apercu-support-formation.svg',
    'assets/img/visuals/visualisation-deux-marches.svg',
]
FAVICON='assets/img/brand/logo/favicon-bluewave-board-192-preview.png'
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.lang='';self.h1=0;self.links=[];self.src=[];self.img=[];self.robots='';self.title='';self._title=False;self.ids=[];self.fields=[];self.labels=[]
    def handle_starttag(self,t,a):
        d=dict(a)
        if t=='html': self.lang=(d.get('lang') or '')
        if t=='h1': self.h1+=1
        if t=='title': self._title=True
        if d.get('id'): self.ids.append(d['id'])
        if t=='a' and d.get('href') is not None:self.links.append(d.get('href') or '')
        if t in {'img','script','source'} and d.get('src') is not None:self.src.append(d.get('src') or '')
        if t=='link' and d.get('href') is not None:self.src.append(d.get('href') or '')
        if t=='img':self.img.append(d)
        if t=='meta' and (d.get('name') or '').lower()=='robots':self.robots=(d.get('content') or '').lower()
        if t=='label' and d.get('for'):self.labels.append(d['for'])
        if t in {'select','input','textarea'} and (d.get('type') or '').lower() not in {'hidden','submit','button'}:self.fields.append((t,d.get('id') or ''))
    def handle_endtag(self,t):
        if t=='title':self._title=False
    def handle_data(self,data):
        if self._title:self.title+=data

def local_target(source,raw):
    p=urlsplit(raw)
    if p.scheme or raw.startswith('//') or raw.startswith('mailto:') or raw.startswith('tel:'):return None
    path=unquote(p.path)
    if not path:return source
    return (ROOT/path.lstrip('/')).resolve() if path.startswith('/') else (source.parent/path).resolve()

def main():
    errors=[];warnings=[];parsed={}
    for f in HTML:
        text=f.read_text(encoding='utf-8');p=P();p.feed(text);parsed[f.resolve()]=(p,text)
        if not p.lang.lower().startswith('fr'):errors.append(f'{f.name}: lang fr absent')
        if p.h1!=1:errors.append(f'{f.name}: {p.h1} h1')
        if not p.title.strip():errors.append(f'{f.name}: title absent')
        if text.count(f'<link rel="icon" type="image/png" href="{FAVICON}">')!=1:errors.append(f'{f.name}: favicon absent ou dupliqué')
        robots={x.strip() for x in p.robots.split(',') if x.strip()}
        if not {'noindex','nofollow'}.issubset(robots):errors.append(f'{f.name}: noindex,nofollow absent')
        if len(p.ids)!=len(set(p.ids)):errors.append(f'{f.name}: ids dupliqués')
        if PRICE.search(text):errors.append(f'{f.name}: prix public détecté')
        for rx in FORBIDDEN:
            if rx.search(text):errors.append(f'{f.name}: formulation interdite {rx.pattern}')
        for held in HELD:
            if held in text:errors.append(f'{f.name}: média HOLD référencé {held}')
        for im in p.img:
            if im.get('alt') is None:errors.append(f'{f.name}: img sans alt')
            if not im.get('width') or not im.get('height'):errors.append(f'{f.name}: img sans width/height')
            if (im.get('src') or '').startswith(('http://','https://')):errors.append(f'{f.name}: image externe liée à chaud')
        for t,i in p.fields:
            if i and i not in p.labels:errors.append(f'{f.name}: champ {i} sans label')
        for raw in p.links+p.src:
            target=local_target(f,raw)
            if target is not None and not target.exists():errors.append(f'{f.name}: lien/ressource locale absente {raw}')
        if 'mediatheque.html' not in p.links:errors.append(f'{f.name}: lien Médiathèque absent')
        if 'actualites.html' not in p.links:errors.append(f'{f.name}: lien Actualités absent')
        if 'assets/js/automation.js' not in p.src:errors.append(f'{f.name}: couche automation absente')
    # Canon commercial
    if not (ROOT/FAVICON).is_file():errors.append(f'favicon absent {FAVICON}')
    sol=(ROOT/'solutions.html').read_text(encoding='utf-8')
    for name in [
      'Diagnostic stratégique maritime, littoral ou portuaire',
      'Vulnérabilité côtière, adaptation et options de décision',
      'Gouvernance, acteurs, usages et acceptabilité',
      'Structuration de projets maritimes, littoraux ou d’économie bleue',
      'Formation et renforcement des capacités','Note stratégique BlueWave','Atelier de cadrage BlueWave']:
        if name not in sol:errors.append(f'solutions.html: canon absent {name}')
    # Médiathèque : corpus, visionneuse et métadonnées
    media=(ROOT/'mediatheque.html').read_text(encoding='utf-8')
    if media.count('class="media-card"')!=len(MEDIA_ASSETS):errors.append('mediatheque.html: corpus incomplet')
    for asset in MEDIA_ASSETS:
        if asset not in media:errors.append(f'mediatheque.html: visuel absent {asset}')
    if '<dialog ' not in media or 'id="media-dialog"' not in media:errors.append('mediatheque.html: visionneuse dialog absente')
    canonical='https://ouagabokouayao.github.io/bluewave-solutions-site/mediatheque.html'
    if f'<link rel="canonical" href="{canonical}">' not in media:errors.append('mediatheque.html: canonical incorrecte')
    if f'<meta property="og:url" content="{canonical}">' not in media:errors.append('mediatheque.html: og:url incorrecte')
    # Actualités : page, données et règles de sélection
    news_page=(ROOT/'actualites.html').read_text(encoding='utf-8')
    news_js=(ROOT/'assets/js/actualites.js').read_text(encoding='utf-8')
    index_text=(ROOT/'index.html').read_text(encoding='utf-8')
    for required in [
      '<title>Actualités &amp; veille maritime | BlueWave Solutions</title>',
      'Veille maritime & littorale',
      'Les signaux à suivre pour comprendre les transformations de la mer et du littoral.',
    ]:
        if required not in news_page:errors.append(f'actualites.html: contenu canonique absent {required}')
    if 'Lire à la source' not in news_js:errors.append('actualites.js: libellé source absent')
    if 'Ce qui bouge sur la mer, le littoral et la gouvernance maritime.' not in index_text:errors.append('index.html: titre veille canonique absent')
    for forbidden in ['veille automatisée','sélectionne automatiquement']:
        if forbidden in (index_text+'\n'+news_page).lower():errors.append(f'actualités: promesse automatique résiduelle {forbidden}')
    filters=['Tout','Littoral & adaptation','Gouvernance maritime','Environnement marin','Économie bleue','Ports & activités maritimes','Droit & sécurité maritime','Méditerranée','Afrique de l’Ouest']
    for label in filters:
        if label not in news_page:errors.append(f'actualites.html: filtre absent {label}')
    try:
        sources=json.loads((ROOT/'data/actualites-sources.json').read_text(encoding='utf-8'))
        source_ids={source['id'] for source in sources['sources']}
        source_required={'id','name','url','feed_url','type','country','geography','themes','weight','enabled'}
        for source in sources['sources']:
            if missing_source := source_required-set(source):errors.append(f"actualites-sources.json: clés absentes {source.get('id')} {sorted(missing_source)}")
            if source.get('type')!='rss':errors.append(f"actualites-sources.json: type non RSS {source.get('id')}")
        news=json.loads((ROOT/'data/actualites.json').read_text(encoding='utf-8'))
        status=json.loads((ROOT/'data/actualites-status.json').read_text(encoding='utf-8'))
        items=news['items']
        if len(items)>80:errors.append('actualites.json: plus de 80 éléments')
        urls=set();ids=set();featured=[]
        required_keys={'id','title','url','source_id','source_name','published_at','fetched_at','theme','geographies','excerpt','score','score_global','score_relevance_bluewave','eligible_featured','featured'}
        valid_themes={'littoral-adaptation','gouvernance-maritime','environnement-marin','economie-bleue','ports-maritime','droit-securite'}
        reference_date=datetime.fromisoformat(news['generated_at'].replace('Z','+00:00'))
        for item in items:
            missing=required_keys-set(item)
            if missing:errors.append(f"actualites.json: clés absentes {sorted(missing)}")
            if item.get('source_id') not in source_ids:errors.append(f"actualites.json: source inconnue {item.get('source_id')}")
            if item.get('theme') not in valid_themes:errors.append(f"actualites.json: thème invalide {item.get('theme')}")
            if len(item.get('excerpt',''))>240:errors.append(f"actualites.json: extrait trop long {item.get('id')}")
            if item.get('url') in urls:errors.append(f"actualites.json: URL dupliquée {item.get('url')}")
            if item.get('id') in ids:errors.append(f"actualites.json: id dupliqué {item.get('id')}")
            urls.add(item.get('url'));ids.add(item.get('id'))
            if item.get('featured'):featured.append(item)
            published_date=datetime.fromisoformat(item['published_at'].replace('Z','+00:00'))
            if reference_date-published_date>timedelta(days=news.get('window_days',90)):errors.append(f"actualites.json: élément hors fenêtre {item.get('id')}")
            score=item.get('score',{})
            if score.get('total') != sum(score.get(key,0) for key in ('freshness','relevance','authority','geography','diversity')):errors.append(f"actualites.json: score incohérent {item.get('id')}")
            if item.get('score_global') != score.get('total'):errors.append(f"actualites.json: score global incohérent {item.get('id')}")
            if item.get('score_relevance_bluewave') != score.get('relevance'):errors.append(f"actualites.json: pertinence BlueWave incohérente {item.get('id')}")
            if not isinstance(item.get('eligible_featured'),bool):errors.append(f"actualites.json: éligibilité featured invalide {item.get('id')}")
            if item.get('featured') and (not item.get('eligible_featured') or item.get('score_relevance_bluewave',0)<15):errors.append(f"actualites.json: featured non éligible {item.get('id')}")
        if len(featured)>3:errors.append('actualites.json: plus de 3 éléments à la une')
        for source_id in source_ids:
            if sum(1 for item in featured if item.get('source_id')==source_id)>2:errors.append(f'actualites.json: plus de 2 éléments à la une pour {source_id}')
        if len(featured)>=2 and len({item.get('theme') for item in featured})<2:errors.append('actualites.json: diversité thématique à la une insuffisante')
        if status.get('kept') != len(items):errors.append('actualites-status.json: compteur kept incohérent')
        if status.get('featured_eligible') != sum(1 for item in items if item.get('eligible_featured')):errors.append('actualites-status.json: compteur featured_eligible incohérent')
        source_limit=sources.get('max_items_per_source',sources.get('max_items',80))
        for source_id,count in Counter(item.get('source_id') for item in items).items():
            if count>source_limit:errors.append(f'actualites.json: plafond source dépassé {source_id} ({count}>{source_limit})')
        if status.get('state') not in {'ok','partial','cached'}:errors.append('actualites-status.json: état public non reconnu')
        if not featured:
            for marker in ['data-news-home-label','data-news-home-note']:
                if marker not in index_text:errors.append(f'index.html: fallback featured=0 incomplet {marker}')
            for marker in ['Actualités récentes','Aucun signal récent n’est actuellement mis en avant.','score_relevance_bluewave >= 6','recentRelevant']:
                if marker not in news_js:errors.append(f'actualites.js: fallback featured=0 incomplet {marker}')
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'données actualités invalides: {exc}')
    # Automatisation préparée, sans secret ni activation prématurée
    try:
        auto_text=(ROOT/'data/automation-config.json').read_text(encoding='utf-8')
        automation=json.loads(auto_text)
        expected_automation={'provider':'brevo','lead_endpoint':None,'chat_enabled':False,'newsletter_enabled':False,'meeting_url':None}
        if automation!=expected_automation:errors.append('automation: configuration publique non canonique ou activation prématurée')
        if SECRET.search(auto_text):errors.append('automation: secret potentiel détecté')
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'automation-config.json invalide: {exc}')
    backend_files=[
      'serverless/bluewave-leads/handler.mjs','serverless/bluewave-leads/brevo-client.mjs',
      'serverless/bluewave-leads/validation.mjs','serverless/bluewave-leads/security.mjs',
      'serverless/bluewave-leads/.env.example','serverless/bluewave-leads/README.md',
      'serverless/bluewave-leads/tests/handler.test.mjs','quality/scripts/check_secrets.py',
    ]
    for relative in backend_files:
        if not (ROOT/relative).is_file():errors.append(f'automation: fichier backend absent {relative}')
    try:
        backend='\n'.join((ROOT/relative).read_text(encoding='utf-8') for relative in backend_files if (ROOT/relative).is_file())
        for attribute in ['BW_TYPE','BW_GEO','BW_THEME','BW_ORGANISATION','BW_BESOIN','BW_DELAI','BW_SOURCE','BW_STATUT','BW_CONSENT_VEILLE']:
            if attribute not in backend:errors.append(f'automation: attribut Brevo absent {attribute}')
        for variable in ['BREVO_API_KEY','BREVO_LEADS_LIST_ID','BREVO_NEWSLETTER_LIST_ID','BREVO_ACK_TEMPLATE_ID','BREVO_INTERNAL_TEMPLATE_ID','BLUEWAVE_INTERNAL_EMAIL','ALLOWED_ORIGIN']:
            if variable not in backend:errors.append(f'automation: variable serveur absente {variable}')
        if 'updateEnabled: true' not in backend:errors.append('automation: mise à jour contact Brevo non activée')
    except OSError as exc:
        errors.append(f'automation: backend illisible {exc}')
    # Méthode publique canonique 6 étapes ; chaîne 8 étapes réservée aux documents internes
    met=(ROOT/'methode.html').read_text(encoding='utf-8').lower()
    public_steps=['qualifier','cadrer','analyser','cartographier','structurer','restituer']
    for step in public_steps:
        if step not in met:errors.append(f'methode.html: étape absente {step}')
    positions=[met.find(step) for step in public_steps]
    if -1 in positions or positions!=sorted(positions):errors.append('methode.html: ordre de la méthode publique incorrect')
    public_text='\n'.join(text for _,text in parsed.values()).lower()
    for internal_step in ['contrôler','capitaliser']:
        if internal_step in public_text:errors.append(f'méthode publique: étape interne exposée {internal_step}')
    readme=(ROOT/'README.md').read_text(encoding='utf-8')
    public_method='Qualifier → Cadrer → Analyser → Cartographier → Structurer → Restituer'
    if readme.count(public_method)!=1:errors.append('README.md: méthode publique attendue exactement une fois')
    for internal_step in ['Contrôler','Capitaliser']:
        if internal_step in readme:errors.append(f'README.md: étape interne exposée {internal_step}')
    ignored=(ROOT/'.gitignore').read_text(encoding='utf-8').splitlines()
    for internal_doc in ['CLAUDE.md','AGENTS.md']:
        if (ROOT/internal_doc).exists():errors.append(f'dépôt public: {internal_doc} présent')
        if internal_doc not in ignored:errors.append(f'.gitignore: {internal_doc} absent')
    public_clean_text=readme+'\n'+public_text+'\n'+news_js
    for internal_marker in ['CLAUDE.md','AGENTS.md','Pont inter-agent','Claude Code']:
        if internal_marker.casefold() in public_clean_text.casefold():errors.append(f'dépôt public: référence interne exposée {internal_marker}')
    if 'cette candidate' in readme:errors.append('README.md: trace candidate résiduelle')
    if 'cette version' not in readme:errors.append('README.md: formulation cette version absente')
    try:
        manifest=json.loads((ROOT/'MANIFEST_SHA256.json').read_text(encoding='utf-8'))
        for internal_doc in ['CLAUDE.md','AGENTS.md']:
            if any(entry.get('path')==internal_doc for entry in manifest):errors.append(f'MANIFEST_SHA256.json: {internal_doc} présent')
    except (OSError,ValueError,TypeError) as exc:
        errors.append(f'MANIFEST_SHA256.json invalide: {exc}')
    # Qualifier 7 fieldsets + wording
    q=(ROOT/'qualifier-un-besoin.html').read_text(encoding='utf-8')
    qualifier_js=(ROOT/'assets/js/qualifier.js').read_text(encoding='utf-8')
    if q.count('fieldset data-step=')!=7:errors.append('qualifier: nombre étapes != 7')
    if 'diagnostic automatique définitif' in q.lower():warnings.append('qualifier: mention explicite interdiction présente')
    for field in ['lead-name','lead-organisation','lead-email','lead-request-type','lead-description','lead-contact-preference','lead-newsletter','lead-consent','lead-website']:
        if f'id="{field}"' not in q:errors.append(f'qualifier: champ contact absent {field}')
    for field in ['firstname','lastname','email','organisation','type','geography','themes','need','deadline','contact_preference','source','newsletter_consent','privacy_acknowledged']:
        if re.search(rf'\b{field}\s*:',qualifier_js) is None:errors.append(f'qualifier: champ payload canonique absent {field}')
    if re.search(r'<input[^>]+(?:newsletter|marketing)[^>]+checked',q,re.I):errors.append('qualifier: consentement marketing précoché')
    offer_slugs=['diagnostic-strategique','vulnerabilite-cotiere','gouvernance-acteurs','structuration-projet','formation-capacites','note-strategique','atelier-cadrage']
    for slug in offer_slugs:
        if f'?offre={slug}' not in sol:errors.append(f'solutions.html: lien offre absent {slug}')
        if f"'{slug}'" not in qualifier_js:errors.append(f'qualifier.js: préremplissage offre absent {slug}')
    index=index_text
    for journey in ['projet','collaboration','formation']:
        if f'?parcours={journey}' not in index:errors.append(f'index.html: parcours absent {journey}')
        if f'{journey}:' not in qualifier_js:errors.append(f'qualifier.js: parcours absent {journey}')
    workflow=(ROOT/'.github/workflows/update-actualites.yml').read_text(encoding='utf-8')
    for forbidden in ['schedule:','contents: write','ref: main','git commit','git push']:
        if forbidden in workflow:errors.append(f'workflow actualités: écriture automatique interdite {forbidden}')
    for required in ['workflow_dispatch:','contents: read','actions/upload-artifact@v4']:
        if required not in workflow:errors.append(f'workflow actualités: garde-fou absent {required}')
    if 'href="domaines.html"' in ''.join(text for _,text in parsed.values()):warnings.append('navigation publique: lien Domaines résiduel')
    about=(ROOT/'a-propos.html').read_text(encoding='utf-8')
    if 'href="https://ouagabokouayao.github.io/oby-site-academique/" target="_blank" rel="noopener noreferrer"' not in about:errors.append('a-propos.html: lien OBY ou attributs incorrects')
    robots=(ROOT/'robots.txt').read_text(encoding='utf-8')
    if not re.search(r'(?mi)^Disallow:\s*/\s*$',robots):errors.append('robots.txt: Disallow / absent')
    # Corpus « Activités et productions BlueWave » : activités réellement rattachées
    # à BlueWave. Les organismes cités situent un contexte, jamais une relation.
    ACT_DATA=ROOT/'assets/data/activites-bluewave.json'
    ACT_NOTICE=('Cette sélection documente des activités, événements et productions effectivement rattachés '
        'au développement et aux travaux de BlueWave Solutions. Les organismes, événements et lieux cités '
        'situent le contexte de ces activités ; leur mention ne vaut ni partenariat, ni mandat, ni relation '
        'institutionnelle avec BlueWave Solutions.')
    ACT_DIR='assets/img/activites/'
    # Relations commerciales ou institutionnelles non établies.
    ACT_FORBIDDEN=[
        'partenaire de BlueWave','client de BlueWave','notre partenaire','notre client','mandat BlueWave',
        'partenariat BlueWave','partenariat avec','mandaté par','mandatée par','en partenariat avec',
        'référence commerciale','affilié à','affiliée à',
    ]
    # Présence physique ou intervention non établies, et tiers à ne pas impliquer.
    ACT_PRESENCE=['Brest','Shom','La Rochelle','intervention orale','présent physiquement','présente physiquement']
    # Le corpus personnel OBY n'a aucune place dans la Médiathèque BlueWave.
    OBY_FORBIDDEN=['Parcours et environnements du fondateur','site personnel OBY','oby-site-academique',
        'evidence-fondateur','oby-preuves-selectionnees','parcours du fondateur']
    if ACT_NOTICE not in media:errors.append('mediatheque.html: mention publique du corpus activités absente')
    if media.count(ACT_NOTICE)!=1:errors.append('mediatheque.html: mention publique du corpus activités attendue une seule fois')
    if 'Activités et productions BlueWave' not in media:errors.append('mediatheque.html: titre du corpus activités absent')
    for asset in ('assets/css/activites-bluewave.css','assets/js/activites-bluewave.js'):
        if asset not in media:errors.append(f'mediatheque.html: ressource du corpus activités absente {asset}')
    # Aucun résidu du corpus personnel dans la Médiathèque ni dans les fichiers qu'elle sert.
    # Portée volontairement limitée : le lien vers le site personnel du fondateur sur
    # a-propos.html est un élément canonique préexistant, vérifié plus haut, et reste légitime.
    served=[ROOT/'assets/js/activites-bluewave.js',ROOT/'assets/css/activites-bluewave.css',ACT_DATA]
    mediatheque_blob='\n'.join([media]+[f.read_text(encoding='utf-8') for f in served if f.is_file()])
    for marker in OBY_FORBIDDEN:
        if marker.casefold() in mediatheque_blob.casefold():errors.append(f'Médiathèque: résidu du corpus personnel {marker}')
    for path in (ROOT/'assets/img').rglob('*'):
        if path.is_file() and 'evidence-fondateur' in path.as_posix():errors.append(f'dépôt: média du corpus personnel présent {path.name}')
    try:
        act=json.loads(ACT_DATA.read_text(encoding='utf-8'))
        raw=ACT_DATA.read_text(encoding='utf-8')
        items=act['items']
        if not items:errors.append('corpus activités: aucun élément')
        slugs={c['slug'] for c in act['categories']}
        ids=set()
        for item in items:
            missing={'id','rang','categorie','categorie_label','titre','date','lieu','statut','description','image','largeur','hauteur','alt'}-set(item)
            if missing:errors.append(f"corpus activités: clés absentes {item.get('id')} {sorted(missing)}")
            if item.get('id') in ids:errors.append(f"corpus activités: id dupliqué {item.get('id')}")
            ids.add(item.get('id'))
            if item.get('categorie') not in slugs:errors.append(f"corpus activités: catégorie inconnue {item.get('categorie')}")
            image=item.get('image','')
            if not image.startswith(ACT_DIR):errors.append(f"corpus activités: image hors du répertoire dédié {item.get('id')}")
            if image.startswith(('http://','https://')):errors.append(f"corpus activités: hotlink image {item.get('id')}")
            if not (ROOT/image).is_file():errors.append(f"corpus activités: image absente {image}")
            if not (item.get('alt') or '').strip():errors.append(f"corpus activités: alt vide {item.get('id')}")
            if not isinstance(item.get('largeur'),int) or not isinstance(item.get('hauteur'),int):errors.append(f"corpus activités: dimensions manquantes {item.get('id')}")
        # Seules les catégories réellement représentées peuvent être proposées au filtrage.
        used={item.get('categorie') for item in items}
        js_act=(ROOT/'assets/js/activites-bluewave.js').read_text(encoding='utf-8')
        if 'utilisees.has' not in js_act:errors.append('activites-bluewave.js: filtrage des catégories non utilisées absent')
        for marker in ACT_FORBIDDEN:
            if marker.casefold() in raw.casefold():errors.append(f'corpus activités: relation non établie {marker}')
            if marker.casefold() in media.casefold():errors.append(f'mediatheque.html: relation non établie {marker}')
        for marker in ACT_PRESENCE:
            if marker.casefold() in raw.casefold():errors.append(f'corpus activités: présence ou tiers non établi {marker}')
        # L'élément REFMAR doit porter la mention d'absence physique.
        refmar=[item for item in items if item.get('id','').startswith('refmar-')]
        for item in refmar:
            if 'absence physique' not in (item.get('contexte') or ''):errors.append(f"corpus activités: mention d'absence physique manquante {item.get('id')}")
            if item.get('statut')!='poster accepté pour présentation':errors.append(f"corpus activités: statut REFMAR non canonique {item.get('id')}")
        # L'organisateur de l'atelier reste un contexte, jamais une relation.
        cci=[item for item in items if 'cci' in item.get('id','')]
        for item in cci:
            if 'organisateur' not in (item.get('contexte') or '').casefold():errors.append(f"corpus activités: organisateur non qualifié comme contexte {item.get('id')}")
        # Aucun visuel ne doit reprendre une identité institutionnelle tierce.
        for path in sorted((ROOT/ACT_DIR).glob('*.svg')):
            svg=path.read_text(encoding='utf-8')
            for marker in ['CCI ','Chambre de commerce','Shom','REFMAR 2026 —','<image']:
                if marker.casefold() in svg.casefold():errors.append(f'visuel activités: contenu tiers ou image importée {path.name} ({marker})')
            if '<title' not in svg or '<desc' not in svg:errors.append(f'visuel activités: title/desc absent {path.name}')
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'corpus activités invalide: {exc}')

    # JS syntax if node available handled outside
    report={'status':'pass' if not errors else 'fail','html_pages_checked':len(HTML),'errors':errors,'warnings':warnings}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0
if __name__=='__main__':sys.exit(main())
