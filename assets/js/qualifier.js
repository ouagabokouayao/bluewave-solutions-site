(() => {
  const form = document.getElementById('qualifier-form');
  if (!form) return;
  const steps = [...form.querySelectorAll('fieldset[data-step]')];
  const next = document.getElementById('next');
  const prev = document.getElementById('prev');
  const submit = document.getElementById('submit-qualifier');
  const progress = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const result = document.getElementById('qualifier-result');
  const restart = document.getElementById('restart');
  const leadForm = document.getElementById('lead-form');
  const leadSubmit = document.getElementById('lead-submit');
  const leadMessage = document.getElementById('lead-message');
  let current = 0;
  let started = false;
  let submitting = false;
  let lastOrientation = null;

  const labels = {
    territoire:{med:'France / Méditerranée',ci:"Côte d’Ivoire",ao:"Afrique de l’Ouest",autre:'un autre territoire',multi:'plusieurs territoires',preciser:'un territoire à préciser'},
    probleme:{vulnerabilite:'vulnérabilité côtière / adaptation',strategie:'stratégie maritime, littorale ou portuaire',gouvernance:"gouvernance / acteurs / conflits d’usage",sfn:'Solutions fondées sur la Nature',projet:"structuration d’un projet côtier ou maritime",planification:'planification littorale / coordination territoriale',formation:'formation / concertation / médiation',multiple:'plusieurs problématiques',indetermine:'un besoin encore à qualifier'},
    stade:{initial:'question initiale',flou:'besoin encore flou',cadrage:'cadrage en cours',etude:'étude ou diagnostic déjà engagé',structure:'projet structuré à approfondir',decision:'décision ou arbitrage proche',concertation:'concertation à préparer',formation:'formation à organiser'},
    resultat:{comprendre:'comprendre une situation',options:'comparer des options',acteurs:'identifier les acteurs, usages et tensions',structurer:'structurer un projet',route:'préparer une feuille de route',concertation:'préparer une concertation',former:'former ou aligner une équipe',note:"produire une note courte d’aide à la décision",perimetre:'définir le bon périmètre'}
  };
  const offerPresets = {
    'diagnostic-strategique': { problematique:'strategie', stade:'initial', resultat:'comprendre', requestType:'projet-mission', label:'Diagnostic stratégique maritime, littoral ou portuaire' },
    'vulnerabilite-cotiere': { problematique:'vulnerabilite', stade:'cadrage', resultat:'options', requestType:'projet-mission', label:'Vulnérabilité côtière, adaptation et options de décision' },
    'gouvernance-acteurs': { problematique:'gouvernance', stade:'concertation', resultat:'acteurs', requestType:'projet-mission', label:'Gouvernance, acteurs, usages et acceptabilité' },
    'structuration-projet': { problematique:'projet', stade:'initial', resultat:'structurer', requestType:'projet-mission', label:'Structuration de projets maritimes, littoraux ou d’économie bleue' },
    'formation-capacites': { problematique:'formation', stade:'formation', resultat:'former', requestType:'formation', label:'Formation et renforcement des capacités' },
    'note-strategique': { problematique:'strategie', stade:'decision', resultat:'note', requestType:'projet-mission', label:'Note stratégique BlueWave' },
    'atelier-cadrage': { problematique:'indetermine', stade:'flou', resultat:'perimetre', requestType:'projet-mission', label:'Atelier de cadrage BlueWave' }
  };
  const journeyPresets = {
    projet: { requestType:'projet-mission', label:'Projet', message:'Le parcours Projet est présélectionné. Vous pouvez modifier chaque réponse.' },
    collaboration: { problematique:'multiple', stade:'cadrage', resultat:'perimetre', requestType:'collaboration', label:'Collaboration', message:'Le parcours Collaboration est présélectionné. Précisez votre structure — bureau d’études, cabinet d’avocats, conseil, recherche, ONG, collectivité, port, programme ou consortium — et modifiez chaque réponse si besoin.' },
    evenement: { problematique:'multiple', stade:'initial', resultat:'comprendre', requestType:'evenement-intervention', label:'Événement ou intervention', message:'Le parcours Événement ou intervention est présélectionné. Décrivez le format envisagé : conférence, table ronde, atelier, salon, stand, poster ou contribution scientifique.' },
    formation: { problematique:'formation', stade:'formation', resultat:'former', requestType:'formation', label:'Formation', message:'Le parcours Formation est présélectionné. Vous pouvez modifier chaque réponse.' }
  };

  function show(i){
    current = Math.max(0, Math.min(i, steps.length-1));
    steps.forEach((s,idx) => s.hidden = idx !== current);
    progress.style.width = `${((current+1)/steps.length)*100}%`;
    progressText.textContent = `${current+1}/${steps.length}`;
    prev.hidden = current === 0;
    next.hidden = current === steps.length-1;
    submit.hidden = current !== steps.length-1;
    steps[current].querySelector('select')?.focus();
  }
  next.addEventListener('click', () => show(current+1));
  prev.addEventListener('click', () => show(current-1));
  form.addEventListener('change', () => {
    if (!started) {
      started = true;
      window.BlueWaveAutomation?.track('qualifier_start');
    }
  });

  const canonicalMethod = 'Qualifier → cadrer → analyser → cartographier → structurer → restituer.';
  function orient(v){
    if (v.stade === 'flou' || v.problematique === 'indetermine' || v.problematique === 'multiple' || v.resultat === 'perimetre') {
      return ['Atelier de cadrage BlueWave','Le besoin doit d’abord être stabilisé avant de choisir la profondeur d’étude.','cadrage du périmètre, documents disponibles et décision attendue'];
    }
    if (v.resultat === 'note' || (v.stade === 'decision' && ['comprendre','options'].includes(v.resultat))) {
      return ['Note stratégique BlueWave','Une question ciblée et une décision proche peuvent justifier un format court et sourcé.','question exacte, sources disponibles et niveau de décision'];
    }
    if (v.problematique === 'formation' || v.resultat === 'former' || v.stade === 'formation') {
      return ['Formation et renforcement des capacités','Le besoin porte principalement sur la transmission, l’alignement d’un collectif ou la mise en pratique.','public, acquis attendus, format et cas d’usage'];
    }
    if (v.problematique === 'gouvernance' || ['acteurs','concertation'].includes(v.resultat) || v.stade === 'concertation') {
      return ['Gouvernance, acteurs, usages et acceptabilité','La décision dépend d’abord des acteurs, usages, compétences, relations ou conditions de dialogue.','acteurs concernés, mandat de concertation et documents disponibles'];
    }
    if (v.problematique === 'vulnerabilite' || v.problematique === 'sfn') {
      return ["Vulnérabilité côtière, adaptation et options de décision",'La situation appelle un cadrage des vulnérabilités, usages, données et options avant toute expertise technique complète.','données physiques disponibles, périmètre, niveau de terrain et expertises spécialisées nécessaires'];
    }
    if (v.problematique === 'projet' || ['structurer','route'].includes(v.resultat) || v.stade === 'structure') {
      return ["Structuration de projets maritimes, littoraux ou d’économie bleue",'Le besoin dominant est de transformer une intention ou un projet existant en logique d’action lisible et présentable.','objectif, portage, acteurs, ressources, dépendances et prochaine décision'];
    }
    return ["Diagnostic stratégique maritime, littoral ou portuaire",'La situation exige une lecture transversale avant arbitrage ou approfondissement spécialisé.','question de décision, périmètre, sources disponibles et limites techniques à qualifier'];
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = {
      organisation: document.getElementById('q-organisation').value,
      territoire: document.getElementById('q-territoire').value,
      problematique: document.getElementById('q-problematique').value,
      stade: document.getElementById('q-stade').value,
      delai: document.getElementById('q-delai').value,
      donnees: document.getElementById('q-donnees').value,
      resultat: document.getElementById('q-resultat').value,
    };
    const [offer,why,confirm] = orient(v);
    const summary = `Vous cherchez à ${labels.resultat[v.resultat]} sur ${labels.territoire[v.territoire]}, à un stade de ${labels.stade[v.stade]}, dans un contexte de ${labels.probleme[v.problematique]}.`;
    lastOrientation = { ...v, offer, summary };
    document.getElementById('result-title').textContent = 'Une première orientation pour cadrer la suite.';
    document.getElementById('result-summary').textContent = summary;
    document.getElementById('result-offer').textContent = `${offer}. ${why}`;
    document.getElementById('result-method').textContent = `${canonicalMethod} L’intensité de certaines étapes sera adaptée au besoin réel.`;
    document.getElementById('result-confirm').textContent = `À confirmer : ${confirm}.`;
    const subject = encodeURIComponent(`BlueWave — qualification d’un besoin — ${offer}`);
    const body = encodeURIComponent(`Bonjour,\n\nJe souhaite présenter le besoin suivant à BlueWave Solutions.\n\n${summary}\n\nOrientation indicative affichée : ${offer}.\n\nJe comprends que cette orientation ne constitue ni un diagnostic ni une proposition commerciale.\n\nCordialement,`);
    document.getElementById('result-mail').href = `mailto:bluewavesolutions3399@gmail.com?subject=${subject}&body=${body}`;
    window.BlueWaveAutomation?.track('qualifier_submit', { status: 'orientation-complete', offer });
    result.hidden = false;
    result.scrollIntoView({behavior:'smooth',block:'start'});
  });
  restart.addEventListener('click', () => {
    result.hidden = true;
    leadForm?.reset();
    leadMessage.textContent = '';
    show(0);
    form.scrollIntoView({behavior:'smooth',block:'start'});
  });

  const problemToTheme = {
    vulnerabilite: 'littoral-adaptation', sfn: 'environnement-marin',
    strategie: 'gouvernance-maritime', gouvernance: 'gouvernance-maritime',
    projet: 'economie-bleue', planification: 'littoral-adaptation', formation: 'gouvernance-maritime',
    multiple: 'gouvernance-maritime', indetermine: 'gouvernance-maritime'
  };
  const geographyTag = {
    med: 'france-mediterranee', ci: 'cote-divoire', ao: 'afrique-ouest',
    autre: 'autre', multi: 'autre', preciser: 'autre'
  };

  leadForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !lastOrientation || !leadForm.reportValidity()) return;
    submitting = true;
    leadSubmit.disabled = true;
    leadMessage.textContent = 'Transmission en cours…';
    const data = new FormData(leadForm);
    const nameParts = String(data.get('name') || '').trim().split(/\s+/).filter(Boolean);
    const payload = {
      firstname: nameParts.shift() || '',
      lastname: nameParts.join(' '),
      email: data.get('email'),
      organisation: data.get('organisation_name'),
      type: data.get('request_type'),
      geography: geographyTag[lastOrientation.territoire],
      themes: [problemToTheme[lastOrientation.problematique]],
      need: data.get('description'),
      deadline: lastOrientation.delai,
      contact_preference: data.get('contact_preference'),
      source: 'SITE_QUALIFIER',
      newsletter_consent: data.get('newsletter_consent') === 'yes',
      privacy_acknowledged: data.get('consent') === 'yes',
      website: data.get('website') || ''
    };
    try {
      const response = await window.BlueWaveAutomation.submit('lead', payload);
      if (response.configured && response.ok) {
        leadForm.reset();
        leadMessage.textContent = 'Votre demande a bien été transmise à BlueWave Solutions. Un message de confirmation va vous être adressé par email.';
        window.BlueWaveAutomation.track('qualifier_submit', { status: 'transmitted', request_type: payload.type, theme: payload.themes[0], territory: payload.geography });
        await window.BlueWaveAutomation.showMeeting();
      } else {
        const subject = encodeURIComponent(`BlueWave — ${payload.type} — ${lastOrientation.offer}`);
        const body = encodeURIComponent(`Bonjour,\n\nNom : ${payload.firstname} ${payload.lastname}\nOrganisation : ${payload.organisation}\nE-mail : ${payload.email}\nType de demande : ${payload.type}\nPréférence de contact : ${payload.contact_preference}\n\n${lastOrientation.summary}\n\nDescription :\n${payload.need}\n\nOrientation indicative : ${lastOrientation.offer}.\n\nJe comprends que cette prise de contact ne constitue ni une acceptation de mission ni une proposition commerciale.\n\nCordialement,`);
        const mail = document.getElementById('result-mail');
        mail.href = `mailto:bluewavesolutions3399@gmail.com?subject=${subject}&body=${body}`;
        leadMessage.textContent = 'La transmission automatisée n’est pas encore active. Votre message est prêt : utilisez le bouton de messagerie, relisez-le puis envoyez-le vous-même.';
        mail.focus();
      }
    } catch (error) {
      leadMessage.textContent = 'La transmission n’a pas pu aboutir. Vous pouvez réessayer ou écrire directement à BlueWave Solutions.';
    } finally {
      submitting = false;
      leadSubmit.disabled = false;
    }
  });

  const setSelect = (id, value) => {
    const select = document.getElementById(id);
    if (select && value && [...select.options].some(option => option.value === value)) select.value = value;
  };
  const applyPreset = preset => {
    if (!preset) return;
    setSelect('q-organisation', preset.organisation);
    setSelect('q-problematique', preset.problematique);
    setSelect('q-stade', preset.stade);
    setSelect('q-resultat', preset.resultat);
    setSelect('lead-request-type', preset.requestType);
  };
  const params = new URLSearchParams(location.search);
  const offerKey = params.get('offre');
  const journeyKey = params.get('parcours');
  const problemKey = params.get('problematique');
  const offerPreset = offerPresets[offerKey];
  const journeyPreset = journeyPresets[journeyKey];
  applyPreset(journeyPreset);
  applyPreset(offerPreset);
  if (!offerPreset && problemKey) setSelect('q-problematique', problemKey);
  if (!offerPreset && !journeyPreset && problemKey === 'formation') setSelect('lead-request-type', 'formation');
  const prefillNotice = document.getElementById('qualifier-prefill');
  if (prefillNotice && (offerPreset || journeyPreset)) {
    prefillNotice.hidden = false;
    prefillNotice.textContent = offerPreset
      ? `Offre présélectionnée : ${offerPreset.label}. Vous pouvez modifier chaque réponse.`
      : journeyPreset.message;
  }
  show(0);
})();
