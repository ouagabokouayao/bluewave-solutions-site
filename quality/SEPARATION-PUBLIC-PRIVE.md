# Séparation entre dépôt public et données privées

Le dépôt `ouagabokouayao/bluewave-solutions-site` est **public**. Exclure un fichier du build empêche sa publication sur le site, mais pas sa lecture sur GitHub ni dans l'historique Git.

Inventaire du 8 novembre 2026. Cette version intègre la branche `securite-preuves-hors-depot-2026-11-08` (PR 23) dans la version consolidée (PR 20).

## Inventaire

| Chemin | Contenu | Constat | Décision |
|---|---|---|---|
| `quality/media-evidence/` | 3 photographies d'événements (`arbe-sfn-aix-2026`, `loi-littoral-marseille-2026`, `rfdi-gouvernance-oceans-nice-2026`) | Droits de republication et droit à l'image non documentés. `loi-littoral-marseille-2026` montre une tierce personne identifiable. `arbe-sfn-aix-2026` montre des logos d'organismes. | **Retirées de l'arbre.** Copie privée hors dépôt vérifiée par SHA-256. La garde de conservation n'accepte que ces trois retraits, chacun identifié par son empreinte dans le socle. |
| `private/prepublication/` | 28 fichiers : métadonnées, gabarits `TEMP` en SVG, kit de contact, profils textuels du fondateur | Aucun téléphone, aucune adresse postale, aucune pièce administrative ni donnée sensible. L'adresse électronique est celle déjà publiée sur le site ; seule la ville figure. Absent de `main`. Le nom `private` est trompeur : ce dossier est public. | Conservé. Il ne doit recevoir que des données publiables (`private/README.md`). |
| `QA/` | 26 captures de pages du site | Contenu déjà public. | Conservé. |
| `quality/radar/` | Doctrine, schéma, barème et correspondance CRM | `opportunites.json` est vide. Aucune fiche réelle ni aucun contact. | Conservé. Les fiches réelles restent dans le CRM maître. |
| `assets/img/fondateur/bokoua-yao-ouaga.webp` | Portrait du fondateur | Publié volontairement, tracé dans la provenance. | Conservé. |
| `data/` | Veille publique et configurations | Aucune donnée personnelle. | Conservé. |

Le contrôle a porté sur les adresses électroniques, les numéros de téléphone et les fichiers binaires suivis. La seule adresse trouvée est `bluewavesolutions3399@gmail.com`, publiée sur le site.

## Ce qui reste exposé

Constat du 8 novembre 2026, par lecture publique, sans authentification.

| Surface | Photographies lisibles | Mesure possible |
|---|---|---|
| Pointe de `main` | Oui, jusqu'à la fusion de la PR 23 | Fusionner la PR 23 |
| Autres branches publiques du dépôt | Oui : 35 branches distantes les contiennent encore | Supprimer les branches de travail fusionnées ou abandonnées |
| Historique Git | Oui : commit `fe2aae8`, lisible par son SHA | Réécrire l'historique, ou passer le dépôt en privé |
| Site GitHub Pages `ouagabokouayao.github.io/bluewave-solutions-site` | Non : il sert un build, sans `quality/` | Aucune |
| Dépôt `ouagabokouayao/oby-site-academique` et son site GitHub Pages | Oui : les trois fichiers, identiques octet pour octet, sous `assets/img/media/events/` | Décision propre à ce dépôt |
| Builds `dist` et `dist-production` | Non | Aucune |

## Décisions qui appartiennent à Joseph

1. Fusionner la PR 23, qui retire les photographies de la pointe de `main`.
2. Supprimer les branches de travail qui les contiennent encore.
3. Retirer les photographies de l'historique, par réécriture de l'historique ou en passant le dépôt en privé. Ces opérations sont irréversibles ou ont un effet externe : rien n'a été fait.
4. Statuer sur les trois photographies servies par `oby-site-academique`, dont celle qui montre une tierce personne.

## Règles

- Une photographie sans droits documentés n'entre ni dans le build, ni dans le dépôt.
- `quality_check.py` échoue si une image revient dans `quality/media-evidence/`, ou si une preuve interne pointe vers le dépôt.
- Les octets des preuves se vérifient sur le stockage privé : `BLUEWAVE_PREUVES_PRIVEES=<dossier> python quality/scripts/quality_check.py`.
