import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {koreanDay,memberAnalysisBucket} from '../cloud/time.mjs';

test('shared and member daily counters use the same Korean midnight boundary',()=>{
 for(const [time,day]of [['2026-11-14T14:59:59Z','2026-11-14'],['2026-11-14T15:00:00Z','2026-11-15'],['2026-11-15T00:00:00Z','2026-11-15']]){
  const date=new Date(time);assert.equal(koreanDay(date),day);assert.equal(memberAnalysisBucket('owner',date),'user-analysis:owner:'+day);
 }
});

test('a Google calendar review link opens the requested analysis after the login round trip',async()=>{
 const source=await readFile(new URL('../cloud/review-link-ui.js',import.meta.url),'utf8'),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storage=new Map(),calls=[];
 const context={URLSearchParams,location:{search:'?analysis='+id},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},signedIn:false,api:async path=>{calls.push(path);return {id};},render:row=>calls.push(row.id),diagnosticNotice:message=>calls.push(message)};
 const open=runInNewContext(source+'\nopenRequestedAnalysis',context);await open();assert.equal(calls.length,0);assert.equal(storage.size,1);
 context.location.search='';context.signedIn=true;await open();assert.deepEqual(calls,['/api/analyses/'+id,id]);assert.equal(storage.size,0);
 context.location.search='?analysis=invalid';await open();assert.equal(calls.length,2);
});

test('multi-day events are visible on each included day in the web calendar',async()=>{
 const source=await readFile(new URL('../cloud/event-management-ui.js',import.meta.url),'utf8');
 const includes=runInNewContext(source+'\neventOnDate',{$:()=>({}),document:{querySelectorAll:()=>[]},Date,Map});
 const event={start_date:'2026-11-14',end_date:'2026-11-16'};
 assert.equal(includes(event,'2026-11-13'),false);assert.equal(includes(event,'2026-11-14'),true);assert.equal(includes(event,'2026-11-15'),true);assert.equal(includes(event,'2026-11-16'),true);assert.equal(includes(event,'2026-11-17'),false);
 assert.equal(includes({start_date:'2026-11-14'},'2026-11-15'),false);assert.equal(includes({},'2026-11-14'),false);
});
