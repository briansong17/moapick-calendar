import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../lib/store.mjs';
import {makeServer} from '../server.mjs';
import {createCollector,pastBoundary} from '../lib/collector.mjs';
import {AppError} from '../lib/extraction.mjs';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const event=(date='2026-12-01')=>({title:'행사',kind:'event',start_date:date,end_date:date,start_time:null,end_time:null,timezone:'Asia/Seoul',location:null,description:'',booking_url:null,evidence:['날짜'],needs_review:[]});
const result=events=>({summary:'일정',warnings:[],events});
test('회원별 업로드·구독·검토·Google 연결 격리, 관리자 권한, 세션 폐기',async()=>{
  const store=createStore(':memory:'), values={googleTokens:{refresh_token:'private'},googleCalendar:{id:'private-calendar',summary:'관리자 캘린더'}}, vault={get:k=>values[k],set:(k,v)=>values[k]=v};
  let pageCalls=0;
  const instagram={status:()=>({configured:true}),async page(){pageCalls++;return {posts:[{id:'123456',media_type:'IMAGE',media_url:'https://x.fbcdn.net/a',timestamp:'2026-11-12',permalink:'https://www.instagram.com/p/test/'}],after:null};},download:async()=>image};
  const server=makeServer({store,vault,instagramClient:instagram,apiKey:'fake',analyze:async()=>({result:result([event()]),usage:{}})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,cookie='',data)=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const signup=async login=>{const r=await request('/api/auth/register','',{login,password:'long-test-password'});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  try{
    assert.equal((await request('/api/analyses')).status,401);
    const a=await signup('alice'), b=await signup('bob');
    const stored=store.db.prepare('SELECT * FROM users WHERE login=?').get('alice');assert.notEqual(stored.password,'long-test-password');assert.equal(stored.password.length,128);
    assert.equal((await request('/api/meta/config',b,{})).status,403);
    assert.equal((await (await request('/api/integrations',a)).json()).google.connected,true);
    assert.equal((await (await request('/api/integrations',b)).json()).google.connected,false);
    const privateRow=await (await request('/api/analyze',a,{images:[image]})).json();
    for(const tail of ['', '/calendar.ics'])assert.equal((await request(`/api/analyses/${privateRow.id}${tail}`,b)).status,404);
    assert.equal((await request(`/api/analyses/${privateRow.id}/review`,b,{confirmed:true,events:[event()]})).status,404);
    assert.equal((await request(`/api/analyses/${privateRow.id}/google`,b,{confirmed:true})).status,404);
    assert.equal((await request('/api/meta/poll',b,{username:'school'})).status,404);
    await request('/api/meta/accounts',a,{username:'@School'});await request('/api/meta/accounts',b,{username:'school'});assert.equal(pageCalls,1);
    await request('/api/meta/poll',a,{username:'school'});
    const shared=(await (await request('/api/analyses',b)).json())[0];assert.ok(shared);assert.notEqual(shared.id,privateRow.id);
    await request(`/api/analyses/${shared.id}/review`,a,{confirmed:true,events:[{...event(),title:'Alice edit'}]});
    assert.equal((await (await request(`/api/analyses/${shared.id}`,b)).json()).reviewed,null);
    await request('/api/meta/enable',a,{username:'school',enabled:false});assert.equal(store.db.prepare('SELECT enabled FROM watched_accounts').get().enabled,1);
    await request('/api/meta/unsubscribe',b,{username:'school'});assert.equal(store.db.prepare('SELECT enabled FROM watched_accounts').get().enabled,0);
    assert.equal((await request(`/api/analyses/${shared.id}`,b)).status,404);
    assert.equal((await request('/api/auth/login','',{login:'bob',password:'wrong-password-long'})).status,401);
    await request('/api/auth/logout',a,{});assert.equal((await request('/api/analyses',a)).status,401);
    const login=await request('/api/auth/login','',{login:'alice',password:'long-test-password'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
  }finally{await new Promise(r=>server.close(r));store.db.close();}
});

test('과거 종료 기준: 미래 혼합·날짜 불명·경고·신청만 있는 글은 종료 근거 아님',()=>{
  const day='2026-11-12',past=event('2026-11-01');
  assert.equal(pastBoundary(result([past]),day),true);
  assert.equal(pastBoundary(result([past,event()]),day),false);
  assert.equal(pastBoundary(result([{...past,start_date:null}]),day),false);
  assert.equal(pastBoundary(result([{...past,kind:'registration'}]),day),false);
  assert.equal(pastBoundary({...result([past]),warnings:['연도 불명']},day),false);
  assert.equal(pastBoundary(result([event(day)]),day),false);
  assert.equal(pastBoundary(result([{...past,title:'2027년도 선거관리위원회 구성공고'}]),day),false);
});

test('신규 계정: 페이지 이동·회당 상한·재시작·일일 한도에서 이어가기, 과거 일정에서 종료',async()=>{
  const store=createStore(':memory:');let capped=false;const analyzed=[];const fetched=[];
  const post=i=>({id:String(1000+i),caption:String(i),timestamp:`2026-11-${String(30-i).padStart(2,'0')}`,media_type:'IMAGE',media_url:'https://x.fbcdn.net/a'});
  const ig={page:async(name,cursor)=>{fetched.push(cursor);return cursor?{posts:[post(7),post(8),post(9)],after:'third'}:{posts:Array.from({length:6},(_,i)=>post(i+1)),after:'second'};},download:async()=>image};
  const analyze=async raw=>{if(capped)throw new AppError('일일 한도',429);const i=Number(raw.caption);analyzed.push(i);const r=result([event(i===8?'2026-11-01':'2026-12-01')]);return {id:`a${i}`,result:r};};
  let c=createCollector({db:store.db,instagram:ig,analyze,today:()=> '2026-11-12'});
  try{
    await c.add('school');await c.poll('school');assert.deepEqual(analyzed,[1,2,3,4,5]);assert.equal(c.status().accounts[0].phase,'initial');
    c.stop();c=createCollector({db:store.db,instagram:ig,analyze,today:()=> '2026-11-12'});
    capped=true;await assert.rejects(c.poll('school'),e=>e.status===429);assert.deepEqual(analyzed,[1,2,3,4,5]);
    capped=false;await c.poll('school');assert.deepEqual(analyzed,[1,2,3,4,5,6,7,8]);assert.ok(!fetched.includes('third'));assert.equal(c.status().accounts[0].reason,'지난 행사 일정 확인');
    assert.equal(c.status().accounts[0].phase,'ready');
  }finally{c.stop();store.db.close();}
});
