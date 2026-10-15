// Adaptateur de calendrier C01 : un plan local, aucune API de programmation.
import {isCode, isDate} from './contracts.mjs';
import {cleanProvenance, campaignLink} from '../../assets/js/provenance.js';
const STATUSES = ['DRAFT','REVIEW','APPROVED'];
const valid = (condition, message) => { if (!condition) throw new Error(message); };
export function validateContent(content, campaigns = [], approvedOrigins = []) {
  valid(isCode(content?.content_id) && /^[a-f0-9]{64}$/.test(content.version_hash), 'Identifiant/version de contenu requis');
  valid(STATUSES.includes(content.status), 'Statut éditorial invalide');
  valid(Array.isArray(content.networks) && content.networks.length > 0 && new Set(content.networks).size === content.networks.length && content.networks.every(isCode), 'Réseaux requis');
  valid(Array.isArray(content.assets) && content.assets.every(asset => isCode(asset.asset_id) && asset.rights_approved === true), 'Droits des médias requis');
  const provenance = cleanProvenance({acquisition_source:content.source, campaign_code:content.campaign_code}, campaigns);
  valid(provenance.acquisition_source === content.source && provenance.campaign_code === content.campaign_code && !!content.campaign_code, 'Campagne approuvée requise');
  if (content.status === 'APPROVED') valid(content.reviewer === '02' && isDate(content.approved_at) && content.approved_hash === content.version_hash, 'Validation 02 liée à la version requise');
  const url = new URL(content.destination);
  valid(url.protocol === 'https:' && !url.username && !url.password, 'Destination HTTPS requise');
  const trustedOrigin = Array.isArray(approvedOrigins) ? approvedOrigins.find(origin => { try {const u=new URL(origin);return u.protocol==='https:' && u.origin===origin && u.origin===url.origin;}catch{return false;} }) : null;
  // Un brouillon peut rester préparé hors ligne. Aucun lien suivi ni GO opérationnel sans hôte approuvé.
  valid([...url.searchParams.keys()].every(key => ['offre','parcours','utm_source','utm_campaign','bw_landing'].includes(key)), 'Paramètre de destination non autorisé');
  return {...content, destination_approved:!!trustedOrigin, tracked_link:trustedOrigin ? campaignLink(content.destination, trustedOrigin, provenance) : null};
}
export function transitionContent(content, status, approval = {}) {
  valid(STATUSES.indexOf(status) === STATUSES.indexOf(content.status) + 1, 'Transition éditoriale invalide');
  const next = {...content, status};
  if (status === 'APPROVED') Object.assign(next, {reviewer:approval.reviewer, approved_at:approval.approved_at, approved_hash:content.version_hash});
  return next;
}
export function reviseContent(content, versionHash) {
  return {...content, version_hash:versionHash, status:'DRAFT', reviewer:null, approved_at:null, approved_hash:null, go_reference:null, scheduled_id:null};
}
export function prepareSchedule(contents, {campaigns = [], go = null, accounts = [], enabled = false, approvedOrigins = []} = {}) {
  const keys = new Set();
  const plans = contents.map(input => {
    const content = validateContent(input, campaigns, approvedOrigins);
    valid(isDate(content.scheduled_at), 'Date cible requise');
    valid(content.scheduled_id == null, 'Contenu déjà programmé');
    for (const network of content.networks) {
      const key = `${content.content_id}:${content.version_hash}:${network}`;
      valid(!keys.has(key), 'Doublon de programmation'); keys.add(key);
    }
    const authorized = enabled && content.destination_approved === true && content.status === 'APPROVED' && go?.owner === 'Joseph' &&
      isCode(go.reference) && go.version_hash === content.version_hash && go.content_id === content.content_id &&
      content.networks.every(network => accounts.some(account => account.network === network && account.authorized === true && isCode(account.account_id) && go.account_ids?.includes(account.account_id)));
    return {content_id:content.content_id, version_hash:content.version_hash, networks:content.networks,
      assets:content.assets, status:'DRY_RUN', ready_for_manual_execution:!!authorized,
      blocked_by:authorized ? null : content.destination_approved ? 'APPROVAL_GO_ACCOUNT_OR_SWITCH_MISSING' : 'UNAPPROVED_DESTINATION', scheduled_id:null,
      scheduled_at:content.scheduled_at, tracked_link:content.tracked_link};
  });
  return {dry_run:true, external_calls:0, plans};
}
