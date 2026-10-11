# A01 — Interfaces internes, préproduction OFF

Base : `982fa9eebd80e680e887fc68f17135f2ac9bbfd5`. Contrats source : dossier
Automation Readiness et Interfaces 02/W14 de 07, 11/10/2026. Delta complémentaire 02 retrouvé et contrôlé : `BlueWave_C01_A01_Delta_Preparation_2026-10-11.zip`,
SHA-256 `c852a6e34d8c93e3f51ecc93d7560667e9189a95f7c9fb7f92dff932ac9ee249`.
Ses prototypes ont été audités et adaptés ; ils n'ont pas été installés ni leurs tests recopiés.

## Exécution locale

- `node serverless/a01/inventory.mjs` : inventaire source et présence locale des accès,
  jamais leurs valeurs. Le runtime distant et les sauvegardes restent NON VÉRIFIÉS.
- `node --test serverless/bluewave-leads/tests/a01.test.mjs` : intégration synthétique,
  moteur D1 local Miniflare, HTTP Request du handler et transport Brevo simulé.
- `npm test` : régressions et intégration A01.
- `node serverless/a01/prepare.mjs report input.json /tmp/report.json` : agrégats.
- `node serverless/a01/prepare.mjs schedule input.json /tmp/schedule.json` : plan DRY RUN.
- `node serverless/a01/prepare.mjs handoff input.json /tmp/handoff.json` :
  file de revue sans identité par défaut, créée hors dépôt en mode 0600, jamais écrite au CRM maître.
  L'option `--sensitive-handoff` exige en plus `contact_access_approved_by=03` dans l'entrée ;
  utiliser seulement après approbation réelle 03 de l'accès nominatif.
- `node serverless/a01/prepare.mjs calendar calendrier.csv /tmp/calendar.json` :
  interface du CSV C01 original, sans modification ni programmation.
  Fichier de sortie neuf obligatoire ; ne pas placer un export dans le dépôt public.

Les entrées CLI sont celles des fonctions `buildReport`, `prepareSchedule` et
`prepareHandoff` : lire leurs contrats, aucun nouveau fournisseur n'est requis.
Aucun client HTTP dans ces interfaces. Aucune route publique n'expose les exports.
Les modules et schémas de `serverless/` sont exclus du build public.

## T02-01 — Inventaire

Trois profils Wrangler et flags OFF, D1/DO déclarés, frontend et accès locaux
contrôlés par `inventory.mjs`. L'absence d'accès local ne prouve pas l'absence d'un
secret dans Cloudflare. Compte, ressources effectives, isolation des environnements,
IDs Brevo, délivrabilité, sauvegarde/restauration : accès de lecture manquant.
Aucune connexion ni installation de secret effectuée.

## T02-02 — Provenance

`acquisition_source`, `campaign_code`, `landing_page` passent par une allowlist
commune puis serveur (`ALLOWED_CAMPAIGNS`). Source/campagne/page inconnues sont
neutralisées, la demande valide est conservée. Stockage JSON `journey_payload`
compatible avec les bases existantes : aucune migration ni nouveau binding.
La provenance est exclue de l'empreinte métier : une autre UTM ne crée pas de doublon.
Le front conserve les codes dans les liens internes et `bw_landing`, sans cookie,
identifiant de session, email, IP ou copie de query complète. L'offre et l'ancre
sont conservées. Aucun paramètre ne passe aux liens externes.
Il s'agit d'une attribution déclarative admissible, pas d'une preuve authentifiée
qu'une visite vient effectivement du réseau annoncé. Les statistiques anonymes
ne contiennent jamais de `lead_id`. Aucun changement d'allowlist ni tracking actif.

## T02-03 — Parcours

Projet, Organisation, Expertise, Formation et sortie de qualification testés sur
D1 natif local. Tests 201, 400, 403, 409, 429, 503, échec partiel Brevo, idempotence
D1 après perte de garde, reprise ciblée et absence de double ACK. Le front OFF
n'émet pas de POST ; le mailto reste une préparation de courriel, pas une réception.
La QA visuelle des pages validées n'est pas refaite ; aucun HTML/CSS modifié.
Ce lot ne prétend pas avoir rejoué l'E2E distant du 07/10.

