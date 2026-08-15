# CLAUDE.md — Charte technique BlueWave Solutions

Contexte permanent pour toute intervention de Claude Code sur ce dépôt.
À lire avant d'agir, à chaque nouvelle intervention.

---

## 1. Identité BlueWave

BlueWave Solutions est un **bureau d'études, de conseil et de recherche appliquée**, spécialisé dans :

- mer et espaces maritimes ;
- littoral et territoires côtiers ;
- gouvernance maritime ;
- droit de la mer et cadres maritimes ;
- sécurité maritime comme champ d'analyse, de gouvernance et de formation ;
- environnement côtier et marin ;
- économie bleue ;
- ports et interfaces ville-port ;
- concertation, médiation et acceptabilité des projets ;
- innovation utile ;
- formation et renforcement des capacités ;
- recherche appliquée et prospective.

**Marchés prioritaires :** Méditerranée / France — Côte d'Ivoire / Afrique de l'Ouest.

> **Règle absolue.** BlueWave ne doit jamais être transformé en cabinet de conseil généraliste par une
> décision technique ou éditoriale de Claude. Toute simplification, refactorisation ou réécriture qui
> dilue cette spécialisation est un échec, même si le résultat est plus propre ou plus court.

Le vocabulaire de référence est « bureau d'études » ou « structure ». Ne pas introduire « cabinet ».

---

## 2. Gouvernance

| Rôle | Qui | Portée |
|---|---|---|
| Propriétaire et arbitre final | **Joseph** | Toute décision |
| Pilotage site, UX, marque, contenus publics | **02 — Marque, site & expérience** | Direction fonctionnelle et éditoriale |
| Exécution technique | **Claude Code** | Mise en œuvre, tests, compte rendu |

- **GitHub est la source de vérité du code.** `main` est la branche de référence.
- Les interventions substantielles se font **sur une branche dédiée**, jamais directement sur `main`.
- **Aucune publication, fusion ou mise en production automatique sans instruction explicite.**
- Claude ne modifie pas une décision stratégique ou éditoriale au seul motif d'améliorer l'esthétique,
  de simplifier le code ou de réduire la duplication. Une décision validée se discute, elle ne se
  contourne pas par un commit.

### Séquence obligatoire

```
Analyser → proposer → modifier → tester → examiner le diff → contrôler le rendu → rendre compte
```

Aucune étape ne peut être sautée, y compris pour un changement jugé trivial.

---

## 3. Architecture fonctionnelle canonique

### Cinq offres cœur — intitulés de référence

1. Diagnostic stratégique maritime, littoral ou portuaire
2. Vulnérabilité côtière, adaptation et options de décision
3. Gouvernance, acteurs, usages et acceptabilité
4. Structuration de projets maritimes, littoraux ou d'économie bleue
5. Formation et renforcement des capacités

**Claude ne doit pas :**

- inventer une sixième offre ;
- restaurer une ancienne architecture d'offres ;
- faire de « note flash » un troisième format d'entrée.

### Deux formats d'entrée — et seulement deux

- **Note stratégique BlueWave**
- **Atelier de cadrage BlueWave**

### Surface publique du site

Huit pages : `index.html`, `services.html`, `domaines.html`, `a-propos.html`, `contact.html`,
`notes-demonstrateurs.html`, `mentions-legales.html`, `politique-confidentialite.html`.

### Contact — principe, non figé

**Principe permanent.** Le contact doit rester simple, transparent et **sans backend fictif**. Toute
évolution du parcours de qualification doit respecter les décisions de 02 et les règles de
confidentialité. Une génération locale de courriel prérempli est autorisable **lorsqu'elle est
explicitement demandée**.

