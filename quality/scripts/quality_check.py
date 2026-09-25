#!/usr/bin/env python3
from __future__ import annotations
import re, sys, json, hashlib
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
    # Médiathèque : un hub et deux corpus distincts.
    # mediatheque.html oriente ; mediatheque-visualisations.html porte les dix visuels
    # et la visionneuse ; mediatheque-activites.html porte le corpus des activités.
    HUB_PAGE='mediatheque.html'
    VIS_PAGE='mediatheque-visualisations.html'
    ACT_PAGE='mediatheque-activites.html'
    hub=(ROOT/HUB_PAGE).read_text(encoding='utf-8')
    media=(ROOT/VIS_PAGE).read_text(encoding='utf-8')
    act_page=(ROOT/ACT_PAGE).read_text(encoding='utf-8')
    for page,text_ in ((HUB_PAGE,hub),(VIS_PAGE,media),(ACT_PAGE,act_page)):
        canonical=f'https://ouagabokouayao.github.io/bluewave-solutions-site/{page}'
        if f'<link rel="canonical" href="{canonical}">' not in text_:errors.append(f'{page}: canonical incorrecte')
        if f'<meta property="og:url" content="{canonical}">' not in text_:errors.append(f'{page}: og:url incorrecte')
    # Le hub oriente vers les deux corpus et n'en héberge aucun.
    for target in (VIS_PAGE,ACT_PAGE):
        if f'href="{target}"' not in hub:errors.append(f'{HUB_PAGE}: lien vers {target} absent')
    if 'class="media-card"' in hub:errors.append(f'{HUB_PAGE}: corpus visualisations hébergé sur le hub')
    if 'data-activites-grid' in hub:errors.append(f'{HUB_PAGE}: corpus activités hébergé sur le hub')
    # Liens réciproques entre les deux sous-pages.
    if f'href="{ACT_PAGE}"' not in media:errors.append(f'{VIS_PAGE}: lien réciproque absent')
    if f'href="{VIS_PAGE}"' not in act_page:errors.append(f'{ACT_PAGE}: lien réciproque absent')
    for page,text_ in ((VIS_PAGE,media),(ACT_PAGE,act_page)):
        if f'href="{HUB_PAGE}"' not in text_:errors.append(f'{page}: retour Médiathèque absent')
    # Corpus des visualisations : dix visuels et visionneuse, sur la sous-page dédiée.
    if media.count('class="media-card"')!=len(MEDIA_ASSETS):errors.append(f'{VIS_PAGE}: corpus incomplet')
    for asset in MEDIA_ASSETS:
        if asset not in media:errors.append(f'{VIS_PAGE}: visuel absent {asset}')
    if '<dialog ' not in media or 'id="media-dialog"' not in media:errors.append(f'{VIS_PAGE}: visionneuse dialog absente')
    if 'assets/js/mediatheque.js' not in media:errors.append(f'{VIS_PAGE}: script de la visionneuse absent')
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
    if ACT_NOTICE not in act_page:errors.append(f'{ACT_PAGE}: mention publique du corpus activités absente')
    if act_page.count(ACT_NOTICE)!=1:errors.append(f'{ACT_PAGE}: mention publique du corpus activités attendue une seule fois')
    if 'Activités et productions BlueWave' not in act_page:errors.append(f'{ACT_PAGE}: titre du corpus activités absent')
    for asset in ('assets/css/activites-bluewave.css','assets/js/activites-bluewave.js'):
        if asset not in act_page:errors.append(f'{ACT_PAGE}: ressource du corpus activités absente {asset}')
    # La mention publique n'a de sens que là où le corpus est servi.
    for page,text_ in ((HUB_PAGE,hub),(VIS_PAGE,media)):
        if ACT_NOTICE in text_:errors.append(f'{page}: mention du corpus activités hors de sa page')
    # Aucun résidu du corpus personnel dans la Médiathèque ni dans les fichiers qu'elle sert.
    # Portée volontairement limitée : le lien vers le site personnel du fondateur sur
    # a-propos.html est un élément canonique préexistant, vérifié plus haut, et reste légitime.
    served=[ROOT/'assets/js/activites-bluewave.js',ROOT/'assets/css/activites-bluewave.css',ACT_DATA]
    mediatheque_blob='\n'.join([hub,media,act_page]+[f.read_text(encoding='utf-8') for f in served if f.is_file()])
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
            for page,text_ in ((HUB_PAGE,hub),(VIS_PAGE,media),(ACT_PAGE,act_page)):
                if marker.casefold() in text_.casefold():errors.append(f'{page}: relation non établie {marker}')
        for marker in ACT_PRESENCE:
            if marker.casefold() in raw.casefold():errors.append(f'corpus activités: présence ou tiers non établi {marker}')
            if marker.casefold() in act_page.casefold():errors.append(f'{ACT_PAGE}: présence ou tiers non établi {marker}')
        # L'élément REFMAR doit porter la mention d'absence physique.
        refmar=[item for item in items if item.get('id','').startswith('refmar-')]
        for item in refmar:
            if 'absence physique' not in (item.get('contexte') or ''):errors.append(f"corpus activités: mention d'absence physique manquante {item.get('id')}")
            if item.get('statut')!='poster accepté pour présentation':errors.append(f"corpus activités: statut REFMAR non canonique {item.get('id')}")
        # L'organisateur de l'atelier reste un contexte, jamais une relation.
        cci=[item for item in items if 'cci' in item.get('id','')]
        for item in cci:
            if 'organisateur' not in (item.get('contexte') or '').casefold():errors.append(f"corpus activités: organisateur non qualifié comme contexte {item.get('id')}")
        # Les photographies locales validées sont autorisées ; les visuels éditoriaux
        # BlueWave (SVG) ne doivent reprendre aucune identité institutionnelle tierce.
        for path in sorted((ROOT/ACT_DIR).glob('*')):
            if path.suffix.lower() not in {'.svg','.webp','.jpg','.jpeg','.png'}:errors.append(f'visuel activités: extension non autorisée {path.name}')
        for path in sorted((ROOT/ACT_DIR).glob('*.svg')):
            svg=path.read_text(encoding='utf-8')
            for marker in ['CCI ','Chambre de commerce','Shom','REFMAR 2026 —','<image']:
                if marker.casefold() in svg.casefold():errors.append(f'visuel activités: contenu tiers ou image importée {path.name} ({marker})')
            if '<title' not in svg or '<desc' not in svg:errors.append(f'visuel activités: title/desc absent {path.name}')
        # Doctrine médias : le build public ne sert que des productions éditoriales BlueWave.
        # Une photographie n'est publiable qu'une fois les droits de republication et le droit
        # à l'image documentés ; sinon elle reste hors du build, comme preuve interne.
        prov=json.loads((ROOT/'quality/media-provenance-activites-bluewave.json').read_text(encoding='utf-8'))
        editoriaux={m['media']:m for m in prov.get('medias_publics_editoriaux',[])}
        preuves=prov.get('preuves_internes_non_servies',[])
        for item in items:
            image=item.get('image','')
            if not image.lower().endswith('.svg'):
                errors.append(f'corpus activités: média public non éditorial {image}')
                continue
            declaree=editoriaux.get(image)
            if declaree is None:
                errors.append(f'provenance activités: visuel éditorial non déclaré {image}')
                continue
            content=(ROOT/image).read_bytes()
            if declaree.get('sha256')!=hashlib.sha256(content).hexdigest():errors.append(f'provenance activités: SHA-256 incorrect {image}')
            if declaree.get('bytes')!=len(content):errors.append(f'provenance activités: taille incorrecte {image}')
            if not (declaree.get('motif') or '').strip():errors.append(f'provenance activités: motif du visuel éditorial absent {image}')
        # Aucune photographie ne doit se trouver dans le répertoire public servi.
        declarees={item.get('image') for item in items}
        for path in sorted((ROOT/ACT_DIR).glob('*')):
            relative=path.relative_to(ROOT).as_posix()
            if not path.is_file():continue
            if path.suffix.lower()!='.svg':errors.append(f'visuel activités: média non éditorial dans le répertoire public {path.name}')
            if relative not in declarees:errors.append(f'visuel activités: média orphelin {path.name}')
        # Les preuves internes restent tracées, intactes et hors du build public.
        for entry in preuves:
            chemin=entry.get('destination_path','')
            if not chemin.startswith('quality/'):errors.append(f'provenance activités: preuve interne hors zone interne {chemin}')
            if entry.get('servi_dans_dist'):errors.append(f'provenance activités: preuve interne marquée comme servie {chemin}')
            if entry.get('statut_oby')!='public-valide':errors.append(f'provenance activités: source non publiable {chemin}')
            if not entry.get('identique'):errors.append(f'provenance activités: copie non conforme {chemin}')
            if not (entry.get('motif_non_publication') or '').strip():errors.append(f'provenance activités: motif de non-publication absent {chemin}')
            if not (entry.get('preuve_rattachement_bluewave') or '').strip():errors.append(f'provenance activités: preuve de rattachement absente {chemin}')
            cible=ROOT/chemin
            if not cible.is_file():errors.append(f'provenance activités: preuve interne absente {chemin}')
            else:
                octets=cible.read_bytes()
                if entry.get('sha256_destination')!=hashlib.sha256(octets).hexdigest():errors.append(f'provenance activités: SHA-256 preuve interne incorrect {chemin}')
                if entry.get('bytes')!=len(octets):errors.append(f'provenance activités: taille preuve interne incorrecte {chemin}')
        if 'partenaire' in json.dumps(prov,ensure_ascii=False).casefold().replace('jamais un partenaire',''):errors.append('provenance activités: OBY présenté comme partenaire')
        # Portrait du fondateur : photographie réelle, tracée, et servie sur la page À propos.
        portrait=prov.get('portrait_fondateur')
        if not portrait:
            errors.append('provenance: portrait du fondateur non déclaré')
        else:
            chemin=portrait.get('media','')
            if not chemin.startswith('assets/img/fondateur/'):errors.append(f'portrait fondateur: hors du répertoire dédié {chemin}')
            cible=ROOT/chemin
            if not cible.is_file():
                errors.append(f'portrait fondateur: média absent {chemin}')
            else:
                octets=cible.read_bytes()
                if portrait.get('sha256')!=hashlib.sha256(octets).hexdigest():errors.append(f'portrait fondateur: SHA-256 incorrect {chemin}')
                if portrait.get('bytes')!=len(octets):errors.append(f'portrait fondateur: taille incorrecte {chemin}')
            for champ in ('source_repository','source_commit','source_path','sha256_source','rattachement'):
                if not (portrait.get(champ) or '').strip():errors.append(f'portrait fondateur: provenance incomplète ({champ})')
            # Une image recadrée doit dire qu'elle l'est, et pourquoi.
            if portrait.get('identique') is False:
                for champ in ('transformation','motif_transformation'):
                    if not (portrait.get(champ) or '').strip():errors.append(f'portrait fondateur: transformation non documentée ({champ})')
            elif portrait.get('sha256')!=portrait.get('sha256_source'):
                errors.append('portrait fondateur: copie déclarée identique mais SHA-256 différent')
            if chemin not in about:errors.append('a-propos.html: portrait du fondateur non servi')
            alt=portrait.get('alt') or ''
            if alt and f'alt="{alt}"' not in about:errors.append('a-propos.html: alt du portrait non conforme à la provenance')
            # Le répertoire du portrait ne contient que ce média déclaré.
            for chem in sorted((ROOT/'assets/img/fondateur').glob('*')):
                if chem.is_file() and chem.relative_to(ROOT).as_posix()!=chemin:
                    errors.append(f'portrait fondateur: média orphelin {chem.name}')
            # Aucune identité visuelle du dépôt-source ne doit transiter dans le build public.
            for marque in ('oby-logo','oby-monogramme','oby_portrait','oby-favicon','oby-og-image'):
                for chem in (ROOT/'assets/img').rglob('*'):
                    if chem.is_file() and marque in chem.name.casefold():errors.append(f'dépôt: identité du dépôt-source présente {chem.name}')
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'corpus activités invalide: {exc}')

    # ---- V3.3 : écosystème, recherche appliquée, événements ----
    home=(ROOT/'index.html').read_text(encoding='utf-8')
    methode=(ROOT/'methode.html').read_text(encoding='utf-8')
    qualifier=(ROOT/'qualifier-un-besoin.html').read_text(encoding='utf-8')
    qualifier_js=(ROOT/'assets/js/qualifier.js').read_text(encoding='utf-8')
    pages_publiques={f.name:text for f,(_,text) in zip(HTML,(parsed[f.resolve()] for f in HTML))}

    # L'architecture commerciale ne bouge pas : 5 offres cœur, 2 formats, 3 parcours.
    if sol.count('class="solution-card"')!=5:errors.append('solutions.html: le canon des 5 offres cœur a changé')
    if sol.count('class="format-card"')!=2:errors.append('solutions.html: le canon des 2 formats d’entrée a changé')
    if home.count('class="path-card"')!=3:errors.append('index.html: les 3 parcours principaux ont changé')

    # Recherche appliquée : visible, transversale, et surtout pas une 6e offre.
    if 'id="recherche-appliquee-title"' not in methode:errors.append('methode.html: bloc Recherche appliquée absent')
    RECHERCHE_DEF=('La recherche appliquée BlueWave transforme une question maritime ou littorale concrète en '
        'connaissance exploitable pour une décision, une politique, un projet ou une pratique professionnelle.')
    if RECHERCHE_DEF not in methode:errors.append('methode.html: définition canonique de la recherche appliquée absente')
    if 'traverse les offres existantes' not in methode:errors.append('methode.html: caractère transversal de la recherche appliquée non énoncé')
    # Contrôle porté sur les cartes d'offre elles-mêmes : la signature de pied de page
    # « Bureau d'études · conseil · recherche appliquée » est légitime sur toutes les pages.
    for bloc_offre in re.findall(r'<article class="(?:solution-card|format-card)".*?</article>',sol,re.S):
        if re.search(r'(?i)recherche appliqu\w*',bloc_offre):
            errors.append('solutions.html: la recherche appliquée ne doit pas constituer une offre')

    # Complémentarité avocats : citer la profession sans s’en attribuer les actes réservés.
    BORNE=('La représentation, le contentieux et l’avis juridique opposable relèvent des professions '
        'réglementées, avec lesquelles BlueWave travaille en complémentarité.')
    if BORNE not in methode or BORNE not in sol:
        errors.append('borne des professions réglementées absente de methode.html ou solutions.html')
    AVOCAT_INTERDIT=['cabinet d’avocats BlueWave','BlueWave, cabinet d’avocats','avocat BlueWave','notre cabinet',
        'représentation en justice','représenter en justice','plaider','postulation','consultation juridique réservée']
    for page,text_ in pages_publiques.items():
        for marker in AVOCAT_INTERDIT:
            if marker.casefold() in text_.casefold():errors.append(f'{page}: activité réservée attribuée à BlueWave ({marker})')
        # « avis juridique opposable » n’est admis que dans la phrase qui l’exclut.
        for m in re.finditer(r'avis juridique opposable',text_,re.I):
            if 'professions réglementées' not in text_[m.end():m.end()+140]:
                errors.append(f'{page}: « avis juridique opposable » hors de la borne réglementée')

    # Entrée publique événements : visible, sans quatrième parcours ni formulaire concurrent.
    if 'Inviter ou rencontrer BlueWave' not in home:errors.append('index.html: entrée « Inviter ou rencontrer BlueWave » absente')
    if 'qualifier-un-besoin.html?parcours=evenement' not in home:errors.append('index.html: CTA événement absent ou mal ciblé')
    if "evenement: {" not in qualifier_js:errors.append('qualifier.js: parcours evenement absent')
    if 'value="evenement-intervention"' not in qualifier:errors.append('qualifier-un-besoin.html: type de demande événement absent')
    if home.count('<form')!=0:errors.append('index.html: formulaire concurrent sur l’accueil')

    # Collaboration élargie à l’écosystème réel.
    # L'accueil énonce l'ouverture de façon ramassée ; le détail vit dans le Qualifier.
    for structure in ['bureaux d’études','cabinets d’avocats et de conseil','ingénieristes',
                      'acteurs publics','scientifiques','associatifs','consortiums']:
        if structure not in home:errors.append(f'index.html: structure absente du parcours Collaboration ({structure})')
    for option in ['value="bureau"','value="conseil"','value="avocat"','value="institution"',
                   'value="consortium"','value="ong"','value="recherche"','value="collectivite"','value="port"']:
        if option not in qualifier:errors.append(f'qualifier-un-besoin.html: catégorie détaillée absente ({option})')
    if "organisation:'bureau'" in qualifier_js:errors.append('qualifier.js: le parcours Collaboration force encore un type de structure')

    # Visuels : plus aucune formulation défensive résiduelle.
    SVG_RETIRES=['Aucune implantation locale','aucun diagnostic réel ni résultat client','aucun mandat ni résultat réel',
        'travaillées depuis Marseille']
    # Légendes canoniques attendues dans les visuels corrigés.
    SVG_CANON={
        'visualisation-deux-marches.svg':'Méditerranée et golfe de Guinée : deux géographies prioritaires.',
        'apercu-diagnostic.svg':'Démonstrateur de structure de diagnostic.',
        'apercu-note-strategique.svg':'Démonstrateur de structure de note stratégique.',
    }
    for nom,legende in SVG_CANON.items():
        chemin=next((x for x in (ROOT/'assets/img').rglob(nom)),None)
        if chemin is None:errors.append(f'visuel absent {nom}')
        elif legende not in chemin.read_text(encoding='utf-8'):errors.append(f'visuel: légende canonique absente {nom}')
    for path in sorted((ROOT/'assets/img').rglob('*.svg')):
        svg=path.read_text(encoding='utf-8')
        for marker in SVG_RETIRES:
            if marker.casefold() in svg.casefold():errors.append(f'visuel: formulation défensive résiduelle {path.name} ({marker})')

    # Radar interne : strictement hors du site public.
    for page,text_ in pages_publiques.items():
        for marker in ['quality/radar','opportunites.json','radar interne']:
            if marker.casefold() in text_.casefold():errors.append(f'{page}: référence au radar interne ({marker})')
        # Identifiants d'opportunité au canon du CRM maître : jamais publics.
        if re.search(r'\bOPP-\d{3,}\b',text_):errors.append(f'{page}: identifiant d’opportunité exposé')
    # Formulations juridiques publiques : pas de prestation juridique générique.
    JURIDIQUE_INTERDIT=['note juridique','consultation juridique','conseil juridique à',
        'avis juridique BlueWave','expertise juridique opposable','non opposable']
    for page,text_ in pages_publiques.items():
        for marker in JURIDIQUE_INTERDIT:
            if marker.casefold() in text_.casefold():errors.append(f'{page}: formulation juridique à retirer ({marker})')
    for requis in ['analyse documentaire des cadres juridiques et institutionnels',
                   'note d’analyse des cadres juridiques et institutionnels']:
        if requis not in methode:errors.append(f'methode.html: formulation retenue absente ({requis})')
    if 'lecture des cadres juridiques et institutionnels applicables' not in sol:
        errors.append('solutions.html: lecture des cadres juridiques et institutionnels absente')
    # Champs de connaissance conservés.
    if 'droit de la mer' not in ''.join(pages_publiques.values()).casefold():
        errors.append('site: le droit de la mer a disparu des champs de connaissance')

    radar=ROOT/'quality/radar'
    if not radar.is_dir():
        errors.append('radar interne absent')
    else:
        try:
            alertes=json.loads((radar/'alertes-config.json').read_text(encoding='utf-8'))
            if alertes.get('active') is not False:errors.append('radar: alertes activées')
            if any(c.get('active') for c in (alertes.get('canaux') or {}).values()):errors.append('radar: canal d’alerte activé')
            registre=json.loads((radar/'opportunites.json').read_text(encoding='utf-8'))
            if not isinstance(registre.get('items'),list):errors.append('radar: registre d’opportunités invalide')
        except (OSError,ValueError) as exc:
            errors.append(f'radar: configuration illisible ({exc})')

    # JS syntax if node available handled outside
    report={'status':'pass' if not errors else 'fail','html_pages_checked':len(HTML),'errors':errors,'warnings':warnings}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0
if __name__=='__main__':sys.exit(main())
