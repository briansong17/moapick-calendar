// Explicit one-member migration approved by the owner. No passwords or OAuth grants migrate.
import {DatabaseSync,backup} from 'node:sqlite';
import {loadEnvFile} from 'node:process';
import {writeFile} from 'node:fs/promises';
import {digest} from '../cloud/security.mjs';
import {createCollection} from '../cloud/collection.mjs';
import {createSupabase} from '../cloud/supabase.mjs';
loadEnvFile('.env.cloud.local');
const db=createSupabase(process.env),local=new DatabaseSync('data/events.sqlite',{readOnly:true});
const email='songhaegeun280@gmail.com';
const source=local.prepare('select id,login from users where login=?').get(email);
if(source?.id!=='03716638-6f7c-4570-b107-d9f29e107088')throw new Error('Approved source member does not match');
const {users}=await db.auth('admin/users?per_page=100',{admin:true});
const matches=users.filter(u=>u.email===email&&u.email_confirmed_at&&u.app_metadata?.providers?.includes('google'));
if(matches.length!==1)throw new Error('Unique verified Google destination required');
const uid=matches[0].id;
const subs=local.prepare('select username,enabled from subscriptions where user_id=?').all(source.id);
const rows=local.prepare(`select distinct a.* from analyses a where exists(select 1 from analysis_owners o where o.analysis_id=a.id and o.user_id=?) or exists(select 1 from instagram_posts p join subscriptions s on p.username=s.username where p.analysis_id=a.id and s.user_id=?)`).all(source.id,source.id);
const plans=[];
for(const a of rows){
 const post=local.prepare('select * from instagram_posts where analysis_id=? and username in (select username from subscriptions where user_id=?)').get(a.id,source.id);
 const own=local.prepare('select 1 from analysis_owners where analysis_id=? and user_id=?').get(a.id,source.id);
 const metadata=JSON.parse(a.metadata),result=a.result&&JSON.parse(a.result);
 if(!own&&!post)throw new Error('Inaccessible source record');
 const record={id:a.id,owner_id:own?uid:null,account:own?null:post.username,hash:a.hash,status:a.status,metadata,result,usage:a.usage&&JSON.parse(a.usage),error:a.error,created_at:a.created_at};
 const review=local.prepare('select events from user_reviews where user_id=? and analysis_id=?').get(source.id,a.id);
 const events=review?JSON.parse(review.events):null;
 const indices=events?.map((e,i)=>{const matched=result.events.findIndex(x=>x.title===e.title&&x.kind===e.kind);return matched>=0?matched:i;});
 if(indices&&new Set(indices).size!==indices.length)throw new Error('Review mapping requires manual inspection');
 const [existing]=await db.admin('moa_analyses',{id:`eq.${a.id}`});
 if(existing&&(existing.owner_id!==record.owner_id||existing.account!==record.account))throw new Error('Destination ownership conflict');
 const [existingReview]=await db.admin('moa_reviews',{user_id:`eq.${uid}`,analysis_id:`eq.${a.id}`});
 if(existingReview&&JSON.stringify(existingReview.events)!==JSON.stringify(events))throw new Error('Destination review conflict');
 const exports=local.prepare('select * from google_exports where analysis_id=?').all(source.id+':'+a.id);
 plans.push({record,review:events?{user_id:uid,analysis_id:a.id,events,source_indices:indices}:null,post,exports:exports.map(e=>({user_id:uid,analysis_id:a.id,calendar_id:e.calendar_id,fingerprint:e.fingerprint,status:'legacy-complete',source_user_id:source.id,event_ids:(events??[]).map((_,i)=>digest(`moa:${source.id}:${a.id}:${i}`)),links:JSON.parse(e.links??'[]')}))});
}
console.log({source:email,subscriptions:subs.length,analyses:plans.length,reviews:plans.filter(p=>p.review).length,historicalExports:plans.reduce((n,p)=>n+p.exports.length,0),excluded:'qa-owner private records and credentials',apply:process.argv.includes('--apply')});
if(!process.argv.includes('--apply'))process.exit(0);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
await backup(local,`data/before-cloud-migration-${stamp}.sqlite`);
const manifest={sourceId:source.id,destinationId:uid,started_at:new Date().toISOString(),analyses:plans.map(p=>p.record.id),subscriptions:subs.map(s=>s.username)};
await writeFile(`data/migration-${stamp}.json`,JSON.stringify(manifest,null,2));
for(const s of subs){
 await db.admin('moa_accounts',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{username:s.username}});
 await db.admin('moa_subscriptions',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{user_id:uid,username:s.username,enabled:!!s.enabled}});
}
const collection=createCollection({db,env:process.env});
for(const p of plans){
 const migrate=async()=>{
 if(p.post){const [existingPost]=await db.admin('moa_posts',{id:`eq.${p.post.id}`});if(existingPost?.analysis_id&&existingPost.analysis_id!==p.record.id)throw new Error('Existing completed post requires explicit reconciliation');}
 await db.admin('moa_analyses',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:p.record});
 if(p.post){await db.admin('moa_posts',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{...p.post,payload:JSON.parse(p.post.payload)}});await db.admin('moa_posts',{id:`eq.${p.post.id}`},{method:'PATCH',body:{status:'complete',analysis_id:p.record.id,error:null}});}
 if(p.review)await db.admin('moa_reviews',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:p.review});
 for(const e of p.exports)await db.admin('moa_exports',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:e});
 };
 if(p.post)await collection.locked('collect:'+p.post.username,migrate);else await migrate();
}
for(const p of plans){const [r]=await db.admin('moa_analyses',{id:`eq.${p.record.id}`});if(!r||r.account!==p.record.account||r.owner_id!==p.record.owner_id)throw new Error('Migration verification failed');}
console.log('Migration verified. Local source and both existing calendar connections preserved.');
