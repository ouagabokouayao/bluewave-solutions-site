/* Corpus « Parcours et environnements du fondateur ».
   Script isolé : il ne touche ni aux cartes .media-card du corpus BlueWave,
   ni à leurs filtres, ni à la visionneuse mediatheque.js. */
(() => {
  const DATA_URL = 'assets/data/oby-preuves-selectionnees.json';
  const grid = document.querySelector('[data-parcours-grid]');
  if (!grid) return;

  const filterBar = document.querySelector('[data-parcours-filters]');
  const status = document.querySelector('[data-parcours-status]');
  const empty = document.querySelector('[data-parcours-empty]');
  const fallback = document.querySelector('[data-parcours-fallback]');

  const accorder = (nombre, singulier, pluriel) => `${nombre} ${nombre > 1 ? pluriel : singulier}`;

  const annoncer = visibles => {
    if (status) status.textContent = `${accorder(visibles, 'élément affiché', 'éléments affichés')} dans le parcours du fondateur.`;
    if (empty) empty.hidden = visibles > 0;
  };

  const carte = (item, index) => {
    const article = document.createElement('article');
    article.className = 'parcours-card';
    article.dataset.filtres = item.filtres.join(' ');

    const visual = document.createElement('div');
    visual.className = 'parcours-visual';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.alt;
    img.width = item.largeur;
    img.height = item.hauteur;
    img.decoding = 'async';
    // Les trois premières cartes sont visibles au chargement sur desktop.
    if (index >= 3) img.loading = 'lazy';
    visual.append(img);

    const body = document.createElement('div');
    body.className = 'parcours-body';

    if (item.themes_affiches.length) {
      const themes = document.createElement('ul');
      themes.className = 'parcours-themes';
      item.themes_affiches.forEach(label => {
        const li = document.createElement('li');
        li.textContent = label;
        themes.append(li);
      });
      body.append(themes);
    }

    const titre = document.createElement('h3');
    titre.textContent = item.titre;

    const meta = document.createElement('p');
    meta.className = 'parcours-meta';
    meta.textContent = `${item.date} · ${item.lieu}`;

    const attribution = document.createElement('p');
    attribution.className = 'parcours-attribution';
    attribution.textContent = item.attribution;

    const lien = document.createElement('a');
    lien.href = item.lien_oby;
    lien.target = '_blank';
    lien.rel = 'noopener noreferrer external';
    lien.textContent = 'Voir le contexte sur le site OBY';
    lien.setAttribute('aria-label', `Voir le contexte de « ${item.titre} » sur le site OBY (nouvelle fenêtre)`);

    body.append(titre, meta, attribution, lien);
    article.append(visual, body);
    return article;
  };

  const appliquer = (slug, boutons) => {
    let visibles = 0;
    grid.querySelectorAll('.parcours-card').forEach(card => {
      const correspond = slug === 'tout' || card.dataset.filtres.split(' ').includes(slug);
      card.hidden = !correspond;
      if (correspond) visibles += 1;
    });
    boutons.forEach(bouton => {
      const actif = bouton.dataset.parcoursFilter === slug;
      bouton.classList.toggle('is-active', actif);
      bouton.setAttribute('aria-pressed', String(actif));
    });
    annoncer(visibles);
  };

  fetch(DATA_URL, { cache: 'no-store' })
    .then(reponse => {
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      return reponse.json();
    })
    .then(data => {
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) throw new Error('corpus vide');

      grid.append(...items.map(carte));

      // Un filtre n'est proposé que s'il correspond à au moins un élément.
      const utilises = new Set(items.flatMap(item => item.filtres));
      const proposes = (data.filtres || []).filter(f => f.slug === 'tout' || utilises.has(f.slug));
      if (filterBar && proposes.length > 1) {
        const boutons = proposes.map(f => {
          const bouton = document.createElement('button');
          bouton.type = 'button';
          bouton.className = 'parcours-filter';
          bouton.dataset.parcoursFilter = f.slug;
          bouton.textContent = f.label;
          bouton.setAttribute('aria-pressed', String(f.slug === 'tout'));
          if (f.slug === 'tout') bouton.classList.add('is-active');
          return bouton;
        });
        filterBar.append(...boutons);
        filterBar.hidden = false;
        filterBar.addEventListener('click', event => {
          const bouton = event.target.closest('[data-parcours-filter]');
          if (bouton) appliquer(bouton.dataset.parcoursFilter, boutons);
        });
      }

      annoncer(items.length);
    })
    .catch(() => {
      if (fallback) fallback.hidden = false;
      if (empty) empty.hidden = true;
      if (status) status.textContent = 'Le parcours du fondateur n’a pas pu être chargé.';
    });
})();
