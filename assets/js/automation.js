(() => {
  const CONFIG_URL = 'data/automation-config.json';
  let configPromise;

  const loadConfig = () => {
    if (!configPromise) {
      configPromise = fetch(CONFIG_URL, { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`Configuration HTTP ${response.status}`);
        return response.json();
      });
    }
    return configPromise;
  };

  const track = (name, detail = {}) => {
    const event = { event: name, ...detail };
    window.dispatchEvent(new CustomEvent('bluewave:event', { detail: event }));
    if (Array.isArray(window.dataLayer)) window.dataLayer.push(event);
  };

  const submit = async (kind, payload) => {
    const config = await loadConfig();
    const section = kind === 'newsletter' ? config.newsletter : config.lead_capture;
    if (!section?.enabled || !section.endpoint) return { configured: false };
    const tags = kind === 'lead' ? [
      config.crm_tags?.request_types?.[payload.request_type],
      config.crm_tags?.geographies?.[payload.territory],
      config.crm_tags?.themes?.[payload.theme]
    ].filter(Boolean) : [];
    const response = await fetch(section.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, tags })
    });
    if (!response.ok) throw new Error(`Transmission HTTP ${response.status}`);
    return { configured: true, ok: true };
  };

  const wireMeeting = async () => {
    const target = document.querySelector('[data-meeting-placeholder]');
    if (!target) return;
    try {
      const config = await loadConfig();
      if (!config.meeting?.enabled || !config.meeting.url) return;
      const link = document.createElement('a');
      link.className = 'button secondary';
      link.href = config.meeting.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.meetingLink = '';
      link.textContent = 'Planifier un échange';
      target.append(link);
    } catch (error) {
      // Le contact par e-mail reste disponible si la configuration est absente.
    }
  };

  const wireChat = async () => {
    try {
      const config = await loadConfig();
      if (!config.chat?.enabled || !config.chat.endpoint) return;
      const wrapper = document.createElement('aside');
      wrapper.className = 'welcome-chat';
      wrapper.setAttribute('aria-label', 'Accueil BlueWave');
      wrapper.innerHTML = '<button type="button" class="welcome-chat-toggle" aria-expanded="false">Accueil BlueWave</button><div class="welcome-chat-panel" hidden><p><strong>Accueil BlueWave</strong></p><p>Bonjour. Vous avez un projet ou une question liée à la mer, au littoral ou à la gouvernance maritime ? Je peux vous orienter vers le bon point d’entrée BlueWave.</p><div class="welcome-chat-actions"><a href="qualifier-un-besoin.html">Présenter un projet</a><a href="solutions.html">Découvrir les solutions</a><a href="qualifier-un-besoin.html?problematique=formation">Demander une formation</a><a href="qualifier-un-besoin.html">Proposer une collaboration</a><a href="mailto:bluewavesolutions3399@gmail.com">Contacter BlueWave</a></div></div>';
      document.body.append(wrapper);
      const toggle = wrapper.querySelector('button');
      const panel = wrapper.querySelector('.welcome-chat-panel');
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        panel.hidden = open;
        if (!open) track('chat_open');
      });
    } catch (error) {
      // Aucun widget n'est affiché sans configuration valide.
    }
  };

  const wireNewsletter = async () => {
    const form = document.querySelector('[data-newsletter-form]');
    if (!form) return;
    const message = form.querySelector('[data-newsletter-message]');
    try {
      const config = await loadConfig();
      if (!config.newsletter?.enabled || !config.newsletter.endpoint) {
        form.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
        message.textContent = 'Inscription bientôt disponible.';
        return;
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const data = new FormData(form);
          await submit('newsletter', { email: data.get('email'), consent: data.get('consent') === 'yes' });
          form.reset();
          message.textContent = 'Merci. Vérifiez votre messagerie pour confirmer votre inscription.';
          track('news_signup', { status: 'submitted' });
        } catch (error) {
          message.textContent = 'Inscription indisponible pour le moment.';
        } finally {
          button.disabled = false;
        }
      });
    } catch (error) {
      message.textContent = 'Inscription bientôt disponible.';
    }
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    if (link.matches('a[href^="mailto:"]')) track('contact_email_click');
    if (link.matches('a[href*="qualifier-un-besoin.html"]')) track('qualifier_open');
    if (link.matches('a[href*="solutions.html"]')) track('solution_view', { href: link.getAttribute('href') });
    if (link.matches('[data-meeting-link]')) track('meeting_click');
  });

  window.BlueWaveAutomation = { loadConfig, submit, track };
  wireNewsletter();
  wireMeeting();
  wireChat();
})();
