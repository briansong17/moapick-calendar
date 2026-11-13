import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {buildPolicies} from './policies.mjs';
await mkdir('dist',{recursive:true});
let html=await readFile('public/index.html','utf8'),js=await readFile('public/app.js','utf8');
html=html.replace('</head>', '<meta name="google-site-verification" content="snvybBLgsEb03XPqd5KidUElJaFW2r-NYVO2aryJZo8" /></head>');
html=html.replace(/<form id="auth-form">[\s\S]*?<\/form>/,`<button id="cloud-login" class="primary">Google로 로그인 · 회원가입</button><p class="small">Google 비밀번호는 모아에 전달되지 않습니다. 캘린더 권한은 로그인 후 별도로 승인합니다.</p>`);
html=html.replace('<div id="member-content" hidden>',`<div id="member-content" hidden><details class="panel"><summary>계정 관리</summary><p>비밀번호 복구는 Google 계정에서 진행합니다. 탈퇴하면 모아의 개인 구독·검토·연결 정보가 삭제됩니다. Google 캘린더에 이미 등록한 일정은 남습니다.</p><label>탈퇴 확인<input id="delete-confirmation" placeholder="계정 삭제"></label><button id="delete-account" class="secondary">회원 탈퇴</button></details>`);
html=html.replaceAll('내 PC에서 실행 중','Google 계정으로 안전하게 로그인').replace('개인 PC 시험 운영 · 사용자 확인 후 캘린더 등록','사용자 확인 후 캘린더 등록').replace('회당 5개씩 처리하며','배포 서버에서는 회당 1개씩 처리하며').replace('구독 중에는 서버 실행 중 60분마다 새 게시물을 확인합니다.','예약 작업이 약 15분 간격으로 대기 중인 계정의 게시물 1개를 처리합니다. 무료 플랜에서는 실행이 최대 15분 지연될 수 있으며, 여러 계정은 순서대로 처리합니다.');
js=js.slice(0,js.indexOf('async function loadSession()'))+`
async function loadSession(){const state=await api('/api/auth/me');signedIn=state.user;
 $('cloud-login').hidden=!!signedIn;$('logout').hidden=!signedIn;$('member-content').hidden=!signedIn;
 $('auth-title').textContent=signedIn?signedIn.login+'님의 모아':'Google 로그인 · 회원가입';
 $('auth-status').textContent=signedIn?'내 구독과 일정을 관리하세요.':'Google 계정으로 가입하고 로그인하세요.';
 document.querySelectorAll('[data-admin]').forEach(e=>e.hidden=true);
 if(signedIn)await Promise.all([status(),history(),connections()]);}
 $('cloud-login').onclick=async()=>{try{const r=await api('/api/auth/google',{});window.location.assign(r.url);}catch(e){$('auth-status').textContent=e.message;}};
 $('logout').onclick=async()=>{try{await api('/api/auth/logout',{});window.location.reload();}catch(e){$('auth-status').textContent=e.message;}};
 $('delete-account').onclick=async()=>{try{await api('/api/account/delete',{confirmation:$('delete-confirmation').value});window.location.reload();}catch(e){message(e.message);}};
`;
html=html.replace('최대 3장, 한 장당 3MB','최대 3장, 전체 합계 3MB 미만');
js=js.replace('files.some(f => f.size > 3 * 1024 * 1024)', 'files.reduce((total,f)=>total+f.size,0) >= 3 * 1024 * 1024').replace('3MB 이하 이미지 1~3장을 선택해 주세요.','전체 합계 3MB 미만 이미지 1~3장을 선택해 주세요.');
js=js.replace('오늘 요청 '+ '${s.count}/${s.limit}회','공유 일일 상한 '+ '${s.limit}회');
html=html.replace('</footer>', '<nav><a href="/privacy.html">개인정보처리방침</a> · <a href="/terms.html">이용 안내 및 약관</a> · <a href="/data-deletion.html">데이터 삭제</a></nav></footer>')
 .replaceAll('사용자 확인 후 캘린더 등록','검토 필요 일정 자동 등록 · 검토 후 확정')
 .replace('일정은 검토·저장 후 직접 등록합니다.','추출 일정은 (검토 필요) 표시로 자동 등록하며, 검토를 저장하면 표시가 사라집니다. 날짜가 없으면 대기하고 시간이 불명확하면 날짜에만 임시 표시합니다.')
 .replace('Google 등록은 저장된 일정에 적용됩니다. 시간 일정은 종료 시간까지 입력해 주세요. 등록 후 수정은 Google 캘린더에서 직접 처리합니다.','검토를 저장하면 같은 Google 일정이 갱신됩니다. 제외한 후보는 전용 캘린더에서도 삭제됩니다. 시간 일정은 종료 시간을 확인하거나 시작·종료 시간을 모두 비워 날짜로 저장하세요.')
 .replace('Google 캘린더에 등록','캘린더 동기화 재시도');
