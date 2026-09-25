# Alertes du radar — architecture et activation

**État : non activées.** `alertes-config.json` porte `active: false`, aucun canal ouvert,
aucun déclencheur armé. Aucun envoi, aucune notification externe, aucun appel réseau
sortant n'existe dans ce lot. `radar_check.py` refuse tout état contraire.

## Ce qui est prêt

Huit déclencheurs sont décrits et versionnés, avec leur condition exacte :

| Déclencheur | Condition |
| --- | --- |
| Nouvelle opportunité forte | `score.total >= 75` |
| Date limite proche | `deadline − aujourd'hui <= 14 j` et statut ≠ `NO GO` |
| Événement pertinent | type conférence / colloque / symposium / congrès / salon / événement institutionnel, et `score.total >= 55` |
| Stand ou exposition disponible | type stand / exposition / salon, accessibilité ouverte |
| Appel à communications ouvert | type appel à communications / abstracts / posters |
| Appel à consultants | type appel à consultants |
| Appel à projets pertinent | type appel à projets / AMI / marché public, et `score.total >= 55` |
| Consortium possible | type consortium, accessibilité non réservée |

Cinq canaux sont déclarés et fermés : e-mail, notification externe, Brevo, webhook,
résumé local.

## Ordre d'activation recommandé

Le canal le moins engageant d'abord, puis seulement si le besoin le justifie :

1. **résumé local** — écrit un fichier interne, aucune sortie réseau. C'est le seul canal
   activable sans dépendance externe, et il suffit dans la plupart des cas ;
2. **e-mail** — suppose un expéditeur, un destinataire et un fournisseur déclarés ;
3. **Brevo** — suppose la réactivation de Brevo, qui relève d'une décision propre ;
4. **webhook / notification externe** — suppose une cible maîtrisée et authentifiée.

## Procédure d'activation, le jour venu

1. GO explicite et distinct du propriétaire, canal par canal.
2. Passer `active: true` sur le canal visé, et sur lui seul.
3. Armer les déclencheurs un par un, pas tous en même temps : un déclencheur mal calibré
   se remarque à son volume.
4. Aucune clé d'API dans le dépôt : `api_key_env` ne porte qu'un **nom de variable
   d'environnement**, la valeur restant dans les secrets de l'environnement.
5. Rejouer `radar_check.py`, puis `check_secrets.py`.
6. Vérifier que `check_dist.py` reste à 0 fichier interne : une alerte ne doit jamais
   faire entrer le radar dans le build public.

## Limites assumées

Une alerte informe une personne. Elle ne décide pas, ne candidate pas et ne répond à
aucun appel. `decision_humaine` reste le seul champ qui engage BlueWave.

Le volume n'est pas un objectif : un radar qui alerte trop ne sera plus lu, et un
déclencheur qui se déclenche toujours ne trie plus rien.
