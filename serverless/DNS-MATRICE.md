# Matrice DNS de bluewavesolutions.fr

Préparation de la comparaison avant toute migration vers Cloudflare. Rien ici ne modifie la zone, les serveurs de noms ni la messagerie.

## Sources

| Source | Date | Nature |
|---|---|---|
| Sauvegarde OVH `BlueWave_Zone_DNS_OVH_2026-11-06_152355_CET.txt` | 6 novembre 2026, 15:23 | 12 enregistrements, SOA 2092849087, relue sur l'issue 22 |
| Résolution publique (`dig @1.1.1.1`) et `whois` | 8 novembre 2026 | Lecture seule, identique à la sauvegarde |

Version exploitable : `serverless/cloudflare/dns-reference-ovh-2026-11-06.json`.

Statuts :
- **documenté** : présent dans la sauvegarde et vérifié en résolution publique ;
- **à relire** : présent, mais son rôle dépend d'un réglage OVH à vérifier dans l'espace client ;
- **inconnu** : absent de la zone, ou impossible à établir sans accès au compte.

## Zone actuelle et cible

| Nom | Type | Valeur OVH | Statut | Cible Cloudflare |
|---|---|---|---|---|
| @ | SOA | `dns111.ovh.net. tech.ovh.net. 2092849087` | documenté | Créé par Cloudflare, ne pas recopier |
| @ | NS | `ns111.ovh.net.`, `dns111.ovh.net.` | documenté | Remplacés par les serveurs Cloudflare, au moment de la bascule seulement |
| @ | MX 1 | `mx1.mail.ovh.net.` | documenté | Recopier à l'identique |
| @ | MX 5 | `mx2.mail.ovh.net.` | documenté | Recopier à l'identique |
| @ | MX 100 | `mx3.mail.ovh.net.` | documenté | Recopier à l'identique |
| @ | TXT (SPF) | `v=spf1 include:mx.ovh.com -all` | documenté | Recopier ; à étendre seulement si un autre expéditeur est autorisé |
| @ | A | `213.186.33.5` | documenté | Remplacé par le domaine personnalisé du Worker, à la bascule web |
| www | A | `213.186.33.5` | documenté | Remplacé par le domaine personnalisé du Worker `bluewave-site-production` |
| ftp | CNAME | `bluewavesolutions.fr.` | à relire | Utile seulement si un hébergement OVH reste actif |
| @ | TXT | `1\|www.bluewavesolutions.fr` | à relire | Marqueur de redirection OVH : ne pas recopier si la redirection passe par Cloudflare |
| www | TXT | `3\|welcome` | à relire | Marqueur de page d'accueil OVH : ne pas recopier |
| @, www | AAAA | absent | inconnu | Aucun |
| `*._domainkey` | DKIM | absent | inconnu | À créer avec l'offre de messagerie retenue, valeurs fournies par OVH |
| `_dmarc` | TXT | absent | inconnu | Proposé dans `serverless/MESSAGERIE.md` |
| @ | CAA | absent | inconnu | Facultatif |

## DNSSEC

DNSSEC est **actif**. Le registre `.fr` publie un DS (balise 14294, algorithme 8, condensat de type 2), et la zone OVH publie ses clés DNSKEY.

Changer de serveurs de noms sans traiter ce DS rendrait le domaine injoignable pour les résolveurs qui valident DNSSEC : site **et** courriel. Avant toute délégation, il faut soit désactiver DNSSEC chez OVH et attendre le retrait du DS, soit suivre une migration DNSSEC prévue par les deux fournisseurs. La procédure retenue et son contrôle en lecture seule (`quality/scripts/dns_preflight.py`) sont dans `serverless/cloudflare/RACCORDEMENT.md`.

## Web, apex et redirections

- `http://www.bluewavesolutions.fr` répond 200, servi par l'hébergement OVH. HTTPS ne présente aucun certificat.
- La cible est un Worker `bluewave-site-production` sur `www`, avec redirection HTTPS de l'apex vers `www`. Aucune route n'est déclarée dans `wrangler.profil-a.jsonc`.
- Après la migration officielle, la publication GitHub Pages doit être retirée ou redirigée vers `www`.

## Registre

`whois` : registrar OVH, statut ACTIVE, `clientTransferProhibited` et `clientDeleteProhibited`, expiration le 29 septembre 2027.

## Comparer une future zone

```sh
python quality/scripts/compare_dns.py <export-de-zone-au-format-BIND.txt>
```

Le script ne contacte aucun service. Il signale chaque enregistrement OK, ABSENT, DIFFÉRENT ou EN PLUS, et échoue si un enregistrement de messagerie manque ou diffère.
