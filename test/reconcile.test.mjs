import test from 'node:test';import assert from 'node:assert/strict';
import {upcomingPayload} from '../cloud/upcoming.mjs';import {createSync} from '../cloud/sync.mjs';
test('미래·진행 중 일정만 등록하며 한국 날짜 및 종료 시각 경계를 지킨다',()=>{
 const now=new Date('2026-11-13T15:00:00Z');
 assert.equal(upcomingPayload({end:{date:'2026-11-14'}},now),false);
 assert.equal(upcomingPayload({end:{date:'2026-11-15'}},now),true);
 assert.equal(upcomingPayload({end:{dateTime:'2026-11-14T00:00:00+09:00'}},now),false);
 assert.equal(upcomingPayload({end:{dateTime:'2026-11-14T00:01:00+09:00'}},now),true);
});
test('접속 대조는 본인 작업만 즉시 실행하고 Google 실제 확인을 요청한다',async()=>{
 let job={user_id:'owner',analysis_id:'analysis',requested_at:'stamp',attempts:0},created=0,published;
 const db={rpc:async()=>true,admin:async(table,q,o)=>{
  if(table==='moa_preferences')return [];if(table==='moa_subscriptions')return [];
  if(table==='moa_analyses')return [{id:'analysis',owner_id:'owner',status:'complete'}];
  if(table==='moa_reviews')return [];if(table==='moa_event_deletions')return [{event_index:1}];
  if(table==='moa_sync_jobs'){if(o?.method==='POST'){job={...o.body,attempts:0};return;}if(o?.method==='DELETE'){job=null;return;}assert.equal(q.user_id,'eq.owner');return job?[job]:[];}throw Error(table);
 }};
 const google={status:async()=>({connected:true,calendar:null}),createCalendar:async()=>{created++;},publish:async(uid,row,options)=>{published={uid,row,options};return {links:['ok']};}};
 const sync=createSync({db,env:{},collection:{locked:async(_,fn)=>fn()},google});
 const r=await sync.reconcile('owner');assert.equal(created,1);assert.equal(r.more,false);assert.equal(r.pending,false);assert.equal(published.options.verify,true);assert.deepEqual(published.row.deleted_indices,[1]);
});
test('캘린더 생성 결과 불명확 또는 연결 미완료 시 중복 생성·완료 오표시를 방지한다',async()=>{
 for(const state of [{connected:false},{connected:true,calendarPending:true}]){
 const sync=createSync({db:{},env:{},collection:{locked:async(_,fn)=>fn()},google:{status:async()=>state,createCalendar:async()=>assert.fail('must not create')}});
 const r=await sync.reconcile('owner');assert.equal(r.pending,true);assert.equal(r.retryable,false);
 }
});
