# Sources Côte d'Ivoire / Afrique de l'Ouest — état de l'instruction

Document interne. Il ne fait partie ni du site public ni de `dist/`.

## Résultat

**Aucune source Côte d'Ivoire / Afrique de l'Ouest n'a été intégrée au collecteur.**
`data/actualites-sources.json` reste à trois sources vérifiées (Cerema, Commission
européenne Océans et pêche, EMSA) et `data/actualites.json` reste inchangé.

Raison : la vérification exigée avant intégration — URL réellement accessible et
flux RSS/Atom réellement existant — n'a pas pu être conduite. L'environnement
d'exécution de ce lot n'a pas d'accès sortant HTTPS vers ces domaines : la
politique d'egress a répondu `403` au `CONNECT` pour chacun des hôtes testés.
Aucun flux n'a donc pu être ouvert, lu, ni son format constaté.

La règle du lot est explicite : ne jamais inventer une URL RSS, ne jamais supposer
qu'un `/feed`, `/rss` ou `/atom` existe. Une URL de flux plausible mais non
ouverte reste une invention. Rien n'a donc été ajouté.

Corollaire : aucun contenu n'a été créé pour équilibrer artificiellement les
géographies. Le filtre « Afrique de l'Ouest » de `actualites.html` reste présent
et dégrade honnêtement — `assets/js/actualites.js` affiche l'état vide
(`data-news-empty`) tant qu'aucun élément ne correspond.

## Institutions testées

Toutes sont des institutions réelles à domaine officiel ou clairement légitime.
Le statut ci-dessous porte sur l'**accessibilité depuis cet environnement**, pas
sur l'existence de l'institution.

| Institution | Domaine testé | Résultat du test | Flux RSS/Atom confirmé |
| --- | --- | --- | --- |
| Ministère ivoirien de l'Environnement / Transition écologique | `www.environnement.gouv.ci` | egress refusé (403 au CONNECT) | non constaté |
| CEDEAO / ECOWAS | `ecowas.int`, `www.ecowas.int` | egress refusé (403 au CONNECT) | non constaté |
| UEMOA | `www.uemoa.int` | egress refusé (403 au CONNECT) | non constaté |
| WACA (Programme de gestion du littoral ouest-africain) | `www.wacaprogram.org` | egress refusé (403 au CONNECT) | non constaté |
| PRCM (Partenariat Régional pour la Conservation de la zone côtière et Marine) | `prcmarine.org`, `www.prcmarine.org` | egress refusé (403 au CONNECT) | non constaté |

Contrôle de cohérence : les sources déjà en production (`www.cerema.fr` notamment)
ont été testées de la même façon et sont tout aussi inaccessibles depuis cet
environnement. Le blocage est environnemental, il ne dit rien de l'état réel de
ces sites.

## Pistes de curation manuelle

Ces institutions restent pertinentes pour les champs BlueWave — mer, littoral,
environnement côtier, économie bleue, gouvernance maritime — et sont conservées
comme pistes de **curation manuelle**, pas d'automatisation :

- WACA et PRCM : les plus directement alignés sur le littoral ouest-africain et
  l'érosion côtière ;
- Ministère ivoirien de l'Environnement : politique publique littorale ivoirienne ;
- CEDEAO et UEMOA : cadre régional, gouvernance et instruments économiques.

`data/actualites-curation.json` (`pinned_urls`) permet de verser manuellement une
publication précise sans dépendre d'un flux.

## Condition de reprise

L'instruction reprend telle quelle depuis un poste disposant d'un accès sortant
normal. Pour chaque institution, dans cet ordre :

1. ouvrir la page d'actualités officielle et relever, dans le `<head>`, un
   éventuel `<link rel="alternate" type="application/rss+xml">` ;
2. ouvrir l'URL de flux relevée et constater qu'elle répond et qu'elle est bien
   du RSS ou de l'Atom — ne jamais déduire une URL par convention ;
3. constater la compatibilité de la structure avec `quality/scripts/update_actualites.py`
   (titre, lien, date de publication, description) ;
4. constater la pertinence thématique réelle du contenu publié ;
5. seulement alors, ajouter la source à `data/actualites-sources.json` avec
   `require_keyword_match: true` et des mots-clés littoral/maritime, puis rejouer
   `quality/scripts/quality_check.py`.

Une institution dont le site ne publie pas de flux reste en curation manuelle.
