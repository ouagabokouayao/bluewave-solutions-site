# Messagerie professionnelle @bluewavesolutions.fr

Architecture proposée. Aucune boîte n'est créée, aucun enregistrement MX, SPF, DKIM ou DMARC n'est modifié, et aucun courriel n'est envoyé.

## État constaté le 8 novembre 2026

| Élément | Constat | Ce que cela ne prouve pas |
|---|---|---|
| MX | `mx1`, `mx2`, `mx3.mail.ovh.net` | Qu'une boîte existe ou qu'une offre est souscrite |
| SPF | `v=spf1 include:mx.ovh.com -all` | Qu'un autre service puisse envoyer : tout autre expéditeur est refusé |
| DKIM | Absent | — |
| DMARC | Absent | — |
| Adresse publiée sur le site | `bluewavesolutions3399@gmail.com` | — |

## Architecture proposée

| Adresse | Nature | Usage |
|---|---|---|
| `contact@bluewavesolutions.fr` | Boîte principale | Réception et réponse ; adresse publiée sur le site après bascule |
| `direction@bluewavesolutions.fr` | Alias vers `contact@` | Échanges de direction |
| `projets@bluewavesolutions.fr` | Alias vers `contact@` | Demandes de projet et missions |
| `partenariats@bluewavesolutions.fr` | Alias vers `contact@` | Collaborations et partenariats |
| `perspectives@bluewavesolutions.fr` | Expéditeur de BlueWave Perspectives | Envoi par Brevo ; réponses vers `contact@`. Aucune boîte à créer avant l'ouverture des inscriptions |

Une seule boîte limite le coût et le nombre d'accès à protéger. Les alias se créent depuis l'espace client OVH, sur toutes les offres de messagerie OVH.

## Offres OVH à arbitrer

OVHcloud propose MX Plan, Zimbra (dont Zimbra Starter), Email Pro et Exchange. Toutes gèrent les alias depuis l'espace client. La configuration IMAP/SMTP de Zimbra Starter est celle de MX Plan.

**À relire dans l'espace client :** une offre est-elle déjà rattachée au domaine ? Des MX OVH ne le prouvent pas. Prix, quotas et nombre d'alias se lisent sur la page de commande au moment de la décision. Aucune commande n'est passée.

## Authentification des expéditeurs

À appliquer seulement après création de la boîte, dans cet ordre.

1. **SPF** : conserver `include:mx.ovh.com`. Lorsque Brevo enverra au nom du domaine, ajouter le mécanisme que Brevo indique au moment de l'authentification, sans dépasser dix requêtes DNS.
2. **DKIM** : activer la signature DKIM de l'offre OVH retenue, puis publier les enregistrements fournis. Faire de même pour Brevo. Aucune valeur n'est inventée ici.
3. **DMARC** : commencer en observation, puis durcir après lecture des rapports.

```
_dmarc.bluewavesolutions.fr  TXT  "v=DMARC1; p=none; rua=mailto:contact@bluewavesolutions.fr; adkim=r; aspf=r"
```

Passer ensuite à `p=quarantine`, puis à `p=reject`, quand les rapports ne montrent plus d'envoi légitime non aligné.

Ces enregistrements se recopient dans Cloudflare si la zone y migre (`serverless/DNS-MATRICE.md`).

## Signatures

`private/prepublication/brand/contact-kit/signatures-v2/` contient une signature HTML pour `contact`, `direction`, `projets` et `partenariats`. Elles reprennent le logo officiel, la palette (#0A2540, #005BAA, #00A6A6), la signature « Comprendre la mer. Éclairer la décision. » et la mention « SASU en cours de constitution ».

Elles restent marquées `TEMP — DO NOT PUBLISH` : le logo se charge depuis `https://www.bluewavesolutions.fr/`, qui n'est pas encore servi en HTTPS. Aucune ne contient de téléphone ni d'image de suivi.

## Passage du site à la nouvelle adresse

Le site publie aujourd'hui l'adresse Gmail sur toutes ses pages. Le remplacement par `contact@bluewavesolutions.fr` attend que la boîte existe, ait été essayée en réception et en envoi, et que Joseph donne son accord.
