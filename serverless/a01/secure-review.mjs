// A01 offline review boundary: verified grants and evidence are supplied ONLY by trusted code.
// Raw JSON, owner='03' and approval strings cannot grant access or prove revenue.
import {createHmac, timingSafeEqual} from 'node:crypto';

const CODE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;
const stamp = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const failure = m => {throw new Error(m);};
const safeCompare = (a,b) => {
  if(typeof a!=='string'||typeof b!=='string'||!/^[a-f0-9]{64}$/.test(a)||!/^[a-f0-9]{64}$/.test(b))return false;
  return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
};
const grantPayload = grant => JSON.stringify({ref:grant.ref,subject:grant.subject,scope:grant.scope,purpose:grant.purpose,issued_at:grant.issued_at,expires_at:grant.expires_at,revoked_at:grant.revoked_at??null,privacy:grant.privacy??null});
export const signGrantForTrustedIssuer = (grant, key) => {
  if(typeof key!=='string'||key.length<32)failure('Clé de confiance insuffisante');
  return {...grant,signature:createHmac('sha256',key).update(grantPayload(grant)).digest('hex')};
};
export function verifyContactGrant(grant,{key,now=new Date().toISOString(),isRevoked,checkPrivacy}={}) {
  if(typeof key!=='string'||key.length<32 ||typeof isRevoked!=='function'||typeof checkPrivacy!=='function')return false;
  if(!grant||!CODE.test(grant.ref)||!CODE.test(grant.subject)||grant.scope!=='a01:contacts:03'||grant.purpose!=='crm-review'||!stamp(grant.issued_at)||!stamp(grant.expires_at)||!stamp(now)||grant.revoked_at)return false;
  if(Date.parse(grant.issued_at)>Date.parse(now)||Date.parse(grant.expires_at)<=Date.parse(now)||Date.parse(grant.expires_at)<=Date.parse(grant.issued_at)||isRevoked(grant.ref)!==false)return false;
  const p=grant.privacy;
  if(!p||!CODE.test(p.review_04b_ref)||!CODE.test(p.review_07_ref)||!CODE.test(p.notice_version)||!CODE.test(p.processing_register_ref)|| !['consent','legitimate_interest','contract_preparation'].includes(p.legal_basis) || !Number.isSafeInteger(p.retention_days) || p.retention_days<1 || p.retention_days>3650 || !['EU','EEA'].includes(p.hosting_region) || checkPrivacy(p)!==true)return false;
  return safeCompare(createHmac('sha256',key).update(grantPayload(grant)).digest('hex'),grant.signature);
}
export function verifyEvidence(review,lead,resolver) {
  if(typeof resolver!=='function')return {status:'PENDING_EVIDENCE',need:false,contract:false};
  const check=(ref,kind)=>{
    if(!ref)return false;
    const x=resolver(ref,kind,review.lead_id);
    if(!x||x.ref!==ref||x.kind!==kind||x.verified!==true||x.accessible!==true||x.lead_id!==review.lead_id||!CODE.test(x.checked_by)||!stamp(x.checked_at)||Date.parse(x.checked_at)>Date.parse(review.reviewed_at)||!stamp(x.document_at)||Date.parse(x.document_at)>Date.parse(review.reviewed_at)||Date.parse(x.document_at)<Date.parse(lead.created_at))return false;
    if(kind==='need')return x.explicit_need===true;
    if(kind==='contract')return x.contract_accepted===true && x.contract_valid===true && x.finance_review_01b===true && Number.isSafeInteger(x.amount_minor)&&x.amount_minor>=0&&/^[A-Z]{3}$/.test(x.currency) && stamp(review.contract_at) && Date.parse(x.document_at)<=Date.parse(review.contract_at);
    return false;
  };
  const need=['N5','N6','N7','N8'].includes(review.stage)?check(review.need_evidence_ref,'need'):false;
  const contract=review.stage==='N9'?check(review.contract_evidence_ref,'contract'):false;
  const ok=review.stage==='N9'?contract:review.stage==='N5'||['N6','N7','N8'].includes(review.stage)?need:true;
  return {status:ok?'VERIFIED':'PENDING_EVIDENCE',need,contract};
}
