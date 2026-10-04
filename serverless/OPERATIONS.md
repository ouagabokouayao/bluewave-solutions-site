# Exploitation — site BlueWave Solutions

Document interne. Il décrit l'architecture préparée, les ressources externes
nécessaires, l'ordre d'activation et l'ordre de repli. Rien de ce qui est décrit
ici n'est activé : toutes les options de service sont fermées par défaut.

---

## 1. Architecture

```
NAVIGATEUR
  │
  ├─ POST /api/leads ────────────────────────────────────────────────┐
  │     1. validation stricte (schéma P0 partagé front/serveur)      │
  │     2. piège à robots (honeypot)                                 │
  │     3. Turnstile — si TURNSTILE_ENABLED=true                     │
  │     4. limite de débit                                           │
  │     5. anti-doublon court (Durable Object)                       │
  │     6. ENREGISTREMENT dans LEADS_DB  ← la demande est acquise    │
  │     7. contact Brevo                                             │
  │     8. accusé de réception                                       │
  │     9. notification interne                                      │
  │    10. consignation des statuts de diffusion                     │
  ├─ POST /api/events ──► CONVERSION_DB : compteurs agrégés, sans donnée
  │                        personnelle, vocabulaire fermé
  │
  └─ GET  /api/health ──► disponibilité seule
```

Les étapes 7 à 9 sont des effets externes. Elles peuvent échouer sans faire
perdre la demande : celle-ci est déjà en base à l'étape 6.

### Limite de débit et idempotence : deux choses différentes

La **limite de débit** borne le nombre d'envois d'un même client sur une
fenêtre glissante. Elle protège le service, ne regarde pas le contenu, et
répond 429.

L'**anti-doublon court** empêche deux envois identiques rapprochés et répond
409 : la première demande a bien été reçue, la seconde est écartée.

L'**idempotence métier** est la seconde défense, en base. L'empreinte couvre
toute la demande validée — qualification, identité et charge propre au
parcours — plus le jour UTC. Deux demandes réellement différentes ne se
confondent donc jamais, même déposées la même journée par la même personne ;
une reprise strictement identique, elle, retombe sur la ligne existante sans
produire de seconde ligne ni de second accusé.

**Brevo n'est pas la base métier.** C'est un carnet de contacts opérationnel et
un expéditeur transactionnel. La source de vérité est `LEADS_DB`.

**Les deux bases ne se mélangent jamais.** `CONVERSION_DB` ne contient aucune
donnée personnelle ; `LEADS_DB` ne contient aucun agrégat d'audience. Aucune
jointure, aucun binding partagé.

### Turnstile : deux moitiés indissociables

