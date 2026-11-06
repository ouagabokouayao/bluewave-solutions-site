# Profils de publication BlueWave

Deux configurations séparées. Aucune n'est activée par ce dépôt : toute mise en ligne, tout changement DNS et toute indexation attendent l'autorisation explicite de Joseph.

| | Profil A — ouverture commerciale manuelle | Profil B — automatisation future |
|---|---|---|
| Contact | Courriel préparé par le site, envoyé par le visiteur | Demande transmise au Worker, courriel en secours |
| Configuration | `serverless/cloudflare/wrangler.profil-a.jsonc` | `wrangler.production.jsonc` rendu par `render_production_wrangler.py` |
| Collecte serveur | Aucune : API en 503 | D1 `LEADS_DB`, conservation obligatoire |
| Brevo, Turnstile | Fermés | Ouverts après tests de bout en bout |
| Secrets | Aucun | `BREVO_API_KEY`, `GUARD_HMAC_KEY`, `TURNSTILE_SECRET_KEY` (jamais dans Git) |
| Tâche planifiée | Aucune | Purge, reprise des retraits et contrôle des blocages |
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
| `NEWSLETTER_ENABLED` | Inscription à la lettre de veille | Voir « Lettre de veille » |

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

## Lettre de veille

Canal distinct des demandes de contact, fermé par défaut. Aucune demande de contact ne produit d'inscription.

| Étape | Route | Effet |
|---|---|---|
| Inscription | `POST /api/newsletter/subscribe` | Enregistre la demande, envoie le lien de confirmation. Même réponse pour une adresse nouvelle, en attente ou déjà inscrite |
| Confirmation | `POST /api/newsletter/confirm` | Inscrit chez Brevo, scelle la preuve, remet le jeton de gestion |
| Préférences | `POST /api/newsletter/preferences` | Lit ou modifie les rubriques |
| Désinscription | `POST /api/newsletter/unsubscribe` | Retire le consentement en base, puis chez Brevo. Reste ouverte canal fermé, sans limite de débit ni de durée |

Jetons :

- Ils sont opaques : aucune adresse n'y figure. La base n'en garde que l'empreinte.
- Le lien de confirmation vaut 24 heures et ne sert qu'une fois, même entre plusieurs instances. Ce contrôle a lieu dans D1.
- Le jeton de gestion vaut deux ans pour les rubriques. Il reste valable pour la désinscription.
- Ils voyagent dans le fragment de l'adresse et le corps d'un POST : ils n'entrent ni dans les journaux, ni dans `Referer`. Ouvrir un lien ne déclenche rien, ce qui neutralise les scanners de messagerie.

Une panne Brevo pendant un retrait laisse l'état `REVOKING`. Le consentement est déjà retiré, et la tâche quotidienne reprend la répercussion. Conserver `BREVO_API_KEY` et `NEWSLETTER_DB` tant qu'il reste des inscrits ou des retraits en cours : sans eux, le retrait échoue.

Conservation : une adresse jamais confirmée est supprimée 30 jours après l'expiration de son lien. La preuve d'un consentement retiré suit `NEWSLETTER_PROOF_RETENTION_DAYS`.

À réunir avant l'ouverture :

1. Base D1 distincte, schéma `serverless/cloudflare/newsletter-schema.sql` appliqué.
2. Secret `NEWSLETTER_TOKEN_SECRET` (32 caractères au moins) posé avec `wrangler secret put`.
3. Liste Brevo dédiée, attributs `BW_VEILLE_PREFERENCES` et `BW_VEILLE_GESTION`, modèle de confirmation utilisant `{{ params.confirmation_url }}`.
4. Paramètres `BREVO_NEWSLETTER_LIST_ID` et `BREVO_NEWSLETTER_CONFIRM_TEMPLATE_ID`.
5. Modèle de lettre dont le lien de désinscription pointe vers `BW_VEILLE_GESTION`. Le lien de désinscription propre à Brevo ne met pas `NEWSLETTER_DB` à jour.
6. Décisions de 04B : information des personnes, `NEWSLETTER_NOTICE_VERSION`, durée de la preuve, durée de 30 jours. La rubrique « Lettre de veille » de `quality/privacy-approval.json` doit passer à `VALIDE`.
7. Essai réel sur la liste Brevo, avec une adresse de test : les appels sont aujourd'hui vérifiés en simulation seulement.

```sh
python quality/scripts/build_production_dist.py --leads --newsletter --turnstile-site-key <CLÉ_PUBLIQUE>
python quality/scripts/render_production_wrangler.py --database-id <UUID> --leads-database-id <UUID> --newsletter --newsletter-database-id <UUID> --notice-version <VERSION> --proof-retention-days <JOURS> --leads --turnstile --retention-days <JOURS>
python quality/scripts/check_profile.py B --newsletter
```

### Inscriptions fermées

Toute construction publie `lettre-de-veille.html`, à la même adresse, pour que les liens déjà envoyés restent valables. Sans `--newsletter`, la page affiche « Les inscriptions ne sont pas encore ouvertes. » et ne contient aucun formulaire : elle n'est ni indexée, ni citée dans le plan du site, ni reliée au menu.

Une personne déjà inscrite y arrive par son lien et se désinscrit d'un clic. Sans base ni fournisseur, comme au profil A, la page donne l'adresse de contact pour un retrait à la main.

Pour refermer la lettre, retirer `--newsletter` et garder `--newsletter-database-id`. `/api/health` signale `unavailable` si la base reste liée sans son secret ni ses paramètres Brevo : le retrait échouerait.

### Supervision

La tâche quotidienne relance les retraits en attente, puis mesure ce qui reste bloqué.

| Journal | Contenu |
|---|---|
| `newsletter_maintenance` | `status`, retraits en attente (`count`), relancés (`retried`), en échec (`failed`), ancienneté (`age_hours`), tentatives (`attempts`), cause (`reason`, par exemple `http_401` ou `network`) |
| `lead_delivery_backlog` | Demandes dont la diffusion reste incomplète, et leur ancienneté |
| `sync_alert` | Blocage de plus de 24 heures, avec `operation` : `newsletter_revocation` ou `lead_delivery` |

Une alerte fait aussi échouer l'exécution de la tâche : elle apparaît dans l'historique Cloudflare et peut y déclencher une notification, sans dépendre du service en panne. Aucune adresse n'entre dans ces journaux.

## Retour arrière

Remettre les indicateurs à `false`, revenir à la version Worker précédente, retirer la route si nécessaire. Le détail figure dans `serverless/cloudflare/PRODUCTION.md`.
