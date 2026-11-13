import test from 'node:test';
import assert from 'node:assert/strict';
import {requestRoute,saveRequestLog} from '../cloud/request-logs.mjs';
test('persistent request logs redact route identifiers and isolate retention',async()=>{
 const calls=[];const db={admin:async(...args)=>calls.push(args)};
 assert.equal(requestRoute('/secret@email.com'),'other');
 assert.equal(requestRoute('/api/analyses/12345678-1234-1234-1234-123456789012/review'),'/api/analyses/:id/review');
 await saveRequestLog(db,{uid:'owner',path:'/api/analyze',method:'POST',status:200,started:Date.now(),snapshot:{requestId:'request',steps:[{stage:'analysis.complete',analysisId:'private',count:1}]},build:'abcdef123'});
 assert.equal(calls[0][2].body.user_id,'owner');assert.equal(calls[0][2].body.steps[0].analysisId,undefined);
 assert.equal(calls[1][1].user_id,'eq.owner');assert.equal(calls[1][2].method,'DELETE');
 await saveRequestLog(db,{uid:null});await saveRequestLog(db,{uid:'owner',path:'/api/diagnostics'});assert.equal(calls.length,2);
});
test('logging failure cannot turn a successful operation into an error',async()=>{
 assert.equal(await saveRequestLog({admin:async()=>{throw Error('private');}},{uid:'owner',path:'/api/status',method:'GET',status:200,started:Date.now(),snapshot:{requestId:'id',steps:[]}}),false);
});
