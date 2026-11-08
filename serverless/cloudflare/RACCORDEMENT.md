# Raccordement de bluewavesolutions.fr à Cloudflare

Procédure préparée le 8 novembre 2026. **Aucune étape n'a été exécutée.** Les étapes 2 à 9 demandent chacune l'accord de Joseph : elles agissent sur des comptes ou sur le DNS.

## Point de départ

| Élément | Valeur | Preuve |
|---|---|---|
| Serveurs de noms | `ns111.ovh.net`, `dns111.ovh.net` | `dig NS @d.nic.fr` |
| DNSSEC | **Actif** : DS 14294, algorithme 8, TTL 3600 s au registre `.fr` | `dig DS @d.nic.fr` |
| Zone | Identique à la sauvegarde OVH du 6 novembre (SOA 2092849087) | `serverless/DNS-MATRICE.md` |
| Worker | `bluewave-site-production`, profil A, sans route ni `workers.dev` | `wrangler deploy --dry-run` |

## Pourquoi DNSSEC impose l'ordre

Le registre `.fr` publie un DS qui désigne la clé d'OVH. Si les serveurs de noms passent chez Cloudflare tant que ce DS existe, les résolveurs qui valident DNSSEC refusent toutes les réponses : site **et courriel** deviennent injoignables, pendant au moins la durée de vie du DS. Le DS doit donc disparaître avant la délégation, puis être recréé avec la clé de Cloudflare.

## Contrôle préalable, en lecture seule

```sh
python quality/scripts/dns_preflight.py
python quality/scripts/dns_preflight.py --cible <ns1>.ns.cloudflare.com,<ns2>.ns.cloudflare.com
```

Le script interroge le registre et, avec `--cible`, les serveurs de Cloudflare. Il répond NO GO tant qu'un DS est publié, ou tant que la zone Cloudflare ne sert pas exactement les MX et le SPF de référence. Le 8 novembre 2026, il répond **NO GO** : le DS est présent.

## Procédure

1. **Préparer**, sans effet : `serverless/cloudflare/zone-cible-cloudflare.txt` porte la messagerie à l'identique. `python quality/scripts/compare_dns.py serverless/cloudflare/zone-cible-cloudflare.txt` répond PASS.
2. **Créer la zone** dans Cloudflare, offre gratuite, sans changer les serveurs de noms : elle reste en attente. Importer le fichier de zone. Noter les deux serveurs de noms attribués.
3. **Vérifier la zone en attente** : `dns_preflight.py --cible …` doit afficher OK pour la messagerie servie par Cloudflare.
4. **Désactiver DNSSEC chez OVH**, côté domaine, en conservant la zone OVH.
5. **Attendre le retrait du DS** au registre, puis au moins deux durées de vie (2 × 3600 s). `dns_preflight.py` ne doit plus signaler de DS.
6. **Changer les serveurs de noms** chez OVH (registrar) pour ceux de Cloudflare. C'est la bascule DNS.
7. **Contrôler** depuis plusieurs résolveurs : MX, SPF, résolution de l'apex. Envoyer et recevoir un courriel de test.
8. **Raccorder le site**, dans la foulée de l'étape 7 : commandes ci-dessous. Entre les étapes 6 et 8, `www` ne résout plus. Il sert aujourd'hui la page OVH « Site en construction », donc aucun contenu n'est perdu.
9. **Réactiver DNSSEC** dans Cloudflare, puis publier chez OVH le DS que Cloudflare fournit. Vérifier la chaîne de validation.

## Commandes définitives du site (étape 8)

Elles supposent la zone active chez Cloudflare et un GO de Joseph pour la publication. Le site part en profil A : contact par courriel préparé, aucune collecte, veille fermée, `noindex` partout.

```sh
npm ci
python quality/scripts/build_production_dist.py
python quality/scripts/render_profil_a.py --route
python quality/scripts/check_profile.py A --publication --config serverless/cloudflare/.wrangler/profil-a-publication.generated.json
npx wrangler deploy --config serverless/cloudflare/.wrangler/profil-a-publication.generated.json --dry-run --outdir ../../../quality/reports/cloudflare-profil-a-publication
npx wrangler login        # connexion par le navigateur, aucun jeton copié
npx wrangler deploy --config serverless/cloudflare/.wrangler/profil-a-publication.generated.json
```

- `render_profil_a.py --route` ajoute une seule route : `www.bluewavesolutions.fr` en domaine personnalisé. Cloudflare crée alors l'enregistrement `www` et son certificat. `check_profile.py A --publication` refuse toute autre route, toute base, toute collecte et toute indexation.
- **Apex** : règle de redirection, dans *Rules › Redirect Rules › Single Redirects*.
  - Condition : `(http.host eq "bluewavesolutions.fr")`.
  - Destination dynamique : `concat("https://www.bluewavesolutions.fr", http.request.uri.path)`.
  - Code 301, chaîne de requête conservée.
  - L'enregistrement `AAAA 100::` proxifié de la zone cible porte cette règle.
- **HTTPS** : activer *SSL/TLS › Edge Certificates › Always Use HTTPS*. HSTS reste désactivé jusqu'à ce que `www` et l'apex répondent en HTTPS depuis plusieurs jours : c'est une décision distincte, difficile à défaire.
- **Indexation** : décision éditoriale distincte. `--indexable` fait échouer le contrôle du profil A tant que ce contrôle n'a pas été revu.
- **Contrôles après déploiement** :
  - `curl -sI https://www.bluewavesolutions.fr/` : 200, avec `content-security-policy` et `x-robots-tag: noindex, nofollow`.
  - `curl -sI http://bluewavesolutions.fr/contact.html` : 301 vers `https://www.bluewavesolutions.fr/contact.html`.
  - `curl -sI https://www.bluewavesolutions.fr/page-absente` : 404.
  - `curl -s https://www.bluewavesolutions.fr/robots.txt` : `Disallow: /`.
  - `curl -s -o /dev/null -w '%{http_code}' -X POST https://www.bluewavesolutions.fr/api/leads` : 503, car la collecte est fermée.
  - Ces réponses ont été obtenues le 8 novembre 2026 sur le Worker servi localement (`wrangler dev --local`) avec cette configuration. `services.html` et `contact.html` répondent 301 vers leurs pages actuelles, et `/bluewave-solutions-site` répond 308 vers la racine.

## Retour arrière

- Avant l'étape 6 : supprimer la zone en attente chez Cloudflare. Rien d'autre n'a changé.
- Après l'étape 6 : remettre `ns111.ovh.net` et `dns111.ovh.net` chez OVH. La zone OVH n'a pas été supprimée. Réactiver ensuite DNSSEC chez OVH.
- Ne jamais réactiver DNSSEC d'un côté tant que les serveurs de noms désignent l'autre.
- Site, après l'étape 8 : `npx wrangler rollback` revient à la version précédente du Worker. Pour retirer le site, supprimer le domaine personnalisé `www` dans *Workers › bluewave-site-production › Settings › Domains*, puis, si besoin, recréer `www A 213.186.33.5` en DNS seul : la page OVH revient. La messagerie n'est pas touchée.

## Ce qui n'est pas prouvé

- Que l'import Cloudflare reconnaisse le marqueur `cf_tags=cf-proxied:true` de l'apex : à vérifier à l'étape 2.
- Que l'enregistrement `ftp` serve encore à quelque chose : à vérifier dans l'espace OVH.
- Les serveurs de noms que Cloudflare attribuera : ils ne sont connus qu'à la création de la zone.
