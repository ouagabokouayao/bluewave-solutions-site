import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {sanitizeEvent} from '../../../assets/js/analytics.js';

test('conversion vocabulary rejects identity and free text', () => {
 assert.equal(sanitizeEvent({event_name:'qualifier_complete', page:'qualifier-un-besoin', offer:'note-strategique', email:'private@example.invalid'}), null);
 assert.equal(sanitizeEvent({event_name:'qualifier_complete', page:'qualifier-un-besoin', campaign:'arbitrary'}),null);
 assert.deepEqual(sanitizeEvent({event_name:'qualifier_complete', page:'qualifier-un-besoin', offer:'note-strategique'}), {event_name:'qualifier_complete', page:'qualifier-un-besoin', offer:'note-strategique'});
 assert.equal(sanitizeEvent({event_name:'private',page:'index'}),null);
});
test('API disabled by default; static assets still served', async () => {
 const env={ASSETS:{fetch:async()=>new Response('static')}};
 assert.equal((await worker.fetch(new Request('https://example.invalid/api/leads',{method:'POST'}),env,{})).status,503);
 assert.equal((await worker.fetch(new Request('https://example.invalid/api/events',{method:'POST'}),env,{})).status,503);
 assert.equal(await (await worker.fetch(new Request('https://example.invalid/index.html'),env,{})).text(),'static');
});
