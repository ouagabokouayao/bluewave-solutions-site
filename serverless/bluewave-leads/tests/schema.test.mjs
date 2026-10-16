import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {EXPERT_POOL_STATUSES, OFFERS, resolveQualifierLeadType, validateLead} from '../../../assets/js/lead-schema.js';
import {SPECIFIC_FIELDS_BY_LEAD_TYPE, fallbackMailBody, specificFieldsForLeadType, wireCollaborationChoice, wireTrainingLocation} from '../../../assets/js/journey-form.js';
import {shouldRenderTrust} from '../../../assets/js/trust.js';
import {validateLeadPayload} from '../validation.mjs';
import {journeyPayload} from '../lead-store.mjs';

const common = Object.freeze({
  journey:'projet', source_offer:'diagnostic-strategique', recommended_offer:'atelier-cadrage',
  lead_type:'projet-mission', organisation_type:'collectivite', territory:'cote-divoire',
  need_category:'projet', stage:'initial', data_availability:'incertain', desired_outcome:'structurer',
  firstname:'Awa', lastname:'Koné', email:'awa@example.invalid', organisation:'Collectivité',
  role:'Cheffe de projet', contact_preference:'email', deadline:'nondef', need:'Structurer un projet côtier.',
  newsletter_optin_request:false, privacy_acknowledged:true, website:'', captcha_token:''
});

test('Projet : source_offer et recommended_offer restent deux valeurs distinctes', () => {
  const result = validateLead(common);
  assert.equal(result.ok, true);
  assert.equal(result.value.source_offer, 'diagnostic-strategique');
  assert.equal(result.value.recommended_offer, 'atelier-cadrage');
  assert.equal(OFFERS.length, 7);
});

test('Projet : journey=projet impose toujours lead_type=projet-mission', () => {
  assert.equal(resolveQualifierLeadType('projet', 'formation'), 'projet-mission');
  assert.equal(resolveQualifierLeadType('projet', 'collaboration'), 'projet-mission');
  assert.equal(resolveQualifierLeadType('projet', 'recherche-expertise'), 'projet-mission');
  assert.equal(resolveQualifierLeadType('formation', 'formation'), 'formation');
});

test('Projet : champ inconnu, enum inconnu et longueur excessive sont rejetés', () => {
  assert.equal(validateLead({...common, secret:'x'}).ok, false);
  assert.equal(validateLead({...common, territory:'inconnu'}).ok, false);
  assert.equal(validateLead({...common, need:'x'.repeat(2001)}).ok, false);
});

test('Collaboration Organisation : champs métier conditionnels obligatoires', () => {
  const payload = {...common, journey:'collaboration', lead_type:'collaboration-organisation', need_category:'collaboration', desired_outcome:'collaborer', collaboration_subject:'Consortium', domains:['gouvernance-maritime'], collaboration_expectation:'Rechercher une compétence complémentaire.'};
  assert.equal(validateLead(payload).ok, true);
  const missing = {...payload}; delete missing.collaboration_expectation;
  assert.equal(validateLead(missing).ok, false);
});

test('Collaboration Expertise : contrat distinct et aucun statut MOBILISABLE', () => {
  const payload = {...common, journey:'collaboration', lead_type:'expertise-offer', organisation:'', organisation_type:'independant', need_category:'expertise', desired_outcome:'proposer-expertise', professional_status:'consultant', expertise_domains:['littoral-adaptation'], intervention_types:['etude'], work_languages:['francais'], availability:'ponctuelle', expertise_evidence:'Référence publique vérifiable.', motivation:'Contribuer à une mission ciblée.', rc_pro:'en-cours'};
  assert.equal(validateLead(payload).ok, true);
  assert.deepEqual(EXPERT_POOL_STATUSES, ['REÇU','À QUALIFIER','QUALIFIÉ','À CONTACTER']);
  assert.equal(EXPERT_POOL_STATUSES.includes('MOBILISABLE'), false);
});

test('Formation : localisation obligatoire en présentiel ou hybride', () => {
  const base = {...common, journey:'formation', lead_type:'formation', need_category:'formation', stage:'formation', data_availability:'non-applicable', desired_outcome:'former', audience:'Agents territoriaux', training_subject:'Gouvernance littorale', learning_objectives:'Savoir qualifier les acteurs.', training_format:'distance', period:'Premier trimestre'};
  assert.equal(validateLead(base).ok, true);
  assert.equal(validateLead({...base, training_format:'presentiel'}).ok, false);
  assert.equal(validateLead({...base, training_format:'hybride'}).ok, false);
  assert.equal(validateLead({...base, training_format:'presentiel', location:'Abidjan'}).ok, true);
  assert.equal(validateLead({...base, training_format:'hybride', location:'Marseille'}).ok, true);
  assert.equal(validateLead({...base, learning_objectives:''}).ok, false);
  assert.equal(validateLead({...base, newsletter_optin_request:true}).ok, false);
  assert.equal(validateLead({...base, sensitive_document:'x'}).ok, false);
});

