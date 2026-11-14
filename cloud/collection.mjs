import {trace} from './diagnostics.mjs';
import {randomUUID} from 'node:crypto';
import {AppError,validateInput,inputHash,extract} from '../lib/extraction.mjs';
import {accountName,contentHash,createInstagram} from '../lib/instagram.mjs';
import {pastBoundary} from '../lib/collector.mjs';
import {koreanDay as day} from './time.mjs';
export function createCollection({db,env,analyze=extract,instagram,onComplete=async()=>{},scope=null}) {
  const model=env.OPENAI_MODEL||'gpt-5.4-mini';
  const config=env.META_TOKEN?{token:env.META_TOKEN,ig_id:env.META_IG_ID,version:env.META_API_VERSION||'v27.0',username:env.META_USERNAME}:null;
  const state={meta:config};
  const ig=instagram||createInstagram({vault:{get:k=>state[k],set:(k,v)=>state[k]=v},onDiagnostic:trace});
  async function locked(name,fn) {
    const owner=randomUUID();if(!await db.rpc('moa_claim_lock',{p_name:name,p_owner:owner,p_seconds:300}))throw new AppError('처리 중입니다. 잠시 후 다시 시도하세요.',409);
    try{return await fn();}finally{await db.admin('moa_locks',{name:`eq.${name}`,owner:`eq.${owner}`},{method:'DELETE'});}
  }
  async function analyzeInput(raw,userId=scope?.uid??null) {
    if(!env.OPENAI_API_KEY)throw new AppError('이미지 분석 연결 준비 중입니다.',503);
    trace('image.validate');const input=validateInput(raw,{maxImages:scope?20:userId?3:20});trace('image.validated',{count:input.images.length});
    const hash=inputHash(input,model+':'+(userId??'public-instagram'));
    const legacyHash=scope?inputHash(input,model+':'+userId+':test:'+scope.generation,{deduplicate:false}):null;
    return locked('analysis',async()=>{
      const own=userId?{owner_id:`eq.${userId}`}:{owner_id:'is.null',account:`eq.${input.account}`};
      let [cached]=await db.admin('moa_analyses',{...own,hash:`eq.${hash}`,status:'eq.complete',order:'created_at.desc',limit:'1'});
      if(!cached&&legacyHash)[cached]=await db.admin('moa_analyses',{...own,hash:`eq.${legacyHash}`,status:'eq.complete',order:'created_at.desc',limit:'1'});
      if(!cached&&scope&&input.source_url){
        const candidates=await db.admin('moa_analyses',{...own,'metadata->>source_url':`eq.${input.source_url}`,'metadata->>model':`eq.${model}`,status:'eq.complete',order:'created_at.desc',limit:'20'});
        // An exact input hash is still required; URL/caption resemblance alone is never a cache hit.
        cached=candidates.find(c=>c.metadata?.test_generation&&c.hash===inputHash(input,model+':'+userId+':test:'+c.metadata.test_generation,{deduplicate:false}));
      }
      if(cached){
        // Reset history/cursors, not the AI cache. Copy only this member's identical input result.
        // A fresh record keeps reset history visible without copying reviews or deletion state.
        if(scope&&cached.metadata?.test_generation!==scope.generation){
          const usage={input_tokens:0,output_tokens:0,total_tokens:0,cache_reused:true,source_analysis_id:cached.id};
          [cached]=await db.admin('moa_analyses',{}, {method:'POST',prefer:'return=representation',body:{owner_id:userId,account:null,hash,status:'complete',metadata:{...cached.metadata,test_generation:scope.generation},result:cached.result,usage}});
        }
        trace('analysis.cache',{analysisId:cached.id,cached:true});await onComplete(cached);return {...cached,cached:true};
      }
      const [cooldown]=await db.admin('moa_limits',{bucket:'eq.openai:cooldown',expires_at:`gt.${new Date().toISOString()}`,select:'expires_at',limit:'1'});if(cooldown){throw Object.assign(new AppError('OpenAI 호출 제한 대기 중입니다. 다음 실행 시각 이후 다시 확인합니다.',429),{retryAfterSeconds:Math.max(30,Math.ceil((Date.parse(cooldown.expires_at)-Date.now())/1000))});}
      if(!await db.rpc('moa_take_limit',{p_bucket:'analysis:'+day(),p_limit:Number(env.DAILY_ANALYSIS_LIMIT||100),p_seconds:86400}))throw new AppError('오늘의 분석 한도에 도달했습니다.',429);
      const {images,...metadata}=input;
      const [row]=await db.admin('moa_analyses',{}, {method:'POST',prefer:'return=representation',body:{owner_id:userId,account:userId?null:input.account,hash,status:'running',metadata:{...metadata,image_count:images.length,unique_image_count:new Set(images).size,model,...(scope?{test_generation:scope.generation}:{})}}});
      let completed;
      try{trace('openai.start',{analysisId:row.id});const {result,usage}=await analyze(input,{apiKey:env.OPENAI_API_KEY,model});
        trace('openai.complete',{analysisId:row.id,count:result.events.length,inputTokens:usage?.input_tokens,outputTokens:usage?.output_tokens,totalTokens:usage?.total_tokens});await db.admin('moa_analyses',{id:`eq.${row.id}`},{method:'PATCH',body:{status:'complete',result,usage}});completed={...row,status:'complete',result,usage};
      }catch(e){trace('openai.failed',{status:e.status??500,...(e.provider??{})});if(e.provider&&e.status===429)await db.admin('moa_limits',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:{bucket:'openai:cooldown',count:1,expires_at:new Date(Date.now()+e.retryAfterSeconds*1000).toISOString()}});await db.admin('moa_analyses',{id:`eq.${row.id}`},{method:'PATCH',body:{status:'failed',error:e instanceof AppError?e.message:'분석 실패',...(e.provider?{usage:{failure:e.provider}}:{})}});throw e;}
      await onComplete(completed);return completed;
    });
  }
  async function subscribe(userId,value) {
    const username=accountName(value);
    return locked('subscriptions:'+userId,async()=>{
      const subscriptions=await db.admin('moa_subscriptions',{user_id:`eq.${userId}`});
      if(subscriptions.some(s=>s.username===username))return;
      if(subscriptions.length>=20)throw new AppError('구독은 최대 20개까지 가능합니다.');
      if(!(await db.admin('moa_accounts',{username:`eq.${username}`})).length){await ig.page(username);
        await db.admin('moa_accounts',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{username}});}
      await db.admin('moa_subscriptions',{}, {method:'POST',prefer:'resolution=ignore-duplicates',body:{user_id:userId,username}});
    });
  }
  async function poll(value) {
    const username=accountName(value);
    return locked('collect:'+username,async()=>{
      let [a]=await db.admin('moa_accounts',{username:`eq.${username}`});if(!a)throw new AppError('구독을 찾을 수 없습니다.',404);
      if(a.phase==='paused')throw new AppError('초기 수집 상한에 도달했습니다. 관리자 확인이 필요합니다.',409);
      const update=async patch=>{await db.admin('moa_accounts',{username:`eq.${username}`},{method:'PATCH',body:patch});a={...a,...patch};};
      try{
        if(a.phase==='ready')await update({phase:'refresh',processed:0,reason:null,cursor:'',queue:[],seen:[]});
        // Fetch the page anew to refresh signed URLs. Never store downloaded image bytes.
        const page=await ig.page(username,a.cursor);
        const posts=[...page.posts].sort((x,y)=>(y.timestamp||'').localeCompare(x.timestamp||''));
        for(const p of posts){if(!/^\d+$/.test(p.id??''))continue;
          const [old]=await db.admin('moa_posts',{id:`eq.${p.id}`});const hash=contentHash(p);
          const row={id:p.id,username,hash,payload:p,updated_at:new Date().toISOString(),...(!old||old.hash!==hash?{status:'pending',attempts:0,error:null,analysis_id:null}:{})};
          await db.admin('moa_posts',{}, {method:'POST',prefer:'resolution=merge-duplicates',body:row});}
        if(!a.queue.length){
          if(page.after&&(page.after===a.cursor||a.seen.includes(page.after)))throw new AppError('페이지 커서 반복으로 중단했습니다.',502);
          await update({queue:posts.filter(p=>/^\d+$/.test(p.id??'')).map(p=>p.id),next_cursor:page.after,seen:page.after?[...a.seen,page.after]:a.seen});
        }
        if(!a.queue.length){const checked=new Date();await update({...(a.next_cursor?{cursor:a.next_cursor}:{phase:'ready',reason:'게시물 끝까지 확인',cursor:'',seen:[],next_cursor:null}),error:null,last_checked:checked.toISOString(),next_due:new Date(checked.getTime()+(a.next_cursor?60000:3600000)).toISOString()});return {processed:false,count:0,reason:'no_posts'};}
        const id=a.queue[0],[p]=await db.admin('moa_posts',{id:`eq.${id}`});let result;
        const media=p.payload.media_type==='CAROUSEL_ALBUM'?p.payload.children?.data??[]:[p.payload];
        if(!media.length||media.length>20||media.some(x=>x.media_type!=='IMAGE'||!x.media_url)||p.payload.children?.paging?.next){
          await db.admin('moa_posts',{id:`eq.${id}`},{method:'PATCH',body:{status:'skipped',error:'영상·누락 이미지·20장 초과 게시물은 원문 확인이 필요합니다.'}});
        }else if(p.status==='complete'){
          result=(await db.admin('moa_analyses',{id:`eq.${p.analysis_id}`}))[0]?.result;
        }else if(p.attempts<3){
          try{const images=await Promise.all(media.map(x=>ig.download(x.media_url)));
            const row=await analyzeInput({images,caption:p.payload.caption??'',account:username,source_url:p.payload.permalink??'',posted_at:p.payload.timestamp?.slice(0,10)??''});result=row.result;
            await db.admin('moa_posts',{id:`eq.${id}`},{method:'PATCH',body:{status:'complete',analysis_id:row.id,error:null,attempts:p.attempts+1}});
          }catch(e){if(![409,429].includes(e.status))await db.admin('moa_posts',{id:`eq.${id}`},{method:'PATCH',body:{status:'failed',attempts:p.attempts+1,error:e instanceof AppError?e.message:'분석 실패'}});throw e;}
        }
        const queue=a.queue.slice(1),processed=a.processed+1;
        if(pastBoundary(result,day()))await update({phase:'ready',queue:[],cursor:'',seen:[],next_cursor:null,processed,reason:'지난 행사 일정 확인'});
        else if(processed>=1000&&a.phase==='initial')await update({phase:'paused',queue,processed,reason:'초기 수집 상한: 관리자 확인 필요'});
        else if(!queue.length&&!a.next_cursor)await update({phase:'ready',queue,cursor:'',seen:[],processed,reason:'게시물 끝까지 확인'});
        else if(!queue.length&&a.phase==='refresh'&&processed>=30)await update({phase:'ready',queue,cursor:'',seen:[],processed,reason:'최근 30개 확인'});
        else await update({queue,processed,...(!queue.length?{cursor:a.next_cursor}:{})});
        await update({error:null,last_checked:new Date().toISOString(),next_due:new Date(Date.now()+(a.phase==='initial'?60000:3600000)).toISOString()});
        return {processed:true,count:1};
      }catch(e){await update({error:e instanceof AppError?e.message:'수집 실패',next_due:new Date(Date.now()+(e.status===429&&e.retryAfterSeconds?e.retryAfterSeconds*1000:3600000)).toISOString()});throw e;}
    });
  }
  return {analyzeInput,subscribe,poll,locked,metaStatus:()=>ig.status()};
}
