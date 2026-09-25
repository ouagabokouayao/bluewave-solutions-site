# BlueWave Solutions — site V3 P1.2

Site vitrine statique, multipage et responsive de BlueWave Solutions. Le front-end reste sans dépendance ; un endpoint serverless portable est préparé séparément, sans être déployé ni activé.

## Architecture publique

- `index.html` : accueil, situations, méthode, preuves et sélection « À la une » ;
- `solutions.html` : cinq offres cœur et deux formats d’entrée ;
- `methode.html` : méthode publique BlueWave en six étapes ;
- `preuves-demonstrateurs.html` : preuves de méthode et simulations explicitement illustratives ;
- `mediatheque.html` : hub d’orientation vers les deux corpus de la Médiathèque ;
- `mediatheque-visualisations.html` : dix visualisations BlueWave, filtres et visionneuse locale ;
- `mediatheque-activites.html` : cinq activités et productions BlueWave documentées ;
- `actualites.html` : veille maritime et littorale issue de sources externes identifiées ;
- `a-propos.html` : positionnement et bloc fondateur, portrait photographique compris ;
- `qualifier-un-besoin.html` : orientation locale puis prise de contact préparée.

Les anciennes routes `services.html`, `domaines.html` et `contact.html` restent de légères pages de transition afin d’éviter les liens cassés. Les pages légales, la page 404 et les notes de démonstration complètent cette surface.

## Veille structurée

Le collecteur `quality/scripts/update_actualites.py` lit les flux RSS configurés dans `data/actualites-sources.json`, classe et dédoublonne les éléments, calcule un score transparent et conserve au maximum 80 publications sur 90 jours. `data/actualites-curation.json` permet les exceptions manuelles. Les données et l’état de collecte sont écrits dans `data/actualites.json` et `data/actualites-status.json`.

L'instruction des sources Côte d'Ivoire / Afrique de l'Ouest est consignée dans `quality/sources-candidates-afrique-ouest.md`. Aucune de ces sources n'est intégrée au collecteur : aucun flux RSS ou Atom n'a pu être ouvert et constaté, et une URL de flux supposée reste une invention. Ces institutions restent des pistes de curation manuelle. Aucun contenu n'a été créé pour équilibrer artificiellement les géographies.

Le workflow `update-actualites.yml` est volontairement manuel et en lecture seule. Il prépare une régénération, les contrôles et un patch inspectable sans commit ni push automatique. Une panne de source reste isolée ; une panne totale conserve le dernier jeu valide.

## Méthode publique

La méthode publique compte six étapes : `Qualifier → Cadrer → Analyser → Cartographier → Structurer → Restituer`.

## Médiathèque — un hub et deux corpus

La Médiathèque est répartie sur trois pages : `mediatheque.html` oriente sans rien héberger, `mediatheque-visualisations.html` porte les dix visualisations (`.media-card`, filtres et visionneuse de `assets/js/mediatheque.js`), `mediatheque-activites.html` porte le corpus des activités. Les deux sous-pages se renvoient l'une à l'autre et vers le hub.

`quality_check.py` vérifie cette séparation : le hub ne contient ni grille de visualisations ni corpus d'activités, la mention publique du corpus activités ne figure que sur sa propre page, chaque page porte sa canonique et son `og:url`, et les liens réciproques existent.

Le corpus des activités documente les activités, événements et productions effectivement rattachés au développement et aux travaux de BlueWave Solutions. Il a son propre balisage (`.activites-*`), sa feuille `assets/css/activites-bluewave.css` et son script `assets/js/activites-bluewave.js` : aucune règle ni aucun comportement du premier corpus n'est redéfini.

Les données publiques sont dans `assets/data/activites-bluewave.json`, les visuels dans `assets/img/activites/`. Le corpus compte cinq éléments : quatre événements et une production scientifique. Le schéma prévoit les catégories événement, production scientifique, atelier, rencontre, formation, terrain / visite et recherche appliquée ; seules celles réellement représentées sont proposées au filtrage.

### Doctrine

Un élément n'entre dans ce corpus que s'il est réellement rattaché à BlueWave Solutions. Les organismes, événements et lieux cités situent le contexte d'une activité : leur mention ne vaut ni partenariat, ni mandat, ni relation institutionnelle. Ce corpus ne documente pas le parcours personnel du fondateur.

Une inscription ou un événement à venir n'est jamais présenté comme une activité réalisée ; le champ `statut` porte la qualification exacte. Une présence physique non établie n'est jamais affirmée.

Les visuels sont des productions éditoriales BlueWave originales : aucun logo, aucune image institutionnelle tierce, aucune donnée chiffrée inventée.

`quality/scripts/quality_check.py` applique cette doctrine : mention publique présente une seule fois, formulations de relation non établie absentes des données comme de la page, images locales uniquement, aucun hotlink, qualification du statut REFMAR et de l'organisateur de l'atelier, visuels sans identité tierce ni image importée, et aucun résidu de corpus personnel dans la Médiathèque.

