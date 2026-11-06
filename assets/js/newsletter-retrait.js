// Retrait de BlueWave Perspectives lorsque les inscriptions sont fermées. La page ne
// collecte rien : elle transmet le jeton reçu par courriel, et lui seul.
(() => {
  const CONTACT = 'bluewavesolutions3399@gmail.com';
  const info = document.querySelector('[data-retrait-view="info"]');
  const confirmation = document.querySelector('[data-retrait-view="confirm"]');
  const button = document.querySelector('[data-retrait-action]');
  const message = document.querySelector('[data-form-message]');
  let token = '';

  const say = text => { message.textContent = text; };
  const close = text => { confirmation.hidden = true; info.hidden = true; say(text); };

  button.addEventListener('click', async () => {
    button.disabled = true;
    let status = 0;
    try {
      status = (await fetch('/api/newsletter/unsubscribe', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
        referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(25000), body: JSON.stringify({token})
      })).status;
    } catch { /* la réponse s'est perdue : status reste à 0 */ }
    button.disabled = false;
    if (status === 200) return close('Votre désinscription de BlueWave Perspectives est effective. Vous ne recevrez plus aucune édition.');
    if (status === 202) return close('Votre désinscription de BlueWave Perspectives est enregistrée. Sa répercussion chez notre prestataire d’envoi est en cours : elle sera reprise automatiquement.');
    if (status === 410) return close(`Ce lien n’est plus actif. Si vous recevez encore BlueWave Perspectives, écrivez à ${CONTACT}.`);
    if (status === 0) return say('Nous n’avons pas reçu de réponse : réessayez, un second essai est sans risque.');
    say(`Le retrait en ligne est indisponible pour le moment. Écrivez à ${CONTACT} : votre demande sera traitée à la main.`);
  });

  // Un lien ouvert sur cette page déjà chargée ne provoque aucun rechargement.
  const route = () => {
    const link = /^#(confirmer|gerer)=([A-Za-z0-9_-]{43})$/.exec(location.hash);
    if (!link) return;
    history.replaceState(null, '', location.pathname);
    if (link[1] === 'confirmer') return say('Les inscriptions ne sont pas encore ouvertes : ce lien de confirmation ne peut pas aboutir, et vous n’êtes pas inscrit.');
    token = link[2];
    info.hidden = true;
    confirmation.hidden = false;
    say('');
    confirmation.querySelector('h2').focus();
  };
  window.addEventListener('hashchange', route);
  route();
})();
