const allowed=new Set(['/api/auth/me','/api/status','/api/integrations','/api/diagnostics','/api/events','/api/analyses','/api/analyze','/api/google/connect','/api/google/calendar','/oauth/google/callback','/api/meta/accounts','/api/meta/enable','/api/meta/unsubscribe','/api/meta/poll','/api/sync/reconcile','/api/account/delete']);
export function requestRoute(path){if(allowed.has(path))return path;if(/^\/api\/analyses\/[a-f0-9-]{36}(\/(review|google|delete-events|calendar.ics))?$/.test(path))return path.replace(/\/analyses\/[^/]+/,'/analyses/:id');return 'other';}
export async function saveRequestLog(db,{uid,path,method,status,started,snapshot,build}){
 if(!uid||path==='/api/diagnostics')return true;
 try{await db.admin('moa_request_logs',{}, {method:'POST',timeoutMs:2000,body:{id:snapshot.requestId,user_id:uid,route:requestRoute(path),method:['GET','POST'].includes(method)?method:'OTHER',status,duration_ms:Date.now()-started,build:/^[a-f0-9]{7,40}$/.test(build??'')?build:'unknown',steps:snapshot.steps.map(({analysisId,...step})=>step)}});
 // Bounded per-user retention; no other user's logs are touched.
 await db.admin('moa_request_logs',{user_id:`eq.${uid}`,created_at:`lt.${new Date(Date.now()-7*86400000).toISOString()}`},{method:'DELETE',timeoutMs:2000});
 return true;}catch{console.warn(JSON.stringify({diagnostic:true,stage:'request.log_unavailable'}));return false;}
}
