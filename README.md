# BlueWave Solutions — site V3 P1.2

Site vitrine statique, multipage et responsive de BlueWave Solutions. Le front-end reste sans dépendance ; un endpoint serverless portable est préparé séparément, sans être déployé ni activé.

## Architecture publique

- `index.html` : accueil, situations, méthode, preuves et sélection « À la une » ;
- `solutions.html` : cinq offres cœur et deux formats d’entrée ;
- `methode.html` : méthode publique BlueWave en six étapes ;
- `preuves-demonstrateurs.html` : preuves de méthode et simulations explicitement illustratives ;
- `mediatheque.html` : dix visuels BlueWave avec visionneuse locale, puis le corpus « Parcours et environnements du fondateur » ;
- `actualites.html` : veille maritime et littorale issue de sources externes identifiées ;
- `a-propos.html` : positionnement et présentation du fondateur ;
- `qualifier-un-besoin.html` : orientation locale puis prise de contact préparée.

Les anciennes routes `services.html`, `domaines.html` et `contact.html` restent de légères pages de transition afin d’éviter les liens cassés. Les pages légales, la page 404 et les notes de démonstration complètent cette surface.

## Veille structurée

Le collecteur `quality/scripts/update_actualites.py` lit les flux RSS configurés dans `data/actualites-sources.json`, classe et dédoublonne les éléments, calcule un score transparent et conserve au maximum 80 publications sur 90 jours. `data/actualites-curation.json` permet les exceptions manuelles. Les données et l’état de collecte sont écrits dans `data/actualites.json` et `data/actualites-status.json`.

L'instruction des sources Côte d'Ivoire / Afrique de l'Ouest est consignée dans `quality/sources-candidates-afrique-ouest.md`. Aucune de ces sources n'est intégrée au collecteur : aucun flux RSS ou Atom n'a pu être ouvert et constaté, et une URL de flux supposée reste une invention. Ces institutions restent des pistes de curation manuelle. Aucun contenu n'a été créé pour équilibrer artificiellement les géographies.

Le workflow `update-actualites.yml` est volontairement manuel et en lecture seule. Il prépare une régénération, les contrôles et un patch inspectable sans commit ni push automatique. Une panne de source reste isolée ; une panne totale conserve le dernier jeu valide.

## Méthode publique

La méthode publique compte six étapes : `Qualifier → Cadrer → Analyser → Cartographier → Structurer → Restituer`.

## Corpus « Parcours et environnements du fondateur »

La Médiathèque porte deux corpus distincts et non interchangeables.

Le premier, inchangé, reste les dix visuels BlueWave (`.media-card`, filtres et visionneuse de `assets/js/mediatheque.js`).

Le second projette une sélection de onze éléments du parcours du fondateur, issue du dépôt `ouagabokouayao/oby-site-academique`. Il a son propre balisage (`.parcours-*`), sa propre feuille `assets/css/evidence-fondateur.css` et son propre script `assets/js/evidence-fondateur.js` : aucune règle ni aucun comportement du corpus BlueWave n'est redéfini.

### Doctrine de véracité

Ce corpus documente des terrains, événements, formations et environnements du parcours de OUAGA Bokoua Yao. Il ne constitue pas un portefeuille de clients, de mandats, de partenariats ou de réalisations commerciales de BlueWave Solutions. Chaque carte porte l'attribution `Parcours de OUAGA Bokoua Yao`, et la mention publique de séparation figure en tête de section.

Les institutions visibles sur les photographies sont le contexte de l'événement, jamais des partenaires BlueWave. Une présence, un stage, une formation ou un terrain n'est jamais reformulé en mission, mandat, référence ou affiliation actuelle de BlueWave.

`quality/scripts/quality_check.py` applique cette doctrine au corpus : attribution canonique sur les onze éléments, mention publique présente, formulations commerciales interdites absentes des données comme de la page, images locales uniquement, aucun hotlink.

### Chaîne de reprise

```bash
python quality/scripts/build_evidence_fondateur.py \
  --selection <chemin>/01_SELECTION_OBY_BLUEWAVE_V1.json \
  --oby-root <chemin>/oby-site-academique \
  --copy-images
```

Le script relit la source de vérité `assets/data/mediatheque-oby.json` du dépôt OBY, refuse toute entrée dont le statut n'est plus `public-valide` sans jamais la remplacer, recopie les images dans `assets/img/evidence-fondateur/` et écrit deux fichiers :

- `assets/data/oby-preuves-selectionnees.json` : données publiques servies au navigateur ;
- `quality/media-provenance-oby-bluewave.json` : chemin source, chemin destination, SHA-256 source et destination, taille et statut de la source pour chaque copie. Ce fichier de traçabilité reste interne et n'est pas publié.

## Automatisation visiteurs

