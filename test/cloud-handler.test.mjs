import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {createHandler} from '../cloud/handler.mjs';
import {cipher,digest} from '../cloud/security.mjs';
import {createSupabase} from '../cloud/supabase.mjs';

test('manual test collection returns the actual skipped outcome instead of implying that a post was processed',async()=>{
 const crypto=cipher(randomBytes(32).toString('base64')),sid='d'.repeat(64),uid='11111111-1111-4111-8111-111111111111';
 const account={username:'school',phase:'initial',processed:0,next_due:'2099-01-01T00:00:00Z'};
 const db={rpc:async()=>true,auth:async()=>({id:uid,email:'test@example.test',email_confirmed_at:'yes'}),
  read:async(name)=>name==='moa_subscriptions'?[{username:'school',enabled:true}]:name==='moa_test_accounts'?[account]:[],
  admin:async(name)=>{
   if(name==='moa_sessions')return [{user_id:uid,encrypted:crypto.seal({access_token:'token',expires_at:Date.now()/1000+3600},'session:'+digest(sid))}];
   if(name==='moa_preferences')return [{test_user:true}];
   if(name==='moa_subscriptions')return [{username:'school',enabled:true}];
   if(name==='moa_test_accounts')return [account];
   return [];
  }};
 const collection={locked:async(_,fn)=>fn(),metaStatus:()=>({configured:true}),poll:async()=>assert.fail('not-due collection must not poll')};
 const handler=createHandler({PUBLIC_ORIGIN:'https://moa.example',SUPABASE_URL:'https://test.supabase.co'},{db,crypto,collection});
 const req=Readable.from([]);Object.assign(req,{url:'/api/meta/poll',method:'POST',body:{username:'school'},headers:{host:'moa.example',origin:'https://moa.example','content-type':'application/json',cookie:'__Host-moa='+sid}});
 let status,value;await handler(req,{setHeader(){},writeHead(code){status=code;},end(body){value=JSON.parse(body);}});
 assert.equal(status,200);assert.equal(value.collectionResult.processed,false);assert.equal(value.collectionResult.reason,'not_due');
 assert.equal(value.collectionResult.deferred[0].nextDue,account.next_due);
});
test('배포 API는 서버 검증한 회원만 사용하며 RLS에 사용자 토큰 전달',async()=>{
 const crypto=cipher(randomBytes(32).toString('base64')),sessionId='a'.repeat(64),hash=digest(sessionId),uid='11111111-1111-4111-8111-111111111111';let readTokens=[],writes=0;
 const db={admin:async(name,q,options)=>{if(options&&name!=='moa_request_logs')writes++;if(name==='moa_sessions')return [{user_id:uid,created_at:new Date().toISOString(),encrypted:crypto.seal({access_token:'verified-user-token',expires_at:Date.now()/1000+3600},'session:'+hash)}];return [];},
  auth:async()=>({id:uid,email:'fixture@example.test',email_confirmed_at:new Date().toISOString()}),read:async(name,q,token)=>{readTokens.push(token);return [];},rpc:async()=>true};
 const handler=createHandler({PUBLIC_ORIGIN:'https://moa.example',SUPABASE_URL:'https://test.supabase.co'},{db,crypto,collection:{locked:async(n,fn)=>fn(),metaStatus:()=>({configured:false})}});
 const req=async(path,{cookie='',body,origin='https://moa.example'}={})=>{
  const r=Readable.from([]);r.url=path;r.method=body===undefined?'GET':'POST';r.body=body;r.headers={host:'moa.example',origin,'content-type':'application/json',cookie};
  let status,value;await handler(r,{setHeader(){},writeHead(s){status=s;},end(v){value=JSON.parse(v);}});return {status,value};
 };
 assert.equal((await req('/api/analyses')).status,401);
 assert.equal((await req('/api/analyses',{cookie:'__Host-moa='+sessionId})).status,200);
 assert.deepEqual(readTokens,['verified-user-token','verified-user-token']);
 assert.equal((await req('/api/analyses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/review',{cookie:'__Host-moa='+sessionId,body:{confirmed:true,events:[]}})).status,404);
 assert.equal((await req('/api/diagnostics')).status,401);
 const diagnostic=await req('/api/diagnostics',{cookie:'__Host-moa='+sessionId});assert.equal(diagnostic.status,200);assert.deepEqual(diagnostic.value.jobs,[]);assert.deepEqual(diagnostic.value.analyses,[]);assert.doesNotMatch(JSON.stringify(diagnostic.value),/verified-user-token|fixture@example/);
 assert.equal(writes,0);
 assert.equal((await req('/api/auth/google',{body:{},origin:'https://evil.example'})).status,403);
 assert.equal((await req('/api/cron')).status,401);
});
test('Supabase 일반 조회에 서버 비밀키 미전달, 외부 오류 본문 숨김',async()=>{
 let headers;
 const db=createSupabase({SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SECRET_KEY:'secret-sentinel'},async(url,options)=>{headers=options.headers;return new Response('secret-sentinel',{status:403});});
 await assert.rejects(db.read('moa_analyses',{},'user-token'),e=>!e.message.includes('secret-sentinel'));
 assert.equal(headers.apikey,'public');assert.equal(headers.Authorization,'Bearer user-token');
 assert.throws(()=>db.read('../secrets',{},'user-token'));
});

test('삭제 API는 다른 회원 기록을 거절하고 본인 선택만 저장하며 Google 미연결은 재시도한다',async()=>{
 const crypto=cipher(randomBytes(32).toString('base64')),sid='b'.repeat(64),uid='11111111-1111-4111-8111-111111111111',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const row={id,owner_id:uid,status:'complete',metadata:{source_url:''},result:{events:[{title:'A'},{title:'B'}]}};let tombstones=[],job;
 const db={auth:async()=>({id:uid,email:'test@example.test',email_confirmed_at:'yes'}),rpc:async()=>true,
 read:async(name,q)=>{if(name==='moa_analyses')return q.id==='eq.'+id?[row]:[];if(name==='moa_event_deletions')return tombstones;return [];},
 admin:async(name,q,o)=>{
  if(name==='moa_sessions')return [{user_id:uid,encrypted:crypto.seal({access_token:'token',expires_at:Date.now()/1000+3600},'session:'+digest(sid))}];
  if(name==='moa_analyses')return [row];
  if(name==='moa_event_deletions'){if(o)tombstones.push(...o.body);return tombstones;}
  if(name==='moa_sync_jobs'){if(o?.method==='POST')job={...o.body,attempts:0};if(o?.method==='PATCH')Object.assign(job,o.body);return job?[job]:[];}
  return [];
 }};
 const h=createHandler({PUBLIC_ORIGIN:'https://moa.example',SUPABASE_URL:'https://test.supabase.co'},{db,crypto,collection:{locked:async(_,fn)=>fn()}});
 const request=async target=>{let result;const req=Readable.from([]);Object.assign(req,{url:'/api/analyses/'+target+'/delete-events',method:'POST',body:{indices:[1],confirmed:true},headers:{host:'moa.example',origin:'https://moa.example','content-type':'application/json',cookie:'__Host-moa='+sid}});await h(req,{setHeader(){},writeHead(s){result={status:s};},end(v){result.value=JSON.parse(v);}});return result;};
 assert.equal((await request('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).status,404);assert.equal(tombstones.length,0);
 const result=await request(id);assert.equal(result.status,200);assert.equal(result.value.sync.pending,true);assert.deepEqual(tombstones,[{user_id:uid,analysis_id:id,event_index:1}]);assert.ok(job.error);
});