## T02-04 — Revue 03

`prepareHandoff` est fermé par défaut et exclut les coordonnées/besoins libres. Clé `lead_id` stable/unique, revue en attente,
coordonnées et besoin seulement sur option avec approbation 03, aucune promotion ou écriture CRM.
`validateHumanReview` exige décision 03, horodatage, preuve et prochaine action
pour N0–N8 ; N5–N8 exigent preuve de besoin ; N9 exige contrat et date.
Mapping proposé : identité → contact, organisation → acteur à rapprocher par 03,
lead_id → clé externe de revue, created_at → reçu le, journey/lead_type → origine
métier, provenance → codes d'acquisition, décision/next_action_at → suivi humain.
Aucun acteur CRM créé automatiquement. La version maître et les colonnes finales
restent à valider par 03, sans lecture ou redistribution de personnes réelles.

## T02-05 — Incident, reprise, arrêt

`classifyIncident` qualifie les codes existants. `createIncidentLogger` raccorde
le journal du handler à un canal injectable de test, avec `flush` explicite.
`createTestAlertSink` limite la répétition (300 s par code/corrélation), n'acquitte
pas une panne de transport, permet la reprise ; pas de notification réseau.
Canal réel, destinataire, seuils d'astreinte et réception distante : à valider 02/07.

Runbook :
1. Stockage indisponible : CRITICAL, STOP_LEADS, conserver les bases.
2. PARTIAL_FAILURE : garder la demande ; alerte MAJOR avec codes seulement.
3. Lire l'état des trois étapes ; exécuter `replayDelivery(db,id)` en DRY RUN.
4. Si écriture de statuts échouée ou état ambigu, vérifier les envois côté Brevo
   avant toute reprise ; ne jamais croire qu'un statut PENDING prouve un non-envoi.
5. Reprise réelle uniquement ciblée, après arbitrage d'exploitation et contrôle
   fournisseur ; ici test mocké seulement, jamais d'ACK déjà OK réexpédié.
6. `stopPlan` propose les flags OFF de façon indépendante ; aucun déploiement,
   suppression, changement DNS ou modification de secret n'est exécuté.

Limite existante conservée : le replay n'est pas un verrou distribué contre deux
opérateurs simultanés. Un seul opérateur, aucun replay concurrent ; ambiguïté
fournisseur et panne de statut imposent rapprochement humain, pas une relance aveugle.

## T02-06 — Interface C01

Contrat de ligne : content_id, version_hash, networks, assets/rights_approved,
status, reviewer, approved_at, approved_hash, source/campaign_code, destination,
scheduled_at, scheduled_id. DRAFT→REVIEW→APPROVED ; la validation 02 est liée au hash.
Une nouvelle version révoque l'approbation et remet DRAFT. Le plan exige aussi GO
Joseph lié à la version/contenu/comptes, comptes autorisés et switch explicite.
Sans compte connecté, le plan se construit et reste bloqué pour l'exécution.
Même autorisé dans la simulation : DRY_RUN, scheduled_id=null, zéro API appelée.
Un scheduled_id existant et les doublons de contenu/version/réseau sont refusés.
Le calendrier, les contenus et les créations de 02 ne sont pas recréés.
`calendar.mjs` lit les 12 colonnes du CSV C01 original (33 lignes), conserve chaque
valeur/source et date indicative, calcule son SHA-256, initialise DRAFT sans
réseau présumé, version approuvée ou programmation. Le CLI a été exécuté sur le
CSV original inchangé : SHA-256 `3e3442396c94507daea613646334281df6504bfc93ec1bd0c473b8fbf1c9b800`.
Les créations VIS01/VID01 et les règles de légende de 02 restent hors de ce lot code.
Choix de scheduler et preuve d'identité des comptes restent 02 ; aucun coût engagé.

## T02-07 — Newsletter E2E isolée

