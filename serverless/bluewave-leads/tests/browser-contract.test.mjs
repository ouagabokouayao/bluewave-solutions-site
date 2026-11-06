// Le navigateur envoie la valeur issue de validateLead : le serveur doit
// accepter exactement cette valeur, listes facultatives vides comprises.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLead} from '../../../assets/js/lead-schema.js';
import {validateLeadPayload} from '../validation.mjs';

const identity = {firstname: 'Awa', lastname: 'Koné', email: 'awa@example.invalid', newsletter_optin_request: false,
  privacy_acknowledged: true, website: '', captcha_token: '', contact_preference: 'email'};
const journeys = {
  projet: {...identity, journey: 'projet', lead_type: 'projet-mission', organisation: 'Commune test', organisation_type: 'collectivite',
    territory: 'france-mediterranee', need_category: 'vulnerabilite', stage: 'flou', data_availability: 'etudes', desired_outcome: 'options', need: 'Besoin test', deadline: '3-6m'},
  'collaboration organisation': {...identity, journey: 'collaboration', lead_type: 'collaboration-organisation', organisation: 'Bureau test', organisation_type: 'bureau',
    territory: 'france-mediterranee', collaboration_subject: 'Objet', domains: ['gouvernance-maritime'], collaboration_expectation: 'Attente', organisation_website: ''},
  'collaboration expertise': {...identity, journey: 'collaboration', lead_type: 'expertise-offer', territory: 'cote-divoire', professional_status: 'consultant',
    expertise_domains: ['gouvernance-maritime'], intervention_types: ['cartographie'], work_languages: ['francais'], availability: 'ponctuelle', expertise_evidence: 'Références', motivation: 'Motivation'},
  formation: {...identity, journey: 'formation', lead_type: 'formation', organisation: 'Organisme test', audience: 'Agents', training_subject: 'Sujet',
    learning_objectives: 'Objectifs', training_format: 'distance', period: 'Novembre'}
};
for (const [name, form] of Object.entries(journeys)) {
  test(`contrat navigateur-serveur : ${name}`, () => {
    const browser = validateLead(form);
    assert.equal(browser.ok, true, String(browser.errors));
    const server = validateLeadPayload(JSON.parse(JSON.stringify(browser.value)));
    assert.equal(server.ok, true, String(server.errors));
  });
}
test('une liste obligatoire vide reste refusée', () => {
  const result = validateLead({...journeys['collaboration organisation'], domains: []});
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('domains'));
});
