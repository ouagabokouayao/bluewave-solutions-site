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
  │     4. limite de débit et anti-doublon (Durable Object)          │
  │     5. ENREGISTREMENT dans LEADS_DB  ← la demande est acquise    │
  │     6. contact Brevo                                             │
  │     7. accusé de réception                                       │
  │     8. notification interne                                      │
  │     9. consignation des statuts de diffusion                     │
  │                                                                  │
  ├─ POST /api/events ──► CONVERSION_DB : compteurs agrégés, sans donnée
  │                        personnelle, vocabulaire fermé
  │
  └─ GET  /api/health ──► disponibilité seule
```

Les étapes 6 à 8 sont des effets externes. Elles peuvent échouer sans faire
perdre la demande : celle-ci est déjà en base à l'étape 5.

**Brevo n'est pas la base métier.** C'est un carnet de contacts opérationnel et
un expéditeur transactionnel. La source de vérité est `LEADS_DB`.

**Les deux bases ne se mélangent jamais.** `CONVERSION_DB` ne contient aucune
donnée personnelle ; `LEADS_DB` ne contient aucun agrégat d'audience. Aucune
jointure, aucun binding partagé.

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

---

## 10. Points nécessitant une décision

| Sujet | État | Décision attendue |
| --- | --- | --- |
| Durée de conservation des demandes | `LEAD_RETENTION_DAYS` vide | fixer la durée, puis ajuster les mentions |
| Affirmations juridiques | recensées, non validées | valider ou réécrire, puis passer `approved` à `true` |
| Lettre de veille | contrat posé, séquence non implémentée | choisir le fournisseur et le modèle de courriel |
| Objets Brevo | inventoriés, non créés | créer et fournir les identifiants |
| Ressources Cloudflare | aucune | créer bases, secrets, Turnstile, route |
| Immatriculation | « SASU en cours de constitution » | compléter les mentions sur justificatifs |

---

## 11. Observabilité

Le journal distingue : `lead_rejected`, `lead_stored`, `lead_duplicate`,
`brevo_contact_failed`, `ack_failed`, `internal_notification_failed`,
`event_storage_failed`, `lead_purged`. Chaque ligne porte un `correlation_id`
tiré au hasard, sans lien avec une personne. Aucune identité, aucun texte libre,
aucun jeton, aucune clé n'y figure : les clés interdites sont écartées à la
construction, et les valeurs non fermées ne sont pas écrites.

Pour reprendre une diffusion incomplète, interroger `LEADS_DB` :

```sql
SELECT id, created_at, delivery_status, brevo_contact_status, ack_status,
       notification_status, last_error_code
FROM lead_records
WHERE delivery_status IN ('PARTIAL_FAILURE','FAILED')
ORDER BY created_at DESC;
```
