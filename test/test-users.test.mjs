import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestUsers,testDatabase,historyQuery} from '../cloud/test-users.mjs';
import {createCollection} from '../cloud/collection.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
function fixture({accountDefaultNextDue=()=> '2020-01-01'}={}){
 const tables={moa_preferences:[{user_id:'owner',test_user:true,generation:'generation'}],moa_subscriptions:[{user_id:'owner',username:'a',enabled:true},{user_id:'owner',username:'b',enabled:true}],moa_test_accounts:[],moa_test_posts:[],moa_analyses:[]};let ids=0;
 const db={rpc:async()=>true,admin:async(table,q={},o)=>{
  const rows=tables[table]??=[];const matches=row=>Object.entries(q).every(([k,v])=>{if(['order','limit','select','offset','on_conflict'].includes(k))return true;const [op,...tail]=v.split('.'),val=tail.join('.');return op==='eq'?String(row[k])===val:op==='neq'?String(row[k])!==val:true;});
  if(o?.method==='POST'){let row={...o.body};if(table==='moa_analyses')row={id:'id-'+(++ids),created_at:new Date().toISOString(),...row};if(table==='moa_test_accounts')row={phase:'initial',cursor:'',queue:[],seen:[],processed:0,next_due:accountDefaultNextDue(),...row};
   const old=rows.find(r=>table==='moa_test_accounts'?r.user_id===row.user_id&&r.username===row.username:table==='moa_test_posts'?r.user_id===row.user_id&&r.id===row.id:false);if(old)Object.assign(old,row);else rows.push(row);return [{...row}];}
  if(o?.method==='PATCH'){rows.filter(matches).forEach(r=>Object.assign(r,o.body));return [];}
  if(o?.method==='DELETE'){tables[table]=rows.filter(r=>!matches(r));return [];}
  return rows.filter(matches).map(r=>({...r}));
 }};return {db,tables};
}

