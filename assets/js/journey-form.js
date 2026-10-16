import {hasCanonicalOffer, validateLead} from './lead-schema.js';

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const sourceOffer = hasCanonicalOffer(params.get('offre')) ? params.get('offre') : '';
const formState = new WeakMap();

function formValue(form, name) {
  const data = new FormData(form);
  const values = data.getAll(name).map(value => String(value).trim()).filter(Boolean);
  return values.length > 1 ? values : (values[0] || '');
}

function formValues(form, name) {
  return new FormData(form).getAll(name).map(value => String(value).trim()).filter(Boolean);
}

export const SPECIFIC_FIELDS_BY_LEAD_TYPE = Object.freeze({
  'collaboration-organisation': Object.freeze(['collaboration_subject', 'domains', 'collaboration_expectation', 'collaboration_form', 'public_reference', 'organisation_website']),
  'expertise-offer': Object.freeze(['professional_status', 'expertise_domains', 'intervention_types', 'work_languages', 'availability', 'expertise_evidence', 'motivation', 'phone', 'linkedin', 'website_url', 'orcid', 'portfolio', 'mobility', 'rate_range', 'rc_pro']),
  formation: Object.freeze(['audience', 'training_subject', 'learning_objectives', 'training_format', 'period', 'participant_count', 'training_level', 'location', 'duration', 'customization', 'context'])
});

export function specificFieldsForLeadType(leadType) {
  return SPECIFIC_FIELDS_BY_LEAD_TYPE[leadType] || [];
}

function payloadFor(form) {
  const leadType = form.dataset.leadType;
  const journey = form.dataset.journey;
  const payload = {
    journey,
    source_offer: sourceOffer,
    recommended_offer: form.dataset.recommendedOffer || '',
    lead_type: leadType,
    organisation_type: formValue(form, 'organisation_type'),
    territory: formValue(form, 'territory'),
    need_category: formValue(form, 'need_category'),
    stage: formValue(form, 'stage'),
    data_availability: formValue(form, 'data_availability'),
    desired_outcome: formValue(form, 'desired_outcome'),
    firstname: formValue(form, 'firstname'),
    lastname: formValue(form, 'lastname'),
    email: formValue(form, 'email'),
    organisation: formValue(form, 'organisation'),
    role: formValue(form, 'role'),
    contact_preference: formValue(form, 'contact_preference'),
    deadline: formValue(form, 'deadline'),
    need: formValue(form, 'need'),
    newsletter_optin_request: false,
    privacy_acknowledged: formValue(form, 'privacy_acknowledged') === 'yes',
    website: formValue(form, 'website'),
    captcha_token: '',
  };
  const specific = specificFieldsForLeadType(leadType);
  for (const field of specific) payload[field] = formValue(form, field);
  if (leadType === 'expertise-offer') payload.linkedin = formValue(form, 'profile_url');
  for (const field of ['domains', 'expertise_domains', 'intervention_types', 'work_languages']) {
    if (specific.includes(field)) payload[field] = formValues(form, field);
  }
  return payload;
}

// Tant que la transmission automatisée est fermée, ce courriel est le seul
// canal réel : chaque réponse saisie dans un formulaire doit y figurer.
const listLine = (label, value) => {
  const items = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return items.length ? `${label} : ${items.join(', ')}` : '';
};

export function fallbackMailBody(payload) {
  return [
    `Prénom : ${payload.firstname}`,
    `Nom : ${payload.lastname}`,
    `E-mail : ${payload.email}`,
    payload.organisation ? `Organisation : ${payload.organisation}` : '',
    payload.organisation_type ? `Type d’organisation : ${payload.organisation_type}` : '',
    payload.role ? `Fonction : ${payload.role}` : '',
    payload.territory ? `Territoire : ${payload.territory}` : '',
    payload.organisation_website ? `Site web de l’organisation : ${payload.organisation_website}` : '',
    payload.collaboration_subject ? `Objet de la collaboration : ${payload.collaboration_subject}` : '',
    listLine('Domaines concernés', payload.domains),
    payload.collaboration_expectation ? `Recherche : ${payload.collaboration_expectation}` : '',
    payload.collaboration_form ? `Forme envisagée : ${payload.collaboration_form}` : '',
    payload.public_reference ? `Référence publique : ${payload.public_reference}` : '',
    payload.professional_status ? `Statut professionnel : ${payload.professional_status}` : '',
    payload.availability ? `Disponibilité : ${payload.availability}` : '',
    listLine('Domaines de compétence', payload.expertise_domains),
    listLine('Types d’intervention', payload.intervention_types),
    listLine('Langues de travail', payload.work_languages),
    payload.expertise_evidence ? `Références publiques / capacités : ${payload.expertise_evidence}` : '',
    payload.motivation ? `Motivation : ${payload.motivation}` : '',
    payload.phone ? `Téléphone : ${payload.phone}` : '',
    payload.linkedin ? `Profil professionnel public : ${payload.linkedin}` : '',
    payload.website_url ? `Site : ${payload.website_url}` : '',
    payload.orcid ? `ORCID : ${payload.orcid}` : '',
    payload.portfolio ? `Portfolio : ${payload.portfolio}` : '',
    payload.mobility ? `Zone de mobilité : ${payload.mobility}` : '',
    payload.rate_range ? `Tarif ou fourchette : ${payload.rate_range}` : '',
    payload.rc_pro ? `RC Pro : ${payload.rc_pro}` : '',
    payload.training_subject ? `Sujet : ${payload.training_subject}` : '',
    payload.learning_objectives ? `Objectifs pédagogiques : ${payload.learning_objectives}` : '',
    payload.audience ? `Public concerné : ${payload.audience}` : '',
    payload.training_level ? `Niveau : ${payload.training_level}` : '',
    payload.training_format ? `Format : ${payload.training_format}` : '',
    payload.location ? `Lieu envisagé : ${payload.location}` : '',
    payload.period ? `Période : ${payload.period}` : '',
    payload.duration ? `Durée souhaitée : ${payload.duration}` : '',
    payload.participant_count ? `Participants estimés : ${payload.participant_count}` : '',
    payload.customization ? `Adaptation attendue : ${payload.customization}` : '',
    payload.context ? `Contexte de la formation : ${payload.context}` : '',
    payload.deadline && payload.deadline !== 'nondef' ? `Échéance : ${payload.deadline}` : '',
    payload.need ? `Contexte / besoin : ${payload.need}` : '',
    payload.contact_preference ? `Préférence de contact : ${payload.contact_preference}` : '',
    '',
    'J’ai relu ces informations avant envoi.'
  ].filter(line => line !== '').join('\n');
}

