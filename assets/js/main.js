(() => {
  const button = document.querySelector('.menu-toggle');
  const nav = document.getElementById('nav-links');
  if (!button || !nav) return;
  const close = () => { nav.classList.remove('is-open'); button.setAttribute('aria-expanded','false'); };
  button.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    button.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();

(() => {
  // En-tête : densification discrète au défilement. Progressive enhancement —
  // sans JavaScript, l'en-tête reste parfaitement lisible.
  const header = document.querySelector('.site-header');
  if (!header) return;
  let ticking = false;
  const sync = () => {
    header.classList.toggle('is-stuck', window.scrollY > 8);
    ticking = false;
  };
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(sync);
  }, { passive: true });
  sync();
})();