### Médias et provenance

**Le build public ne sert que des productions éditoriales BlueWave originales.** `assets/img/activites/` ne contient que des SVG produits pour le site : aucun logo institutionnel tiers, aucune photographie, aucun portrait, aucune donnée chiffrée inventée.

Une photographie n'est servie publiquement qu'une fois les droits de republication et le droit à l'image explicitement documentés pour une publication au nom de BlueWave Solutions. Tant que ce n'est pas le cas, elle reste hors du build public.

Les photographies rassemblées comme preuves de rattachement sont conservées dans `quality/media-evidence/`, zone interne exclue de `dist` par construction. Elles proviennent du dépôt `ouagabokouayao/oby-site-academique`, qui sert de dépôt-source de preuves et de médias — jamais de partenaire de BlueWave Solutions — copiées sans transformation depuis une entrée au statut `public-valide`.

`quality/media-provenance-activites-bluewave.json` trace les deux natures : pour chaque preuve interne, l'activité, le dépôt, le commit et le chemin source, le mode de déclaration, le statut, les SHA-256 des deux côtés, l'identité octet, la preuve de rattachement et le motif de non-publication ; pour chaque visuel public, son origine éditoriale, son empreinte et le motif de son emploi. Ce fichier reste interne et n'entre pas dans `dist`.

`quality_check.py` vérifie qu'aucun média non éditorial ne figure dans le répertoire public ni dans le corpus, qu'aucun média orphelin ne traîne, que chaque visuel public est déclaré et intact, et que chaque preuve interne reste hors zone servie, intacte, tracée et motivée.

### Portrait du fondateur

`a-propos.html` sert une photographie réelle de Bokoua Yao OUAGA, `assets/img/fondateur/bokoua-yao-ouaga.webp`. La source est le portrait officiel publié par `ouagabokouayao/oby-site-academique` ; le rattachement au fondateur est établi par l'usage documenté dans ce dépôt, jamais par l'image seule.

L'image est **recadrée sans retouche** : le cadre original porte le monogramme du site personnel du fondateur, qu'il n'y a pas lieu de servir sur une page BlueWave. `quality/media-provenance-activites-bluewave.json` consigne la boîte de recadrage, le motif, les SHA-256 source et destination et le fait que la copie n'est pas identique.

`quality_check.py` exige que ce portrait soit déclaré, intact, effectivement servi sur `a-propos.html` avec l'`alt` déclaré, seul dans son répertoire, et qu'un recadrage déclaré soit motivé. Il refuse aussi toute identité visuelle du dépôt-source dans `assets/img/`.

### Arbitrage des photographies d'activités

Le choix entre photographie réelle et visuel éditorial est fait image par image, pas par principe. Vingt cadrages du dépôt-source ont été examinés pour les trois activités concernées ; les trois arbitrages et leurs motifs figurent dans `rearbitrage_photographies_v3_2` du fichier de provenance. Une photographie l'emporte dès lors qu'elle documente l'activité, qu'elle est de qualité suffisante, que sa provenance est tracée et que sa diffusion publique au nom de BlueWave est sûre.

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

### Configuration GitHub Pages — bascule effectuée

La source GitHub Pages a été basculée vers **GitHub Actions** le **23 septembre 2026**, avec contrôle dans l'interface GitHub et confirmation empirique lors du merge de la PR #6 : aucun builder legacy ni nouveau déploiement Pages ne s'est déclenché.

La publication reste une action séparée, effectuée seulement après GO explicite et sur un SHA validé via le workflow manuel prévu à cet effet.

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

## Mentions légales et données personnelles

`mentions-legales.html` identifie l'éditeur, le directeur de la publication et l'hébergement technique, et énonce ce qui n'est pas encore acquis : aucun SIREN, SIRET, RCS, Kbis, numéro de TVA, capital libéré, immatriculation ni agrément n'est affiché tant que les justificatifs correspondants n'existent pas. La page porte également la doctrine de propriété intellectuelle : les organismes et événements cités le sont à titre contextuel, sans revendication sur des marques ou contenus tiers.

`politique-confidentialite.html` décrit l'état technique réel : aucune transmission automatisée, aucun traceur BlueWave, aucun assistant, le message étant préparé localement puis envoyé par l'utilisateur depuis sa propre messagerie. Elle nomme le responsable du traitement, les finalités, les bases juridiques, les données, les destinataires, les durées de conservation, les droits et la voie de réclamation. Elle distingue explicitement ce que BlueWave met en œuvre du traitement technique relevant de l'hébergeur.

## Préactivation

Toutes les pages conservent `noindex, nofollow` et `robots.txt` conserve `Disallow: /`. Le qualifier continue de préparer un courriel local tant que `lead_endpoint` vaut `null`. Aucun envoi distant, abonnement, assistant, traceur ou rendez-vous automatisé n’est actif avant configuration et validation explicites.
