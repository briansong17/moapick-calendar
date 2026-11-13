import {AppError} from '../lib/extraction.mjs';
import {trace} from './diagnostics.mjs';
export async function preferences(db,uid){return (await db.admin('moa_preferences',{user_id:`eq.${uid}`,limit:'1'}))[0]??{test_user:false,history_reset_at:null};}
export function historyQuery(pref){return pref.history_reset_at?{created_at:`gte.${pref.history_reset_at}`}:{ };}
// Keep shared posts and account cursors intact. All mutations in this view are scoped.
export function testDatabase(db,uid){return {...db,admin:async(table,query={},options)=>{
 if(!['moa_accounts','moa_posts'].includes(table))return db.admin(table,query,options);
 const name=table==='moa_accounts'?'moa_test_accounts':'moa_test_posts';
 let opts=options;
 if(opts?.body){const own=row=>({...row,user_id:uid});opts={...opts,body:Array.isArray(opts.body)?opts.body.map(own):own(opts.body)};}
 return db.admin(name,{...query,user_id:`eq.${uid}`,...(opts?.method==='POST'?{on_conflict:table==='moa_accounts'?'user_id,username':'user_id,id'}:{})},opts);
}};}
export function createTestUsers({db,collection,createScoped}){
 async function run(uid,{username}={}){return collection.locked('test-user:'+uid,async()=>{
  const pref=await preferences(db,uid);if(!pref.test_user)return {processed:false,reason:'normal_user'};
  const subs=await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,enabled:'eq.true',...(username?{username:`eq.${username}`}:{ }),order:'username.asc'});
  const scoped=testDatabase(db,uid),now=new Date();
  for(const sub of subs){let [account]=await scoped.admin('moa_accounts',{username:`eq.${sub.username}`});
   if(!account){await scoped.admin('moa_accounts',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{username:sub.username}});[account]=await scoped.admin('moa_accounts',{username:`eq.${sub.username}`});}
   if(account.phase==='paused'||Date.parse(account.next_due)>now.getTime())continue;
   trace('test.collect.start');await createScoped(scoped,{uid,generation:pref.generation}).poll(sub.username);trace('test.collect.complete',{count:1});return {processed:true,count:1};
  }
  return {processed:false,count:0,reason:subs.length?'not_due':'no_enabled_subscription'};
 });}
 async function reset(uid,input){if(input.confirmation!=='분석 기록 초기화')throw new AppError('확인 문구를 입력해 주세요.');
  return collection.locked('test-user:'+uid,async()=>{if(!(await preferences(db,uid)).test_user)throw new AppError('테스트 사용자를 먼저 선택하세요.',409);
   await db.rpc('moa_reset_test_history',{p_user:uid});trace('test.history.reset');return {ok:true};});}
 return {run,reset};
}
