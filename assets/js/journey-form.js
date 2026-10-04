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

function fallbackMail(form, payload, status) {
  const safeLines = [
    `Prénom : ${payload.firstname}`,
    `Nom : ${payload.lastname}`,
    `E-mail : ${payload.email}`,
    payload.organisation ? `Organisation : ${payload.organisation}` : '',
    payload.role ? `Fonction : ${payload.role}` : '',
    payload.collaboration_subject ? `Objet de la collaboration : ${payload.collaboration_subject}` : '',
    payload.collaboration_expectation ? `Recherche : ${payload.collaboration_expectation}` : '',
    payload.expertise_evidence ? `Références publiques / capacités : ${payload.expertise_evidence}` : '',
    payload.motivation ? `Motivation : ${payload.motivation}` : '',
    payload.training_subject ? `Sujet : ${payload.training_subject}` : '',
    payload.learning_objectives ? `Objectifs pédagogiques : ${payload.learning_objectives}` : '',
    payload.audience ? `Public concerné : ${payload.audience}` : '',
    payload.need ? `Contexte / besoin : ${payload.need}` : '',
    '',
    'J’ai relu ces informations avant envoi.'
  ].filter(line => line !== '').join('\n');
  const subject = encodeURIComponent(`BlueWave — ${form.dataset.mailSubject}`);
  const body = encodeURIComponent(`Bonjour,\n\n${safeLines}\n\nCordialement,`);
  const mail = form.querySelector('[data-mail-fallback]');
  mail.href = `mailto:bluewavesolutions3399@gmail.com?subject=${subject}&body=${body}`;
  mail.hidden = false;
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
  const field = errors.find(name => form.elements.namedItem(name));
  const control = field ? form.elements.namedItem(field) : null;
  if (control?.focus) control.focus();
  form.querySelector('[data-form-message]').textContent = 'Certains champs obligatoires ou structurés doivent être vérifiés.';
  window.BlueWaveAutomation?.track('lead_validation_error', {journey: form.dataset.journey, offer: sourceOffer || undefined, status: 'invalid'});
}

function wireForm(form) {
  formState.set(form, {started: false, submitting: false});
  form.addEventListener('focusin', () => markStarted(form), {once: true});
  form.addEventListener('input', () => markStarted(form), {once: true});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = formState.get(form);
    if (state.submitting) return;
    markStarted(form);
    if (!form.reportValidity()) {
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
    try {
      const response = await window.BlueWaveAutomation.submit('lead', payload);
      if (response.configured && response.ok) {
        form.reset();
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
      state.submitting = false;
      button.disabled = false;
    }
  });
}

function wireCollaborationChoice() {
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

function wireTrainingLocation() {
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
