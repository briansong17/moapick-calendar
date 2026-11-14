import test from 'node:test';
import assert from 'node:assert/strict';
import {runCollectionJob} from '../cloud/job.mjs';
test('예약 수집은 만료된 보안 상태를 정리하고 비활성 계정을 넘겨 한 게시물만 처리한다',async()=>{
  const calls=[],polled=[];
  const db={admin:async(table,query,options)=>{
    calls.push({table,query,options});if(options)return [];
    if(table==='moa_accounts')return [{username:'disabled'},{username:'enabled'},{username:'later'}];
    return query.username==='eq.disabled'?[]:[{}];
  }};
  assert.deepEqual(await runCollectionJob({db,collection:{poll:async name=>polled.push(name)},now:new Date('2026-11-12T00:00:00Z')}),{processed:true});
  assert.deepEqual(polled,['enabled']);
  assert.equal(calls.filter(c=>c.options?.method==='DELETE').length,4);
  assert.equal(calls.find(c=>c.options?.method==='PATCH').query.username,'eq.disabled');
});

test('an empty first account does not prevent another due account from processing its one post',async()=>{
 const polled=[];const db={admin:async(table,q,o)=>o?[]:table==='moa_accounts'?[{username:'empty'},{username:'school'}]:table==='moa_subscriptions'?[{user_id:'owner'}]:[]};
 const result=await runCollectionJob({db,collection:{poll:async name=>{polled.push(name);return {processed:name!=='empty'};}}});
 assert.deepEqual(polled,['empty','school']);assert.equal(result.processed,true);
});
