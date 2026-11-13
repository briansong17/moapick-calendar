const routes=new Set(['/api/auth/me','/api/auth/register','/api/auth/login','/api/auth/logout','/api/status','/api/integrations','/api/google/config','/api/google/connect','/api/google/calendar','/api/meta/config','/api/meta/accounts','/api/meta/enable','/api/meta/poll','/api/meta/unsubscribe','/api/analyses','/api/analyze','/oauth/google/callback']);
export function safeRoute(raw){try{const p=new URL(raw,'http://localhost').pathname;if(routes.has(p))return p;if(/^\/api\/analyses\/[0-9a-f-]+(\/review|\/google|\/calendar.ics)?$/.test(p))return p.replace(/\/analyses\/[^/]+/,'/analyses/:id');if(['/','/app.js','/style.css','/favicon.ico'].includes(p))return '정적 파일';return '기타 경로';}catch{return '잘못된 경로';}}
export function createServerMonitor({state,write=console.log,intervalMs=60000,now=()=>Date.now()}){
 const started=now(),active=new Map();let timer,sequence=0,previous=null,since=started,counts=new Map(),changes=new Map(),completed=0,errors=0,aborted=0,maxMs=0;
 const output=s=>{try{write(s);}catch{/* Console failure must not break requests. */}};
 function change(label){changes.set(label,(changes.get(label)??0)+1);}
 function track(req,res){const id=++sequence,start=now(),route=safeRoute(req.url),method=['GET','POST','HEAD','OPTIONS'].includes(req.method)?req.method:'OTHER';active.set(id,start);let done=false;
 const finish=closed=>{if(done)return;done=true;active.delete(id);const duration=now()-start;completed++;maxMs=Math.max(maxMs,duration);if(closed)aborted++;else if(res.statusCode>=400)errors++;const key=method+' '+route+' → '+(closed?'응답 중단':res.statusCode);counts.set(key,(counts.get(key)??0)+1);
 if(!closed&&res.statusCode<400&&(method==='POST'||route==='/oauth/google/callback'))change(method+' '+route+' 처리 성공');
 if(closed||res.statusCode>=400)output('[요청 주의] '+key+' ('+duration+'ms)');};
 res.once('finish',()=>finish(false));res.once('close',()=>finish(!res.writableFinished));
 }
 function report(){const at=now();let current,health='응답 처리 루프 동작';try{current=state();}catch{health='상태 조회 실패 — 저장소 확인 필요';current={};}
 const stamp=new Date(at).toLocaleString('sv-SE',{timeZone:'Asia/Seoul'}),lines=[`\n[서버 상태 ${stamp} KST] ${health}`,`  실행 ${Math.floor((at-started)/1000)}초 | 집계 ${Math.round((at-since)/1000)}초 | 메모리 RSS ${Math.round(process.memoryUsage().rss/1048576)}MB`,`  요청 완료 ${completed}건 · HTTP 오류 ${errors}건 · 응답 중단 ${aborted}건 · 처리 중 ${active.size}건 · 최장 처리 중 ${active.size?Math.round((at-Math.min(...active.values()))/1000):0}초 · 최대 응답 ${maxMs}ms`];
 for(const [k,v]of Object.entries(current)){lines.push('  '+k+': '+v+(previous&&previous[k]!==v?' (이전 '+previous[k]+')':''));}
 lines.push('  주요 요청: '+(counts.size?[...counts].map(([k,n])=>`${k} ${n}건`).join(' / '):'없음'));
 lines.push('  변경 사항: '+(changes.size?[...changes].map(([k,n])=>`${k} ${n}건`).join(' / '):'없음'));
 lines.push('  ※ 로컬 프로세스·저장소 기준입니다. 외부 API 및 Vercel 상태를 보증하지 않습니다.');output(lines.join('\n'));
 previous=current;since=at;counts=new Map();changes=new Map();completed=errors=aborted=maxMs=0;
 }
 return {track,change,report,start(){if(timer)return;output('[모니터링 시작] 60초마다 상태 요약 · 인증정보/요청 본문/일정 내용 미출력');report();timer=setInterval(report,intervalMs);timer.unref?.();},stop(){if(!timer)return;clearInterval(timer);timer=null;report();output('[모니터링 종료] 로컬 서버가 종료됐습니다.');}};
}
