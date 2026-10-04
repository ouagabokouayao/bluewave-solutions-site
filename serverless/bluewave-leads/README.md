# Endpoint sécurisé BlueWave → Brevo

Ce dossier prépare un endpoint serverless portable. Il n’est ni déployé ni relié au site tant que
`data/automation-config.json` conserve `"lead_endpoint": null`. Le navigateur appelle uniquement cet
endpoint HTTPS ; seul le runtime serveur contacte Brevo.

## Contrat HTTP

`POST /bluewave-leads`, avec `Content-Type: application/json` :

```json
{
  "journey": "projet",
  "source_offer": "diagnostic-strategique",
  "recommended_offer": "atelier-cadrage",
  "lead_type": "projet-mission",
  "organisation_type": "collectivite",
  "territory": "cote-divoire",
  "need_category": "projet",
  "stage": "initial",
  "data_availability": "incertain",
  "desired_outcome": "structurer",
  "firstname": "",
  "lastname": "",
  "email": "",
  "organisation": "",
  "need": "",
  "deadline": "",
  "contact_preference": "",
  "newsletter_optin_request": false,
  "privacy_acknowledged": true
}
```

Le champ technique `website` est un honeypot et `captcha_token` réserve l’intégration future d’un
CAPTCHA/Turnstile. Le serveur contrôle les types, les champs obligatoires, l’e-mail, les longueurs,
la taille totale (16 Kio), l’origine, le débit et les doublons rapprochés. Les erreurs restent
génériques et ne renvoient ni trace, ni configuration, ni réponse Brevo brute.

## Variables privées

Copier `.env.example` dans le gestionnaire de secrets du fournisseur, jamais dans Git :

- `BREVO_API_KEY` ;
- `BREVO_LEADS_LIST_ID` ;
- `BREVO_ACK_TEMPLATE_ID` ;
- `BREVO_INTERNAL_TEMPLATE_ID` ;
- `BLUEWAVE_INTERNAL_EMAIL` ;
- `ALLOWED_ORIGIN`, origine HTTPS exacte autorisée, sans chemin ni barre finale ;
- `BREVO_FOLLOWUP_TEMPLATE_ID`, optionnelle et non utilisée avant validation de la relance.

Aucun identifiant de liste ou de modèle n’est fixé dans le code. `BLUEWAVE_SITE_URL` peut être ajouté
par l’adaptateur d’hébergement si les liens des modèles diffèrent de l’origine autorisée.

## Correspondance Brevo

La création de contact utilise l’e-mail comme identifiant, `updateEnabled: true` et la liste Leads.
Les attributs à créer dans le compte Brevo sont :

| Attribut | Valeur |
|---|---|
| `BW_TYPE` | type de demande |
| `BW_GEO` | géographie |
| `BW_THEME` | thématiques séparées par ` | ` |
| `BW_ORGANISATION` | organisation |
| `BW_BESOIN` | besoin |
| `BW_DELAI` | délai |
| `BW_SOURCE` | `SITE_FORMS` (adaptateur serveur) |
| `BW_STATUT` | `NOUVEAU` |

`FIRSTNAME` et `LASTNAME` utilisent les attributs standards du contact. Une demande commerciale
n’ajoute jamais directement le contact à une liste newsletter. Le futur parcours de veille sera
séparé : demande d’inscription, validation de l’adresse, double opt-in, puis inscription après confirmation.

## Modèles transactionnels à configurer dans Brevo

Accusé — objet : **Votre demande a bien été reçue — BlueWave Solutions**.

> Bonjour {{params.firstname}},
>
> Merci pour votre message adressé à BlueWave Solutions.
>
> Votre demande concernant {{params.theme}} a bien été reçue. Elle sera examinée afin d’identifier
> le format d’échange ou d’accompagnement le plus pertinent.
>
> BlueWave Solutions est un bureau d’études, de conseil et de recherche appliquée spécialisé dans
> les enjeux de mer, de littoral et de gouvernance maritime.
>
> Vous pouvez répondre directement à cet email si vous souhaitez apporter un complément utile.
>
> Bien cordialement,
>
> BlueWave Solutions
> Conseil · Études · Recherche · Innovation

