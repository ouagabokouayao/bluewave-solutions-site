# Objets Brevo à créer — inventaire

Document interne. Aucun identifiant n'est inventé : chaque valeur attendue est
notée `<À FOURNIR PAR ENVIRONNEMENT>`. Une valeur qui ressemblerait à une vraie
donnée de production ne doit jamais apparaître ici.

Brevo reste un carnet de contacts opérationnel et un expéditeur transactionnel.
La source de vérité des demandes est `LEADS_DB`, pas Brevo.

---

## 1. Objets à créer

| Objet | Rôle | Valeur à fournir |
| --- | --- | --- |
| Liste « Leads » | reçoit les contacts issus du formulaire | `BREVO_LEADS_LIST_ID` = `<À FOURNIR PAR ENVIRONNEMENT>` |
| Modèle « accusé de réception » | courriel au demandeur | `BREVO_ACK_TEMPLATE_ID` = `<À FOURNIR PAR ENVIRONNEMENT>` |
| Modèle « notification interne » | courriel à BlueWave | `BREVO_INTERNAL_TEMPLATE_ID` = `<À FOURNIR PAR ENVIRONNEMENT>` |
| Adresse interne | destinataire et reply-to | `BLUEWAVE_INTERNAL_EMAIL` = `<À FOURNIR PAR ENVIRONNEMENT>` |
| Expéditeur vérifié | adresse d'envoi validée chez Brevo | `<À FOURNIR PAR ENVIRONNEMENT>` |
| Clé d'API | secret runtime | `BREVO_API_KEY` = `<À FOURNIR PAR ENVIRONNEMENT>` |
| Domaine d'expédition | authentification des courriels | `<À FOURNIR PAR ENVIRONNEMENT>` |

Les trois identifiants numériques sont contrôlés au démarrage : un entier
positif est exigé, sinon la configuration est refusée.

Le domaine d'expédition relève d'un mandat séparé concernant la messagerie.
Il n'est pas traité par ce lot et ne doit pas être modifié pendant un repli.

---

## 2. Attributs de contact

### Conservés tels quels

`FIRSTNAME`, `LASTNAME`, `BW_TYPE`, `BW_GEO`, `BW_THEME`, `BW_ORGANISATION`,
`BW_DELAI`, `BW_SOURCE`, `BW_STATUT`, `BW_BESOIN`.

### Correspondance avec le schéma P0

| Champ métier | Attribut Brevo | Remarque |
| --- | --- | --- |
| `lead_type` | `BW_TYPE` | déjà en place |
| `territory` | `BW_GEO` | déjà en place |
| `domains` | `BW_THEME` | déjà en place, valeurs jointes |
| `organisation` | `BW_ORGANISATION` | déjà en place |
| `deadline` | `BW_DELAI` | déjà en place |
| `journey` | — | **non ajouté** : déductible de `lead_type` |
| `source_offer` | — | **non ajouté** : exploité en base, pas en routage d'e-mail |
| `recommended_offer` | — | **non ajouté** : idem |
| `need_category` | — | **non ajouté** : recouvre `BW_THEME` |

### Pourquoi ne pas tout recopier

Chaque attribut ajouté doit être créé à la main dans Brevo, maintenu, et
documenté dans la politique de confidentialité comme donnée transmise à un
sous-traitant. Les quatre champs ci-dessus n'apportent rien à l'usage réel de
Brevo — expédier un accusé et retrouver un contact — alors qu'ils sont déjà
requêtables dans `LEADS_DB`. Les recopier transformerait Brevo en copie de la
base métier, ce que l'architecture écarte explicitement.

À réexaminer seulement si un usage concret l'exige : segmentation d'envoi par
parcours, ou tri par offre dans l'interface Brevo.

---

## 3. Ce que Brevo ne reçoit jamais

- Aucun ajout automatique à une liste de veille : une demande commerciale ne
  vaut pas inscription. Le canal de veille suivra un double opt-in séparé.
- Aucun jeton Turnstile, aucune empreinte technique, aucune adresse IP.
- Aucun statut de qualification interne : `BW_STATUT` reste à `NOUVEAU` à la
  création et n'est pas piloté par le pipeline.
