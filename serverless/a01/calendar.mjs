// Lecture du CSV C01 de 02 : conservation des 12 colonnes, aucune approbation inférée.
import {isCode} from './contracts.mjs';
export const C01_COLUMNS = Object.freeze(['ID','Date indicative','Semaine','Pilier','Série','Sujet','Format','Canal primaire','Réemploi','CTA','État','Condition publication']);
function csvRows(text) {
  const rows=[];let row=[],cell='',quoted=false;
  const input=String(text).replace(/^\uFEFF/,'');
  for(let index=0;index<input.length;index++) {
    const character=input[index];
    if(character==='"') {
      if(quoted && input[index+1]==='"') {cell+='"';index++;}
      else if(!quoted && cell)throw new Error('CSV citation invalide');
      else quoted=!quoted;
    } else if(!quoted && character===';') {row.push(cell);cell='';}
    else if(!quoted && (character==='\r'||character==='\n')) {
      if(character==='\r' && input[index+1]==='\n')index++;
      row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';
    } else cell+=character;
  }
  if(quoted)throw new Error('CSV citation non fermée');
  if(cell || row.length){row.push(cell);rows.push(row);}
  return rows;
}
export async function importC01Calendar(text) {
  const [header,...rows]=csvRows(text);
  if(!header || JSON.stringify(header)!==JSON.stringify(C01_COLUMNS))throw new Error('Colonnes C01 incompatibles');
  const seen=new Set();
  const contents=rows.map(row=>{
    if(row.length!==C01_COLUMNS.length)throw new Error('Ligne C01 incomplète');
    const source=Object.fromEntries(C01_COLUMNS.map((column,index)=>[column,row[index]]));
    if(!isCode(source.ID) || seen.has(source.ID) || !/^\d{4}-\d{2}-\d{2}$/.test(source['Date indicative']))throw new Error('ID/date C01 invalide ou doublon');
    seen.add(source.ID);
    return {content_id:source.ID,indicative_date:source['Date indicative'],source_row:source,
      status:'DRAFT',version_hash:null,networks:[],assets:[],go_reference:null,scheduled_id:null};
  });
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return {source_calendar_sha256:[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),
    rows:contents.length,columns:C01_COLUMNS.length,calendar_modified:false,external_calls:0,contents};
}
