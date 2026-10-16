// Tant que la transmission automatisée reste fermée, le courriel préparé est
// le seul canal par lequel une demande atteint BlueWave. Ce test relit les
// formulaires réellement servis et exige que chaque réponse saisie par la
// personne figure dans ce courriel.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fallbackMailBody, specificFieldsForLeadType} from '../../../assets/js/journey-form.js';

const root = new URL('../../../', import.meta.url);
// Champs techniques ou fixés par la page : ils ne portent aucune réponse.
const TECHNICAL = new Set(['website', 'privacy_acknowledged', 'need_category', 'stage',
  'data_availability', 'desired_outcome']);
// Le formulaire Expertise nomme le profil public profile_url ; journey-form le
// transmet sous la clé linkedin du schéma.
const PAYLOAD_KEY = {profile_url: 'linkedin'};

function formsOf(page) {
  const html = readFileSync(new URL(page, root), 'utf8');
  return [...html.matchAll(/<form\b[^>]*data-lead-form[\s\S]*?<\/form>/g)].map(([form]) => ({
    leadType: form.match(/data-lead-type="([^"]+)"/)[1],
    fields: [...new Set([...form.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g)]
      .map(match => match[1]))]
      .filter(name => !TECHNICAL.has(name))
  }));
}

const forms = [...formsOf('collaboration.html'), ...formsOf('formation.html')];

test('Courriel de repli : les trois formulaires de parcours sont couverts', () => {
  assert.deepEqual(forms.map(form => form.leadType).sort(),
    ['collaboration-organisation', 'expertise-offer', 'formation']);
});

for (const {leadType, fields} of forms) {
  test(`Courriel de repli : aucune réponse perdue — ${leadType}`, () => {
    const payload = {};
    for (const name of fields) {
      payload[PAYLOAD_KEY[name] || name] = `valeur-${name}`;
    }
    for (const name of ['domains', 'expertise_domains', 'intervention_types', 'work_languages']) {
      if (fields.includes(name)) payload[name] = [`valeur-${name}-a`, `valeur-${name}-b`];
    }
    const body = fallbackMailBody(payload);
    const lost = fields.filter(name => {
      const expected = Array.isArray(payload[name]) ? payload[name] : [payload[PAYLOAD_KEY[name] || name]];
      return expected.some(value => !body.includes(value));
    });
    assert.deepEqual(lost, [], `réponses absentes du courriel : ${lost.join(', ')}`);
  });

  test(`Courriel de repli : champs spécifiques du schéma relayés — ${leadType}`, () => {
    const payload = Object.fromEntries(specificFieldsForLeadType(leadType)
      .map(field => [field, `schema-${field}`]));
    const body = fallbackMailBody(payload);
    for (const field of specificFieldsForLeadType(leadType)) {
      assert.ok(body.includes(`schema-${field}`), `${leadType} : ${field} absent du courriel`);
    }
  });
}

test('Courriel de repli : échéance non définie omise, jeton et newsletter jamais copiés', () => {
  const body = fallbackMailBody({firstname: 'A', lastname: 'B', email: 'a@example.invalid',
    deadline: 'nondef', captcha_token: 'do-not-copy', newsletter_optin_request: false});
  assert.doesNotMatch(body, /Échéance|do-not-copy|newsletter|captcha_token/);
});
