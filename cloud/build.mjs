import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {buildPolicies} from './policies.mjs';
await mkdir('dist',{recursive:true});
let html='',js=await readFile('cloud/app-base.js','utf8');
js=js.slice(0,js.indexOf('async function loadSession()'))+`
async function loadSession(){const state=await api('/api/auth/me');signedIn=state.user;
 $('cloud-login').hidden=!!signedIn;$('logout').hidden=!signedIn;$('member-content').hidden=!signedIn;
 $('auth-title').textContent=signedIn?signedIn.login+'님의 모아':'Google 로그인 · 회원가입';
 $('auth-status').textContent='';
 document.querySelectorAll('[data-admin]').forEach(e=>e.hidden=true);
 if(signedIn)await Promise.all([status(),history(),connections()]);}
 $('cloud-login').onclick=async()=>{try{const r=await api('/api/auth/google',{});window.location.assign(r.url);}catch(e){$('auth-status').textContent=e.message;}};
 $('logout').onclick=async()=>{try{await api('/api/auth/logout',{});window.location.reload();}catch(e){$('auth-status').textContent=e.message;}};
 $('delete-account').onclick=async()=>{try{await api('/api/account/delete',{confirmation:$('delete-confirmation').value});window.location.reload();}catch(e){message(e.message);}};
`;
js=js.replace('files.some(f => f.size > 3 * 1024 * 1024)', 'files.reduce((total,f)=>total+f.size,0) >= 3 * 1024 * 1024').replace('3MB 이하 이미지 1~3장을 선택해 주세요.','전체 합계 3MB 미만 이미지 1~3장을 선택해 주세요.');
js=js.replace('오늘 요청 '+ '${s.count}/${s.limit}회','공유 일일 상한 '+ '${s.limit}회');
js=js.replace('card.dataset.index = index;', 'card.dataset.index = index; card.dataset.sourceIndex = row.source_indices?.[index] ?? index;')
 .replace('{ events, confirmed: true }', '{ events, source_indices: [...$("events").children].map(card=>Number(card.dataset.sourceIndex)), confirmed: true }')
 .replace("$('save').disabled = !events.length;", "$('save').disabled = false;")
 .replace("$('confirmed').parentElement.hidden = !events.length;", "$('confirmed').parentElement.hidden = false;")
 .replace("render(row); message('확인한 일정을 저장했습니다. 캘린더 파일로 내려받을 수 있습니다.');", "render(row); message(row.sync?.pending ? '검토는 저장됐습니다. 캘린더 반영 대기: '+row.sync.error : '검토를 저장하고 캘린더를 갱신했습니다.');")
 .replace("b.onclick = () => { if (row.result) render(row);", "b.onclick = async () => { if (row.result) render(await api('/api/analyses/'+row.id));")
 .replace("if(signedIn)await Promise.all([status(),history(),connections()]);", "if(signedIn){await Promise.all([status(),history(),connections()]);await openRequestedAnalysis();}")
 .replace("'원문과 비교하고 필요한 정보를 수정해 주세요.'", "'원문과 비교하고 필요한 정보를 수정해 주세요. 캘린더에는 (검토 필요)로 임시 표시합니다. 날짜 없는 후보는 등록 대기입니다.'");
js=js.replace("}\n$('images').onchange", "if(row.sync?.error) message('캘린더 반영 대기: '+row.sync.error);\n}\n$('images').onchange");
js=js.replace('events.forEach((e, index) => {','events.forEach((e, index) => { if(row.deleted_indices?.includes(row.source_indices?.[index]??index))return;');
js=js.replace('Promise.all([status(),history(),connections()])','Promise.all([status(),history(),connections(),loadManagedEvents()])');
js+='\n'+await readFile('cloud/event-management-ui.js','utf8');
js=js.replace(/모아(?!픽)/g,'모아픽 캘린더');
html=await readFile('cloud/index.html','utf8');
html=html.replace('<section data-page="testing"',await readFile('cloud/member-schedules.html','utf8')+'<section data-page="testing"');
html=html.replace('아이폰 표시 완료','휴대폰 앱의 표시 완료').replaceAll('아이폰 캘린더 앱의 표시 완료','휴대폰 캘린더 앱의 표시 완료')
 .replace('Google 반영 확인은 서버 기록 중 최대 10개를 실제 Google에서 조회합니다.','Google 반영 확인은 서버의 등록·삭제 대상 중 최대 10개를 실제 Google에서 조회합니다.')
 .replace('아이폰에서는 같은 Google 계정과 ‘모아 · Instagram 일정’ 캘린더가 표시 대상으로 선택돼 있는지도 확인해 주세요.','휴대폰에서는 같은 Google 계정의 현재 연결된 캘린더가 표시 대상으로 선택돼 있는지도 확인해 주세요.')
 .replace('<!-- device-calendar-help -->',await readFile('cloud/device-calendar-help.html','utf8'));
