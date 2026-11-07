# Séparation entre dépôt public et données privées

Le dépôt `ouagabokouayao/bluewave-solutions-site` est **public**. Exclure un fichier du build empêche sa publication sur le site, mais pas sa lecture sur GitHub ni dans l'historique Git.

Inventaire du 8 novembre 2026, sur la branche `site-02-consolide-2026-10-16` et sur `main`.

## Inventaire

| Chemin | Contenu | Constat | Décision |
|---|---|---|---|
| `quality/media-evidence/` | 3 photographies d'événements (`arbe-sfn-aix-2026`, `loi-littoral-marseille-2026`, `rfdi-gouvernance-oceans-nice-2026`) | Droits de republication et droit à l'image non documentés. `loi-littoral-marseille-2026` montre une tierce personne identifiable. `arbe-sfn-aix-2026` montre des logos d'organismes. Les trois fichiers sont aussi servis par le dépôt public `ouagabokouayao/oby-site-academique`. | Copie privée locale vérifiée par SHA-256. Retrait préparé sur la branche `securite-preuves-hors-depot-2026-11-08`, partie de `main`. La PR 20 les garde : sa garde de conservation interdit de perdre un fichier de son socle. |
| `private/prepublication/` | 28 fichiers : métadonnées, gabarits `TEMP` en SVG, kit de contact, profils textuels du fondateur | Aucun téléphone, aucune adresse postale, aucune pièce administrative ni donnée sensible. L'adresse électronique est celle déjà publiée sur le site ; seule la ville figure. Absent de `main`. Le nom `private` est trompeur : ce dossier est public. | Conservé. Il ne doit recevoir que des données publiables (`private/README.md`). |
| `QA/` | 26 captures de pages du site | Contenu déjà public. | Conservé. |
| `quality/radar/` | Doctrine, schéma, barème et correspondance CRM | `opportunites.json` est vide. Aucune fiche réelle ni aucun contact. | Conservé. Les fiches réelles restent dans le CRM maître. |
| `assets/img/fondateur/bokoua-yao-ouaga.webp` | Portrait du fondateur | Publié volontairement, tracé dans la provenance. | Conservé. |
| `data/` | Veille publique et configurations | Aucune donnée personnelle. | Conservé. |

Le contrôle a porté sur les adresses électroniques, les numéros de téléphone et les fichiers binaires suivis. La seule adresse trouvée est `bluewavesolutions3399@gmail.com`, publiée sur le site.

## Ce qui reste exposé

- Les trois photographies restent sur `main` et sur la PR 20 tant que la branche `securite-preuves-hors-depot-2026-11-08` n'est pas fusionnée, et dans l'historique Git dans tous les cas.
- Elles restent servies par `ouagabokouayao/oby-site-academique`, qui n'est pas traité ici.

## Décisions qui appartiennent à Joseph

1. Fusionner la branche `securite-preuves-hors-depot-2026-11-08`, ce qui retire les photographies de la pointe de `main`. La PR 20 devra ensuite intégrer `main`, et sa garde de conservation devra prendre acte de ce retrait.
2. Retirer les photographies de l'historique, par réécriture de l'historique ou en passant le dépôt en privé. Ces deux opérations sont irréversibles ou ont un effet externe : rien n'a été fait.
3. Statuer sur la photographie avec tierce personne dans `oby-site-academique`.

## Règles

- Une photographie sans droits documentés n'entre ni dans le build, ni dans le dépôt.
- Sur la branche de retrait, `quality_check.py` échoue si une image revient dans `quality/media-evidence/`, ou si une preuve interne pointe vers le dépôt.
- Les octets des preuves se vérifient alors sur le stockage privé : `BLUEWAVE_PREUVES_PRIVEES=<dossier> python quality/scripts/quality_check.py`.
