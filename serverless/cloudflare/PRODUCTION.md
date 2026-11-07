# BlueWave — activation contrôlée du profil de production

Le commit de préparation ne publie rien. `wrangler.production.jsonc` est distinct du Preview, ferme les flags et ne contient ni route ni identifiant D1. Le domaine `bluewavesolutions.fr` est détenu chez OVH : statut ACTIVE au registre, expiration le 29 septembre 2027, zone sauvegardée le 6 novembre 2026 (`serverless/DNS-MATRICE.md`). Le site n'y est pas publié : `www` sert la page d'accueil OVH en HTTP, sans certificat HTTPS.

Les deux configurations de publication sont décrites dans `serverless/PROFILS.md` : profil A sans collecte, profil B avec automatisation.

## Conditions de départ

- `main` et branche du candidat vérifiés ; CI du SHA final PASS ; Preview du même SHA PASS.
- Source réelle de GitHub Pages vérifiée dans les réglages (un merge ne doit pas publier automatiquement la V3.4).
- Domaine détenu (fait) ; DNSSEC traité avant toute délégation ; zone Cloudflare, HTTPS et hôte `www.bluewavesolutions.fr` établis ; apex redirigé HTTPS vers `www` sans toucher à MX/SPF/DKIM/DMARC.
- Ressources **production séparées** : Worker `bluewave-site-production`, D1 `bluewave-conversions-production`, classe SQLite DO `LeadGuard` propre au script. Jamais de binding Preview.
- Textes légaux du rendu final contrôlés par le responsable ; contrats des prestataires, transferts et durée des journaux confirmés.
- Coût et plan de compte lus avant toute souscription ; aucun upgrade automatique.

## Construction et profils

1. `npm ci && npm run build` produit `dist/` Preview fermé et contrôlé.
2. `python quality/scripts/build_production_dist.py` produit `dist-production/` fermé avec canonical `www` et politique de production. Le profil public indexable utilise `--indexable`; les flux n'y sont activés que par `--leads`, `--events`, `--traffic-token` et une liste fermée `--campaign code`.
3. Les valeurs doivent être cohérentes entre le build client et Wrangler. `python quality/scripts/render_production_wrangler.py --database-id UUID` crée un fichier **ignoré par Git**, avec binding D1. N'ajouter `--route`, `--indexable`, `--leads`, `--events` qu'après accord, tests et secret(s) installés ; `NEWSLETTER_ENABLED=false` reste obligatoire. L’ouverture des demandes requiert aussi une durée de conservation approuvée (`--retention-days`), une base D1 Leads et une configuration prête.
4. `npx wrangler deploy --config serverless/cloudflare/.wrangler-production.generated.json --dry-run` vérifie l'assemblage ; `--dry-run` n'envoie rien.
5. Le déploiement réel, les routes et la bascule DNS n'ont lieu qu'après GO. Une URL `workers.dev` n'est pas ouverte implicitement.

Le profil production `--indexable` produit les 21 pages sur la nouvelle origine, `404.html` non indexable, `robots.txt` ouvert, un sitemap de 16 URL canoniques, canonical et OG corrigés, image de partage 1200×630 et données structurées Organization/WebSite sur l’accueil (faits publiés uniquement). Le Worker ajoute `X-Robots-Tag: index, follow` aux réponses publiques réussies uniquement si `PUBLIC_INDEXABLE=true`; les erreurs/404 restent noindex. Le profil fermé conserve `Disallow: /` et aucun beacon ni endpoint client.

## Paramètres Brevo et contrôle des erreurs

Secrets Cloudflare serveur uniquement : `BREVO_API_KEY`, `GUARD_HMAC_KEY` (minimum 32 caractères). Paramètres de compte : `BREVO_LEADS_LIST_ID`, `BREVO_ACK_TEMPLATE_ID`, `BREVO_INTERNAL_TEMPLATE_ID`, `BLUEWAVE_INTERNAL_EMAIL`; origine autorisée `https://www.bluewavesolutions.fr`. `BREVO_FOLLOWUP_TEMPLATE_ID` reste inutilisé. La lettre de veille a ses propres paramètres, décrits dans `serverless/PROFILS.md`. Vérifier liste Leads, attributs `BW_TYPE`, `BW_GEO`, `BW_THEME`, `BW_ORGANISATION`, `BW_BESOIN`, `BW_DELAI`, `BW_SOURCE`, `BW_STATUT`, modèle accusé, modèle notification, expéditeur et reply-to. Aucun envoi marketing.

Après une issue inconnue chez Brevo (`UNCERTAIN`), **ne pas renvoyer automatiquement** : suivre le rapprochement décrit dans `serverless/OPERATIONS.md`. Vérifier dans Brevo : contact (e-mail comme clé), accusé et notification ; corréler heure et statut sans exporter de contenu libre dans les logs ; envoyer seulement le message manquant après contrôle humain, puis mettre le dossier au statut qualifié. Une nouvelle soumission identique retombe sur la demande existante, sans rien réexpédier. Lors d'une demande d'effacement valide, retirer le contact et les données associées dans Brevo selon les procédures de compte, confirmer la réponse et conserver uniquement la trace minimale nécessaire.

## Conversion, purge et surveillance

Appliquer `schema.sql` à la base D1 production avant `EVENTS_ENABLED=true`. `/api/events` accepte uniquement les énumérations du module client ; D1 conserve jour/dimensions/compteurs sans IP, texte libre ou identifiant de visiteur. Le déclencheur quotidien à 03:00 UTC supprime les lignes antérieures à treize mois calendaires. Vérifier le nombre de lignes restantes et les erreurs du déclencheur ; pas de suppression D1/DO durant un rollback. La garde DO stocke des clés HMAC temporaires et déclenche une alarme de nettoyage. Ne pas loguer les corps de leads ni clés API.

À H+1/H+24/J+7 : pages et assets, 4xx/5xx/429, seuil Worker, erreurs D1/DO, horodatage de purge, événements agrégés, tentatives/succès/fallback, délivrabilité Brevo, canonical/robots et coûts. Le réglage `run_worker_first:true` compte les assets dans le quota de requêtes Worker ; surveiller et revoir la stratégie avant dépassement du forfait gratuit.

## Rollback

Mettre les flags leads/events OFF, revenir à la version Worker antérieure compatible, supprimer la route publique si nécessaire, restaurer les valeurs DNS web relevées avant bascule, conserver tous les enregistrements mail, vérifier HTTPS et les pages GitHub Pages. Le retour DNS peut prendre du temps. Les contacts/e-mails déjà traités et D1 ne sont pas annulés par un rollback : rapprocher les demandes reçues pendant l'incident. Ne jamais réécrire `main` ni supprimer une base pour revenir en arrière.
