// Restricted analytics vocabulary. No free text or identity data enters an event.
export const EVENTS = Object.freeze(['page_view','qualifier_open','qualifier_start','qualifier_complete','solution_view','contact_email_click','lead_form_open','lead_submit_attempt','lead_submit_success','lead_submit_fallback_email','meeting_click']);
export const OFFERS = Object.freeze(['diagnostic-strategique','vulnerabilite-cotiere','gouvernance-acteurs','structuration-projet','formation-capacites','note-strategique','atelier-cadrage']);
export const PAGES = Object.freeze(['index','solutions','methode','preuves-demonstrateurs','mediatheque','mediatheque-activites','mediatheque-visualisations','actualites','a-propos','qualifier-un-besoin','contact','domaines','services','notes-demonstrateurs','mentions-legales','politique-confidentialite','404']);
export const SOURCES = Object.freeze(['direct','referral','internal','linkedin','email','qr','event']);
const JOURNEYS = ['projet','collaboration','formation','evenement'];
const STATUSES = ['complete','success','not-configured','unavailable'];
export function sanitizeEvent(input,campaigns=[]) {
 const keys=['event_name','page','journey','offer','status','source','campaign'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key))||!EVENTS.includes(input.event_name)||!PAGES.includes(input.page))return null;
 const event={event_name:input.event_name,page:input.page};
 for(const [key,choices] of Object.entries({journey:JOURNEYS,offer:OFFERS,status:STATUSES,source:SOURCES,campaign:campaigns})) {
  if(input[key] !== undefined && (typeof input[key]!=='string'||!choices.includes(input[key])))return null;
  if(input[key] !== undefined)event[key]=input[key];
 }
 return event;
}
export async function createAnalytics(win,doc,fetchImpl){
 let config={};
 try{const response=await fetchImpl('data/analytics-config.json',{cache:'no-store'});if(response.ok)config=await response.json();}catch{}
 const active=config.enabled===true&&win.navigator.globalPrivacyControl!==true&&win.navigator.doNotTrack!=='1';
 const page=win.location.pathname.split('/').pop().replace(/\.html$/,'')||'index';
 const params=new URLSearchParams(win.location.search);
 const source=SOURCES.includes(params.get('utm_source'))?params.get('utm_source'):(()=>{try{return new URL(doc.referrer).origin===win.location.origin?'internal':'referral';}catch{return'direct';}})();
 const context={page,source};
 for(const [key,value] of Object.entries({journey:params.get('parcours'),offer:params.get('offre'),campaign:params.get('utm_campaign')})) {
  if(value && ({journey:JOURNEYS,offer:OFFERS,campaign:Array.isArray(config.campaigns)?config.campaigns:[]})[key].includes(value))context[key]=value;
 }
 let sent=0;
 const track=(event_name,detail={})=>{
  const allowedCampaigns=(Array.isArray(config.campaigns)?config.campaigns:[]).filter(code=>typeof code==='string'&&/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code));
  const event=sanitizeEvent({...context,...detail,event_name,page},allowedCampaigns);
  if(!event)return;
  win.dispatchEvent(new CustomEvent('bluewave:event',{detail:event}));
  // Traffic belongs to Web Analytics; D1 is reserved for bounded conversion events.
  if(event_name==='page_view'||!active||config.endpoint!=='/api/events'||sent>=100||win.location.protocol!=='https:')return;
  sent++;
  fetchImpl(new URL(config.endpoint,win.location.origin).href,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',referrerPolicy:'no-referrer',keepalive:true,body:JSON.stringify(event)}).catch(()=>{});
 };
 if(active&&/^[a-f0-9]{32}$/.test(config.traffic_token||'')){
  const script=doc.createElement('script');script.src='https://static.cloudflareinsights.com/beacon.min.js';script.type='module';script.defer=true;script.dataset.cfBeacon=JSON.stringify({token:config.traffic_token});doc.head.append(script);
 }
 track('page_view');if(page==='qualifier-un-besoin')track('qualifier_open');if(page==='solutions')track('solution_view');
 return {track};
}
