# Profils de publication BlueWave

Deux configurations séparées. Aucune n'est activée par ce dépôt : toute mise en ligne, tout changement DNS et toute indexation attendent l'autorisation explicite de Joseph.

| | Profil A — ouverture commerciale manuelle | Profil B — automatisation future |
|---|---|---|
| Contact | Courriel préparé par le site, envoyé par le visiteur | Demande transmise au Worker, courriel en secours |
| Configuration | `serverless/cloudflare/wrangler.profil-a.jsonc` | `wrangler.production.jsonc` rendu par `render_production_wrangler.py` |
| Collecte serveur | Aucune : API en 503 | D1 `LEADS_DB`, conservation obligatoire |
| Brevo, Turnstile | Fermés | Ouverts après tests de bout en bout |
| Secrets | Aucun | `BREVO_API_KEY`, `GUARD_HMAC_KEY`, `TURNSTILE_SECRET_KEY` (jamais dans Git) |
| Tâche planifiée | Aucune | Purge quotidienne |
| Contrôle | `python quality/scripts/check_profile.py A` | `python quality/scripts/check_profile.py B` |

Les deux profils gardent le site non indexable tant que l'indexation n'a pas été autorisée.

## Interrupteurs

Chaque canal s'ouvre seul, avec la valeur `"true"`. Sans cette valeur, il reste fermé.

| Variable | Effet | Exige |
|---|---|---|
| `LEADS_ENABLED` | Collecte publique sur `/api/leads` | `LEADS_DB`, `LEAD_RETENTION_DAYS`, garde anti-abus |
| `LEADS_CONTACT_SYNC_ENABLED` | Ajout à la liste de contacts Brevo | `BREVO_API_KEY`, `BREVO_LEADS_LIST_ID` |
| `LEADS_ACK_ENABLED` | Accusé de réception au demandeur | `BREVO_API_KEY`, `BREVO_ACK_TEMPLATE_ID`, `BLUEWAVE_INTERNAL_EMAIL` |
| `LEADS_NOTIFY_ENABLED` | Notification interne | `BREVO_API_KEY`, `BREVO_INTERNAL_TEMPLATE_ID`, `BLUEWAVE_INTERNAL_EMAIL` |
| `LEADS_REPLAY_ENABLED` | Réémission de demandes déjà reçues | `LEADS_DB`, `LEAD_RETENTION_DAYS` |
| `CAMPAIGNS_ENABLED` | Conservation des codes campagne | `ALLOWED_CAMPAIGNS` |

Trois décisions restent distinctes :

- **Collecte publique** : fermer `LEADS_ENABLED` arrête les nouvelles demandes.
- **Conservation** : la purge quotidienne continue selon `LEAD_RETENTION_DAYS`, que la collecte soit ouverte ou fermée.
- **Réémission** : `LEADS_REPLAY_ENABLED` autorise la reprise d'une demande déjà reçue, même collecte fermée. Une étape dont l'interrupteur est fermé n'est pas réémise, et une demande hors durée de conservation est refusée.

Une demande stockée sans diffusion ouverte garde le statut `STORED` et ses étapes `SKIPPED`.

## Profil A

```sh
npm ci
python quality/scripts/build_dist.py
python quality/scripts/build_production_dist.py
python quality/scripts/check_profile.py A
npx wrangler deploy --config serverless/cloudflare/wrangler.profil-a.jsonc --dry-run
```

`--dry-run` n'envoie rien. Le déploiement réel se fait sans cette option, uniquement après autorisation.

À réunir avant l'ouverture :

- domaine retenu opérationnel en HTTPS (`www.bluewavesolutions.fr` ne présente aucun certificat au 6 novembre 2026) ;
- route ajoutée à la configuration au moment du GO, jamais avant ;
- mentions légales arbitrées par 04B ;
- veille actualisée (workflow `update-actualites.yml`, à relire avant fusion) ;
- sortie de l'ancien site GitHub Pages prévue, pour éviter deux versions publiques.

L'indexation demande en plus : `quality/privacy-approval.json` validé, `build_production_dist.py --indexable` et `PUBLIC_INDEXABLE=true`.

## Profil B

Prérequis, dans cet ordre, sur un environnement de préproduction séparé :

1. Bases D1 distinctes `CONVERSION_DB` et `LEADS_DB`, schémas appliqués.
2. Secrets posés avec `wrangler secret put`, jamais dans un fichier.
3. Durée de conservation arbitrée (`LEAD_RETENTION_DAYS`) : sans elle, le handler refuse toute demande.
4. Clé publique Turnstile fournie au build.
5. Listes et modèles Brevo créés, paramètres renseignés.
6. Mentions mises à jour et `quality/privacy-approval.json` validé.

```sh
python quality/scripts/build_production_dist.py --leads --turnstile-site-key <CLÉ_PUBLIQUE>
python quality/scripts/render_production_wrangler.py --database-id <UUID> --leads-database-id <UUID> --leads --turnstile --retention-days <JOURS> --contact-sync --ack --notifications --replay
python quality/scripts/check_profile.py B
npx wrangler deploy --config serverless/cloudflare/.wrangler-production.generated.json --dry-run
```

Sans D1, sans durée de conservation ou sans paramètre Brevo, `/api/leads` répond sans jamais appeler Brevo. `/api/health` signale tout composant manquant.

Essais de bout en bout à réussir avant ouverture : demande valide, accusé, notification interne, panne Brevo sans perte, doublon, antispam, purge, droit d'accès et d'effacement. Uniquement avec des adresses de test.

## Retour arrière

Remettre les indicateurs à `false`, revenir à la version Worker précédente, retirer la route si nécessaire. Le détail figure dans `serverless/cloudflare/PRODUCTION.md`.
