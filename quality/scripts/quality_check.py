#!/usr/bin/env python3
from __future__ import annotations
import re, sys, json
from datetime import datetime
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
    sol=(ROOT/'solutions.html').read_text(encoding='utf-8')
    for name in [
      'Diagnostic stratégique d’amont — maritime, littoral ou portuaire',
      'Pré-diagnostic stratégique de vulnérabilité côtière et options d’adaptation',
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
    for required in [
      '<title>Actualités &amp; veille maritime | BlueWave Solutions</title>',
      'Veille maritime & littorale',
      'Les signaux à suivre pour comprendre les transformations de la mer et du littoral.',
    ]:
        if required not in news_page:errors.append(f'actualites.html: contenu canonique absent {required}')
    if 'Lire à la source' not in (ROOT/'assets/js/actualites.js').read_text(encoding='utf-8'):errors.append('actualites.js: libellé source absent')
    if 'Ce qui bouge sur la mer, le littoral et la gouvernance maritime.' not in (ROOT/'index.html').read_text(encoding='utf-8'):errors.append('index.html: titre À la une canonique absent')
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
            datetime.fromisoformat(item['published_at'].replace('Z','+00:00'))
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
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'données actualités invalides: {exc}')
    # Automatisation préparée, sans secret ni activation prématurée
    try:
        auto_text=(ROOT/'data/automation-config.json').read_text(encoding='utf-8')
        automation=json.loads(auto_text)
        if automation.get('provider')!='brevo':errors.append('automation: provider Brevo absent')
        for section in ('lead_capture','newsletter','meeting','chat','analytics'):
            if automation.get(section,{}).get('enabled') is not False:errors.append(f'automation: {section} doit rester désactivé')
        if automation['lead_capture'].get('endpoint') is not None or automation['newsletter'].get('endpoint') is not None:errors.append('automation: endpoint public non nul')
        if SECRET.search(auto_text):errors.append('automation: secret potentiel détecté')
    except (OSError,ValueError,KeyError,TypeError) as exc:
        errors.append(f'automation-config.json invalide: {exc}')
    # Méthode canonique 8 étapes
    met=(ROOT/'methode.html').read_text(encoding='utf-8').lower()
    for step in ['qualifier','cadrer','analyser','cartographier','structurer','contrôler','restituer','capitaliser']:
        if step not in met:errors.append(f'methode.html: étape absente {step}')
    # Qualifier 7 fieldsets + wording
    q=(ROOT/'qualifier-un-besoin.html').read_text(encoding='utf-8')
    if q.count('fieldset data-step=')!=7:errors.append('qualifier: nombre étapes != 7')
    if 'diagnostic automatique définitif' in q.lower():warnings.append('qualifier: mention explicite interdiction présente')
    for field in ['lead-name','lead-organisation','lead-email','lead-request-type','lead-description','lead-contact-preference','lead-consent']:
        if f'id="{field}"' not in q:errors.append(f'qualifier: champ contact absent {field}')
    if re.search(r'<input[^>]+(?:newsletter|marketing)[^>]+checked',q,re.I):errors.append('qualifier: consentement marketing précoché')
    if 'href="domaines.html"' in ''.join(text for _,text in parsed.values()):warnings.append('navigation publique: lien Domaines résiduel')
    about=(ROOT/'a-propos.html').read_text(encoding='utf-8')
    if 'href="https://ouagabokouayao.github.io/oby-site-academique/" target="_blank" rel="noopener noreferrer"' not in about:errors.append('a-propos.html: lien OBY ou attributs incorrects')
    robots=(ROOT/'robots.txt').read_text(encoding='utf-8')
    if not re.search(r'(?mi)^Disallow:\s*/\s*$',robots):errors.append('robots.txt: Disallow / absent')
    # JS syntax if node available handled outside
    report={'status':'pass' if not errors else 'fail','html_pages_checked':len(HTML),'errors':errors,'warnings':warnings}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0
if __name__=='__main__':sys.exit(main())
