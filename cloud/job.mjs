// Process one post per run so an image request stays within the function deadline.
export async function runCollectionJob({db,collection,now=new Date()}) {
  const iso=now.toISOString();
  for(const table of ['moa_sessions','moa_oauth','moa_limits','moa_locks'])
    await db.admin(table,{expires_at:`lt.${iso}`},{method:'DELETE'});
  const due=await db.admin('moa_accounts',{next_due:`lte.${iso}`,phase:'neq.paused',order:'next_due.asc',limit:'100'});
  for(const account of due) {
    const active=await db.admin('moa_subscriptions',{username:`eq.${account.username}`,enabled:'eq.true',limit:'1'});
    if(!active.length){
      await db.admin('moa_accounts',{username:`eq.${account.username}`},{method:'PATCH',body:{next_due:new Date(now.getTime()+3600000).toISOString()}});
      continue;
    }
    try {await collection.poll(account.username);return {processed:true};}
    catch(error){if([401,409,429].includes(error.status))return {processed:false,deferred:true};throw error;}
  }
  return {processed:false};
}
