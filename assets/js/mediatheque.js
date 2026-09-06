(() => {
  const filters = [...document.querySelectorAll('.media-filter')];
  const cards = [...document.querySelectorAll('.media-card')];
  const dialog = document.getElementById('media-dialog');
  const status = document.getElementById('media-filter-status');
  if (!filters.length || !cards.length || !dialog || !status) return;

  const image = document.getElementById('media-dialog-image');
  const category = document.getElementById('media-dialog-category');
  const title = document.getElementById('media-dialog-title');
  const caption = document.getElementById('media-dialog-caption');
  const counter = document.getElementById('media-dialog-counter');
  const previous = document.getElementById('media-dialog-prev');
  const next = document.getElementById('media-dialog-next');
  const close = dialog.querySelector('.media-dialog-close');
  let visibleCards = [...cards];
  let currentIndex = 0;
  let returnFocus = null;

  const displayCard = card => {
    const cardImage = card.querySelector('img');
    image.src = cardImage.src;
    image.alt = cardImage.alt;
    category.textContent = card.querySelector('.media-category').textContent;
    title.textContent = card.querySelector('h3').textContent;
    caption.textContent = card.querySelector('.media-description').textContent;
    counter.textContent = `${currentIndex + 1} / ${visibleCards.length}`;
  };

  const move = direction => {
    currentIndex = (currentIndex + direction + visibleCards.length) % visibleCards.length;
    displayCard(visibleCards[currentIndex]);
  };

  filters.forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.filter;
    filters.forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    cards.forEach(card => {
      card.hidden = selected !== 'all' && card.dataset.category !== selected;
    });
    visibleCards = cards.filter(card => !card.hidden);
    status.textContent = `${visibleCards.length} visuel${visibleCards.length > 1 ? 's' : ''} affiché${visibleCards.length > 1 ? 's' : ''}`;
  }));

  cards.forEach(card => {
    const trigger = card.querySelector('.media-open');
    trigger.addEventListener('click', () => {
      visibleCards = cards.filter(item => !item.hidden);
      currentIndex = visibleCards.indexOf(card);
      returnFocus = trigger;
      displayCard(card);
      dialog.showModal();
      close.focus();
    });
  });

  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    }
  });
  dialog.addEventListener('close', () => {
    if (returnFocus) returnFocus.focus();
  });
})();
