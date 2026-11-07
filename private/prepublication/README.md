# Prépublication — architecture des actifs et des supports

**Statut : PRÉPUBLICATION — AUCUNE PUBLICATION, AUCUN TÉLÉCHARGEMENT PUBLIC.**

Ce répertoire porte l'architecture de production des actifs professionnels et des
supports commerciaux et institutionnels. Il prépare la finalisation ; il ne la
remplace pas.

## Ce qui est créé ici

- l'arborescence ;
- les métadonnées ;
- les emplacements nommés ;
- les statuts ;
- la source attendue de chaque élément ;
- le mécanisme futur d'exposition.

## Ce qui n'est pas créé ici

- aucun PDF téléchargeable fabriqué ;
- aucune photographie ;
- aucune vidéo ;
- aucun visage de synthèse ;
- aucun résultat, client, partenaire, mandat, équipe, implantation, distinction
  ou label qui ne serait pas déjà prouvé.

## Règle d'exposition

Un support ou un actif ne peut être exposé publiquement que si, simultanément :

1. son statut est `PUBLIC_READY` ;
2. son `public_allowed` est `true` ;
3. le fichier correspondant existe réellement ;
4. le fondateur a validé l'exposition.

Tant que ces quatre conditions ne sont pas réunies, aucun lien de téléchargement
n'est actif sur le site. Un appel au téléchargement sans fichier réel est interdit.

## Marqueur de prépublication

Tout gabarit ou emplacement provisoire porte le marqueur littéral :

```
TEMP — DO NOT PUBLISH
```

Ce marqueur est recherché dans le build public par
`quality/scripts/check_brand_assets.py`. Sa présence dans `dist/` fait échouer le
contrôle.

## Propriétaires fonctionnels attendus

| Matière | Propriétaire |
|---|---|
| Positionnement, offres, valeur | 01 |
| Données financières, lorsqu'un usage est justifié | 01B |
| Marque, site, expérience, identité numérique | 02 |
| Marché, segments, commercial | 03 |
| Capacité d'exécution, méthodes, preuves | 06 |

L'architecture ci-dessous est un contenant. Le contenu source reste produit par le
propriétaire fonctionnel compétent, puis validé par le fondateur.
