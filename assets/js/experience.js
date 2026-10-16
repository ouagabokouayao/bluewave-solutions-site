(() => {
  'use strict';
  const root = document.querySelector('.home-premium');
  if (!root) return;
  root.dataset.experienceReady = 'true';
  const menu = document.querySelector('.menu-toggle');
  const panel = document.getElementById('menu-mobile');
  const desktop = window.matchMedia('(min-width: 1201px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const closeMenu = (restoreFocus = false) => {
    if (!menu || !panel) return;
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Ouvrir le menu');
    panel.hidden = true;
    root.classList.remove('menu-open');
    if (restoreFocus) menu.focus();
  };
  if (menu && panel) {
    menu.hidden = false;
    closeMenu();
    menu.addEventListener('click', () => {
      const opening = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(opening));
      menu.setAttribute('aria-label', opening ? 'Fermer le menu' : 'Ouvrir le menu');
      panel.hidden = !opening;
      root.classList.toggle('menu-open', opening);
    });
    panel.addEventListener('click', event => {
      if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') closeMenu(true);
    });
    desktop.addEventListener('change', event => { if (event.matches) closeMenu(); });
  }
  const header = document.querySelector('.topbar');
  if (header) {
    let scheduled = false;
    const sync = () => { header.classList.toggle('scrolled', window.scrollY > 50); scheduled = false; };
    window.addEventListener('scroll', () => {
      if (!scheduled) { scheduled = true; window.requestAnimationFrame(sync); }
    }, {passive: true});
    sync();
  }
  const motion = document.querySelector('[data-motion-toggle]');
  if (motion) {
    let paused = false;
    const sync = () => {
      root.dataset.motionPaused = String(paused || reduced.matches);
      motion.hidden = reduced.matches;
      motion.setAttribute('aria-pressed', String(paused));
      motion.textContent = paused ? 'Reprendre les animations' : 'Mettre les animations en pause';
    };
    motion.addEventListener('click', () => { paused = !paused; sync(); });
    reduced.addEventListener('change', sync);
    sync();
  }
  const description = document.querySelector('[data-matrix-description]');
  const usageButtons = document.querySelectorAll('[data-usage]');
  const usageDescriptions = {
    '1': 'Usage 01 : interaction à instruire avec l’acteur A ; usage recensé avec l’acteur C. Exemple illustratif.',
    '2': 'Usage 02 : interaction à instruire avec l’acteur B ; usage recensé avec l’acteur C. Exemple illustratif.',
    '3': 'Usage 03 : usage recensé avec l’acteur A. Les autres interactions restent à documenter. Exemple illustratif.'
  };
  usageButtons.forEach(button => button.addEventListener('click', () => {
    const usage = button.dataset.usage;
    if (!description || !Object.hasOwn(usageDescriptions, usage)) return;
    usageButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    description.textContent = usageDescriptions[usage];
  }));
})();
