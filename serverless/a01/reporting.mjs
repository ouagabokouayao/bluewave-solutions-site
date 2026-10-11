// Comptes agrégés par fenêtre/canal. Aucune jointure personne ↔ événement.
import {sanitizeEvent} from '../../assets/js/analytics.js';
import {allowedCampaigns} from '../../assets/js/provenance.js';
import {provenanceOf, validateHumanReview, isDate} from './contracts.mjs';
export function buildReport({events = [], leads = [], reviews = [], costs = [], from, to, campaigns = []} = {}) {
  campaigns = allowedCampaigns(campaigns);
  if (!isDate(from) || !isDate(to) || Date.parse(from) >= Date.parse(to)) throw new Error('Fenêtre temporelle invalide');
  const inside = stamp => isDate(stamp) && Date.parse(stamp) >= Date.parse(from) && Date.parse(stamp) < Date.parse(to);
  const buckets = new Map();
  const bucket = (stamp, source, campaign) => {
    const day = new Date(stamp).toISOString().slice(0,10); const key = JSON.stringify([day,source,campaign]);
    if (!buckets.has(key)) buckets.set(key,{day,source,campaign,cta_events:0,submit_attempt_events:0,
      submit_success_events:0,fallback_events:0,accepted_requests:0,human_reviews:0,
      n5:0,pipeline_n5_n8:0,proven_contracts:0,delivery_failures:0});
    return buckets.get(key);
  };
  for (const row of events) {
    const {occurred_at, count, ...event} = row;
    const clean = sanitizeEvent(event,campaigns);
    if (!clean || !inside(occurred_at) || !Number.isSafeInteger(count) || count < 0) throw new Error('Événement agrégé invalide');
    if (clean.event_name === 'page_view') continue;
    const target = bucket(occurred_at, clean.source || 'direct', clean.campaign || '');
    const field = {journey_cta_click:'cta_events',lead_submit_attempt:'submit_attempt_events',
      lead_submit_success:'submit_success_events',lead_submit_fallback_email:'fallback_events'}[clean.event_name];
    if (field) target[field] += count;
  }
  const byId = new Map();
  for (const lead of leads) {
    if (byId.has(lead.id)) throw new Error('Doublon lead_id');
    byId.set(lead.id,lead);
    if (!inside(lead.created_at)) continue;
    const provenance = provenanceOf(lead,campaigns);
    const target = bucket(lead.created_at,provenance.acquisition_source,provenance.campaign_code);
    target.accepted_requests++;
    if (['FAILED','PARTIAL_FAILURE'].includes(lead.delivery_status)) target.delivery_failures++;
  }
  const latestReviews = new Map();
  for (const raw of reviews) {
    const review = validateHumanReview(raw);
    const lead = byId.get(review.lead_id);
    if (!lead || Date.parse(review.reviewed_at) < Date.parse(lead.created_at)) throw new Error('Revue sans demande enregistrée antérieure');
    if (Date.parse(review.reviewed_at) >= Date.parse(to)) continue;
    const previous = latestReviews.get(review.lead_id);
    if (previous && review.reviewed_at === previous.reviewed_at) throw new Error('Revue ambiguë');
    if (!previous || Date.parse(review.reviewed_at) > Date.parse(previous.reviewed_at)) latestReviews.set(review.lead_id,review);
  }
  for (const review of latestReviews.values()) {
    const lead = byId.get(review.lead_id);
    // Cohorte de réception : les décisions sont celles connues à la fin de fenêtre.
    if (!inside(lead.created_at)) continue;
    const p = provenanceOf(lead,campaigns); const target = bucket(lead.created_at,p.acquisition_source,p.campaign_code);
    target.human_reviews++;
    if (review.stage === 'N5') target.n5++;
    if (['N5','N6','N7','N8'].includes(review.stage)) target.pipeline_n5_n8++;
    if (review.stage === 'N9') {
      if (Date.parse(review.contract_at) > Date.parse(review.reviewed_at) || Date.parse(review.contract_at) < Date.parse(lead.created_at)) throw new Error('Chronologie contrat invalide');
      target.proven_contracts++;
    }
  }
  const costRows = costs.map(cost => {
    if (cost.owner !== '01B' || !Number.isSafeInteger(cost.amount_minor) || cost.amount_minor < 0 || !/^[A-Z]{3}$/.test(cost.currency) || !cost.evidence_ref || !inside(cost.occurred_at)) throw new Error('Coût prouvé 01B requis');
    return {currency:cost.currency,amount_minor:cost.amount_minor};
  });
  return {from,to,attribution:'DECLARED_ALLOWLIST_COHORT',event_identity_join:false,unique_visitors:null,
    signed_revenue:null,invoiced_revenue:null,cash_received:null,
    counts:[...buckets.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),costs:costRows,
    limitations:['CTA = événements, pas visiteurs uniques','Repli e-mail exclu des demandes enregistrées',
      'Revue 03 humaine, N9 exclu du pipeline N5-N8','Contrat prouvé ne vaut ni facture ni encaissement','Attribution déclarative, pas preuve causale']};
}