Le Worker conserve le gate `newsletter_channel_not_implemented`. Aucune route,
transport fournisseur réel ou formulaire public nouveau. `newsletter-test-channel`
exige `testOnly=true`, transport `testOnly=true`, secret synthétique et adresse
`.invalid`. Table dédiée `newsletter_test_consents` séparée des leads/conversions.
Consentement explicite, notice/version/source/horodatage, jeton HMAC existant,
expiration, état durable et claim atomique contre le rejeu/concurrence. Reprise
confirmation avec la même clé fournisseur ; subscription avec clé d'idempotence.
Confirmation nécessaire avant token de gestion, préférences ou désinscription.
Retrait local avant fournisseur ; état REVOKING bloque les préférences, puis
`retryRevocation(consent_id)` pour terminer le retrait en échec. Aucun abonnement
implicite d'un lead. Les préférences de test veille/formations/publications sont
un contrat proposé, à valider 02/04B avant tout choix public.

Limites avant service réel : fournisseur à choisir et idempotence à prouver,
mentions/durées à valider, URLs de gestion/confirmation et authentification à
implémenter sous mandat distinct. Un crash en SENDING/CONFIRMING demande
rapprochement manuel du consent_id ; aucun renvoi aveugle. Token de gestion de test
valide 24 h ; renouvellement authentifié non raccordé. Le transport exige de mettre
à jour les préférences sans réabonner un consentement retiré. Newsletter reste OFF.

## T02-08 — Reporting

Fenêtre UTC explicite, comptes par jour/source/campagne. Événements sans PII,
CTA ≠ visiteurs uniques, mailto exclu des demandes ; dédupliquer les lead_id.
Revue 03 fournie séparément et validée, dernière décision connue à fin de fenêtre,
N9 retiré du pipeline N5–N8, contrat prouvé ≠ CA encaissé. Aucun taux de cohorte
ou revenu fabriqué. Coûts prouvés par 01B en unités mineures, sans joindre d'identité.
Les données de travail nominatives servent seulement à produire des comptes ;
aucun lead_id/nom/email/besoin n'est exporté dans le rapport.
C'est un rapprochement de cohorte agrégée, pas une jointure de visiteurs à personnes.

## Retour arrière

Ne pas merger. Abandonner le candidat A01 et reprendre le SHA de base conservé.
Pour annuler après intégration ultérieure autorisée, utiliser un revert du commit
A01 sur la branche concernée ; jamais reset forcé/main. Aucune migration de base,
activation, route ou secret n'a été appliqué, aucune donnée réelle à restaurer.

## Gates propriétaires

02 : interface et QA du delta C01/A01 retrouvé ; 03 : mapping/revue ; 07 : sécurité et preuves ;
04B : mentions/retention/newsletter avant réel ; 01B : coûts éventuels (aucun ici).
Accès runtime read-only et restauration restent à vérifier. Les preuves locales ne
valent pas preuve de configuration ou livraison distante. Aucun GO production.

## Preuves locales du 11/10/2026

- Baseline avant modification : `npm test`, 124/124, aucun test ignoré.
- Candidat A01 : `npm test`, 143/143, dont 19 cas A01 ; aucun test ignoré.
- Qualité HTML/contenu : 21 pages, zéro erreur/avertissement.
- Préactivation : intégrations distantes désactivées.
- Secret scan : aucune valeur réelle détectée ; les fixtures utilisent uniquement
  des clés synthétiques courtes/répétées et des adresses `.invalid`.
- Build : 63 fichiers servis, zéro fichier interne ; manifeste public vérifié.
- Tests Python production/brand : 26/26.
- `npm run cloudflare:test-runtime` : empaquetage dry-run et workerd local PASS,
  D1/DO, garde persistante/concurrente, APIs OFF, noindex et newsletter gate.
- Aucune écriture fournisseur, donnée réelle, migration distante, CRM maître,
  programmation sociale, newsletter réelle ou production exécutée.

La CI distante doit être consultée sur le SHA effectivement poussé ; le présent
fichier ne prétend pas qu'un commit distant ou un run existe avant le push.
