import {PAGES, SOURCES} from './analytics.js';

// Attribution déclarée, jamais preuve de l'identité ou du canal réel.
export const CAMPAIGN_CODE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export function allowedCampaigns(value = []) {
  const codes = typeof value === 'string' ? value.split(',') : value;
  return Array.isArray(codes) ? codes.filter(code => typeof code === 'string' && CAMPAIGN_CODE.test(code)) : [];
}
export function cleanProvenance(input = {}, campaigns = []) {
  return {
    acquisition_source: SOURCES.includes(input.acquisition_source) ? input.acquisition_source : 'direct',
    campaign_code: allowedCampaigns(campaigns).includes(input.campaign_code) ? input.campaign_code : '',
    landing_page: PAGES.includes(input.landing_page) ? input.landing_page : ''
  };
}
export function provenanceFromLocation(location, campaigns = [], referrer = '') {
  const params = new URLSearchParams(location.search);
  let source = 'direct';
  try { source = new URL(referrer).origin === location.origin ? 'internal' : 'referral'; } catch { /* entrée directe */ }
  return cleanProvenance({
    acquisition_source: params.get('utm_source') || source,
    campaign_code: params.get('utm_campaign'),
    landing_page: PAGES.includes(params.get('bw_landing')) ? params.get('bw_landing')
      : location.pathname.split('/').pop().replace(/\.html$/, '') || 'index'
  }, campaigns);
}
export function campaignLink(href, origin, provenance) {
  const target = new URL(href, origin);
  if (target.origin !== origin || !target.pathname.endsWith('.html')) return href;
  target.searchParams.set('utm_source', provenance.acquisition_source);
  if (provenance.landing_page) target.searchParams.set('bw_landing', provenance.landing_page);
  if (provenance.campaign_code) target.searchParams.set('utm_campaign', provenance.campaign_code);
  else target.searchParams.delete('utm_campaign');
  return target.href;
}
