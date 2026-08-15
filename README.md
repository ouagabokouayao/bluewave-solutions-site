# BlueWave Solutions — site V2

Site vitrine statique, multipage et responsive de BlueWave Solutions. La version publique est organisée autour de huit pages cohérentes.

## Architecture V2

- `index.html` : accueil, positionnement et synthèse de la proposition de valeur ;
- `services.html` : cinq offres cœur, formats d’entrée et méthode publique ;
- `domaines.html` : domaines d’intervention et contextes géographiques ;
- `a-propos.html` : positionnement, publics accompagnés et principes de travail ;
- `contact.html` : trois entrées de contact et un formulaire local de qualification de projet ;
- `notes-demonstrateurs.html` : notes, maquettes de livrables et deux simulations explicitement illustratives ;
- `mentions-legales.html` : informations légales de la version locale ;
- `politique-confidentialite.html` : traitement des prises de contact réalisées par courriel.

## Cinq offres cœur

1. Diagnostic stratégique maritime, littoral ou portuaire ;
2. Vulnérabilité côtière, adaptation et options de décision ;
3. Gouvernance, acteurs, usages et acceptabilité ;
4. Structuration de projets maritimes, littoraux ou d’économie bleue ;
5. Formation et renforcement des capacités.

## Notes et démonstrateurs

Les aperçus de livrables et les deux cas présentés sont des simulations illustratives. Ils montrent une méthode et des formats possibles sans revendiquer de client, de mandat ni de résultat réel.

## Contact et indexation

La page Contact comporte un formulaire **local**, sans backend : les champs saisis servent uniquement à composer un courriel prérempli, ouvert dans le logiciel de messagerie du visiteur, qui reste seul à décider de l’envoi. Le site n’enregistre ni ne transmet aucune donnée. Les liens de courriel direct restent disponibles en alternative. Toutes les pages conservent la directive `noindex, nofollow` jusqu’à une décision explicite de publication.

## Structure technique

- `assets/css/style.css` : design system et mise en page responsive ;
- `assets/js/main.js` : navigation mobile et interactions ;
- `quality/scripts/quality_check.py` : contrôle local de la surface publique ;
- `.github/workflows/bluewave-quality.yml` : exécution automatisée des contrôles autorisés.

## Utilisation locale

Ouvrir `index.html` dans un navigateur ou lancer un serveur local pour visualiser le site.
