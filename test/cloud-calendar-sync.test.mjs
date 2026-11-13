import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarPayloads} from '../cloud/calendar-payload.mjs';
import {createCloudGoogle} from '../cloud/google.mjs';
const event={title:'행사',kind:'event',start_date:'2026-11-13',end_date:'2026-11-13',start_time:'18:30',end_time:null,timezone:null,location:null,description:'내용',booking_url:null,evidence:[],needs_review:[]};
const row={id:'5ad79af0-1047-4da7-b72b-24408e34eb9b',metadata:{source_url:'https://www.instagram.com/p/example/'},result:{events:[event,{...event,title:'날짜 없음',start_date:null}],warnings:[]}};
test('검토 전 표시·날짜 없는 후보 대기·시간 미확정 날짜 표시·회원별 ID',()=>{
 const a=calendarPayloads('a',row,'https://moa.example');
 assert.equal(a.payloads[0].summary,'(검토 필요) 행사');assert.equal(a.payloads[0].start.date,'2026-11-13');assert.deepEqual(a.blocked,[1]);
 assert.notEqual(a.payloads[0].id,calendarPayloads('b',row,'https://moa.example').payloads[0].id);
 assert.match(a.payloads[0].description,/analysis=/);
 const reviewed=calendarPayloads('a',{...row,reviewed:[{...event,timezone:'Asia/Seoul',end_time:'20:00'}],source_indices:[0]},'https://moa.example');
 assert.equal(reviewed.payloads[0].id,a.payloads[0].id);assert.equal(reviewed.payloads[0].summary,'행사');assert.ok(reviewed.payloads[0].start.dateTime);
});
test('초안 재시도는 중복 생성하지 않고 검토 시 같은 이벤트 PATCH, 제외 시 삭제',async()=>{
 let state={tokens:{refresh_token:'test'},calendar:{id:'cal'}};let exportRow;const events=new Map(),calls=[];
 const db={admin:async(table,query,options)=>{
  if(table==='moa_google'){if(options){state=options.body.encrypted;return;}return [{encrypted:state}];}
  if(options?.method==='POST'){exportRow={...exportRow,...options.body};return;}
  if(options?.method==='PATCH'){Object.assign(exportRow,options.body);return;}
  return exportRow?[exportRow]:[];
 }};
 const google=createCloudGoogle({now:()=>new Date('2026-11-13T00:00:00Z'),db,crypto:{open:v=>v,seal:v=>v},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,fn)=>fn(),clientFactory:()=>({setCredentials(){},on(){},async request({url,method='GET',data}){
  const id=url.split('/').at(-1);calls.push(method);
  if(method==='POST'){assert.ok(!events.has(data.id));events.set(data.id,{...data,htmlLink:'https://calendar.google.com/event'});return {data:events.get(data.id)};}
  if(!events.has(id))throw {response:{status:404}};
  if(method==='PATCH'){events.set(id,{...events.get(id),...data});return {data:events.get(id)};}
  if(method==='DELETE'){events.delete(id);return {data:null};}
  return {data:events.get(id)};
 }})});
 await google.publish('a',row);await google.publish('a',row);assert.equal(calls.filter(c=>c==='POST').length,1);
 // A forced reconciliation must inspect Google even when the stored fingerprint matches.
 const gets=calls.filter(c=>c==='GET').length;await google.publish('a',row,{verify:true});assert.ok(calls.filter(c=>c==='GET').length>gets);assert.equal(calls.filter(c=>c==='POST').length,1);

 await google.publish('a',{...row,reviewed:[{...event,timezone:'Asia/Seoul',end_time:'20:00'}],source_indices:[0]});
 assert.equal(events.size,1);assert.equal([...events.values()][0].summary,'행사');assert.equal([...events.values()][0].start.date,null);
 await google.publish('a',{...row,reviewed:[],source_indices:[]});assert.equal(events.size,0);
});
import {createSync} from '../cloud/sync.mjs';
test('이관으로 대체된 분석은 예약 작업에 남아 있어도 다시 등록하지 않는다',async()=>{
 let removed=false,published=false;
 const db={admin:async(table,q,o)=>{if(table==='moa_sync_jobs'){if(o?.method==='DELETE'){removed=true;return;}return [{requested_at:'2026-11-12T00:00:00Z'}];}if(table==='moa_analyses')return [{status:'superseded',owner_id:'a'}];throw Error('Unexpected query');}};
 const sync=createSync({db,env:{},collection:{locked:async(_,fn)=>fn()},google:{publish:async()=>{published=true;}}});
 await sync.one('a','old');assert.equal(removed,true);assert.equal(published,false);
});
test('이관 일정은 로컬 회원의 원래 캘린더와 이벤트 ID를 사용한다',async()=>{
 const legacy={calendar_id:'original-calendar',source_user_id:'local-member',event_ids:[],status:'legacy-complete'};
 const state={tokens:{refresh_token:'test'},calendar:{id:'new-calendar'}};let inserted;
 const db={admin:async(table,q,o)=>{if(table==='moa_google')return o?null:[{encrypted:state}];if(o)return null;return [legacy];}};
 const google=createCloudGoogle({now:()=>new Date('2026-11-13T00:00:00Z'),db,crypto:{open:v=>v,seal:v=>v},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,fn)=>fn(),clientFactory:()=>({setCredentials(){},on(){},async request({url,method='GET',data}){assert.ok(url.includes('/original-calendar/events'));if(method==='GET')throw {response:{status:404}};if(method==='POST'){inserted=data;return {data};}return {data:{}};}})});
 await google.publish('cloud-member',row);
 assert.equal(inserted.id,calendarPayloads('local-member',row,'https://moa.example').payloads[0].id);
});
test('대조 시 지난 일정 신규 등록과 기존 지난 일정 삭제를 하지 않는다',async()=>{
 let clock=new Date('2026-11-13T00:00:00Z'),saved,state={tokens:{refresh_token:'test'},calendar:{id:'cal'}},calls=[];const events=new Map();
 const db={admin:async(t,q,o)=>{if(t==='moa_google'){if(o)state=o.body.encrypted;return [{encrypted:state}];}if(q?.source_user_id)return [];if(o?.method==='POST'){saved={...saved,...o.body};return;}if(o?.method==='PATCH'){Object.assign(saved,o.body);return;}return saved?[saved]:[];}};
 const google=createCloudGoogle({db,now:()=>clock,crypto:{open:x=>x,seal:x=>x},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,f)=>f(),clientFactory:()=>({setCredentials(){},on(){},async request({url,method='GET',data}){calls.push(method);const id=url.split('/').at(-1);if(method==='POST'){events.set(data.id,data);return {data};}if(!events.has(id))throw {response:{status:404}};if(method==='DELETE'){events.delete(id);return {data:null};}return {data:events.get(id)};}})});
 await google.publish('a',row);assert.equal(events.size,1);clock=new Date('2026-11-15T00:00:00Z');calls=[];
 await google.publish('a',row,{verify:true});assert.equal(events.size,1);assert.deepEqual(calls,[]);assert.equal(saved.event_ids.length,1);
 saved=undefined;calls=[];await google.publish('a',{...row,id:'new-past-analysis'},{verify:true});assert.deepEqual(calls,[]);assert.equal(saved.event_ids.length,0);
});

