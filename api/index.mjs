import {createHandler} from '../cloud/handler.mjs';
let handler;
export default async function(req,res){
  try{handler??=createHandler(process.env);return await handler(req,res);}
  catch{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'서비스 설정 준비 중입니다.'}));}
}