Le modèle reçoit aussi `type`, `organisation`, `solutions_url`, `method_url` et `evidence_url`.
Configurer son expéditeur vérifié et son adresse de réponse dans Brevo.

Notification interne — objet :
`Nouveau lead BlueWave — {{type}} — {{organisation}} — {{geography}}`.
Le modèle reçoit uniquement : nom, organisation, e-mail, type, géographie, thématiques, besoin,
délai, préférence de contact, consentement veille et source.

## Automatisations externes à préparer

1. **A — arrivée d’un lead.** Déclencheur : ajout à `BLUEWAVE — Leads site`. État initial :
   `BW_STATUT=NOUVEAU`.
2. **B — relance mesurée.** Après un délai J+3/J+5 configurable, uniquement si le statut est encore
   `NOUVEAU` ou `A_QUALIFIER`. Stopper dès `QUALIFIE`, `RDV`, `PROPOSITION`, `MISSION` ou `CLOS`.
3. **C — veille.** La liste `BLUEWAVE — Veille & actualités` reste un parcours newsletter indépendant.

Aucune séquence de relance n’est exécutée par ce dépôt.

## Chat, rendez-vous et hébergement

Le chat reste désactivé. Récupérer le snippet réel dans Brevo → Paramètres → Boîte de réception /
Inbox → Widget de chat → installation manuelle, puis le faire valider avant insertion. Ne jamais
inventer ce snippet.

`meeting_url` reste `null` jusqu’à fourniture d’une URL réelle. Le lien n’apparaîtra qu’après une
transmission réussie.

Le handler repose sur les API Web `Request`, `Response` et `fetch`. Un adaptateur très mince peut
l’exposer dans Cloudflare Workers, Netlify Functions, Vercel Functions ou un autre runtime serverless.
Le garde anti-abus en mémoire convient aux tests et à une instance isolée ; en production, injecter
un stockage distribué propre au fournisseur pour le rate limiting et la déduplication, puis brancher
un vérificateur Turnstile via `captchaVerifier` si nécessaire. Aucun fournisseur n’est retenu ici.

## Tests locaux

```bash
node --test serverless/bluewave-leads/tests/handler.test.mjs
```

Les tests injectent un faux transport HTTP. Ils ne contactent jamais Brevo.

## Adaptateur préparé Cloudflare

Dans la cible, l'URL est `/api/leads` sur la même origine HTTPS que le site ; le chemin `/bluewave-leads` ci-dessus décrit seulement le handler portable historique. Le Worker bloque l'API lorsque `LEADS_ENABLED` n'est pas `true`. `GUARD_HMAC_KEY` (32 caractères minimum) et le binding `LEAD_GUARD` protègent le débit et les doublons sans stocker d'IP brute. `NEWSLETTER_ENABLED=false` rejette une demande forgée avec consentement newsletter ; aucun attribut de consentement false ne doit écraser un consentement ancien dans Brevo. Une erreur dans la suite upsert/accusé/notification peut nécessiter un rapprochement manuel avant nouvel envoi.

Configuration privée nécessaire pour une future recette : `BREVO_API_KEY`, `BREVO_LEADS_LIST_ID`, `BREVO_ACK_TEMPLATE_ID`, `BREVO_INTERNAL_TEMPLATE_ID`, `BLUEWAVE_INTERNAL_EMAIL`, `ALLOWED_ORIGIN`, et optionnellement `BREVO_FOLLOWUP_TEMPLATE_ID` non utilisé. `BLUEWAVE_SITE_URL` définit la base des liens si elle diffère de l'origine. Brevo requiert des listes, modèles, attributs et identité d'expéditeur préalablement configurés dans le compte. Voir `serverless/cloudflare/README.md` pour le contrôle de l'activation et du rollback.
