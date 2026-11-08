# Zone privée de prépublication — BlueWave Solutions

**Statut : PRÉPUBLICATION — AUCUN CONTENU DE CE RÉPERTOIRE N'EST PUBLIÉ.**

## Objet

Ce répertoire porte l'architecture, les métadonnées et les emplacements des actifs
professionnels et des supports commerciaux et institutionnels de BlueWave Solutions,
avant réception et approbation des actifs définitifs.

Il ne contient aucun actif photographique ou vidéo réel.

## Garantie technique

Trois mécanismes indépendants maintiennent ce répertoire hors du site publié :

1. `quality/scripts/build_dist.py` — `private/` figure dans les préfixes interdits ;
   le graphe de références du site public ne peut pas l'atteindre.
2. `quality/scripts/check_dist.py` — `private` est un segment interdit à toute
   profondeur du contenu publié.
3. `quality/scripts/check_brand_assets.py` — échec du contrôle si un fichier de
   `private/` entre dans `dist/`, si une page publique référence un actif `TEMP` ou
   `REVIEW`, ou si un marqueur de prépublication apparaît dans `dist/`.

## Limite de confidentialité — à connaître

Le dépôt `bluewave-solutions-site` est un dépôt **public**. L'exclusion du build
public empêche la publication sur le site ; elle n'empêche pas la lecture des
fichiers depuis la plateforme d'hébergement du code.

En conséquence, ce répertoire ne doit contenir :

- aucun secret, jeton, clé ou identifiant ;
- aucune donnée bancaire ou financière personnelle ;
- aucune donnée personnelle sensible ;
- aucune pièce administrative ;
- aucun document contractuel ;
- aucun fait non prouvé présenté comme acquis.

Les actifs et documents réellement confidentiels restent hors de ce dépôt.

## Statuts d'actif

| Statut | Signification | Référençable par une page publique |
|---|---|---|
| `TEMP` | Emplacement ou gabarit provisoire, non approuvé | Non |
| `REVIEW` | Soumis à validation du fondateur | Non |
| `APPROVED` | Validé par le fondateur, usage interne | Non |
| `PUBLIC_READY` | Validé et explicitement autorisé en publication | Oui, si `public_allowed` est `true` |

## Arborescence

```
private/prepublication/
├── brand/            identité de marque, gabarits, Contact Kit
├── media/            Media Kit, éléments presse
├── photos/           actifs photographiques (aucun actif réel)
├── video/            actifs vidéo (aucun actif réel)
├── decks/            Corporate Deck
├── one-pagers/       Company Profile, Capability Statement
├── offres/           fiches des cinq offres cœur
├── formation/        catalogue et modules
├── collaboration/    note de collaboration
├── founder/          manifeste des actifs du fondateur
├── press/            dossier de presse
└── events/           Event / Speaker Kit
```

## Registres

- `prepublication/founder/founder-assets-manifest.json` — actifs du fondateur.
- `prepublication/supports-registry.json` — supports A à J.

Toute modification de ces deux fichiers est contrôlée par
`quality/scripts/check_brand_assets.py`.
