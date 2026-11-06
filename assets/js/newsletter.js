// Page de la lettre de veille. Le jeton arrive dans le fragment de l'adresse : il
// n'est jamais transmis au serveur par l'URL et il disparaît de la barre d'adresse.
(() => {
  const API = '/api/newsletter/';
  const views = new Map([...document.querySelectorAll('[data-veille-view]')].map(view => [view.dataset.veilleView, view]));
  const subscribeForm = document.querySelector('[data-veille-form="subscribe"]');
  const preferencesForm = document.querySelector('[data-veille-form="preferences"]');
  const CONTACT = 'bluewavesolutions3399@gmail.com';
  const NO_ANSWER = 'Nous n’avons pas reçu de réponse : ';
  const UNAVAILABLE = 'Le service est indisponible pour le moment. Rien n’a été enregistré : réessayez plus tard.';
  let managementToken = '';
  let confirmationToken = '';

  const show = name => {
    views.forEach((view, key) => { view.hidden = key !== name; });
    views.get(name).querySelector('h2')?.focus();
  };
  const say = (name, text) => { views.get(name).querySelector('[data-form-message]').textContent = text; };
  const finish = text => { show('done'); say('done', text); };
  const chosen = form => [...form.querySelectorAll('[name=preferences]:checked')].map(control => control.value);

  const post = async (action, body) => {
    try {
      const response = await fetch(API + action, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(25000), body: JSON.stringify(body)
      });
      return {status: response.status, ...await response.json().catch(() => ({}))};
    } catch {
      return {status: 0};
    }
  };

  // Un même bouton ne repart pas tant que la réponse n'est pas arrivée.
  const busy = async (button, run) => {
    button.disabled = true;
    try { await run(); } finally { button.disabled = false; }
  };

  subscribeForm.inert = false;
  subscribeForm.addEventListener('focusin', () => {
    window.BlueWaveAutomation?.turnstile?.().then(guard => guard.prepare?.(subscribeForm)).catch(() => {});
  }, {once: true});
  subscribeForm.addEventListener('submit', event => {
    event.preventDefault();
    const email = subscribeForm.elements.email;
    const consent = subscribeForm.elements.consent;
    const preferences = chosen(subscribeForm);
    email.toggleAttribute('aria-invalid', !email.value.trim() || !email.validity.valid);
    if (email.hasAttribute('aria-invalid')) return say('subscribe', 'Indiquez une adresse e-mail valide.');
    if (!preferences.length) return say('subscribe', 'Choisissez au moins une rubrique.');
    if (!consent.checked) return say('subscribe', 'Votre accord est nécessaire pour demander l’inscription.');
    busy(subscribeForm.querySelector('[type=submit]'), async () => {
      say('subscribe', 'Envoi de votre demande…');
      const guard = await window.BlueWaveAutomation?.turnstile?.().catch(() => null);
      const body = {email: email.value.trim(), consent: true, preferences, website: subscribeForm.elements.website.value};
      if (guard?.enabled) body.captcha_token = await guard.token(subscribeForm).catch(() => '');
      const result = await post('subscribe', body);
      guard?.reset?.(subscribeForm);
      if (result.status === 202) {
        subscribeForm.reset();
        return finish('Demande reçue. Si cette adresse n’est pas déjà inscrite, un courriel de confirmation vient de partir. Pensez à vérifier vos indésirables.');
      }
      if (result.status === 0) return say('subscribe', `${NO_ANSWER}votre demande a peut-être abouti. Vérifiez votre messagerie avant de recommencer.`);
      if (result.status === 429) return say('subscribe', 'Trop de demandes en peu de temps. Réessayez dans quinze minutes.');
      say('subscribe', result.status === 503 ? UNAVAILABLE : 'Cette demande n’a pas pu être acceptée. Vérifiez votre adresse, puis réessayez.');
    });
  });

  const manage = async token => {
    managementToken = token;
    show('manage');
    const result = await post('preferences', {token});
    if (result.status === 200) {
      preferencesForm.querySelectorAll('[name=preferences]').forEach(control => { control.checked = result.preferences.includes(control.value); });
    } else if (result.reason === 'expired') {
      // Le retrait reste possible même lorsque la gestion des rubriques a expiré.
      preferencesForm.hidden = true;
      say('manage', 'Ce lien ne permet plus de modifier vos rubriques. Vous pouvez toujours vous désinscrire.');
    } else if (result.status === 410) {
      finish(`Ce lien n’est plus actif. Si vous recevez encore la lettre, écrivez à ${CONTACT}.`);
    } else {
      say('manage', UNAVAILABLE);
    }
  };

  preferencesForm.addEventListener('submit', event => {
    event.preventDefault();
    const preferences = chosen(preferencesForm);
    if (!preferences.length) return say('manage', 'Choisissez au moins une rubrique, ou désinscrivez-vous.');
    busy(preferencesForm.querySelector('[type=submit]'), async () => {
      const result = await post('preferences', {token: managementToken, preferences});
      if (result.status === 200) return say('manage', 'Vos rubriques sont enregistrées.');
      if (result.status === 0) return say('manage', `${NO_ANSWER}vos rubriques ont peut-être été enregistrées. Rouvrez ce lien pour le vérifier.`);
      say('manage', result.status === 410 ? 'Ce lien n’est plus actif.' : 'Vos rubriques n’ont pas été modifiées. Réessayez plus tard.');
    });
  });

  document.querySelector('[data-veille-action="unsubscribe"]').addEventListener('click', event => {
    busy(event.currentTarget, async () => {
      const result = await post('unsubscribe', {token: managementToken});
      if (result.status === 200) return finish('Votre désinscription est effective. Vous ne recevrez plus la lettre de veille.');
      if (result.status === 202) return finish('Votre désinscription est enregistrée. Sa répercussion chez notre prestataire d’envoi est en cours : elle sera reprise automatiquement.');
      if (result.status === 410) return finish(`Ce lien n’est plus actif. Si vous recevez encore la lettre, écrivez à ${CONTACT}.`);
      if (result.status === 0) return say('manage', `${NO_ANSWER}réessayez, un second essai est sans risque.`);
      say('manage', `La désinscription n’a pas abouti. Réessayez, ou écrivez à ${CONTACT}.`);
    });
  });

  document.querySelector('[data-veille-action="confirm"]').addEventListener('click', event => {
    busy(event.currentTarget, async () => {
      const result = await post('confirm', {token: confirmationToken});
      if (result.status === 200) {
        await manage(result.management_token);
        return say('manage', 'Votre inscription est confirmée. Vous pouvez ajuster vos rubriques ici, et chaque lettre contiendra un lien de désinscription.');
      }
      if (result.status === 0) return say('confirm', `${NO_ANSWER}votre inscription a peut-être été confirmée. Réessayez : si ce lien n’est plus actif, c’est qu’elle l’est.`);
      if (result.status === 503) return say('confirm', 'L’inscription n’a pas pu être finalisée. Ce lien reste valable : réessayez dans quelques minutes.');
      if (result.reason === 'expired') { show('subscribe'); return say('subscribe', 'Ce lien a expiré, aucune inscription n’a été faite. Vous pouvez recommencer.'); }
      finish('Ce lien n’est plus actif : il a déjà servi ou il a été remplacé. Votre inscription n’a pas été modifiée.');
    });
  });

  // Un lien ouvert sur cette page déjà chargée ne provoque aucun rechargement.
  const route = () => {
    const link = /^#(confirmer|gerer)=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (!link) return;
    history.replaceState(null, '', location.pathname);
    if (link[1] === 'gerer') return manage(link[2]);
    confirmationToken = link[2];
    show('confirm');
  };
  window.addEventListener('hashchange', route);
  route();
})();
