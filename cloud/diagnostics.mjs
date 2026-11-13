import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
const context=new AsyncLocalStorage();
const fields=new Set(['status','durationMs','count','blocked','attempt','pending','connected','calendar','refresh','expired','analysisId','requestId','method','operation','table','code','cached','limitType','limit','requested','retryAfterSeconds','tokenLimit','requestLimit','removed','checkedDeletions']);
export function trace(stage,details={}){
 const store=context.getStore();if(!store)return;
 const safe={};for(const [k,v]of Object.entries(details))if(fields.has(k)&&(typeof v==='boolean'||typeof v==='number'||(typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v))))safe[k]=v;
 const entry={at:new Date().toISOString(),stage,elapsedMs:Date.now()-store.started,...safe};
 if(store.steps.length<180)store.steps.push(entry);
 // No request bodies, URLs, cookies, user identity, event contents or provider error text.
 console.info(JSON.stringify({diagnostic:true,requestId:store.id,...entry}));
}
export function tracedRequest(fn){return context.run({id:randomUUID(),started:Date.now(),steps:[]},fn);}
export function traceSnapshot(){const s=context.getStore();return s?{requestId:s.id,steps:s.steps}:null;}
export function traceDatabase(db){return new Proxy(db,{get(target,key){const value=target[key];if(typeof value!=='function')return value;return async(...args)=>{const t=Date.now(),table=String(args[0]);const operation=key==='admin'?(args[2]?.method??'GET'):String(key);trace('database.start',{table:table.startsWith('moa_')?table:'auth',operation});try{const result=await value.apply(target,args);trace('database.complete',{durationMs:Date.now()-t,count:Array.isArray(result)?result.length:undefined});return result;}catch(e){trace('database.failed',{durationMs:Date.now()-t,status:e.status??500});throw e;}};}});}
export function diagnosticFailureCode(value){const text=String(value??'');if(!text)return null;if(/오늘의 분석 한도|회원별 일일/.test(text))return 'daily_limit';if(/OpenAI API 사용 잔액/.test(text))return 'openai_billing';if(/OpenAI 분당|OpenAI 호출 제한|OpenAI 요청 한도/.test(text))return 'openai_rate_limit';if(/처리 중|갱신 중/.test(text))return 'busy';if(/인증|승인|로그인|invalid_grant/.test(text))return 'auth_required';if(/캘린더 연결/.test(text))return 'calendar_missing';if(/권한/.test(text))return 'permission';if(/날짜|시간/.test(text))return 'date_validation';if(/한도|많습니다/.test(text))return 'rate_limit';if(/이미지/.test(text))return 'image';if(/연결|요청/.test(text))return 'upstream_request';return 'processing_failed';}
