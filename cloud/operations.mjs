import {randomUUID,createHash} from 'node:crypto';
import {diagnosticFailureCode} from './diagnostics.mjs';
export const operationalAdmin=(env,uid)=>(env.OPERATIONS_ADMIN_IDS??'').split(',').map(x=>x.trim()).includes(uid);
export function deviceKind(ua=''){return /iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh/.test(ua)?'macOS':'Other';}
export function browserKind(ua=''){return /Edg\//.test(ua)?'Edge':/CriOS|Chrome/.test(ua)?'Chrome':/FxiOS|Firefox/.test(ua)?'Firefox':/Safari/.test(ua)?'Safari':'Other';}
export function clientTag(value){return /^[0-9a-f-]{36}$/.test(value??'')?value:randomUUID();}
const clientStages=new Set(['page.start','page.visible','page.hidden','network.online','network.offline','image.selected','image.read.start','image.read.complete','image.read.failed','javascript.error','javascript.rejection','request.failed','request.waiting']);
export function cleanClientEvents(events){return (Array.isArray(events)?events:[]).slice(-30).filter(e=>clientStages.has(e?.stage)).map(e=>({stage:e.stage,at:Number.isFinite(Date.parse(e.at))?new Date(e.at).toISOString():new Date().toISOString(),...(Number.isFinite(e.status)?{status:e.status}:{}),...(typeof e.online==='boolean'?{online:e.online}:{}),...(typeof e.code==='string'&&/^[a-z_]{1,40}$/.test(e.code)?{code:e.code}:{})}));}
export async function saveDevice(db,uid,req,input={}){
 const device_id=clientTag(req.headers['x-moa-device']);
 if(!await db.rpc('moa_take_limit',{p_bucket:'device:'+uid+':'+device_id,p_limit:8,p_seconds:60}))return {ok:false,throttled:true};
 const [previous]=await db.admin('moa_devices',{user_id:`eq.${uid}`,device_id:`eq.${device_id}`,select:'events',limit:'1'});
 const events=[...cleanClientEvents(previous?.events),...cleanClientEvents(input.events)].filter(e=>Date.parse(e.at)>Date.now()-7*86400000).slice(-30);
 await db.admin('moa_devices',{}, {method:'POST',prefer:'resolution=merge-duplicates',timeoutMs:3000,body:{user_id:uid,device_id,last_seen:new Date().toISOString(),kind:deviceKind(req.headers['user-agent']),browser:browserKind(req.headers['user-agent']),view:['events','upload','history','subscriptions','testing','diagnostics','settings','review'].includes(input.view)?input.view:'unknown',events}});
 return {ok:true};
}
export async function operationsSnapshot(db,env,uid){
 const own=!operationalAdmin(env,uid),since=`gte.${new Date(Date.now()-7*86400000).toISOString()}`;
 const devices=await db.admin('moa_devices',{...(own?{user_id:`eq.${uid}`}:{ }),last_seen:since,select:'device_id,kind,browser,last_seen,view,events',order:'last_seen.desc',limit:'100'});
 const requests=await db.admin('moa_request_logs',{...(own?{user_id:`eq.${uid}`}:{ }),created_at:since,select:'device_id,kind,browser,route,method,status,duration_ms,created_at,phase',order:'created_at.desc',limit:'100'});
 const alias=value=>value?createHash('sha256').update(env.TOKEN_ENCRYPTION_KEY+value).digest('hex').slice(0,8):'legacy';
 return {scope:own?'self':'operations',at:new Date().toISOString(),devices:devices.map(({device_id,...r})=>({...r,device:alias(device_id)})),requests:requests.map(({device_id,id,...r})=>({...r,device:alias(device_id)}))};
}
export async function collectionSnapshot(db,uid,pref,token){
 const accounts=await db.read(pref.test_user?'moa_test_accounts':'moa_accounts',{},token);
 return accounts.map(a=>({phase:a.phase,lastChecked:a.last_checked,nextDue:a.next_due,processed:a.processed,failed:!!a.error,failureCode:diagnosticFailureCode(a.error)}));
}
