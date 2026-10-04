import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {EXPERT_POOL_STATUSES, OFFERS, resolveQualifierLeadType, validateLead} from '../../../assets/js/lead-schema.js';
import {SPECIFIC_FIELDS_BY_LEAD_TYPE, specificFieldsForLeadType} from '../../../assets/js/journey-form.js';
import {shouldRenderTrust} from '../../../assets/js/trust.js';
import {validateLeadPayload} from '../validation.mjs';

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
  assert.equal(validateLead({...base, training_format:'hybride', location:'Marseille'}).ok, true);
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
  const optionalExpertise = collaboration.match(/<details class="optional-details">[\s\S]*?<\/details>/)?.[0] || '';
  assert.match(optionalExpertise, /<summary>Informations complémentaires facultatives<\/summary>/);
  for (const field of ['phone', 'profile_url', 'website_url', 'orcid', 'portfolio', 'mobility', 'rate_range', 'rc_pro']) {
    assert.match(optionalExpertise, new RegExp(`name="${field}"`));
  }
  assert.doesNotMatch(optionalExpertise, /\brequired\b/);
  assert.match(formation, /data-lead-type="formation"/);
  assert.equal((qualifier.match(/<option value="">Sélectionner…<\/option>/g) || []).length, 7);
  const projectLeadForm = qualifier.match(/<form id="lead-form"[\s\S]*?<\/form>/)?.[0] || '';
  assert.match(projectLeadForm, /<input id="lead-request-type" name="request_type" type="hidden" value="projet-mission">/);
  assert.doesNotMatch(projectLeadForm, /<select id="lead-request-type"/);
  for (const marker of ['form.reset()', 'leadForm?.reset()', 'lastOrientation = null', 'applyPreset(journeyPreset)', 'applyPreset(offerPreset)']) assert.match(qualifierJs, new RegExp(marker.replace(/[?.()]/g, '\\$&')));
  assert.equal(qualifierJs.includes('localStorage'), false);
});
