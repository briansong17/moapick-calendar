import {runCollectionJob} from './job.mjs';
import {trace,tracedRequest,traceSnapshot} from './diagnostics.mjs';
import {saveRequestLog} from './request-logs.mjs';

// Supabase owns pending work. These bounded runners only advance it; a later
// scheduled invocation can resume after a timeout, disconnect or deployment.
export function createServerWorker({db,sync,collection,env,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  async function syncUser(uid,options={}){
    return tracedRequest(async()=>{
      const started=Date.now();let status=200,result;
      const save=phase=>saveRequestLog(db,{uid,path:'/api/sync/background',method:'POST',status:phase==='running'?102:status,started,snapshot:traceSnapshot(),build:env.VERCEL_GIT_COMMIT_SHA,phase});
      trace('background.start');await save('running');
      try{result=await collection.locked('worker:'+uid,async()=>{
        const {maxJobs=20,deadline=Date.now()+180000,retryWaitMs=60000}=options;
        let processed=0,waited=0,current;
        do{
          current=await sync.drainUser(uid,{maxJobs:maxJobs-processed,deadline});processed+=current.processed;
          const delay=Date.parse(current.nextDue)-Date.now();
          if(!current.pending||current.busy||processed>=maxJobs||!(delay>0)||delay>retryWaitMs-waited||Date.now()+delay+10000>=deadline)break;
          trace('background.retry_wait',{retryAfterSeconds:Math.ceil(delay/1000)});await wait(delay);waited+=delay;
        }while(Date.now()<deadline);
        return {...current,processed};
      });status=result.pending?202:200;trace('background.complete',{count:result.processed,pending:result.pending});return result;}
      catch(error){if(error.status===409){status=202;trace('background.busy',{pending:true});return {processed:0,pending:true,busy:true};}status=error.status??500;trace('background.failed',{status});throw error;}
      finally{await save('complete');}
    });
  }
  async function dueSync(maxJobs,deadline){
    const jobs=await db.admin('moa_sync_jobs',{next_due:`lte.${new Date().toISOString()}`,order:'next_due.asc',select:'user_id',limit:String(maxJobs)});
    const users=new Map();for(const job of jobs)users.set(job.user_id,(users.get(job.user_id)??0)+1);
    let processed=0,failed=false;
    for(const [uid,count]of users){if(Date.now()>=deadline)break;try{processed+=(await syncUser(uid,{maxJobs:count,deadline})).processed;}catch{failed=true;}}
    return {processed,failed};
  }
  async function tick(){
    const deadline=Date.now()+240000;
    // Calendar retries must run even when Instagram/OpenAI is unavailable.
    let before={processed:0},after={processed:0},collectionResult={processed:false},collectionFailed=false;
    try{before=await dueSync(4,deadline);}catch{before.failed=true;}
    try{collectionResult=await runCollectionJob({db,collection});}catch(error){collectionFailed=true;console.warn(JSON.stringify({job:'instagram-collection',stage:'collection.failed',status:error.status??500}));}
    if(Date.now()<deadline)try{after=await dueSync(20,deadline);}catch{after.failed=true;}
    return {collection:collectionResult,collectionFailed,syncProcessed:before.processed+after.processed,syncFailed:!!before.failed||!!after.failed};
  }
  return {syncUser,tick};
}
