# Radar interne BlueWave — opportunités

Zone **interne**. Rien de ce répertoire n'est servi publiquement : `quality/` est exclu
de `dist` par construction (le build ne retient que ce qui est atteignable depuis les
pages publiques) et `check_dist.py` refuse le segment `quality`, ainsi que `radar` et
`opportunites`, à toute profondeur.

## Ce que le radar est, et ce qu'il n'est pas

Le radar qualifie des **opportunités** : appels à projets, marchés, consultations,
appels à communications, événements, consortiums, réseaux. Il ne remplace ni la page
Actualités, ni le CRM.

| | Actualités (public) | Radar (interne) | CRM (maître) |
| --- | --- | --- | --- |
| Rôle | veille éditoriale, crédibilité, information du visiteur | détection et qualification d'opportunités actionnables | suivi des opportunités engagées et de la relation |
| Contenu | signaux du secteur | fiches d'opportunité qualifiées | affaires, contacts, échéances |
| Servi dans `dist` | oui | **non** | non |
| Propriétaire de la donnée | collecteur `update_actualites.py` | radar | CRM |

**Une actualité n'est pas une opportunité, et une opportunité n'est pas une actualité.**
Les deux logiques restent séparées : un appel à candidatures peut être qualifié sans
jamais être publié ; un signal publié peut n'ouvrir aucune opportunité.

## Chaîne

```
source officielle
  └─ collecte (data/actualites-sources.json, update_actualites.py)
      ├─ actualité publique éventuelle ......... data/actualites.json → actualites.html
      └─ détection d'opportunité ............... règles de typage (voir types.json)
          └─ qualification interne ............. scoring.json
              └─ fiche d'opportunité ........... schema-opportunite.json
                  └─ décision humaine .......... statut GO / NO GO / VEILLE
                      └─ action ................ export CRM (mapping-crm.json)
```

Le score trie ; il ne décide pas. Il produit une **décision recommandée** et rien d'autre.

**Décision et statut sont deux choses distinctes.** La décision dit quoi faire, le statut dit
où en est le traitement. Les deux ensembles sont disjoints et `radar_check.py` refuse tout
recouvrement.

| Décisions | Statuts de cycle de vie |
| --- | --- |
| `GO À PRÉPARER` · `À ÉTUDIER` · `VEILLE` · `NO GO` | `DÉTECTÉE` · `À QUALIFIER` · `ACTION EN COURS` · `CLÔTURÉE` · `EXPIRÉE` |

`decision_recommandee` vient du score, `decision_humaine` d'une personne, `statut` du
traitement. Aucun des trois ne se substitue aux autres.

## Identifiant

Le radar reprend **le canon d'identifiant du CRM maître** : `OPP-` suivi du numéro
séquentiel du CRM (`OPP-014`, `OPP-015`, `OPP-016`…). Aucune convention concurrente n'est
créée, aucune migration du CRM n'est demandée.

> Un identifiant CRM canonique = une opportunité = une fiche radar.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `types.json` | types d'opportunité détectables et rôles possibles |
| `schema-opportunite.json` | schéma JSON de la fiche d'opportunité |
| `scoring.json` | critères, pondérations, seuils et décisions recommandées |
| `opportunites.json` | registre des fiches qualifiées — **vide tant qu'aucune opportunité réelle n'est instruite** |
| `mapping-crm.json` | correspondance champ à champ radar ↔ CRM, règle d'identité |
| `alertes.md` | architecture d'alerte et procédure d'activation |
| `alertes-config.json` | configuration préparatoire — **tous les canaux désactivés** |
| `doctrine-recherche-appliquee.md` | ce que recouvre la recherche appliquée BlueWave |
| `doctrine-evenements-interventions.md` | rôles possibles lors d'un événement, et leur régime de preuve |

`quality/scripts/radar_check.py` contrôle la cohérence de l'ensemble et refuse toute
activation d'alerte comme toute fuite du radar dans le build public.

## Véracité

Le registre ne contient que des opportunités **réellement constatées à une source
officielle**, avec son URL. Aucune opportunité d'exemple, de démonstration ou de
remplissage. Une fiche sans `url_source` est invalide.

Le radar ne crée jamais de référence publique : aucune de ses données ne remonte sur
le site. Un événement détecté ici n'est publiable dans la Médiathèque qu'après
participation réelle et rattachement documenté, selon la doctrine du corpus activités.
