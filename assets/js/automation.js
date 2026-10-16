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

  // Turnstile : instancié à partir de la configuration publique. Fermé, le
  // module ne charge rien et rend un jeton vide.
  const TURNSTILE_MODULE = 'assets/js/turnstile.js';
  let turnstilePromise;
  const turnstile = () => {
    if (!turnstilePromise) {
      turnstilePromise = loadConfig()
        .then(config => import(new URL(TURNSTILE_MODULE, document.baseURI || location.href).href)
          .then(module => module.createTurnstile({ config })))
        .catch(() => ({ enabled: false, async token() { return ''; }, reset() {}, async prepare() {} }));
    }
    return turnstilePromise;
  };

  const ANALYTICS_MODULE = 'assets/js/analytics.js';
  const analyticsReady = import(new URL(ANALYTICS_MODULE, document.baseURI || location.href).href)
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
      body: JSON.stringify({...payload, ...await provenanceReady})
    });
    let result = {};
    try { result = await response.json(); } catch (error) { result = {}; }
    if (!response.ok || result.success !== true) throw new Error('Transmission indisponible');
    return { configured: true, ok: true, message: result.message };
  };

  const PROVENANCE_MODULE = 'assets/js/provenance.js';
  const provenanceReady = Promise.all([
    import(new URL(PROVENANCE_MODULE, document.baseURI || location.href).href),
    fetch('data/analytics-config.json', {cache:'no-store'}).then(response => response.ok ? response.json() : {})
  ]).then(([module, config]) => {
    const provenance = module.provenanceFromLocation(location, config.campaigns, document.referrer);
    document.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (link && (provenance.campaign_code || new URLSearchParams(location.search).has('utm_source'))) link.href = module.campaignLink(link.href, location.origin, provenance);
    });
    return provenance;
  }).catch(() => ({}));

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
        // Une option fermée n'est pas affichée : elle réapparaît à l'activation.
        const label = control.closest('label');
        if (label) {
          label.hidden = !config.newsletter_enabled;
          if (config.newsletter_enabled) label.style.removeProperty('display');
          else label.style.setProperty('display', 'none', 'important');
        }
      });
      document.querySelectorAll('[data-newsletter-form]').forEach(form => {
        const message = form.querySelector('[data-newsletter-message]');
        form.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
        if (message) message.textContent = config.newsletter_enabled
          ? 'Une demande distincte sera confirmée par e-mail avant toute inscription.'
          : 'Inscription désactivée. Le futur parcours exigera une confirmation par e-mail.';
      });
    } catch (error) {
      document.querySelectorAll('[data-newsletter-consent]').forEach(control => {
        control.disabled = true;
        const label = control.closest('label');
        if (label) { label.hidden = true; label.style.setProperty('display', 'none', 'important'); }
      });
    }
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    if (link.matches('a[href^="mailto:"]')) track('contact_email_click');
    if (link.matches('[data-meeting-link]')) track('meeting_click');
    if (link.matches('[data-journey-cta]')) track('journey_cta_click', { journey: link.dataset.journeyCta });
  });

  window.BlueWaveAutomation = { loadConfig, showMeeting, submit, track, turnstile };
  wireNewsletter();
})();
