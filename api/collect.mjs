import {handleSchedule} from '@vercel/schedules';
import {createSupabase} from '../cloud/supabase.mjs';
import {createCollection} from '../cloud/collection.mjs';
import {createSync} from '../cloud/sync.mjs';
import {runCollectionJob} from '../cloud/job.mjs';
export const POST=handleSchedule(async()=>{
  const db=createSupabase(process.env);let sync;const collection=createCollection({db,env:process.env,onComplete:row=>sync.enqueueAnalysis(row)});sync=createSync({db,env:process.env,collection});
  const result=await runCollectionJob({db,collection});
  await sync.drain(2);
  console.log(JSON.stringify({job:'instagram-collection',...result}));
});