**État observé au 2026-08 — description, pas décision intangible.** Le contact passe aujourd'hui par
des liens `mailto:` vers une adresse unique, sans formulaire actif ; cet état est affirmé à trois
endroits (`contact.html`, `politique-confidentialite.html`, `README.md`). Si 02 fait évoluer le
parcours, ces trois endroits devront être mis à jour ensemble — mais l'absence de formulaire **n'est
pas une caractéristique permanente de l'architecture canonique**.

---

## 4. Méthode BlueWave — deux niveaux distincts

**Parcours public** — parcours de valeur, lisible par le visiteur :

```
Comprendre → Cadrer → Cartographier → Structurer → Décider → Transmettre
```

**Processus d'exécution** — processus professionnel interne :

```
Qualifier → Cadrer → Analyser → Cartographier → Structurer → Contrôler → Restituer → Capitaliser
```

- Le premier est publié sur le site. Le second **ne l'est pas actuellement** ; ne pas le publier sans
  instruction de 02.
- Ce ne sont **pas deux versions concurrentes**. Claude ne doit ni les fusionner, ni en aligner un sur
  l'autre, ni « corriger » l'un au motif qu'il diffère de l'autre.

---

## 5. Never invent

Il est **interdit** d'ajouter, de suggérer ou de laisser entendre sans source validée par 02 ou Joseph :

- client · référence client · mission réalisée ;
- partenaire · mandat · financement ;
- équipe permanente · expert engagé ;
- implantation locale · bureau en Afrique de l'Ouest ;
- certification · label · agrément ;
- résultat obtenu.

Cela vaut aussi pour les formulations indirectes, les exemples d'illustration, les textes de
remplissage, les métadonnées et les balises `alt`.

**Les démonstrateurs doivent toujours rester explicitement identifiés** comme *simulation*,
*démonstration illustrative*, ou une formulation équivalente sans ambiguïté. Ce marquage n'est pas
décoratif : il est vérifié automatiquement par la porte qualité, qui échoue si `notes-demonstrateurs.html`
compte moins de deux mentions « simulation illustrative ».

En cas de doute sur une affirmation : **ne pas l'écrire, et le signaler dans le compte rendu.**

---

## 6. Statut de publication

Le site est en **préactivation non indexée**. Tant qu'une instruction explicite n'autorise pas la
publication :

- conserver `<meta name="robots" content="noindex, nofollow">` sur **toutes** les pages ;
- conserver la protection équivalente dans `robots.txt` (`Disallow: /`) ;
- ne pas créer de sitemap destiné à déclencher l'indexation ;
- ne pas déployer volontairement une nouvelle version publique ;
- ne pas retirer les avertissements de simulation nécessaires.

> **Une optimisation SEO technique n'autorise jamais l'indexation.** Améliorer des titres, des
> descriptions ou des données structurées ne vaut pas décision de publication.

### Déploiement — à revérifier, jamais à supposer

L'historique de déploiement observé lors de `CC-BW-00` indique **actuellement** des déploiements
GitHub Pages associés aux commits de `main`. **La configuration effective de GitHub Pages doit être
revérifiée avant toute intervention touchant au déploiement.** Ne jamais supposer qu'un changement de
branche, de dossier ou de workflow est impossible.

> **Règle opérationnelle.** Aucun merge ou changement susceptible d'affecter le site servi ne doit
> être effectué sans contrôle préalable.

Le fichier `.nojekyll` est présent à la racine ; ne pas le supprimer sans avoir vérifié la
configuration Pages en vigueur.

---

## 7. Qualité obligatoire

Avant de considérer une intervention terminée, contrôler **selon pertinence** :

HTML · CSS · JavaScript · liens · ancres · responsive · mobile · tablette · desktop ·
navigation clavier · focus · labels · `alt` · contraste · SEO technique · métadonnées ·
performances · ressources · console navigateur · cohérence éditoriale · véracité.

> **Une réponse « terminé » sans tests ni contrôle du diff n'est pas une preuve suffisante.**
> Le compte rendu doit indiquer ce qui a été testé, comment, et avec quel résultat — y compris les
> points non testés et pourquoi.