test('웹 삭제 기록은 삭제 완료·추적 ID가 비어진 뒤에도 복원된 Google 일정을 다시 삭제한다',async()=>{
 for(const mode of ['selected','review-excluded']){
  let saved,state={tokens:{refresh_token:'test'},calendar:{id:'cal'}},failDelete=false;
  const payload=calendarPayloads('owner',row,'https://moa.example').payloads[0],events=new Map([['unrelated',{id:'unrelated'}]]),calls=[];
  const db={admin:async(t,q,o)=>{
   if(t==='moa_google'){if(o)state=o.body.encrypted;return [{encrypted:state}];}
   if(q?.source_user_id)return [];
   if(o?.method==='POST'){saved={...saved,...o.body};return;}
   if(o?.method==='PATCH'){Object.assign(saved,o.body);return;}
   return saved?[saved]:[];
  }};
  const google=createCloudGoogle({now:()=>new Date('2026-11-13T00:00:00Z'),db,crypto:{open:x=>x,seal:x=>x},env:{PUBLIC_ORIGIN:'https://moa.example'},locked:async(_,fn)=>fn(),clientFactory:()=>({setCredentials(){},on(){},async request({url,method='GET',data}){
   const id=url.split('/').at(-1);calls.push({id,method});
   if(method==='POST'){events.set(data.id,data);return {data};}
   if(!events.has(id))throw {response:{status:404}};
   if(method==='DELETE'){if(failDelete)throw {response:{status:503}};events.delete(id);return {data:null};}
   return {data:events.get(id)};
  }})});
  await google.publish('owner',row);
  const deleted=mode==='selected'?{...row,deleted_indices:[0]}:{...row,reviewed:[],source_indices:[]};
  failDelete=true;await assert.rejects(google.publish('owner',deleted));assert.equal(saved.status,'pending');assert.ok(events.has(payload.id));
  failDelete=false;await google.publish('owner',deleted,{verify:true});assert.equal(saved.status,'complete');assert.deepEqual(saved.event_ids,[]);assert.ok(!events.has(payload.id));
  // Model a delayed/restored Calendar event after the first successful deletion.
  events.set(payload.id,payload);calls.length=0;
  const result=await google.publish('owner',deleted,{verify:true});assert.equal(result.removed,1);assert.ok(!events.has(payload.id));assert.ok(events.has('unrelated'));assert.ok(calls.some(c=>c.method==='GET'&&c.id===payload.id));
  calls.length=0;await google.publish('owner',deleted,{verify:true});assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
 }
});
