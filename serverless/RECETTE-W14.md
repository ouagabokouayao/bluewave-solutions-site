# Recette indépendante W14

W14 exécute cette recette à la main, sur le commit annoncé dans le rapport de livraison. Rien ici ne se lance tout seul.

Rien de ce qui suit ne publie, ne déploie, ne modifie le DNS, ne collecte ni n'envoie. Les essais marqués « GO Joseph » restent à part.

## 1. Préparation

```sh
git fetch origin
git checkout <COMMIT_LIVRÉ>
npm ci
npm i --no-save --no-audit --no-fund playwright@1.56.0 axe-core@4.10.3
npx playwright install chromium
python quality/scripts/build_dist.py
```

## 2. Chaîne automatique

```sh
npm test
python -m unittest discover -s quality/tests -p 'test_production.py'
python quality/scripts/check_home_conservation.py
python quality/scripts/update_manifest.py --check
python quality/scripts/build_production_dist.py --leads --privacy-simulation
node quality/tests/lead-api.e2e.mjs dist-production
python quality/scripts/build_production_dist.py --leads --newsletter --privacy-simulation
node quality/tests/newsletter.e2e.mjs dist-production
python quality/scripts/build_production_dist.py
python quality/scripts/check_profile.py A
node quality/tests/newsletter-retrait.e2e.mjs dist-production
```

Les essais navigateur passent par le vrai Worker, la vraie garde anti-abus sur un stockage en mémoire et une vraie base D1 locale. Brevo y est simulé, et toute autre sortie réseau fait échouer le test.

## 3. Scénarios

Le résultat se note PASS, FAIL ou BLOQUÉ. W14 est libre de reproduire chaque cas avec ses propres outils.

| Réf. | Scénario | Résultat attendu | Preuve automatique | W14 |
|---|---|---|---|---|
| R1 | Quatre parcours réels : collaboration (deux branches), formation, projet, qualification | 201, une ligne en base, trois appels Brevo simulés | `lead-api.e2e.mjs` | |
| R2 | Réponse perdue, reprise après plus de 5 minutes | 200 à la reprise, une ligne, un accusé | `lead-api.e2e.mjs` | |
| R2 bis | Panne D1, première requête 503, puis relance immédiate du même envoi | 503 sans ligne ni appel Brevo, puis 201, une ligne, un accusé, aucun 409 | `lead-api.e2e.mjs`, `pipeline.test.mjs` | |
| R3 | Réponse perdue, reprise après minuit UTC | 200 à la reprise, une ligne, un accusé | `lead-api.e2e.mjs` | |
| R4 | Page rechargée et formulaire ressaisi le lendemain | 200, une ligne, un accusé | `lead-api.e2e.mjs` | |
| R5 | Même demande avec un seul territoire modifié | 201, deux lignes, deux accusés | `lead-api.e2e.mjs`, `pipeline.test.mjs` | |
| R6 | Contenu identique après 30 jours | Nouvelle demande, ancienne ligne conservée | `lead-store.test.mjs` | |
| R7 | Brevo accepte l'accusé, sa réponse se perd | État `UNCERTAIN`, aucun second appel à la reprise | `lead-api.e2e.mjs`, `uncertain-delivery.test.mjs` | |
| R8 | Preuve chez Brevo pour une étape incertaine | Étape `OK`, aucun envoi | `uncertain-delivery.test.mjs` | |
| R9 | Pas de preuve, ou preuve d'une autre demande | `reconciliation_required`, aucun envoi | `uncertain-delivery.test.mjs` | |
| R10 | Décision humaine `confirmedNotSent` | Un seul renvoi, même clé, même repère | `uncertain-delivery.test.mjs` | |
| R11 | Arrêt brutal entre l'envoi et l'écriture du statut | Étape en `SENDING`, jamais rejouée sans preuve | `uncertain-delivery.test.mjs` | |
| R12 | `/bluewave-solutions-site` et `/bluewave-solutions-site/` | 308 vers la racine, requête conservée | `production.test.mjs` | |
| R13 | Inscriptions fermées, ancien abonné avec son lien | Désinscription effective en base et chez Brevo | `newsletter-retrait.e2e.mjs` | |
| R14 | Inscriptions fermées, inscription forcée sur l'API | 503, rien en base | `newsletter-retrait.e2e.mjs` | |
| R15 | Profil A sans base, lien de retrait | Recours manuel affiché, aucune erreur brute | `newsletter-retrait.e2e.mjs` | |
| R16 | Retrait bloqué depuis plus de 24 h | `sync_alert` avec ancienneté, tentatives et cause ; tâche en échec | `newsletter-route.test.mjs` | |
| R17 | Diffusion de demande incomplète depuis plus de 24 h | `lead_delivery_backlog`, `sync_alert`, tâche en échec | `newsletter-route.test.mjs` | |
| R18 | Lien de confirmation rejoué entre deux instances | Une seule inscription | `newsletter.test.mjs` | |
| R19 | Textes de 02 : nom, fréquence, zones, rubriques, libellés, mention de fermeture | Présents, « Lettre de veille BlueWave » absent | `test_production.py` | |
| R20 | Fusion de `main` | Formulaire hérité absent, manifeste synchronisé | `update_manifest.py --check` | |
| R21 | Profil fermé | `noindex`, interrupteurs à `false`, aucun formulaire de veille | `check_profile.py A` | |
| R22 | `quality/privacy-approval.json` | `approved:false` | Lecture directe | |

## 4. Essais sur compte Brevo de test (GO Joseph)

Ces points ne peuvent pas être prouvés en simulation. Ils demandent un compte de test, une adresse de test et une autorisation.

| Réf. | Point à vérifier |
|---|---|
| B1 | L'en-tête `idempotencyKey` est accepté sur `POST /v3/smtp/email` pour un envoi simple, avec cette casse exacte |
| B2 | Un second envoi avec la même clé renvoie bien `duplicate_parameter` pendant 30 minutes, et rien ne part |
| B3 | Le repère posé dans `tags` revient dans `GET /v3/smtp/statistics/events`, filtrable, dans le champ `tag` |
| B4 | Le délai d'apparition de l'événement `requests` |
| B5 | `PUT /v3/contacts/{email}` avec `unlinkListIds` : 204, puis rejouable sans erreur, 404 si le contact n'existe pas |
| B6 | Le modèle de confirmation lit `{{ params.confirmation_url }}` |
| B7 | Une désinscription par le lien propre à Brevo laisse `NEWSLETTER_DB` en retard : à traiter avant toute campagne |

## 5. Infrastructure, sous la responsabilité de W14

- Export et comparaison de la zone OVH et de la zone Cloudflare, enregistrements MX compris.
- État de DNSSEC avant et après tout changement de serveurs de noms.
- Certificat HTTPS de `www.bluewavesolutions.fr` et redirection de l'apex.
- Retrait ou redirection de la publication GitHub Pages après la migration officielle.
- Notification Cloudflare sur l'échec de la tâche planifiée.

Aucun de ces points n'est traité par le code de cette branche. `https://www.bluewavesolutions.fr/` reste l'origine canonique du build et du Worker.
