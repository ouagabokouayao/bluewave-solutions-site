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
  let current = 0;

  const labels = {
    territoire:{med:'France / Méditerranée',ci:"Côte d’Ivoire",ao:"Afrique de l’Ouest",autre:'un autre territoire',multi:'plusieurs territoires',preciser:'un territoire à préciser'},
    probleme:{vulnerabilite:'vulnérabilité côtière / adaptation',strategie:'stratégie maritime, littorale ou portuaire',gouvernance:"gouvernance / acteurs / conflits d’usage",sfn:'Solutions fondées sur la Nature',projet:"structuration d’un projet côtier ou maritime",planification:'planification littorale / coordination territoriale',formation:'formation / concertation / médiation',multiple:'plusieurs problématiques',indetermine:'un besoin encore à qualifier'},
    stade:{initial:'question initiale',flou:'besoin encore flou',cadrage:'cadrage en cours',etude:'étude ou diagnostic déjà engagé',structure:'projet structuré à approfondir',decision:'décision ou arbitrage proche',concertation:'concertation à préparer',formation:'formation à organiser'},
    resultat:{comprendre:'comprendre une situation',options:'comparer des options',acteurs:'identifier les acteurs, usages et tensions',structurer:'structurer un projet',route:'préparer une feuille de route',concertation:'préparer une concertation',former:'former ou aligner une équipe',note:"produire une note courte d’aide à la décision",perimetre:'définir le bon périmètre'}
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

  const canonicalMethod = 'Qualifier → cadrer → analyser → cartographier → structurer → contrôler → restituer → capitaliser.';
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
      return ["Pré-diagnostic stratégique de vulnérabilité côtière et options d’adaptation",'La situation appelle un cadrage des vulnérabilités, usages, données et options avant toute expertise technique complète.','données physiques disponibles, périmètre, niveau de terrain et expertises spécialisées nécessaires'];
    }
    if (v.problematique === 'projet' || ['structurer','route'].includes(v.resultat) || v.stade === 'structure') {
      return ["Structuration de projets maritimes, littoraux ou d’économie bleue",'Le besoin dominant est de transformer une intention ou un projet existant en logique d’action lisible et présentable.','objectif, portage, acteurs, ressources, dépendances et prochaine décision'];
    }
    return ["Diagnostic stratégique d’amont — maritime, littoral ou portuaire",'La situation exige une lecture transversale avant arbitrage ou approfondissement spécialisé.','question de décision, périmètre, sources disponibles et limites techniques à qualifier'];
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
    document.getElementById('result-title').textContent = 'Une première orientation pour cadrer la suite.';
    document.getElementById('result-summary').textContent = summary;
    document.getElementById('result-offer').textContent = `${offer}. ${why}`;
    document.getElementById('result-method').textContent = `${canonicalMethod} L’intensité de certaines étapes sera adaptée au besoin réel.`;
    document.getElementById('result-confirm').textContent = `À confirmer : ${confirm}.`;
    const subject = encodeURIComponent(`BlueWave — qualification d’un besoin — ${offer}`);
    const body = encodeURIComponent(`Bonjour,\n\nJe souhaite présenter le besoin suivant à BlueWave Solutions.\n\n${summary}\n\nOrientation indicative affichée : ${offer}.\n\nJe comprends que cette orientation ne constitue ni un diagnostic ni une proposition commerciale.\n\nCordialement,`);
    document.getElementById('result-mail').href = `mailto:bluewavesolutions3399@gmail.com?subject=${subject}&body=${body}`;
    result.hidden = false;
    result.scrollIntoView({behavior:'smooth',block:'start'});
  });
  restart.addEventListener('click', () => { result.hidden = true; show(0); form.scrollIntoView({behavior:'smooth',block:'start'}); });

  const params = new URLSearchParams(location.search);
  const p = params.get('problematique');
  if (p && [...document.getElementById('q-problematique').options].some(o => o.value === p)) document.getElementById('q-problematique').value = p;
  show(0);
})();
