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
8. **Raccorder le site** : construire avec `--indexable` seulement si l'indexation est décidée, rendre la configuration avec `--route`, déployer, puis rediriger l'apex vers `https://www.bluewavesolutions.fr/` par une règle Cloudflare.
9. **Réactiver DNSSEC** dans Cloudflare, puis publier chez OVH le DS que Cloudflare fournit. Vérifier la chaîne de validation.

## Retour arrière

- Avant l'étape 6 : supprimer la zone en attente chez Cloudflare. Rien d'autre n'a changé.
- Après l'étape 6 : remettre `ns111.ovh.net` et `dns111.ovh.net` chez OVH. La zone OVH n'a pas été supprimée. Réactiver ensuite DNSSEC chez OVH.
- Ne jamais réactiver DNSSEC d'un côté tant que les serveurs de noms désignent l'autre.

## Ce qui n'est pas prouvé

- Que l'import Cloudflare reconnaisse le marqueur `cf_tags=cf-proxied:true` de l'apex : à vérifier à l'étape 2.
- Que l'enregistrement `ftp` serve encore à quelque chose : à vérifier dans l'espace OVH.
- Les serveurs de noms que Cloudflare attribuera : ils ne sont connus qu'à la création de la zone.
