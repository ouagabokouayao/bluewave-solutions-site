# AGENTS.md

Pont inter-agent pour ce dépôt. **Ce fichier n'est pas la doctrine du projet.**

## Repository purpose

Site vitrine statique de **BlueWave Solutions**, bureau d'études, de conseil et de recherche
appliquée spécialisé dans la mer, le littoral, les ports, la gouvernance maritime, l'environnement
côtier et l'économie bleue. HTML/CSS/JS sans dépendance, sans build, sans backend.

## Read first

👉 **[`CLAUDE.md`](CLAUDE.md) est la charte détaillée du projet.** Lis-la avant d'agir.
Elle fait autorité sur l'identité, la gouvernance, la méthode, la véracité, la qualité et Git.
En cas de divergence entre ce fichier et `CLAUDE.md`, **`CLAUDE.md` prévaut**.

## Non-negotiables

- **Never invent** a client, partner, mandate, result, team, expert, implantation, certification
  or label. When the proof is missing, do not publish the fact.
- **Simulations must stay explicitly labelled** as such. The quality gate enforces it.
- **Preserve `noindex, nofollow`** on every page and `Disallow: /` in `robots.txt` until an
  explicit GO from the project owner. Technical SEO never authorises indexing.
- **No direct merge, deploy or publication** without instruction.
- **Five canonical offers**, never a sixth:
  1. Diagnostic stratégique maritime, littoral ou portuaire
  2. Vulnérabilité côtière, adaptation et options de décision
  3. Gouvernance, acteurs, usages et acceptabilité
  4. Structuration de projets maritimes, littoraux ou d'économie bleue
  5. Formation et renforcement des capacités
- **Two entry formats**, never a third: Note stratégique BlueWave · Atelier de cadrage BlueWave.

## Tests

```bash
python quality/scripts/quality_check.py
node --check assets/js/main.js
```

Both must pass before any work is considered done. Browser and responsive checks are complementary:
report them as not executed when the environment does not allow them.

## Git

- Inspect `git status` before starting.
- Work on a dedicated branch, never directly on `main`.
- Review the diff before committing.
- Never force-push.
- Never merge into `main` without instruction.
- Never delete files in bulk on the assumption they are unused — cross-check HTML **and** JS.