// Certaines messageries tronquent un lien mailto long sans prévenir. Le
// message complet reste donc toujours lisible et copiable dans la page.
export function preparedMessage(subject, safeLines) {
  return `À : bluewavesolutions3399@gmail.com\nObjet : ${subject}\n\nBonjour,\n\n${safeLines}\n\nCordialement,`;
}

function copyBox(form) {
  let box = form.querySelector('[data-mail-copy]');
  if (box) return box;
  box = document.createElement('div');
  box.className = 'mail-copy';
  box.dataset.mailCopy = '';
  box.hidden = true;
  box.style.marginTop = '1.25rem';
  const id = `${form.querySelector('[name="email"]')?.id || 'lead'}-message-prepare`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = 'Message préparé — si votre messagerie le tronque, copiez-le et collez-le dans un nouveau courriel';
  const area = document.createElement('textarea');
  area.id = id;
  area.readOnly = true;
  area.rows = 8;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.textContent = 'Copier le message';
  const status = document.createElement('p');
  status.className = 'note';
  status.setAttribute('aria-live', 'polite');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(area.value);
    } catch {
      area.select();
      document.execCommand?.('copy');
    }
    status.textContent = 'Message copié.';
  });
  box.append(label, area, button, status);
  form.querySelector('[data-form-message]').after(box);
  return box;
}

function fallbackMail(form, payload, status) {
  const safeLines = fallbackMailBody(payload);
  const plainSubject = `BlueWave — ${form.dataset.mailSubject}`;
  const subject = encodeURIComponent(plainSubject);
  const body = encodeURIComponent(`Bonjour,\n\n${safeLines}\n\nCordialement,`);
  const mail = form.querySelector('[data-mail-fallback]');
  mail.href = `mailto:bluewavesolutions3399@gmail.com?subject=${subject}&body=${body}`;
  mail.hidden = false;
  const box = copyBox(form);
  box.querySelector('textarea').value = preparedMessage(plainSubject, safeLines);
  box.querySelector('.note').textContent = '';
  box.hidden = false;
  window.BlueWaveAutomation?.track('lead_submit_fallback_email', {journey: payload.journey, offer: payload.source_offer || undefined, status});
  mail.focus();
}

function markStarted(form) {
  const state = formState.get(form);
  if (state.started) return;
  state.started = true;
  window.BlueWaveAutomation?.track('lead_form_start', {journey: form.dataset.journey, offer: sourceOffer || undefined});
}

function showSchemaError(form, errors) {
  const field = errors.find(name => [...form.elements].some(control => control.name === name && !control.disabled && control.type !== 'hidden'));
  const control = field ? [...form.elements].find(item => item.name === field && !item.disabled && item.type !== 'hidden') : null;
  if (control) { control.setAttribute('aria-invalid', 'true'); control.focus(); }
  form.querySelector('[data-form-message]').textContent = 'Certains champs obligatoires ou structurés doivent être vérifiés.';
  window.BlueWaveAutomation?.track('lead_validation_error', {journey: form.dataset.journey, offer: sourceOffer || undefined, status: 'invalid'});
}

