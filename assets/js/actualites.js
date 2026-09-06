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
    meta.append(text('time', Number.isNaN(date.valueOf()) ? '' : formatter.format(date), 'news-date'));
    article.append(meta, text('h3', item.title));
    article.append(text('p', item.source_name, 'news-source'));
    if (item.excerpt) article.append(text('p', item.excerpt, 'news-excerpt'));
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
    const generated = new Date(status.generated_at);
    const hours = Number.isNaN(generated.valueOf()) ? Infinity : (Date.now() - generated.valueOf()) / 3600000;
    let message = status.message || 'Veille actualisée.';
    if (hours > 36) {
      message = 'Actualisation en cours.';
    } else if (!Number.isNaN(generated.valueOf())) {
      message = `${message} Dernière mise à jour : ${formatter.format(generated)}.`;
    }
    targets.forEach(target => {
      target.textContent = message;
      if (!Number.isNaN(generated.valueOf())) target.title = `Dernière collecte : ${formatter.format(generated)}`;
    });
  };

  const renderHome = (items) => {
    const home = document.querySelector('[data-news-home]');
    if (!home) return;
    const featured = items.filter(item => item.featured).slice(0, 3);
    const chosen = featured.length ? featured : items.slice(0, 3);
    home.replaceChildren(...chosen.map((item, index) => card(item, index === 0)));
  };

  const renderPage = (items) => {
    const featuredTarget = document.querySelector('[data-news-featured]');
    const listTarget = document.querySelector('[data-news-list]');
    if (!featuredTarget || !listTarget) return;
    const featured = items.filter(item => item.featured).slice(0, 3);
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