js=js.replace('card.dataset.index = index;', 'card.dataset.index = index; card.dataset.sourceIndex = row.source_indices?.[index] ?? index;')
 .replace('{ events, confirmed: true }', '{ events, source_indices: [...$("events").children].map(card=>Number(card.dataset.sourceIndex)), confirmed: true }')
 .replace("$('save').disabled = !events.length;", "$('save').disabled = false;")
 .replace("$('confirmed').parentElement.hidden = !events.length;", "$('confirmed').parentElement.hidden = false;")
 .replace("render(row); message('확인한 일정을 저장했습니다. 캘린더 파일로 내려받을 수 있습니다.');", "render(row); message(row.sync?.pending ? '검토는 저장됐습니다. 캘린더 반영 대기: '+row.sync.error : '검토를 저장하고 캘린더를 갱신했습니다.');")
 .replace("b.onclick = () => { if (row.result) render(row);", "b.onclick = async () => { if (row.result) render(await api('/api/analyses/'+row.id));")
 .replace("if(signedIn)await Promise.all([status(),history(),connections()]);", "if(signedIn){await Promise.all([status(),history(),connections()]);const id=new URLSearchParams(location.search).get('analysis');if(id&&/^[a-f0-9-]{36}$/.test(id)){render(await api('/api/analyses/'+id));$('results').scrollIntoView();}}")
 .replace("'원문과 비교하고 필요한 정보를 수정해 주세요.'", "'원문과 비교하고 필요한 정보를 수정해 주세요. 캘린더에는 (검토 필요)로 임시 표시합니다. 날짜 없는 후보는 등록 대기입니다.'");
js=js.replace("}\n$('images').onchange", "if(row.sync?.error) message('캘린더 반영 대기: '+row.sync.error);\n}\n$('images').onchange");
html=html.replace('<div id="member-content" hidden>',`<div id="member-content" hidden><section class="panel" id="event-management"><h2>내 일정 관리</h2><p>개별·선택·전체 삭제는 내 일정에만 적용됩니다. 삭제한 일정은 자동으로 다시 등록하지 않습니다. 원본 게시물과 다른 회원의 일정은 유지됩니다.</p><p id="event-count"></p><div class="actions"><label><input type="checkbox" id="events-select-all" style="width:auto">전체 선택</label><button id="events-delete-selected" class="secondary">선택 삭제</button><button id="events-delete-all" class="secondary">전체 삭제</button><button id="events-reload" class="text-button">목록 새로고침</button></div><p id="event-status" role="status" aria-live="polite"></p><div id="managed-events"></div></section>`);
js=js.replace('events.forEach((e, index) => {','events.forEach((e, index) => { if(row.deleted_indices?.includes(row.source_indices?.[index]??index))return;');
js=js.replace('Promise.all([status(),history(),connections()])','Promise.all([status(),history(),connections(),loadManagedEvents()])');
js+='\n'+await readFile('cloud/event-management-ui.js','utf8');
html=html.replace(/모아(?!픽)/g,'모아픽 캘린더').replace('<span>moa</span>','<span>MoaPick Calendar</span>').replace('<title>모아픽 캘린더 —','<title>모아픽 캘린더 · MoaPick Calendar —');
js=js.replace(/모아(?!픽)/g,'모아픽 캘린더');
html=await readFile('cloud/index.html','utf8');
js+='\n'+await readFile('cloud/navigation.js','utf8');
js=js.replace("$('connection-message').textContent = text;", "$('connection-message').textContent = text; $('settings-status').textContent=text;");
js=js.replace('`연결 설정됨 · @${s.meta.account} · ${s.meta.version}`', "'자동 수집 사용 가능'").replace('새 Meta 앱·토큰 설정 필요','자동 수집 연결을 준비 중입니다.').replace('클라이언트 설정 완료 · 계정 연결 필요','Google 계정을 연결하세요.').replace('새 Google OAuth 클라이언트 설정 필요','캘린더 연결을 준비 중입니다.');
js=js.replace("'원문과 비교하고 필요한 정보를 수정해 주세요. 캘린더에는 (검토 필요)로 임시 표시합니다. 날짜 없는 후보는 등록 대기입니다.'", "(row.reviewed?'검토한 일정입니다. 수정 후 저장하면 캘린더에 반영됩니다.':'원문과 비교한 뒤 저장하세요. 날짜가 없으면 캘린더 등록을 기다립니다.')");
js=js.replace('await Promise.all([history(), status()]);','await Promise.all([history(), status(),loadManagedEvents()]);');

