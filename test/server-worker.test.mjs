import test from 'node:test';
import assert from 'node:assert/strict';
import {createSync} from '../cloud/sync.mjs';
import {createServerWorker} from '../cloud/server-worker.mjs';
import {AppError} from '../lib/extraction.mjs';

function fixture({failOnce=false,collectionFails=false,wait}={}){
 const jobs=Array.from({length:6},(_,i)=>({user_id:'owner',analysis_id:'a'+i,requested_at:'stamp'+i,next_due:'2020-01-01',attempts:0}));
 jobs.push({user_id:'other',analysis_id:'other',requested_at:'other-stamp',next_due:'2099-01-01'});
 const logs=[],published=[];
 const match=(row,q)=>Object.entries(q).every(([k,v])=>!['order','limit','select'].includes(k)?v.startsWith('eq.')?row[k]===v.slice(3):v.startsWith('lte.')?Date.parse(row[k])<=Date.parse(v.slice(4)):true:true);
 const db={admin:async(table,q={},o)=>{
  if(table==='moa_request_logs'){if(o?.method==='POST')logs.push(structuredClone(o.body));return [];}
  if(table==='moa_sync_jobs'){
   if(o?.method==='DELETE'){for(let i=jobs.length-1;i>=0;i--)if(match(jobs[i],q))jobs.splice(i,1);return [];}
   if(o?.method==='PATCH'){jobs.filter(j=>match(j,q)).forEach(j=>Object.assign(j,o.body));return [];}
   return jobs.filter(j=>match(j,q)).slice(0,Number(q.limit??100)).map(j=>({...j}));
  }
  if(table==='moa_analyses')return [{id:q.id.slice(3),owner_id:'owner',status:'complete'}];
  if(table==='moa_accounts')return collectionFails?[{username:'school'}]:[];
  if(table==='moa_subscriptions')return [{user_id:'owner'}];
  return [];
 }};
 const collection={locked:async(_,fn)=>fn(),poll:async()=>{throw new AppError('private upstream failure',502);}};
 const google={publish:async(uid,row)=>{published.push({uid,id:row.id});if(failOnce&&row.id==='a0'){failOnce=false;throw new AppError('temporary',502);}return {links:[]};}};
 const build=()=>createServerWorker({db,collection,sync:createSync({db,collection,google,env:{}}),env:{VERCEL_GIT_COMMIT_SHA:'abcdef123'},...(wait?{wait:ms=>wait(ms,jobs)}:{})});
 return {jobs,logs,published,build};
}

test('server drains beyond two jobs with no browser; a transient failure survives a new worker and does not repeat completed jobs',async()=>{
 const f=fixture({failOnce:true});const first=await f.build().syncUser('owner',{retryWaitMs:0});
 assert.equal(first.processed,6);assert.equal(first.pending,true);assert.equal(f.jobs.length,2);
 const retry=f.jobs.find(j=>j.analysis_id==='a0');assert.equal(retry.attempts,1);assert.ok(Date.parse(retry.next_due)>Date.now());
 assert.equal(f.published.filter(p=>p.id==='a1').length,1);
 retry.next_due='2020-01-01';
 const second=await f.build().syncUser('owner');assert.equal(second.pending,false);assert.equal(second.processed,1);
 assert.deepEqual(f.jobs.map(j=>j.user_id),['other']);
 assert.ok(f.logs.some(r=>r.user_id==='owner'&&r.status===202));assert.ok(f.logs.some(r=>r.user_id==='owner'&&r.status===200));
 assert.ok(f.logs.every(r=>r.route==='/api/sync/background'&&!JSON.stringify(r.steps).includes('analysisId')));
});

test('a short transient retry is driven by the same server invocation without a browser request',async()=>{
 const waits=[];const f=fixture({failOnce:true,wait:async(ms,jobs)=>{waits.push(ms);for(const job of jobs)if(job.user_id==='owner')job.next_due='2020-01-01';}});
 const result=await f.build().syncUser('owner');assert.equal(result.pending,false);assert.equal(result.processed,7);
 assert.equal(waits.length,1);assert.ok(waits[0]>0&&waits[0]<=30000);assert.equal(f.published.filter(p=>p.id==='a0').length,2);
 assert.ok(f.logs.some(r=>r.steps.some(s=>s.stage==='background.retry_wait')));
});

test('scheduled calendar retries finish even if Instagram collection throws',async()=>{
 const f=fixture({collectionFails:true});const result=await f.build().tick();
 assert.equal(result.collectionFailed,true);assert.equal(result.syncProcessed,6);assert.equal(result.syncFailed,false);
 assert.deepEqual(f.jobs.map(j=>j.user_id),['other']);
 assert.ok(f.published.every(p=>p.uid==='owner'));
 assert.ok(f.logs.some(r=>r.steps.some(s=>s.stage==='background.start'&&s.operation==='schedule')));
});

test('server deadline leaves unfinished work durable for the next scheduled run',async()=>{
 const f=fixture();const result=await f.build().syncUser('owner',{deadline:Date.now()-1});
 assert.equal(result.processed,0);assert.equal(result.pending,true);assert.equal(f.published.length,0);assert.equal(f.jobs.length,7);
});
