import {AppError} from '../lib/extraction.mjs';
import {calendarEventPayload} from './calendar-payload.mjs';
import {upcomingPayload} from './upcoming.mjs';
import {digest} from './security.mjs';
import {diagnosticFailureCode,trace} from './diagnostics.mjs';
import {setTimeout as delay} from 'node:timers/promises';

// Content access is deliberately separate from the coarse device-diagnostics role.
export const memberScheduleAdmin=(env,uid)=>(env.MEMBER_SCHEDULE_ADMIN_IDS??'').split(',').map(v=>v.trim()).filter(Boolean).includes(uid);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function memberId(value){if(!uuid.test(value??''))throw new AppError('회원을 선택하세요.');return value;}
export function pageNumber(value,defaultValue=0){const n=Number(value??defaultValue);if(!Number.isInteger(n)||n<0||n>100000)throw new AppError('페이지를 확인하세요.');return n;}
const minimalMember=u=>({id:u.id,login:u.email??'이메일 없음'});
export async function listScheduleMembers(db,page=0){
  const result=await db.auth(`admin/users?page=${page+1}&per_page=100`,{admin:true});
  const users=result.users??[];
  return {members:users.map(minimalMember),next:users.length===100?page+1:null};
}
async function member(db,uid){
  let result;try{result=await db.auth('admin/users/'+memberId(uid),{admin:true});}catch(error){if(error.status===401)throw error;throw new AppError('회원 정보를 확인하지 못했습니다.',503);}
  const user=result.user??result;if(user.id!==uid)throw new AppError('회원을 찾을 수 없습니다.',404);return minimalMember(user);
}
async function all(db,table,query,order){
  const rows=[];for(let offset=0;;offset+=1000){const page=await db.admin(table,{...query,order,limit:'1000',offset:String(offset)});rows.push(...page);if(page.length<1000)return rows;}
}
async function visibleIds(db,uid){
  // Match /api/events: personal analyses, subscribed shared analyses, and own exports.
  const subscriptions=await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,select:'username,enabled',order:'username.asc'});
  const ids=new Set();
  const queries=[{owner_id:`eq.${uid}`},...subscriptions.map(s=>({owner_id:'is.null',account:`eq.${s.username}`}))];
  for(const query of queries)for(const row of await all(db,'moa_analyses',{...query,status:'eq.complete',select:'id'},'id.asc'))ids.add(row.id);
  for(const row of await all(db,'moa_exports',{user_id:`eq.${uid}`,select:'analysis_id'},'analysis_id.asc,calendar_id.asc'))ids.add(row.analysis_id);
  return {ids:[...ids].sort(),subscriptions};
}
async function rowsWithState(db,uid,ids){
  if(!ids.length)return [];
  const filter=`in.(${ids.join(',')})`,query={user_id:`eq.${uid}`,analysis_id:filter};
  const [rows,reviews,deletions,exports,jobs]=await Promise.all([
    db.admin('moa_analyses',{id:filter,status:'eq.complete',order:'id.asc'}),
    all(db,'moa_reviews',query,'analysis_id.asc'),
    all(db,'moa_event_deletions',query,'analysis_id.asc,event_index.asc'),
    all(db,'moa_exports',query,'analysis_id.asc,calendar_id.asc'),
    all(db,'moa_sync_jobs',query,'analysis_id.asc')]);
  return rows.map(row=>{const review=reviews.find(r=>r.analysis_id===row.id);return {...row,reviewed:review?.events??null,source_indices:review?.source_indices,deleted_indices:deletions.filter(d=>d.analysis_id===row.id).map(d=>d.event_index),exports:exports.filter(e=>e.analysis_id===row.id),job:jobs.find(j=>j.analysis_id===row.id)};});
}
export function inspectScheduleRows(uid,rows,origin,now=new Date()){
  return rows.flatMap(row=>{
    const reviewed=Array.isArray(row.reviewed),indices=row.source_indices??row.reviewed?.map((_,i)=>i)??[],deleted=new Set(row.deleted_indices??[]);
    const legacy=row.exports?.find(e=>e.source_user_id),sourceUid=legacy?.source_user_id??uid;
    return (row.result?.events??[]).map((original,index)=>{
      const reviewIndex=indices.indexOf(index),event=reviewed&&reviewIndex>=0?row.reviewed[reviewIndex]:original;
      const id=digest(`moa:${sourceUid}:${row.id}:${index}`);
      let reason=deleted.has(index)?'deleted':reviewed&&reviewIndex<0?'review_excluded':null,payload=null,validation=null;
      if(!reason)try{
        payload=calendarEventPayload(sourceUid,row,event,index,reviewed,origin);
        reason=!payload?'missing_date':!upcomingPayload(payload,now)?'ended':'eligible';
      }catch(error){reason='invalid_event';validation=error instanceof AppError?error.message:'일정 형식을 확인하세요.';}
      const records=(row.exports??[]).filter(e=>e.event_ids?.includes(id));
      return {analysisId:row.id,index,title:event.title??'',account:row.account??row.metadata?.account??null,
        startDate:event.start_date??null,endDate:event.end_date??null,startTime:event.start_time??null,endTime:event.end_time??null,timezone:event.timezone??null,
        reviewed,webVisible:!['deleted','review_excluded'].includes(reason),reason,validation,
        stored:records.length?records.some(e=>e.status==='pending')?'pending':'recorded':'none',
        job:row.job?{failed:!!row.job.error,failureCode:diagnosticFailureCode(row.job.error),attempts:row.job.attempts,nextDue:row.job.next_due}:null,
        // Internal fields never leave this server module.
        _id:id,_payload:payload,_calendarId:legacy?.calendar_id??null,_exports:row.exports??[]};
    });
  });
}
const publicSchedule=({_id,_payload,_calendarId,_exports,...event})=>event;
export function createMemberSchedules({db,google,env,now=()=>new Date(),wait=delay}){
  return {
    list:page=>listScheduleMembers(db,page),
    async events(uid,offset=0){
      const info=await member(db,uid),{ids,subscriptions}=await visibleIds(db,uid),page=ids.slice(offset,offset+20);
      const [rows,connection]=await Promise.all([rowsWithState(db,uid,page),google.status(uid)]);
      const events=inspectScheduleRows(uid,rows,env.PUBLIC_ORIGIN,now()).map(publicSchedule);
      trace('admin.member_view',{code:digest(uid).slice(0,12),operation:'events',count:events.length});
      return {member:info,at:now().toISOString(),events,subscriptions,analysisCount:ids.length,pageAnalyses:rows.length,loadedThrough:offset+page.length,next:offset+20<ids.length?offset+20:null,
        google:{connected:connection.connected,calendar:connection.calendar??null,reconnectRequired:!!connection.reconnectRequired}};
    },
    async verify(uid,analysisId,index){
      memberId(uid);memberId(analysisId);if(!Number.isInteger(index)||index<0||index>99)throw new AppError('일정을 선택하세요.');
      const {ids}=await visibleIds(db,uid);if(!ids.includes(analysisId))throw new AppError('해당 회원의 일정을 찾을 수 없습니다.',404);
      const rows=await rowsWithState(db,uid,[analysisId]),event=inspectScheduleRows(uid,rows,env.PUBLIC_ORIGIN,now()).find(e=>e.index===index);
      if(!event)throw new AppError('일정을 찾을 수 없습니다.',404);
      const expected=event.reason==='eligible'?'present':['deleted','review_excluded'].includes(event.reason)?'absent':'not_required';
      let result;
      for(let attempt=0;attempt<6;attempt++)try{
        result=await google.inspectManaged(uid,{id:event._id,calendarId:event._calendarId,previousCalendars:event._exports.filter(e=>e.event_ids?.includes(event._id)).map(e=>e.calendar_id),payload:event._payload});break;
      }catch(error){if(error.status!==409||attempt===5)throw error;trace('admin.google_wait',{attempt:attempt+1,status:409});await wait((attempt+1)*500);}
      trace('admin.member_view',{code:digest(uid).slice(0,12),operation:'google_read',count:result.results.length});
      return {analysisId,index,at:now().toISOString(),expected,...result};
    }
  };
}