La vérification serveur (`TURNSTILE_ENABLED` + `TURNSTILE_SECRET_KEY`) et la
clé publique du navigateur (`turnstile.site_key` dans l'artefact) s'activent
ensemble. Le générateur de configuration refuse l'une sans l'autre, et
`quality/scripts/check_turnstile_profile.py` le vérifie dans les deux sens.
La politique de sécurité du contenu n'ouvre `challenges.cloudflare.com` que
lorsque le service est activé.

### Ce qui n'est jamais stocké

Adresse IP brute, jeton Turnstile, clé d'API, secret, en-tête de requête,
contenu du piège à robots. La garde anti-abus ne manipule qu'une empreinte HMAC,
en mémoire d'objet durable, sur des fenêtres d'environ vingt minutes.

---

## 2. Ressources Cloudflare requises

| Ressource | Rôle | Créée ? |
| --- | --- | --- |
| Worker `bluewave-site-production` | site + API | non |
| D1 `bluewave-conversions-production` | agrégats d'audience | non |
| D1 `bluewave-leads-production` | demandes | non |
| Durable Object `LeadGuard` | débit et anti-doublon | déclaré, non déployé |
| Turnstile (site key + secret) | anti-abus formulaire | non |
| Domaine personnalisé `www.bluewavesolutions.fr` | route publique | non |

### Variables

| Variable | Valeur fermée | Rôle |
| --- | --- | --- |
| `LEADS_ENABLED` | `false` | ouvre `/api/leads` |
| `EVENTS_ENABLED` | `false` | ouvre `/api/events` |
| `NEWSLETTER_ENABLED` | `false` | ouvre la lettre de veille |
| `TURNSTILE_ENABLED` | `false` | impose la vérification Turnstile |
| `PUBLIC_INDEXABLE` | `false` | autorise l'indexation |
| `LEAD_RETENTION_DAYS` | vide | purge des demandes ; vide = aucune purge |
| `ALLOWED_ORIGIN` | origine du site | refuse toute autre origine |
| `ALLOWED_CAMPAIGNS` | vide | codes de campagne préautorisés |

### Secrets

Jamais versionnés, jamais journalisés, fournis au runtime uniquement :
`GUARD_HMAC_KEY`, `TURNSTILE_SECRET_KEY`, `BREVO_API_KEY`.

---

## 3. Ressources Brevo requises

Voir l'inventaire détaillé : `serverless/bluewave-leads/BREVO-EXTERNAL.md`.
Aucun identifiant n'est inventé : chaque valeur y est marquée
`<À FOURNIR PAR ENVIRONNEMENT>`.

---

## 4. Création de la préproduction

Environnement isolé : non indexable, robots fermé, bases distinctes, données de
test uniquement, aucun domaine public principal. **Ces commandes ne sont pas
exécutées ici.**

```sh
# 1. Bases D1 de préproduction, séparées de la production.
npx wrangler d1 create bluewave-conversions-preproduction
npx wrangler d1 create bluewave-leads-preproduction

# 2. Schémas.
npx wrangler d1 execute bluewave-conversions-preproduction --remote \
  --file serverless/cloudflare/schema.sql
npx wrangler d1 execute bluewave-leads-preproduction --remote \
  --file serverless/cloudflare/leads-schema.sql

# 3. Secrets de préproduction (valeurs de test, jamais celles de production).
npx wrangler secret put GUARD_HMAC_KEY      --config serverless/cloudflare/wrangler.preproduction.jsonc
npx wrangler secret put TURNSTILE_SECRET_KEY --config serverless/cloudflare/wrangler.preproduction.jsonc
npx wrangler secret put BREVO_API_KEY        --config serverless/cloudflare/wrangler.preproduction.jsonc

# 4. Contrôle sans déploiement.
npx wrangler deploy --config serverless/cloudflare/wrangler.preproduction.jsonc --dry-run
```

Le gabarit de préproduction ne porte volontairement ni `d1_databases`, ni
`routes`, ni `ALLOWED_ORIGIN` : les identifiants réels et l'origine sont
ajoutés au moment de la création, hors dépôt.

---

## 5. Configuration de production

```sh
python quality/scripts/render_production_wrangler.py \
  --database-id       <UUID CONVERSION_DB> \
  --leads-database-id <UUID LEADS_DB>
```

Les deux identifiants sont exigés, doivent être des UUID réels et distincts.
Le fichier produit n'est pas versionné. Les options `--leads`, `--events`,
`--turnstile`, `--indexable`, `--route`, `--retention-days` restent fermées par
défaut : chacune est un choix explicite.

---

## 6. Tests

```sh
npm test                                   # pipeline, stockage, Turnstile, journal
python -m unittest discover -s quality/tests
python quality/scripts/build_production_dist.py --indexable --leads --events --privacy-simulation
npx wrangler deploy --config serverless/cloudflare/.wrangler-production.generated.json --dry-run
```

Aucun appel externe réel n'est effectué : Brevo et Turnstile sont injectés.

---

## 7. Verrou de confidentialité

`quality/privacy-approval.json` sépare les faits techniques prouvés par le code
des affirmations juridiques qui restent à valider. Tant que `approved` vaut
`false`, un artefact de production **indexable** est refusé. `--privacy-simulation`
produit un artefact de test, marqué non publiable dans
`quality/reports/production-build-mode.json`.

---

## 8. Ordre d'activation

Chaque étape est un GO distinct. Aucune n'est enchaînée automatiquement.

1. Créer les deux bases D1 et appliquer les deux schémas.
2. Poser les secrets.
3. Déployer le Worker, toutes options fermées.
4. Vérifier `/api/health`.
5. Ouvrir `EVENTS_ENABLED` ; contrôler les agrégats.
6. Ouvrir `TURNSTILE_ENABLED` (site key côté navigateur dans ce profil seulement).
7. Ouvrir `LEADS_ENABLED` ; contrôler l'enregistrement, l'accusé, la notification.
8. Valider les mentions de confidentialité, puis `PUBLIC_INDEXABLE` et la route.

La lettre de veille reste fermée : elle demande un canal de double opt-in
complet, non implémenté.

---

## 8 bis. Reprise d'une diffusion incomplète

`serverless/bluewave-leads/replay.mjs` rejoue **uniquement** les étapes dont le
statut n'est pas `OK`. Une étape déjà aboutie n'est jamais réexpédiée : aucun
demandeur ne reçoit deux accusés. Une demande `DELIVERED` n'est pas rejouée.

Le mode par défaut est l'annonce : la reprise dit ce qu'elle ferait sans rien
envoyer. Un envoi réel demande `dryRun: false`, un appel explicite
d'exploitation. Aucune route ne mène à ce module.

Identifier les demandes à reprendre :

```sql
SELECT id, created_at, delivery_status, brevo_contact_status, ack_status,
       notification_status, last_error_code
FROM lead_records
WHERE delivery_status IN ('PARTIAL_FAILURE','FAILED')
ORDER BY created_at DESC;
```

Un `delivery_status_write_failed` au journal signale le cas particulier où les
envois ont pu aboutir sans que les statuts aient pu être écrits : la ligne
paraît alors moins avancée qu'elle ne l'est. Vérifier côté Brevo avant de
rejouer, pour ne pas provoquer un second accusé.

## 8 ter. Opérations sur les données

`serverless/bluewave-leads/data-rights.mjs` fournit les opérations internes :
retrouver les demandes d'une adresse, exporter une demande (charge métier
désérialisée, sans empreinte technique ni identifiant de corrélation),
anonymiser une demande. L'anonymisation retire l'identité et la matière libre
et conserve la qualification et les statuts, pour que la ligne reste
comptable d'un traitement. Chaque opération est journalisée sans donnée
personnelle. Aucune route publique n'y mène.