js+='\n'+await readFile('cloud/navigation.js','utf8');
js=js.replace("$('connection-message').textContent = text;", "$('connection-message').textContent = text; $('settings-status').textContent=text;");
js=js.replace('`연결 설정됨 · @${s.meta.account} · ${s.meta.version}`', "'자동 수집 연결 설정됨'").replace('새 Meta 앱·토큰 설정 필요','자동 수집 연결을 준비 중입니다.').replace('클라이언트 설정 완료 · 계정 연결 필요','Google 계정을 연결하세요.').replace('새 Google OAuth 클라이언트 설정 필요','캘린더 연결을 준비 중입니다.');
js=js.replace("'원문과 비교하고 필요한 정보를 수정해 주세요. 캘린더에는 (검토 필요)로 임시 표시합니다. 날짜 없는 후보는 등록 대기입니다.'", "(row.reviewed?'검토한 일정입니다. 수정 후 저장하면 캘린더에 반영됩니다.':'원문과 비교한 뒤 저장하세요. 날짜가 없으면 캘린더 등록을 기다립니다.')");
js=js.replace('await Promise.all([history(), status()]);','await Promise.all([history(), status(),loadManagedEvents()]);');

js=js.replace("function render(row) {","function render(row) { openView('review');");
js=js.replace("$('auth-title').textContent=signedIn?","$('auth-panel').hidden=!!signedIn;$('member-email').textContent=signedIn?.login??'';$('settings-email').textContent=signedIn?.login??''; $('auth-title').textContent=signedIn?");
// Assemble the browser bundle used by the Vercel deployment.
const diagnosticUI=(await readFile('cloud/diagnostics-ui.js','utf8')).replace('__BUILD_ID__',process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,12)||'local');
js=await readFile('cloud/workspace-ui.js','utf8')+'\n'+await readFile('cloud/member-schedules-ui.js','utf8')+'\n'+await readFile('cloud/devices-ui.js','utf8')+'\n'+diagnosticUI+'\n'+await readFile('cloud/reconcile-ui.js','utf8')+'\n'+await readFile('cloud/test-users-ui.js','utf8')+'\n'+await readFile('cloud/review-link-ui.js','utf8')+'\n'+js;
if(!js.includes('await openRequestedAnalysis();'))throw new Error('Cloud review link hook is missing');
// Preserve test collection eligibility in the manual action instead of reporting a skipped request as complete.
js=js.replace("await api('/api/meta/poll', { username: a.username });", "const collectionResponse=await api('/api/meta/poll', { username: a.username });")
 .replace("return '수집이 끝났습니다. 처리 기록과 분석 결과를 확인하세요.';", "return collectionResponse.collectionResult?collectionResultMessage(collectionResponse.collectionResult):'수집이 끝났습니다. 처리 기록과 분석 결과를 확인하세요.';");
js=js.replace(/async function api\(path, data\) \{[\s\S]*?\n\}/, 'async function api(path,data){return diagnosticApi(path,data);}');
js=js.replace("function message(text) { $('message').textContent = text; }", "function message(text) { $('message').textContent=text;diagnosticNotice(text); }");
js=js.replace("signedIn=state.user;", "signedIn=state.user;bindWorkspace(signedIn);diagnosticBind(signedIn);bindMemberSchedules(signedIn);if(signedIn)queueMicrotask(async()=>{await testVisit();void reconcileCalendar(true);});");
js=js.replace("previewUrls.forEach(URL.revokeObjectURL);", "diagnosticLog('image.selected',{count:$('images').files.length,bytes:[...$('images').files].reduce((n,f)=>n+f.size,0)});previewUrls.forEach(URL.revokeObjectURL);");
js=js.replace("const readImage = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); r.readAsDataURL(file); });", "const readImage = file => new Promise((resolve,reject)=>{diagnosticLog('image.read.start',{bytes:file.size});const r=new FileReader();r.onload=()=>{diagnosticLog('image.read.complete',{bytes:file.size});resolve(r.result);};r.onerror=r.onabort=()=>{diagnosticLog('image.read.failed');reject(new Error('이미지를 읽지 못했습니다.'));};r.readAsDataURL(file);});");
js=js.replace("await Promise.all([status(), history()]).catch(() => {});", "await Promise.all([status(),history(),loadManagedEvents()]).catch(()=>{});");
js=js.replace("message(r.reused ?", "message(r.pending ? 'Google 반영 대기 중입니다. 진행상황에서 확인해 주세요.' : r.blocked?.length ? '날짜가 없는 일정은 등록 대기입니다. 진행상황에서 확인해 주세요.' : r.reused ?");
js=js.replace("$('settings-status').textContent=text;","$('settings-status').textContent=text;diagnosticNotice(text);");
js+='\nsetupDiagnostics();setupReconciliation();setupTestUsers();setupDevices();setupMemberSchedules();';
await writeFile('dist/index.html',html);await writeFile('dist/app.js',js);await copyFile('cloud/style.css','dist/style.css');
await buildPolicies();
