/* Corpus « Activités et productions BlueWave ».
   Script isolé : il ne touche ni aux cartes .media-card des dix visualisations,
   ni à leurs filtres, ni à la visionneuse de mediatheque.js. */
(() => {
  const DATA_URL = 'assets/data/activites-bluewave.json';
  const grid = document.querySelector('[data-activites-grid]');
  if (!grid) return;

  const filterBar = document.querySelector('[data-activites-filters]');
  const status = document.querySelector('[data-activites-status]');
  const empty = document.querySelector('[data-activites-empty]');
  const fallback = document.querySelector('[data-activites-fallback]');

  const annoncer = visibles => {
    if (status) {
      status.textContent = visibles > 1
        ? `${visibles} activités affichées.`
        : `${visibles} activité affichée.`;
    }
    if (empty) empty.hidden = visibles > 0;
  };

  const carte = (item, index) => {
    const article = document.createElement('article');
    article.className = 'activites-card';
    article.dataset.categorie = item.categorie;

    const visual = document.createElement('div');
    visual.className = 'activites-visual';
    // Une photographie est recadrée, un visuel éditorial est affiché entier.
    visual.dataset.media = /\.svg$/i.test(item.image) ? 'editorial' : 'photo';
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.alt;
    img.width = item.largeur;
    img.height = item.hauteur;
    img.decoding = 'async';
    // Les deux premières cartes sont visibles au chargement sur desktop.
    if (index >= 2) img.loading = 'lazy';
    visual.append(img);

    const body = document.createElement('div');
    body.className = 'activites-body';

    const categorie = document.createElement('p');
    categorie.className = 'activites-categorie';
    categorie.textContent = item.categorie_label;

    const titre = document.createElement('h3');
    titre.textContent = item.titre;
    body.append(categorie, titre);

    if (item.sous_titre) {
      const sous = document.createElement('p');
      sous.className = 'activites-soustitre';
      sous.textContent = item.sous_titre;
      body.append(sous);
    }

    const meta = document.createElement('p');
    meta.className = 'activites-meta';
    meta.textContent = `${item.date} · ${item.lieu} · ${item.statut}`;

    const description = document.createElement('p');
    description.className = 'activites-description';
    description.textContent = item.description;
    body.append(meta, description);

    if (item.contexte) {
      const contexte = document.createElement('p');
      contexte.className = 'activites-contexte';
      contexte.textContent = item.contexte;
      body.append(contexte);
    }

    article.append(visual, body);
    return article;
  };

  const appliquer = (slug, boutons) => {
    let visibles = 0;
    grid.querySelectorAll('.activites-card').forEach(card => {
      const correspond = slug === 'tout' || card.dataset.categorie === slug;
      card.hidden = !correspond;
      if (correspond) visibles += 1;
    });
    boutons.forEach(bouton => {
      const actif = bouton.dataset.activitesFilter === slug;
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

      // Seules les catégories réellement représentées sont proposées au filtrage.
      const utilisees = new Set(items.map(item => item.categorie));
      const proposees = (data.categories || []).filter(c => c.slug === 'tout' || utilisees.has(c.slug));
      if (filterBar && proposees.length > 1) {
        const boutons = proposees.map(c => {
          const bouton = document.createElement('button');
          bouton.type = 'button';
          bouton.className = 'activites-filter';
          bouton.dataset.activitesFilter = c.slug;
          bouton.textContent = c.label;
          bouton.setAttribute('aria-pressed', String(c.slug === 'tout'));
          if (c.slug === 'tout') bouton.classList.add('is-active');
          return bouton;
        });
        filterBar.append(...boutons);
        filterBar.hidden = false;
        filterBar.addEventListener('click', event => {
          const bouton = event.target.closest('[data-activites-filter]');
          if (bouton) appliquer(bouton.dataset.activitesFilter, boutons);
        });
      }

      annoncer(items.length);
    })
    .catch(() => {
      if (fallback) fallback.hidden = false;
      if (empty) empty.hidden = true;
      if (status) status.textContent = 'Les activités BlueWave n’ont pas pu être chargées.';
    });
})();
