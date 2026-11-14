import {deviceKind,browserKind} from './operations.mjs';
const allowed=new Set(['/api/device','/api/operations','/api/test/settings','/api/test/reset','/api/test/collect','/api/auth/me','/api/status','/api/integrations','/api/diagnostics','/api/events','/api/analyses','/api/analyze','/api/google/connect','/api/google/calendar','/oauth/google/callback','/api/meta/accounts','/api/meta/enable','/api/meta/unsubscribe','/api/meta/poll','/api/sync/reconcile','/api/sync/status','/api/sync/background','/api/account/delete']);
for(const path of ['/api/admin/members','/api/admin/member-events','/api/admin/member-event-google'])allowed.add(path);
export function requestRoute(path){if(allowed.has(path))return path;if(/^\/api\/analyses\/[a-f0-9-]{36}(\/(review|google|delete-events|calendar.ics))?$/.test(path))return path.replace(/\/analyses\/[^/]+/,'/analyses/:id');return 'other';}
export async function saveRequestLog(db,{uid,path,method,status,started,snapshot,build,req,phase='complete'}){
 if(!uid||['/api/diagnostics','/api/operations','/api/device'].includes(path))return true;
 try{await db.admin('moa_request_logs',{}, {method:'POST',prefer:'resolution=merge-duplicates',timeoutMs:3000,body:{id:snapshot.requestId,user_id:uid,phase,...(req?{device_id:/^[0-9a-f-]{36}$/.test(req.headers['x-moa-device']??'')?req.headers['x-moa-device']:null,kind:deviceKind(req.headers['user-agent']),browser:browserKind(req.headers['user-agent'])}:{}),route:requestRoute(path),method:['GET','POST'].includes(method)?method:'OTHER',status,duration_ms:Date.now()-started,build:/^[a-f0-9]{7,40}$/.test(build??'')?build:'unknown',steps:snapshot.steps.map(({analysisId,...step})=>step)}});
 if(phase==='running')return true;
 // Bounded per-user retention; no other user's logs are touched.
 await db.admin('moa_request_logs',{user_id:`eq.${uid}`,created_at:`lt.${new Date(Date.now()-7*86400000).toISOString()}`},{method:'DELETE',timeoutMs:2000});
 return true;}catch{console.warn(JSON.stringify({diagnostic:true,stage:'request.log_unavailable'}));return false;}
}