js=js.replace("function render(row) {","function render(row) { openView('review');");
js=js.replace("$('auth-title').textContent=signedIn?","$('auth-panel').hidden=!!signedIn;$('member-email').textContent=signedIn?.login??'';$('settings-email').textContent=signedIn?.login??''; $('auth-title').textContent=signedIn?");
// Instrument only the cloud bundle; keep the local application independent.
const diagnosticUI=(await readFile('cloud/diagnostics-ui.js','utf8')).replace('__BUILD_ID__',process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,12)||'local');
js=diagnosticUI+'\n'+js;
js=js.replace(/async function api\(path, data\) \{[\s\S]*?\n\}/, 'async function api(path,data){return diagnosticApi(path,data);}');
js=js.replace("function message(text) { $('message').textContent = text; }", "function message(text) { $('message').textContent=text;diagnosticNotice(text); }");
js=js.replace("signedIn=state.user;", "signedIn=state.user;diagnosticBind(signedIn);");
js=js.replace("previewUrls.forEach(URL.revokeObjectURL);", "diagnosticLog('image.selected',{count:$('images').files.length,bytes:[...$('images').files].reduce((n,f)=>n+f.size,0)});previewUrls.forEach(URL.revokeObjectURL);");
js=js.replace("const readImage = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('이미지를 읽지 못했습니다.')); r.readAsDataURL(file); });", "const readImage = file => new Promise((resolve,reject)=>{diagnosticLog('image.read.start',{bytes:file.size});const r=new FileReader();r.onload=()=>{diagnosticLog('image.read.complete',{bytes:file.size});resolve(r.result);};r.onerror=r.onabort=()=>{diagnosticLog('image.read.failed');reject(new Error('이미지를 읽지 못했습니다.'));};r.readAsDataURL(file);});");
js=js.replace("await Promise.all([status(), history()]).catch(() => {});", "await Promise.all([status(),history(),loadManagedEvents()]).catch(()=>{});");
js=js.replace("message(r.reused ?", "message(r.pending ? 'Google 반영 대기 중입니다. 진행상황에서 확인해 주세요.' : r.blocked?.length ? '날짜가 없는 일정은 등록 대기입니다. 진행상황에서 확인해 주세요.' : r.reused ?");
js=js.replace("$('settings-status').textContent=text;","$('settings-status').textContent=text;diagnosticNotice(text);");
js+='\nsetupDiagnostics();';
await writeFile('dist/index.html',html);await writeFile('dist/app.js',js);await copyFile('cloud/style.css','dist/style.css');
await buildPolicies();