### Commandes de contrôle réellement disponibles

```bash
python quality/scripts/quality_check.py
node --check assets/js/main.js
```

Ce sont les deux seules commandes de contrôle du dépôt, et ce sont celles qu'exécute la CI
(`.github/workflows/bluewave-quality.yml`, sur `pull_request`, `push` vers `main`, et
`workflow_dispatch`). `python3` fonctionne également en local.

La porte qualité vérifie : `lang`, titre de page, `h1` unique, `noindex,nofollow`, identifiants
dupliqués, `alt` manquants, placeholders, tarifs publics, ressources locales introuvables, liens et
ancres locaux, `Disallow: /`, marquage des simulations, validité XML des SVG, équilibre des accolades CSS.
Exécutée sans `--json`, elle **n'écrit aucun fichier**.

**Contrôles complémentaires** (rendu navigateur / headless, mesures responsive, contraste, tabulation) :
à utiliser **lorsque l'environnement le permet**, et à signaler comme non exécutés lorsqu'il ne le
permet pas. Ne jamais présenter un contrôle non exécuté comme réussi.

---

## 8. Git

- Inspecter `git status` **avant** toute intervention.
- Ne pas écraser une modification préexistante.
- Utiliser une **branche dédiée** pour toute intervention substantielle.
- Limiter les commits à des **unités fonctionnelles cohérentes**.
- **Examiner le diff avant de committer.**
- **Ne jamais faire de force-push** sans instruction.
- **Ne jamais merger dans `main`** sans validation.
- Ne jamais supprimer massivement des fichiers sur simple supposition d'inutilité.

> Toute suppression doit reposer sur une **preuve de non-utilisation** *et* sur l'**absence de valeur
> documentaire**. Attention : une classe CSS peut être absente du HTML mais pilotée par le JavaScript
> (`is-open` en est un cas réel). Croiser HTML **et** JS avant de conclure.

---

## 9. Dette CSS connue

L'audit `CC-BW-00` a identifié dans `assets/css/style.css` :

- une importante quantité de CSS historiquement inutilisé, héritée de pages supprimées ;
- plusieurs couches successives de correctifs responsive ;
- de multiples redéfinitions des mêmes sélecteurs ;
- un recours à `!important` concentré dans les couches les plus tardives.

> **Ne pas lancer de réécriture globale du CSS.** Corriger progressivement, par familles cohérentes,
> avec tests visuels et preuve d'absence de régression après chaque étape.

---

## 10. TEMPORARY KNOWN ISSUE — incident responsive 761–880 px

> **TEMPORARY KNOWN ISSUE — à retirer de `CLAUDE.md` une fois la correction validée.**
> Cette section est une entrée temporaire, pas une rubrique permanente de la charte.
> `CLAUDE.md` n'a pas vocation à devenir un backlog : le suivi des correctifs se fait ailleurs.

Identifié par `CC-BW-00`, **non corrigé à ce jour** :

- débordement horizontal approximativement **entre 761 px et 880 px**, sur l'ensemble des pages ;
- perte d'une partie de la navigation, **dont le lien Contact** sur certains viewports ;
- bascule vers le menu hamburger déclenchée trop tardivement ;
- `overflow-x: hidden` **masque** le problème au lieu de le résoudre, rendant le contenu débordant
  inatteignable plutôt que simplement décalé.

Ce problème sera traité dans une mission fonctionnelle ultérieure. Ne pas l'aborder de façon
opportuniste au détour d'une autre intervention.

---

## 11. Périmètre d'une intervention

Ne modifier que ce que la mission demande. Si une amélioration évidente apparaît hors périmètre :
**la signaler dans le compte rendu, ne pas l'appliquer.**

En cas de contradiction entre ce fichier et une instruction de mission, l'instruction de mission
prévaut — et la contradiction doit être signalée à 02.
