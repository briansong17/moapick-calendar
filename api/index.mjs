import {createHandler} from '../cloud/handler.mjs';
import {waitUntil} from '@vercel/functions';
let handler;
export default async function(req,res){
  try{handler??=createHandler(process.env,{scheduleBackground:task=>waitUntil(Promise.resolve().then(task).catch(error=>console.warn(JSON.stringify({stage:'background.failed',status:error.status??500}))))});return await handler(req,res);}
  catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'서비스 설정 준비 중입니다.'}));}
}
