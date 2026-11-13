import {trace} from './diagnostics.mjs';
import {AppError} from '../lib/extraction.mjs';
import {cipher} from './security.mjs';
import {createCloudGoogle} from './google.mjs';
export function createSync({db,env,collection,google=createCloudGoogle({db,env,crypto:cipher(env.TOKEN_ENCRYPTION_KEY),locked:collection.locked})}){
  async function enqueue(uid,id){trace('sync.enqueue',{analysisId:id});await db.admin('moa_sync_jobs',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:uid,analysis_id:id,requested_at:new Date().toISOString(),next_due:new Date().toISOString(),error:null}});}
  async function enqueueAnalysis(row){
    const users=row.owner_id?[{user_id:row.owner_id}]:await db.admin('moa_subscriptions',{username:`eq.${row.account}`,enabled:'eq.true'});
    for(const u of users)await enqueue(u.user_id,row.id);
  }
  async function enqueueVisible(uid){
    const subs=await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,enabled:'eq.true'});
    const queries=[{owner_id:`eq.${uid}`},...subs.map(s=>({account:`eq.${s.username}`}))];
    for(const query of queries)for(let offset=0;;offset+=200){
      const rows=await db.admin('moa_analyses',{...query,status:'eq.complete',select:'id',order:'created_at.asc,id.asc',limit:'200',offset:String(offset)});
      for(const row of rows)await enqueue(uid,row.id);
      if(rows.length<200)break;
    }
  }
  async function one(uid,id){trace('sync.start',{analysisId:id});
    return collection.locked(`sync:${uid}:${id}`,async()=>{
      const [job]=await db.admin('moa_sync_jobs',{user_id:`eq.${uid}`,analysis_id:`eq.${id}`});
      if(!job)return {pending:false};
      const [row]=await db.admin('moa_analyses',{id:`eq.${id}`});
      const allowed=row&&row.status==='complete'&&(row.owner_id===uid||(!row.owner_id&&(await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,username:`eq.${row.account}`})).length));
      const query={user_id:`eq.${uid}`,analysis_id:`eq.${id}`,requested_at:`eq.${job.requested_at}`};
      const exported=row?.status==='complete'&&!allowed&&(await db.admin('moa_exports',{user_id:`eq.${uid}`,analysis_id:`eq.${id}`,limit:'1'})).length;
      if(!allowed&&!exported){await db.admin('moa_sync_jobs',query,{method:'DELETE'});return {pending:false};}
      try{
        const [review]=await db.admin('moa_reviews',{user_id:`eq.${uid}`,analysis_id:`eq.${id}`});
        const deleted=await db.admin('moa_event_deletions',{user_id:`eq.${uid}`,analysis_id:`eq.${id}`});
        const result=await google.publish(uid,{...row,reviewed:review?.events??null,source_indices:review?.source_indices,deleted_indices:deleted.map(d=>d.event_index)});
        trace('sync.result',{pending:!!result.waiting,count:result.links?.length??0,blocked:result.blocked?.length??0});if(result.waiting)throw new AppError(result.reason,409);
        await db.admin('moa_sync_jobs',query,{method:'DELETE'});return {...result,pending:false};
      }catch(e){
        trace('sync.retry',{status:e.status??500,attempt:job.attempts+1});const error=e instanceof AppError?e.message:'캘린더 동기화 실패. 자동 재시도합니다.';
        await db.admin('moa_sync_jobs',query,{method:'PATCH',body:{error,attempts:job.attempts+1,next_due:new Date(Date.now()+15*60000).toISOString()}});
        return {pending:true,error};
      }
    });
  }
  async function drain(limit=2){
    const jobs=await db.admin('moa_sync_jobs',{next_due:`lte.${new Date().toISOString()}`,order:'next_due.asc',limit:String(limit)});
    for(const j of jobs)try{await one(j.user_id,j.analysis_id);}catch(e){if(e.status!==409)throw e;}
    return jobs.length;
  }
  return {enqueue,enqueueAnalysis,enqueueVisible,one,drain};
}
