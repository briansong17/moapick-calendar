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
export function createTestUsers({db,collection,createScoped,dailyLimit=100}){
 async function run(uid,{username}={}){return collection.locked('test-user:'+uid,async()=>{
  const pref=await preferences(db,uid);if(!pref.test_user)return {processed:false,reason:'normal_user'};
  const subs=await db.admin('moa_subscriptions',{user_id:`eq.${uid}`,enabled:'eq.true',...(username?{username:`eq.${username}`}:{ }),order:'username.asc'});
  const scoped=testDatabase(db,uid),now=new Date(),skipped=[];
  for(const sub of subs){let [account]=await scoped.admin('moa_accounts',{username:`eq.${sub.username}`});
   if(!account){await scoped.admin('moa_accounts',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{username:sub.username}});[account]=await scoped.admin('moa_accounts',{username:`eq.${sub.username}`});}
   if(account.phase==='paused')continue;
   if(Date.parse(account.next_due)>now.getTime()){
    let quotaRecovered=false;
    if(account.error==='오늘의 분석 한도에 도달했습니다.'){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);const [counter]=await db.admin('moa_limits',{bucket:`eq.analysis:${day}`,select:'count'});quotaRecovered=(counter?.count??0)<dailyLimit;}
    if(!quotaRecovered){skipped.push({nextDue:account.next_due,failed:!!account.error});continue;}
   }
   trace('test.collect.start');await createScoped(scoped,{uid,generation:pref.generation}).poll(sub.username);trace('test.collect.complete',{count:1});return {processed:true,count:1};
  }
  trace('test.collect.skipped',{code:subs.length?'not_due':'no_enabled_subscription',blocked:skipped.filter(a=>a.failed).length});return {processed:false,count:0,reason:subs.length?'not_due':'no_enabled_subscription',deferred:skipped};
 });}
 async function reset(uid,input){if(input.confirmation!=='분석 기록 초기화')throw new AppError('확인 문구를 입력해 주세요.');
  return collection.locked('test-user:'+uid,async()=>{if(!(await preferences(db,uid)).test_user)throw new AppError('테스트 사용자를 먼저 선택하세요.',409);
   await db.rpc('moa_reset_test_history',{p_user:uid});trace('test.history.reset');return {ok:true};});}
 return {run,reset};
}
