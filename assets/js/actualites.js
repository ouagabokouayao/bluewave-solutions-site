(() => {
  const THEME_LABELS = {
    'littoral-adaptation': 'Littoral & adaptation',
    'gouvernance-maritime': 'Gouvernance maritime',
    'environnement-marin': 'Environnement marin',
    'economie-bleue': 'Économie bleue',
    'ports-maritime': 'Ports & activités maritimes',
    'droit-securite': 'Droit & sécurité maritime'
  };
  const GEO_LABELS = {
    'france-mediterranee': 'Méditerranée',
    'europe-mediterranee': 'Méditerranée',
    'cote-divoire': 'Afrique de l’Ouest',
    'afrique-ouest': 'Afrique de l’Ouest'
  };
  // Ces sources publient en anglais : la langue est déclarée et annoncée sur la carte.
  const ENGLISH_SOURCES = new Set(['emsa', 'eu-oceans-fisheries']);
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };

  const card = (item, prominent = false) => {
    const article = document.createElement('article');
    article.className = `news-card${prominent ? ' news-card-main' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'news-meta';
    meta.append(text('span', THEME_LABELS[item.theme] || item.theme, 'news-theme'));
    const date = new Date(item.published_at);
    const time = text('time', Number.isNaN(date.valueOf()) ? '' : formatter.format(date), 'news-date');
    if (!Number.isNaN(date.valueOf())) time.dateTime = item.published_at;
    meta.append(time);
    const english = ENGLISH_SOURCES.has(item.source_id);
    const title = text('h3', item.title);
    if (english) title.lang = 'en';
    article.append(meta, title);
    article.append(text('p', english ? `${item.source_name} · article en anglais` : item.source_name, 'news-source'));
    if (item.excerpt) {
      const excerpt = text('p', item.excerpt, 'news-excerpt');
      if (english) excerpt.lang = 'en';
      article.append(excerpt);
    }
    const link = text('a', 'Lire à la source', 'news-link');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer external';
    link.setAttribute('aria-label', `Lire « ${item.title} » sur ${item.source_name} (nouvel onglet)`);
    article.append(link);
    return article;
  };

  const matches = (item, filter) => {
    if (filter === 'all') return true;
    if (filter === 'mediterranee') return item.geographies.some(value => ['france-mediterranee', 'europe-mediterranee'].includes(value));
    if (filter === 'afrique-ouest') return item.geographies.some(value => ['cote-divoire', 'afrique-ouest'].includes(value));
    return item.theme === filter;
  };

  const renderStatus = (status) => {
    const targets = document.querySelectorAll('[data-news-status]');
    const validDate = value => {
      const date = typeof value === 'string' && value.trim() ? new Date(value) : null;
      return date && !Number.isNaN(date.valueOf()) ? date : null;
    };
    const generated = validDate(status.generated_at);
    const lastUpdate = validDate(status.last_successful_at)
      || (['ok', 'partial'].includes(status.state) ? generated : null);
    const hours = lastUpdate ? (Date.now() - lastUpdate.valueOf()) / 3600000 : Infinity;
    const messages = {
      ok: hours > 36 ? '' : 'Veille actualisée.',
      partial: 'Veille partiellement actualisée ; certaines sources sont indisponibles.',
      cached: 'Corpus revalidé sans nouvelle collecte distante.',
      error: 'Sources momentanément indisponibles ; dernier corpus conservé.'
    };
    let message = messages[status.state] ?? 'État de la veille non renseigné.';
    message += lastUpdate
      ? ` Dernière mise à jour : ${formatter.format(lastUpdate)}.`
      : ' Date de dernière mise à jour indisponible.';
    message = message.trim();
    if (status.state === 'cached' && generated) {
      message += ` Revalidation du corpus : ${formatter.format(generated)}.`;
    }
    targets.forEach(target => {
      target.textContent = message;
      target.title = lastUpdate ? `Dernière collecte réussie : ${formatter.format(lastUpdate)}` : '';
    });
  };

  const renderHome = (items) => {
    const home = document.querySelector('[data-news-home]');
    if (!home) return;
    const featured = items.filter(item => item.featured).slice(0, 3);
    const recentRelevant = items.filter(item => item.score_relevance_bluewave >= 6).slice(0, 3);
    const chosen = featured.length ? featured : recentRelevant;
    const label = document.querySelector('[data-news-home-label]');
    const note = document.querySelector('[data-news-home-note]');
    if (label) label.textContent = featured.length ? 'À la une' : 'Actualités récentes';
    if (note) {
      note.hidden = chosen.length > 0;
      note.textContent = 'Aucune publication récente n’est actuellement disponible.';
    }
    home.setAttribute('aria-label', featured.length ? 'Actualités à la une' : 'Actualités récentes');
    home.replaceChildren(...chosen.map((item, index) => card(item, featured.length > 0 && index === 0)));
  };

  const renderPage = (items) => {
    const featuredTarget = document.querySelector('[data-news-featured]');
    const listTarget = document.querySelector('[data-news-list]');
    if (!featuredTarget || !listTarget) return;
    const featured = items.filter(item => item.featured).slice(0, 3);
    const featuredLabel = document.querySelector('[data-news-featured-label]');
    const featuredTitle = document.querySelector('[data-news-featured-title]');
    if (featuredLabel) featuredLabel.textContent = featured.length ? 'À la une' : 'Actualités récentes';
    if (featuredTitle) {
      const labels = ['', 'Un signal récent à mettre en perspective.', 'Deux signaux récents à mettre en perspective.', 'Trois signaux récents à mettre en perspective.'];
      featuredTitle.textContent = labels[featured.length] || '';
    }
    // Sans signal qualifié, la section n'annonce pas un vide : la liste suffit.
    const featuredSection = featuredTarget.closest('section');
    if (featuredSection) featuredSection.hidden = featured.length === 0;
    featuredTarget.replaceChildren(...featured.map((item, index) => card(item, index === 0)));
    let active = 'all';
    const drawList = () => {
      const visible = items.filter(item => matches(item, active));
      listTarget.replaceChildren(...visible.map(item => card(item)));
      const empty = document.querySelector('[data-news-empty]');
      if (empty) empty.hidden = visible.length > 0;
    };
    document.querySelectorAll('[data-news-filter]').forEach(button => {
      button.addEventListener('click', () => {
        active = button.dataset.newsFilter;
        document.querySelectorAll('[data-news-filter]').forEach(candidate => {
          const selected = candidate === button;
          candidate.classList.toggle('is-active', selected);
          candidate.setAttribute('aria-pressed', String(selected));
        });
        drawList();
      });
    });
    drawList();
  };

  const showError = () => {
    document.querySelectorAll('[data-news-error]').forEach(node => {
      node.closest('section')?.removeAttribute('hidden');
      node.hidden = false;
      node.textContent = 'La veille est momentanément indisponible.';
    });
  };

  Promise.all([
    fetch('data/actualites.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`Actualités HTTP ${response.status}`);
      return response.json();
    }),
    fetch('data/actualites-status.json', { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(`Statut HTTP ${response.status}`);
      return response.json();
    })
  ]).then(([payload, status]) => {
    if (!Array.isArray(payload.items)) throw new Error('Format actualités invalide');
    const items = payload.items
      .filter(item => item && item.title && item.url && item.source_name && item.published_at)
      .sort((a, b) => b.published_at.localeCompare(a.published_at));
    renderStatus(status);
    renderHome(items);
    renderPage(items);
  }).catch(showError);
})();