test('Collaboration : les deux parcours restent distincts, sans statut professionnel présumé', () => {
  const organisation = {...common, journey:'collaboration', lead_type:'collaboration-organisation',
    need_category:'collaboration', desired_outcome:'collaborer', collaboration_subject:'Étude côtière',
    domains:['littoral-adaptation'], collaboration_expectation:'Proposer un cadrage.'};
  assert.equal(validateLeadPayload(organisation).ok, true);
  for (const missing of ['organisation', 'territory', 'collaboration_subject', 'collaboration_expectation']) {
    assert.equal(validateLead({...organisation, [missing]:''}).ok, false, missing);
  }
  assert.equal(validateLead({...organisation, domains:[]}).ok, false);
  assert.equal(validateLead({...organisation, newsletter_optin_request:true}).ok, false);
  assert.equal(validateLead({...organisation, internal_status:'partenaire'}).ok, false);

  const expertise = {...common, journey:'collaboration', lead_type:'expertise-offer', organisation:'',
    organisation_type:'', need_category:'expertise', desired_outcome:'proposer-expertise',
    professional_status:'chercheur', expertise_domains:['environnement-marin'],
    intervention_types:['recherche'], work_languages:['francais'], availability:'a-preciser',
    expertise_evidence:'Publication consultable.', motivation:'Contribuer au terrain.', rc_pro:''};
  const checked = validateLeadPayload(expertise);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.organisation_type, '');
  assert.equal(checked.value.newsletter_consent, false);
  assert.equal(journeyPayload(checked.value).rc_pro, undefined);
  assert.equal(journeyPayload({...checked.value, ip:'192.0.2.1', captcha_token:'fake'}).ip, undefined);
  for (const missing of ['professional_status', 'expertise_evidence', 'motivation']) {
    assert.equal(validateLead({...expertise, [missing]:''}).ok, false, missing);
  }
});

test('Courriel de repli : informations de qualification conservées sans jeton ni newsletter', () => {
  const body = fallbackMailBody({firstname:'Awa', lastname:'Koné', email:'awa@example.invalid',
    training_subject:'Gouvernance littorale', learning_objectives:'Identifier les acteurs',
    audience:'Agents', training_format:'hybride', location:'Abidjan', period:'Novembre',
    participant_count:'20', captcha_token:'do-not-copy', newsletter_optin_request:false});
  for (const text of ['Objectifs pédagogiques', 'Format : hybride', 'Lieu envisagé : Abidjan',
    'Période : Novembre', 'Participants estimés : 20']) assert.ok(body.includes(text));
  assert.doesNotMatch(body, /do-not-copy|newsletter|captcha_token/);
});

test('Clavier : le choix Collaboration révèle et focalise uniquement le bon formulaire', () => {
  const listeners = {};
  const chooser = {addEventListener:(name, listener) => { listeners[name] = listener; }};
  const panels = ['organisation', 'expertise'].map(name => ({dataset:{collaborationPanel:name},
    hidden:false, controls:[{disabled:false}], focus() { this.focused = true; },
    querySelectorAll() { return this.controls; }}));
  const previous = globalThis.document;
  globalThis.document = {querySelector:() => chooser, querySelectorAll:() => panels,
    getElementById:id => panels.find(panel => id === `collaboration-${panel.dataset.collaborationPanel}`)};
  try {
    wireCollaborationChoice();
    assert.ok(panels.every(panel => panel.hidden && panel.controls[0].disabled));
    listeners.change({target:{value:'expertise'}});
    assert.equal(panels[0].hidden, true);
    assert.equal(panels[0].controls[0].disabled, true);
    assert.equal(panels[1].hidden, false);
    assert.equal(panels[1].controls[0].disabled, false);
    assert.equal(panels[1].focused, true);
  } finally { globalThis.document = previous; }
});

test('Formation : format et localisation restent synchronisés lors des changements', () => {
  const listeners = {};
  const format = {value:'', addEventListener:(name, listener) => { listeners[name] = listener; }};
  const location = {required:false, value:''};
  const wrap = {hidden:true};
  const form = {elements:{namedItem:name => name === 'training_format' ? format : location}, querySelector:() => wrap};
  const previous = globalThis.document;
  globalThis.document = {querySelector:() => form};
  try {
    wireTrainingLocation();
    format.value = 'hybride'; listeners.change();
    assert.equal(wrap.hidden, false);
    assert.equal(location.required, true);
    location.value = 'Abidjan';
    format.value = 'distance'; listeners.change();
    assert.equal(wrap.hidden, true);
    assert.equal(location.required, false);
    assert.equal(location.value, '');
  } finally { globalThis.document = previous; }
});

