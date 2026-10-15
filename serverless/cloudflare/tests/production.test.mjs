import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

test('robots stay closed by default, open only on the approved host profile', async () => {
 const ASSETS={fetch:async () => new Response('<html></html>',{headers:{'content-type':'text/html'}})};
 for (const [flag,expected] of [[undefined,'noindex, nofollow'],['false','noindex, nofollow'],['true','index, follow']]) {
  const result=await worker.fetch(new Request('https://www.bluewavesolutions.fr/index.html'),{ASSETS,PUBLIC_INDEXABLE:flag});
  assert.equal(result.headers.get('x-robots-tag'),expected);
 }
 const missing=await worker.fetch(new Request('https://www.bluewavesolutions.fr/404.html'),{ASSETS,PUBLIC_INDEXABLE:'true'});
 assert.equal(missing.headers.get('x-robots-tag'),'noindex, nofollow');
});

test('daily purge deletes rows older than thirteen calendar months, without lead data', async () => {
 let statement,cutoff,executed=false;
 const db={prepare(sql){statement=sql;return {bind(value){cutoff=value;return {async run(){executed=true}}}}}};
 await worker.scheduled({}, {CONVERSION_DB:db});
 assert.equal(statement,'DELETE FROM conversion_counts WHERE day < ?');
 assert.match(cutoff,/^\d{4}-\d{2}-\d{2}$/);
 const date=new Date(cutoff+'T00:00:00Z');
 const now=new Date();
 const months=(now.getUTCFullYear()-date.getUTCFullYear())*12+now.getUTCMonth()-date.getUTCMonth();
 assert.equal(months,13);
 assert.equal(executed,true);
});

test('traffic page views cannot be stored in the conversion database', async () => {
 let writes=0;
 const origin='https://www.bluewavesolutions.fr';
 const env={EVENTS_ENABLED:'true',CONVERSION_DB:{prepare(){writes++;throw new Error('unexpected write')}}};
 const request=new Request(origin+'/api/events',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({event_name:'page_view',page:'index'})});
 assert.equal((await worker.fetch(request,env)).status,400);
 assert.equal(writes,0);
});
