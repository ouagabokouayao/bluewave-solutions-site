# BlueWave Solutions — site V3 P1.2

Site vitrine statique, multipage et responsive de BlueWave Solutions. Il reste sans backend et sans dépendance front-end.

## Architecture publique

- `index.html` : accueil, situations, méthode, preuves et sélection « À la une » ;
- `solutions.html` : cinq offres cœur et deux formats d’entrée ;
- `methode.html` : méthode BlueWave en huit étapes ;
- `preuves-demonstrateurs.html` : preuves de méthode et simulations explicitement illustratives ;
- `mediatheque.html` : dix visuels BlueWave avec visionneuse locale ;
- `actualites.html` : veille maritime et littorale issue de sources externes identifiées ;
- `a-propos.html` : positionnement et présentation du fondateur ;
- `qualifier-un-besoin.html` : orientation locale puis prise de contact préparée.

Les anciennes routes `services.html`, `domaines.html` et `contact.html` restent de légères pages de transition afin d’éviter les liens cassés. Les pages légales, la page 404 et les notes de démonstration complètent cette surface.

## Veille autonome

Le collecteur `quality/scripts/update_actualites.py` lit les flux RSS configurés dans `data/actualites-sources.json`, classe et dédoublonne les éléments, calcule un score transparent et conserve au maximum 80 publications sur 90 jours. `data/actualites-curation.json` permet les exceptions manuelles. Les données et l’état de collecte sont écrits dans `data/actualites.json` et `data/actualites-status.json`.

Le workflow `update-actualites.yml` est préparé pour deux passages quotidiens après intégration à la branche par défaut. Une panne de source reste isolée ; une panne totale conserve le dernier jeu valide.

## Automatisation visiteurs

`assets/js/automation.js` centralise les événements et les points d’intégration du qualifier, de la newsletter, du rendez-vous et de l’accueil conversationnel. `data/automation-config.json` ne contient aucun secret. Toutes les intégrations distantes sont désactivées dans cette candidate.

Pour activer ultérieurement Brevo en sécurité, il reste à fournir côté serveur :

- un endpoint HTTPS de capture des demandes ;
- un endpoint HTTPS distinct pour la newsletter avec double opt-in ;
- les identifiants de liste et de modèles transactionnels dans l’environnement privé ;
- le destinataire de notification interne ;
- éventuellement une URL réelle de rendez-vous ;
- éventuellement un endpoint réel pour l’accueil conversationnel.

Aucune clé API ne doit être placée dans le dépôt ou dans le JavaScript public.

## Qualité et intégrité

```bash
git diff --check
python quality/scripts/quality_check.py
node --check assets/js/main.js
node --check assets/js/qualifier.js
node --check assets/js/mediatheque.js
node --check assets/js/actualites.js
node --check assets/js/automation.js
python quality/scripts/verify_manifest.py
```

`MANIFEST_SHA256.json` inclut les données de veille dynamiques. Le workflow de collecte le régénère dans le même commit que les données afin de conserver une doctrine d’intégrité unique.

## Préactivation

Toutes les pages conservent `noindex, nofollow` et `robots.txt` conserve `Disallow: /`. Aucun formulaire distant, abonnement, assistant, traceur ou rendez-vous automatisé n’est actif avant configuration et validation explicites.
