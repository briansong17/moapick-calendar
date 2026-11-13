import test from 'node:test';
import assert from 'node:assert/strict';
import {sameManagedEvent,verifyGoogleEvent} from '../cloud/google-event-verification.mjs';
import {createCloudGoogle} from '../cloud/google.mjs';
import {calendarPayloads} from '../cloud/calendar-payload.mjs';
import {AppError} from '../lib/extraction.mjs';
import {createSync} from '../cloud/sync.mjs';
import {digest} from '../cloud/security.mjs';

const event={title:'동기화 테스트',kind:'event',start_date:'2026-11-16',end_date:'2026-11-16',start_time:null,end_time:null,timezone:'Asia/Seoul',description:'내용',location:null,booking_url:null,evidence:[],needs_review:[]};
const row={id:'probe',metadata:{source_url:''},result:{events:[event],warnings:[]}};
const payload=calendarPayloads('owner',row,'https://moa.example').payloads[0];

test('서버 저장 응답만으로 완료하지 않고 일시적인 누락·이전 값 이후 실제 값을 재조회한다',async()=>{
 let reads=0,waits=0;
 const value=await verifyGoogleEvent(async()=>{reads++;if(reads===1)throw new AppError('missing',404);return reads===2?{...payload,summary:'이전 값'}:payload;},'/event',{expected:payload,wait:async()=>{waits++;}});
 assert.equal(value,payload);assert.equal(reads,3);assert.equal(waits,2);
});

test('삭제 응답 후에도 일정이 남아 있으면 완료 처리하지 않는다',async()=>{
 await assert.rejects(verifyGoogleEvent(async()=>payload,'/event',{deleted:true,wait:async()=>{}}),/삭제 결과/);
 for(const status of [404,410])await verifyGoogleEvent(async()=>{throw new AppError('gone',status);},'/event',{deleted:true});
 await verifyGoogleEvent(async()=>({status:'cancelled'}),'/event',{deleted:true});
});

test('Google의 동등한 시간 표기와 추가 메타데이터는 불필요한 변경으로 보지 않는다',()=>{
 const timed={...payload,start:{dateTime:'2026-11-16T09:00:00+09:00',timeZone:'Asia/Seoul'},end:{dateTime:'2026-11-16T10:00:00+09:00',timeZone:'Asia/Seoul'}};
 assert.ok(sameManagedEvent({...timed,start:{...timed.start,dateTime:'2026-11-16T00:00:00Z'},reminders:{useDefault:false,overrides:[]},extendedProperties:{private:{...timed.extendedProperties.private,other:'keep'}}},timed));
 assert.equal(sameManagedEvent({...timed,status:'cancelled'},timed),false);
});

test('Google 등록이 승인돼도 실제 조회 결과가 불일치하면 내보내기를 완료로 기록하지 않는다',async()=>{
 let stored;const state={tokens:{refresh_token:'test'},calendar:{id:'cal'}};
 const db={admin:async(t,q,o)=>{if(t==='moa_google')return o?null:[{encrypted:state}];if(q.source_user_id)return [];if(o?.method==='POST'){stored={...o.body};return;}if(o?.method==='PATCH'){Object.assign(stored,o.body);return;}return stored?[stored]:[];}};
 const google=createCloudGoogle({db,crypto:{open:x=>x,seal:x=>x},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,f)=>f(),now:()=>new Date('2026-11-14T00:00:00Z'),verificationWait:async()=>{},clientFactory:()=>({setCredentials(){},on(){},async request({method='GET',data}){if(method==='POST')return {data};throw {response:{status:404}};}})});
 await assert.rejects(google.publish('owner',row),/저장 결과/);assert.equal(stored.status,'pending');assert.deepEqual(stored.event_ids,[payload.id]);
});

test('서버 대조는 일치하는 일정을 재수정하지 않으며 삭제한 일정도 실제 Google에서 확인한다',async()=>{
 let state={tokens:{refresh_token:'test'},calendar:{id:'cal'}},stored,writes=0;const calls=[];
 const db={admin:async(t,q,o)=>{if(t==='moa_google'){if(o)state=o.body.encrypted;return [{encrypted:state}];}if(t==='moa_event_deletions'){assert.equal(q.user_id,'eq.owner');return [{analysis_id:'deleted',event_index:0}];}if(q.source_user_id)return [];if(o?.method==='POST'){stored=o.body;return;}if(o?.method==='PATCH'){Object.assign(stored,o.body);return;}return stored?[stored]:[{analysis_id:'deleted',calendar_id:'cal',event_ids:[],status:'complete'}];}};
 const google=createCloudGoogle({db,crypto:{open:x=>x,seal:x=>x},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,f)=>f(),now:()=>new Date('2026-11-14T00:00:00Z'),clientFactory:()=>({setCredentials(){},on(){},async request({url,method='GET'}){calls.push(url);if(method!=='GET')writes++;if(url.endsWith('/cal'))return {data:{}};if(url.endsWith('/'+payload.id))return {data:payload};throw {response:{status:404}};}})});
 await google.publish('owner',row,{verify:true});assert.equal(writes,0);
 stored={analysis_id:'deleted',calendar_id:'cal',event_ids:[digest('moa:owner:deleted:0')],status:'complete'};const result=await google.verifyRecent('owner');assert.equal(result.results[0].kind,'deletion');assert.equal(result.results[0].status,'deleted');assert.ok(calls.length>1);
});

test('일시적인 Google 오류는 15분 고정 대기 대신 빠르게 재시도하며 인증 오류는 짧게 반복하지 않는다',async()=>{
 let job={requested_at:'stamp',attempts:0},status=503;
 const db={admin:async(t,q,o)=>{if(t==='moa_sync_jobs'){if(o?.method==='PATCH')Object.assign(job,o.body);return [job];}if(t==='moa_analyses')return [{...row,owner_id:'owner',status:'complete'}];if(['moa_reviews','moa_event_deletions'].includes(t))return [];throw Error(t);}};
 const sync=createSync({db,env:{},collection:{locked:async(_,f)=>f()},google:{publish:async()=>{throw new AppError('Google 연결 실패',status);}}});
 for(const seconds of [30,60]){const before=Date.now();assert.equal((await sync.one('owner','probe')).pending,true);assert.ok(Date.parse(job.next_due)>=before+seconds*1000);assert.ok(Date.parse(job.next_due)<Date.now()+(seconds+1)*1000);}
 status=403;await sync.one('owner','probe');assert.ok(Date.parse(job.next_due)>Date.now()+899000);
});
