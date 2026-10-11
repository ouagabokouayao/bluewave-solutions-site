// Outil local d'exports A01. Aucune connexion réseau, CRM ou scheduler.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareHandoff} from './contracts.mjs';
import {prepareSchedule} from './editorial.mjs';
import {importC01Calendar} from './calendar.mjs';
import {buildReport} from './reporting.mjs';
const [kind,inputPath,outputPath,authorization]=process.argv.slice(2);
if (!['handoff','schedule','report','calendar'].includes(kind) || !inputPath || !outputPath) throw new Error('Usage : node prepare.mjs handoff|schedule|report|calendar input.json|csv /chemin/hors-depot/output.json [--sensitive-handoff]');
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(await realpath(dirname(resolve(outputPath))),basename(outputPath));
const relativeOutput=relative(await realpath(root),output);
if (!isAbsolute(outputPath) || !(relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`) || isAbsolute(relativeOutput))) throw new Error('Export hors dépôt requis');
const raw=await readFile(inputPath,'utf8');
const input=kind==='calendar'?null:JSON.parse(raw);
const result=kind==='calendar' ? await importC01Calendar(raw) : kind==='handoff' ? prepareHandoff(input.records,{campaigns:input.campaigns,enabled:true,
  includeContact:authorization==='--sensitive-handoff',contactAccessApprovedBy:input.contact_access_approved_by})
  : kind==='schedule' ? prepareSchedule(input.contents,input.options) : buildReport(input);
await writeFile(output,JSON.stringify(result,null,2)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
console.log(JSON.stringify({kind,export_created:true,external_calls:0,master_crm_written:false}));
