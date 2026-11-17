import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHandler} from '../cloud/handler.mjs';
import {securityHeaders} from '../cloud/security.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
// Existing process variables win. Files are excluded from Git and deployment.
for(const file of ['.env.development.local','.env.cloud.local','.env.local']){
 const path=resolve(root,file);if(existsSync(path))process.loadEnvFile(path);
}
const port=Number(process.env.MOA_DEV_PORT||3080);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('MOA_DEV_PORT must be between 1024 and 65535');
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,PUBLIC_ORIGIN:origin,MOA_LOCAL_DEV:'1'};
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','TOKEN_ENCRYPTION_KEY'];
const missing=required.filter(key=>!env[key]);
if(missing.length){console.error('실행 설정이 없습니다: '+missing.join(', '));console.error('Git 제외 환경 파일 .env.cloud.local 또는 .env.development.local을 확인하세요.');process.exit(1);}
const build=spawnSync(process.execPath,['cloud/build.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});
if(build.status!==0)process.exit(build.status||1);
const active=new Set();let requests=0,lastRequests=0;
const handler=createHandler(env,{scheduleBackground:task=>{
 const pending=Promise.resolve().then(task).catch(()=>console.warn('[모아픽] 서버 후속 작업은 다음 실행에서 다시 확인합니다.'));
 active.add(pending);pending.finally(()=>active.delete(pending));
}});
const files=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/style.css','style.css'],['/privacy.html','privacy.html'],['/terms.html','terms.html'],['/data-deletion.html','data-deletion.html']]);
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const server=createServer(async(req,res)=>{
 requests++;
 try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')||['/auth/callback','/oauth/google/callback'].includes(url.pathname))return await handler(req,res);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403);return res.end('Forbidden');}
  const file=files.get(url.pathname);
  if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);return res.end('Not found');}
  const path=resolve(root,'dist',file),info=await stat(path);
  res.writeHead(200,{...securityHeaders,'Content-Type':types[file.split('.').pop()],'Content-Length':info.size});
  res.end(req.method==='HEAD'?undefined:await readFile(path));
 }catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'실행 설정 또는 연결 상태를 확인해 주세요.'}));}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`이미 ${port}번 포트를 사용하는 서버가 있습니다. 기존 창을 종료하거나 MOA_DEV_PORT를 바꾸세요.`:'서버를 시작하지 못했습니다.');process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 console.log(`모아픽 실행: ${origin}`);
 console.log('같은 Vercel 서버 코드·Supabase 저장소를 사용합니다. 종료: Ctrl+C');
 setInterval(()=>{console.log(`[모아픽] 정상 실행 · 최근 1분 요청 ${requests-lastRequests}건 · 서버 후속 작업 ${active.size}개`);lastRequests=requests;},60000).unref();
});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