test('Journey form : chaque lead_type reçoit uniquement son schéma explicite', () => {
  assert.deepEqual(specificFieldsForLeadType('collaboration-organisation'), SPECIFIC_FIELDS_BY_LEAD_TYPE['collaboration-organisation']);
  assert.deepEqual(specificFieldsForLeadType('expertise-offer'), SPECIFIC_FIELDS_BY_LEAD_TYPE['expertise-offer']);
  assert.deepEqual(specificFieldsForLeadType('formation'), SPECIFIC_FIELDS_BY_LEAD_TYPE.formation);
  assert.equal(specificFieldsForLeadType('collaboration-organisation').includes('training_subject'), false);
  assert.equal(specificFieldsForLeadType('expertise-offer').includes('training_subject'), false);
  assert.equal(specificFieldsForLeadType('formation').includes('professional_status'), false);
  assert.deepEqual(specificFieldsForLeadType('type-futur-inattendu'), []);
});

test('Serveur : le contrat canonique produit les alias internes sans opt-in direct', () => {
  const result = validateLeadPayload(common);
  assert.equal(result.ok, true);
  assert.equal(result.value.type, 'projet-mission');
  assert.equal(result.value.newsletter_consent, false);
  assert.equal(result.value.source, 'SITE_FORMS');
});

test('Newsletter : une demande forgée est rejetée, indépendamment du lead', () => {
  assert.equal(validateLead({...common, newsletter_optin_request:true}).ok, false);
});

test('Trust : configuration OFF et liste vide ne produisent aucun rendu', async () => {
  const config = JSON.parse(await readFile(new URL('../../../data/trust-config.json', import.meta.url), 'utf8'));
  assert.equal(config.enabled, false);
  assert.deepEqual(config.items, []);
  assert.equal(shouldRenderTrust(config), false);
});

test('Front : formulaires distincts, choix neutres et reset sans PII persistante', async () => {
  const root = new URL('../../../', import.meta.url);
  const [project, collaboration, formation, qualifier, qualifierJs] = await Promise.all([
    readFile(new URL('projet.html', root), 'utf8'), readFile(new URL('collaboration.html', root), 'utf8'),
    readFile(new URL('formation.html', root), 'utf8'), readFile(new URL('qualifier-un-besoin.html', root), 'utf8'),
    readFile(new URL('assets/js/qualifier.js', root), 'utf8')
  ]);
  assert.match(project, /qualifier-un-besoin\.html\?parcours=projet/);
  assert.match(collaboration, /data-lead-type="collaboration-organisation"/);
  assert.match(collaboration, /data-lead-type="expertise-offer"/);
  assert.doesNotMatch(collaboration, /name="organisation_type" value="independant"/);
  assert.match(collaboration, /id="collaboration-expertise" tabindex="-1"/);
  const optionalExpertise = collaboration.match(/<details class="optional-details">[\s\S]*?<\/details>/)?.[0] || '';
  assert.match(optionalExpertise, /<summary>Informations complémentaires facultatives<\/summary>/);
  for (const field of ['phone', 'profile_url', 'website_url', 'orcid', 'portfolio', 'mobility', 'rate_range', 'rc_pro']) {
    assert.match(optionalExpertise, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(optionalExpertise, /\brequired\b/);
  assert.match(formation, /data-lead-type="formation"/);
  assert.doesNotMatch(formation, /name="organisation_type" value="autre"/);
  for (const html of [collaboration, formation]) {
    assert.match(html, /name="privacy_acknowledged"/);
    assert.match(html, /data-mail-fallback/);
    assert.match(html, /noindex, nofollow/);
    assert.doesNotMatch(html, /<input[^>]*type="file"/);
  }
  assert.equal((qualifier.match(/<option value="">Sélectionner…<\/option>/g) || []).length, 7);
  const projectLeadForm = qualifier.match(/<form id="lead-form"[\s\S]*?<\/form>/)?.[0] || '';
  assert.match(projectLeadForm, /<input id="lead-request-type" name="request_type" type="hidden" value="projet-mission">/);
  assert.doesNotMatch(projectLeadForm, /<select id="lead-request-type"/);
  for (const marker of ['form.reset()', 'leadForm?.reset()', 'lastOrientation = null', 'applyPreset(journeyPreset)', 'applyPreset(offerPreset)']) assert.match(qualifierJs, new RegExp(marker.replace(/[?.()]/g, '\\$&')));
  assert.equal(qualifierJs.includes('localStorage'), false);
});
