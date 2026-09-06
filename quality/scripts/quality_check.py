#!/usr/bin/env python3
from __future__ import annotations
import re, sys, json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
ROOT=Path(__file__).resolve().parents[2]
HTML=sorted(ROOT.glob('*.html'))
HELD={'assets/img/site/hero-lagoon.jpg','assets/img/site/about-mangrove-optimized.jpg','assets/img/site/about-mangrove.jpg','assets/img/site/domaines-research-vessel.jpg','assets/img/site/domaines-research-vessel.png'}
PRICE=re.compile(r'\b\d[\d\s.,]*(?:€|EUR|FCFA|XOF)\b',re.I)
FORBIDDEN=[re.compile(r'7\s+offres\s+c[oœ]ur',re.I),re.compile(r'implantation\s+(?:locale\s+)?(?:en\s+)?c[oô]te d[’\']ivoire',re.I)]
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
        for t,i in p.fields:
            if i and i not in p.labels:errors.append(f'{f.name}: champ {i} sans label')
        for raw in p.links+p.src:
            target=local_target(f,raw)
            if target is not None and not target.exists():errors.append(f'{f.name}: lien/ressource locale absente {raw}')
    # Canon commercial
    sol=(ROOT/'solutions.html').read_text(encoding='utf-8')
    for name in [
      'Diagnostic stratégique d’amont — maritime, littoral ou portuaire',
      'Pré-diagnostic stratégique de vulnérabilité côtière et options d’adaptation',
      'Gouvernance, acteurs, usages et acceptabilité',
      'Structuration de projets maritimes, littoraux ou d’économie bleue',
      'Formation et renforcement des capacités','Note stratégique BlueWave','Atelier de cadrage BlueWave']:
        if name not in sol:errors.append(f'solutions.html: canon absent {name}')
    # Méthode canonique 8 étapes
    met=(ROOT/'methode.html').read_text(encoding='utf-8').lower()
    for step in ['qualifier','cadrer','analyser','cartographier','structurer','contrôler','restituer','capitaliser']:
        if step not in met:errors.append(f'methode.html: étape absente {step}')
    # Qualifier 7 fieldsets + wording
    q=(ROOT/'qualifier-un-besoin.html').read_text(encoding='utf-8')
    if q.count('fieldset data-step=')!=7:errors.append('qualifier: nombre étapes != 7')
    if 'diagnostic automatique définitif' in q.lower():warnings.append('qualifier: mention explicite interdiction présente')
    robots=(ROOT/'robots.txt').read_text(encoding='utf-8')
    if not re.search(r'(?mi)^Disallow:\s*/\s*$',robots):errors.append('robots.txt: Disallow / absent')
    # JS syntax if node available handled outside
    report={'status':'pass' if not errors else 'fail','html_pages_checked':len(HTML),'errors':errors,'warnings':warnings}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0
if __name__=='__main__':sys.exit(main())