function wireForm(form) {
  formState.set(form, {started: false, submitting: false});
  const clearFeedback = event => {
    if (event.target.closest?.('[data-mail-copy]')) return;
    event.target.removeAttribute?.('aria-invalid');
    form.querySelector('[data-mail-fallback]').hidden = true;
    const copy = form.querySelector('[data-mail-copy]');
    if (copy) copy.hidden = true;
    form.querySelector('[data-form-message]').textContent = '';
  };
  form.addEventListener('input', clearFeedback);
  form.addEventListener('change', clearFeedback);
  form.addEventListener('focusin', () => markStarted(form), {once: true});
  form.addEventListener('input', () => markStarted(form), {once: true});
  // Rendu anticipé du défi dès la première interaction : le jeton est prêt
  // avant la validation, et rien n'apparaît si le service est fermé.
  form.addEventListener('focusin', () => {
    window.BlueWaveAutomation?.turnstile?.().then(guard => guard.prepare?.(form)).catch(() => {});
  }, {once: true});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = formState.get(form);
    if (state.submitting) return;
    markStarted(form);
    form.querySelector('[data-mail-fallback]').hidden = true;
    if (!form.reportValidity()) {
      form.querySelector('[data-form-message]').textContent = 'Vérifiez les champs obligatoires ou le format de votre réponse.';
      window.BlueWaveAutomation?.track('lead_validation_error', {journey: form.dataset.journey, offer: sourceOffer || undefined, status: 'invalid'});
      return;
    }
    const validation = validateLead(payloadFor(form));
    if (!validation.ok) { showSchemaError(form, validation.errors); return; }
    const payload = validation.value;
    state.submitting = true;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('[data-form-message]');
    button.disabled = true;
    message.textContent = 'Préparation de la transmission…';
    window.BlueWaveAutomation?.track('lead_submit_attempt', {journey: payload.journey, offer: payload.source_offer || undefined});
    const guard = await window.BlueWaveAutomation?.turnstile?.().catch(() => null);
    try {
      // Un jeton est à usage unique : il est demandé au moment de l'envoi, puis
      // le défi est réarmé, que la transmission ait abouti ou non. Les réponses
      // déjà saisies ne sont jamais perdues par ce renouvellement.
      if (guard?.enabled) payload.captcha_token = await guard.token(form);
      const response = await window.BlueWaveAutomation.submit('lead', payload);
      if (response.configured && response.ok) {
        form.reset();
        form.querySelectorAll('[aria-invalid="true"]').forEach(control => control.removeAttribute('aria-invalid'));
        form.elements.namedItem('training_format')?.dispatchEvent(new Event('change', {bubbles: true}));
        message.textContent = 'Votre demande a bien été transmise à BlueWave Solutions.';
        window.BlueWaveAutomation.track('lead_submit_success', {journey: payload.journey, offer: payload.source_offer || undefined, status: 'success'});
        await window.BlueWaveAutomation.showMeeting();
      } else {
        fallbackMail(form, payload, 'not-configured');
        message.textContent = 'La transmission automatique est désactivée. Votre message est prêt : relisez-le, puis envoyez-le depuis votre messagerie.';
      }
    } catch {
      fallbackMail(form, payload, 'unavailable');
      message.textContent = 'La transmission est indisponible. Relisez le courriel préparé avant de l’envoyer.';
    } finally {
      if (guard?.enabled) guard.reset(form);
      payload.captcha_token = '';
      state.submitting = false;
      button.disabled = false;
    }
  });
}

export function wireCollaborationChoice() {
  const chooser = document.querySelector('[data-collaboration-choice]');
  if (!chooser) return;
  const panels = [...document.querySelectorAll('[data-collaboration-panel]')];
  const select = value => {
    panels.forEach(panel => {
      const active = panel.dataset.collaborationPanel === value;
      panel.hidden = !active;
      panel.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = !active; });
    });
    document.getElementById(`collaboration-${value}`)?.focus();
  };
  chooser.addEventListener('change', event => select(event.target.value));
  panels.forEach(panel => { panel.hidden = true; panel.querySelectorAll('input, select, textarea, button').forEach(control => { control.disabled = true; }); });
}

export function wireTrainingLocation() {
  const form = document.querySelector('form[data-lead-type="formation"]');
  const format = form?.elements.namedItem('training_format');
  const wrap = form?.querySelector('[data-location-field]');
  const locationField = form?.elements.namedItem('location');
  if (!format || !wrap || !locationField) return;
  const update = () => {
    const relevant = ['presentiel', 'hybride'].includes(format.value);
    wrap.hidden = !relevant;
    locationField.required = relevant;
    if (!relevant) locationField.value = '';
  };
  format.addEventListener('change', update);
  update();
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-lead-form]').forEach(wireForm);
  wireCollaborationChoice();
  wireTrainingLocation();
  document.querySelectorAll('[data-project-start]').forEach(link => {
    const query = new URLSearchParams({parcours: 'projet'});
    if (sourceOffer) query.set('offre', sourceOffer);
    link.href = `qualifier-un-besoin.html?${query}`;
  });
  if (sourceOffer) {
    document.querySelectorAll('[data-source-offer]').forEach(node => { node.hidden = false; node.textContent = `Offre d’origine conservée : ${sourceOffer}.`; });
    window.BlueWaveAutomation?.track('offer_contact_transition', {journey: document.body.dataset.journey, offer: sourceOffer});
  }
}
