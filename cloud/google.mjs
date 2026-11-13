import {upcomingPayload} from './upcoming.mjs';
import {trace} from './diagnostics.mjs';
import {OAuth2Client} from 'google-auth-library';
import {randomBytes} from 'node:crypto';
import {AppError} from '../lib/extraction.mjs';
import {googleEvent,GOOGLE_SCOPE} from '../lib/google.mjs';
import {digest,secureCookie} from './security.mjs';
import {calendarPayloads} from './calendar-payload.mjs';
import {sameManagedEvent,verifyGoogleEvent} from './google-event-verification.mjs';
export function createCloudGoogle({db,crypto,env,locked,clientFactory=options=>new OAuth2Client(options),now=()=>new Date(),verificationWait}) {
  const redirect=env.PUBLIC_ORIGIN+'/oauth/google/callback';
  const client=tokens=>{const c=clientFactory({clientId:env.GOOGLE_CALENDAR_CLIENT_ID,clientSecret:env.GOOGLE_CALENDAR_CLIENT_SECRET,redirectUri:redirect});c.setCredentials(tokens??{});return c;};
  const read=async uid=>{const [r]=await db.admin('moa_google',{user_id:`eq.${uid}`});return r?crypto.open(r.encrypted,`google:${uid}`):{};};
  const save=(uid,value)=>db.admin('moa_google',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:uid,encrypted:crypto.seal(value,`google:${uid}`),updated_at:new Date().toISOString()}});
  const operate=(uid,fn)=>locked('google:'+uid,async()=>{
    const state=await read(uid),c=client(state.tokens);trace('google.credentials',{refresh:!!state.tokens?.refresh_token,expired:(state.tokens?.expiry_date??0)<Date.now(),calendar:!!state.calendar});c.on('tokens',t=>{trace('google.token_refreshed');state.tokens={...state.tokens,...t};});
    const call=async(path,{method='GET',data}={})=>{
      trace('google.http.start',{method,operation:path.includes('/events')?'events':'calendar'});try{const response=(await c.request({url:'https://www.googleapis.com/calendar/v3'+path,method,data,retry:false,timeout:30000}));trace('google.http.complete',{status:response.status??200});return response.data;}
      catch(e){const code=e.response?.status;trace('google.http.failed',{status:code??502,code:e.response?.data?.error==='invalid_grant'?'invalid_grant':'provider_error'});if(code===401||e.response?.data?.error==='invalid_grant'){state.reconnectRequired=true;throw new AppError('Google 인증이 만료되었습니다. 다시 연결하세요.',401);}
        if([403,404,409,410].includes(code))throw new AppError('Google 캘린더 권한 또는 기존 일정 상태를 확인하세요.',code);
        throw new AppError('Google 연결에 실패했습니다. 다시 등록해도 같은 일정 ID를 사용합니다.',502);}
    };
    try{return await fn(state,call);}finally{await save(uid,state);}
  });
  return {
    verifyRecent:uid=>operate(uid,async(s,call)=>{
      if(!s.calendar)return {connected:false,checked:0};
      await call('/calendars/'+encodeURIComponent(s.calendar.id));
      const rows=await db.admin('moa_exports',{user_id:`eq.${uid}`,limit:'100'});
      const deleted=await db.admin('moa_event_deletions',{user_id:`eq.${uid}`,order:'created_at.desc',limit:'10'});
      const removals=deleted.flatMap(d=>rows.filter(r=>r.analysis_id===d.analysis_id).map(r=>({id:digest(`moa:${r.source_user_id??uid}:${d.analysis_id}:${d.event_index}`),calendar:r.calendar_id,analysisId:d.analysis_id,deletion:true})));
      const removedKeys=new Set(removals.map(t=>t.calendar+':'+t.id));
      const active=rows.flatMap(r=>(r.event_ids??[]).map(id=>({id,calendar:r.calendar_id,analysisId:r.analysis_id}))).filter(t=>!removedKeys.has(t.calendar+':'+t.id));
      const seen=new Set(),targets=[...active.slice(-5),...removals,...active].filter(t=>{const key=t.calendar+':'+t.id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,10),results=[];
      for(const t of targets){try{const e=await call('/calendars/'+encodeURIComponent(t.calendar)+'/events/'+t.id);results.push({analysisId:t.analysisId,kind:t.deletion?'deletion':'event',status:e.status==='cancelled'?(t.deletion?'deleted':'cancelled'):'present'});}catch(e){results.push({analysisId:t.analysisId,kind:t.deletion?'deletion':'event',status:t.deletion&&[404,410].includes(e.status)?'deleted':'failed',...(!t.deletion||![404,410].includes(e.status)?{httpStatus:e.status??502}:{})});}}
      return {connected:true,checked:results.length,limited:true,results};
    }),
    async status(uid){const s=await read(uid);return {configured:!!env.GOOGLE_CALENDAR_CLIENT_ID,connected:!!s.tokens?.refresh_token,calendar:s.calendar?.summary??null,calendarPending:!!s.pending,reconnectRequired:!!s.reconnectRequired};},
    async begin(uid,res){if(!env.GOOGLE_CALENDAR_CLIENT_ID)throw new AppError('캘린더 연결 준비 중입니다.',503);
      const c=client(),state=randomBytes(32).toString('hex'),binding=randomBytes(32).toString('hex');const {codeVerifier,codeChallenge}=await c.generateCodeVerifierAsync();
      await db.admin('moa_oauth',{}, {method:'POST',body:{state_hash:digest(state),user_id:uid,encrypted:crypto.seal({binding,codeVerifier},`oauth:${uid}`),expires_at:new Date(Date.now()+600000).toISOString()}});
      res.setHeader('Set-Cookie',secureCookie('__Host-moa-google',binding,600));
      return {url:c.generateAuthUrl({scope:[GOOGLE_SCOPE],access_type:'offline',prompt:'consent',state,code_challenge:codeChallenge,code_challenge_method:'S256'})};},
    async callback(uid,req,res,params){
      const state=params.get('state');if(!/^[a-f0-9]{64}$/.test(state??''))throw new AppError('유효하지 않은 인증 요청입니다.');
      const query={state_hash:`eq.${digest(state)}`,user_id:`eq.${uid}`,expires_at:`gt.${new Date().toISOString()}`};
      const [r]=await db.admin('moa_oauth',query);if(!r)throw new AppError('인증 요청이 만료되었습니다.');
      const flow=crypto.open(r.encrypted,`oauth:${uid}`),binding=/(?:^|;\s*)__Host-moa-google=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1];
      if(flow.binding!==binding)throw new AppError('인증 브라우저가 일치하지 않습니다.',403);
      const taken=await db.admin('moa_oauth',query,{method:'DELETE',prefer:'return=representation'});if(!taken.length)throw new AppError('이미 사용한 인증 요청입니다.');
      res.setHeader('Set-Cookie',secureCookie('__Host-moa-google',''));
      if(params.has('error')||!params.get('code'))throw new AppError('Google 승인이 취소되었습니다.');
      let tokens;try{({tokens}=await client().getToken({code:params.get('code'),codeVerifier:flow.codeVerifier,redirect_uri:redirect}));}catch{throw new AppError('Google 승인을 완료하지 못했습니다.',502);}
      if(!tokens.refresh_token||!tokens.scope?.split(' ').includes(GOOGLE_SCOPE))throw new AppError('필요한 캘린더 권한을 승인해 주세요.');
      await locked('google:'+uid,async()=>{const previous=await read(uid);await save(uid,{...previous,tokens,reconnectRequired:false});});
      // A different Google account must not reuse an inaccessible prior calendar.
      await operate(uid,async(s,call)=>{if(s.calendar)try{await call('/calendars/'+encodeURIComponent(s.calendar.id));}catch(e){if([403,404].includes(e.status)){s.calendar=null;s.pending=false;}else throw e;}});
    },
    createCalendar:uid=>operate(uid,async(s,call)=>{if(s.calendar)return {created:false};if(s.pending)throw new AppError('이전 생성 결과를 Google에서 확인해야 합니다.',409);if(!s.tokens?.refresh_token)throw new AppError('Google 계정을 먼저 연결하세요.');
      s.pending=true;await save(uid,s);
      try{s.calendar=await call('/calendars',{method:'POST',data:{summary:'모아픽 · Instagram 일정',timeZone:'Asia/Seoul'}});s.pending=false;return {created:true};}
      catch(e){if([401,403].includes(e.status))s.pending=false;throw e;}}),
    publish:(uid,row,{verify=false}={})=>operate(uid,async(s,call)=>{
      if(!s.calendar)return {waiting:true,reason:'캘린더 연결 필요'};
      const [legacy]=await db.admin('moa_exports',{user_id:`eq.${uid}`,analysis_id:`eq.${row.id}`,source_user_id:'not.is.null',limit:'1'});
      const calendarId=legacy?.calendar_id??s.calendar.id;
      const sourceUid=legacy?.source_user_id??uid;
      const {payloads:allPayloads,blocked,reviewed}=calendarPayloads(sourceUid,row,env.PUBLIC_ORIGIN);
      const keptIndices=new Set(reviewed?(row.source_indices??row.reviewed.map((_,i)=>i)):row.result.events.map((_,i)=>i));
      const deletedIndices=new Set(row.deleted_indices??[]);
      // Tombstones remain authoritative after event_ids has been emptied by a successful delete.
      const removedIds=row.result.events.flatMap((_,i)=>deletedIndices.has(i)||(reviewed&&!keptIndices.has(i))?[digest(`moa:${sourceUid}:${row.id}:${i}`)]:[]);
      const payloads=allPayloads.filter(p=>upcomingPayload(p,now()));
      trace('google.payloads',{analysisId:row.id,count:payloads.length,blocked:blocked.length});const fingerprint=digest(JSON.stringify({payloads,blocked,reviewed,removedIds}));
      const query={user_id:`eq.${uid}`,analysis_id:`eq.${row.id}`,calendar_id:`eq.${calendarId}`};
      const [prior]=await db.admin('moa_exports',query);
      if(!verify&&prior?.status==='complete'&&prior.fingerprint===fingerprint)return {reused:true,links:prior.links,blocked};
      // Preserve the last known IDs even when a request fails midway.
      const previousIds=Array.isArray(prior?.event_ids)?prior.event_ids:(prior?row.result.events.map((_,i)=>digest(`moa:${legacy?.source_user_id??uid}:${row.id}:${i}`)):[]);
      await db.admin('moa_exports',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:uid,analysis_id:row.id,calendar_id:calendarId,fingerprint,status:'pending',event_ids:[...new Set([...previousIds,...payloads.map(p=>p.id),...removedIds])]}});
      const base='/calendars/'+encodeURIComponent(calendarId)+'/events',links=[];let written=0,verified=0;
      for(const payload of payloads){
        let existing;try{existing=await call(base+'/'+payload.id);}catch(error){if(error.status!==404)throw error;}
        if(existing?.status==='cancelled')continue; // Respect deletion in Google Calendar.
        let event;
        if(existing&&sameManagedEvent(existing,payload))event=existing;
        else if(existing) {
          const {id,...patch}=payload;
          patch.extendedProperties={...existing.extendedProperties,...patch.extendedProperties,private:{...existing.extendedProperties?.private,...patch.extendedProperties?.private}};
          if(existing.start?.date && patch.start.dateTime){patch.start.date=null;patch.end.date=null;}
          if(existing.start?.dateTime && patch.start.date){patch.start.dateTime=null;patch.start.timeZone=null;patch.end.dateTime=null;patch.end.timeZone=null;}
          event=await call(base+'/'+payload.id,{method:'PATCH',data:patch});
          written++;
        } else {
          try{event=await call(base,{method:'POST',data:payload});written++;}
          catch(error){if(error.status!==409)throw error;event=await call(base+'/'+payload.id);}
        }
        if(event!==existing)event=await verifyGoogleEvent(call,base+'/'+payload.id,{expected:payload,wait:verificationWait});
        verified++;trace('google.write_verified',{operation:'upsert',count:1});
        links.push(event.htmlLink??'');
      }
      // User excluded a draft while reviewing: remove only that app-created event.
      const currentIds=[...new Set([...payloads.map(p=>p.id),...allPayloads.filter(p=>!upcomingPayload(p,now())&&previousIds.includes(p.id)).map(p=>p.id)])];
      const toRemove=[...new Set([...removedIds,...((reviewed||row.deleted_indices?.length)?previousIds.filter(id=>!currentIds.includes(id)):[])])];
      let removed=0;
      for(const id of toRemove){
        // Verify even previously completed deletions. A restored/late event must not survive a tombstone.
        let existing;try{existing=await call(base+'/'+id);}catch(error){if([404,410].includes(error.status))continue;throw error;}
        if(existing?.status==='cancelled')continue;
        try{await call(base+'/'+id,{method:'DELETE'});removed++;}catch(error){if(![404,410].includes(error.status))throw error;}
        await verifyGoogleEvent(call,base+'/'+id,{deleted:true,wait:verificationWait});trace('google.write_verified',{operation:'delete',count:1});
      }
      trace('google.deletions',{count:toRemove.length,removed});
      await db.admin('moa_exports',query,{method:'PATCH',body:{status:'complete',links,event_ids:currentIds}});
      return {reused:false,links,blocked,reviewed,removed,checkedDeletions:toRemove.length,written,verified,googleVerified:true};
    })
  };
}
