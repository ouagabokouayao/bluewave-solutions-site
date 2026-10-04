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

  const ANALYTICS_MODULE = 'assets/js/analytics.js';
  const analyticsReady = import(new URL(ANALYTICS_MODULE, location.href).href)
    .then(module => module.createAnalytics(window, document, window.fetch.bind(window)))
    .catch(() => null);
  const track = (name, detail = {}) => { analyticsReady.then(analytics => analytics?.track(name, detail)); };

  const submit = async (kind, payload) => {
    if (kind !== 'lead') throw new Error('Type de transmission non pris en charge');
    const config = await loadConfig();
    if (!config.lead_endpoint) return { configured: false };
    const endpoint = new URL(config.lead_endpoint, location.origin);
    if (endpoint.protocol !== 'https:' || endpoint.origin !== location.origin || endpoint.pathname !== '/api/leads' || endpoint.search || endpoint.hash) throw new Error('Endpoint non sécurisé');
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify(payload)
    });
    let result = {};
    try { result = await response.json(); } catch (error) { result = {}; }
    if (!response.ok || result.success !== true) throw new Error('Transmission indisponible');
    return { configured: true, ok: true, message: result.message };
  };

  const showMeeting = async () => {
    const target = document.querySelector('[data-meeting-placeholder]');
    if (!target || target.querySelector('[data-meeting-link]')) return;
    try {
      const config = await loadConfig();
      if (!config.meeting_url) return;
      const meeting = new URL(config.meeting_url);
      if (meeting.protocol !== 'https:') return;
      const link = document.createElement('a');
      link.className = 'button secondary';
      link.href = meeting.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.meetingLink = '';
      link.textContent = 'Planifier un échange';
      target.append(link);
    } catch (error) {
      // Le contact par e-mail reste disponible si la configuration est absente.
    }
  };

  const wireNewsletter = async () => {
    try {
      const config = await loadConfig();
      document.querySelectorAll('[data-newsletter-consent]').forEach(control => {
        control.disabled = !config.newsletter_enabled;
      });
      document.querySelectorAll('[data-newsletter-form]').forEach(form => {
        const message = form.querySelector('[data-newsletter-message]');
        form.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
        if (message) message.textContent = config.newsletter_enabled
          ? 'Une demande distincte sera confirmée par e-mail avant toute inscription.'
          : 'Inscription désactivée. Le futur parcours exigera une confirmation par e-mail.';
      });
    } catch (error) {
      document.querySelectorAll('[data-newsletter-consent]').forEach(control => { control.disabled = true; });
    }
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    if (link.matches('a[href^="mailto:"]')) track('contact_email_click');
    if (link.matches('[data-meeting-link]')) track('meeting_click');
    if (link.matches('[data-journey-cta]')) track('journey_cta_click', { journey: link.dataset.journeyCta });
  });

  window.BlueWaveAutomation = { loadConfig, showMeeting, submit, track };
  wireNewsletter();
})();