test('a newly created test account is due on its first attempt even when the database default is generated after request start',async()=>{
 const {db,tables}=fixture({accountDefaultNextDue:()=>new Date(Date.now()+1000).toISOString()});let calls=0;
 const testers=createTestUsers({db,collection:{locked:async(_,fn)=>fn()},createScoped:()=>({poll:async()=>calls++})});
 const result=await testers.run('owner');
 assert.equal(result.processed,true);assert.equal(result.count,1);assert.equal(calls,1);
 assert.equal(tables.moa_test_accounts.length,1);
 tables.moa_test_accounts[0].next_due='2099-01-01';tables.moa_subscriptions[1].enabled=false;
 assert.equal((await testers.run('owner')).processed,false);assert.equal(calls,1);
});
test('test collection processes at most one post across subscriptions, preserves other users and skips not due/disabled',async()=>{
 const {db,tables}=fixture();let analyzed=0,pages=0;
 const ig={page:async()=>{pages++;return {after:null,posts:[{id:'1',media_type:'IMAGE',media_url:'url',timestamp:'2026-11-13T10:00:00Z'},{id:'2',media_type:'IMAGE',media_url:'url',timestamp:'2026-11-12T10:00:00Z'}]};},download:async()=>image};
 const collection={locked:async(_,fn)=>fn()};
 const testers=createTestUsers({db,collection,createScoped:(scoped,scope)=>createCollection({db:scoped,env:{OPENAI_API_KEY:'fake'},scope,instagram:ig,analyze:async()=>{analyzed++;return {result:{summary:'test',warnings:[],events:[]},usage:{}};}})});
 const r=await testers.run('owner');assert.equal(r.count,1);assert.equal(analyzed,1);assert.equal(pages,1);assert.equal(tables.moa_analyses[0].owner_id,'owner');assert.equal(tables.moa_analyses[0].account,null);
 assert.deepEqual(tables.moa_test_accounts[0].queue,['2']);assert.equal(tables.moa_test_accounts.length,1);
 tables.moa_subscriptions[1].enabled=false;tables.moa_test_accounts[0].next_due='2099-01-01';
 assert.equal((await testers.run('owner')).processed,false);assert.equal(pages,1);
 tables.moa_subscriptions[0].enabled=false;assert.equal((await testers.run('owner')).reason,'no_enabled_subscription');assert.equal(pages,1);
 tables.moa_preferences[0].test_user=false;assert.equal((await testers.run('owner')).reason,'normal_user');assert.equal(pages,1);
});
test('test storage adds owner to every read/write and reset requires confirmation plus test mode',async()=>{
 const calls=[];const scoped=testDatabase({admin:async(...args)=>{calls.push(args);return [];}},'owner');
 await scoped.admin('moa_posts',{user_id:'eq.attacker'},{method:'DELETE'});await scoped.admin('moa_accounts',{}, {method:'POST',body:{user_id:'attacker',username:'school'}});
 assert.equal(calls[0][0],'moa_test_posts');assert.equal(calls[0][1].user_id,'eq.owner');assert.equal(calls[1][2].body.user_id,'owner');assert.equal(calls[1][1].on_conflict,'user_id,username');
 const {db,tables}=fixture();let reset;db.rpc=async(name,body)=>{reset={name,body};};const t=createTestUsers({db,collection:{locked:async(_,fn)=>fn()}});
 await assert.rejects(t.reset('owner',{confirmation:'wrong'}));assert.equal(reset,undefined);
 await t.reset('owner',{confirmation:'분석 기록 초기화'});assert.deepEqual(reset,{name:'moa_reset_test_history',body:{p_user:'owner'}});
 reset=undefined;tables.moa_preferences[0].test_user=false;await assert.rejects(t.reset('owner',{confirmation:'분석 기록 초기화'}));assert.equal(reset,undefined);
 assert.deepEqual(historyQuery({history_reset_at:'cutoff'}),{created_at:'gte.cutoff'});
});
test('excluded media never invokes AI and reset creates a fresh record by reusing the same result',async()=>{
 const {db,tables}=fixture();let analyzed=0;
 const build=generation=>createCollection({db:testDatabase(db,'owner'),scope:{uid:'owner',generation},env:{OPENAI_API_KEY:'fake'},instagram:{page:async()=>({after:null,posts:[{id:'1',media_type:'VIDEO'}]})},analyze:async()=>{analyzed++;return {result:{events:[]}};}});
 await testDatabase(db,'owner').admin('moa_accounts',{}, {method:'POST',body:{username:'a'}});
 await build('first').poll('a');assert.equal(analyzed,0);assert.equal(tables.moa_test_posts[0].status,'skipped');
 await build('first').analyzeInput({images:[image]});await build('first').analyzeInput({images:[image]});assert.equal(analyzed,1);
 const reset=await build('reset').analyzeInput({images:[image]});assert.equal(analyzed,1);assert.equal(reset.cached,true);assert.equal(reset.usage.total_tokens,0);assert.equal(reset.metadata.test_generation,'reset');assert.notEqual(reset.id,tables.moa_analyses[0].id);
 await build('reset').analyzeInput({images:[image]});assert.equal(analyzed,1);
 await build('reset').analyzeInput({images:[image],caption:'changed'});assert.equal(analyzed,2);
});

test('old daily-quota backoff is re-evaluated after increasing the allowed limit',async()=>{
 const {db,tables}=fixture();tables.moa_subscriptions[1].enabled=false;
 tables.moa_test_accounts.push({user_id:'owner',username:'a',phase:'initial',next_due:'2099-01-01',error:'오늘의 분석 한도에 도달했습니다.'});
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());tables.moa_limits=[{bucket:'analysis:'+day,count:22}];let calls=0;
 const options={db,collection:{locked:async(_,fn)=>fn()},createScoped:()=>({poll:async()=>calls++})};
 assert.equal((await createTestUsers({...options,dailyLimit:20}).run('owner')).processed,false);assert.equal(calls,0);
 assert.equal((await createTestUsers({...options,dailyLimit:100}).run('owner')).processed,true);assert.equal(calls,1);
 tables.moa_test_accounts[0].error='다른 오류';assert.equal((await createTestUsers({...options,dailyLimit:100}).run('owner')).processed,false);assert.equal(calls,1);
});