## 9. Ordre de repli

| Niveau | Action | Effet |
| --- | --- | --- |
| A | `LEADS_ENABLED=false` | `/api/leads` répond 503 ; le site reste servi |
| B | `EVENTS_ENABLED=false` | plus aucune écriture d'agrégat |
| C | `TURNSTILE_ENABLED=false` | la vérification est sautée, le formulaire reste gardé |
| D | retirer la route du Worker | le domaine ne pointe plus sur le Worker |
| E | rétablir le routage web antérieur | retour à l'hébergement précédent |

Les enregistrements `MX`, `SPF`, `DKIM` et `DMARC` ne sont **jamais** modifiés
pendant un repli : ils relèvent d'un mandat distinct concernant la messagerie.

### Pendant et après un incident

- Les demandes déjà enregistrées **restent en base** : un repli ferme l'entrée,
  il ne supprime rien. Aucune purge n'est déclenchée par un repli.
- Les demandes en `PARTIAL_FAILURE` ou `FAILED` restent à reprendre et le
  demeurent après le repli : la liste ci-dessus les retrouve.
- Reprendre **après** rétablissement, pas pendant : rejouer vers un service
  encore instable produirait de nouveaux échecs partiels. Commencer par
  l'annonce (mode par défaut), contrôler la liste des étapes, puis exécuter.
- Si `LEADS_ENABLED` est refermé, les demandes déjà stockées peuvent toujours
  être rejouées : la reprise ne dépend pas de l'ouverture du formulaire.

---

## 10. Points nécessitant une décision

| Sujet | État | Décision attendue |
| --- | --- | --- |
| Durée de conservation des demandes | `LEAD_RETENTION_DAYS` vide ; sélection, purge, compteur et journal prêts et testés | fixer la durée, puis ajuster les mentions |
| Affirmations juridiques | recensées, non validées | valider ou réécrire, puis passer `approved` à `true` |
| Lettre de veille | jeton signé, expiration, anti-rejeu, confirmation et révocation implémentés et testés ; interface fournisseur sans implémentation | choisir le fournisseur d'envoi et le modèle de courriel de confirmation |
| Objets Brevo | inventoriés, non créés | créer et fournir les identifiants |
| Ressources Cloudflare | aucune | créer bases, secrets, Turnstile, route |
| Immatriculation | « SASU en cours de constitution » | compléter les mentions sur justificatifs |

---

## 11. Messagerie — contrôles avant mise en service

Préparation à faire, hors de ce dépôt. Aucun enregistrement DNS n'est modifié
ici et aucune valeur n'est inventée.

| Point | État | À fournir |
| --- | --- | --- |
| Expéditeur vérifié chez Brevo | non fait | adresse d'envoi validée |
| Reply-to | non fait | adresse de réponse |
| Domaine d'expédition | non fait | domaine retenu |
| SPF | non vérifié | enregistrement du domaine d'envoi |
| DKIM | non vérifié | clé publiée par le prestataire |
| DMARC | non vérifié | politique choisie |
| Test de délivrabilité | non fait | envoi de contrôle vers plusieurs messageries |
| Modèle d'accusé | non créé | identifiant de modèle |
| Modèle de notification interne | non créé | identifiant de modèle |

Ces points relèvent d'un mandat messagerie distinct du site. Ils ne sont pas
touchés par un repli web.

## 12. Observabilité

Le journal distingue : `lead_rejected`, `lead_stored`, `lead_duplicate`,
`lead_storage_failed`, `turnstile_failed`, `brevo_contact_failed`,
`ack_failed`, `internal_notification_failed`, `delivery_status_write_failed`,
`event_storage_failed`, `lead_purged`, `lead_purge_failed`, `replay_started`,
`replay_failed`, `data_rights_operation`. Chaque ligne porte un `correlation_id`
tiré au hasard, sans lien avec une personne. Aucune identité, aucun texte libre,
aucun jeton, aucune clé n'y figure : les clés interdites sont écartées à la
construction, et les valeurs non fermées ne sont pas écrites.

Le contrôle de disponibilité `/api/health` ne répond que `available` ou
`unavailable`. Il calcule la disponibilité réelle des services **activés** :
un service fermé n'a rien à prouver, un service ouvert doit avoir sa base, sa
garde, son origine et sa configuration d'envoi. Les motifs restent internes et
ne sont jamais servis.
