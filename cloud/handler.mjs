import {operationalAdmin,saveDevice,operationsSnapshot,collectionSnapshot} from './operations.mjs';
import {runCollectionJob} from './job.mjs';
import {preferences,historyQuery,createTestUsers} from './test-users.mjs';
import {saveRequestLog} from './request-logs.mjs';
import {trace,tracedRequest,traceSnapshot,traceDatabase,diagnosticFailureCode} from './diagnostics.mjs';
import {eventEntries,deletionIndices} from './event-management.mjs';
import {AppError,validateReview} from '../lib/extraction.mjs';
import {accountName} from '../lib/instagram.mjs';
import {calendar} from '../lib/calendar.mjs';
import {cipher,validateOrigin,securityHeaders,digest} from './security.mjs';
import {createSupabase} from './supabase.mjs';
import {createAuth} from './auth.mjs';
import {createCollection} from './collection.mjs';
import {createCloudGoogle} from './google.mjs';
import {createSync} from './sync.mjs';
import {calendarPayloads} from './calendar-payload.mjs';
async function readBody(req){let raw='',size=0;if(req.body!==undefined){raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);size=Buffer.byteLength(raw);}else for await(const c of req){size+=c.length;if(size>4*1024*1024)throw new AppError('요청이 너무 큽니다. 배포판은 합계 3MB 이하 이미지를 사용하세요.',413);raw+=c;}if(size>4*1024*1024)throw new AppError('요청이 너무 큽니다.',413);try{return JSON.parse(raw);}catch{throw new AppError('JSON 입력을 확인하세요.');}}
export function createHandler(env,{db=createSupabase(env),crypto=cipher(env.TOKEN_ENCRYPTION_KEY),collection}={}){
  const logDb=db;
  db=traceDatabase(db);
  const auth=createAuth({db,crypto,origin:env.PUBLIC_ORIGIN,supabaseUrl:env.SUPABASE_URL});
  let sync;
  const collect=collection??createCollection({db,env,onComplete:row=>sync.enqueueAnalysis(row)}),google=createCloudGoogle({db,crypto,env,locked:collect.locked});
  sync=createSync({db,env,collection:collect,google});
  const testers=createTestUsers({db,collection:collect,dailyLimit:Number(env.DAILY_ANALYSIS_LIMIT||100),createScoped:(scoped,scope)=>createCollection({db:scoped,env,scope,onComplete:row=>sync.enqueueAnalysis(row)})});
  return async(req,res)=>tracedRequest(async()=>{
    let logUid=null,logPath='other';const requestStarted=Date.now();
    const send=async(status,value,type='application/json; charset=utf-8')=>{trace('request.complete',{status});const diagnostic=traceSnapshot();const persisted=await saveRequestLog(logDb,{uid:logUid,path:logPath,method:req.method,status,started:requestStarted,snapshot:diagnostic,build:env.VERCEL_GIT_COMMIT_SHA,req});if(!persisted)diagnostic.logUnavailable=true;if(type.startsWith('application/json')&&value&&!Array.isArray(value))value={...value,diagnostics:diagnostic};res.setHeader('X-Moa-Request-Id',diagnostic.requestId);res.writeHead(status,{...securityHeaders,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
    try{
      const url=new URL(req.url,env.PUBLIC_ORIGIN),path=url.searchParams.has('route')?'/'+url.searchParams.get('route'):url.pathname;
      logPath=path;trace('request.received',{method:req.method});
      const callback=req.method==='GET'&&['/auth/callback','/oauth/google/callback'].includes(path);
      // Schedulers use an explicit secret and do not depend on browser cookies.
      if(path==='/api/cron'&&req.method==='GET'){
        if(!env.CRON_SECRET || req.headers.authorization!==`Bearer ${env.CRON_SECRET}`)throw new AppError('인증이 필요합니다.',401);
        collect.runTest=testers.run;await runCollectionJob({db,collection:collect});await sync.drain(2);
        return send(200,{ok:true});
      }
      validateOrigin(req,env.PUBLIC_ORIGIN,{callback});
      if(path==='/api/auth/google'&&req.method==='POST'){
        const ip=req.headers['x-vercel-forwarded-for']??req.socket?.remoteAddress??'unknown';
        if(!await db.rpc('moa_take_limit',{p_bucket:'login:'+digest(String(ip)),p_limit:20,p_seconds:900}))throw new AppError('잠시 후 다시 로그인해 주세요.',429);
        return send(200,await auth.begin(res));
      }
      if(path==='/auth/callback'&&req.method==='GET'){
        await auth.callback(req,res,url.searchParams);
        return send(200,'<!doctype html><html lang="ko"><meta charset="utf-8"><title>로그인 완료</title><h1>로그인했습니다.</h1><a href="/">모아로 돌아가기</a></html>','text/html; charset=utf-8');
      }
      if(path==='/api/auth/logout'&&req.method==='POST'){await auth.logout(req,res);return send(200,{ok:true});}
      trace('session.check');const s=await auth.session(req);trace('session.checked',{connected:!!s});logUid=s?.user.id??null;
      if(path==='/api/auth/me'&&req.method==='GET')return send(200,{user:s?{...s.user,operations:operationalAdmin(env,s.user.id)}:null,setup:false});
      if(!s)throw new AppError('Google 계정으로 로그인해 주세요.',401);
      const uid=s.user.id;
      if(req.method==='POST'&&path!=='/api/device')await saveRequestLog(logDb,{uid,path,method:req.method,status:102,started:requestStarted,snapshot:traceSnapshot(),build:env.VERCEL_GIT_COMMIT_SHA,req,phase:'running'});
      if(path==='/api/device'&&req.method==='POST')return send(200,await saveDevice(logDb,uid,req,await readBody(req)));
      if(path==='/api/operations'&&req.method==='GET')return send(200,await operationsSnapshot(logDb,env,uid));
      if(req.method==='POST'&&!await db.rpc('moa_take_limit',{p_bucket:'write:'+uid,p_limit:60,p_seconds:60}))throw new AppError('요청이 많습니다. 잠시 후 다시 시도하세요.',429);
      const visible=async (id,includeExported=false)=>{
        if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('기록을 찾을 수 없습니다.',404);
        let [row]=await db.read('moa_analyses',{id:`eq.${id}`,status:'neq.superseded'},s.token);
        if(!row&&includeExported&&(await db.read('moa_exports',{analysis_id:`eq.${id}`,limit:'1'},s.token)).length)[row]=await db.admin('moa_analyses',{id:`eq.${id}`,status:'eq.complete'});
        if(!row)throw new AppError('기록을 찾을 수 없습니다.',404);
        const [review]=await db.read('moa_reviews',{analysis_id:`eq.${id}`},s.token),deleted=await db.read('moa_event_deletions',{analysis_id:`eq.${id}`},s.token);return {...row,reviewed:review?.events??null,source_indices:review?.source_indices??null,deleted_indices:deleted.map(d=>d.event_index)};
      };
      const subscriptions=()=>db.read('moa_subscriptions',{},s.token);
      const requireSubscription=async name=>{if(!(await db.read('moa_subscriptions',{username:`eq.${name}`},s.token)).length)throw new AppError('구독을 찾을 수 없습니다.',404);};
      const collectorStatus=async()=>{
        const pref=await preferences(db,uid);
        if(pref.test_user){const subs=await subscriptions(),accounts=await db.read('moa_test_accounts',{},s.token);return {busy:false,interval_minutes:60,accounts:subs.map(sub=>({...accounts.find(a=>a.username===sub.username),username:sub.username,enabled:sub.enabled,phase:accounts.find(a=>a.username===sub.username)?.phase??'initial',processed:accounts.find(a=>a.username===sub.username)?.processed??0})),posts:await db.admin('moa_test_posts',{user_id:`eq.${uid}`,select:'id,username,status,analysis_id,attempts,error,updated_at',order:'updated_at.desc',limit:'20'})};}
        const subs=await subscriptions(),accounts=await db.read('moa_accounts',{},s.token),posts=[];
        for(const a of accounts){posts.push(...await db.admin('moa_posts',{username:`eq.${a.username}`,select:'id,username,status,analysis_id,attempts,error,updated_at',order:'updated_at.desc',limit:'10'}));}
        return {busy:false,interval_minutes:60,accounts:accounts.map(a=>({...a,enabled:subs.find(x=>x.username===a.username)?.enabled})),posts};
      };
      if(path==='/api/test/settings'&&req.method==='GET')return send(200,await preferences(db,uid));
      if(path==='/api/test/settings'&&req.method==='POST'){const input=await readBody(req);if(typeof input.test_user!=='boolean')throw new AppError('설정값을 확인하세요.');await db.admin('moa_preferences',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:uid,test_user:input.test_user}});trace('test.mode.save',{connected:input.test_user});return send(200,{ok:true});}
      if(path==='/api/test/reset'&&req.method==='POST')return send(200,await testers.reset(uid,await readBody(req)));
      if(path==='/api/test/collect'&&req.method==='POST'){const result=await testers.run(uid);return send(200,{...result,...(result.processed?{sync:await sync.reconcile(uid,{begin:false})}:{} )});}
      if(path==='/api/account/delete'&&req.method==='POST'){await auth.remove(s,await readBody(req),res);return send(200,{ok:true});}
      if(path==='/api/diagnostics'&&req.method==='GET'){
        const pref=await preferences(db,uid);
        const [jobs,exports,analyses]=await Promise.all([
          db.read('moa_sync_jobs',{order:'requested_at.desc',limit:'30'},s.token),
          db.read('moa_exports',{limit:'100'},s.token),
          db.read('moa_analyses',{...historyQuery(pref),...(pref.test_user?{owner_id:`eq.${uid}`}:{ }),status:'neq.superseded',order:'created_at.desc',limit:'30'},s.token)]);
        const collection=await collectionSnapshot(db,uid,pref,s.token);
        let requests=[],logAvailable=true;try{requests=await db.read('moa_request_logs',{created_at:`gte.${new Date(Date.now()-7*86400000).toISOString()}`,order:'created_at.desc',limit:'100',select:'id,created_at,route,method,status,duration_ms,build,steps,phase'},s.token);}catch{logAvailable=false;}
        const connection=await google.status(uid);
        const verification=url.searchParams.get('verify')==='1'?await google.verifyRecent(uid):null;
        return send(200,{at:new Date().toISOString(),server:{platform:'Vercel',api:'responding',database:'connected',build:env.VERCEL_GIT_COMMIT_SHA?.slice(0,12)??'unknown',durationMs:Date.now()-requestStarted,logAvailable,retentionDays:7},requests,google:{connected:connection.connected,calendar:!!connection.calendar,reconnectRequired:!!connection.reconnectRequired},
          testUser:!!pref.test_user,collection,
          jobs:jobs.map(j=>({analysisId:j.analysis_id,attempts:j.attempts,nextDue:j.next_due,requestedAt:j.requested_at,failed:!!j.error,failureCode:diagnosticFailureCode(j.error)})),
          exports:exports.map(e=>({analysisId:e.analysis_id,status:e.status,count:e.event_ids?.length??0})),
          analyses:analyses.map(a=>({analysisId:a.id,status:a.status,createdAt:a.created_at,count:a.result?.events?.length??0,failureCode:diagnosticFailureCode(a.error),provider:a.usage?.failure??null,usage:{inputTokens:a.usage?.input_tokens??null,outputTokens:a.usage?.output_tokens??null,totalTokens:a.usage?.total_tokens??null,reused:!!a.usage?.cache_reused}})),verification});
      }
      if(path==='/api/sync/reconcile'&&req.method==='POST'){const input=await readBody(req);return send(200,await sync.reconcile(uid,{begin:input.begin!==false}));}
      if(path==='/api/status'&&req.method==='GET')return send(200,{configured:!!env.OPENAI_API_KEY,model:env.OPENAI_MODEL||'gpt-5.4-mini',count:null,limit:Number(env.DAILY_ANALYSIS_LIMIT||100),busy:false});
      if(path==='/api/integrations'&&req.method==='GET')return send(200,{google:await google.status(uid),meta:collect.metaStatus(),collector:await collectorStatus()});
      if(path==='/api/google/connect'&&req.method==='POST')return send(200,await google.begin(uid,res));
      if(path==='/oauth/google/callback'&&req.method==='GET'){await google.callback(uid,req,res,url.searchParams);return send(200,'<!doctype html><html lang="ko"><meta charset="utf-8"><title>Google 연결 완료</title><h1>Google 캘린더를 연결했습니다.</h1><a href="/">모아로 돌아가기</a></html>','text/html; charset=utf-8');}
      if(path==='/api/google/calendar'&&req.method==='POST'){const result=await google.createCalendar(uid);const reconciliation=await sync.reconcile(uid);return send(200,{...result,reconciliation});}
      if(path==='/api/meta/accounts'&&req.method==='POST'){await collect.subscribe(uid,(await readBody(req)).username);await sync.enqueueVisible(uid);return send(200,await collectorStatus());}
      if(['/api/meta/enable','/api/meta/unsubscribe','/api/meta/poll'].includes(path)&&req.method==='POST'){
        const input=await readBody(req),name=accountName(input.username);await requireSubscription(name);
        let collectionResult;
        if(path.endsWith('/poll')){if((await preferences(db,uid)).test_user)collectionResult=await testers.run(uid,{username:name});else await collect.poll(name);await sync.reconcile(uid,{begin:false});}
        else if(path.endsWith('/unsubscribe'))await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,username:`eq.${name}`},{method:'DELETE'});
        else{if(typeof input.enabled!=='boolean')throw new AppError('설정값을 확인하세요.');await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,username:`eq.${name}`},{method:'PATCH',body:{enabled:input.enabled}});}
        return send(200,{...await collectorStatus(),...(collectionResult?{collectionResult}:{})});
      }
      if(path==='/api/events'&&req.method==='GET'){
        const offset=Number(url.searchParams.get('offset')??0);
        if(!Number.isInteger(offset)||offset<0)throw new AppError('페이지를 확인하세요.');
        const ids=new Set();
        for(let n=0;;n+=1000){const page=await db.read('moa_analyses',{status:'eq.complete',select:'id',order:'id.asc',limit:'1000',offset:String(n)},s.token);page.forEach(r=>ids.add(r.id));if(page.length<1000)break;}
        for(let n=0;;n+=1000){const page=await db.read('moa_exports',{select:'analysis_id',order:'analysis_id.asc',limit:'1000',offset:String(n)},s.token);page.forEach(r=>ids.add(r.analysis_id));if(page.length<1000)break;}
        const pageIds=[...ids].sort().slice(offset,offset+100);
        const rows=pageIds.length?await db.admin('moa_analyses',{id:`in.(${pageIds.join(',')})`,status:'eq.complete',order:'id.asc'}):[];
        const readAll=async table=>{const out=[];for(let n=0;;n+=1000){const page=await db.read(table,{order:'analysis_id.asc',limit:'1000',offset:String(n)},s.token);out.push(...page);if(page.length<1000)return out;}};
        const reviews=await readAll('moa_reviews'),deleted=await readAll('moa_event_deletions');
        const events=rows.flatMap(row=>{const review=reviews.find(v=>v.analysis_id===row.id);return eventEntries({...row,reviewed:review?.events??null,source_indices:review?.source_indices,deleted_indices:deleted.filter(d=>d.analysis_id===row.id).map(d=>d.event_index)});});
        return send(200,{events,next:offset+100<ids.size?offset+100:null});
      }
      const deletion=/^\/api\/analyses\/([a-f0-9-]+)\/delete-events$/.exec(path);
      if(deletion&&req.method==='POST'){
        const input=await readBody(req),id=deletion[1];
        const count=await collect.locked(`sync:${uid}:${id}`,async()=>{
          const row=await visible(id,true);if(row.status!=='complete')throw new AppError('완료된 일정만 삭제할 수 있습니다.');
          const indices=deletionIndices(input,row);
          // Save a durable retry job first; the sync lock prevents it running before the tombstones exist.
          await sync.enqueue(uid,id);
          await db.admin('moa_event_deletions',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:indices.map(event_index=>({user_id:uid,analysis_id:id,event_index}))});
          return indices.length;
        });
        let result;try{result=await sync.one(uid,id);}catch(e){result={pending:true,error:'캘린더 삭제 반영을 자동 재시도합니다.'};}
        return send(200,{deleted:count,sync:result});
      }
      if(path==='/api/analyses'&&req.method==='GET'){
        const pref=await preferences(db,uid);const rows=await db.read('moa_analyses',{...historyQuery(pref),...(pref.test_user?{owner_id:`eq.${uid}`}:{ }),status:'neq.superseded',order:'created_at.desc',limit:'50'},s.token),reviews=await db.read('moa_reviews',{},s.token);
        return send(200,rows.map(r=>({...r,reviewed:reviews.find(v=>v.analysis_id===r.id)?.events??null,source_indices:reviews.find(v=>v.analysis_id===r.id)?.source_indices??null})));
      }
      const match=/^\/api\/analyses\/([a-f0-9-]+)(\/review|\/google|\/calendar.ics)?$/.exec(path);
      if(match){const row=await visible(match[1]);
        if(req.method==='GET'&&!match[2]){const jobs=await db.read('moa_sync_jobs',{analysis_id:`eq.${row.id}`},s.token);return send(200,{...row,sync:jobs[0]??null});}
        if(req.method==='GET'&&match[2]==='/calendar.ics'){if(!row.reviewed)throw new AppError('검토 후 저장하세요.');res.setHeader('Content-Disposition','attachment; filename="events.ics"');return send(200,calendar({...row,reviewed:eventEntries(row).map(e=>e.event)}),'text/calendar; charset=utf-8');}
        if(req.method==='POST'&&match[2]==='/review'){const input=await readBody(req);if(input.confirmed!==true||row.status!=='complete')throw new AppError('완료된 분석을 원문과 비교하고 확인해 주세요.');
          const events=input.events?.length?validateReview(input.events):[];
          const indices=input.source_indices??events.map((_,i)=>i);
          if(!Array.isArray(indices)||indices.length!==events.length||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=row.result.events.length))throw new AppError('원본 일정 연결 정보를 확인하세요.');
          calendarPayloads(uid,{...row,reviewed:events,source_indices:indices},env.PUBLIC_ORIGIN);
          trace('review.save',{analysisId:row.id,count:events.length});await db.admin('moa_reviews',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{user_id:uid,analysis_id:row.id,events,source_indices:indices}});
          await sync.enqueue(uid,row.id);const result=await sync.one(uid,row.id);return send(200,{...await visible(row.id),sync:result});}
        if(req.method==='POST'&&match[2]==='/google'){if((await readBody(req)).confirmed!==true)throw new AppError('등록 확인이 필요합니다.');await sync.enqueue(uid,row.id);return send(200,await sync.one(uid,row.id));}
      }
      if(path==='/api/analyze'&&req.method==='POST'){
        if(!await db.rpc('moa_take_limit',{p_bucket:'user-analysis:'+uid+':'+new Date().toISOString().slice(0,10),p_limit:Number(env.DAILY_ANALYSIS_LIMIT||100),p_seconds:86400}))throw new AppError('회원별 일일 분석 한도에 도달했습니다.',429);
        trace('input.read');const input=await readBody(req);trace('analysis.start');const row=await collect.analyzeInput(input,uid);trace('analysis.complete',{analysisId:row.id,count:row.result?.events?.length??0});await sync.enqueue(uid,row.id);const result=await sync.one(uid,row.id);return send(200,{...row,reviewed:null,sync:result});
      }
      throw new AppError('페이지를 찾을 수 없습니다.',404);
    }catch(e){trace('request.failed',{status:e instanceof AppError?e.status:500});return send(e instanceof AppError?e.status:500,{error:e instanceof AppError?e.message:'서버 오류가 발생했습니다. 인증 정보는 기록하지 않았습니다.'});}
  });
}
