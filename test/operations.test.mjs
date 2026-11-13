import test from 'node:test';import assert from 'node:assert/strict';
import {operationsSnapshot,cleanClientEvents,deviceKind,browserKind,saveDevice,collectionSnapshot} from '../cloud/operations.mjs';
import {saveRequestLog} from '../cloud/request-logs.mjs';
test('non-admin device monitoring forces member filter; admin returns minimal fields without member IDs',async()=>{
 const calls=[],db={admin:async(t,q)=>{calls.push(q);return t==='moa_devices'?[{device_id:'private-device',kind:'iOS',browser:'Safari',events:[]}]:[];}};
 const own=await operationsSnapshot(db,{TOKEN_ENCRYPTION_KEY:'fake',OPERATIONS_ADMIN_IDS:'admin'},'member');assert.equal(own.scope,'self');assert.ok(calls.every(q=>q.user_id==='eq.member'));
 calls.length=0;const admin=await operationsSnapshot(db,{TOKEN_ENCRYPTION_KEY:'fake',OPERATIONS_ADMIN_IDS:'admin'},'admin');assert.equal(admin.scope,'operations');assert.ok(calls.every(q=>q.user_id===undefined));assert.doesNotMatch(JSON.stringify(admin),/private-device|user_id/);assert.ok(calls.every(q=>!q.select.includes('steps')));
});
test('device reports accept only permitted metadata and keep previous errors',async()=>{
 const safe=cleanClientEvents([{stage:'javascript.error',at:'2026-11-13T12:00:00Z',message:'SECRET',token:'SECRET'},{stage:'secret',message:'SECRET'}]);assert.equal(safe.length,1);assert.doesNotMatch(JSON.stringify(safe),/SECRET/);
 assert.equal(deviceKind('iPhone Safari'),'iOS');assert.equal(browserKind('iPhone Safari'),'Safari');let saved;
 await saveDevice({rpc:async()=>true,admin:async(t,q,o)=>{if(o){saved=o.body;return [];}return [{events:[{stage:'javascript.error',at:new Date().toISOString()}]}];}},'member',{headers:{'x-moa-device':'11111111-1111-4111-8111-111111111111','user-agent':'iPhone Safari'}},{view:'events',events:[]});
 assert.equal(saved.events.length,1);assert.equal(saved.kind,'iOS');assert.equal(saved.user_id,'member');
});
test('request lifecycle uses the same ID for running and completion and redacts analysis IDs',async()=>{
 const writes=[],db={admin:async(t,q,o)=>writes.push(o)};
 const value={uid:'member',path:'/api/analyze',method:'POST',started:Date.now(),snapshot:{requestId:'same',steps:[{stage:'analysis.start',analysisId:'private'}]},req:{headers:{'x-moa-device':'11111111-1111-4111-8111-111111111111'}}};
 await saveRequestLog(db,{...value,phase:'running',status:102});await saveRequestLog(db,{...value,status:200});
 assert.equal(writes[0].body.id,writes[1].body.id);assert.equal(writes[0].body.phase,'running');assert.equal(writes[1].body.phase,'complete');assert.doesNotMatch(JSON.stringify(writes),/private/);
});
test('diagnostics select the test cursor table rather than the normal shared table',async()=>{
 let table;await collectionSnapshot({read:async t=>{table=t;return [];}},'member',{test_user:true},'token');assert.equal(table,'moa_test_accounts');
});
