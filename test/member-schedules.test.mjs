import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {createMemberSchedules,inspectScheduleRows,memberScheduleAdmin,listScheduleMembers} from '../cloud/member-schedules.mjs';
import {createCloudGoogle} from '../cloud/google.mjs';
import {createHandler} from '../cloud/handler.mjs';
import {cipher,digest} from '../cloud/security.mjs';

const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event={title:'행사',kind:'event',start_date:'2026-11-20',end_date:null,start_time:null,end_time:null,timezone:'Asia/Seoul',description:'PRIVATE_DESCRIPTION',location:null,booking_url:null,evidence:['PRIVATE_EVIDENCE'],needs_review:[]};
const row={id,owner_id:uid,status:'complete',metadata:{source_url:'PRIVATE_SOURCE'},result:{events:[event],warnings:[]}};
const now=()=>new Date('2026-11-14T13:00:00Z');
test('operator eligibility matches publishing: future, missing date, ongoing, ended, deleted and review exclusions',()=>{
 const data={...row,result:{events:[event,{...event,start_date:null},{...event,start_date:'2026-11-12'},{...event,title:'삭제'},{...event,title:'검토 제외'},{...event,start_date:'2026-11-13',end_date:'2026-11-16'}]},deleted_indices:[3]};
 let result=inspectScheduleRows(uid,[data],'https://moa.example',now());assert.deepEqual(result.map(e=>e.reason),['eligible','missing_date','ended','deleted','eligible','eligible']);
 assert.equal(result[0]._payload.summary,'(검토 필요) 행사');
 result=inspectScheduleRows(uid,[{...data,reviewed:[event],source_indices:[0]}],'https://moa.example',now());
 assert.deepEqual(result.map(e=>e.reason),['eligible','review_excluded','review_excluded','deleted','review_excluded','review_excluded']);assert.equal(result[0]._payload.summary,'행사');
 const bad={...event,start_time:'15:00',end_time:null};result=inspectScheduleRows(uid,[{...row,reviewed:[bad],source_indices:[0]}],'https://moa.example',now());
 assert.equal(result[0].reason,'invalid_event');assert.match(result[0].validation,/종료 시간/);
});
test('operator page joins only selected member state and does not return payloads, raw errors or provider identities',async()=>{
 const calls=[];const db={auth:async()=>({id:uid,email:'member@example.test',identities:['SECRET_IDENTITY']}),admin:async(table,q,options)=>{
  calls.push({table,q,options});assert.equal(options,undefined,'content inspection must not write');
  if(['moa_subscriptions','moa_exports','moa_reviews','moa_event_deletions','moa_sync_jobs'].includes(table))assert.equal(q.user_id,'eq.'+uid);
  if(table==='moa_subscriptions')return [{username:'school',enabled:false}];
  if(table==='moa_analyses'){if(q.id)return [row];return q.owner_id==='eq.'+uid?[{id}]:[];}
  if(table==='moa_sync_jobs')return [{analysis_id:id,attempts:1,error:'SECRET_PROVIDER_ERROR',next_due:'2026-11-14T14:00:00Z'}];
  return [];
 }};
 const service=createMemberSchedules({db,env:{PUBLIC_ORIGIN:'https://moa.example'},now,google:{status:async target=>{assert.equal(target,uid);return {connected:true,calendar:'모아픽',tokens:'SECRET_TOKEN'};}}});
 const report=await service.events(uid);assert.equal(report.events.length,1);assert.equal(report.events[0].reason,'eligible');assert.equal(report.events[0].job.failed,true);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|SECRET_|_payload|_exports|calendar_id|owner_id/);
 assert.ok(calls.some(c=>c.table==='moa_analyses'&&c.q.owner_id==='is.null'&&c.q.account==='eq.school'));
});
test('own exported records remain inspectable after unsubscribing, but arbitrary other-member analysis IDs cannot be verified',async()=>{
 const db={auth:async()=>({id:uid,email:'member@example.test'}),admin:async(table,q)=>{
  if(table==='moa_exports')return [{analysis_id:id,source_user_id:'legacy-member',calendar_id:'legacy-calendar',event_ids:[digest(`moa:legacy-member:${id}:0`)],status:'complete'}];
  if(table==='moa_analyses')return q.id?[{...row,owner_id:null}]:[];
  return [];
 }};let read,attempts=0;const waits=[];
 const service=createMemberSchedules({db,env:{PUBLIC_ORIGIN:'https://moa.example'},now,wait:async ms=>waits.push(ms),google:{status:async()=>({connected:true}),inspectManaged:async(target,query)=>{if(++attempts===1)throw Object.assign(new Error('busy'),{status:409});read={target,query};return {connected:true,results:[{status:'present'}]};}}});
 assert.equal((await service.events(uid)).events[0].stored,'recorded');
 const result=await service.verify(uid,id,0);assert.equal(result.expected,'present');assert.equal(read.query.id,digest(`moa:legacy-member:${id}:0`));assert.equal(read.query.calendarId,'legacy-calendar');
 assert.deepEqual(waits,[500]);assert.equal(attempts,2);
 await assert.rejects(service.verify(uid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',0),e=>e.status===404);
});
test('member picker only returns identity needed for selection',async()=>{
 const report=await listScheduleMembers({auth:async(path,options)=>{assert.equal(path,'admin/users?page=1&per_page=100');assert.equal(options.admin,true);return {users:[{id:uid,email:'member@example.test',encrypted_password:'SECRET',identities:['SECRET']} ]};}});
 assert.deepEqual(report,{members:[{id:uid,login:'member@example.test'}],next:null});
});
test('Google operator verification uses GET only and distinguishes present, deleted and missing without changing calendar data',async()=>{
 const calls=[];let state={tokens:{refresh_token:'SECRET'},calendar:{id:'current'}};
 const google=createCloudGoogle({db:{admin:async(table,q,options)=>{assert.equal(table,'moa_google');assert.equal(q.user_id,options?undefined:'eq.'+uid);if(options){state=options.body.encrypted;return [];}return [{encrypted:state}];}},crypto:{open:v=>v,seal:v=>v},env:{},locked:async(_,fn)=>fn(),clientFactory:()=>({setCredentials(){},on(){},request:async options=>{
  calls.push(options);assert.equal(options.method,'GET');if(options.url.includes('/missing/'))throw {response:{status:404}};return {data:options.url.includes('/old/')?{status:'cancelled'}:{status:'confirmed'}};
 }})});
 const result=await google.inspectManaged(uid,{id:'managed-id',previousCalendars:['old','missing']});assert.deepEqual(result.results.map(r=>r.status),['present','deleted','missing']);assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(result),/SECRET|managed-id/);
});
test('inspection of a disconnected member does not create or change Google connection records',async()=>{
 const google=createCloudGoogle({db:{admin:async(table,q,options)=>{assert.equal(options,undefined);return [];}},crypto:{open:v=>v,seal:v=>v},env:{},locked:async(_,fn)=>fn(),clientFactory:()=>({setCredentials(){},on(){},request:()=>assert.fail('no credentials must not call Google')})});
 assert.deepEqual(await google.inspectManaged(uid,{id:'managed-id'}),{connected:false,results:[],limited:false});
});
test('admin APIs require the dedicated role, reject writes and validate targets before content access',async()=>{
 const crypto=cipher(randomBytes(32).toString('base64')),sid='f'.repeat(64),hash=digest(sid);let role=false,contentReads=0;
 const db={rpc:async()=>true,read:async()=>[],auth:async path=>{if(path!=='user')contentReads++;return {id:uid,email:'owner@example.test',email_confirmed_at:'yes'};},admin:async(table,q,options)=>{
  if(table==='moa_sessions')return [{user_id:uid,encrypted:crypto.seal({access_token:'token',expires_at:Date.now()/1000+3600},'session:'+hash)}];
  if(table!=='moa_request_logs')contentReads++;return [];
 }};
 const request=async(path,method='GET',signed=true)=>{let status,value;const handler=createHandler({PUBLIC_ORIGIN:'https://moa.example',SUPABASE_URL:'https://test.supabase.co',OPERATIONS_ADMIN_IDS:uid,...(role?{MEMBER_SCHEDULE_ADMIN_IDS:uid}:{})},{db,crypto,collection:{locked:async(_,fn)=>fn()}});
  const req=Readable.from([]);Object.assign(req,{url:path,method,headers:{host:'moa.example',origin:'https://moa.example','content-type':'application/json',...(signed?{cookie:'__Host-moa='+sid}:{})}});await handler(req,{setHeader(){},writeHead(s){status=s;},end(v){value=JSON.parse(v);}});return {status,value};
 };
 assert.equal(memberScheduleAdmin({OPERATIONS_ADMIN_IDS:uid},uid),false);
 assert.equal((await request('/api/admin/members','GET',false)).status,401);
 assert.equal((await request('/api/admin/members')).status,403);assert.equal(contentReads,0);
 role=true;assert.equal((await request('/api/admin/member-events?member=bad')).status,400);assert.equal(contentReads,0);
 assert.equal((await request('/api/admin/members','POST')).status,405);assert.equal(contentReads,0);
 assert.equal((await request('/api/auth/me')).value.user.memberSchedules,true);
});