`assets/js/automation.js` centralise les événements et le point d’intégration HTTPS du qualifier. `data/automation-config.json` ne contient que cinq options publiques : fournisseur, endpoint lead, chat, newsletter et rendez-vous. L’endpoint reste `null` et toutes les intégrations distantes restent désactivées dans cette version.

`serverless/bluewave-leads/` contient le handler portable, la validation serveur, la gestion CORS et anti-abus, le client Brevo minimal, un exemple d’environnement sans secret et des tests mockés. Le navigateur n’appelle jamais directement Brevo.

Pour activer ultérieurement le pipeline en sécurité, il reste à :

- choisir et configurer un hébergeur serverless ;
- renseigner dans son environnement privé la clé Brevo, les identifiants réels des listes et modèles, l’adresse interne et l’origine autorisée ;
- créer dans Brevo les neuf attributs `BW_*`, la liste Leads, la liste newsletter et les deux modèles transactionnels ;
- configurer les automatisations Leads, relance mesurée et newsletter décrites dans le README du backend ;
- activer un stockage distribué pour le rate limiting et la déduplication ;
- renseigner ensuite l’URL HTTPS validée dans `lead_endpoint` ;
- éventuellement ajouter le snippet de chat Brevo réel et une URL réelle de rendez-vous après validation distincte.

Aucune clé API, aucun identifiant réel de liste ou de modèle ne doit être placé dans le dépôt ou dans le JavaScript public. Le consentement newsletter reste indépendant de la demande commerciale et désactivé dans l’interface tant que sa configuration réelle n’est pas validée.

## Build public et publication

`dist/` est le seul périmètre servi. Il est reconstruit à la demande et n'est pas versionné :

```bash
python quality/scripts/build_dist.py      # construit dist/ depuis le graphe de références réel
python quality/scripts/check_dist.py      # aucun fichier interne, parité exacte avec les sources
python quality/scripts/dist_manifest.py   # écrit dist/MANIFEST_SHA256.json
python quality/scripts/dist_manifest.py --check
```

`build_dist.py` part des pages publiques de la racine, de `robots.txt` et de `.nojekyll`, puis suit les références sortantes réelles (HTML vers CSS, JS, images et pages ; CSS vers `url()` ; JS vers les JSON lus par le navigateur). Ce qui n'est pas atteint par ce graphe n'est pas publié : `.claude/`, `.github/`, `QA/`, `quality/`, `serverless/`, `README.md`, `.gitignore`, tout `.env*` et tout artefact de développement restent hors de `dist/`. Aucun fichier source n'est supprimé ni déplacé pour construire le build.

`dist/MANIFEST_SHA256.json` est écrit après construction complète, ne se référence jamais lui-même et porte pour chaque fichier servi le chemin, son SHA-256 et sa taille exacte.

### Merge n'est pas publication

La chaîne retenue sépare strictement les deux :

```
PR → contrôles → merge main → contrôles → ARRÊT
```

puis, seulement après une décision de publication distincte :

```
workflow_dispatch → SHA validé → checkout du SHA → build dist → contrôle dist → manifeste → upload → déploiement Pages
```

`.github/workflows/deploy-pages-manual.yml` implémente la seconde chaîne. Il se déclenche uniquement par `workflow_dispatch`, exige en entrée le SHA complet à publier, refuse tout SHA qui n'appartient pas à `main`, reconstruit `dist/` depuis ce SHA exact, le contrôle, vérifie le manifeste public et n'envoie que `dist/` à GitHub Pages. Ses permissions sont limitées à `contents: read`, `pages: write`, `id-token: write`.

### Configuration GitHub Pages restant à modifier

GitHub Pages est **encore configuré pour publier automatiquement `main`**. Tant que ce réglage n'a pas changé, tout merge sur `main` publie le dépôt tel quel, workflow manuel ou non : ajouter ce workflow ne suffit pas.

Le basculement `Settings → Pages → Source → GitHub Actions` reste à effectuer, et seulement après une décision explicite et distincte. Aucun réglage GitHub Pages n'a été modifié dans cette version.

## Qualité et intégrité

```bash
git diff --check
python quality/scripts/quality_check.py
node --check assets/js/main.js
node --check assets/js/qualifier.js
node --check assets/js/mediatheque.js
node --check assets/js/actualites.js
node --check assets/js/automation.js
node --test serverless/bluewave-leads/tests/handler.test.mjs
python quality/scripts/check_secrets.py
python quality/scripts/verify_manifest.py
```

`MANIFEST_SHA256.json` inclut les données de veille dynamiques. Le workflow de collecte le régénère dans le même commit que les données afin de conserver une doctrine d’intégrité unique.

## Préactivation

Toutes les pages conservent `noindex, nofollow` et `robots.txt` conserve `Disallow: /`. Le qualifier continue de préparer un courriel local tant que `lead_endpoint` vaut `null`. Aucun envoi distant, abonnement, assistant, traceur ou rendez-vous automatisé n’est actif avant configuration et validation explicites.
