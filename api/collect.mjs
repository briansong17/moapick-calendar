import {createTestUsers} from '../cloud/test-users.mjs';
import {handleSchedule} from '@vercel/schedules';
import {createSupabase} from '../cloud/supabase.mjs';
import {createCollection} from '../cloud/collection.mjs';
import {createSync} from '../cloud/sync.mjs';
import {runCollectionJob} from '../cloud/job.mjs';
export const POST=handleSchedule(async()=>{
  const db=createSupabase(process.env);let sync;const collection=createCollection({db,env:process.env,onComplete:row=>sync.enqueueAnalysis(row)});sync=createSync({db,env:process.env,collection});
  collection.runTest=createTestUsers({db,collection,dailyLimit:Number(process.env.DAILY_ANALYSIS_LIMIT||100),createScoped:(scoped,scope)=>createCollection({db:scoped,env:process.env,scope,onComplete:row=>sync.enqueueAnalysis(row)})}).run;
  const result=await runCollectionJob({db,collection});
  await sync.drain(2);
  console.log(JSON.stringify({job:'instagram-collection',...result}));
});
