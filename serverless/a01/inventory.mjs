// Inventaire source/env local, aucune connexion fournisseur ni valeur secrète.
import {readFile} from 'node:fs/promises';
const root = new URL('../../',import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file,root),'utf8'));
const flags = ['LEADS_ENABLED','EVENTS_ENABLED','NEWSLETTER_ENABLED','TURNSTILE_ENABLED','PUBLIC_INDEXABLE'];
const profiles = {};
for(const name of ['wrangler.jsonc','wrangler.preproduction.jsonc','wrangler.production.jsonc']) {
  const profile = await read(`serverless/cloudflare/${name}`);
  profiles[name] = {flags:Object.fromEntries(flags.map(flag=>[flag,profile.vars?.[flag] || 'false'])),
    workers_dev:profile.workers_dev,preview_urls:profile.preview_urls,
    d1_bindings:(profile.d1_databases || []).map(binding=>({binding:binding.binding,id_configured:!!binding.database_id})),
    durable_object_bindings:(profile.durable_objects?.bindings || []).map(binding=>binding.name),
    campaigns_configured:!!profile.vars?.ALLOWED_CAMPAIGNS,lead_retention_configured:!!profile.vars?.LEAD_RETENTION_DAYS};
}
const automation=await read('data/automation-config.json');const analytics=await read('data/analytics-config.json');
const accessKeys=['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','BREVO_API_KEY','TURNSTILE_SECRET_KEY','GUARD_HMAC_KEY'];
console.log(JSON.stringify({scope:'SOURCE_AND_LOCAL_ENV_ONLY',profiles,
  frontend:{lead_endpoint_configured:!!automation.lead_endpoint,newsletter_enabled:automation.newsletter_enabled,turnstile_enabled:automation.turnstile?.enabled,analytics_enabled:analytics.enabled},
  local_access_present:Object.fromEntries(accessKeys.map(key=>[key,!!process.env[key]])),
  remote_runtime:'NON_VERIFIE',remote_secret_presence:'NON_VERIFIE',backups_restore:'NON_VERIFIE',external_calls:0},null,2));
