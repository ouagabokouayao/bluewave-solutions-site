# BlueWave Solutions — site V3 P1.2

Site vitrine statique, multipage et responsive de BlueWave Solutions. Le front-end reste sans dépendance ; un endpoint serverless portable est préparé séparément, sans être déployé ni activé.

## Architecture publique

- `index.html` : accueil, situations, méthode, preuves et sélection « À la une » ;
- `solutions.html` : cinq offres cœur et deux formats d’entrée ;
- `methode.html` : méthode publique BlueWave en six étapes ;
- `preuves-demonstrateurs.html` : preuves de méthode et simulations explicitement illustratives ;
- `mediatheque.html` : dix visuels BlueWave avec visionneuse locale ;
- `actualites.html` : veille maritime et littorale issue de sources externes identifiées ;
- `a-propos.html` : positionnement et présentation du fondateur ;
- `qualifier-un-besoin.html` : orientation locale puis prise de contact préparée.

Les anciennes routes `services.html`, `domaines.html` et `contact.html` restent de légères pages de transition afin d’éviter les liens cassés. Les pages légales, la page 404 et les notes de démonstration complètent cette surface.

## Veille structurée

Le collecteur `quality/scripts/update_actualites.py` lit les flux RSS configurés dans `data/actualites-sources.json`, classe et dédoublonne les éléments, calcule un score transparent et conserve au maximum 80 publications sur 90 jours. `data/actualites-curation.json` permet les exceptions manuelles. Les données et l’état de collecte sont écrits dans `data/actualites.json` et `data/actualites-status.json`.

Le workflow `update-actualites.yml` est volontairement manuel et en lecture seule. Il prépare une régénération, les contrôles et un patch inspectable sans commit ni push automatique. Une panne de source reste isolée ; une panne totale conserve le dernier jeu valide.

## Méthode publique

La méthode publique compte six étapes : `Qualifier → Cadrer → Analyser → Cartographier → Structurer → Restituer`.

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
