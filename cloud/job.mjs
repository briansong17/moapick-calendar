import {preferences} from './test-users.mjs';
// Process one post per run so an image request stays within the function deadline.
export async function runCollectionJob({db,collection,now=new Date()}) {
  const iso=now.toISOString();
  for(const table of ['moa_sessions','moa_oauth','moa_limits','moa_locks'])
    await db.admin(table,{expires_at:`lt.${iso}`},{method:'DELETE'});
  const due=await db.admin('moa_accounts',{next_due:`lte.${iso}`,phase:'neq.paused',order:'next_due.asc',limit:'100'});
  for(const account of due) {
    const subscribed=await db.admin('moa_subscriptions',{username:`eq.${account.username}`,enabled:'eq.true'});
    const active=[];for(const sub of subscribed){if(!(await preferences(db,sub.user_id)).test_user){active.push(sub);break;}}
    if(!active.length){
      await db.admin('moa_accounts',{username:`eq.${account.username}`},{method:'PATCH',body:{next_due:new Date(now.getTime()+3600000).toISOString()}});
      continue;
    }
    try {const result=await collection.poll(account.username);if(result?.processed===false)continue;return {processed:true};}
    catch(error){if([401,409,429].includes(error.status))return {processed:false,deferred:true};throw error;}
  }
  if(collection.runTest){const users=await db.admin('moa_preferences',{test_user:'eq.true',limit:'100'});for(const user of users){try{const r=await collection.runTest(user.user_id);if(r.processed)return r;}catch(e){if(![401,409,429].includes(e.status))throw e;}}}
  return {processed:false};
}
